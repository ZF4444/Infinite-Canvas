import json
import uuid
import base64
import hashlib
import hmac
import datetime
import urllib.request
import urllib.parse
import urllib.error
import os
import re
import random
import sys
import subprocess
import time
import traceback
import shutil
import asyncio
import requests
import zipfile
import mimetypes
import tempfile
import math
import shlex
import functools
from types import SimpleNamespace
try:
    import fcntl
except ImportError:  # pragma: no cover - Windows uses the process lock only.
    fcntl = None
from typing import List, Dict, Any, Optional, Tuple, Mapping
from threading import Lock, Thread


def _load_bootstrap_env() -> None:
    """Load API/.env before importing modules that read configuration values."""
    env_file = os.path.join(os.path.dirname(os.path.abspath(__file__)), "API", ".env")
    if not os.path.exists(env_file):
        return
    try:
        with open(env_file, "r", encoding="utf-8-sig") as f:
            for raw_line in f:
                line = raw_line.strip()
                if not line or line.startswith("#") or "=" not in line:
                    continue
                key, value = line.split("=", 1)
                key = key.strip()
                if key:
                    os.environ.setdefault(key, value.strip().strip('"').strip("'"))
    except OSError:
        # Full logging is not configured until imports below complete.
        pass


_load_bootstrap_env()

import httpx
from PIL import Image
from io import BytesIO
from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect, UploadFile, File, Form, Header, Request, Response
from fastapi.exceptions import RequestValidationError
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, Response, StreamingResponse, JSONResponse, RedirectResponse
from pydantic import BaseModel, Field
from fastapi.middleware.cors import CORSMiddleware
from app.core.log_context import bind_log_context, reset_log_context, set_log_context
from app.core.retry import retry_operation_id
from app.core.logging import audit_event, configure_logging, get_logger, get_task_logger
from app.middleware.request_logging import RequestLoggingMiddleware
from app.core.comfyui import comfyui_url, normalize_comfyui_endpoint
from app.ai.transport import gemini_image_options, parse_models_payload

configure_logging()
logger = get_logger("main")
task_logger = get_task_logger("generation")

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# --- 认证中间件 ---
# 放行（无需登录）的精确路径与前缀。
AUTH_PUBLIC_PATHS = {
    "/login",
    "/auth/login",
    "/auth/logout",
    "/health/live",
    "/health/ready",
    "/metrics",
    "/favicon.ico",
}
HEALTH_PATHS = {"/health/live", "/health/ready", "/metrics"}
AUTH_PUBLIC_PREFIXES = (
    "/static/",   # css/js/字体/图片等前端静态资源
    "/auth/",     # 认证相关接口
)


@app.middleware("http")
async def auth_middleware(request: Request, call_next):
    path = request.url.path
    if path in HEALTH_PATHS:
        return await call_next(request)
    if path == "/favicon.ico" or path.startswith("/static/"):
        return await call_next(request)
    # 放行静态资源与登录相关路径
    is_public = path in AUTH_PUBLIC_PATHS or any(path.startswith(p) for p in AUTH_PUBLIC_PREFIXES)
    token = request.cookies.get(SESSION_COOKIE_NAME, "")
    try:
        sess = await get_session(token) if token else None
    except RedisUnavailableError as exc:
        return JSONResponse(
            status_code=503,
            headers={"Retry-After": "3"},
            content={"detail": str(exc), "error": "redis_unavailable", "retry_after_seconds": 3},
        )

    if sess:
        # 已登录：注入当前用户到 ContextVar，供数据路径解析器使用。
        ctx_token = current_user_var.set(sess.get("user_id") or "anonymous")
        request.state.user_id = sess.get("user_id") or "anonymous"
        request.state.username = sess.get("username") or sess.get("user_id") or "anonymous"
        bind_log_context(
            user_id=request.state.user_id,
            username=request.state.username,
        )
        try:
            return await call_next(request)
        finally:
            current_user_var.reset(ctx_token)

    if is_public:
        return await call_next(request)

    # 未登录且访问受保护资源：
    # - API 请求返回 401（前端据此跳登录）
    # - 页面请求 302 重定向到登录页
    accept = request.headers.get("accept", "")
    if path.startswith("/api/") or "application/json" in accept:
        logger.warning(
            "unauthenticated request rejected",
            extra={"event": "authentication_required", "method": request.method, "path": path},
        )
        return JSONResponse({"detail": "未登录", "login_required": True}, status_code=401)
    return RedirectResponse(url="/login", status_code=302)


# Registered after auth_middleware so it is the outer middleware and establishes
# request context before authentication and route handling run.
app.add_middleware(RequestLoggingMiddleware)


# --- WebSocket 状态管理器 ---
# 已迁移至 app/core/ws.py，此处导入以保持原模块级名称可用。
from app.core.ws import ConnectionManager, manager

GLOBAL_LOOP = None
STORAGE_CLEANUP_TASK = None
STORAGE_CACHE_CLEANUP_TASK = None
SESSION_LAST_SEEN_TASK = None
CANVAS_TASK_RECOVERY_TASK = None
CANVAS_TASK_WORKER_TASK = None
AGENT_COMMAND_WORKER_TASK = None
WEBSOCKET_PUBSUB_TASK = None
AGENT_EVENT_PUBSUB_TASK = None
AGENT_EVENT_OUTBOX_TASK = None
APP_VERSION = "2026.05.19"
RUN_BACKGROUND_MAINTENANCE = os.getenv("RUN_BACKGROUND_MAINTENANCE", "true").strip().lower() in {"1", "true", "yes", "on"}

# 跨模块共享运行期状态：拆分出去的 service/router 通过 shared_state 访问 GLOBAL_LOOP。
import app.core.shared_state as shared_state
from app.services.storage import StorageQuotaExceeded, StorageUnavailableError, load_storage_quota_config, refresh_storage_metrics, storage_cache_cleanup_loop, storage_cleanup_loop, storage_readiness_status, verify_storage_startup, check_storage_quota
from app.services.business_metadata import archive_ai_task, initialize_business_metadata, get_comfy_workflow
from app.services.canvas_agent.skills import register_builtin_skills
from app.services.connection_secrets import initialize_connection_secrets, get_connection_secret, set_connection_secret
from app.core.database import DatabaseUnavailableError, close_database_pool, open_database_pool, refresh_database_metrics
from app.core.redis_client import RedisUnavailableError, close_redis_client, open_redis_client, redis_readiness_status
from app.core.metrics import render_metrics
from app.core.storage_io import StorageIOOverloaded, refresh_storage_io_metrics, run_storage_io
from app.core.http_client import close_http_client, get_http_client, new_outbound_http_client, open_http_client, shared_http_client
from app.core.outbound import validate_external_http_url, validate_public_http_url
from app.core.ws_pubsub import publish_websocket_event, websocket_pubsub_loop
from app.core.agent_event_pubsub import agent_event_pubsub_loop
from app.services.canvas_agent.event_bus import agent_event_outbox_loop
from app.workers.agent_commands import agent_command_worker_loop
from app.ai.gateway import connection_operation
from app.ai.database_repository import DatabaseAIRepository
from app.ai.registry import ImageGenerationRequest
from app.ai.image_registry import build_image_adapter_registry, select_target_image_adapter
from app.ai.adapters.image_protocol import extract_image, extract_task_id
from app.ai.adapters.runninghub_protocol import (
    extract_task_id as runninghub_extract_task_id,
    extract_outputs as runninghub_extract_outputs,
    output_ext as runninghub_output_ext,
    output_kind as runninghub_output_kind,
    normalized_status as runninghub_normalized_status,
    fail_reason as runninghub_fail_reason,
    extract_image as runninghub_extract_image,
    endpoint as runninghub_protocol_endpoint,
    authorization_headers as runninghub_protocol_headers,
)
from app.ai.adapters.video_protocol import (
    VIDEO_TASK_FAILURE_STATUSES,
    VIDEO_TASK_SUCCESS_STATUSES,
    humanize_video_task_failure,
    video_output_urls,
    api_root as video_protocol_api_root,
    submit_url_candidates as video_protocol_submit_urls,
    task_url_candidates as video_protocol_task_urls,
    volcengine_generation_body,
)
from app.ai.capability_runtime import CapabilityRuntime
from app.services.canvas_tasks import (
    acknowledge_canvas_task,
    claim_canvas_task,
    create_canvas_task,
    dequeue_canvas_tasks,
    dead_letter_canvas_task,
    enqueue_canvas_task,
    ensure_canvas_task_consumer_group,
    get_canvas_task,
    has_canvas_task_claim,
    list_recoverable_canvas_tasks,
    list_dead_letter_canvas_tasks,
    remove_dead_letter_canvas_task,
    reclaim_canvas_task_messages,
    release_canvas_task_claim,
    release_canvas_task_dispatch,
    refresh_canvas_task_lease,
    update_claimed_canvas_task,
    update_canvas_task,
)

@app.on_event("startup")
async def startup_event():
    global GLOBAL_LOOP, SESSION_LAST_SEEN_TASK, STORAGE_CACHE_CLEANUP_TASK, STORAGE_CLEANUP_TASK, CANVAS_TASK_RECOVERY_TASK, CANVAS_TASK_WORKER_TASK, AGENT_COMMAND_WORKER_TASK, WEBSOCKET_PUBSUB_TASK, AGENT_EVENT_PUBSUB_TASK, AGENT_EVENT_OUTBOX_TASK
    try:
        await open_database_pool()
        await open_redis_client()
        manager.set_publisher(publish_websocket_event)
        app.state.http = await open_http_client()
        await run_storage_io(verify_storage_startup)
        # Business metadata is a separate schema layer above ``files``.  Keep
        # initialization in startup so new deployments and existing databases are
        # upgraded automatically before serving requests.
        await asyncio.to_thread(initialize_business_metadata)
        await asyncio.to_thread(register_builtin_skills)
        if os.getenv("APP_SECRET_KEY"):
            await asyncio.to_thread(initialize_connection_secrets)
        await asyncio.to_thread(load_users_registry)
        await asyncio.to_thread(load_sessions)
        # Legacy Provider secrets are migrated explicitly by
        # scripts/finalize_ai_cutover.py. Startup must never attempt to write
        # the removed legacy secret table after cutover.
        await asyncio.to_thread(access_control.warm_access_control_cache)
        await asyncio.to_thread(load_storage_quota_config)
        GLOBAL_LOOP = asyncio.get_running_loop()
        shared_state.set_global_loop(GLOBAL_LOOP)
        if RUN_BACKGROUND_MAINTENANCE and STORAGE_CLEANUP_ENABLED and STORAGE_CLEANUP_TASK is None:
            STORAGE_CLEANUP_TASK = asyncio.create_task(storage_cleanup_loop())
        if RUN_BACKGROUND_MAINTENANCE and STORAGE_CACHE_CLEANUP_ENABLED and STORAGE_CACHE_CLEANUP_TASK is None:
            STORAGE_CACHE_CLEANUP_TASK = asyncio.create_task(storage_cache_cleanup_loop())
        if RUN_BACKGROUND_MAINTENANCE and SESSION_LAST_SEEN_TASK is None:
            SESSION_LAST_SEEN_TASK = asyncio.create_task(session_last_seen_flush_loop())
        if RUN_BACKGROUND_MAINTENANCE and WEBSOCKET_PUBSUB_TASK is None:
            WEBSOCKET_PUBSUB_TASK = asyncio.create_task(websocket_pubsub_loop(manager))
        if RUN_BACKGROUND_MAINTENANCE and AGENT_EVENT_PUBSUB_TASK is None:
            AGENT_EVENT_PUBSUB_TASK = asyncio.create_task(agent_event_pubsub_loop(manager))
        if RUN_BACKGROUND_MAINTENANCE and AGENT_EVENT_OUTBOX_TASK is None:
            AGENT_EVENT_OUTBOX_TASK = asyncio.create_task(agent_event_outbox_loop())
        if RUN_BACKGROUND_MAINTENANCE and AGENT_COMMAND_WORKER_ENABLED and AGENT_COMMAND_WORKER_TASK is None:
            AGENT_COMMAND_WORKER_TASK = asyncio.create_task(agent_command_worker_loop())
        # API-only replicas do not consume or recover stream messages.  Avoid
        # requiring stream ACL commands in that mode; the dedicated worker (or
        # a combined single-process deployment) initializes the group instead.
        if CANVAS_TASK_RECOVERY_ENABLED or CANVAS_TASK_WORKER_ENABLED:
            await ensure_canvas_task_consumer_group()
            if CANVAS_TASK_RECOVERY_ENABLED and CANVAS_TASK_RECOVERY_TASK is None:
                CANVAS_TASK_RECOVERY_TASK = asyncio.create_task(canvas_task_recovery_loop())
            if CANVAS_TASK_WORKER_ENABLED and CANVAS_TASK_WORKER_TASK is None:
                CANVAS_TASK_WORKER_TASK = asyncio.create_task(canvas_task_worker_loop())
        logger.info("application started", extra={"event": "application_started", "version": APP_VERSION})
    except Exception:
        await close_http_client()
        await close_redis_client()
        await close_database_pool()
        raise


@app.on_event("shutdown")
async def shutdown_event():
    global SESSION_LAST_SEEN_TASK, STORAGE_CACHE_CLEANUP_TASK, STORAGE_CLEANUP_TASK, CANVAS_TASK_RECOVERY_TASK, CANVAS_TASK_WORKER_TASK, AGENT_COMMAND_WORKER_TASK, WEBSOCKET_PUBSUB_TASK, AGENT_EVENT_PUBSUB_TASK, AGENT_EVENT_OUTBOX_TASK
    if STORAGE_CLEANUP_TASK is not None:
        STORAGE_CLEANUP_TASK.cancel()
        STORAGE_CLEANUP_TASK = None
    if STORAGE_CACHE_CLEANUP_TASK is not None:
        STORAGE_CACHE_CLEANUP_TASK.cancel()
        STORAGE_CACHE_CLEANUP_TASK = None
    if SESSION_LAST_SEEN_TASK is not None:
        SESSION_LAST_SEEN_TASK.cancel()
        SESSION_LAST_SEEN_TASK = None
    if CANVAS_TASK_RECOVERY_TASK is not None:
        CANVAS_TASK_RECOVERY_TASK.cancel()
        CANVAS_TASK_RECOVERY_TASK = None
    if CANVAS_TASK_WORKER_TASK is not None:
        CANVAS_TASK_WORKER_TASK.cancel()
        CANVAS_TASK_WORKER_TASK = None
    if AGENT_COMMAND_WORKER_TASK is not None:
        AGENT_COMMAND_WORKER_TASK.cancel()
        AGENT_COMMAND_WORKER_TASK = None
    if WEBSOCKET_PUBSUB_TASK is not None:
        WEBSOCKET_PUBSUB_TASK.cancel()
        WEBSOCKET_PUBSUB_TASK = None
    if AGENT_EVENT_PUBSUB_TASK is not None:
        AGENT_EVENT_PUBSUB_TASK.cancel()
        AGENT_EVENT_PUBSUB_TASK = None
    if AGENT_EVENT_OUTBOX_TASK is not None:
        AGENT_EVENT_OUTBOX_TASK.cancel()
        AGENT_EVENT_OUTBOX_TASK = None
    try:
        await flush_session_last_seen()
    except Exception:
        logger.exception("final session last_seen flush failed", extra={"event": "session_last_seen_final_flush_failed"})
    await close_http_client()
    await close_redis_client()
    await close_database_pool()


@app.get("/health/live", include_in_schema=False)
async def health_live():
    """Liveness probe: the ASGI process is responsive."""
    return JSONResponse(status_code=200, headers={"Cache-Control": "no-store"}, content={"status": "ok"})


@app.get("/health/ready", include_in_schema=False)
async def health_ready():
    """Readiness probe: PostgreSQL, Redis, and required MinIO buckets are reachable."""
    storage_report, redis_report = await asyncio.gather(
        run_storage_io(storage_readiness_status),
        redis_readiness_status(),
    )
    components = dict(storage_report["components"])
    components["redis"] = redis_report["component"]
    report = {"ready": storage_report["ready"] and redis_report["ready"], "components": components}
    status_code = 200 if report["ready"] else 503
    headers = {"Cache-Control": "no-store"}
    if not report["ready"]:
        headers["Retry-After"] = "5"
    return JSONResponse(
        status_code=status_code,
        headers=headers,
        content={"status": "ok" if report["ready"] else "not_ready", **report},
    )


@app.get("/metrics", include_in_schema=False)
async def prometheus_metrics():
    """Prometheus scrape endpoint for database, object storage, and background jobs."""
    refresh_storage_io_metrics()
    await asyncio.gather(
        refresh_database_metrics(),
        run_storage_io(refresh_storage_metrics),
    )
    return Response(
        content=render_metrics(),
        media_type="text/plain; version=0.0.4; charset=utf-8",
        headers={"Cache-Control": "no-store"},
    )

@app.websocket("/ws/stats")
async def websocket_endpoint(websocket: WebSocket, client_id: str = None):
    token = websocket.cookies.get(SESSION_COOKIE_NAME, "")
    try:
        session = await get_session(token) if token else None
    except RedisUnavailableError:
        await websocket.close(code=1013, reason="认证服务暂不可用")
        return
    if not session or not session.get("user_id"):
        await websocket.close(code=1008, reason="未登录")
        return
    await manager.connect(websocket, str(session["user_id"]), client_id or "")
    try:
        while True:
            data = await websocket.receive_text()
            if data == "ping":
                await websocket.send_text(json.dumps({"type": "pong"}))
    except WebSocketDisconnect:
        await manager.disconnect(websocket)
    except Exception:
        logger.exception("websocket handler failed", extra={"event": "websocket_handler_failed"})
        await manager.disconnect(websocket)

# --- 配置区域 ---
# 已迁移至 app/config.py（值完全一致），此处导入以保持原模块级名称可用。
from app.config import (
    CLIENT_ID,
    CANVAS_TASK_RECOVERY_ENABLED,
    CANVAS_TASK_WORKER_CONCURRENCY,
    CANVAS_TASK_WORKER_ENABLED,
    AGENT_COMMAND_WORKER_ENABLED,
    CANVAS_TASK_TIMEOUT_SECONDS,
    HTTP_CLIENT_TIMEOUT_POOL_SECONDS,
    REDIS_CANVAS_TASK_RECOVERY_INTERVAL_SECONDS,
    BASE_DIR,
    STATIC_DIR,
    API_ENV_FILE,
    DATA_DIR,
    LOCAL_IMAGE_IMPORT_MAX_BYTES,
    LOCAL_IMAGE_IMPORT_EXTS,
    STORAGE_CACHE_CLEANUP_ENABLED,
    STORAGE_CLEANUP_ENABLED,
    TASK_ID_LOCK,
    HISTORY_LOCK,
    GLOBAL_CONFIG_LOCK,
    FEEDBACK_LOCK,
    HELP_LOCK,
    CONVERSATION_LOCK,
    CANVAS_LOCK,
    LOAD_LOCK,
)

# --- 认证 / 会话 / 用户数据隔离 ---
# 已迁移至 app/core/auth.py，此处导入以保持原模块级名称可用。
from app.core.utils import now_ms
from app.core.auth import (
    SESSION_COOKIE_NAME,
    SESSION_MAX_AGE,
    current_user_var,
    USERS_LOCK,
    USERS,
    clean_user_id,
    load_users_registry,
    _persist_users_unlocked,
    user_exists,
    register_user,
    load_sessions,
    create_session,
    get_session,
    destroy_session,
    flush_session_last_seen,
    session_last_seen_flush_loop,
    current_user_id,
)

NEXT_TASK_ID = 1

SUPPORTED_PROVIDER_PROTOCOLS = {"openai", "gemini", "volcengine", "runninghub", "omnilojo"}
RUNNINGHUB_DEFAULT_BASE_URL = "https://www.runninghub.cn"
VOLCENGINE_DEFAULT_BASE_URL = "https://ark.cn-beijing.volces.com/api/v3"
from app.config import VOLCENGINE_DEFAULT_PROJECT_NAME, VOLCENGINE_DEFAULT_REGION
COMFYUI_INSTANCES = [normalize_comfyui_endpoint(s) for s in os.getenv("COMFYUI_INSTANCES", "127.0.0.1:8188").split(",") if s.strip()]
COMFYUI_ADDRESS = COMFYUI_INSTANCES[0]

AI_BASE_URL = os.getenv("COMFLY_BASE_URL", "https://ai.comfly.chat").rstrip("/")
AI_API_KEY = os.getenv("COMFLY_API_KEY", "")
PUBLIC_BASE_URL = os.getenv("PUBLIC_BASE_URL", "").strip().rstrip("/")
PUBLIC_MEDIA_BASE_URL = os.getenv("PUBLIC_MEDIA_BASE_URL", "").strip().rstrip("/")
CHAT_MODEL = os.getenv("CHAT_MODEL", "gpt-4o-mini")
IMAGE_MODEL = os.getenv("IMAGE_MODEL", "gpt-image-2")
SYSTEM_PROMPT = os.getenv("SYSTEM_PROMPT", "You are a helpful assistant.")
MAX_HISTORY_MESSAGES = int(os.getenv("MAX_HISTORY_MESSAGES", "30"))
CHAT_ATTACHMENT_MAX = int(os.getenv("CHAT_ATTACHMENT_MAX", "20"))
AI_REQUEST_TIMEOUT = float(os.getenv("REQUEST_TIMEOUT", "1800"))
IMAGE_POLL_INTERVAL = float(os.getenv("IMAGE_POLL_INTERVAL", "2"))
IMAGE_TASK_TIMEOUT = float(os.getenv("IMAGE_TASK_TIMEOUT", str(AI_REQUEST_TIMEOUT)))
COMFYUI_HISTORY_TIMEOUT = int(float(os.getenv("COMFYUI_HISTORY_TIMEOUT", "1800")))
VIDEO_POLL_TIMEOUT = float(os.getenv("VIDEO_POLL_TIMEOUT", "1800"))
# Worker-side polling for canvas RunningHub app tasks. Mirrors the previous
# client-side loop (360 attempts x 5s = 30 minutes).
CANVAS_RUNNINGHUB_POLL_INTERVAL_SECONDS = float(os.getenv("CANVAS_RUNNINGHUB_POLL_INTERVAL_SECONDS", "5"))
CANVAS_RUNNINGHUB_POLL_TIMEOUT_SECONDS = float(os.getenv("CANVAS_RUNNINGHUB_POLL_TIMEOUT_SECONDS", "1800"))
ONLINE_IMAGE_PROMPT_MAX_LENGTH = int(os.getenv("ONLINE_IMAGE_PROMPT_MAX_LENGTH", "20000"))
VIDEO_PROMPT_MAX_LENGTH = int(os.getenv("VIDEO_PROMPT_MAX_LENGTH", "4000"))
from app.config import ONLINE_IMAGE_PROMPT_MAX_LENGTH, VIDEO_PROMPT_MAX_LENGTH
LLM_MESSAGE_MAX_LENGTH = int(os.getenv("LLM_MESSAGE_MAX_LENGTH", "20000"))
from app.config import LLM_MESSAGE_MAX_LENGTH

FIELD_LABELS = {
    "prompt": "提示词",
    "message": "文本",
    "system_prompt": "系统提示词",
}

def friendly_validation_error(errors):
    parts = []
    for err in errors or []:
        loc = [str(item) for item in err.get("loc", []) if item != "body"]
        field = loc[-1] if loc else ""
        label = FIELD_LABELS.get(field, field or "请求参数")
        ctx = err.get("ctx") or {}
        limit = ctx.get("limit_value") or ctx.get("max_length") or ctx.get("min_length")
        err_type = str(err.get("type") or "")
        msg = str(err.get("msg") or "")
        if "max_length" in err_type or "at most" in msg:
            parts.append(f"{label}过长：当前内容超过后端上限 {limit} 个字符。请拆分为多个提示词节点，或先用 LLM 节点压缩后再生成。")
        elif "min_length" in err_type:
            parts.append(f"{label}不能为空。")
        else:
            parts.append(f"{label}格式不正确：{msg}")
    return "\n".join(parts) or "请求参数不正确。"

@app.exception_handler(RequestValidationError)
async def request_validation_exception_handler(request: Request, exc: RequestValidationError):
    return JSONResponse(
        status_code=422,
        content={"detail": friendly_validation_error(exc.errors()), "errors": exc.errors()},
    )


@app.exception_handler(StorageQuotaExceeded)
async def storage_quota_exception_handler(request: Request, exc: StorageQuotaExceeded):
    return JSONResponse(
        status_code=413,
        content={
            "detail": exc.message,
            "error": "storage_quota_exceeded",
            "quota_bytes": exc.quota_bytes,
            "used_bytes": exc.used_bytes,
            "incoming_bytes": exc.incoming_bytes,
        },
    )


@app.exception_handler(DatabaseUnavailableError)
async def database_unavailable_exception_handler(request: Request, exc: DatabaseUnavailableError):
    return JSONResponse(
        status_code=503,
        headers={"Retry-After": "3"},
        content={"detail": str(exc), "error": "database_unavailable", "retry_after_seconds": 3},
    )


@app.exception_handler(RedisUnavailableError)
async def redis_unavailable_exception_handler(request: Request, exc: RedisUnavailableError):
    return JSONResponse(
        status_code=503,
        headers={"Retry-After": "3"},
        content={"detail": str(exc), "error": "redis_unavailable", "retry_after_seconds": 3},
    )


@app.exception_handler(StorageUnavailableError)
async def storage_unavailable_exception_handler(request: Request, exc: StorageUnavailableError):
    return JSONResponse(
        status_code=503,
        headers={"Retry-After": "3"},
        content={"detail": str(exc), "error": "storage_unavailable", "retry_after_seconds": 3},
    )


@app.exception_handler(StorageIOOverloaded)
async def storage_io_overloaded_exception_handler(request: Request, exc: StorageIOOverloaded):
    return JSONResponse(
        status_code=503,
        headers={"Retry-After": "1"},
        content={"detail": str(exc), "error": "storage_overloaded", "retry_after_seconds": 1},
    )

def model_list(env_name, primary, defaults):
    configured = os.getenv(env_name, "")
    configured_values = [item.strip() for item in configured.split(",") if item.strip()]
    values = configured_values or [primary, *defaults]
    deduped = []
    for value in values:
        if value and value not in deduped:
            deduped.append(value)
    return deduped

def reload_env_globals():
    """保存 API 设置后，将 os.environ 里最新的值同步回模块级全局变量，
    避免保存后需要重启才能生效。"""
    global AI_API_KEY, AI_BASE_URL
    global IMAGE_MODELS, CHAT_MODELS, VIDEO_MODELS
    AI_API_KEY = os.getenv("COMFLY_API_KEY", "")
    AI_BASE_URL = os.getenv("COMFLY_BASE_URL", "https://ai.comfly.chat").rstrip("/")
    IMAGE_MODELS = model_list("IMAGE_MODELS", os.getenv("IMAGE_MODEL", IMAGE_MODEL), ["nano-banana-pro"])
    CHAT_MODELS = model_list("CHAT_MODELS", os.getenv("CHAT_MODEL", CHAT_MODEL), ["gpt-4o-mini", "gemini-3.1-flash-image-preview-2k"])
    VIDEO_MODELS = model_list("VIDEO_MODELS", "veo3-fast", [
        "veo2", "veo2-fast", "veo2-pro",
        "veo3", "veo3-fast", "veo3-pro",
        "veo3.1", "veo3.1-fast", "veo3.1-quality", "veo3.1-lite",
        "sora-2", "sora-2-pro",
        "wan2.6-t2v", "wan2.6-i2v",
        "wan2.5-t2v-preview", "wan2.5-i2v-preview",
        "wan2.2-t2v-plus", "wan2.2-i2v-plus", "wan2.2-i2v-flash",
        "doubao-seedance-2-0-260128",
        "doubao-seedance-2-0-fast-260128",
        "doubao-seedance-1-5-pro-251215",
        "doubao-seedance-1-0-pro-250528",
        "doubao-seedance-1-0-lite-t2v-250428",
        "doubao-seedance-1-0-lite-i2v-250428",
    ])

CHAT_MODELS = model_list("CHAT_MODELS", CHAT_MODEL, ["gpt-4o-mini", "gemini-3.1-flash-image-preview-2k"])
IMAGE_MODELS = model_list("IMAGE_MODELS", IMAGE_MODEL, ["nano-banana-pro"])
VIDEO_MODELS = model_list("VIDEO_MODELS", "veo3-fast", [
    # —— Veo 系列 ——
    "veo2", "veo2-fast", "veo2-pro",
    "veo3", "veo3-fast", "veo3-pro",
    "veo3.1", "veo3.1-fast", "veo3.1-quality", "veo3.1-lite",
    # —— Sora ——
    "sora-2", "sora-2-pro",
    # —— 阿里 通义万相 ——
    "wan2.6-t2v", "wan2.6-i2v",
    "wan2.5-t2v-preview", "wan2.5-i2v-preview",
    "wan2.2-t2v-plus", "wan2.2-i2v-plus", "wan2.2-i2v-flash",
    # —— 火山 豆包 Seedance ——
    "doubao-seedance-2-0-260128",
    "doubao-seedance-2-0-fast-260128",
    "doubao-seedance-1-5-pro-251215",
    "doubao-seedance-1-0-pro-250528",
    "doubao-seedance-1-0-lite-t2v-250428",
    "doubao-seedance-1-0-lite-i2v-250428",
])

def connection_api_key(connection_id: str) -> str:
    """Return the API key for a canonical AI connection.

    Request execution must never consult the historical provider configuration
    or legacy environment aliases. Migration tooling has its own readers.
    """
    connection_id = str(connection_id or "").strip()
    if not connection_id:
        return ""
    return get_connection_secret(connection_id, "api_key")

def _protocol_connection_id(protocol: str) -> str:
    try:
        for connection in DatabaseAIRepository().connections():
            if connection.enabled and connection.protocol == protocol:
                return connection.id
    except Exception:
        return ""
    return ""

def volcengine_access_key_value() -> str:
    return get_connection_secret(_protocol_connection_id("volcengine"), "access_key_id")

def volcengine_secret_key_value() -> str:
    return get_connection_secret(_protocol_connection_id("volcengine"), "secret_access_key")


def volcengine_provider_api_key(explicit_key: str = "") -> str:
    explicit_key = str(explicit_key or "").strip()
    if explicit_key:
        return explicit_key
    return connection_api_key(_protocol_connection_id("volcengine"))

def mask_secret(value):
    if not value:
        return ""
    tail = value[-4:] if len(value) > 4 else value
    return f"••••••••{tail}"

def strip_auth_scheme(value, scheme="Bearer"):
    text = str(value or "").strip()
    if not text:
        return ""
    pattern = rf"^{re.escape(scheme)}\s+"
    return re.sub(pattern, "", text, flags=re.I).strip()

def bearer_auth_value(value):
    token = strip_auth_scheme(value, "Bearer")
    return f"Bearer {token}" if token else ""

def connection_endpoint_url(connection, key, default_path):
    from app.ai.transport import endpoint_for_connection
    return endpoint_for_connection(connection, key, default_path, fallback_base=AI_BASE_URL)

def is_cloudwise_connection(provider) -> bool:
    """Return whether a connection targets Cloudwise's GPT Image gateway."""
    item = provider or {}
    provider_id = str(item.get("id") or "").strip().lower()
    base_url = str(item.get("base_url") or "").strip().lower()
    return provider_id == "cloudwise" or "api.cloudwise.ai" in base_url

def runninghub_endpoint_url(provider, path):
    from app.ai.transport import endpoint_for_connection
    base_url = endpoint_for_connection(provider, "endpoint", "", fallback_base=RUNNINGHUB_DEFAULT_BASE_URL).rstrip("/")
    return runninghub_protocol_endpoint(validate_public_http_url(base_url, label="Connection Base URL"), path)

import app.core.access_control as access_control

def require_admin() -> str:
    uid = current_user_id()
    if not access_control.is_admin(uid):
        raise HTTPException(status_code=403, detail="需要管理员权限。")
    return uid


def require_page_access(page_id: str, page_label: str) -> str:
    uid = current_user_id()
    if not access_control.has_page_access(uid, page_id):
        raise HTTPException(status_code=403, detail=f"需要“{page_label}”页面权限。")
    return uid


def require_user_management_access() -> str:
    return require_page_access("user-management", "用户管理")


def require_api_settings_access() -> str:
    return require_page_access("api-settings", "API 设置")


def require_target_access(target, user_id: str) -> None:
    """Authorize a resolved canonical target without consulting legacy providers."""
    connection = getattr(target, "connection", None)
    model = getattr(target, "model", None)
    connection_id = str(getattr(connection, "id", "") or "")
    upstream_model = str(getattr(model, "upstream_model", "") or "")
    if not access_control.is_admin(user_id) and not access_control.is_model_allowed(user_id, connection_id, upstream_model):
        raise HTTPException(status_code=403, detail="没有权限使用该模型，请联系管理员开放。")


def env_quote(value):
    text = str(value or "")
    if not text or re.search(r"\s|#|['\"]", text):
        return '"' + text.replace("\\", "\\\\").replace('"', '\\"') + '"'
    return text

def update_env_values(updates):
    with GLOBAL_CONFIG_LOCK:
        os.makedirs(os.path.dirname(API_ENV_FILE), exist_ok=True)
        lock_path = f"{API_ENV_FILE}.lock"
        lock_file = open(lock_path, "a+", encoding="utf-8")
        if fcntl is not None:
            fcntl.flock(lock_file.fileno(), fcntl.LOCK_EX)
        try:
            lines = []
            if os.path.exists(API_ENV_FILE):
                with open(API_ENV_FILE, "r", encoding="utf-8-sig") as f:
                    lines = f.read().splitlines()
            seen = set()
            next_lines = []
            for line in lines:
                stripped = line.strip()
                if not stripped or stripped.startswith("#") or "=" not in line:
                    next_lines.append(line)
                    continue
                key = line.split("=", 1)[0].strip()
                if key in updates:
                    next_lines.append(f"{key}={env_quote(updates[key])}")
                    os.environ[key] = str(updates[key] or "")
                    seen.add(key)
                else:
                    next_lines.append(line)
            for key, value in updates.items():
                if key not in seen:
                    next_lines.append(f"{key}={env_quote(value)}")
                    os.environ[key] = str(value or "")
            fd, tmp_path = tempfile.mkstemp(prefix=".env.", dir=os.path.dirname(API_ENV_FILE), text=True)
            try:
                with os.fdopen(fd, "w", encoding="utf-8") as f:
                    f.write("\n".join(next_lines).rstrip() + "\n")
                    f.flush()
                    os.fsync(f.fileno())
                os.chmod(tmp_path, 0o600)
                os.replace(tmp_path, API_ENV_FILE)
            finally:
                if os.path.exists(tmp_path):
                    os.unlink(tmp_path)
        finally:
            if fcntl is not None:
                fcntl.flock(lock_file.fileno(), fcntl.LOCK_UN)
            lock_file.close()

BACKEND_LOCAL_LOAD = {addr: 0 for addr in COMFYUI_INSTANCES}

os.makedirs(STATIC_DIR, exist_ok=True)

# 注意：此路由必须在 app.mount("/static", ...) 之前注册，
# 否则 StaticFiles 挂载会先匹配 /static/*.html，导致无法动态注入版本号。
# 路径模式只匹配顶层 HTML 页面（{page} 为字符串转换器，不含斜杠），
# 因此 js/css/图片/子目录等其它静态资源不会命中此路由，会继续交给下方 StaticFiles 挂载。
# 说明：Starlette 1.0 起，命中的路由内部 raise 404 不会再回退到后续 Mount，
# 所以这里必须用精确的路径模式，而不能用 {page:path} 再在函数里过滤。
@app.get("/api/version")
async def api_version():
    return Response(current_app_version(), media_type="text/plain", headers={"Cache-Control": "no-store"})

@app.get("/favicon.ico", include_in_schema=False)
async def favicon():
    logo_path = os.path.join(STATIC_DIR, "images", "logo.png")
    if os.path.isfile(logo_path):
        return FileResponse(logo_path, media_type="image/png")
    raise HTTPException(status_code=404)

@app.get("/static/{page}.html")
async def static_html_page(page: str):
    # 仅拦截顶层 HTML 页面（如 /static/angle.html），运行时动态注入版本号。
    if "/" in page:
        raise HTTPException(status_code=404)
    file_name = f"{page}.html"
    file_path = os.path.join(STATIC_DIR, file_name)
    if not os.path.isfile(file_path):
        raise HTTPException(status_code=404)
    return static_html_response(file_name)


app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")

# --- Pydantic 模型 ---

# 静态 HTML 版本号注入/页面响应 helper 已迁移至 app/routers/pages.py（原样迁移）。
# /static/{page}.html 路由仍在 main.py（与静态挂载相邻），故此处 import-back。
from app.routers.pages import (
    current_app_version,
    versioned_static_html,
    sync_static_html_versions,
    static_html_response,
)

STATIC_PROMPT_TEMPLATE_MD = os.path.join(STATIC_DIR, "system-prompts", "infinite-canvas-prompt-templates.md")
# 提示词模板解析/英文映射已迁移至 app/services/prompts.py（原样迁移）。
# 此处导入以保持原模块级名称可用（canvas smart-templates 路由仍在 main.py 使用）。
from app.services.prompts import (
    PROMPT_TEMPLATE_PATHS,
    PROMPT_TEMPLATE_EN,
    prompt_template_markdown_path,
    prompt_template_category,
    extract_prompt_template_section,
    parse_prompt_template_markdown,
)

# --- Pydantic 模型 ---
# 全部模型已迁移至 app/models/__init__.py，此处统一导入以保持原模块级名称可用。
from app.models import (
    GenerateRequest,
    DeleteHistoryRequest,
    SaveHistoryRequest,
    AIReference,
    OnlineImageRequest,
    ImageTaskQueryRequest,
    CanvasVideoRequest,
    TempShUploadRequest,
    CloudVideoUploadRequest,
    RunningHubSubmitRequest,
    RunningHubUploadAssetRequest,
    ChatRequest,
    CanvasLLMRequest,
    ConversationCreateRequest,
    CanvasCreateRequest,
    CanvasMetaUpdate,
    CanvasSaveRequest,
    CanvasAssetCheckRequest,
    CanvasAssetDownloadRequest,
    CanvasWorkflowExportRequest,
    LocalImageImportRequest,
    AssetLibraryCategoryRequest,
    AssetLibraryRequest,
    AssetLibraryAddRequest,
    AssetLibraryBatchAddRequest,
    SharedFolderRegister,
    SharedFolderImport,
    AssetLibraryRenameRequest,
    AssetLibraryBatchDeleteRequest,
    AssetLibraryBatchMoveRequest,
    AssetLibraryBatchCropRequest,
    AssetAvatarRegisterRequest,
    PromptLibraryRequest,
    PromptLibraryItemRequest,
    PromptLibraryBatchDeleteRequest,
    PromptLibraryCategoryRequest,
    LoginRequest,
    WorkflowField,
    WorkflowConfig,
    WorkflowUploadRequest,
    WorkflowRunRequest,
    ComfyInstancesPayload,
)

# --- 负载均衡 ---

def check_images_exist(backend_addr, images):
    if not images: return True
    from app.ai.adapters.comfyui_assets import ComfyUIAssetTransport
    for img in images:
        if not ComfyUIAssetTransport.input_exists(comfyui_url, backend_addr, img): return False
    return True

MEDIA_INPUT_KEYS = ("image", "video", "audio", "mask", "filename", "file")
MEDIA_OUTPUT_KEYS = {"output_filename", "filename_prefix", "save_prefix"}
MEDIA_INPUT_EXT_RE = re.compile(r"\.(png|jpe?g|webp|gif|bmp|tiff?|mp4|webm|mov|m4v|avi|mkv|mp3|wav|m4a|aac|ogg|flac)(?:\?|$)", re.I)

def is_comfy_input_media_value(input_name: str, value: Any) -> bool:
    if not isinstance(value, str) or not value.strip():
        return False
    key = str(input_name or "").lower()
    if key in MEDIA_OUTPUT_KEYS:
        return False
    if any(token in key for token in MEDIA_INPUT_KEYS):
        return True
    return bool(MEDIA_INPUT_EXT_RE.search(value))

def collect_required_comfy_media(params: Dict[str, Any]) -> List[str]:
    required = []
    for node_inputs in (params or {}).values():
        if not isinstance(node_inputs, dict):
            continue
        for input_name, value in node_inputs.items():
            if is_comfy_input_media_value(input_name, value):
                required.append(value)
    return list(dict.fromkeys(required))

def get_best_backend(required_images: List[str] = None):
    best_backend = COMFYUI_INSTANCES[0]
    min_queue_size = float('inf')
    backend_stats = {}

    for addr in COMFYUI_INSTANCES:
        try:
            from app.ai.adapters.comfyui_assets import ComfyUIAssetTransport
            remote_load = ComfyUIAssetTransport.queue_load(comfyui_url, addr)
            with LOAD_LOCK:
                local_load = BACKEND_LOCAL_LOAD.get(addr, 0)
            effective_load = max(remote_load, local_load)
            has_images = check_images_exist(addr, required_images)
            backend_stats[addr] = {"load": effective_load, "has_images": has_images}
        except Exception:
            logger.warning("ComfyUI backend unreachable", exc_info=True, extra={"event": "backend_unreachable", "provider": "comfyui", "endpoint": addr})
            continue

    if not backend_stats:
        return COMFYUI_INSTANCES[0]

    for addr, stats in backend_stats.items():
        load = stats["load"]
        if load < min_queue_size or (load == min_queue_size and stats.get("has_images") and not backend_stats.get(best_backend, {}).get("has_images")):
            min_queue_size = load
            best_backend = addr

    return best_backend

def reserve_best_backend(required_images: List[str] = None):
    backend_stats = {}
    for addr in COMFYUI_INSTANCES:
        try:
            from app.ai.adapters.comfyui_assets import ComfyUIAssetTransport
            remote_load = ComfyUIAssetTransport.queue_load(comfyui_url, addr)
            has_images = check_images_exist(addr, required_images)
            backend_stats[addr] = {"remote_load": remote_load, "has_images": has_images}
        except Exception:
            logger.warning("ComfyUI backend unreachable", exc_info=True, extra={"event": "backend_unreachable", "provider": "comfyui", "endpoint": addr})
            continue
    with LOAD_LOCK:
        best_backend = COMFYUI_INSTANCES[0]
        min_load = float('inf')
        if backend_stats:
            for addr, stats in backend_stats.items():
                load = max(stats["remote_load"], BACKEND_LOCAL_LOAD.get(addr, 0))
                if load < min_load or (load == min_load and stats.get("has_images") and not backend_stats.get(best_backend, {}).get("has_images")):
                    min_load = load
                    best_backend = addr
        BACKEND_LOCAL_LOAD[best_backend] = BACKEND_LOCAL_LOAD.get(best_backend, 0) + 1
        return best_backend

# --- 辅助工具 ---

async def _attach_quota_warning_async(response: dict) -> dict:
    """Async version — runs the DB-backed quota check in a thread with context."""
    try:
        warning = await run_storage_io(check_storage_quota, 1, category="output")
        if warning:
            response["quota_warning"] = warning
    except Exception:
        pass
    return response


def store_generated_media_bytes(payload: bytes, filename: str, kind: str, content_type: str = "") -> str:
    stored = save_media_bytes(
        "output",
        filename,
        payload,
        original_name=filename,
        content_type=content_type or content_type_for_path(filename),
        kind=kind,
        source="generated",
    )
    return stored["url"]

def comfy_output_extension(item):
    filename = str((item or {}).get("filename") or "")
    ext = os.path.splitext(filename)[1].lower()
    if ext in {
        ".png", ".jpg", ".jpeg", ".webp", ".gif", ".bmp", ".tif", ".tiff",
        ".mp4", ".webm", ".mov", ".m4v", ".avi", ".mkv",
        ".mp3", ".wav", ".m4a", ".aac", ".ogg", ".flac",
        ".txt", ".json", ".csv", ".srt", ".vtt", ".md",
        ".fbx", ".stl", ".obj", ".glb", ".gltf",
    }:
        return ext
    fmt = str((item or {}).get("format") or "").lower()
    if "mpeg" in fmt or "mp3" in fmt:
        return ".mp3"
    if "wav" in fmt or "wave" in fmt:
        return ".wav"
    if "ogg" in fmt:
        return ".ogg"
    if "flac" in fmt:
        return ".flac"
    if "text" in fmt or "plain" in fmt:
        return ".txt"
    if "json" in fmt:
        return ".json"
    if "webm" in fmt:
        return ".webm"
    if "quicktime" in fmt or "mov" in fmt:
        return ".mov"
    if "mp4" in fmt or "h264" in fmt or "video" in fmt:
        return ".mp4"
    if "fbx" in fmt:
        return ".fbx"
    return ext or ".bin"

def is_video_output_item(item):
    ext = comfy_output_extension(item)
    fmt = str((item or {}).get("format") or "").lower()
    return ext in {".mp4", ".webm", ".mov", ".m4v", ".avi", ".mkv"} or "video" in fmt

def comfy_output_kind(item):
    ext = comfy_output_extension(item)
    fmt = str((item or {}).get("format") or "").lower()
    if ext in {".png", ".jpg", ".jpeg", ".webp", ".gif", ".bmp", ".tif", ".tiff"} or "image" in fmt:
        return "image"
    if ext in {".mp4", ".webm", ".mov", ".m4v", ".avi", ".mkv"} or "video" in fmt:
        return "video"
    if ext in {".mp3", ".wav", ".m4a", ".aac", ".ogg", ".flac"} or "audio" in fmt or "sound" in fmt:
        return "audio"
    if ext in {".txt", ".json", ".csv", ".srt", ".vtt", ".md"} or "text" in fmt or "json" in fmt:
        return "text"
    return "file"

def download_comfy_output(comfy_address, item, prefix="studio_"):
    from app.ai.adapters.comfyui_assets import ComfyUIAssetTransport
    ext = comfy_output_extension(item)
    filename = f"{prefix}{uuid.uuid4().hex[:10]}{ext}"
    try:
        async def fetch():
            transport = ComfyUIAssetTransport(endpoint=comfyui_url, client=get_http_client())
            return await transport.download(comfy_address, str(item["filename"]), kind=str(item.get("type") or "output"), subfolder=str(item.get("subfolder") or ""))
        payload, content_type = asyncio.run(fetch())
        return store_generated_media_bytes(payload, filename, comfy_output_kind(item), content_type)
    except Exception:
        logger.exception("failed to download ComfyUI output", extra={"event": "comfyui_output_download_failed", "provider": "comfyui", "operation": "download"})
        raise

def download_comfy_output_by_name(comfy_address: str, comfy_filename: str, file_type: str = "output", subfolder: str = "", prefix: str = "studio_"):
    from app.ai.adapters.comfyui_assets import ComfyUIAssetTransport
    ext = os.path.splitext(str(comfy_filename or ""))[1].lower() or ".bin"
    filename = f"{prefix}{uuid.uuid4().hex[:10]}{ext}"
    async def fetch():
        transport = ComfyUIAssetTransport(endpoint=comfyui_url, client=get_http_client())
        return await transport.download(comfy_address, str(comfy_filename or ""), kind=str(file_type or "output"), subfolder=str(subfolder or ""))
    payload, content_type = asyncio.run(fetch())
    kind = "file"
    if ext in {".png", ".jpg", ".jpeg", ".webp", ".gif", ".bmp", ".tif", ".tiff"}:
        kind = "image"
    elif ext in {".mp4", ".webm", ".mov", ".m4v", ".avi", ".mkv"}:
        kind = "video"
    elif ext in {".mp3", ".wav", ".m4a", ".aac", ".ogg", ".flac"}:
        kind = "audio"
    elif ext in {".txt", ".json", ".csv", ".srt", ".vtt", ".md"}:
        kind = "text"
    return store_generated_media_bytes(payload, filename, kind, content_type)


def fetch_comfy_output_bytes_by_name(comfy_address: str, comfy_filename: str, file_type: str = "output", subfolder: str = "") -> bytes:
    from app.ai.adapters.comfyui_assets import ComfyUIAssetTransport
    async def fetch():
        transport = ComfyUIAssetTransport(endpoint=comfyui_url, client=get_http_client())
        payload, _ = await transport.download(comfy_address, str(comfy_filename or ""), kind=str(file_type or "output"), subfolder=str(subfolder or ""))
        return payload
    return asyncio.run(fetch())

def save_comfy_text_output(value, prefix="studio_", name=""):
    text = value if isinstance(value, str) else json.dumps(value, ensure_ascii=False, indent=2)
    stem = sanitize_export_filename(name or "comfy_text.txt", "comfy_text.txt")
    _, ext = os.path.splitext(stem)
    if ext.lower() not in {".txt", ".json", ".csv", ".srt", ".vtt", ".md"}:
        stem += ".txt"
    filename = f"{prefix}{uuid.uuid4().hex[:10]}_{stem}"
    return store_generated_media_bytes(text.encode("utf-8"), filename, "text", content_type_for_path(filename))

def comfy_text_values_from_output(node_output):
    values = []
    text_keys = ("text", "texts", "prompt", "prompts", "string", "strings", "caption", "captions")
    for key in text_keys:
        if key not in node_output:
            continue
        value = node_output.get(key)
        items = value if isinstance(value, list) else [value]
        for item in items:
            if isinstance(item, dict):
                text = item.get("text") or item.get("prompt") or item.get("caption") or item.get("value")
                name = item.get("filename") or item.get("name") or f"{key}.txt"
            else:
                text = item
                name = f"{key}.txt"
            if text is None:
                continue
            text = str(text)
            if text.strip():
                values.append((text, name))
    return values

def comfy_history_error_message(history_data, prompt_id: str = ""):
    status = (history_data or {}).get("status") if isinstance(history_data, dict) else {}
    if not isinstance(status, dict) or status.get("status_str") != "error":
        return ""

    for item in status.get("messages") or []:
        if not isinstance(item, (list, tuple)) or len(item) < 2 or item[0] != "execution_error":
            continue
        payload = item[1] if isinstance(item[1], dict) else {}
        node_id = payload.get("node_id") or "unknown"
        node_type = payload.get("node_type") or "unknown"
        message = str(payload.get("exception_message") or payload.get("exception_type") or "未知错误").strip()
        first_line = next((line.strip() for line in message.splitlines() if line.strip()), message)
        if len(first_line) > 500:
            first_line = first_line[:500] + "..."
        suffix = f"；prompt_id={prompt_id}" if prompt_id else ""
        return f"ComfyUI 节点 {node_id} ({node_type}) 执行失败：{first_line}{suffix}"

    suffix = f"；prompt_id={prompt_id}" if prompt_id else ""
    return f"ComfyUI 工作流执行失败{suffix}"

def collect_comfy_file_items(node_output):
    items = []
    for key, value in (node_output or {}).items():
        if key in {"text", "texts", "prompt", "prompts", "string", "strings", "caption", "captions"}:
            continue
        candidates = value if isinstance(value, list) else [value]
        for item in candidates:
            if isinstance(item, dict) and item.get("filename"):
                items.append((key, item))
    return items

# --- 历史记录数据逻辑 ---
# save_to_history / get_comfy_history 已迁移至 app/services/history.py（原样迁移）。
# 此处导入以保持原模块级名称可用（生成域多处仍在 main.py 使用）。
from app.services.history import save_to_history, get_comfy_history

# --- 用户身份解析 / 对话管理 ---
# safe_user_id 已迁移至 app/core/auth.py；
# 对话管理 helpers 与路由已迁移至 app/routers/conversations.py。
# 此处导入以保持原模块级名称可用（chat / chat_stream 仍在 main.py 使用它们）。
from app.core.auth import safe_user_id
from app.routers.conversations import (
    conversation_path,
    save_conversation,
    new_conversation,
    load_conversation,
    list_conversations,
)

def display_title(text):
    title = re.sub(r"\s+", " ", text or "").strip()
    return title[:24] or "新对话"

def api_headers(json_body=True, connection=None, model="", api_key=""):
    if connection:
        # Async gateways preload the canonical secret into the transient
        # connection view on a worker thread. Never read it again here: this
        # function runs on the event loop, where the synchronous database
        # bridge is rejected and would mask a missing key with a RuntimeError.
        api_key = str(api_key or connection.get("api_key") or "").strip()
        connection_name = connection.get("name") or connection.get("id") or "connection"
        if not api_key:
            raise HTTPException(status_code=400, detail=f"未配置 {connection_name} 的 API Key，请在 API 平台管理中填写。")
    else:
        api_key = AI_API_KEY
        if not api_key:
            raise HTTPException(status_code=400, detail="未配置 COMFLY_API_KEY，请在 API/.env 中填写。")
    from app.ai.transport import headers_for_connection
    headers = dict(headers_for_connection(connection or {"protocol": "openai", "api_key": api_key}, json_body=json_body, api_key=api_key))
    # Most AI gateways accept this standard header, while gateways that do not
    # implement idempotency safely ignore it. It is stable for an HTTP request
    # or durable canvas task, so transport retries cannot create a second job.
    headers["Idempotency-Key"] = retry_operation_id("ai")
    return headers


def selected_model(requested, fallback):
    model = (requested or fallback).strip()
    if not model:
        raise HTTPException(status_code=400, detail="模型名称不能为空")
    if len(model) > 240 or any(ord(ch) < 32 or ord(ch) == 127 for ch in model):
        raise HTTPException(status_code=400, detail=f"模型名称不合法：{model}")
    return model

def looks_like_vision_chat_model(model):
    lc = str(model or "").strip().lower()
    if not lc:
        return False
    vision_keys = [
        "vision", "vl-", "-vl-", "internvl", "qvq", "qwen-vl",
        "doubao-vision", "glm-4v", "minicpm-v",
    ]
    return any(key in lc for key in vision_keys)

def preferred_chat_model(provider):
    values = [str(item or "").strip() for item in (provider.get("chat_models") or [CHAT_MODEL])]
    models = [item for item in values if item]
    if not models:
        return CHAT_MODEL
    if is_volcengine_connection(provider):
        endpoint_models = [item for item in models if item.lower().startswith("ep-")]
        if endpoint_models:
            return endpoint_models[0]
        text_like_models = [item for item in models if not looks_like_vision_chat_model(item)]
        if text_like_models:
            return text_like_models[0]
    return models[0]

def text_from_chat_response(data):
    choices = data.get("choices") or []
    if not choices:
        return ""
    message = choices[0].get("message") or {}
    content = message.get("content", "")
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        parts = []
        for item in content:
            if isinstance(item, dict):
                parts.append(item.get("text") or item.get("content") or "")
        return "\n".join(part for part in parts if part)
    return str(content)

def text_delta_from_chat_chunk(data):
    choices = data.get("choices") or []
    if not choices:
        return ""
    delta = choices[0].get("delta") or {}
    content = delta.get("content", "")
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        parts = []
        for item in content:
            if isinstance(item, dict):
                parts.append(item.get("text") or item.get("content") or "")
        return "".join(parts)
    return str(content) if content else ""

def sse_event(data):
    return f"data: {json.dumps(data, ensure_ascii=False)}\n\n"

def images_api_unsupported(response):
    text = str(getattr(response, "text", "") or "").lower()
    return "images api is not supported" in text or "not supported for this platform" in text

def is_gemini_connection(provider):
    return str((provider or {}).get("protocol") or "").strip().lower() == "gemini"

def is_volcengine_connection(provider):
    return str((provider or {}).get("protocol") or "").strip().lower() == "volcengine"

def is_runninghub_connection(provider):
    return str((provider or {}).get("protocol") or "").strip().lower() == "runninghub" or str((provider or {}).get("id") or "").strip().lower() == "runninghub"

def is_omnilojo_connection(provider):
    # Omnilojo 通过 OpenAI v1/chat/completions 协议返回图片（图片内嵌在聊天回复里）。
    base_url = str((provider or {}).get("base_url") or "").lower()
    return str((provider or {}).get("protocol") or "").strip().lower() == "omnilojo" or "omnilojo" in base_url

# ---- 数字人/真人认证：平台无关分发 ----
# 认证是一个跨平台功能。每个平台用不同的资产 API 实现，但对外是统一入口。
# 新增平台时：在 avatar_platform_for_provider 里加一条识别，并把平台键加进
# AVATAR_SUPPORTED_PLATFORMS，再在 register/avatar-status 端点里补一个分发分支即可。
AVATAR_SUPPORTED_PLATFORMS = {"volcengine"}  # 已接入官方资产 API 的平台

def avatar_platform_for_provider(provider) -> str:
    if not provider:
        return ""
    if is_volcengine_connection(provider):
        return "volcengine"
    return ""

def extract_task_id_from_text(text):
    match = re.search(r"(?:task_id|taskId|task id)\s*[=:：]\s*([A-Za-z0-9_.:-]+)", str(text or ""), re.I)
    return match.group(1) if match else ""

def image_task_url_for_connection(connection, task_id):
    base_url = (connection.get("base_url") if connection else AI_BASE_URL).rstrip("/")
    return f"{base_url}/images/tasks/{task_id}" if base_url.endswith("/v1") else f"{base_url}/v1/images/tasks/{task_id}"

def image_task_data(payload):
    if isinstance(payload, dict) and isinstance(payload.get("data"), dict):
        return payload["data"]
    return payload if isinstance(payload, dict) else {}

def image_task_status(payload):
    task_data = image_task_data(payload)
    return str(task_data.get("status") or task_data.get("task_status") or "").upper()


IMAGE_TASK_SUCCESS_STATUSES = {"SUCCESS", "SUCCEEDED", "COMPLETED", "COMPLETE", "DONE", "FINISHED", "READY"}
IMAGE_TASK_FAILED_STATUSES = {"FAILED", "FAILURE", "ERROR", "CANCELED", "CANCELLED", "TIMEOUT", "EXPIRED"}


def log_net_error(message: str, exc: BaseException) -> None:
    """Log an upstream network failure without exposing credentials."""
    logger.warning(message, extra={"event": "upstream_network_error", "error_type": type(exc).__name__})

def image_task_fail_reason(payload):
    task_data = image_task_data(payload)
    error = task_data.get("error") if isinstance(task_data.get("error"), dict) else {}
    return task_data.get("fail_reason") or task_data.get("message") or error.get("message") or (payload.get("message") if isinstance(payload, dict) else "") or "生图任务失败"

async def fetch_image_task_payload(client, task_id, provider=None):
    response = await client.get(image_task_url_for_connection(provider, task_id), headers=api_headers(connection=provider))
    response.raise_for_status()
    return response.json()

async def wait_for_image_task(client, task_id, provider=None):
    timeout = IMAGE_TASK_TIMEOUT
    interval = IMAGE_POLL_INTERVAL
    initial_delay = 0
    deadline = time.monotonic() + timeout
    last_payload = {}
    while time.monotonic() < deadline:
        if initial_delay:
            await asyncio.sleep(min(initial_delay, max(0.0, deadline - time.monotonic())))
            initial_delay = 0
            if time.monotonic() >= deadline:
                break
        last_payload = await fetch_image_task_payload(client, task_id, provider)
        status = image_task_status(last_payload)
        if not status:
            try:
                if extract_image(last_payload):
                    return last_payload
            except HTTPException:
                pass
        if status in IMAGE_TASK_SUCCESS_STATUSES:
            return last_payload
        if status in IMAGE_TASK_FAILED_STATUSES:
            raise HTTPException(status_code=502, detail=f"生图任务失败：{image_task_fail_reason(last_payload)}")
        await asyncio.sleep(min(interval, max(0.0, deadline - time.monotonic())))
    raw_text = json.dumps(last_payload, ensure_ascii=False)[:800] if last_payload else ""
    extra = f"，最后响应：{raw_text}" if raw_text else ""
    raise HTTPException(status_code=504, detail=f"生图任务超时（已等待 {int(timeout)} 秒），task_id={task_id}{extra}")

# MinIO media references are materialized to temporary cache files only when a
# downstream API requires a filesystem path.
from app.core.media import output_file_from_url, sanitize_export_filename
from app.services.storage import save_media_bytes

# --- 媒体文件/远程下载/本地导入工具 ---
# 已迁移至 app/core/media.py（原样迁移），多域复用。此处导入以保持原模块级名称可用。
from app.core.media import (
    local_media_file_by_basename,
    filename_from_media_url,
    fetch_remote_media_bytes,
    origin_from_url,
    ensure_same_origin_request,
    normalize_local_image_path,
    import_local_image_file,
)
from app.services.storage import get_object_bytes, resolve_file_reference


def media_response_item(url: str = "", name: str = "", kind: str = "") -> Dict[str, Any]:
    item = {"url": url or "", "name": name or "", "kind": kind or ""}
    entry = resolve_file_reference(url=url) if url else None
    if entry:
        item["url"] = entry.get("url") or item["url"]
        item["file_id"] = entry.get("file_id") or ""
        item["name"] = item["name"] or entry.get("original_name") or entry.get("filename") or ""
        item["kind"] = item["kind"] or entry.get("kind") or ""
        if item["kind"] == "image":
            try:
                payload = get_object_bytes(str(entry.get("bucket") or ""), str(entry.get("object_key") or ""))
                with Image.open(BytesIO(payload)) as image:
                    item["natural_w"] = int(image.width)
                    item["natural_h"] = int(image.height)
            except Exception:
                logger.warning("failed to read media dimensions", exc_info=True, extra={"event": "media_dimensions_read_failed", "file_id": item["file_id"]})
    return item


def media_response_items(urls: List[str], kind: str = "") -> List[Dict[str, Any]]:
    return [media_response_item(url, kind=kind) for url in (urls or []) if url]

# --- 素材库数据逻辑 ---
# 已迁移至 app/services/assets.py（原样迁移），数据 CRUD 路由迁移至 app/routers/assets.py。
# avatar 注册/审核路由暂留 main.py，故此处导入以保持原模块级名称可用。
from app.services.assets import (
    default_asset_library,
    normalize_asset_library,
    migrate_asset_item_registrations,
    load_asset_library,
    sort_asset_library_items,
    asset_library_media_kind,
    asset_library_safe_extension,
    make_asset_library_item,
    save_asset_library,
    find_asset_category,
    find_asset_library,
    find_asset_category_in_library,
    find_asset_category_with_library,
    find_asset_item_in_library,
)

# --- 共享文件夹（局域网只读浏览/引用） ---
# helpers 与 6 个路由已迁移至 app/routers/shared_folders.py（原样迁移）。

# --- 提示词库数据逻辑 ---
# 已迁移至 app/services/prompts.py（原样迁移），路由迁移至 app/routers/prompts.py。
# 此处导入以保持原模块级名称可用（canvas smart-templates 仍在 main.py 使用 builtin_prompt_templates）。
from app.services.prompts import (
    builtin_prompt_templates,
    normalize_prompt_category_id,
    normalize_prompt_library_item,
    seed_system_prompt_library,
    default_prompt_libraries,
    defaultPromptTemplateCategories,
    normalize_prompt_template_categories,
    normalize_prompt_libraries,
    load_prompt_libraries,
    save_prompt_libraries,
    public_prompt_libraries,
    find_prompt_library,
)

from app.core.shared import sanitize_asset_name

# content_type_for_path 已迁移至 app/core/media.py（原样迁移），多域复用。
from app.core.media import content_type_for_path

def is_image_reference_value(value):
    if not isinstance(value, str) or not value:
        return False
    if value.startswith("data:image/"):
        return True
    if value.startswith("data:"):
        return False
    if value.startswith("/api/files/"):
        path = output_file_from_url(value)
        return bool(path and content_type_for_path(path).startswith("image/"))
    clean = value.split("?", 1)[0].lower()
    if re.search(r"\.(mp4|webm|mov|m4v|mp3|wav|m4a|aac|ogg|flac)$", clean):
        return False
    return True

def is_video_reference_value(value):
    if not isinstance(value, str) or not value:
        return False
    if value.startswith("data:video/"):
        return True
    if value.startswith("data:"):
        return False
    if value.startswith("/api/files/"):
        path = output_file_from_url(value)
        return bool(path and content_type_for_path(path).startswith("video/"))
    clean = value.split("?", 1)[0].lower()
    return bool(re.search(r"\.(mp4|webm|mov|m4v|avi|mkv)$", clean))

def convert_output_to_jpg(url, quality=88):
    path = output_file_from_url(url)
    if not path:
        return url
    _, ext = os.path.splitext(path)
    if ext.lower() in [".jpg", ".jpeg"]:
        return url
    try:
        with Image.open(path) as img:
            if img.mode in ("RGBA", "LA") or (img.mode == "P" and "transparency" in img.info):
                bg = Image.new("RGB", img.size, (255, 255, 255))
                bg.paste(img.convert("RGBA"), mask=img.convert("RGBA").split()[-1])
                img = bg
            else:
                img = img.convert("RGB")
            out = BytesIO()
            img.save(out, "JPEG", quality=quality, optimize=True)
        filename = f"converted_{uuid.uuid4().hex[:10]}.jpg"
        return store_generated_media_bytes(out.getvalue(), filename, "image", "image/jpeg")
    except Exception:
        logger.exception("failed to convert image to JPEG", extra={"event": "image_jpeg_conversion_failed"})
        return url

def reference_to_data_url(ref, max_size=None):
    """把本地输出文件转为 data URL（base64）。max_size 限制最长边像素，避免 payload 过大。"""
    value = str((ref or {}).get("url", "") or "").strip()
    path = output_file_from_url(value)
    if not path:
        # Relative app paths are only browser URLs; upstream multimodal APIs
        # require an absolute URL or data URL and cannot resolve them.
        if value.startswith("/") or (value and not value.startswith(("data:", "http://", "https://"))):
            return ""
        return value
    if max_size:
        try:
            with Image.open(path) as img:
                img.load()
                w, h = img.size
                if max(w, h) > max_size:
                    img.thumbnail((max_size, max_size), Image.LANCZOS)
                if img.mode not in ("RGB", "RGBA"):
                    img = img.convert("RGB")
                buf = BytesIO()
                fmt = "PNG" if img.mode == "RGBA" else "JPEG"
                img.save(buf, format=fmt, quality=88 if fmt == "JPEG" else None)
                encoded = base64.b64encode(buf.getvalue()).decode("ascii")
                mime = "image/png" if fmt == "PNG" else "image/jpeg"
                return f"data:{mime};base64,{encoded}"
        except Exception:
            logger.warning("reference resize failed; using original", exc_info=True, extra={"event": "reference_resize_failed"})
    with open(path, "rb") as f:
        encoded = base64.b64encode(f.read()).decode("ascii")
    return f"data:{content_type_for_path(path)};base64,{encoded}"

def media_reference_to_url(value, max_image_size=None):
    if not isinstance(value, str) or not value:
        return ""
    if value.startswith("/api/files/"):
        return reference_to_data_url({"url": value}, max_size=max_image_size)
    return value

def is_private_asset_url(value: str) -> bool:
    return isinstance(value, str) and value.strip().startswith("asset://")

def volcengine_media_reference_url(value, max_image_size=1536):
    if not isinstance(value, str):
        return ""
    value = value.strip()
    if not value:
        return ""
    if is_private_asset_url(value):
        return value
    if value.startswith("/api/files/"):
        return reference_to_data_url({"url": value}, max_size=max_image_size)
    return value

def looks_like_image_media_url(value: str) -> bool:
    text = str(value or "").strip().lower()
    if not text:
        return False
    if text.startswith("data:image/"):
        return True
    if text.startswith("asset://"):
        return False
    path = urllib.parse.urlparse(text).path or text
    return bool(re.search(r"\.(png|jpe?g|webp|gif|bmp|tiff)$", path))

def volcengine_content_role(role: str, kind: str = "image") -> Optional[str]:
    value = str(role or "").strip().lower()
    allowed = {
        "first_frame", "last_frame", "reference_image",
        "reference_video", "reference_audio", "video", "audio", "image"
    }
    if value in allowed:
        if value == "audio" and kind == "audio":
            return "reference_audio"
        return "reference_video" if value == "video" and kind == "video" else value
    if kind == "audio":
        return "reference_audio"
    if kind == "video":
        return "reference_video"
    # 修复：未显式指定 role 的纯生图请求不应兜底为 reference_image，
    # 否则火山后端会误判为 r2v(参考图生视频)，导致 seedance/seedream 等生图模型失败。
    return None

def volcengine_video_duration(duration) -> int:
    try:
        value = int(duration)
    except Exception:
        value = 5
    return max(1, min(60, value))

def volcengine_video_resolution(value: str) -> str:
    text = str(value or "").strip().lower()
    aliases = {"": "", "auto": "", "480": "480p", "720": "720p", "1080": "1080p"}
    text = aliases.get(text, text)
    return text if text in {"480p", "720p", "1080p"} else ""

def is_volcengine_seedance2_model(model: str) -> bool:
    value = str(model or "").strip().lower().replace("_", "-").replace(".", "-")
    return "seedance-2-0" in value

async def volcengine_video_reference_content_items(value, max_frames=4, max_size=768):
    text = str(value or "").strip()
    if not text:
        return []
    if is_private_asset_url(text):
        return [{
            "type": "video_url",
            "video_url": {"url": text},
            "role": "reference_video",
        }]
    frame_urls = await video_reference_to_frame_data_urls(text, max_frames=max_frames, max_size=max_size)
    return [
        {
            "type": "image_url",
            "image_url": {"url": frame_url},
            "role": "reference_image",
        }
        for frame_url in frame_urls
        if frame_url
    ]

async def video_reference_to_frame_data_urls(value, max_frames=6, max_size=768):
    if not isinstance(value, str) or not value:
        return []
    path = await run_storage_io(output_file_from_url, value)
    cleanup_path = ""
    if not path and value.startswith(("http://", "https://")):
        suffix = os.path.splitext(urllib.parse.urlparse(value).path)[1] or ".mp4"
        fd, cleanup_path = tempfile.mkstemp(prefix="canvas_llm_video_", suffix=suffix)
        os.close(fd)
        try:
            async with shared_http_client(timeout=httpx.Timeout(connect=20.0, read=120.0, write=30.0, pool=10.0)) as client:
                response = await client.get(value)
                response.raise_for_status()
                with open(cleanup_path, "wb") as f:
                    f.write(response.content)
            path = cleanup_path
        except Exception:
            logger.exception("canvas LLM video download failed", extra={"event": "canvas_llm_video_download_failed", "operation": "download"})
            if cleanup_path and os.path.exists(cleanup_path):
                try: os.remove(cleanup_path)
                except OSError: pass
            return []
    if not path or not os.path.exists(path):
        return []
    frame_dir = tempfile.mkdtemp(prefix="canvas_llm_frames_")
    try:
        ffmpeg = shutil.which("ffmpeg")
        if not ffmpeg:
            return []
        pattern = os.path.join(frame_dir, "frame_%03d.jpg")
        cmd = [
            ffmpeg, "-hide_banner", "-loglevel", "error", "-y",
            "-i", path,
            "-vf", f"fps=1,scale='min({max_size},iw)':-2",
            "-frames:v", str(max(1, max_frames)),
            pattern
        ]
        proc = await asyncio.to_thread(subprocess.run, cmd, capture_output=True, text=True, timeout=90)
        if proc.returncode != 0:
            logger.error("canvas LLM frame extraction failed", extra={"event": "canvas_llm_frame_extract_failed", "operation": "frame_extract", "error_excerpt": proc.stderr[:300]})
            return []
        frames = []
        for name in sorted(os.listdir(frame_dir)):
            if not name.lower().endswith((".jpg", ".jpeg", ".png")):
                continue
            frame_path = os.path.join(frame_dir, name)
            with open(frame_path, "rb") as f:
                frames.append(f"data:image/jpeg;base64,{base64.b64encode(f.read()).decode('ascii')}")
        return frames
    finally:
        shutil.rmtree(frame_dir, ignore_errors=True)
        if cleanup_path and os.path.exists(cleanup_path):
            try: os.remove(cleanup_path)
            except OSError: pass

def compress_data_url_image(value, max_size=1536, jpeg_quality=88):
    if not isinstance(value, str) or not value.startswith("data:image/") or ";base64," not in value:
        return value
    header, encoded = value.split(";base64,", 1)
    try:
        raw = base64.b64decode(encoded)
        with Image.open(BytesIO(raw)) as img:
            img.load()
            if max_size and max(img.size) > max_size:
                img.thumbnail((max_size, max_size), Image.LANCZOS)
            has_alpha = img.mode in ("RGBA", "LA") or (img.mode == "P" and "transparency" in img.info)
            if has_alpha:
                if img.mode != "RGBA":
                    img = img.convert("RGBA")
                fmt, mime = "PNG", "image/png"
            else:
                if img.mode != "RGB":
                    img = img.convert("RGB")
                fmt, mime = "JPEG", "image/jpeg"
            buf = BytesIO()
            if fmt == "JPEG":
                img.save(buf, format=fmt, quality=jpeg_quality, optimize=True)
            else:
                img.save(buf, format=fmt, optimize=True)
            return f"data:{mime};base64,{base64.b64encode(buf.getvalue()).decode('ascii')}"
    except Exception:
        logger.warning("data URL compression failed; using original", exc_info=True, extra={"event": "data_url_compression_failed"})
        return value

def valid_video_image_input(value: str) -> bool:
    if not isinstance(value, str):
        return False
    value = value.strip()
    return (
        value.startswith("http://") or
        value.startswith("https://") or
        value.startswith("asset://") or
        (value.startswith("data:image/") and ";base64," in value)
    )

def public_base_url() -> str:
    value = (
        os.getenv("PUBLIC_MEDIA_BASE_URL") or
        PUBLIC_MEDIA_BASE_URL or
        os.getenv("PUBLIC_BASE_URL") or
        PUBLIC_BASE_URL or
        ""
    ).strip().rstrip("/")
    if value and re.match(r"^https?://", value, re.I):
        return value
    return ""

def public_media_url_suffix() -> str:
    token = str(os.getenv("PUBLIC_MEDIA_TOKEN") or "").strip()
    return f"?token={urllib.parse.quote(token)}" if token else ""

def local_asset_public_url(value: str) -> str:
    text = str(value or "").strip()
    if not text.startswith("/api/files/"):
        return ""
    if not output_file_from_url(text):
        return ""
    base = public_base_url()
    if not base:
        return ""
    return f"{base}{urllib.parse.quote(text, safe='/:?&=%#.-_~')}{public_media_url_suffix()}"

def invalid_video_image_preview(value: str) -> str:
    text = str(value or "")
    if text.startswith("data:"):
        return text.split(";base64,", 1)[0] + ";base64,..."
    return text[:120]

# ---- 火山 Ark 私域素材资产（Assets）API：AK/SK 签名 V4 + CreateAssetGroup/CreateAsset/GetAsset ----
VOLCENGINE_ARK_ASSET_HOST = "open.volcengineapi.com"
VOLCENGINE_ARK_ASSET_SERVICE = "ark"
VOLCENGINE_ARK_ASSET_REGION = "cn-beijing"
VOLCENGINE_ARK_ASSET_VERSION = "2024-01-01"

def _volc_hmac(key: bytes, msg: str) -> bytes:
    return hmac.new(key, msg.encode("utf-8"), hashlib.sha256).digest()

def volcengine_sign_v4_headers(ak: str, sk: str, action: str, body_str: str,
                               service: str = VOLCENGINE_ARK_ASSET_SERVICE,
                               region: str = VOLCENGINE_ARK_ASSET_REGION,
                               version: str = VOLCENGINE_ARK_ASSET_VERSION,
                               host: str = VOLCENGINE_ARK_ASSET_HOST) -> Dict[str, str]:
    """火山引擎 OpenAPI 签名 V4（POST + JSON body）。返回需随请求发送的鉴权头。"""
    method = "POST"
    content_type = "application/json"
    now = datetime.datetime.now(datetime.timezone.utc)
    x_date = now.strftime("%Y%m%dT%H%M%SZ")
    short_date = x_date[:8]
    payload_hash = hashlib.sha256(body_str.encode("utf-8")).hexdigest()
    # 查询串按键排序：Action < Version
    canonical_query = f"Action={urllib.parse.quote(action, safe='')}&Version={urllib.parse.quote(version, safe='')}"
    canonical_headers = (
        f"content-type:{content_type}\n"
        f"host:{host}\n"
        f"x-content-sha256:{payload_hash}\n"
        f"x-date:{x_date}\n"
    )
    signed_headers = "content-type;host;x-content-sha256;x-date"
    canonical_request = "\n".join([method, "/", canonical_query, canonical_headers, signed_headers, payload_hash])
    algorithm = "HMAC-SHA256"
    credential_scope = f"{short_date}/{region}/{service}/request"
    string_to_sign = "\n".join([
        algorithm, x_date, credential_scope,
        hashlib.sha256(canonical_request.encode("utf-8")).hexdigest(),
    ])
    k_date = _volc_hmac(sk.encode("utf-8"), short_date)
    k_region = _volc_hmac(k_date, region)
    k_service = _volc_hmac(k_region, service)
    k_signing = _volc_hmac(k_service, "request")
    signature = hmac.new(k_signing, string_to_sign.encode("utf-8"), hashlib.sha256).hexdigest()
    authorization = (
        f"{algorithm} Credential={ak}/{credential_scope}, "
        f"SignedHeaders={signed_headers}, Signature={signature}"
    )
    return {
        "Content-Type": content_type,
        "Host": host,
        "X-Date": x_date,
        "X-Content-Sha256": payload_hash,
        "Authorization": authorization,
    }

async def volcengine_ark_asset_call(client, action: str, body: Dict[str, Any]) -> Dict[str, Any]:
    """调用一次火山 Ark Assets OpenAPI，返回 Result 内容；出错抛 HTTPException。"""
    # Secret storage is a synchronous bridge that rejects event-loop calls.
    ak = await asyncio.to_thread(volcengine_access_key_value)
    sk = await asyncio.to_thread(volcengine_secret_key_value)
    if not ak or not sk:
        raise HTTPException(status_code=400, detail="未配置火山引擎 AK/SK，请在 API 设置中填写 Access Key ID / Secret Access Key。")
    body_str = json.dumps(body, ensure_ascii=False)
    headers = volcengine_sign_v4_headers(ak, sk, action, body_str)
    url = f"https://{VOLCENGINE_ARK_ASSET_HOST}/?Action={urllib.parse.quote(action, safe='')}&Version={urllib.parse.quote(VOLCENGINE_ARK_ASSET_VERSION, safe='')}"
    resp = await client.post(url, headers=headers, content=body_str.encode("utf-8"), timeout=120)
    try:
        payload = resp.json()
    except Exception:
        raise HTTPException(status_code=502, detail=f"火山 {action} 返回非 JSON（{resp.status_code}）：{resp.text[:300]}")
    meta = payload.get("ResponseMetadata") if isinstance(payload, dict) else None
    if isinstance(meta, dict) and isinstance(meta.get("Error"), dict):
        err = meta["Error"]
        code = err.get("Code") or err.get("CodeN") or ""
        msg = err.get("Message") or ""
        raise HTTPException(status_code=502, detail=f"火山 {action} 失败：{code} {msg}".strip())
    if resp.status_code not in (200, 201):
        raise HTTPException(status_code=502, detail=f"火山 {action} 失败（{resp.status_code}）：{resp.text[:300]}")
    result = payload.get("Result") if isinstance(payload, dict) and isinstance(payload.get("Result"), dict) else None
    return result if result is not None else (payload if isinstance(payload, dict) else {})

async def volcengine_ensure_asset_group(client, project_name: str, group_name: str) -> str:
    """复用同名素材组合，没有则新建。返回 GroupId。"""
    name = (group_name or "可信素材").strip()[:60] or "可信素材"
    project_name = (project_name or "default").strip() or "default"
    # 先按 Name 模糊查找复用
    try:
        listed = await volcengine_ark_asset_call(client, "ListAssetGroups", {
            "Filter": {"Name": name, "GroupType": "AIGC"},
            "PageNumber": 1, "PageSize": 10, "ProjectName": project_name,
        })
        for item in (listed.get("Items") or []):
            if str(item.get("Name") or "").strip() == name and str(item.get("ProjectName") or "default") == project_name:
                gid = str(item.get("Id") or "").strip()
                if gid:
                    return gid
    except HTTPException:
        pass  # 查询失败不致命，继续走新建
    created = await volcengine_ark_asset_call(client, "CreateAssetGroup", {
        "Name": name, "Description": name, "ProjectName": project_name,
    })
    gid = str(created.get("Id") or "").strip()
    if not gid:
        raise HTTPException(status_code=502, detail=f"火山 CreateAssetGroup 未返回 GroupId：{str(created)[:200]}")
    return gid

def avatar_asset_type(kind: str) -> str:
    return {"video": "Video", "audio": "Audio"}.get(str(kind or "").lower(), "Image")

async def submit_volcengine_avatar_asset(public_url: str, name: str, kind: str,
                                         project_name: str = "default", group_name: str = "") -> str:
    """把公网可访问素材提交到火山 Ark 私域素材库（异步）。返回 Asset Id 作为任务 ID。"""
    async with shared_http_client(timeout=120) as client:
        group_id = await volcengine_ensure_asset_group(client, project_name, group_name)
        created = await volcengine_ark_asset_call(client, "CreateAsset", {
            "GroupId": group_id,
            "URL": public_url,
            "AssetType": avatar_asset_type(kind),
            "Name": (name or "asset")[:60],
            "ProjectName": (project_name or "default").strip() or "default",
        })
    asset_id = str(created.get("Id") or "").strip()
    if not asset_id:
        raise HTTPException(status_code=502, detail=f"火山 CreateAsset 未返回 Asset Id：{str(created)[:200]}")
    return asset_id

async def check_volcengine_avatar_task(asset_id: str, project_name: str = "default") -> Dict[str, Any]:
    """查询一次火山素材状态。返回 {status: Active/Processing/Failed, asset_uri, detail}。"""
    async with shared_http_client(timeout=60) as client:
        info = await volcengine_ark_asset_call(client, "GetAsset", {
            "Id": asset_id,
            "ProjectName": (project_name or "default").strip() or "default",
        })
    status = str(info.get("Status") or "").strip()
    if status == "Active":
        return {"status": "Active", "asset_uri": f"asset://{asset_id}", "detail": ""}
    if status == "Failed":
        return {"status": "Failed", "asset_uri": "", "detail": "火山素材处理失败，无法用于推理。"}
    return {"status": "Processing", "asset_uri": "", "detail": "火山素材处理中"}

def volcengine_public_asset_url(url: str) -> str:
    """火山 CreateAsset 要求 URL 公网可访问；本地文件需 PUBLIC_BASE_URL，否则返回 ERR:。"""
    text = str(url or "").strip()
    if text.startswith("http://") or text.startswith("https://"):
        return text
    public = local_asset_public_url(text)
    if public:
        return public
    return "ERR:火山要求素材是公网可访问的 http/https URL；本地画布文件需配置 PUBLIC_BASE_URL/PUBLIC_MEDIA_BASE_URL 暴露为公网地址。"

def local_media_path_for_cloud_upload(ref_url: str, allowed_prefixes=("image/", "video/")) -> str:
    ref_url = str(ref_url or "").strip()
    if not ref_url:
        raise HTTPException(status_code=400, detail="没有可上传的媒体文件")
    if ref_url.startswith("http://") or ref_url.startswith("https://"):
        return ""
    if not ref_url.startswith("/api/files/"):
        raise HTTPException(status_code=400, detail="云端上传只支持 MinIO 中的图片或视频文件")
    path = output_file_from_url(ref_url)
    if not path:
        raise HTTPException(status_code=404, detail="本地媒体文件不存在或已被删除")
    ct = content_type_for_path(path)
    if not any(ct.startswith(prefix) for prefix in allowed_prefixes):
        raise HTTPException(status_code=400, detail="请选择图片或视频文件再上传云端")
    max_bytes = int(os.getenv("TEMP_SH_MAX_BYTES", str(4 * 1024 * 1024 * 1024)))
    size = os.path.getsize(path)
    if size > max_bytes:
        raise HTTPException(status_code=400, detail=f"媒体文件超过云端上传大小限制：{size} bytes")
    return path

def local_video_path_for_cloud_upload(ref_url: str) -> str:
    return local_media_path_for_cloud_upload(ref_url, ("video/",))

async def upload_video_to_litterbox(path: str, source_url: str) -> Dict[str, str]:
    upload_url = os.getenv("LITTERBOX_UPLOAD_URL", "https://litterbox.catbox.moe/resources/internals/api.php").strip() or "https://litterbox.catbox.moe/resources/internals/api.php"
    time_value = os.getenv("LITTERBOX_TIME", "72h").strip() or "72h"
    ct = content_type_for_path(path)
    try:
        async with shared_http_client(timeout=httpx.Timeout(connect=20.0, read=600.0, write=600.0, pool=20.0)) as client:
            with open(path, "rb") as fh:
                files = {"fileToUpload": (os.path.basename(path), fh, ct)}
                data = {"reqtype": "fileupload", "time": time_value}
                response = await client.post(upload_url, data=data, files=files)
        if not response.is_success:
            raise HTTPException(status_code=response.status_code, detail=f"Litterbox 上传失败：{response.text[:300]}")
        direct_url = response.text.strip().splitlines()[0].strip()
        if not re.match(r"^https?://", direct_url, re.I):
            raise HTTPException(status_code=502, detail=f"Litterbox 返回了无法识别的链接：{response.text[:300]}")
        return {"url": direct_url, "source": source_url, "name": os.path.basename(path), "expires": time_value, "service": "litterbox"}
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Litterbox 上传异常：{exc}") from exc

async def upload_video_to_temp_sh(path: str, source_url: str) -> Dict[str, str]:
    upload_url = os.getenv("TEMP_SH_UPLOAD_URL", "https://temp.sh/upload").strip() or "https://temp.sh/upload"
    ct = content_type_for_path(path)
    try:
        async with shared_http_client(timeout=httpx.Timeout(connect=20.0, read=600.0, write=600.0, pool=20.0)) as client:
            with open(path, "rb") as fh:
                files = {"file": (os.path.basename(path), fh, ct)}
                response = await client.post(upload_url, files=files)
        if not response.is_success:
            raise HTTPException(status_code=response.status_code, detail=f"Temp.sh 上传失败：{response.text[:300]}")
        direct_url = response.text.strip().splitlines()[0].strip()
        if not re.match(r"^https?://", direct_url, re.I):
            raise HTTPException(status_code=502, detail=f"Temp.sh 返回了无法识别的链接：{response.text[:300]}")
        return {"url": direct_url, "source": source_url, "name": os.path.basename(path), "expires": "3 days", "service": "temp.sh"}
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Temp.sh 上传异常：{exc}") from exc

async def upload_local_video_to_cloud(ref_url: str, service: str = "auto") -> Dict[str, str]:
    ref_url = str(ref_url or "").strip()
    if ref_url.startswith("http://") or ref_url.startswith("https://"):
        return {"url": ref_url, "source": ref_url, "service": "existing"}
    path = await run_storage_io(local_media_path_for_cloud_upload, ref_url)
    service = str(service or os.getenv("CLOUD_VIDEO_UPLOAD_SERVICE", "auto") or "auto").strip().lower()
    if service in {"litterbox", "catbox"}:
        return await upload_video_to_litterbox(path, ref_url)
    if service in {"temp", "temp.sh", "tempsh"}:
        return await upload_video_to_temp_sh(path, ref_url)
    errors = []
    for name, func in (("litterbox", upload_video_to_litterbox), ("temp.sh", upload_video_to_temp_sh)):
        try:
            return await func(path, ref_url)
        except HTTPException as exc:
            errors.append(f"{name}: {exc.detail}")
    raise HTTPException(status_code=502, detail="云端上传失败：" + "；".join(errors))

async def upload_local_video_to_temp_sh(ref_url: str) -> Dict[str, str]:
    return await upload_local_video_to_cloud(ref_url, "auto")

# save_ai_image_to_output / save_remote_video_to_output 已迁移至 app/core/media.py（原样迁移）。
from app.core.media import save_ai_image_to_output, save_remote_video_to_output

def parse_size_pair(size):
    match = re.fullmatch(r"\s*(\d+)\s*[xX*]\s*(\d+)\s*", str(size or ""))
    if not match:
        return 0, 0
    return int(match.group(1)), int(match.group(2))

def chat_system_prompt(payload):
    """Resolve the per-request system prompt with the application fallback."""
    prompt = str(getattr(payload, "system_prompt", "") or "").strip()
    return prompt or SYSTEM_PROMPT

def snap_size_to_multiple(size, multiple=16):
    width, height = parse_size_pair(size)
    if not width or not height:
        return size
    step = max(1, int(multiple or 16))
    return f"{max(step, math.ceil(width / step) * step)}x{max(step, math.ceil(height / step) * step)}"

CHAT_RATIO_SIZE_OPTIONS = {
    "1:1": ("1024x1024", "1536x1536", "2048x2048"), "2:3": ("720x1080", "1024x1536", "1365x2048"),
    "3:2": ("1080x720", "1536x1024", "2048x1365"), "3:4": ("1008x1344", "1536x2048", "2448x3264"),
    "4:3": ("1344x1008", "2048x1536", "3264x2448"), "9:16": ("720x1280", "1080x1920", "1440x2560"),
    "16:9": ("1280x720", "1920x1080", "2560x1440"),
}

def chat_prompt_size_override(message, current_size=""):
    text = str(message or "")
    direct = re.search(r"(?<!\d)([1-9]\d{2,4})\s*[xX×*]\s*([1-9]\d{2,4})(?!\d)", text)
    if direct:
        width, height = int(direct.group(1)), int(direct.group(2))
        if width >= 256 and height >= 256:
            return f"{width}x{height}"
    normalized = text.replace("：", ":").replace("比", ":").replace("／", "/").replace("/", ":")
    match = re.search(r"(?<!\d)(1|2|3|4|9|16)\s*:\s*(1|2|3|4|9|16)(?!\d)", normalized)
    if not match:
        return ""
    options = CHAT_RATIO_SIZE_OPTIONS.get(f"{int(match.group(1))}:{int(match.group(2))}")
    if not options:
        return ""
    if re.search(r"(?i)\b4\s*k\b|超清|超高分辨率", text):
        return options[-1]
    if re.search(r"(?i)\b2\s*k\b|高清|高分辨率", text):
        return options[1]
    return options[0]

GPT_IMAGE2_MAX_EDGE = 3840
GPT_IMAGE2_MAX_PIXELS = 8_294_400
GPT_IMAGE2_MIN_PIXELS = 655_360

def is_gpt_image_2_model(model):
    raw = str(model or "").strip().lower()
    normalized = re.sub(r"[^a-z0-9]+", "-", raw).strip("-")
    compact = re.sub(r"[^a-z0-9]+", "", raw)
    return (
        normalized == "gpt-image-2"
        or normalized.startswith("gpt-image-2-")
        or normalized.endswith("-gpt-image-2")
        or "-gpt-image-2-" in normalized
        or compact == "gptimage2"
        or compact.startswith("gptimage2")
        or compact.endswith("gptimage2")
    )

def normalize_gpt_image_2_size(size):
    width, height = parse_size_pair(size)
    if not width or not height:
        return size or "auto"
    if width == height and (width > 2048 or width * height > 4_194_304):
        return "3840x2160"
    ratio = width / height
    if ratio > 3:
        width = height * 3
    elif ratio < 1 / 3:
        height = width * 3
    scale = min(
        1.0,
        GPT_IMAGE2_MAX_EDGE / max(width, height),
        (GPT_IMAGE2_MAX_PIXELS / max(1, width * height)) ** 0.5,
    )
    width = max(16, int((width * scale) // 16) * 16)
    height = max(16, int((height * scale) // 16) * 16)
    if width * height < GPT_IMAGE2_MIN_PIXELS:
        grow = (GPT_IMAGE2_MIN_PIXELS / max(1, width * height)) ** 0.5
        width = int((width * grow + 15) // 16) * 16
        height = int((height * grow + 15) // 16) * 16
    return f"{width}x{height}"

def gpt_image_2_size_error_message(size):
    width, height = parse_size_pair(size)
    display_size = size or "未指定"
    if width == 4096 and height == 4096:
        return (
            "GPT-Image-2 不支持 4K 1:1 的 4096x4096。"
            "如果需要输出 4096x4096，请切换到 nano-banana；"
            "如果继续使用 GPT，请改成 2K 或长边不超过 3840、总像素不超过约 829 万的尺寸。"
        )
    if width and height and (max(width, height) > GPT_IMAGE2_MAX_EDGE or width * height > GPT_IMAGE2_MAX_PIXELS):
        return (
            f"GPT-Image-2 不支持当前尺寸 {display_size}。"
            "该尺寸超过 GPT 支持范围；如果要保留这个高分辨率，请切换到 nano-banana，"
            "或把 GPT 尺寸改成 2K / 3840x2160 / 2160x3840 这类更小规格。"
        )
    return (
        f"GPT-Image-2 不支持当前尺寸 {display_size}。"
        "请换成 GPT 支持的分辨率，或切换到 nano-banana 生成更高分辨率。"
    )

def gpt_image_2_size_exceeds_supported(size):
    width, height = parse_size_pair(size)
    return bool(width and height and (max(width, height) > GPT_IMAGE2_MAX_EDGE or width * height > GPT_IMAGE2_MAX_PIXELS))

VOLCENGINE_MAX_EDGE = 4096
VOLCENGINE_MIN_PIXELS = 262144
VOLCENGINE_MIN_EDGE = 256
VOLCENGINE_RATIO_CHOICES = [
    (1, 1, "1:1"),
    (4, 3, "4:3"),
    (3, 4, "3:4"),
    (16, 9, "16:9"),
    (9, 16, "9:16"),
    (21, 9, "21:9"),
    (9, 21, "9:21"),
    (3, 2, "3:2"),
    (2, 3, "2:3"),
    (5, 4, "5:4"),
    (4, 5, "4:5"),
]

def is_volcengine_seedream_model(model):
    value = str(model or "").strip().lower()
    return "seedream" in value or "doubao-seedream" in value

def normalize_volcengine_size(size, model=""):
    width, height = parse_size_pair(size)
    raw = str(size or "").strip().lower()
    if not width or not height:
        if raw == "4k":
            return "4096x4096"
        if raw == "2k":
            return "2048x2048"
        return "2048x2048" if is_volcengine_seedream_model(model) else (size or "1024x1024")
    if not is_volcengine_seedream_model(model):
        return f"{width}x{height}"
    ratio = width / max(1, height)
    best_ratio = min(VOLCENGINE_RATIO_CHOICES, key=lambda item: abs(ratio - item[0] / item[1]))
    rw, rh = best_ratio[0], best_ratio[1]
    scale = max(
        (VOLCENGINE_MIN_PIXELS / max(1, rw * rh)) ** 0.5,
        VOLCENGINE_MIN_EDGE / max(1, min(rw, rh)),
    )
    target_w = rw * scale
    target_h = rh * scale
    cap = min(1.0, VOLCENGINE_MAX_EDGE / max(target_w, target_h))
    target_w *= cap
    target_h *= cap
    snapped_w = max(64, int(target_w // 16) * 16)
    snapped_h = max(64, int(target_h // 16) * 16)
    while snapped_w * snapped_h < VOLCENGINE_MIN_PIXELS:
        if snapped_w <= snapped_h:
            snapped_w += 16
        else:
            snapped_h += 16
        if max(snapped_w, snapped_h) > VOLCENGINE_MAX_EDGE:
            break
    return f"{snapped_w}x{snapped_h}"

def friendly_image_error_detail(text, size="", model=""):
    text = str(text or "")
    lower_text = text.lower()
    if is_gpt_image_2_model(model) and gpt_image_2_size_exceeds_supported(size):
        return gpt_image_2_size_error_message(size)
    mentions_size = any(token in lower_text for token in ["size", "resolution", "dimension"])
    is_gpt_size_error = is_gpt_image_2_model(model) and mentions_size and (
        "invalid" in lower_text
        or "unsupported" in lower_text
        or "not supported" in lower_text
        or "exceed" in lower_text
        or "must be one of" in lower_text
    )
    m = re.search(r"longest edge must be less than or equal to (\d+)", text)
    if m and is_gpt_image_2_model(model):
        limit = m.group(1)
        return f"GPT-Image-2 不支持当前尺寸 {size or '未指定'}：最长边超过 {limit}px。如果需要更高分辨率，请切换到 nano-banana；继续使用 GPT 时请调低分辨率。"
    if m:
        limit = m.group(1)
        return f"该模型不支持当前分辨率：最长边超过 {limit}px。请把图片分辨率调低（例如换到 2K 或更小），或更换支持高分辨率的模型。"
    if "image size must be at least" in lower_text:
        pixel_match = re.search(r"at least (\d+) pixels", lower_text)
        pixels = pixel_match.group(1) if pixel_match else "3686400"
        return f"该模型要求更高分辨率，当前尺寸 {size or '过小'} 不满足最低像素要求（至少 {pixels} 像素）。火山 Seedream 5.0 建议从 2K 起步。"
    if is_gpt_size_error or (("invalid size" in lower_text or "invalid_value" in lower_text) and is_gpt_image_2_model(model)):
        return gpt_image_2_size_error_message(size)
    if "invalid size" in lower_text or "invalid_value" in lower_text:
        return f"该模型不支持当前尺寸：{size or '未指定'}。请尝试更换分辨率或模型。"
    if "inputtextsensitivecontentdetected" in lower_text or "policyviolation" in lower_text or "copyright restrictions" in lower_text:
        return "上游内容安全拦截了这段提示词，原因偏向版权/敏感内容限制。请改写提示词，避免直接出现具体 IP、角色名、品牌名、影视/动漫作品名，改成风格特征描述再试。"
    if "rejected by the safety system" in lower_text or "image_generation_user_error" in lower_text or "safety system" in lower_text or "content_policy_violation" in lower_text or "content policy" in lower_text:
        return "上游（Azure/OpenAI 系）内容安全系统拒绝了本次生图请求。可能是提示词或参考图触发了内容审核。请改写提示词、避免敏感/暴力/成人/名人/版权角色等描述；若使用了人物参考图，可换一张图再试。这是上游平台的审核策略，并非本系统报错。"
    if "rate limit" in lower_text or "429" in lower_text:
        return "请求过于频繁，已被上游限流，请稍后再试。"
    if "unauthorized" in lower_text or "401" in lower_text:
        return "API Key 无效或已过期，请到「API 设置」检查 Key。"
    if "model_not_found" in lower_text or "channel not found" in lower_text:
        return f"上游平台找不到模型「{model}」可用通道。可能该模型未在此账号开通，请换一个已开通的模型。"
    return ""

def parse_error_payload_text(text):
    body = str(text or "").strip()
    if not body:
        return {}
    try:
        parsed = json.loads(body)
    except Exception:
        return {}
    return parsed if isinstance(parsed, dict) else {}

def friendly_chat_error_detail(text, model="", provider=None):
    raw_text = str(text or "")
    lower_text = raw_text.lower()
    payload = parse_error_payload_text(raw_text)
    error = payload.get("error") if isinstance(payload.get("error"), dict) else {}
    code = str(error.get("code") or payload.get("code") or "").strip()
    message = str(error.get("message") or payload.get("message") or "").strip()
    code_lc = code.lower()
    message_lc = message.lower()
    model_name = str(model or "").strip()

    if is_volcengine_connection(provider):
        if code_lc in {"invalidendpointormodel.notfound", "invalidendpointormodel.modelidaccessdisabled"}:
            provider_name = provider.get("id") or "火山方舟"
            return (
                f"{provider_name} 当前不接受模型名「{model_name or '未指定'}」直接调用聊天接口，"
                f"请在火山方舟控制台创建并使用推理接入点 ID（形如 `ep-...`）作为聊天模型。\n\n"
                f"补充说明：`/api/v3/models` 能拉到公开模型列表，但你的账号未必能直接用这些模型名调用 `/chat/completions`；"
                f"很多账号只允许传自己已开通的 `ep-...` 接入点。"
            )
        if "does not exist or you do not have access to it" in message_lc:
            return (
                f"火山方舟找不到或无权访问聊天模型「{model_name or '未指定'}」。"
                f"如果你现在填的是模型名，请改成已开通的推理接入点 ID（`ep-...`）；"
                f"如果已经是 `ep-...`，请检查这个接入点是否绑定了聊天模型、区域是否正确、以及账号是否有调用权限。"
            )
    if "unauthorized" in lower_text or "401" in lower_text:
        return "API Key 无效或已过期，请到「API 设置」检查 Key。"
    if "rate limit" in lower_text or "429" in lower_text:
        return "请求过于频繁，已被上游限流，请稍后再试。"
    return ""

# ---- RunningHub task protocol helpers ----
def runninghub_connection():
    from app.ai.database_repository import DatabaseAIRepository
    try:
        target = next(
            item for item in DatabaseAIRepository().connections()
            if item.enabled and item.protocol == "runninghub"
        )
    except StopIteration as exc:
        raise HTTPException(status_code=400, detail="未配置或已禁用 RunningHub 连接") from exc
    return canonical_connection_view(target)

def runninghub_api_key(provider):
    # Async generation preloads the canonical secret into the transient
    # provider view. Reuse it so adapters never cross the sync DB bridge from
    # an event-loop task.
    key = str((provider or {}).get("api_key") or "").strip() or connection_api_key((provider or {}).get("connection_id") or (provider or {}).get("id"))
    if not key:
        raise HTTPException(status_code=400, detail="未配置 RunningHub API Key，请在 API 设置中填写。")
    return key

async def runninghub_api_key_async(provider):
    """Read RunningHub credentials without blocking the ASGI event loop."""
    try:
        key = await asyncio.to_thread(runninghub_api_key, provider)
    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail="AI 密钥存储暂不可用，请稍后重试。") from exc
    if not key:
        raise HTTPException(status_code=400, detail="未配置 RunningHub API Key，请在 API 设置中填写。")
    return key

async def wait_for_runninghub_image_task(client, provider, task_id):
    from app.ai.adapters.runninghub_transport import RunningHubTransport
    key = await runninghub_api_key_async(provider)
    transport = RunningHubTransport(endpoint=runninghub_endpoint_url, headers=lambda api_key, body: runninghub_protocol_headers(api_key, json_body=body), client_factory=shared_http_client, timeout=httpx.Timeout(connect=20.0, read=240.0, write=30.0, pool=20.0))
    return await transport.poll(client, provider, key, task_id, timeout=IMAGE_TASK_TIMEOUT, interval=IMAGE_POLL_INTERVAL, status=runninghub_normalized_status, outputs=runninghub_extract_outputs, failure=runninghub_fail_reason)

def runninghub_local_asset_path(source_url):
    return output_file_from_url(source_url)

async def runninghub_store_remote_output(client, remote):
    response = await client.get(validate_external_http_url(remote, label="RunningHub 输出地址")); response.raise_for_status()
    filename = os.path.basename(urllib.parse.urlsplit(remote).path) or f"runninghub.{runninghub_output_ext(remote) or 'bin'}"
    saved = await run_storage_io(save_media_bytes, "output", filename, response.content, original_name=filename, content_type=response.headers.get("content-type") or "", kind=runninghub_output_kind(runninghub_output_ext(remote)), source="generated")
    return saved["url"]

async def generate_omnilojo_image(prompt, size, model, reference_images=None, provider=None):
    from app.ai.adapters.omnilojo import OmnilojoImageAdapter

    connection = provider or {}
    adapter = OmnilojoImageAdapter(
        endpoint=lambda value: connection_endpoint_url(value, "image_generation_endpoint", "/v1/chat/completions"),
        headers=lambda value, upstream_model: api_headers(connection=value, model=upstream_model),
        resolve_reference=lambda reference: run_storage_io(reference_to_data_url, reference, 1536),
        client_factory=shared_http_client,
        image_options=lambda requested_size: {
            "aspect_ratio": gemini_image_options(requested_size)["aspectRatio"],
            "image_size": gemini_image_options(requested_size)["imageSize"],
        },
        timeout=httpx.Timeout(connect=20.0, read=1800.0, write=120.0, pool=HTTP_CLIENT_TIMEOUT_POOL_SECONDS),
    )
    return await adapter.generate(ImageGenerationRequest(
        prompt=prompt,
        size=size,
        quality="",
        model=model,
        reference_images=list(reference_images or []),
        connection=connection,
    ))

async def generate_openai_image(prompt, size, quality, model, reference_images=None, provider=None):
    from app.ai.adapters.openai_images import OpenAIImagesExecutor
    connection = provider or {}
    executor = OpenAIImagesExecutor(
        endpoint=lambda value, setting, fallback: connection_endpoint_url(value, setting, fallback),
        headers=api_headers,
        api_key=lambda connection_id: asyncio.to_thread(connection_api_key, connection_id),
        resolve_file=lambda value: run_storage_io(output_file_from_url, value),
        to_data_url=lambda value: run_storage_io(reference_to_data_url, value, 1536),
        content_type=content_type_for_path,
        is_cloudwise=is_cloudwise_connection,
        unsupported=images_api_unsupported,
        wait_task=lambda client, task_id, target: wait_for_image_task(client, task_id, target),
        client_factory=shared_http_client,
        timeout=AI_REQUEST_TIMEOUT,
        long_timeout=httpx.Timeout(connect=20.0, read=1800.0, write=120.0, pool=HTTP_CLIENT_TIMEOUT_POOL_SECONDS),
    )
    target = SimpleNamespace(connection=SimpleNamespace(id=connection.get("connection_id") or connection.get("id") or "", base_url=connection.get("base_url") or "", settings=connection), model=SimpleNamespace(id="", upstream_model=model), resource=None)
    return await executor.generate(ImageGenerationRequest(prompt=prompt, size=size, quality=quality, model=model, reference_images=list(reference_images or []), connection=connection, target=target))

async def generate_gemini_image(prompt, size, model, reference_images=None, provider=None):
    """Generate an image through Gemini's OpenAI-compatible chat facade."""
    from app.ai.adapters.omnilojo import OmnilojoImageAdapter

    adapter = OmnilojoImageAdapter(
        endpoint=lambda value: connection_endpoint_url(value, "image_generation_endpoint", "/v1beta/chat/completions"),
        headers=lambda value, upstream_model: api_headers(connection=value, model=upstream_model),
        resolve_reference=lambda reference: run_storage_io(reference_to_data_url, reference, 1536),
        client_factory=shared_http_client,
        image_options=lambda requested_size: {
            "aspect_ratio": gemini_image_options(requested_size)["aspectRatio"],
            "image_size": gemini_image_options(requested_size)["imageSize"],
        },
        timeout=httpx.Timeout(connect=20.0, read=1800.0, write=120.0, pool=HTTP_CLIENT_TIMEOUT_POOL_SECONDS),
    )
    return await adapter.generate(ImageGenerationRequest(
        prompt=prompt, size=size, quality="", model=model,
        reference_images=list(reference_images or []), connection=provider or {},
    ))


async def generate_volcengine_image(prompt, size, model, reference_images=None, provider=None):
    """Generate an image through Volcengine's OpenAI Images-compatible API."""
    return await generate_openai_image(
        prompt, normalize_volcengine_size(size, model), "", model,
        reference_images, provider,
    )


async def _image_adapter_runninghub(request: ImageGenerationRequest):
    from app.ai.adapters.runninghub_app import RunningHubImageAdapter

    def extract_task(payload):
        return runninghub_extract_task_id(payload)

    async def poll(client, connection, task_id):
        return await wait_for_runninghub_image_task(client, {**connection, "api_key": preloaded_key}, task_id)

    # The gateway preloads the canonical secret on a worker thread. Adapters run
    # on the event loop, where the synchronous secret bridge is rejected, so the
    # key must be threaded through instead of re-read per request.
    preloaded_key = str((request.connection or {}).get("api_key") or "").strip()
    if not preloaded_key:
        raise HTTPException(status_code=400, detail="未配置 RunningHub API Key，请在 API 设置中填写。")
    adapter = RunningHubImageAdapter(
        submit_url=lambda value: runninghub_endpoint_url(value, "/task/openapi/ai-app/run"),
        headers=lambda value: runninghub_protocol_headers(preloaded_key, json_body=True),
        api_key=lambda value: preloaded_key,
        client_factory=shared_http_client,
        extract_task_id=extract_task,
        poll=poll,
        extract_image=runninghub_extract_image,
        timeout=httpx.Timeout(connect=20.0, read=1800.0, write=180.0, pool=20.0),
    )
    if request.target is None:
        raise ValueError("RunningHub image request requires a resolved target")
    return await adapter.generate(request.target, prompt=request.prompt, model=request.model, references=request.reference_images)


async def _image_adapter_omnilojo(request: ImageGenerationRequest):
    return await generate_omnilojo_image(
        request.prompt, request.size, request.model, request.reference_images, request.connection,
    )


async def _image_adapter_gemini(request: ImageGenerationRequest):
    return await generate_gemini_image(
        request.prompt, request.size, request.model, request.reference_images, request.connection,
    )


async def _image_adapter_volcengine(request: ImageGenerationRequest):
    return await generate_volcengine_image(
        request.prompt, request.size, request.model, request.reference_images, request.connection,
    )


async def _image_adapter_openai(request: ImageGenerationRequest):
    return await generate_openai_image(
        request.prompt, request.size, request.quality, request.model, request.reference_images, request.connection,
    )


IMAGE_ADAPTERS = build_image_adapter_registry({
    "runninghub": _image_adapter_runninghub,
    "omnilojo": _image_adapter_omnilojo,
    "gemini": _image_adapter_gemini,
    "volcengine": _image_adapter_volcengine,
    "openai": _image_adapter_openai,
})


def canonical_connection_view(target) -> dict[str, Any]:
    """Expose only transport metadata for a resolved canonical target."""
    connection = getattr(target, "connection", target)
    protocol = getattr(target, "protocol", None) or connection.protocol
    return {
        "id": connection.id,
        "connection_id": connection.id,
        "name": connection.name,
        "protocol": protocol,
        "base_url": connection.base_url,
        **dict(connection.settings or {}),
    }


async def generate_ai_image_target(target, *, prompt: str, size: str, quality: str, reference_images=None, user_id: str = ""):
    """Execute image generation from an authoritative resolved target."""
    from app.ai.contracts import Actor, ImageCommand
    from app.ai.images import ImageGateway

    runtime_provider = canonical_connection_view(target)
    # Secret storage is synchronous for legacy compatibility. Load it once on
    # a worker thread and pass the value through the async adapter pipeline.
    runtime_provider["api_key"] = await asyncio.to_thread(connection_api_key, target.connection.id)

    async def dispatch(command):
        model = command.target.model.upstream_model if command.target.model else ""
        return await IMAGE_ADAPTERS.dispatch(
            select_target_image_adapter(command.target),
            ImageGenerationRequest(
                prompt=command.prompt,
                size=command.size,
                quality=command.quality,
                model=model,
                reference_images=list(command.references),
                connection=runtime_provider,
                target=command.target,
            ),
        )

    gateway = ImageGateway(
        registry=IMAGE_ADAPTERS,
        target_handler=dispatch,
    )
    return await gateway.generate_target(
        ImageCommand(
            target=target,
            prompt=prompt,
            size=size,
            quality=quality,
            references=list(reference_images or []),
        ),
        actor=Actor(user_id=user_id or current_user_id()),
    )


async def assert_provider_budget_available(provider, user_id):
    if not (is_runninghub_connection(provider) or is_omnilojo_connection(provider)):
        return
    from app.services.usage import assert_runninghub_budget_available
    try:
        await asyncio.to_thread(assert_runninghub_budget_available, user_id)
    except ValueError as exc:
        raise HTTPException(
            status_code=429,
            detail={
                "error_code": "usage_budget_exceeded",
                "message": str(exc),
                "contact_admin": True,
            },
        ) from None

def upstream_message_from_record(item):
    role = item.get("role")
    if role not in {"user", "assistant"} or item.get("type") == "image":
        return None
    refs = item.get("attachments") or []
    if refs and role == "user":
        content = [{"type": "text", "text": item.get("content", "")}]
        for ref in refs[:4]:
            url = reference_to_data_url(ref)
            if url:
                content.append({"type": "image_url", "image_url": {"url": url}})
        return {"role": role, "content": content}
    return {"role": role, "content": item.get("content", "")}

# --- Agent 意图路由与工具编排 ---

AGENT_ACTIONS = {"chat", "generate_image", "edit_image"}
AGENT_IMAGE_KEYWORDS = ("生成", "画", "出图", "生图", "图片", "图像", "海报", "头像", "壁纸", "插画", "照片", "photo", "image", "picture", "draw", "generate")
AGENT_EDIT_KEYWORDS = ("修改", "改成", "换成", "调整", "优化", "编辑", "重绘", "上一张", "刚才", "这张", "那张", "参考图", "改图", "edit", "modify", "change", "revise")
CN_NUMERAL_MAP = {"一": 1, "二": 2, "两": 2, "俩": 2, "三": 3, "四": 4}

def image_references(refs):
    return [ref for ref in (refs or []) if isinstance(ref, dict) and ref.get("url")]

def latest_chat_image_refs(conversation, limit=1):
    refs = []
    for item in reversed(conversation.get("messages") or []):
        if isinstance(item, dict) and item.get("image_url"):
            refs.append({"url": item["image_url"], "name": item.get("content") or "上一张图片", "role": "source"})
        if len(refs) >= limit:
            break
    return refs

async def latest_chat_image_data_urls(conversation, limit=1):
    """Return recent generated images as provider-neutral data URLs."""
    result = []
    for ref in latest_chat_image_refs(conversation, limit):
        data_url = await run_storage_io(reference_to_data_url, ref, 1536)
        if data_url and data_url not in result:
            result.append(data_url)
    return result

def image_size_from_reference(ref):
    path = output_file_from_url(ref)
    if not path:
        return ""
    try:
        with Image.open(path) as img:
            return f"{img.width}x{img.height}" if img.width and img.height else ""
    except Exception:
        return ""

def chat_requested_image_count(message):
    text = str(message or "")
    match = re.search(r"(?<!\d)([1-4])\s*(?:张|幅|个|组|套)(?!\d)", text) or re.search(r"([一二两俩三四])\s*(?:张|幅|个|组|套)", text)
    if not match:
        return 1
    value = match.group(1)
    return max(1, min(4, int(value) if value.isdigit() else CN_NUMERAL_MAP.get(value, 1)))

def chat_split_parallel_prompts(prompt, count):
    text = str(prompt or "").strip()
    if count <= 1:
        return [text]
    noun_match = re.search(r"(.+?)(?:的)?(海报|头像|壁纸|插画|照片|图片|图像)\s*$", text)
    if not noun_match:
        return [text] * count
    prefix, suffix = noun_match.group(1).strip(), noun_match.group(2)
    prefix = re.sub(r"(?:再)?(?:生成|画|绘制|制作|创建)\s*[1-4一二两俩三四]?\s*(?:张|幅|个|组|套)?", "", prefix).strip(" ，,、")
    candidates = [item.strip(" ，,、") for item in re.split(r"\s*(?:和|与|、|，|,|\+|＋)\s*", prefix) if item.strip(" ，,、")]
    return [f"{item}的{suffix}" for item in candidates[:count]] if len(candidates) >= count else [text] * count

def heuristic_agent_decision(message, refs, has_previous_image):
    text = str(message or "").lower()
    has_image = any(word.lower() in text for word in AGENT_IMAGE_KEYWORDS)
    has_edit = any(word.lower() in text for word in AGENT_EDIT_KEYWORDS)
    if refs and (has_edit or has_image) or has_previous_image and has_edit:
        return {"action": "edit_image", "prompt": message, "reply": ""}
    if has_image and not has_edit:
        return {"action": "generate_image", "prompt": message, "reply": ""}
    return {"action": "chat", "prompt": message, "reply": ""}

def parse_agent_decision(raw_text, message, refs, has_previous_image):
    data = None
    match = re.search(r"\{[\s\S]*\}", str(raw_text or ""))
    if match:
        try:
            data = json.loads(match.group(0))
        except Exception:
            pass
    fallback = heuristic_agent_decision(message, refs, has_previous_image)
    if not isinstance(data, dict):
        return fallback
    action = str(data.get("action") or "").strip()
    if action not in AGENT_ACTIONS:
        action = fallback["action"]
    if action == "edit_image" and not (refs or has_previous_image):
        action = fallback["action"]
    return {"action": action, "prompt": str(data.get("prompt") or message).strip() or message, "reply": str(data.get("reply") or "").strip()}

async def decide_chat_agent_action(payload, conversation, refs):
    previous = bool(latest_chat_image_refs(conversation, 1))
    fallback = heuristic_agent_decision(payload.message, refs, previous)
    from app.ai.database_repository import DatabaseAIRepository
    if not (payload.model_id or payload.connection_id):
        raise HTTPException(status_code=400, detail="Agent 请求必须提供 connection_id、model_id 或 resource_id")
    try:
        chat_target = await asyncio.to_thread(DatabaseAIRepository().resolve_model, model_id=payload.model_id, connection_id=payload.connection_id, model=payload.model, kind="chat")
    except LookupError as exc:
        raise HTTPException(status_code=404, detail="Agent 聊天模型或连接不存在或已禁用") from exc
    model = chat_target.model.upstream_model
    provider_cfg = {"id": chat_target.connection.id, "protocol": chat_target.protocol}
    messages = [{"role": "system", "content": "你是图片创作聊天 Agent 的意图路由器。只返回 JSON，不要 Markdown。action 只能是 chat、generate_image、edit_image。generate_image 用于生成新图，edit_image 用于修改上传图或上一张图。prompt 是交给图片工具的完整提示词。"}]
    for item in conversation.get("messages", [])[-10:]:
        if item.get("role") == "user" and item.get("content") == payload.message and item is conversation.get("messages", [])[-1]:
            continue
        msg = await run_storage_io(upstream_message_from_record, item)
        if msg:
            messages.append(msg)
    current_content = [{"type": "text", "text": f"当前用户输入：{payload.message}\n用户系统提示词：{payload.system_prompt or '无'}\n上传参考图数量：{len(refs)}\n已有上一张图：{'是' if previous else '否'}\n请返回 JSON。"}]
    for data_url in await latest_chat_image_data_urls(conversation, 1):
        current_content.append({"type": "image_url", "image_url": {"url": data_url}})
    for ref in list(payload.reference_images or [])[:CHAT_ATTACHMENT_MAX]:
        data_url = await run_storage_io(reference_to_data_url, ref.dict(), 1536)
        if data_url:
            current_content.append({"type": "image_url", "image_url": {"url": data_url}})
    messages.append({"role": "user", "content": current_content if len(current_content) > 1 else current_content[0]["text"]})
    try:
        from app.ai.chat import ChatGateway
        chat_gateway = ChatGateway(timeout=AI_REQUEST_TIMEOUT)
        raw = await chat_gateway.complete_target(target=chat_target, messages=messages, user_id=current_user_id())
        if provider_cfg.get("protocol") == "omnilojo":
            from app.services.usage import record_omnilojo_response_usage
            usage_payload = dict(raw) if isinstance(raw, dict) else {}
            usage_payload.setdefault("id", uuid.uuid4().hex)
            await asyncio.to_thread(record_omnilojo_response_usage, current_user_id(), provider_cfg, model, usage_payload, operation="agent_router")
        decision = parse_agent_decision(text_from_chat_response(raw), payload.message, refs, previous)
        decision["router_model"] = model
        return decision
    except Exception as exc:
        logger.warning("chat agent router fallback: %s", exc)
        fallback["router_model"] = model
        return fallback

async def build_chat_text_reply(payload, conversation):
    from app.ai.database_repository import DatabaseAIRepository
    if not (payload.model_id or payload.connection_id):
        raise HTTPException(status_code=400, detail="聊天请求必须提供 connection_id、model_id 或 resource_id")
    try:
        chat_target = await asyncio.to_thread(DatabaseAIRepository().resolve_model, model_id=payload.model_id, connection_id=payload.connection_id, model=payload.model, kind="chat")
    except LookupError as exc:
        raise HTTPException(status_code=404, detail="聊天模型或连接不存在或已禁用") from exc
    model = chat_target.model.upstream_model
    provider = {"id": chat_target.connection.id, "protocol": chat_target.protocol}
    messages = [{"role": "system", "content": chat_system_prompt(payload)}]
    history = conversation.get("messages", [])[-MAX_HISTORY_MESSAGES:]
    for item in history:
        if item.get("role") == "user" and item.get("content") == payload.message and item is history[-1]:
            continue
        msg = await run_storage_io(upstream_message_from_record, item)
        if msg:
            messages.append(msg)
    current_content = [{"type": "text", "text": payload.message}]
    for data_url in await latest_chat_image_data_urls(conversation, 1):
        current_content.append({"type": "image_url", "image_url": {"url": data_url}})
    for ref in list(payload.reference_images or [])[:CHAT_ATTACHMENT_MAX]:
        data_url = await run_storage_io(reference_to_data_url, ref.dict(), 1536)
        if data_url:
            current_content.append({"type": "image_url", "image_url": {"url": data_url}})
    messages.append({"role": "user", "content": current_content if len(current_content) > 1 else payload.message})
    try:
        from app.ai.chat import ChatGateway
        chat_gateway = ChatGateway(timeout=AI_REQUEST_TIMEOUT)
        raw = await chat_gateway.complete_target(target=chat_target, messages=messages, user_id=current_user_id())
    except httpx.HTTPStatusError as exc:
        body = exc.response.text or ""
        friendly = friendly_chat_error_detail(body, model, provider)
        raise HTTPException(status_code=exc.response.status_code, detail=friendly or f"上游接口错误：{body[:300]}") from exc
    except httpx.HTTPError as exc:
        raise HTTPException(status_code=502, detail=f"请求上游接口失败：{exc}") from exc
    if provider.get("protocol") == "omnilojo":
        from app.services.usage import record_omnilojo_response_usage
        usage_payload = dict(raw) if isinstance(raw, dict) else {}
        usage_payload.setdefault("id", uuid.uuid4().hex)
        await asyncio.to_thread(record_omnilojo_response_usage, current_user_id(), provider, model, usage_payload, operation="chat")
    return {"id": uuid.uuid4().hex, "role": "assistant", "content": text_from_chat_response(raw).strip() or "接口返回了空回复。", "created_at": now_ms(), "model": model, "raw_usage": raw.get("usage") if isinstance(raw, dict) else None}

# --- 路由接口 ---

# --- 页面与认证路由 ---
# /、/login、/auth/register、/auth/login、/auth/logout、/auth/me 已迁移至
# app/routers/pages.py（含 _issue_session_response）。auth_middleware 与 /ws/stats 仍在 main.py。

@app.get("/api/view")
async def view_image(filename: str, type: str = "input", subfolder: str = ""):
    # 先按原逻辑去各 ComfyUI 后端找
    from app.ai.adapters.comfyui_assets import ComfyUIAssetTransport
    transport = ComfyUIAssetTransport(endpoint=comfyui_url, client=get_http_client())
    for addr in COMFYUI_INSTANCES:
        try:
            r = await transport.view(addr, filename, kind=type, subfolder=subfolder)
            if r.status_code == 200:
                return Response(content=r.content, media_type=r.headers.get('Content-Type'))
        except Exception:
            continue
    # ComfyUI may have cleaned its input directory; fall back to the MinIO copy.
    if not subfolder and type in ("input", "output"):
        safe_name = os.path.basename(filename or "")
        if safe_name:
            local_path = await run_storage_io(local_media_file_by_basename, safe_name)
            if local_path and os.path.isfile(local_path):
                return FileResponse(local_path, media_type=content_type_for_path(local_path))
    raise HTTPException(status_code=404, detail="Image not found on any available backend")

# /api/download-output 路由已迁移至 app/routers/local_assets.py。

@app.post("/api/upload")
async def upload_image(files: List[UploadFile] = File(...)):
    from app.ai.adapters.comfyui_assets import ComfyUIAssetTransport
    uploaded_files = []
    files_content = []
    for file in files:
        content = await file.read()
        files_content.append((file, content))

    transport = ComfyUIAssetTransport(endpoint=comfyui_url, client=get_http_client())
    for file, content in files_content:
        success_count = 0
        last_result = None
        for addr in COMFYUI_INSTANCES:
            try:
                response = await transport.upload(addr, file.filename or "upload.bin", content, file.content_type or "application/octet-stream")
                if response.status_code == 200:
                    last_result = response.json()
                    success_count += 1
            except Exception:
                logger.exception("ComfyUI upload failed", extra={"event": "upload_failed", "provider": "comfyui", "operation": "upload", "endpoint": addr})

        if success_count > 0 and last_result:
            uploaded_files.append({"comfy_name": last_result.get("name", file.filename)})
        else:
            raise HTTPException(status_code=500, detail="Failed to upload to any backend")

    return {"files": uploaded_files}

# /api/ai/upload、/api/local-assets(upload|list|delete) 路由及 _local_upload_* 助手
# 已迁移至 app/routers/local_assets.py。

from app.services.pose_studio import (
    register_uploaded_fbx_model,
)

SAM3D_WORKFLOW_JSON = "custom/Sam3DBody.json"

def _sam3d_workflow_info() -> Tuple[Optional[str], Optional[str], Optional[str]]:
    stored = get_comfy_workflow(SAM3D_WORKFLOW_JSON)
    if not stored:
        return None, None, None
    try:
        workflow = stored.get("workflow") or {}
        image_node_id = None
        export_node_id = None
        for node_id, node in workflow.items():
            if not isinstance(node, dict):
                continue
            class_type = node.get("class_type")
            inputs = node.get("inputs") if isinstance(node.get("inputs"), dict) else {}
            if class_type == "LoadImage" and "image" in inputs and image_node_id is None:
                image_node_id = str(node_id)
            if class_type == "SAM3DBodyExportFBX" and export_node_id is None:
                export_node_id = str(node_id)
        return SAM3D_WORKFLOW_JSON, image_node_id, export_node_id
    except Exception:
        logger.exception("Pose Studio Sam3D workflow node lookup failed", extra={"event": "sam3d_workflow_node_lookup_failed", "provider": "comfyui"})
    return SAM3D_WORKFLOW_JSON, None, None

@app.post("/api/pose-studio/generate-fbx")
async def pose_studio_generate_fbx(file: UploadFile = File(...)):
    content = await file.read()
    if not content:
        raise HTTPException(status_code=400, detail="图片为空")
    try:
        image = Image.open(BytesIO(content))
        image.load()
    except Exception as exc:
        raise HTTPException(status_code=400, detail="无法读取图片") from exc

    original_name = file.filename or "pose-model.png"
    stem = sanitize_export_filename(os.path.splitext(original_name)[0], "pose-model")
    ext = os.path.splitext(original_name)[1].lower()
    if ext not in {".png", ".jpg", ".jpeg", ".webp", ".bmp"}:
        ext = ".png"
    comfy_image_name = f"{stem}_{uuid.uuid4().hex[:8]}{ext}"

    success_count = 0
    last_error = ""
    uploaded_image_name = comfy_image_name
    from app.ai.adapters.comfyui_assets import ComfyUIAssetTransport
    transport = ComfyUIAssetTransport(endpoint=comfyui_url, client=get_http_client())
    for addr in COMFYUI_INSTANCES:
        try:
            response = await transport.upload(addr, comfy_image_name, content, file.content_type or "image/png", overwrite=True)
            if response.status_code == 200:
                try:
                    uploaded_image_name = str(response.json().get("name") or uploaded_image_name)
                except Exception:
                    pass
                success_count += 1
            else:
                last_error = response.text[:300]
        except Exception as exc:
            last_error = str(exc)
            logger.exception("Pose Studio Sam3D input upload failed", extra={"event": "sam3d_input_upload_failed", "provider": "comfyui", "operation": "upload", "endpoint": addr})
    if success_count <= 0:
        raise HTTPException(status_code=502, detail=f"上传图片到 ComfyUI 失败：{last_error or 'no available backend'}")

    workflow_json, image_node_id, export_node_id = await asyncio.to_thread(_sam3d_workflow_info)
    if not workflow_json:
        raise HTTPException(status_code=500, detail=f"Sam3D-Body 工作流文件不存在：{SAM3D_WORKFLOW_JSON}")
    if not image_node_id:
        raise HTTPException(status_code=500, detail=f"Sam3D-Body 工作流缺少图片加载节点：{workflow_json}")
    if not export_node_id:
        raise HTTPException(status_code=500, detail=f"Sam3D-Body 工作流缺少 FBX 导出节点：{workflow_json}")
    exported_fbx_name = f"mediaforge_sam3d_{uuid.uuid4().hex}.fbx"
    request_payload = GenerateRequest(
        prompt="",
        workflow_json=workflow_json,
        params={
            image_node_id: {"image": uploaded_image_name},
            export_node_id: {"output_filename": exported_fbx_name},
        },
        type="pose-studio-sam3d",
        client_id=f"pose-studio-{uuid.uuid4().hex}",
    )
    result = await asyncio.to_thread(generate, request_payload)
    if result.get("error"):
        raise HTTPException(status_code=502, detail=f"Sam3D-Body 工作流执行失败：{result.get('error')}")

    try:
        fbx_content = fetch_comfy_output_bytes_by_name(
            result["backend"],
            exported_fbx_name,
            file_type="output",
        )
    except Exception as exc:
        raise HTTPException(
            status_code=502,
            detail=f"Sam3D-Body 工作流未生成指定 FBX 文件：{exported_fbx_name}",
        ) from exc
    if not fbx_content:
        raise HTTPException(status_code=502, detail="Sam3D-Body 工作流输出的 FBX 文件为空")
    registered = register_uploaded_fbx_model(fbx_content, exported_fbx_name)
    registered["workflow_result"] = {
        "workflow_json": result.get("workflow_json"),
        "prompt_id": result.get("prompt_id"),
        "backend": result.get("backend"),
        "source_fbx_name": exported_fbx_name,
        "source_fbx_url": "",
    }
    return registered

@app.post("/api/pose-studio/upload-fbx")
async def pose_studio_upload_fbx(file: UploadFile = File(...)):
    content = await file.read()
    return register_uploaded_fbx_model(content, file.filename or "uploaded-model")

@app.post("/api/temp-sh/upload")
async def temp_sh_upload(payload: TempShUploadRequest, request: Request):
    ensure_same_origin_request(request)
    return await upload_local_video_to_cloud(payload.url, "auto")

@app.post("/api/cloud-video/upload")
async def cloud_video_upload(payload: CloudVideoUploadRequest, request: Request):
    ensure_same_origin_request(request)
    return await upload_local_video_to_cloud(payload.url, payload.service)

# /api/ai/import-local-image 路由已迁移至 app/routers/local_assets.py。

@app.get("/api/runninghub/app-info")
async def runninghub_app_info(webappId: str = ""):
    webapp_id = str(webappId or "").strip()
    if not webapp_id:
        raise HTTPException(status_code=400, detail="webappId 必填")
    provider = await asyncio.to_thread(runninghub_connection)
    api_key = await runninghub_api_key_async(provider)
    from app.ai.adapters.runninghub_transport import RunningHubTransport
    transport = RunningHubTransport(endpoint=runninghub_endpoint_url, headers=lambda key, body: runninghub_protocol_headers(key, json_body=body), client_factory=shared_http_client, timeout=httpx.Timeout(connect=20.0, read=120.0, write=30.0, pool=20.0))
    raw = await transport.app_info(provider, api_key, webapp_id)
    if isinstance(raw, dict) and raw.get("code") not in (0, "0", None):
        raise HTTPException(status_code=400, detail=raw.get("msg") or f"RunningHub 查询失败 code={raw.get('code')}")
    data = raw.get("data") if isinstance(raw, dict) else {}
    return {"success": True, "data": data or {}}

@app.post("/api/runninghub/submit")
async def runninghub_submit(payload: RunningHubSubmitRequest):
    user_id = current_user_id()
    from app.services.usage import record_runninghub_submission
    webapp_id = str(payload.webappId or "").strip()
    selected_resource = None
    if not payload.resource_id and not payload.connection_id:
        raise HTTPException(status_code=400, detail="RunningHub 任务必须指定 resource_id 或 connection_id")
    if payload.resource_id or payload.connection_id:
        from app.ai.database_repository import DatabaseAIRepository
        try:
            selected_resource = await asyncio.to_thread(
                DatabaseAIRepository().resolve_executable,
                resource_id=payload.resource_id, connection_id=payload.connection_id, kind="runninghub_app"
            )
        except LookupError as exc:
            raise HTTPException(status_code=404, detail="RunningHub 资源不存在或已禁用") from exc
        settings = dict(selected_resource.resource.settings if selected_resource.resource else {})
        webapp_id = webapp_id or str(settings.get("app_id") or "").strip()
    if not webapp_id:
        raise HTTPException(status_code=400, detail="webappId 必填")
    provider = canonical_connection_view(selected_resource)
    await assert_provider_budget_available(provider, user_id)
    api_key = await runninghub_api_key_async(provider)
    body = {
        "apiKey": api_key,
        "webappId": webapp_id,
        "nodeInfoList": payload.nodeInfoList or [],
    }
    instance_type = str(payload.instanceType or "").strip()
    if instance_type:
        body["instanceType"] = instance_type
    async with connection_operation(str(provider.get("connection_id") or provider.get("id") or "runninghub"), "app_generation", user_id=user_id):
        from app.ai.adapters.runninghub_transport import RunningHubTransport
        transport = RunningHubTransport(endpoint=runninghub_endpoint_url, headers=lambda key, body: runninghub_protocol_headers(key, json_body=body), client_factory=shared_http_client, timeout=httpx.Timeout(connect=20.0, read=180.0, write=120.0, pool=20.0))
        raw = await transport.submit(provider, api_key, body)
    if isinstance(raw, dict) and raw.get("code") in (804, "804"):
        raise HTTPException(
            status_code=409,
            detail="RunningHub 正在执行当前 API Key 的其他任务，请等待其完成后再提交。",
        )
    if isinstance(raw, dict) and raw.get("code") in (0, "0"):
        upstream_task_id = raw.get("data", {}).get("taskId") if isinstance(raw.get("data"), dict) else ""
        if not upstream_task_id:
            raise HTTPException(status_code=502, detail=f"RunningHub 未返回 taskId：{raw}")
        await asyncio.to_thread(
            record_runninghub_submission, user_id, upstream_task_id,
            operation="ai_app", model=webapp_id,
            connection_id=selected_resource.connection.id if selected_resource else "",
            resource_id=payload.resource_id or "",
        )
        local_task_id = f"canvas_rh_{uuid.uuid4().hex}"
        task_logger.info(
            "canvas RunningHub task submitted",
            extra={
                "event": "task_submitted",
                "task_id": local_task_id,
                "upstream_task_id": upstream_task_id,
                "connection_id": selected_resource.connection.id if selected_resource else "",
                "resource_id": payload.resource_id or "",
                "operation": "app_generation",
                "status": "queued",
            },
        )
        return {"success": True, "data": {
            "task_id": local_task_id,
            "upstream_task_id": upstream_task_id,
            "connection_id": selected_resource.connection.id if selected_resource else "",
            "resource_id": payload.resource_id or "",
            "raw": raw,
        }}
    raise HTTPException(status_code=400, detail=(raw.get("msg") if isinstance(raw, dict) else "") or f"RunningHub 提交失败：{raw}")

@app.get("/api/runninghub/query")
async def runninghub_query(taskId: str = "", persistOutputs: bool = True, connection_id: str = "", resource_id: str = "", local_task_id: str = ""):
    user_id = current_user_id()
    from app.services.usage import settle_runninghub_usage
    task_id = str(taskId or "").strip()
    if not task_id:
        raise HTTPException(status_code=400, detail="taskId 必填")
    if not connection_id and not resource_id:
        raise HTTPException(status_code=400, detail="RunningHub 查询必须指定 resource_id 或 connection_id")
    provider = None
    if connection_id or resource_id:
        from app.ai.database_repository import DatabaseAIRepository
        try:
            target = await asyncio.to_thread(DatabaseAIRepository().resolve_executable, resource_id=resource_id, connection_id=connection_id, kind="runninghub_app")
            provider = canonical_connection_view(target)
        except LookupError as exc:
            raise HTTPException(status_code=404, detail="RunningHub 资源不存在或已禁用") from exc
    if provider is None:
        raise HTTPException(status_code=404, detail="RunningHub 连接不存在或已禁用")
    api_key = await runninghub_api_key_async(provider)
    from app.ai.adapters.runninghub_transport import RunningHubTransport
    transport = RunningHubTransport(endpoint=runninghub_endpoint_url, headers=lambda key, body: runninghub_protocol_headers(key, json_body=body), client_factory=shared_http_client, timeout=httpx.Timeout(connect=20.0, read=240.0, write=30.0, pool=20.0))
    raw = await transport.query(provider, api_key, task_id)
    code = raw.get("code") if isinstance(raw, dict) else None
    urls = []
    media_items = []
    for remote in runninghub_extract_outputs(raw.get("data") if isinstance(raw, dict) else raw):
        ext = runninghub_output_ext(remote)
        kind = runninghub_output_kind(ext)
        if not persistOutputs:
            urls.append(remote)
            media_items.append(await run_storage_io(media_response_item, remote, "", kind))
            continue
        try:
            async with shared_http_client(timeout=httpx.Timeout(connect=20.0, read=240.0, write=30.0, pool=20.0)) as client:
                local_url = await runninghub_store_remote_output(client, remote)
        except Exception as exc:
            # A completed RunningHub task already has a usable signed output
            # URL. Do not hide it from the user when the optional local mirror
            # fails because the upstream CDN breaks the response stream.
            logger.warning("failed to persist RunningHub output; returning remote URL", exc_info=True)
            urls.append(remote)
            media_items.append(await run_storage_io(media_response_item, remote, "", kind))
            continue
        urls.append(local_url)
        media_items.append(await run_storage_io(media_response_item, local_url, "", kind))
    status = runninghub_normalized_status(raw, code, urls)
    await asyncio.to_thread(
        settle_runninghub_usage, user_id, task_id, raw,
        status=status, operation="ai_app", connection_id=connection_id, resource_id=resource_id,
    )
    # RunningHub app tasks are polled by the client (no canvas worker), so the
    # terminal lifecycle line is emitted here, keyed by the local task_id issued
    # at submit time. Only terminal states are logged to avoid one line per poll.
    normalized_terminal = str(status or "").upper()
    if local_task_id and normalized_terminal in {"SUCCESS", "FAILED"}:
        succeeded = normalized_terminal == "SUCCESS"
        task_logger.info(
            "canvas RunningHub task completed" if succeeded else "canvas RunningHub task failed",
            extra={
                "event": "task_completed" if succeeded else "task_failed",
                "task_id": local_task_id,
                "upstream_task_id": task_id,
                "connection_id": connection_id,
                "resource_id": resource_id,
                "operation": "app_generation",
                "status": "succeeded" if succeeded else "failed",
                "output_count": len(urls),
                "error": "" if succeeded else str(runninghub_fail_reason(raw) or ""),
            },
        )
    result_data = {"status": status, "urls": urls, "media_items": media_items, "image_items": media_items, "failReason": runninghub_fail_reason(raw), "code": code, "raw": raw}
    try:
        quota_warning = await run_storage_io(check_storage_quota, 1, category="output")
        if quota_warning:
            result_data["quota_warning"] = quota_warning
    except Exception:
        pass
    return {"success": True, "data": result_data}

@app.post("/api/runninghub/upload-asset")
async def runninghub_upload_asset(payload: RunningHubUploadAssetRequest):
    source_url = str(payload.url or "").strip()
    if not source_url:
        raise HTTPException(status_code=400, detail="url 必填")
    if not payload.connection_id and not payload.resource_id:
        raise HTTPException(status_code=400, detail="RunningHub 素材上传必须指定 connection_id 或 resource_id")
    from app.ai.database_repository import DatabaseAIRepository
    try:
        target = await asyncio.to_thread(DatabaseAIRepository().resolve_executable, resource_id=payload.resource_id, connection_id=payload.connection_id, kind="runninghub_app")
        provider = canonical_connection_view(target)
    except LookupError as exc:
        raise HTTPException(status_code=404, detail="RunningHub 资源不存在或已禁用") from exc
    api_key = await runninghub_api_key_async(provider)
    filename = "asset.bin"
    content_type = "application/octet-stream"
    content = b""
    async with shared_http_client(timeout=httpx.Timeout(connect=20.0, read=240.0, write=240.0, pool=20.0)) as client:
        entry = await run_storage_io(resolve_file_reference, url=source_url) if source_url else None
        path = None if entry else await run_storage_io(runninghub_local_asset_path, source_url)
        if entry:
            filename = (
                entry.get("original_name")
                or entry.get("filename")
                or entry.get("stored_name")
                or filename
            )
            content_type = entry.get("mime_type") or entry.get("content_type") or content_type
            content = await run_storage_io(get_object_bytes, str(entry.get("bucket") or ""), str(entry.get("object_key") or ""))
        elif path:
            filename = os.path.basename(path)
            content_type = content_type_for_path(path)
            with open(path, "rb") as f:
                content = f.read()
        elif source_url.startswith(("http://", "https://")):
            response = await client.get(validate_external_http_url(source_url, label="素材地址"))
            if not response.is_success:
                raise HTTPException(status_code=400, detail=f"下载素材失败 HTTP {response.status_code}")
            content = response.content
            content_type = response.headers.get("content-type") or content_type
            filename = os.path.basename(urllib.parse.urlsplit(source_url).path) or filename
        else:
            raise HTTPException(status_code=400, detail=f"不支持的素材地址：{source_url}")
        if not content:
            raise HTTPException(status_code=400, detail="素材为空，无法上传到 RunningHub")
    from app.ai.adapters.runninghub_transport import RunningHubTransport
    transport = RunningHubTransport(endpoint=runninghub_endpoint_url, headers=lambda key, body: runninghub_protocol_headers(key, json_body=body), client_factory=shared_http_client, timeout=httpx.Timeout(connect=20.0, read=240.0, write=240.0, pool=20.0))
    raw = await transport.upload(provider, api_key, filename, content, content_type)
    if isinstance(raw, dict) and raw.get("code") in (0, "0") and isinstance(raw.get("data"), dict) and raw["data"].get("fileName"):
        return {"success": True, "data": {"fileName": raw["data"]["fileName"], "fileType": raw["data"].get("fileType") or content_type}}
    raise HTTPException(status_code=400, detail=(raw.get("msg") if isinstance(raw, dict) else "") or f"RunningHub 上传失败：{raw}")


@app.post("/api/runninghub/upload-asset-file")
async def runninghub_upload_asset_file(file: UploadFile = File(...), connection_id: str = Form(""), resource_id: str = Form("")):
    if not connection_id and not resource_id:
        raise HTTPException(status_code=400, detail="RunningHub 素材上传必须指定 connection_id 或 resource_id")
    from app.ai.database_repository import DatabaseAIRepository
    try:
        target = await asyncio.to_thread(DatabaseAIRepository().resolve_executable, resource_id=resource_id, connection_id=connection_id, kind="runninghub_app")
        provider = canonical_connection_view(target)
    except LookupError as exc:
        raise HTTPException(status_code=404, detail="RunningHub 资源不存在或已禁用") from exc
    api_key = await runninghub_api_key_async(provider)
    filename = os.path.basename(str(file.filename or "").strip()) or "asset.bin"
    content_type = str(file.content_type or "").strip() or "application/octet-stream"
    try:
        content = await file.read()
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"读取上传素材失败：{exc}") from exc
    if not content:
        raise HTTPException(status_code=400, detail="素材为空，无法上传到 RunningHub")
    from app.ai.adapters.runninghub_transport import RunningHubTransport
    transport = RunningHubTransport(endpoint=runninghub_endpoint_url, headers=lambda key, body: runninghub_protocol_headers(key, json_body=body), client_factory=shared_http_client, timeout=httpx.Timeout(connect=20.0, read=240.0, write=240.0, pool=20.0))
    raw = await transport.upload(provider, api_key, filename, content, content_type)
    if isinstance(raw, dict) and raw.get("code") in (0, "0") and isinstance(raw.get("data"), dict) and raw["data"].get("fileName"):
        return {"success": True, "data": {"fileName": raw["data"]["fileName"], "fileType": raw["data"].get("fileType") or content_type}}
    raise HTTPException(status_code=400, detail=(raw.get("msg") if isinstance(raw, dict) else "") or f"RunningHub 上传失败：{raw}")

@app.get("/api/config")
async def ai_config():
    preferred_chat_model = next((m for m in CHAT_MODELS if m == "gpt-5.5"), CHAT_MODELS[0] if CHAT_MODELS else CHAT_MODEL)
    return {
        "base_url": AI_BASE_URL,
        "chat_model": preferred_chat_model,
        "image_model": IMAGE_MODEL,
        "chat_models": CHAT_MODELS,
        "image_models": IMAGE_MODELS,
        "video_models": VIDEO_MODELS,
        "comfy_instances": COMFYUI_INSTANCES,
        "has_api_key": bool(AI_API_KEY),
    }

@app.get("/api/models")
async def ai_models():
    return {"chat_models": CHAT_MODELS, "image_models": IMAGE_MODELS, "video_models": VIDEO_MODELS}

@app.get("/api/ai/resources")
async def ai_resources():
    """Expose the connection/resource projection for new clients.

    This endpoint deliberately excludes connection settings and secrets, so
    callers select stable resource IDs without receiving keys. The removed
    ``/api/providers`` surface is intentionally not reintroduced here.
    """
    from app.ai.database_repository import DatabaseAIRepository

    repository = DatabaseAIRepository()
    def read_resources():
        return {
            "connections": [
            {
                "id": item.id,
                "protocol": item.protocol,
                "name": item.name,
                "base_url": item.base_url,
                "primary": item.primary,
            }
            for item in repository.connections()
            ],
            "models": [
            {
                "id": item.id,
                "connection_id": item.connection_id,
                "upstream_model": item.upstream_model,
                "kind": item.kind,
                "protocol": item.protocol,
                "alias": item.alias,
                "capabilities": sorted(item.capabilities),
            }
            for item in repository.models()
            ],
            "resources": [
            {
                "id": item.id,
                "connection_id": item.connection_id,
                "kind": item.kind,
                "name": item.name,
                "title": (dict(item.settings).get("title") or dict(item.settings).get("name") or item.name),
                # Resource settings contain the workflow-owned RH field
                # definitions. Connection secrets are stored separately and
                # are never included here.
                "settings": dict(item.settings),
            }
            for item in repository.executable_resources()
            ],
        }
    return await asyncio.to_thread(read_resources)


def _canonical_runninghub_settings(settings: Mapping[str, Any]) -> dict[str, Any]:
    """Return the canonical RH resource settings shape."""
    normalized = dict(settings or {})
    raw = normalized.get("raw") if isinstance(normalized.get("raw"), dict) else {}
    app_id = str(normalized.get("app_id") or raw.get("webappId") or normalized.get("webappId") or normalized.get("appId") or normalized.get("id") or "").strip()
    if app_id:
        normalized["app_id"] = app_id
        for key in ("id", "appId", "webappId"):
            normalized.pop(key, None)
    return normalized


def _ai_configuration_payload(repository):
    return {
        "connections": [{"id": item.id, "protocol": item.protocol, "name": item.name, "base_url": item.base_url, "enabled": item.enabled, "primary": item.primary, "settings": dict(item.settings)} for item in repository.connections(include_disabled=True)],
        "models": [{"id": item.id, "connection_id": item.connection_id, "kind": item.kind, "upstream_model": item.upstream_model, "protocol": item.protocol, "alias": item.alias, "enabled": item.enabled, "capabilities": sorted(item.capabilities), "settings": dict(item.settings)} for item in repository.models(include_disabled=True)],
        "resources": [
            {"id": item.id, "connection_id": item.connection_id, "kind": item.kind, "name": item.name, "enabled": item.enabled,
             "settings": _canonical_runninghub_settings(item.settings) if item.kind == "runninghub_app" else dict(item.settings)}
            for item in repository.executable_resources(include_disabled=True)
        ],
    }


@app.get("/api/ai/configuration")
async def ai_configuration():
    """Authoritative editable configuration, without exposing connection secrets."""
    require_api_settings_access()
    from app.ai.database_repository import DatabaseAIRepository
    return await asyncio.to_thread(lambda: _ai_configuration_payload(DatabaseAIRepository()))


@app.put("/api/ai/configuration")
async def save_ai_configuration(payload: Dict[str, Any]):
    """Atomically replace AI connections/models/resources and update supplied secrets."""
    require_api_settings_access()
    connections = payload.get("connections") if isinstance(payload.get("connections"), list) else []
    models = payload.get("models") if isinstance(payload.get("models"), list) else []
    resources = payload.get("resources") if isinstance(payload.get("resources"), list) else []
    for resource in resources:
        if isinstance(resource, dict) and resource.get("kind") == "runninghub_app":
            resource["settings"] = _canonical_runninghub_settings(resource.get("settings") or {})
    for item in connections:
        if not isinstance(item, dict) or not str(item.get("id") or "").strip() or not str(item.get("protocol") or "").strip():
            raise HTTPException(status_code=400, detail="连接必须包含 id 和 protocol")
    try:
        from app.ai.database_repository import DatabaseAIRepository
        from app.services.connection_secrets import set_connection_secret
        def save():
            DatabaseAIRepository().replace(connections=connections, models=models, resources=resources)
            for item in connections:
                if "api_key" in item:
                    set_connection_secret(str(item["id"]), "api_key", str(item.get("api_key") or ""))
        await asyncio.to_thread(save)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {"ok": True}


@app.get("/api/ai/connections")
async def ai_connections():
    payload = await ai_resources()
    return {"connections": payload["connections"]}


@app.get("/api/ai/models")
async def ai_models_v2(kind: str = "", connection_id: str = ""):
    payload = await ai_resources()
    models = payload["models"]
    if kind:
        models = [item for item in models if item["kind"] == kind]
    if connection_id:
        models = [item for item in models if item["connection_id"] == connection_id]
    return {"models": models}


@app.get("/api/ai/executable-resources")
async def ai_executable_resources(kind: str = "", connection_id: str = ""):
    payload = await ai_resources()
    resources = payload["resources"]
    if kind:
        resources = [item for item in resources if item["kind"] == kind]
    if connection_id:
        resources = [item for item in resources if item["connection_id"] == connection_id]
    return {"resources": resources}


@app.get("/api/ai/status")
async def ai_gateway_status():
    from app.ai.features import gateway_enabled
    return {
        "chat": gateway_enabled("CHAT"),
        "images": gateway_enabled("IMAGES"),
        "video": gateway_enabled("VIDEO"),
        "workflows": gateway_enabled("WORKFLOWS"),
        "connections": gateway_enabled("CONNECTIONS"),
    }


@app.post("/api/ai/connections/{connection_id}/discover")
async def ai_connection_discover(connection_id: str):
    require_api_settings_access()
    from app.ai.services.discovery import ConnectionDiscoveryService
    from app.ai.database_repository import DatabaseAIRepository
    from app.services.connection_secrets import get_connection_secret

    repository = DatabaseAIRepository()
    # The repository and secret store both use the synchronous database bridge,
    # which rejects event-loop calls. Read them together on a worker thread.
    def load():
        connection = next((item for item in repository.connections() if item.id == connection_id), None)
        return connection, get_connection_secret(connection_id, "api_key") if connection else ""
    target, api_key = await asyncio.to_thread(load)
    if target is None:
        raise HTTPException(status_code=404, detail="AI 连接不存在或已禁用")
    if not api_key:
        raise HTTPException(status_code=400, detail="该连接未配置 API Key")
    async def discover(connection):
        async with connection_operation(connection.id, "model_discovery", user_id=current_user_id()):
            return await fetch_models_from_upstream(connection.base_url, api_key, connection.protocol)
    service = ConnectionDiscoveryService(
        connection_loader=lambda _id: target,
        discoverer=discover,
    )
    try:
        return await service.discover(connection_id)
    except LookupError as exc:
        raise HTTPException(status_code=404, detail="AI 连接不存在或已禁用") from exc


@app.post("/api/ai/connections/{connection_id}/test")
async def ai_connection_test(connection_id: str):
    """Test a persisted connection and return categorized upstream models."""
    require_api_settings_access()
    from app.ai.database_repository import DatabaseAIRepository
    from app.services.connection_secrets import get_connection_secret
    # Both lookups cross the synchronous database bridge, which rejects
    # event-loop calls. Resolve them on a worker thread.
    def load():
        connection = next((item for item in DatabaseAIRepository().connections() if item.id == connection_id), None)
        return connection, get_connection_secret(connection_id, "api_key") if connection else ""
    target, api_key = await asyncio.to_thread(load)
    if target is None:
        raise HTTPException(status_code=404, detail="AI 连接不存在或已禁用")
    if not api_key:
        raise HTTPException(status_code=400, detail="该连接未配置 API Key")
    try:
        result = await fetch_models_from_upstream(target.base_url, api_key, target.protocol)
    except HTTPException as exc:
        return {"ok": False, "status": exc.status_code, "message": str(exc.detail)}
    return {"ok": True, **result}

@app.get("/api/canvas/capability-parameters")
async def canvas_capability_parameters(capability: str, provider_id: str = "", model: str = "", connection_id: str = "", model_id: str = "", resource_id: str = ""):
    """The single field contract consumed by canvas UI and Canvas Agent tools."""
    if not any(str(value or "").strip() for value in (connection_id, model_id, resource_id)):
        raise HTTPException(status_code=400, detail="参数契约必须指定 connection_id、model_id 或 resource_id")
    from app.services.ai_parameters import capability_parameters
    try:
        return await asyncio.to_thread(
            capability_parameters,
            capability=capability,
            provider_id=provider_id,
            model=model,
            connection_id=connection_id,
            model_id=model_id,
            resource_id=resource_id,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

@app.get("/api/canvas/parameter-schema/definitions")
async def canvas_parameter_schema_definitions():
    """Backend-owned editable definitions and their execution contract."""
    from app.services.ai_parameters import parameter_schema_definitions
    return {"schemas": parameter_schema_definitions()}

@app.post("/api/canvas/parameter-schema/validate")
async def validate_canvas_parameter_schema(payload: Dict[str, Any]):
    """Validate one Provider's model-scoped parameter overrides before save."""
    require_api_settings_access()
    from app.services.ai_parameters import normalize_parameter_schema
    try:
        return {"parameter_schema": normalize_parameter_schema(payload.get("parameter_schema"))}
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

# --- 在线生图 (COMFLY) ---


def upstream_models_url(base_url: str, protocol: str):
    from app.ai.transport import models_endpoint
    return models_endpoint(base_url, protocol)

def upstream_model_headers(api_key: str, protocol: str):
    from app.ai.transport import model_headers
    return dict(model_headers(api_key, protocol))

def volcengine_empty_model_payload(status=200, message="", raw=None):
    return {"ok": True, "protocol": "volcengine", "status": status,
            "message": message or "方舟任务接口可用，但模型列表接口未返回模型。",
            "model_count": 0, "image_models": [], "chat_models": [],
            "video_models": [], "all": [], "raw": raw}

def volcengine_task_probe_url(base_url: str):
    base = str(base_url or "").strip().rstrip("/")
    if not base:
        return ""
    if base.endswith("/api/v3"):
        return f"{base}/contents/generations/tasks/healthcheck_probe_do_not_submit"
    return f"{base}/api/v3/contents/generations/tasks/healthcheck_probe_do_not_submit"

async def probe_volcengine_task_endpoint(client, base_url: str, api_key: str):
    probe_url = volcengine_task_probe_url(base_url)
    if not probe_url:
        return False, {"status": 0, "message": "Base URL 为空"}
    response = await client.get(probe_url, headers=upstream_model_headers(api_key, "volcengine"))
    try:
        raw = response.json() if response.text else {}
    except Exception:
        raw = response.text[:500]
    if response.status_code in (401, 403):
        return False, {"status": response.status_code, "message": "方舟 API Key 无效或无权限", "raw": raw}
    if looks_like_html_response(response.text):
        return False, {"status": response.status_code, "message": "任务接口返回 HTML，Base URL 可能不是 API 地址", "raw": raw}
    if response.status_code < 500:
        return True, {"status": response.status_code, "message": "方舟任务查询端点可达", "raw": raw}
    return False, {"status": response.status_code, "message": f"方舟任务接口服务端错误 {response.status_code}", "raw": raw}

def openai_compat_root_for_probe(base_url: str):
    base = str(base_url or "").strip().rstrip("/")
    if base.endswith("/api/v3"):
        base = base[: -len("/api/v3")]
    if base.endswith("/v1"):
        return base
    return f"{base}/v1" if base else ""

async def probe_openai_compat_bearer_endpoint(client, base_url: str, api_key: str):
    root = openai_compat_root_for_probe(base_url)
    if not root:
        return False, {"status": 0, "message": "Base URL 为空"}
    url = f"{root}/chat/completions"
    response = await client.post(
        url,
        headers={**upstream_model_headers(api_key, "openai"), "Content-Type": "application/json"},
        json={"messages": []},
    )
    try:
        raw = response.json() if response.text else {}
    except Exception:
        raw = response.text[:500]
    if response.status_code in (401, 403):
        return False, {"status": response.status_code, "message": "API Key 无效或无权限", "raw": raw}
    if looks_like_html_response(response.text):
        return False, {"status": response.status_code, "message": "OpenAI 兼容入口返回 HTML，Base URL 可能不是 API 地址", "raw": raw}
    if response.status_code < 500:
        return True, {"status": response.status_code, "message": "OpenAI 兼容 Bearer 鉴权入口可达", "raw": raw}
    return False, {"status": response.status_code, "message": f"OpenAI 兼容入口服务端错误 {response.status_code}", "raw": raw}

async def probe_openai_models_endpoint(client, base_url: str, api_key: str):
    url = upstream_models_url(base_url, "openai")
    response = await client.get(url, headers=upstream_model_headers(api_key, "openai"))
    try:
        raw = response.json() if response.text else {}
    except Exception:
        raw = response.text[:500]
    if response.status_code in (301, 302, 303, 307, 308):
        location = response.headers.get("Location") or response.headers.get("location") or ""
        suffix = f"：{location}" if location else ""
        return False, {"status": response.status_code, "message": f"OpenAI /v1/models 发生跳转{suffix}，请填写 API Base URL，不要填写网页登录地址", "raw": raw}
    if response.status_code in (401, 403):
        return False, {"status": response.status_code, "message": "OpenAI API Key 无效或无权限", "raw": raw}
    if looks_like_html_response(response.text):
        return False, {"status": response.status_code, "message": "OpenAI /v1/models 返回网页 HTML，请检查请求地址是否为 API Base URL", "raw": raw}
    if response.status_code < 300:
        grouped, ids = parse_models_payload(raw, "openai") if isinstance(raw, dict) else ({"image": [], "chat": [], "video": []}, [])
        return True, {
            "status": response.status_code,
            "message": f"OpenAI 兼容模型列表端点可用{f'，找到 {len(ids)} 个模型' if ids else ''}",
            "raw": raw,
            "model_count": len(ids),
            "image_models": grouped["image"],
            "chat_models": grouped["chat"],
            "video_models": grouped["video"],
            "all": ids,
        }
    if 400 <= response.status_code < 500:
        return False, {"status": response.status_code, "message": f"OpenAI /v1/models 不可用 (HTTP {response.status_code})", "raw": raw}
    return False, {"status": response.status_code, "message": f"OpenAI /v1/models 服务端错误 {response.status_code}", "raw": raw}

async def probe_volcengine_auto_detect(client, base_url: str, api_key: str):
    task_ok, task_probe = await probe_volcengine_task_endpoint(client, base_url, api_key)
    if task_ok:
        return True, {
            "status": task_probe.get("status") or 200,
            "message": "检测到方舟/Ark 任务协议",
            "raw": {"task_probe": task_probe.get("raw")},
        }
    compat_ok, compat_probe = await probe_openai_compat_bearer_endpoint(client, base_url, api_key)
    if compat_ok:
        return True, {
            "status": compat_probe.get("status") or 200,
            "message": "检测到方舟/Ark Bearer 鉴权入口（OpenAI 兼容透传）",
            "raw": {"task_probe": task_probe, "openai_compat_probe": compat_probe.get("raw")},
        }
    return False, {
        "status": compat_probe.get("status") or task_probe.get("status") or 0,
        "message": compat_probe.get("message") or task_probe.get("message") or "未检测到方舟/Ark 兼容入口",
        "raw": {"task_probe": task_probe, "openai_compat_probe": compat_probe.get("raw")},
    }

async def fetch_models_from_upstream(base_url: str, api_key: str, protocol: str = "openai"):
    """从上游模型列表端点拉取模型，并按名称做轻量分类。"""
    protocol = protocol if protocol in SUPPORTED_PROVIDER_PROTOCOLS else "openai"
    base_url = validate_public_http_url(base_url, label="请求地址")
    api_key = await asyncio.to_thread(volcengine_provider_api_key, api_key) if protocol == "volcengine" else (api_key or "").strip()
    if not api_key:
        key_name = "方舟 API Key" if protocol == "volcengine" else "API Key"
        raise HTTPException(status_code=400, detail=f"请先填写或保存 {key_name}")
    if protocol == "openai" and "api.cloudwise.ai" in base_url.lower():
        # Cloudwise's GPT Image endpoint documents a fixed model and does not
        # expose an OpenAI /v1/models discovery endpoint.
        return {"total": 1, "protocol": "openai", "image_models": ["gpt-image-2"], "chat_models": [], "video_models": [], "all": ["gpt-image-2"]}
    url = upstream_models_url(base_url, protocol)
    try:
        async with shared_http_client(timeout=30) as client:
            resp = await client.get(url, headers=upstream_model_headers(api_key, protocol))
            endpoint_label = "/v1beta/models" if protocol == "gemini" else "/api/v3/models" if protocol == "volcengine" else "/openapi/v2/models" if protocol == "runninghub" else "/v1/models"
            if resp.status_code in (301, 302, 303, 307, 308):
                location = resp.headers.get("Location") or resp.headers.get("location") or ""
                suffix = f"：{location}" if location else ""
                raise HTTPException(status_code=400, detail=f"上游 {endpoint_label} 发生跳转{suffix}，请填写 API Base URL，不要填写网页登录地址")
            if looks_like_html_response(resp.text):
                raise HTTPException(status_code=400, detail=f"上游 {endpoint_label} 返回网页 HTML，请检查请求地址是否为 API Base URL")
            if resp.status_code >= 400:
                if protocol == "volcengine":
                    detected, probe = await probe_volcengine_auto_detect(client, base_url, api_key)
                    if detected:
                        payload = volcengine_empty_model_payload(
                            status=probe.get("status") or resp.status_code,
                            raw={"models_error": resp.text[:300], **(probe.get("raw") or {})},
                        )
                        return {
                            "total": payload["model_count"],
                            "protocol": payload["protocol"],
                            "image_models": payload["image_models"],
                            "chat_models": payload["chat_models"],
                            "video_models": payload["video_models"],
                            "all": payload["all"],
                            "message": payload["message"],
                            "raw": payload["raw"],
                        }
                elif protocol == "openai":
                    detected, probe = await probe_volcengine_auto_detect(client, base_url, api_key)
                    if detected:
                        payload = volcengine_empty_model_payload(
                            status=probe.get("status") or resp.status_code,
                            raw={"models_error": resp.text[:300], **(probe.get("raw") or {})},
                        )
                        return {
                            "total": payload["model_count"],
                            "protocol": payload["protocol"],
                            "image_models": payload["image_models"],
                            "chat_models": payload["chat_models"],
                            "video_models": payload["video_models"],
                            "all": payload["all"],
                            "message": payload["message"],
                            "raw": payload["raw"],
                        }
                raise HTTPException(status_code=resp.status_code, detail=f"上游 {endpoint_label} 失败：{resp.text[:300]}")
            raw = resp.json()
    except httpx.HTTPError as e:
        if protocol == "volcengine":
            try:
                async with new_outbound_http_client(timeout=15) as client:
                    detected, probe = await probe_volcengine_auto_detect(client, base_url, api_key)
                    if detected:
                        payload = volcengine_empty_model_payload(
                            status=probe.get("status") or 0,
                            raw={"models_error": str(e)[:300], **(probe.get("raw") or {})},
                        )
                        return {
                            "total": payload["model_count"],
                            "protocol": payload["protocol"],
                            "image_models": payload["image_models"],
                            "chat_models": payload["chat_models"],
                            "video_models": payload["video_models"],
                            "all": payload["all"],
                            "message": payload["message"],
                            "raw": payload["raw"],
                        }
            except Exception:
                pass
        raise HTTPException(status_code=502, detail=f"请求上游模型列表失败：{e}")
    grouped, ids = parse_models_payload(raw, protocol)
    if protocol == "volcengine" and not ids:
        payload = volcengine_empty_model_payload(raw=raw)
        return {
            "total": payload["model_count"],
            "image_models": payload["image_models"],
            "chat_models": payload["chat_models"],
            "video_models": payload["video_models"],
            "all": payload["all"],
            "message": payload["message"],
            "raw": payload["raw"],
        }
    return {"total": len(ids), "image_models": grouped["image"], "chat_models": grouped["chat"], "video_models": grouped["video"], "all": ids}

async def build_online_image_result(payload: OnlineImageRequest):
    from app.ai.database_repository import DatabaseAIRepository
    try:
        target = await asyncio.to_thread(
            DatabaseAIRepository().resolve_model,
            model_id=payload.model_id,
            connection_id=payload.connection_id,
            model=payload.model,
            kind="image",
        )
    except LookupError as exc:
        raise HTTPException(status_code=404, detail="图片模型资源不存在或已禁用") from exc
    model = target.model.upstream_model if target.model else payload.model
    refs = [ref.dict() for ref in payload.reference_images if ref.url]
    max_count = max(1, min(8, int(os.getenv("AI_ONLINE_IMAGE_MAX_COUNT", "4"))))
    count = max(1, min(max_count, int(payload.n or 1)))
    async def generate_one():
        image_data, raw_item = await generate_ai_image_target(
            target, prompt=payload.prompt, size=payload.size, quality=payload.quality,
            reference_images=refs, user_id=current_user_id(),
        )
        local_url = await save_ai_image_to_output(image_data, prefix="online_")
        return local_url, raw_item
    try:
        generated = await asyncio.gather(*(generate_one() for _ in range(count)))
    except httpx.HTTPStatusError as exc:
        text = exc.response.text or ''
        friendly = friendly_image_error_detail(text, payload.size, model)
        detail = friendly or f"上游生图接口错误：{text[:300]}"
        raise HTTPException(status_code=exc.response.status_code, detail=detail) from exc
    except httpx.HTTPError as exc:
        raise HTTPException(status_code=502, detail=f"请求上游生图接口失败：{exc}") from exc

    media_items = [
        await run_storage_io(media_response_item, url, "", "image")
        for url, _raw in generated if url
    ]
    local_urls = [item["url"] for item in media_items if item.get("url")]
    raw = generated[0][1] if generated else {}
    if not local_urls:
        provider_name = target.connection.name or target.connection.id
        raw_text = json.dumps(raw, ensure_ascii=False)[:800] if isinstance(raw, (dict, list)) else str(raw)[:800]
        raise HTTPException(status_code=502, detail=f"{provider_name} 没有返回图片：{raw_text}")
    result = {
        "prompt": payload.prompt,
        "images": local_urls,
        "image_items": media_items,
        "timestamp": time.time(),
        "type": "online",
        "model": model,
        "provider_id": "",
        "provider_name": target.connection.name or target.connection.id,
        "connection_id": payload.connection_id or "",
        "model_id": payload.model_id or "",
        "resource_id": payload.resource_id or "",
        "task_id": extract_task_id(raw) if isinstance(raw, dict) else None,
        "request_id": raw.get("id") if isinstance(raw, dict) else None,
        "params": {"model": model, "size": payload.size, "quality": payload.quality, "n": count, "reference_images": refs},
        "raw_usage": raw.get("usage") if isinstance(raw, dict) else None,
    }
    runtime_provider = canonical_connection_view(target)
    if is_runninghub_connection(runtime_provider):
        task_id = str(result.get("task_id") or "").strip()
        if task_id:
            from app.services.usage import settle_runninghub_usage
            await asyncio.to_thread(
                settle_runninghub_usage, current_user_id(), task_id, raw,
                status="succeeded", operation="image_generation", model=model,
                connection_id=target.connection.id, model_id=target.model.id,
                resource_id=target.resource.id if target.resource else "",
            )
    elif isinstance(raw, dict) and raw.get("usage"):
        from app.services.usage import record_omnilojo_response_usage
        await asyncio.gather(*(
            asyncio.to_thread(record_omnilojo_response_usage, current_user_id(), runtime_provider, model, {**raw_item, "local_request_id": f"image:{uuid.uuid4().hex}"}, operation="image_generation")
            for _url, raw_item in generated
        ))
    await asyncio.to_thread(save_to_history, result)
    if GLOBAL_LOOP:
        asyncio.run_coroutine_threadsafe(manager.broadcast_new_image(result, current_user_id()), GLOBAL_LOOP)
    return result

CANVAS_IMAGE_SIZE_MAP = {
    "1:1": {"1k": "1024x1024", "2k": "2048x2048", "4k": "2880x2880"},
    "2:3": {"1k": "848x1264", "2k": "1696x2528", "4k": "2352x3520"},
    "3:2": {"1k": "1264x848", "2k": "2528x1696", "4k": "3520x2352"},
    "3:4": {"1k": "896x1200", "2k": "1792x2400", "4k": "2480x3312"},
    "4:3": {"1k": "1200x896", "2k": "2400x1792", "4k": "3312x2480"},
    "4:5": {"1k": "928x1152", "2k": "1856x2304", "4k": "2560x3200"},
    "5:4": {"1k": "1152x928", "2k": "2304x1856", "4k": "3200x2560"},
    "9:16": {"1k": "768x1376", "2k": "1536x2752", "4k": "2160x3840"},
    "16:9": {"1k": "1376x768", "2k": "2752x1536", "4k": "3840x2160"},
    "21:9": {"1k": "1584x672", "2k": "3168x1344", "4k": "3840x1648"},
    "9:21": {"1k": "672x1584", "2k": "1344x3168", "4k": "1648x3840"},
}
CANVAS_IMAGE_LONG_SIDE = {"1k": 1024, "2k": 2048, "4k": 3840}
CANVAS_IMAGE_PIXEL_LIMIT = {"1k": 2359296, "2k": 4194304, "4k": 8294400}


def _canvas_settings(payload) -> dict:
    settings = getattr(payload, "run_settings", None)
    return settings if isinstance(settings, dict) else {}


def _canvas_string(settings: dict, key: str, fallback: str = "") -> str:
    value = settings.get(key, fallback)
    return str(value or "").strip()


def _canvas_int(settings: dict, key: str, fallback: int, minimum: int, maximum: int) -> int:
    try:
        value = int(float(settings.get(key, fallback)))
    except (TypeError, ValueError):
        value = fallback
    return max(minimum, min(maximum, value))


def _canvas_bool(settings: dict, key: str, fallback: bool = False) -> bool:
    value = settings.get(key, fallback)
    if isinstance(value, str):
        return value.strip().lower() in {"1", "true", "yes", "on"}
    return bool(value)


def canvas_image_size_from_settings(settings: dict) -> str:
    resolution = _canvas_string(settings, "resolution", "1k").lower() or "1k"
    ratio = _canvas_string(settings, "ratio", "1:1") or "1:1"
    if resolution == "custom":
        return _canvas_string(settings, "customSize") or "1024x1024"
    if ratio == "source":
        ratio = _canvas_string(settings, "ratioMatched", "1:1")
    if ratio == "custom":
        parts = re.split(r"[:xX*]", _canvas_string(settings, "customRatio"))
        try:
            width_ratio, height_ratio = float(parts[0]), float(parts[1])
            aspect = width_ratio / height_ratio if width_ratio > 0 and height_ratio > 0 else 0
        except (IndexError, TypeError, ValueError, ZeroDivisionError):
            aspect = 0
        if aspect > 0:
            long_side = CANVAS_IMAGE_LONG_SIDE.get(resolution, 1024)
            pixel_limit = CANVAS_IMAGE_PIXEL_LIMIT.get(resolution, long_side * long_side)
            raw_width = long_side if aspect >= 1 else min(long_side * aspect, math.sqrt(pixel_limit * aspect))
            raw_height = min(long_side / aspect, math.sqrt(pixel_limit / aspect)) if aspect >= 1 else long_side
            width = max(64, math.floor(raw_width / 16) * 16)
            height = max(64, math.floor(raw_height / 16) * 16)
            return f"{width}x{height}"
    ratio_sizes = CANVAS_IMAGE_SIZE_MAP.get(ratio) or CANVAS_IMAGE_SIZE_MAP["1:1"]
    return ratio_sizes.get(resolution) or CANVAS_IMAGE_SIZE_MAP["1:1"]["1k"]


def normalize_canvas_image_request(payload: OnlineImageRequest) -> OnlineImageRequest:
    settings = _canvas_settings(payload)
    if not settings:
        return payload
    provider_id = ""
    model = str(payload.model or "")
    try:
        from app.services.ai_parameters import validate_run_settings
        resolved = validate_run_settings(
            kind="image", provider_id="", model=model,
            settings=settings,
            connection_id=payload.connection_id, model_id=payload.model_id, resource_id=payload.resource_id,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=f"画布图片参数不合法：{exc}") from exc
    values = resolved["values"]
    updates: dict[str, Any] = {}
    for field in resolved["fields"]:
        execution = field.get("execution") or {}
        target, transform = execution.get("target"), execution.get("transform")
        if not execution.get("supported", False) or not target:
            continue
        if transform == "image_size":
            updates[target] = canvas_image_size_from_settings(values)
        else:
            updates[target] = values.get(field["id"])
    return payload.model_copy(update=updates)


from app.ai.runtime import configure_canvas_runtime
configure_canvas_runtime(
    # Resolve these globals when called so configuration reloads and existing
    # test/runtime overrides retain the same dynamic behavior as before.
    image_normalizer=lambda payload: normalize_canvas_image_request(payload),
    media_reference_resolver=lambda ref, max_size: reference_to_data_url(ref, max_size),
    target_authorizer=require_target_access,
    connection_lookup=lambda connection_id: canonical_connection_view(next(item for item in DatabaseAIRepository().connections() if item.id == connection_id)),
    connection_budget_authorizer=lambda connection, user_id: assert_provider_budget_available(connection, user_id),
)


def normalize_canvas_video_request(payload: CanvasVideoRequest) -> CanvasVideoRequest:
    settings = _canvas_settings(payload)
    if not settings:
        return payload
    provider_id = ""
    model = str(payload.model or "")
    try:
        from app.services.ai_parameters import validate_run_settings
        resolved = validate_run_settings(
            kind="video", provider_id="", model=model,
            settings=settings,
            connection_id=payload.connection_id, model_id=payload.model_id, resource_id=payload.resource_id,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=f"画布视频参数不合法：{exc}") from exc
    values = resolved["values"]
    updates: dict[str, Any] = {}
    for field in resolved["fields"]:
        execution = field.get("execution") or {}
        target = execution.get("target")
        if execution.get("supported", False) and target:
            updates[target] = values.get(field["id"])
    if updates.pop("frame_roles", False):
        updates["images"] = [
            image.model_copy(update={"role": "first_frame" if index == 0 else "last_frame" if index == 1 else image.role})
            for index, image in enumerate(payload.images)
        ]
    return payload.model_copy(update=updates)


@app.post("/api/online-image")
async def online_image(payload: OnlineImageRequest):
    if not (payload.model_id or payload.connection_id or payload.resource_id):
        raise HTTPException(status_code=400, detail="图片请求必须提供 connection_id、model_id 或 resource_id")
    if payload.model_id or payload.connection_id or payload.resource_id:
        from app.ai.database_repository import DatabaseAIRepository
        try:
            if payload.resource_id:
                target = await asyncio.to_thread(DatabaseAIRepository().resolve_executable, resource_id=payload.resource_id)
                payload = payload.model_copy(update={"connection_id": target.connection.id})
            else:
                target = await asyncio.to_thread(DatabaseAIRepository().resolve_model, model_id=payload.model_id, connection_id=payload.connection_id, model=payload.model, kind="image")
                payload = payload.model_copy(update={"connection_id": target.connection.id, "model_id": target.model.id})
        except LookupError as exc:
            raise HTTPException(status_code=404, detail="图片模型或连接不存在或已禁用") from exc
    payload = await asyncio.to_thread(normalize_canvas_image_request, payload)
    return await build_online_image_result(payload)

@app.post("/api/image-task-query")
async def query_image_task(payload: ImageTaskQueryRequest):
    if not (payload.connection_id or payload.resource_id):
        raise HTTPException(status_code=400, detail="任务查询必须提供 connection_id 或 resource_id")
    provider = None
    if payload.connection_id or payload.resource_id:
        from app.ai.database_repository import DatabaseAIRepository
        try:
            target = await asyncio.to_thread(
                DatabaseAIRepository().resolve_executable,
                resource_id=payload.resource_id,
                connection_id=payload.connection_id,
                kind="runninghub_app" if payload.resource_id else "",
            ) if payload.resource_id else await asyncio.to_thread(DatabaseAIRepository().connections)
            if payload.resource_id:
                provider = canonical_connection_view(target)
            else:
                connection = next((item for item in target if item.id == payload.connection_id), None)
                if connection:
                    provider = {
                        "id": connection.id,
                        "connection_id": connection.id,
                        "name": connection.name,
                        "protocol": connection.protocol,
                        "base_url": connection.base_url,
                        **dict(connection.settings or {}),
                    }
        except (LookupError, StopIteration):
            provider = None
    if provider is None:
        raise HTTPException(status_code=404, detail="图片执行连接不存在或已禁用")
    task_id = str(payload.task_id or "").strip()
    timeout = httpx.Timeout(connect=20.0, read=300.0, write=60.0, pool=20.0)
    try:
        async with shared_http_client(timeout=timeout) as client:
            raw = await fetch_image_task_payload(client, task_id, provider)
    except httpx.HTTPStatusError as exc:
        log_net_error(f"查询生图任务 HTTP状态错误 provider={provider.get('id')} task_id={task_id}", exc)
        text = exc.response.text or ""
        raise HTTPException(status_code=exc.response.status_code, detail=f"查询上游生图任务失败：{text[:300]}") from exc
    except httpx.HTTPError as exc:
        log_net_error(f"查询生图任务 网络/TLS错误 provider={provider.get('id')} task_id={task_id}", exc)
        raise HTTPException(status_code=502, detail=f"查询上游生图任务失败：{exc}") from exc

    status = image_task_status(raw)
    image_item = None
    try:
        image_item = extract_image(raw)
    except HTTPException:
        image_item = None
    if image_item:
        local_urls = []
        local_url = await save_ai_image_to_output(image_item, prefix="online_")
        if local_url:
            local_urls.append(local_url)
        media_items = [
            await run_storage_io(media_response_item, url, "", "image")
            for url in local_urls if url
        ]
        result = {
            "status": "succeeded",
            "prompt": "",
            "images": local_urls,
            "image_items": media_items,
            "timestamp": time.time(),
            "type": "online",
            "model": "",
            "connection_name": provider.get("name") or provider.get("id") or "",
            "connection_id": payload.connection_id or "",
            "model_id": payload.model_id or "",
            "resource_id": payload.resource_id or "",
            "task_id": task_id,
            "request_id": raw.get("id") if isinstance(raw, dict) else "",
            "params": {"connection_id": provider.get("connection_id") or provider.get("id") or "", "resource_id": payload.resource_id or ""},
            "raw": raw,
        }
        await asyncio.to_thread(save_to_history, result)
        if GLOBAL_LOOP:
            asyncio.run_coroutine_threadsafe(manager.broadcast_new_image(result, current_user_id()), GLOBAL_LOOP)
        return result
    if status in IMAGE_TASK_FAILED_STATUSES:
        return {
            "status": "failed",
            "task_id": task_id,
            "connection_id": provider.get("connection_id") or provider.get("id") or "",
            "connection_name": provider.get("name") or provider.get("id") or "",
            "error": image_task_fail_reason(raw),
            "raw": raw,
        }
    return {
        "status": "running",
        "task_id": task_id,
        "connection_id": provider.get("connection_id") or provider.get("id") or "",
        "connection_name": provider.get("name") or provider.get("id") or "",
        "message": "任务仍在生成中",
        "raw": raw,
    }

async def canvas_task_lease_heartbeat(task_id: str, lease_token: str):
    interval = max(5, REDIS_CANVAS_TASK_RECOVERY_INTERVAL_SECONDS)
    while True:
        await asyncio.sleep(interval)
        if not await refresh_canvas_task_lease(task_id, lease_token):
            return


async def run_canvas_image_task(task_id: str, payload: OnlineImageRequest):
    lease_token = await claim_canvas_task(task_id, CLIENT_ID)
    if not lease_token:
        return
    bind_log_context(task_id=task_id)
    started = time.perf_counter()
    task_logger.info(
        "canvas image task started",
        extra={"event": "task_started", "connection_id": payload.connection_id, "model_id": payload.model_id, "resource_id": payload.resource_id, "operation": "image_generation", "status": "running"},
    )
    if not await update_claimed_canvas_task(task_id, lease_token, status="running"):
        await release_canvas_task_claim(task_id, lease_token)
        return
    lease_heartbeat = asyncio.create_task(canvas_task_lease_heartbeat(task_id, lease_token))
    try:
        result = await build_online_image_result(payload)
        try:
            quota_warning = await run_storage_io(check_storage_quota, 1, category="output")
        except Exception:
            quota_warning = None
        upstream_task_id = str((result.get("task_id") if isinstance(result, dict) else "") or "")
        task_data = {"status": "succeeded", "result": result, "error": "", "upstream_task_id": upstream_task_id}
        if quota_warning:
            task_data["quota_warning"] = quota_warning
        await update_claimed_canvas_task(task_id, lease_token, **task_data)
        task_logger.info(
            "canvas image task completed",
            extra={"event": "task_completed", "connection_id": payload.connection_id, "model_id": payload.model_id, "resource_id": payload.resource_id, "operation": "image_generation", "status": "succeeded", "upstream_task_id": upstream_task_id, "duration_ms": round((time.perf_counter() - started) * 1000, 2)},
        )
    except Exception as exc:
        detail = getattr(exc, "detail", None) or str(exc)
        status_code = getattr(exc, "status_code", 413 if isinstance(exc, StorageQuotaExceeded) else 500)
        budget_error = detail if isinstance(detail, dict) and detail.get("error_code") == "usage_budget_exceeded" else None
        upstream_task_id = getattr(exc, "upstream_task_id", "") or extract_task_id_from_text(detail)
        failure = {
            "status": "failed",
            "error": str((budget_error or {}).get("message") or detail),
            "status_code": status_code,
            "upstream_task_id": upstream_task_id,
            "updated_at": time.time(),
        }
        if budget_error:
            failure.update({
                "error_code": "usage_budget_exceeded",
                "contact_admin": bool(budget_error.get("contact_admin", True)),
            })
        if isinstance(exc, StorageQuotaExceeded):
            failure.update({
                "error_code": "storage_quota_exceeded",
                "quota_bytes": exc.quota_bytes,
                "used_bytes": exc.used_bytes,
                "incoming_bytes": exc.incoming_bytes,
            })
        await update_claimed_canvas_task(task_id, lease_token, **failure)
        task_logger.exception(
            "canvas image task failed",
            extra={"event": "task_failed", "connection_id": payload.connection_id, "model_id": payload.model_id, "resource_id": payload.resource_id, "operation": "image_generation", "status": "failed", "error_type": type(exc).__name__, "duration_ms": round((time.perf_counter() - started) * 1000, 2)},
        )
    finally:
        lease_heartbeat.cancel()
        await release_canvas_task_claim(task_id, lease_token)

@app.post("/api/canvas-image-tasks")
async def create_canvas_image_task(payload: OnlineImageRequest):
    payload = await asyncio.to_thread(normalize_canvas_image_request, payload)
    if not (payload.resource_id or payload.model_id or payload.connection_id):
        raise HTTPException(status_code=400, detail="图片任务必须指定 model_id、connection_id 或 resource_id")
    stable_connection_id = str(payload.connection_id or "").strip()
    resolved_connection_id = stable_connection_id
    if payload.resource_id:
        from app.ai.database_repository import DatabaseAIRepository
        try:
            target_resource = await asyncio.to_thread(DatabaseAIRepository().resolve_executable, resource_id=payload.resource_id)
        except LookupError as exc:
            raise HTTPException(status_code=404, detail="图片执行资源不存在或已禁用") from exc
        resolved_connection_id = target_resource.connection.id
        payload = payload.model_copy(update={
            "connection_id": target_resource.connection.id,
        })
    if payload.model_id or stable_connection_id:
        from app.ai.database_repository import DatabaseAIRepository
        try:
            target = await asyncio.to_thread(
                DatabaseAIRepository().resolve_model,
                model_id=payload.model_id,
                connection_id=stable_connection_id,
                model=payload.model,
                kind="image",
            )
        except LookupError as exc:
            raise HTTPException(status_code=404, detail="图片模型资源不存在或已禁用") from exc
        else:
            payload = payload.model_copy(update={
                "model_id": target.model.id if target.model else payload.model_id,
                "model": target.model.upstream_model if target.model else payload.model,
                "connection_id": target.connection.id,
            })
            resolved_connection_id = target.connection.id
    if not resolved_connection_id:
        raise HTTPException(status_code=400, detail="图片任务未解析到有效连接")
    await assert_provider_budget_available(canonical_connection_view(target if 'target' in locals() else target_resource), current_user_id())
    def canonical_request_snapshot(value: BaseModel) -> dict[str, Any]:
        snapshot = value.model_dump(mode="json")
        # Stable IDs are the persisted task contract. Legacy provider/model
        # values are reconstructed in-memory by the worker for protocol adapters.
        for key in ("provider_id", "provider", "model"):
            snapshot.pop(key, None)
        return snapshot

    resource_meta = {
        "connection_id": resolved_connection_id or str(payload.connection_id or "").strip(),
        "model_id": payload.model_id or "",
        "resource_id": payload.resource_id or "",
    }
    owner_id = current_user_id()
    count = max(1, min(8, int(payload.n or 1)))
    if not (resource_meta.get("connection_id") or resource_meta.get("model_id") or resource_meta.get("resource_id")):
        raise HTTPException(status_code=400, detail="图片任务必须指定有效的 connection_id 或 model_id")
    if count > 1:
        parent_task_id = f"canvas_img_batch_{uuid.uuid4().hex}"
        child_tasks = []
        child_request = canonical_request_snapshot(payload.model_copy(update={"n": 1}))
        for index in range(count):
            child_task_id = f"canvas_img_{uuid.uuid4().hex}"
            child_tasks.append(child_task_id)
            await create_canvas_task({
                "id": child_task_id,
                "type": "online-image",
                "status": "queued",
                "created_at": time.time(),
                "updated_at": time.time(),
                "result": None,
                "error": "",
                **resource_meta,
                "owner_id": owner_id,
                "parent_task_id": parent_task_id,
                "child_index": index,
                "request": child_request,
            })
        # The parent is metadata only. It is never enqueued, so recovery does
        # not try to execute it as an image-generation task.
        await create_canvas_task({
            "id": parent_task_id,
            "type": "online-image-batch",
            "status": "batching",
            "created_at": time.time(),
            "updated_at": time.time(),
            "result": None,
            "error": "",
            **resource_meta,
            "owner_id": owner_id,
            "child_task_ids": child_tasks,
            "request": canonical_request_snapshot(payload),
        })
        for child_task_id in child_tasks:
            await enqueue_canvas_task(child_task_id)
        task_logger.info(
            "canvas image batch submitted",
            extra={"event": "task_batch_submitted", "task_id": parent_task_id, "connection_id": resolved_connection_id, "model_id": payload.model_id, "resource_id": payload.resource_id, "operation": "image_generation", "status": "queued", "count": count},
        )
        return {"task_id": parent_task_id, "child_task_ids": child_tasks, "status": "queued", "count": count}

    task_id = f"canvas_img_{uuid.uuid4().hex}"
    await create_canvas_task({
            "id": task_id,
            "type": "online-image",
            "status": "queued",
            "created_at": time.time(),
            "updated_at": time.time(),
            "result": None,
            "error": "",
            **resource_meta,
            "owner_id": owner_id,
            "request": canonical_request_snapshot(payload),
        })
    task_logger.info(
        "canvas image task submitted",
        extra={"event": "task_submitted", "task_id": task_id, "connection_id": resolved_connection_id, "model_id": payload.model_id, "resource_id": payload.resource_id, "operation": "image_generation", "status": "queued"},
    )
    await enqueue_canvas_task(task_id)
    return {"task_id": task_id, "status": "queued", "count": count}


async def _canvas_image_batch_view(task: dict):
    child_ids = [str(task_id) for task_id in task.get("child_task_ids") or [] if task_id]
    children = await asyncio.gather(*(get_canvas_task(task_id) for task_id in child_ids))
    completed = [child for child in children if child and child.get("status") in {"succeeded", "failed", "interrupted"}]
    images = []
    image_items = []
    failures = []
    for child in children:
        if not child:
            continue
        result = child.get("result") if isinstance(child.get("result"), dict) else {}
        images.extend(result.get("images") or [])
        image_items.extend(result.get("image_items") or [])
        if child.get("status") in {"failed", "interrupted"}:
            failures.append({"task_id": child.get("id"), "error": child.get("error") or "任务失败"})
    if len(completed) < len(child_ids):
        status = "running" if any(child and child.get("status") == "running" for child in children) else "queued"
    elif images:
        status = "succeeded"
    else:
        status = "failed"
    return {
        **task,
        "status": status,
        "result": {"images": images, "image_items": image_items, "failed_children": failures},
        "completed_children": len(completed),
        "total_children": len(child_ids),
        "failed_children": failures,
    }


@app.get("/api/canvas-image-tasks/{task_id}")
async def get_canvas_image_task(task_id: str):
    task = await get_canvas_task(task_id)
    if not task:
        raise HTTPException(status_code=404, detail="画布任务不存在，可能服务已重启或任务已过期")
    if task.get("owner_id") != current_user_id() and not access_control.is_admin(current_user_id()):
        raise HTTPException(status_code=403, detail="无权查看其他用户的画布任务。")
    if task.get("type") == "online-image-batch":
        task = await _canvas_image_batch_view(task)
    task.pop("request", None)
    return task

async def run_canvas_comfy_task(task_id: str, payload: GenerateRequest):
    lease_token = await claim_canvas_task(task_id, CLIENT_ID)
    if not lease_token:
        return
    bind_log_context(task_id=task_id)
    started = time.perf_counter()
    task_logger.info("canvas ComfyUI task started", extra={"event": "task_started", "connection_id": payload.connection_id, "resource_id": payload.resource_id, "operation": "image_generation", "status": "running"})
    if not await update_claimed_canvas_task(task_id, lease_token, status="running"):
        await release_canvas_task_claim(task_id, lease_token)
        return
    lease_heartbeat = asyncio.create_task(canvas_task_lease_heartbeat(task_id, lease_token))
    try:
        from app.ai.adapters.comfyui_workflow import ComfyUIWorkflowAdapter
        from app.ai.contracts import Actor, WorkflowCommand
        try:
            comfy_target = await asyncio.to_thread(
                DatabaseAIRepository().resolve_executable,
                resource_id=payload.resource_id,
                connection_id=payload.connection_id,
                kind="comfyui_workflow",
            )
        except LookupError as exc:
            raise ValueError("ComfyUI 工作流资源不存在或已禁用") from exc

        async def execute_workflow(_target, inputs):
            return await asyncio.to_thread(generate, GenerateRequest.model_validate(inputs))

        adapter = ComfyUIWorkflowAdapter(execute_workflow)
        result = await adapter.execute(
            comfy_target,
            WorkflowCommand(comfy_target, payload.model_dump(mode="json")),
            actor=Actor(user_id=current_user_id()),
        )
        if isinstance(result, dict) and result.get("error"):
            raise RuntimeError(str(result.get("error") or "ComfyUI 生成失败"))
        try:
            quota_warning = await run_storage_io(check_storage_quota, 1, category="output")
        except Exception:
            quota_warning = None
        upstream_task_id = str((result.get("task_id") or result.get("prompt_id") if isinstance(result, dict) else "") or "")
        task_data = {"status": "succeeded", "result": result, "error": "", "upstream_task_id": upstream_task_id}
        if quota_warning:
            task_data["quota_warning"] = quota_warning
        await update_claimed_canvas_task(task_id, lease_token, **task_data)
        task_logger.info(
            "canvas ComfyUI task completed",
            extra={"event": "task_completed", "connection_id": payload.connection_id, "resource_id": payload.resource_id, "operation": "image_generation", "status": "succeeded", "upstream_task_id": upstream_task_id, "duration_ms": round((time.perf_counter() - started) * 1000, 2)},
        )
    except Exception as exc:
        detail = getattr(exc, "detail", None) or str(exc)
        status_code = getattr(exc, "status_code", 413 if isinstance(exc, StorageQuotaExceeded) else 500)
        failure = {
            "status": "failed",
            "error": str(detail),
            "status_code": status_code,
            "updated_at": time.time(),
        }
        if isinstance(exc, StorageQuotaExceeded):
            failure.update({
                "error_code": "storage_quota_exceeded",
                "quota_bytes": exc.quota_bytes,
                "used_bytes": exc.used_bytes,
                "incoming_bytes": exc.incoming_bytes,
            })
        await update_claimed_canvas_task(task_id, lease_token, **failure)
        task_logger.exception(
            "canvas ComfyUI task failed",
            extra={"event": "task_failed", "connection_id": payload.connection_id, "resource_id": payload.resource_id, "operation": "image_generation", "status": "failed", "error_type": type(exc).__name__, "duration_ms": round((time.perf_counter() - started) * 1000, 2)},
        )
    finally:
        lease_heartbeat.cancel()
        await release_canvas_task_claim(task_id, lease_token)

@app.post("/api/canvas-comfy-tasks")
async def create_canvas_comfy_task(payload: GenerateRequest):
    if not (payload.resource_id or payload.connection_id):
        raise HTTPException(status_code=400, detail="ComfyUI 任务必须指定 resource_id 或 connection_id")
    from app.ai.database_repository import DatabaseAIRepository
    try:
        target = await asyncio.to_thread(DatabaseAIRepository().resolve_executable, resource_id=payload.resource_id, connection_id=payload.connection_id, kind="comfyui_workflow")
    except LookupError as exc:
        raise HTTPException(status_code=404, detail="ComfyUI 工作流资源不存在或已禁用") from exc
    payload = payload.model_copy(update={"connection_id": target.connection.id, "resource_id": target.resource.id})
    request_snapshot = payload.model_dump(mode="json")
    for key in ("provider_id", "provider", "model"):
        request_snapshot.pop(key, None)
    task_id = f"canvas_comfy_{uuid.uuid4().hex}"
    owner_id = current_user_id()
    await create_canvas_task({
            "id": task_id,
            "type": "comfy",
            "status": "queued",
            "created_at": time.time(),
            "updated_at": time.time(),
            "result": None,
            "error": "",
            "workflow_json": payload.workflow_json,
            "connection_id": payload.connection_id,
            "resource_id": payload.resource_id,
            "model_id": payload.model_id,
            "owner_id": owner_id,
            "request": request_snapshot,
        })
    task_logger.info(
        "canvas ComfyUI task submitted",
        extra={"event": "task_submitted", "task_id": task_id, "connection_id": payload.connection_id, "resource_id": payload.resource_id, "operation": "image_generation", "status": "queued"},
    )
    await enqueue_canvas_task(task_id)
    return {"task_id": task_id, "status": "queued"}

@app.get("/api/canvas-comfy-tasks/{task_id}")
async def get_canvas_comfy_task(task_id: str):
    task = await get_canvas_task(task_id)
    if not task:
        raise HTTPException(status_code=404, detail="ComfyUI 任务不存在，可能服务已重启或任务已过期")
    if task.get("owner_id") != current_user_id() and not access_control.is_admin(current_user_id()):
        raise HTTPException(status_code=403, detail="无权查看其他用户的画布任务。")
    task.pop("request", None)
    return task


class CanvasRunningHubKeyBusy(RuntimeError):
    """Raised when RunningHub returns code 804 (API key already running a task)."""


async def run_canvas_runninghub_task(task_id: str, payload: RunningHubSubmitRequest):
    """Execute a canvas RunningHub app task inside the worker.

    Mirrors run_canvas_comfy_task: the worker submits to the upstream and then
    polls until terminal. The upstream taskId is persisted as soon as it is
    known so a crash-recovered run can resume polling (query) instead of
    resubmitting (which would double-charge). A code 804 (API key busy) is a
    terminal failure surfaced to the client via a toast.
    """
    lease_token = await claim_canvas_task(task_id, CLIENT_ID)
    if not lease_token:
        return
    bind_log_context(task_id=task_id)
    started = time.perf_counter()
    task = await get_canvas_task(task_id)
    existing_upstream_task_id = str((task or {}).get("upstream_task_id") or "").strip()
    user_id = str((task or {}).get("owner_id") or current_user_id())
    connection_id = str(payload.connection_id or "")
    resource_id = str(payload.resource_id or "")
    task_logger.info(
        "canvas RunningHub task started",
        extra={"event": "task_started", "connection_id": connection_id, "resource_id": resource_id, "operation": "app_generation", "status": "running", "upstream_task_id": existing_upstream_task_id},
    )
    if not await update_claimed_canvas_task(task_id, lease_token, status="running"):
        await release_canvas_task_claim(task_id, lease_token)
        return
    lease_heartbeat = asyncio.create_task(canvas_task_lease_heartbeat(task_id, lease_token))
    try:
        from app.ai.database_repository import DatabaseAIRepository
        from app.ai.adapters.runninghub_transport import RunningHubTransport
        from app.services.usage import record_runninghub_submission, settle_runninghub_usage
        try:
            selected_resource = await asyncio.to_thread(
                DatabaseAIRepository().resolve_executable,
                resource_id=resource_id, connection_id=connection_id, kind="runninghub_app",
            )
        except LookupError as exc:
            raise ValueError("RunningHub 资源不存在或已禁用") from exc
        provider = canonical_connection_view(selected_resource)
        settings = dict(selected_resource.resource.settings if selected_resource.resource else {})
        # The persisted resource is authoritative. A request value can be a
        # stale/internal resource id and must never be sent upstream.
        webapp_id = str(settings.get("app_id") or "").strip()
        if not webapp_id:
            raise ValueError("RunningHub 资源缺少规范 app_id")
        api_key = await runninghub_api_key_async(provider)
        transport = RunningHubTransport(endpoint=runninghub_endpoint_url, headers=lambda key, body: runninghub_protocol_headers(key, json_body=body), client_factory=shared_http_client, timeout=httpx.Timeout(connect=20.0, read=240.0, write=120.0, pool=20.0))

        upstream_task_id = existing_upstream_task_id
        # Only submit when this run has no upstream task yet. A recovered run
        # already carries the upstream id and resumes at the polling stage.
        if not upstream_task_id:
            body = {"apiKey": api_key, "webappId": webapp_id, "nodeInfoList": payload.nodeInfoList or []}
            instance_type = str(payload.instanceType or "").strip()
            if instance_type:
                body["instanceType"] = instance_type
            async with connection_operation(str(provider.get("connection_id") or provider.get("id") or "runninghub"), "app_generation", user_id=user_id):
                raw = await transport.submit(provider, api_key, body)
            if isinstance(raw, dict) and raw.get("code") in (804, "804"):
                raise CanvasRunningHubKeyBusy("RunningHub 正在执行当前 API Key 的其他任务，请稍后重试。")
            if not (isinstance(raw, dict) and raw.get("code") in (0, "0")):
                raise RuntimeError((raw.get("msg") if isinstance(raw, dict) else "") or f"RunningHub 提交失败：{raw}")
            upstream_task_id = raw.get("data", {}).get("taskId") if isinstance(raw.get("data"), dict) else ""
            if not upstream_task_id:
                raise RuntimeError(f"RunningHub 未返回 taskId：{raw}")
            # Persist the upstream id immediately so recovery can resume polling.
            await update_claimed_canvas_task(task_id, lease_token, upstream_task_id=str(upstream_task_id))
            await asyncio.to_thread(
                record_runninghub_submission, user_id, str(upstream_task_id),
                operation="ai_app", model=webapp_id,
                connection_id=selected_resource.connection.id if selected_resource else "",
                resource_id=resource_id,
            )

        # Poll the upstream inside the worker until terminal or timeout.
        deadline = time.monotonic() + CANVAS_RUNNINGHUB_POLL_TIMEOUT_SECONDS
        raw = None
        status = "RUNNING"
        urls: list[str] = []
        media_items: list[dict] = []
        while time.monotonic() < deadline:
            if not await refresh_canvas_task_lease(task_id, lease_token):
                # Lost the lease; a recovered worker owns this task now.
                return
            raw = await transport.query(provider, api_key, str(upstream_task_id))
            code = raw.get("code") if isinstance(raw, dict) else None
            urls = []
            media_items = []
            for remote in runninghub_extract_outputs(raw.get("data") if isinstance(raw, dict) else raw):
                ext = runninghub_output_ext(remote)
                kind = runninghub_output_kind(ext)
                async with shared_http_client(timeout=httpx.Timeout(connect=20.0, read=240.0, write=30.0, pool=20.0)) as client:
                    local_url = await runninghub_store_remote_output(client, remote)
                urls.append(local_url)
                media_items.append(await run_storage_io(media_response_item, local_url, "", kind))
            status = runninghub_normalized_status(raw, code, urls)
            if status in {"SUCCESS", "FAILED"}:
                break
            await asyncio.sleep(min(CANVAS_RUNNINGHUB_POLL_INTERVAL_SECONDS, max(0.0, deadline - time.monotonic())))

        await asyncio.to_thread(
            settle_runninghub_usage, user_id, str(upstream_task_id), raw,
            status=status, operation="ai_app", connection_id=connection_id, resource_id=resource_id,
        )
        if status == "SUCCESS":
            try:
                quota_warning = await run_storage_io(check_storage_quota, 1, category="output")
            except Exception:
                quota_warning = None
            result = {"status": status, "urls": urls, "media_items": media_items, "image_items": media_items, "code": raw.get("code") if isinstance(raw, dict) else None}
            task_data = {"status": "succeeded", "result": result, "error": "", "upstream_task_id": str(upstream_task_id)}
            if quota_warning:
                task_data["quota_warning"] = quota_warning
            await update_claimed_canvas_task(task_id, lease_token, **task_data)
            task_logger.info(
                "canvas RunningHub task completed",
                extra={"event": "task_completed", "connection_id": connection_id, "resource_id": resource_id, "operation": "app_generation", "status": "succeeded", "upstream_task_id": str(upstream_task_id), "output_count": len(urls), "duration_ms": round((time.perf_counter() - started) * 1000, 2)},
            )
        elif status == "FAILED":
            raise RuntimeError(str(runninghub_fail_reason(raw) or "RunningHub 任务失败"))
        else:
            raise TimeoutError(f"RunningHub 任务超时：{upstream_task_id}")
    except CanvasRunningHubKeyBusy as exc:
        await update_claimed_canvas_task(
            task_id, lease_token, status="failed", error=str(exc),
            error_code="runninghub_key_busy", status_code=409,
            upstream_task_id=existing_upstream_task_id, updated_at=time.time(),
        )
        task_logger.warning(
            "canvas RunningHub task failed (key busy)",
            extra={"event": "task_failed", "connection_id": connection_id, "resource_id": resource_id, "operation": "app_generation", "status": "failed", "error_code": "runninghub_key_busy", "duration_ms": round((time.perf_counter() - started) * 1000, 2)},
        )
    except Exception as exc:
        detail = getattr(exc, "detail", None) or str(exc)
        status_code = getattr(exc, "status_code", 500)
        await update_claimed_canvas_task(
            task_id, lease_token, status="failed", error=str(detail),
            status_code=status_code, upstream_task_id=str(existing_upstream_task_id or ""), updated_at=time.time(),
        )
        task_logger.exception(
            "canvas RunningHub task failed",
            extra={"event": "task_failed", "connection_id": connection_id, "resource_id": resource_id, "operation": "app_generation", "status": "failed", "error_type": type(exc).__name__, "duration_ms": round((time.perf_counter() - started) * 1000, 2)},
        )
    finally:
        lease_heartbeat.cancel()
        await release_canvas_task_claim(task_id, lease_token)


@app.post("/api/canvas-runninghub-tasks")
async def create_canvas_runninghub_task(payload: RunningHubSubmitRequest):
    if not (payload.resource_id or payload.connection_id):
        raise HTTPException(status_code=400, detail="RunningHub 任务必须指定 resource_id 或 connection_id")
    from app.ai.database_repository import DatabaseAIRepository
    try:
        selected_resource = await asyncio.to_thread(
            DatabaseAIRepository().resolve_executable,
            resource_id=payload.resource_id, connection_id=payload.connection_id, kind="runninghub_app",
        )
    except LookupError as exc:
        raise HTTPException(status_code=404, detail="RunningHub 资源不存在或已禁用") from exc
    settings = dict(selected_resource.resource.settings if selected_resource.resource else {})
    # The persisted resource is authoritative. A request value can be a
    # stale/internal resource id and must never be sent upstream.
    webapp_id = str(settings.get("app_id") or "").strip()
    if not webapp_id:
        raise HTTPException(status_code=400, detail="webappId 必填")
    provider = canonical_connection_view(selected_resource)
    await assert_provider_budget_available(provider, current_user_id())
    connection_id = selected_resource.connection.id
    resource_id = payload.resource_id or ""
    request_snapshot = {
        "webappId": webapp_id,
        "nodeInfoList": payload.nodeInfoList or [],
        "instanceType": str(payload.instanceType or "").strip(),
        "connection_id": connection_id,
        "resource_id": resource_id,
    }
    task_id = f"canvas_rh_{uuid.uuid4().hex}"
    owner_id = current_user_id()
    await create_canvas_task({
        "id": task_id,
        "type": "online-runninghub",
        "status": "queued",
        "created_at": time.time(),
        "updated_at": time.time(),
        "result": None,
        "error": "",
        "connection_id": connection_id,
        "resource_id": resource_id,
        "owner_id": owner_id,
        "request": request_snapshot,
    })
    task_logger.info(
        "canvas RunningHub task submitted",
        extra={"event": "task_submitted", "task_id": task_id, "connection_id": connection_id, "resource_id": resource_id, "operation": "app_generation", "status": "queued"},
    )
    await enqueue_canvas_task(task_id)
    return {"task_id": task_id, "status": "queued"}


@app.get("/api/canvas-runninghub-tasks/{task_id}")
async def get_canvas_runninghub_task(task_id: str):
    task = await get_canvas_task(task_id)
    if not task:
        raise HTTPException(status_code=404, detail="RunningHub 任务不存在，可能服务已重启或任务已过期")
    if task.get("owner_id") != current_user_id() and not access_control.is_admin(current_user_id()):
        raise HTTPException(status_code=403, detail="无权查看其他用户的画布任务。")
    task.pop("request", None)
    return task


@app.get("/api/admin/canvas-task-dead-letters")
async def admin_list_canvas_task_dead_letters(limit: int = 100):
    require_user_management_access()
    return {"items": await list_dead_letter_canvas_tasks(limit)}


@app.post("/api/admin/canvas-task-dead-letters/{entry_id}/retry")
async def admin_retry_canvas_task_dead_letter(entry_id: str):
    require_user_management_access()
    entries = await list_dead_letter_canvas_tasks(500)
    entry = next((item for item in entries if item.get("entry_id") == entry_id), None)
    if not entry or not entry.get("task_id"):
        raise HTTPException(status_code=404, detail="死信任务不存在")
    task = await get_canvas_task(entry["task_id"])
    if not task or not isinstance(task.get("request"), dict):
        raise HTTPException(status_code=409, detail="原始任务已过期或缺少可重试请求")
    if not any(str(task.get(key) or task["request"].get(key) or "").strip() for key in ("connection_id", "model_id", "resource_id")):
        raise HTTPException(status_code=409, detail="任务缺少已迁移的 connection_id/model_id/resource_id，无法重试")
    await update_canvas_task(task["id"], status="queued", error="", retry_requested_at=time.time())
    await enqueue_canvas_task(task["id"])
    await remove_dead_letter_canvas_task(entry_id)
    audit_event("canvas_task_dead_letter_retried", action="retry", resource_type="canvas_task", resource_id=task["id"])
    return {"task_id": task["id"], "status": "queued"}


@app.delete("/api/admin/canvas-task-dead-letters/{entry_id}")
async def admin_cancel_canvas_task_dead_letter(entry_id: str):
    require_user_management_access()
    entries = await list_dead_letter_canvas_tasks(500)
    entry = next((item for item in entries if item.get("entry_id") == entry_id), None)
    if not entry:
        raise HTTPException(status_code=404, detail="死信任务不存在")
    task_id = entry.get("task_id") or ""
    if task_id:
        await update_canvas_task(task_id, status="cancelled", error="管理员已取消死信任务")
    await remove_dead_letter_canvas_task(entry_id)
    audit_event("canvas_task_dead_letter_cancelled", action="delete", resource_type="canvas_task", resource_id=task_id)
    return {"ok": True}


async def recover_canvas_tasks_once():
    for task in await list_recoverable_canvas_tasks():
        if task.get("status") == "running":
            if not await has_canvas_task_claim(task["id"]):
                # RunningHub app tasks can be safely resumed: the upstream query
                # is idempotent, so a run that already submitted (has an upstream
                # task id) re-polls instead of resubmitting (no double charge).
                if task.get("type") == "online-runninghub" and str(task.get("upstream_task_id") or "").strip() and isinstance(task.get("request"), dict):
                    requeued = await update_canvas_task(task["id"], expected_status="running", status="queued")
                    if requeued:
                        try:
                            await enqueue_canvas_task(task["id"])
                        except Exception:
                            logger.exception("canvas task recovery failed", extra={"event": "task_recovery_failed", "task_id": task.get("id")})
                    continue
                await update_canvas_task(
                    task["id"], expected_status="running", status="interrupted",
                    error="执行 worker 已失联；为避免重复提交上游任务，未自动重试。",
                )
            continue
        request = task.get("request")
        if not isinstance(request, dict):
            await update_canvas_task(task["id"], expected_status="queued", status="failed", error="任务恢复数据缺失")
            continue
        try:
            await enqueue_canvas_task(task["id"])
        except Exception:
            logger.exception("canvas task recovery failed", extra={"event": "task_recovery_failed", "task_id": task.get("id")})


async def canvas_task_recovery_loop():
    while True:
        try:
            await recover_canvas_tasks_once()
        except RedisUnavailableError:
            logger.exception("canvas task recovery storage unavailable", extra={"event": "task_recovery_storage_failed"})
        except Exception:
            logger.exception("canvas task recovery loop failed", extra={"event": "task_recovery_failed"})
        await asyncio.sleep(REDIS_CANVAS_TASK_RECOVERY_INTERVAL_SECONDS)


async def execute_canvas_task(task_id: str):
    task = await get_canvas_task(task_id)
    if not task or task.get("status") != "queued":
        return
    deadline = float(task.get("deadline_at") or 0)
    if deadline and time.time() >= deadline:
        await update_canvas_task(task_id, expected_status="queued", status="timed_out", error="任务超过执行时限")
        return
    request = task.get("request")
    if not isinstance(request, dict):
        await update_canvas_task(task_id, expected_status="queued", status="failed", error="任务执行数据缺失")
        return
    # Worker execution is stable-ID only after the final cutover. Historical
    # tasks without migrated IDs are failed explicitly by the migration gate.
    try:
        from app.ai.database_repository import DatabaseAIRepository
        database_repository = DatabaseAIRepository()
        runtime_request = dict(request)
        if task.get("type") == "online-image":
            stable_model_id = str(task.get("model_id") or request.get("model_id") or "")
            if not stable_model_id:
                raise LookupError("历史图片任务缺少已迁移的 model_id")
            resolved = await asyncio.to_thread(
                database_repository.resolve_model,
                model_id=stable_model_id,
                connection_id=str(task.get("connection_id") or request.get("connection_id") or ""),
                model=str(task.get("model") or request.get("model") or ""),
                kind="image",
            )
            task_updates = {
                "connection_id": resolved.connection.id,
                "model_id": resolved.model.id if resolved.model else "",
            }
            # Keep both persisted and in-memory requests canonical. The image
            # gateway resolves the upstream model from model_id at execution.
            runtime_request = {**request, **{k: v for k, v in task_updates.items() if v}}
            canonical_request = dict(request)
            for key in ("provider_id", "provider", "model"):
                canonical_request.pop(key, None)
            canonical_request.update({k: v for k, v in task_updates.items() if v})
            await update_canvas_task(task_id, **task_updates, request=canonical_request)
        elif task.get("type") == "comfy":
            if not (task.get("resource_id") or request.get("resource_id")):
                raise LookupError("历史 ComfyUI 任务缺少已迁移的 resource_id")
            resolved = await asyncio.to_thread(
                database_repository.resolve_executable,
                resource_id=str(task.get("resource_id") or request.get("resource_id") or ""),
                kind="comfyui_workflow",
            )
            await update_canvas_task(task_id, connection_id=resolved.connection.id, resource_id=resolved.resource.id if resolved.resource else "")
        elif task.get("type") == "online-runninghub":
            if not (task.get("resource_id") or request.get("resource_id") or task.get("connection_id") or request.get("connection_id")):
                raise LookupError("RunningHub 任务缺少 resource_id 或 connection_id")
            resolved = await asyncio.to_thread(
                database_repository.resolve_executable,
                resource_id=str(task.get("resource_id") or request.get("resource_id") or ""),
                connection_id=str(task.get("connection_id") or request.get("connection_id") or ""),
                kind="runninghub_app",
            )
            await update_canvas_task(task_id, connection_id=resolved.connection.id, resource_id=resolved.resource.id if resolved.resource else "")
    except LookupError as exc:
        await update_canvas_task(task_id, expected_status="queued", status="failed", error=f"任务资源解析失败：{exc}")
        return
    owner_id = str(task.get("owner_id") or "")
    username = str(task.get("username") or (USERS.get(owner_id) or {}).get("username") or owner_id)
    context_token = current_user_var.set(owner_id)
    log_token = set_log_context(
        request_id=task.get("request_id"),
        trace_id=task.get("trace_id"),
        user_id=owner_id or None,
        username=username or None,
        task_id=task_id,
        run_id=task.get("run_id") or task.get("agent_run_id") or None,
        operation_id=task.get("operation_id") or task_id,
    )
    try:
        timeout = max(1.0, deadline - time.time()) if deadline else CANVAS_TASK_TIMEOUT_SECONDS
        # RunningHub app tasks poll the upstream inside the worker for up to
        # CANVAS_RUNNINGHUB_POLL_TIMEOUT_SECONDS, so the wrapper must not kill
        # them earlier than that.
        if task.get("type") == "online-runninghub":
            timeout = max(timeout, CANVAS_RUNNINGHUB_POLL_TIMEOUT_SECONDS + 60)
        try:
            if task.get("type") == "online-image":
                await asyncio.wait_for(run_canvas_image_task(task_id, OnlineImageRequest.model_validate(runtime_request)), timeout=timeout)
            elif task.get("type") == "comfy":
                await asyncio.wait_for(run_canvas_comfy_task(task_id, GenerateRequest.model_validate(request)), timeout=timeout)
            elif task.get("type") == "online-runninghub":
                await asyncio.wait_for(run_canvas_runninghub_task(task_id, RunningHubSubmitRequest.model_validate(request)), timeout=timeout)
            else:
                await update_canvas_task(task_id, expected_status="queued", status="failed", error="不支持的画布任务类型")
        except asyncio.TimeoutError:
            await update_canvas_task(task_id, expected_status="running", status="timed_out", error="任务超过执行时限")
    finally:
        reset_log_context(log_token)
        current_user_var.reset(context_token)


async def _canvas_task_consumer_loop(consumer_id: str):
    while True:
        try:
            messages = await reclaim_canvas_task_messages(consumer_id)
            if not messages:
                messages = await dequeue_canvas_tasks(consumer_id)
            for message_id, task_id in messages:
                try:
                    await execute_canvas_task(task_id)
                    completed = await get_canvas_task(task_id)
                    if completed and completed.get("status") in {"succeeded", "failed", "interrupted"}:
                        await asyncio.to_thread(archive_ai_task, completed)
                    await acknowledge_canvas_task(message_id)
                    await release_canvas_task_dispatch(task_id)
                except Exception as exc:
                    logger.exception("canvas task worker execution failed", extra={"event": "task_worker_failed", "task_id": task_id})
                    await dead_letter_canvas_task(message_id, task_id, str(exc))
        except RedisUnavailableError:
            logger.exception("canvas task worker storage unavailable", extra={"event": "task_worker_storage_failed"})
            await asyncio.sleep(REDIS_CANVAS_TASK_RECOVERY_INTERVAL_SECONDS)
        except Exception:
            logger.exception("canvas task worker loop failed", extra={"event": "task_worker_loop_failed"})
            await asyncio.sleep(REDIS_CANVAS_TASK_RECOVERY_INTERVAL_SECONDS)


async def canvas_task_worker_loop():
    """Consume several canvas tasks concurrently within one worker process."""
    if CANVAS_TASK_WORKER_CONCURRENCY == 1:
        await _canvas_task_consumer_loop(CLIENT_ID)
        return
    await asyncio.gather(*(
        _canvas_task_consumer_loop(f"{CLIENT_ID}:{slot}")
        for slot in range(CANVAS_TASK_WORKER_CONCURRENCY)
    ))

# --- Canvas Video ---

def video_api_root(provider):
    base_url = validate_public_http_url((provider.get("base_url") or AI_BASE_URL).rstrip("/"), label="Connection Base URL")
    return video_protocol_api_root(base_url, "volcengine" if is_volcengine_connection(provider) else "openai")

def looks_like_html_response(text: str) -> bool:
    sample = str(text or "").lstrip()[:200].lower()
    return sample.startswith("<!doctype html") or sample.startswith("<html") or "<head" in sample

def video_submit_url_candidates(provider, base_url):
    return video_protocol_submit_urls(base_url, "volcengine" if is_volcengine_connection(provider) else "openai")

def video_task_url_candidates(provider, base_url, task_id, submit_url=""):
    return video_protocol_task_urls(base_url, "volcengine" if is_volcengine_connection(provider) else "openai", task_id, submit_url)

async def wait_for_video_task(client, provider, task_id, submit_url=""):
    base_url = video_api_root(provider)
    if not base_url:
        raise HTTPException(status_code=400, detail=f"{provider['id']} 未配置 Base URL")
    task_urls = video_task_url_candidates(provider, base_url, task_id, submit_url)
    deadline = time.monotonic() + VIDEO_POLL_TIMEOUT
    delay = max(2.0, IMAGE_POLL_INTERVAL)
    last_payload = {}
    while time.monotonic() < deadline:
        await asyncio.sleep(delay)
        raw = None
        last_error = None
        for task_url in task_urls:
            try:
                response = await client.get(task_url, headers=api_headers(connection=provider))
                response.raise_for_status()
                raw = response.json()
                break
            except Exception as exc:
                last_error = exc
                continue
        if raw is None:
            if last_error:
                raise last_error
            raise HTTPException(status_code=502, detail=f"视频任务查询失败：{task_id}")
        last_payload = raw
        task_data = raw.get("data") if isinstance(raw.get("data"), dict) else raw
        status = str(task_data.get("status") or task_data.get("task_status") or raw.get("status") or raw.get("task_status") or "").upper()
        if status in VIDEO_TASK_SUCCESS_STATUSES:
            return raw
        # 部分上游 status 字段非标准或为空，但已经返回了视频 URL ——
        # 只要不是明确的失败状态，且拿到了真实视频地址，就直接当成功处理。
        if status not in VIDEO_TASK_FAILURE_STATUSES and video_output_urls(raw):
            return raw
        if status in VIDEO_TASK_FAILURE_STATUSES:
            error = task_data.get("error") if isinstance(task_data.get("error"), dict) else {}
            reason = task_data.get("fail_reason") or task_data.get("message") or error.get("message") or raw.get("error") or raw.get("message") or str(raw)
            raise HTTPException(status_code=502, detail=humanize_video_task_failure(reason))
        delay = min(delay * 1.6, 12)
    raise HTTPException(status_code=504, detail=f"视频生成任务超时：{last_payload or task_id}")

async def _canvas_video_impl(payload: CanvasVideoRequest, provider):
    base_url = video_api_root(provider)
    if not base_url:
        raise HTTPException(status_code=400, detail=f"{provider['id']} 未配置 Base URL")
    api_key = await asyncio.to_thread(connection_api_key, provider.get("connection_id") or provider["id"])
    if not api_key:
        raise HTTPException(status_code=400, detail=f"未配置 {provider['id']} 的 API Key，请在 API 设置中填写。")
    is_volcengine = is_volcengine_connection(provider)
    # The upstream model is resolved from model_id before dispatch. Keep it in
    # the transient connection context so canonical task payloads do not need
    # to persist the legacy `model` field.
    runtime_model = str(provider.get("runtime_model") or payload.model or "").strip()
    submit_urls = video_submit_url_candidates(provider, base_url)
    submit_url = submit_urls[0]
    try:
        async with shared_http_client(timeout=VIDEO_POLL_TIMEOUT) as client:
                # OpenAI-compatible data URL request
            if is_volcengine:
                text = str(payload.prompt or "").strip()
                volc_model = selected_model(runtime_model, "doubao-seedance-2-0-fast-260128")
                content = []
                # 火山方舟视频接口（含 Seedance 2.0 图生视频）均通过 body 的 duration 字段控制时长；
                # 之前对 seedance-2.0 + 参考图的情况省略了 duration，导致接口回退到默认 5s。
                resolution = volcengine_video_resolution(payload.resolution)
                image_like_urls = set()
                for ref in payload.images[:9]:
                    url = await run_storage_io(volcengine_media_reference_url, ref.url, 1536)
                    if not url:
                        continue
                    item = {
                        "type": "image_url",
                        "image_url": {"url": url},
                    }
                    role = volcengine_content_role(ref.role, "image")
                    if role:
                        item["role"] = role
                    content.append(item)
                    image_like_urls.add(url)
                for url in (payload.videos or [])[:3]:
                    text_url = str(url or "").strip()
                    if not text_url:
                        continue
                    media_url = await run_storage_io(volcengine_media_reference_url, text_url, 1536 if looks_like_image_media_url(text_url) else None)
                    if not media_url:
                        continue
                    if media_url in image_like_urls or looks_like_image_media_url(media_url):
                        content.append({
                            "type": "image_url",
                            "image_url": {"url": media_url},
                            "role": "reference_image",
                        })
                        image_like_urls.add(media_url)
                        continue
                    video_items = await volcengine_video_reference_content_items(media_url)
                    content.extend(video_items)
                for url in (payload.audios or [])[:3]:
                    audio_url = await run_storage_io(volcengine_media_reference_url, url, None)
                    if not audio_url:
                        continue
                    content.append({
                        "type": "audio_url",
                        "audio_url": {"url": audio_url},
                        "role": volcengine_content_role("", "audio"),
                    })
                body = volcengine_generation_body(
                    model=volc_model, prompt=text,
                    duration=volcengine_video_duration(payload.duration),
                    ratio=payload.aspect_ratio, resolution=resolution,
                    content=content, seed=payload.seed,
                    generate_audio=payload.generate_audio,
                )
            else:
                image_payload = []
                for ref in payload.images[:4]:
                    if ref.url:
                        image_payload.append(await run_storage_io(reference_to_data_url, ref.dict(), 1536))
                body = {
                    "prompt": payload.prompt,
                    "model": selected_model(runtime_model, "veo3-fast"),
                    "duration": payload.duration,
                }
                if payload.aspect_ratio:
                    body["aspect_ratio"] = payload.aspect_ratio
                    body["ratio"] = payload.aspect_ratio
                if payload.size:
                    body["size"] = payload.size
                if payload.resolution:
                    body["resolution"] = payload.resolution
                if image_payload:
                    body["images"] = image_payload
                if payload.videos:
                    body["videos"] = [v for v in payload.videos if v]
                if payload.seed is not None:
                    body["seed"] = payload.seed
                if payload.return_last_frame:
                    body["return_last_frame"] = True
                if payload.generate_audio:
                    body["generate_audio"] = True
            # Protocol submission and polling live in the canonical transport.
            from app.ai.adapters.video_transport import VideoTransport
            transport = VideoTransport(
                submit_urls=lambda value: video_submit_url_candidates(value, video_api_root(value)),
                headers=lambda value: api_headers(connection=value),
                client_factory=shared_http_client,
                extract_task_id=lambda value: extract_task_id(value) or value.get("task_id") or value.get("id"),
                wait_task=lambda active_client, value, task_id, submit_url: wait_for_video_task(active_client, value, task_id, submit_url),
                output_urls=video_output_urls,
                looks_like_html=looks_like_html_response,
                timeout=VIDEO_POLL_TIMEOUT,
            )
            result, task_id = await transport.generate_with_client(client, provider, body)
            urls = video_output_urls(result)
            local_urls = [await save_remote_video_to_output(url) for url in urls]
            video_items = await run_storage_io(media_response_items, local_urls, "video")
            return await _attach_quota_warning_async({"videos": local_urls, "video_items": video_items, "task_id": task_id, "raw": result})
    except httpx.HTTPStatusError as exc:
        text = exc.response.text
        try:
            requested_model = body.get("model", "") or runtime_model or ""
        except NameError:
            requested_model = runtime_model
        provider_name = provider['id']
        # 1) 模型名不在上游支持范围 → 从错误信息里抽取合法列表展示
        valid_models_match = re.search(r"not in\s*\[([^\]]+)\]", text)
        if valid_models_match:
            valid_models = [m.strip() for m in valid_models_match.group(1).split(",") if m.strip()]
            sample = valid_models[:30]
            more = f"（共 {len(valid_models)} 个，仅显示前 {len(sample)} 个）" if len(valid_models) > len(sample) else ""
            hint = (
                f"上游「{provider_name}」不识别模型「{requested_model}」。\n\n"
                f"上游支持的视频模型清单{more}：\n  {', '.join(sample)}\n\n"
                f"请到「API 设置」里把视频模型改成上面列表中的一个。"
            )
            raise HTTPException(status_code=exc.response.status_code, detail=hint) from exc
        # 2) 模型名合法但账号没开通通道
        if "channel not found" in text or "model_not_found" in text:
            hint = (
                f"上游「{provider_name}」识别了模型「{requested_model}」，但你的 API Key 账号下**没有该模型的可用通道**。\n\n"
                f"原因：你的账号没开通这个模型的访问权限（付费/订阅相关）。\n\n"
                f"解决方法：\n"
                f"  1. 登录 {provider.get('base_url') or '上游平台'} 控制台，开通该模型 / 充值；\n"
                f"  2. 或在「API 设置」里把视频模型改成你账号已开通的型号（如 veo3-fast / veo2-fast / sora-2 等）。"
            )
            raise HTTPException(status_code=exc.response.status_code, detail=hint) from exc
        if "text.duration" in text or "specified duration is not supported" in text:
            hint = (
                f"上游「{provider_name}」模型「{requested_model}」不支持当前时长参数。\n\n"
                f"不同视频模型支持的时长不一样；如果选择了模型不支持的时长，上游可能报错，"
                f"也可能自动按平台默认时长生成，例如 5 秒。\n\n"
                f"请把视频时长切回该模型支持的值，或改用支持更长时长的视频模型。"
            )
            raise HTTPException(status_code=exc.response.status_code, detail=hint) from exc
        if "inputimagesensitivecontentdetected" in text.lower() or "privacyinformation" in text.lower() or "may contain real person" in text.lower():
            hint = (
                f"上游「{provider_name}」拦截了输入参考图，原因是图片里可能包含真人身份/隐私信息。\n\n"
                f"这不是代码协议错误，而是火山视频模型的内容安全策略。\n\n"
                f"建议你这样处理：\n"
                f"  1. 改用非真人参考图，例如插画、AI 头像、商品图、场景图；\n"
                f"  2. 先把真人脸做模糊、遮挡、裁掉，或转成明显的二次元/插画风；\n"
                f"  3. 如果只是想做文生视频，先去掉参考图只保留文字提示词测试。"
            )
            raise HTTPException(status_code=exc.response.status_code, detail=hint) from exc
        raise HTTPException(status_code=exc.response.status_code, detail=f"上游视频接口错误：{text}") from exc
    except httpx.HTTPError as exc:
        raise HTTPException(status_code=502, detail=f"请求上游视频接口失败：{exc}") from exc


AI_CAPABILITY_RUNTIME = CapabilityRuntime()


async def _video_provider_adapter(payload: CanvasVideoRequest, provider: dict):
    return await _canvas_video_impl(payload, provider)


AI_CAPABILITY_RUNTIME.register("video_generation", "default", _video_provider_adapter)


@app.post("/api/canvas-video")
async def canvas_video(payload: CanvasVideoRequest):
    payload = await asyncio.to_thread(normalize_canvas_video_request, payload)
    from app.ai.database_repository import DatabaseAIRepository
    from app.ai.contracts import Actor, VideoCommand
    if not payload.model_id and not payload.connection_id:
        raise HTTPException(status_code=400, detail="视频任务必须指定 model_id 或 connection_id")
    try:
        target = await asyncio.to_thread(
            DatabaseAIRepository().resolve_model,
            model_id=payload.model_id,
            connection_id=payload.connection_id,
            model=payload.model,
            kind="video",
        )
    except LookupError as exc:
        raise HTTPException(status_code=404, detail="视频模型资源不存在或已禁用") from exc
    # Resolve the upstream model once, but keep the command payload canonical.
    # The execution handler receives the model through transient context below.
    payload = payload.model_copy(update={"model": "", "connection_id": target.connection.id})
    from app.ai.videos import VideoGateway
    runtime_provider = {
        "id": target.connection.id,
        "connection_id": target.connection.id,
        "name": target.connection.name,
        "protocol": target.protocol,
        "base_url": target.connection.base_url,
        "runtime_model": target.model.upstream_model if target.model else "",
        **dict(target.connection.settings or {}),
    }
    async def dispatch_target(command):
        return await _canvas_video_impl(payload, runtime_provider)
    gateway = VideoGateway(
        target_handler=dispatch_target,
    )
    command_payload = payload.model_dump(mode="json")
    command_payload.pop("model", None)

    # Unified task_id contract: even though video runs synchronously (no Redis
    # Streams worker), generate a local canvas task_id and write the task.log
    # lifecycle so operators can search the same way as image/ComfyUI tasks.
    # The task is created directly in ``running`` and never enqueued, so the
    # recovery scan will mark it ``interrupted`` if this process dies mid-poll
    # (matching the no-retry policy for providers that already billed upstream).
    local_task_id = f"canvas_vid_{uuid.uuid4().hex}"
    owner_id = current_user_id()
    video_resource_meta = {
        "connection_id": target.connection.id,
        "model_id": payload.model_id or "",
        "resource_id": payload.resource_id or "",
    }
    request_snapshot = payload.model_dump(mode="json")
    for _key in ("provider_id", "provider", "model"):
        request_snapshot.pop(_key, None)
    request_snapshot.update({k: v for k, v in video_resource_meta.items() if v})
    await create_canvas_task({
        "id": local_task_id,
        "type": "online-video",
        "status": "running",
        "created_at": time.time(),
        "updated_at": time.time(),
        "result": None,
        "error": "",
        **video_resource_meta,
        "owner_id": owner_id,
        "request": request_snapshot,
    })
    bind_log_context(task_id=local_task_id, operation_id=local_task_id)
    started = time.perf_counter()
    task_logger.info(
        "canvas video task started",
        extra={"event": "task_started", "task_id": local_task_id, "connection_id": target.connection.id, "model_id": payload.model_id, "operation": "video_generation", "status": "running"},
    )
    try:
        result = await gateway.generate_target(
            VideoCommand(target=target, payload=command_payload),
            actor=Actor(user_id=current_user_id()),
        )
    except Exception as exc:
        detail = getattr(exc, "detail", None) or str(exc)
        status_code = getattr(exc, "status_code", 500)
        upstream_task_id = getattr(exc, "upstream_task_id", "") or extract_task_id_from_text(detail)
        failed_record = await update_canvas_task(
            local_task_id, expected_status="running", status="failed",
            error=str(detail), status_code=status_code, upstream_task_id=upstream_task_id,
        )
        if failed_record:
            await asyncio.to_thread(archive_ai_task, failed_record)
        task_logger.exception(
            "canvas video task failed",
            extra={"event": "task_failed", "task_id": local_task_id, "connection_id": target.connection.id, "model_id": payload.model_id, "operation": "video_generation", "status": "failed", "upstream_task_id": upstream_task_id, "error_type": type(exc).__name__, "duration_ms": round((time.perf_counter() - started) * 1000, 2)},
        )
        raise
    upstream_task_id = str((result.get("task_id") if isinstance(result, dict) else "") or "")
    succeeded_record = await update_canvas_task(
        local_task_id, expected_status="running", status="succeeded",
        result=result, error="", upstream_task_id=upstream_task_id,
    )
    if succeeded_record:
        await asyncio.to_thread(archive_ai_task, succeeded_record)
    task_logger.info(
        "canvas video task completed",
        extra={"event": "task_completed", "task_id": local_task_id, "connection_id": target.connection.id, "model_id": payload.model_id, "operation": "video_generation", "status": "succeeded", "upstream_task_id": upstream_task_id, "duration_ms": round((time.perf_counter() - started) * 1000, 2)},
    )
    if isinstance(result, dict):
        return {**result, "task_id": local_task_id, "upstream_task_id": upstream_task_id}
    return result

# --- Caption Rules (per-user) ---

_CAPTION_RULES_BUILTIN = None
def _load_builtin_caption_rules():
    global _CAPTION_RULES_BUILTIN
    if _CAPTION_RULES_BUILTIN is None:
        p = os.path.join(DATA_DIR, "caption_rules_builtin.json")
        if os.path.isfile(p):
            with open(p, "r", encoding="utf-8") as f:
                _CAPTION_RULES_BUILTIN = json.load(f)
        else:
            _CAPTION_RULES_BUILTIN = []
    return _CAPTION_RULES_BUILTIN

_EXPAND_RULES_BUILTIN = None
def _load_builtin_expand_rules():
    global _EXPAND_RULES_BUILTIN
    if _EXPAND_RULES_BUILTIN is None:
        p = os.path.join(DATA_DIR, "expand_rules_builtin.json")
        if os.path.isfile(p):
            with open(p, "r", encoding="utf-8") as f:
                _EXPAND_RULES_BUILTIN = json.load(f)
        else:
            _EXPAND_RULES_BUILTIN = []
    return _EXPAND_RULES_BUILTIN


@app.get("/api/caption-rules")
def get_caption_rules():
    from app.services.business_metadata import get_user_setting
    user_rules = get_user_setting(current_user_id(), "caption_rules", [])
    return {"builtin_rules": _load_builtin_caption_rules(), "user_rules": user_rules}


@app.post("/api/caption-rules")
def save_caption_rules(payload: dict):
    from app.services.business_metadata import set_user_setting
    set_user_setting(current_user_id(), "caption_rules", payload.get("user_rules", []))
    return {"ok": True}


@app.get("/api/expand-rules")
def get_expand_rules():
    from app.services.business_metadata import get_user_setting
    user_rules = get_user_setting(current_user_id(), "expand_rules", [])
    return {"builtin_rules": _load_builtin_expand_rules(), "user_rules": user_rules}


@app.post("/api/expand-rules")
def save_expand_rules(payload: dict):
    from app.services.business_metadata import set_user_setting
    set_user_setting(current_user_id(), "expand_rules", payload.get("user_rules", []))
    return {"ok": True}


# --- Canvas LLM ---

async def _canvas_llm_impl(payload: CanvasLLMRequest):
    if not (payload.model_id or payload.connection_id):
        raise HTTPException(status_code=400, detail="Canvas LLM 请求必须指定 model_id 或 connection_id")
    _llm_provider = None
    model = ""
    chat_target = None
    if payload.model_id or payload.connection_id:
        from app.ai.database_repository import DatabaseAIRepository
        try:
            target = await asyncio.to_thread(
                DatabaseAIRepository().resolve_model,
                model_id=payload.model_id,
                connection_id=payload.connection_id,
                model="",
                kind="chat",
            )
            chat_target = target
            _llm_provider = canonical_connection_view(target)
            model = target.model.upstream_model
        except LookupError as exc:
            raise HTTPException(status_code=404, detail="Canvas 聊天模型或连接不存在或已禁用") from exc
    else:
        raise HTTPException(status_code=400, detail="Canvas 聊天模型必须指定有效的稳定资源标识")
    system_prompt = (payload.system_prompt or "").strip()
    upstream_messages = [{"role": "system", "content": system_prompt}] if system_prompt else []
    for item in payload.messages[-MAX_HISTORY_MESSAGES:]:
        role = item.get("role")
        content = item.get("content")
        if role in {"user", "assistant"} and content:
            upstream_messages.append({"role": role, "content": content})
    # 构造用户消息：有图片/视频时用 OpenAI/Gemini 多模态格式
    image_flags = await asyncio.gather(*(
        run_storage_io(is_image_reference_value, img) for img in (payload.images or [])
    ))
    video_flags = await asyncio.gather(*(
        run_storage_io(is_video_reference_value, video) for video in (payload.videos or [])
    ))
    image_inputs = [img for img, valid in zip(payload.images or [], image_flags) if valid]
    video_inputs = [video for video, valid in zip(payload.videos or [], video_flags) if valid]
    if image_inputs or video_inputs:
        content_parts = [{"type": "text", "text": payload.message}]
        ok_imgs = 0
        for img in image_inputs[:8]:
            if not img or not isinstance(img, str):
                continue
            ref_url = await run_storage_io(media_reference_to_url, img, 1024)
            if not ref_url:
                continue
            content_parts.append({"type": "image_url", "image_url": {"url": ref_url}})
            ok_imgs += 1
        ok_videos = 0
        for video in video_inputs[:3]:
            if not video or not isinstance(video, str):
                continue
            frame_urls = await video_reference_to_frame_data_urls(video, max_frames=6, max_size=768)
            if frame_urls:
                ok_videos += 1
                content_parts.append({"type": "text", "text": f"以下是视频 {ok_videos} 按时间顺序抽取的关键帧，请结合这些画面理解视频内容。"})
                for frame_url in frame_urls:
                    content_parts.append({"type": "image_url", "image_url": {"url": frame_url}})
            else:
                ref_url = media_reference_to_url(video)
                if not ref_url:
                    continue
                content_parts.append({"type": "video_url", "video_url": {"url": ref_url}})
                ok_videos += 1
        logger.info("canvas LLM request prepared", extra={"event": "canvas_llm_request_prepared", "connection_id": chat_target.connection.id, "model_id": chat_target.model.id if chat_target.model else "", "text_length": len(payload.message), "image_count": ok_imgs, "image_requested_count": len(payload.images), "video_count": ok_videos, "video_requested_count": len(payload.videos)})
        upstream_messages.append({"role": "user", "content": content_parts})
    else:
        upstream_messages.append({"role": "user", "content": payload.message})
    content_parts_acc = []
    raw_usage = None
    response_id = ""
    try:
        from app.ai.chat import ChatGateway
        chat_gateway = ChatGateway(timeout=AI_REQUEST_TIMEOUT)
        stream_options = {"stream_options": {"include_usage": True}} if _llm_provider.get("protocol") == "omnilojo" else {}
        async for line in chat_gateway.stream_target(target=chat_target, messages=upstream_messages, user_id=current_user_id(), extra_body=stream_options):
            if not line:
                continue
            if line.startswith("data:"):
                line = line[5:].strip()
            if line == "[DONE]":
                break
            try:
                chunk = json.loads(line)
            except json.JSONDecodeError:
                continue
            if isinstance(chunk, dict) and chunk.get("usage"):
                raw_usage = chunk.get("usage")
            if isinstance(chunk, dict) and chunk.get("id"):
                response_id = str(chunk.get("id") or "")
            delta = text_delta_from_chat_chunk(chunk)
            if delta:
                content_parts_acc.append(delta)
    except httpx.HTTPStatusError as exc:
        body = exc.response.text or ""
        friendly = friendly_chat_error_detail(body, model, _llm_provider)
        raise HTTPException(status_code=exc.response.status_code, detail=friendly or f"上游接口错误：{body}") from exc
    except httpx.HTTPError as exc:
        raise HTTPException(status_code=502, detail=f"请求上游接口失败：{exc}") from exc
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"解析上游响应失败：{exc}") from exc
    text = "".join(content_parts_acc).strip() or "接口返回了空回复。"
    if _llm_provider.get("protocol") == "omnilojo":
        from app.services.usage import record_omnilojo_response_usage
        await asyncio.to_thread(
            record_omnilojo_response_usage, current_user_id(), _llm_provider, model,
            {"id": response_id or uuid.uuid4().hex, "usage": raw_usage}, operation="canvas_llm",
        )
    return {"text": text, "model": model, "raw_usage": raw_usage}


@app.post("/api/canvas-llm")
async def canvas_llm(payload: CanvasLLMRequest):
    return await _canvas_llm_impl(payload)

# --- 对话管理 ---
# 路由已迁移至 app/routers/conversations.py，通过 app.include_router 注册。

# --- 画布管理 ---
# 路由已迁移至 app/routers/canvases.py，通过 app.include_router 注册。

@app.get("/api/canvas/prompt-templates")
async def smart_canvas_prompt_templates():
    try:
        template_path = prompt_template_markdown_path()
        source = os.path.relpath(template_path, BASE_DIR).replace("\\", "/") if template_path else ""
        return {"templates": builtin_prompt_templates(), "source": source}
    except Exception:
        logger.exception("failed to read prompt templates", extra={"event": "prompt_templates_load_failed"})
        return {"templates": []}

@app.post("/api/canvas-assets/check")
async def check_canvas_assets(payload: CanvasAssetCheckRequest):
    result = {}
    for url in payload.urls[:3000]:
        text = str(url or "").strip()
        if not text:
            continue
        if text.startswith("/api/files/"):
            result[text] = bool(await run_storage_io(output_file_from_url, text))
        else:
            result[text] = True
    return {"exists": result}

@app.post("/api/canvas-assets/download")
async def download_canvas_assets(payload: CanvasAssetDownloadRequest):
    buffer = BytesIO()
    used_names = set()
    count = 0
    raw_items = payload.items or [{"url": url} for url in payload.urls]
    with zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED) as zf:
        for raw in raw_items[:1000]:
            if isinstance(raw, dict):
                text = str(raw.get("url") or "").strip()
                requested_name = str(raw.get("name") or "").strip()
            else:
                text = str(raw or "").strip()
                requested_name = ""
            if not text:
                continue
            path = await run_storage_io(output_file_from_url, text)
            content = None
            content_type = ""
            if path and os.path.isfile(path):
                base = sanitize_export_filename(requested_name or os.path.basename(path), os.path.basename(path) or f"image-{count + 1}.png")
            else:
                local_by_name = local_media_file_by_basename(filename_from_media_url(text, ""))
                if local_by_name and os.path.isfile(local_by_name):
                    path = local_by_name
                    base = sanitize_export_filename(requested_name or os.path.basename(path), os.path.basename(path) or f"image-{count + 1}.png")
                else:
                    try:
                        remote = fetch_remote_media_bytes(text)
                    except Exception:
                        remote = None
                    if not remote:
                        continue
                    content, content_type = remote
                    base = sanitize_export_filename(requested_name or filename_from_media_url(text, f"image-{count + 1}.bin"), f"image-{count + 1}.bin")
            name, ext = os.path.splitext(base)
            archive_name = base
            suffix = 2
            while archive_name in used_names:
                archive_name = f"{name}-{suffix}{ext}"
                suffix += 1
            used_names.add(archive_name)
            if path and os.path.isfile(path):
                zf.write(path, archive_name)
            else:
                zf.writestr(archive_name, content)
            count += 1
    if count <= 0:
        raise HTTPException(status_code=404, detail="没有可下载的本地图片")
    buffer.seek(0)
    filename = re.sub(r'[\\/:*?"<>|]+', "_", payload.filename or "canvas-output-images.zip")
    if not filename.lower().endswith(".zip"):
        filename += ".zip"
    encoded = urllib.parse.quote(filename)
    headers = {"Content-Disposition": f"attachment; filename*=UTF-8''{encoded}"}
    return Response(buffer.getvalue(), media_type="application/zip", headers=headers)

# sanitize_export_filename 已迁移至 app/core/media.py（原样迁移），多域复用。
from app.core.media import sanitize_export_filename


def canvas_workflow_collect_resource_refs(value: Any, found: Optional[List[str]] = None) -> List[str]:
    if found is None:
        found = []
    if isinstance(value, dict):
        for item in value.values():
            canvas_workflow_collect_resource_refs(item, found)
    elif isinstance(value, list):
        for item in value:
            canvas_workflow_collect_resource_refs(item, found)
    elif isinstance(value, str):
        text = value.strip()
        if text.startswith("/api/files/") and output_file_from_url(text):
            found.append(text)
    return found


def canvas_workflow_unique_archive_name(base: str, used: set) -> str:
    safe = sanitize_export_filename(base, "resource.bin")
    name, ext = os.path.splitext(safe)
    archive = safe
    idx = 2
    while archive in used:
        archive = f"{name}-{idx}{ext}"
        idx += 1
    used.add(archive)
    return archive


def canvas_workflow_replace_strings(value: Any, mapping: Dict[str, str]) -> Any:
    if isinstance(value, dict):
        return {k: canvas_workflow_replace_strings(v, mapping) for k, v in value.items()}
    if isinstance(value, list):
        return [canvas_workflow_replace_strings(item, mapping) for item in value]
    if isinstance(value, str):
        return mapping.get(value, value)
    return value


def canvas_workflow_payload(
    nodes_payload: List[Dict[str, Any]],
    connections_payload: List[Dict[str, Any]],
    resources: Optional[List[Dict[str, Any]]] = None,
) -> Dict[str, Any]:
    return {
        "format": "infinite-canvas-workflow",
        "version": 1,
        "exported_at": now_ms(),
        "nodes": nodes_payload or [],
        "connections": connections_payload or [],
        "resources": resources or [],
    }


def build_canvas_workflow_archive(payload: CanvasWorkflowExportRequest) -> Tuple[bytes, Dict[str, Any]]:
    nodes_payload = payload.nodes or []
    connections_payload = payload.connections or []
    if not nodes_payload:
        raise HTTPException(status_code=400, detail="没有可导出的节点")
    buffer = BytesIO()
    resources: List[Dict[str, Any]] = []
    used: set = set()
    with zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED) as zf:
        if payload.include_resources:
            for url in canvas_workflow_collect_resource_refs(nodes_payload):
                if any(item.get("url") == url for item in resources):
                    continue
                path = output_file_from_url(url)
                if not path or not os.path.isfile(path):
                    continue
                archive_name = canvas_workflow_unique_archive_name(os.path.basename(path), used)
                archive_path = f"resources/{archive_name}"
                zf.write(path, archive_path)
                resources.append({
                    "url": url,
                    "archive": archive_path,
                    "name": os.path.basename(path),
                    "size": os.path.getsize(path),
                })
        workflow = canvas_workflow_payload(nodes_payload, connections_payload, resources)
        zf.writestr("workflow.json", json.dumps(workflow, ensure_ascii=False, indent=2))
    buffer.seek(0)
    return buffer.getvalue(), {
        "resources": resources,
        "node_count": len(nodes_payload),
        "connection_count": len(connections_payload),
    }


@app.post("/api/canvas-workflows/export")
async def export_canvas_workflow(payload: CanvasWorkflowExportRequest):
    archive, _ = await asyncio.to_thread(build_canvas_workflow_archive, payload)
    filename = sanitize_export_filename(payload.filename or "canvas-workflow.zip", "canvas-workflow.zip")
    if not filename.lower().endswith(".zip"):
        filename += ".zip"
    encoded = urllib.parse.quote(filename)
    headers = {"Content-Disposition": f"attachment; filename*=UTF-8''{encoded}"}
    return Response(archive, media_type="application/zip", headers=headers)


@app.post("/api/canvas-workflows/import")
async def import_canvas_workflow(file: UploadFile = File(...)):
    raw = await file.read()
    if not raw:
        raise HTTPException(status_code=400, detail="文件为空")
    name = str(file.filename or "").lower()
    resource_mapping: Dict[str, str] = {}
    workflow: Any = None
    try:
        if name.endswith(".zip") or raw[:2] == b"PK":
            with zipfile.ZipFile(BytesIO(raw), "r") as zf:
                names = zf.namelist()
                candidates = [n for n in names if n.lower().endswith("workflow.json")]
                workflow_name = "workflow.json" if "workflow.json" in names else (candidates[0] if candidates else "")
                if not workflow_name:
                    raise HTTPException(status_code=400, detail="压缩包中没有 workflow.json")
                workflow = json.loads(zf.read(workflow_name).decode("utf-8-sig"))
                for res in workflow.get("resources") or []:
                    archive = str(res.get("archive") or "").replace("\\", "/").lstrip("/")
                    if not archive or archive not in names:
                        continue
                    fallback_name = os.path.basename(archive) or "resource.bin"
                    base = sanitize_export_filename(res.get("name") or fallback_name, fallback_name)
                    payload = zf.read(archive)
                    kind = str(res.get("kind") or "") or runninghub_output_kind(os.path.splitext(base)[1])
                    stored = await run_storage_io(
                        save_media_bytes,
                        "input",
                        f"workflow_{uuid.uuid4().hex[:8]}_{base}",
                        payload,
                        original_name=base,
                        content_type=content_type_for_path(base),
                        kind=kind,
                        source="imported",
                    )
                    new_url = stored["url"]
                    old_url = str(res.get("url") or "").strip()
                    if old_url:
                        resource_mapping[old_url] = new_url
                    resource_mapping[archive] = new_url
                    resource_mapping[f"./{archive}"] = new_url
                    resource_mapping[os.path.basename(archive)] = new_url
        else:
            workflow = json.loads(raw.decode("utf-8-sig"))
    except HTTPException:
        raise
    except zipfile.BadZipFile as exc:
        raise HTTPException(status_code=400, detail="无法读取压缩包") from exc
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"无法解析工作流文件：{exc}") from exc

    if isinstance(workflow, list):
        workflow = {"nodes": workflow, "connections": []}
    if not isinstance(workflow, dict):
        raise HTTPException(status_code=400, detail="工作流格式不正确")
    nodes_payload = workflow.get("nodes")
    connections_payload = workflow.get("connections")
    if nodes_payload is None and isinstance(workflow.get("workflow"), dict):
        nodes_payload = workflow["workflow"].get("nodes")
        connections_payload = workflow["workflow"].get("connections")
    if not isinstance(nodes_payload, list):
        raise HTTPException(status_code=400, detail="工作流 JSON 缺少 nodes")
    if not isinstance(connections_payload, list):
        connections_payload = []
    if resource_mapping:
        nodes_payload = canvas_workflow_replace_strings(nodes_payload, resource_mapping)
        connections_payload = canvas_workflow_replace_strings(connections_payload, resource_mapping)
    return {
        "workflow": canvas_workflow_payload(nodes_payload, connections_payload, workflow.get("resources") or []),
        "nodes": nodes_payload,
        "connections": connections_payload,
        "resource_map": resource_mapping,
    }


# --- 提示词库 ---
# 路由已迁移至 app/routers/prompts.py，通过 app.include_router 注册。

# --- 素材库 ---
# 数据 CRUD 路由已迁移至 app/routers/assets.py；avatar 注册/审核路由暂留 main.py（见下）。

# 共享文件夹 6 个路由已迁移至 app/routers/shared_folders.py。

# items PATCH(重命名) 路由已迁移至 app/routers/assets.py。
# find_asset_item_in_library 已迁移至 app/services/assets.py（import-back，见上）。

@app.post("/api/asset-library/items/{item_id}/register-avatar")
async def register_asset_library_avatar(item_id: str, payload: AssetAvatarRegisterRequest):
    lib = await asyncio.to_thread(load_asset_library)
    target_item = find_asset_item_in_library(lib, item_id, payload.library_id)
    if not target_item:
        raise HTTPException(status_code=404, detail="资产不存在")
    provider = None
    if payload.connection_id:
        from app.ai.database_repository import DatabaseAIRepository
        try:
            connection = next(item for item in await asyncio.to_thread(DatabaseAIRepository().connections) if item.id == payload.connection_id)
            provider = {"id": connection.id, "connection_id": connection.id, "name": connection.name, "protocol": connection.protocol, "base_url": connection.base_url, **dict(connection.settings or {})}
        except StopIteration as exc:
            raise HTTPException(status_code=404, detail="AI 连接不存在或已禁用") from exc
    else:
        raise HTTPException(status_code=400, detail="头像认证必须指定 connection_id")
    if not provider:
        raise HTTPException(status_code=400, detail="AI 连接或 Provider 必填")
    platform = avatar_platform_for_provider(provider)
    if platform not in AVATAR_SUPPORTED_PLATFORMS:
        name = (provider or {}).get("name") or (provider or {}).get("id") or "该平台"
        raise HTTPException(status_code=400, detail=f"「{name}」暂不支持数字人/真人认证。")
    kind = str(target_item.get("kind") or "image").lower()
    if kind not in ("image", "video", "audio"):
        kind = "image"
    if platform == "volcengine":
        # 火山以 API 设置里配置的 ProjectName 为准（必须与视频生成 key 的项目一致）
        project_name = str(provider.get("volcengine_project_name") or VOLCENGINE_DEFAULT_PROJECT_NAME).strip() or VOLCENGINE_DEFAULT_PROJECT_NAME
        public_url = volcengine_public_asset_url(target_item.get("url") or "")
        if public_url.startswith("ERR:"):
            raise HTTPException(status_code=400, detail=public_url[4:])
        task_id = await submit_volcengine_avatar_asset(
            public_url, target_item.get("name") or "asset", kind,
            project_name=project_name, group_name=payload.group_name or "",
        )
    else:
        raise HTTPException(status_code=400, detail="该平台的认证后端尚未接入。")
    regs = target_item.get("registrations")
    if not isinstance(regs, dict):
        regs = {}
    regs[platform] = {
        "connection_id": payload.connection_id or str(provider.get("connection_id") or ""),
        "project_name": project_name,
        "task_id": task_id,
        "status": "Processing",
        "detail": "已提交，审核中",
        "asset_uri": "",
        "asset_id": "",
        "registered_at": now_ms(),
    }
    target_item["registrations"] = regs
    await asyncio.to_thread(save_asset_library, lib)
    return {"library": lib, "item": target_item}

@app.post("/api/asset-library/items/{item_id}/avatar-status")
async def check_asset_library_avatar(item_id: str, payload: AssetAvatarRegisterRequest):
    lib = await asyncio.to_thread(load_asset_library)
    target_item = find_asset_item_in_library(lib, item_id, payload.library_id)
    if not target_item:
        raise HTTPException(status_code=404, detail="资产不存在")
    regs = target_item.get("registrations") if isinstance(target_item.get("registrations"), dict) else {}
    provider = None
    if payload.connection_id:
        from app.ai.database_repository import DatabaseAIRepository
        try:
            connection = next(item for item in await asyncio.to_thread(DatabaseAIRepository().connections) if item.id == payload.connection_id)
            provider = {"id": connection.id, "connection_id": connection.id, "name": connection.name, "protocol": connection.protocol, "base_url": connection.base_url, **dict(connection.settings or {})}
        except StopIteration as exc:
            raise HTTPException(status_code=404, detail="AI 连接不存在或已禁用") from exc
    else:
        raise HTTPException(status_code=400, detail="头像审核必须指定 connection_id")
    if not provider:
        raise HTTPException(status_code=400, detail="AI 连接或 Provider 必填")
    platform = avatar_platform_for_provider(provider)
    if platform not in AVATAR_SUPPORTED_PLATFORMS:
        raise HTTPException(status_code=400, detail="该平台暂不支持数字人/真人认证审核。")
    reg = regs.get(platform) if isinstance(regs.get(platform), dict) else {}
    task_id = str(reg.get("task_id") or "").strip()
    if not task_id:
        raise HTTPException(status_code=400, detail="该素材还没有提交到这个平台的认证审核。")
    if platform == "volcengine":
        result = await check_volcengine_avatar_task(
            task_id, str(reg.get("project_name") or VOLCENGINE_DEFAULT_PROJECT_NAME).strip() or VOLCENGINE_DEFAULT_PROJECT_NAME,
        )
    else:
        raise HTTPException(status_code=400, detail="该平台的认证后端尚未接入。")
    reg["status"] = result["status"]
    reg["detail"] = result.get("detail") or ""
    if result["status"] == "Active" and result.get("asset_uri"):
        reg["asset_uri"] = result["asset_uri"]
        reg["asset_id"] = result["asset_uri"].replace("asset://", "")
    regs[platform] = reg
    target_item["registrations"] = regs
    await asyncio.to_thread(save_asset_library, lib)
    return {"library": lib, "item": target_item}

# items DELETE / delete / move / crop 路由已迁移至 app/routers/assets.py。

# 画布 PUT/DELETE 路由已迁移至 app/routers/canvases.py。

# --- GPT 对话 ---

@app.post("/api/chat")
async def chat(payload: ChatRequest, request: Request, x_user_id: str = Header(default="")):
    if payload.mode != "image" and not (payload.model_id or payload.connection_id):
        raise HTTPException(status_code=400, detail="聊天请求必须指定 model_id 或 connection_id")
    if payload.mode == "image" and not (payload.image_resource_id or payload.image_connection_id or payload.model_id or payload.connection_id):
        raise HTTPException(status_code=400, detail="生图请求必须指定 model_id、connection_id 或 resource_id")
    user_id = safe_user_id(x_user_id, request)
    if payload.conversation_id:
        conversation = await asyncio.to_thread(load_conversation, user_id, payload.conversation_id)
    else:
        conversation = await asyncio.to_thread(new_conversation, user_id, display_title(payload.message))
    if not conversation.get("messages"):
        conversation["title"] = display_title(payload.message)

    refs = [ref.dict() for ref in payload.reference_images if ref.url]
    user_message = {
        "id": uuid.uuid4().hex,
        "role": "user",
        "content": payload.message,
        "created_at": now_ms(),
        "attachments": refs,
        "mode": payload.mode,
    }
    conversation["messages"].append(user_message)
    conversation["updated_at"] = now_ms()
    await asyncio.to_thread(save_conversation, user_id, conversation)

    if payload.mode == "image":
        provider = None
        image_provider_id = ""
        resolved_image_model = ""
        image_target = None
        if payload.image_connection_id or payload.image_resource_id or payload.model_id:
            from app.ai.database_repository import DatabaseAIRepository
            try:
                if payload.image_resource_id:
                    target = await asyncio.to_thread(DatabaseAIRepository().resolve_executable, resource_id=payload.image_resource_id)
                    image_target = target
                    provider = canonical_connection_view(target)
                else:
                    target = await asyncio.to_thread(DatabaseAIRepository().resolve_model, model_id=payload.image_model_id or payload.model_id, connection_id=payload.image_connection_id, model=payload.image_model or payload.model, kind="image")
                    image_target = target
                    provider = canonical_connection_view(target)
                    resolved_image_model = target.model.upstream_model
                image_provider_id = provider["id"]
            except LookupError as exc:
                raise HTTPException(status_code=404, detail="图片模型或连接不存在或已禁用") from exc
        if image_target is None or provider is None:
            raise HTTPException(status_code=400, detail="生图请求缺少有效的稳定执行目标")
        default_model = (provider.get("image_models") or [IMAGE_MODEL])[0]
        model = resolved_image_model or selected_model(payload.image_model or payload.model, default_model)
        require_target_access(image_target, user_id)
        try:
            if image_target is None:
                raise HTTPException(status_code=400, detail="图片任务缺少稳定执行目标")
            image_data, raw = await generate_ai_image_target(image_target, prompt=payload.message, size=payload.size, quality=payload.quality, reference_images=refs, user_id=user_id)
            local_url = await save_ai_image_to_output(image_data, prefix="chat_")
        except httpx.HTTPStatusError as exc:
            text = exc.response.text or ""
            detail = friendly_image_error_detail(text, payload.size, model) or f"上游生图接口错误：{text[:300]}"
            raise HTTPException(status_code=exc.response.status_code, detail=detail) from exc
        except httpx.HTTPError as exc:
            raise HTTPException(status_code=502, detail=f"请求上游生图接口失败：{exc}") from exc
        assistant_message = {
            "id": uuid.uuid4().hex,
            "role": "assistant",
            "type": "image",
            "content": payload.message,
            "image_url": local_url,
            "created_at": now_ms(),
            "model": model,
            "raw_usage": raw.get("usage") if isinstance(raw, dict) else None,
        }
        if is_omnilojo_connection(provider):
            from app.services.usage import record_omnilojo_response_usage
            await asyncio.to_thread(record_omnilojo_response_usage, user_id, provider, model, raw, operation="image_generation")
    else:
        _conv_provider = None
        model = payload.model
        chat_target = None
        if payload.model_id or payload.connection_id:
            from app.ai.database_repository import DatabaseAIRepository
            try:
                target = await asyncio.to_thread(
                    DatabaseAIRepository().resolve_model,
                    model_id=payload.model_id,
                    connection_id=payload.connection_id,
                    model=payload.model,
                    kind="chat",
                )
                chat_target = target
                _conv_provider = canonical_connection_view(target)
                model = target.model.upstream_model
            except LookupError as exc:
                raise HTTPException(status_code=404, detail="聊天模型或连接不存在或已禁用") from exc
        else:
            raise HTTPException(status_code=400, detail="聊天请求必须指定有效的稳定资源标识")
        history = conversation["messages"][-MAX_HISTORY_MESSAGES:]
        upstream_messages = [{"role": "system", "content": (payload.system_prompt or "").strip() or SYSTEM_PROMPT}]
        for item in history:
            if item is history[-1] and item.get("role") == "user" and item.get("content") == payload.message:
                continue
            msg = await asyncio.to_thread(upstream_message_from_record, item)
            if msg:
                upstream_messages.append(msg)
        current_content = [{"type": "text", "text": payload.message}]
        for data_url in await latest_chat_image_data_urls(conversation, 1):
            current_content.append({"type": "image_url", "image_url": {"url": data_url}})
        for ref in list(payload.reference_images or [])[:CHAT_ATTACHMENT_MAX]:
            data_url = await run_storage_io(reference_to_data_url, ref.dict(), 1536)
            if data_url:
                current_content.append({"type": "image_url", "image_url": {"url": data_url}})
        upstream_messages.append({"role": "user", "content": current_content if len(current_content) > 1 else payload.message})
        try:
            from app.ai.chat import ChatGateway
            chat_gateway = ChatGateway(timeout=AI_REQUEST_TIMEOUT)
            raw = await chat_gateway.complete_target(target=chat_target, messages=upstream_messages, user_id=user_id)
        except httpx.HTTPStatusError as exc:
            body = exc.response.text or ""
            friendly = friendly_chat_error_detail(body, model, _conv_provider)
            raise HTTPException(status_code=exc.response.status_code, detail=friendly or f"上游接口错误：{body}") from exc
        except httpx.HTTPError as exc:
            raise HTTPException(status_code=502, detail=f"请求上游接口失败：{exc}") from exc
        raw_data = raw
        assistant_message = {
            "id": uuid.uuid4().hex,
            "role": "assistant",
            "content": text_from_chat_response(raw).strip() or "接口返回了空回复。",
            "created_at": now_ms(),
            "model": model,
            "raw_usage": raw_data.get("usage") if isinstance(raw_data, dict) else None,
        }
        if _conv_provider.get("protocol") == "omnilojo":
            from app.services.usage import record_omnilojo_response_usage
            usage_payload = dict(raw_data) if isinstance(raw_data, dict) else {}
            usage_payload.setdefault("id", uuid.uuid4().hex)
            await asyncio.to_thread(record_omnilojo_response_usage, user_id, _conv_provider, model, usage_payload, operation="chat")

    conversation["messages"].append(assistant_message)
    conversation["updated_at"] = now_ms()
    await asyncio.to_thread(save_conversation, user_id, conversation)
    return {"conversation": conversation, "message": assistant_message}

@app.post("/api/chat/agent")
async def chat_agent(payload: ChatRequest, request: Request, x_user_id: str = Header(default="")):
    """Route Agent intent, then invoke chat or the configured image adapter."""
    if not (payload.model_id or payload.connection_id):
        raise HTTPException(status_code=400, detail="Agent 请求必须指定 model_id 或 connection_id")
    user_id = safe_user_id(x_user_id, request)
    conversation = (
        await asyncio.to_thread(load_conversation, user_id, payload.conversation_id)
        if payload.conversation_id
        else await asyncio.to_thread(new_conversation, user_id, display_title(payload.message))
    )
    if not conversation.get("messages"):
        conversation["title"] = display_title(payload.message)
    refs = image_references([ref.dict() for ref in payload.reference_images if ref.url])
    conversation["messages"].append({
        "id": uuid.uuid4().hex,
        "role": "user",
        "content": payload.message,
        "created_at": now_ms(),
        "attachments": refs,
        "mode": "agent",
    })
    conversation["updated_at"] = now_ms()
    await asyncio.to_thread(save_conversation, user_id, conversation)

    decision = await decide_chat_agent_action(payload, conversation, refs)
    action = decision.get("action") or "chat"
    tool_refs = refs[:]
    inherited_size = ""
    if action == "edit_image" and not tool_refs:
        tool_refs = latest_chat_image_refs(conversation, 1)
        inherited_size = image_size_from_reference(tool_refs[0]) if tool_refs else ""
    if action == "edit_image" and not tool_refs:
        action = "generate_image"

    if action in {"generate_image", "edit_image"}:
        if not (payload.image_resource_id or payload.image_connection_id or payload.model_id):
            raise HTTPException(status_code=400, detail="Agent 生图请求必须指定 image_connection_id、model_id 或 image_resource_id")
        image_provider = None
        model = payload.image_model or payload.model
        image_target = None
        if payload.image_resource_id or payload.image_connection_id or payload.model_id:
            from app.ai.database_repository import DatabaseAIRepository
            try:
                if payload.image_resource_id:
                    target = await asyncio.to_thread(DatabaseAIRepository().resolve_executable, resource_id=payload.image_resource_id, kind="image")
                    image_target = target
                else:
                    target = await asyncio.to_thread(DatabaseAIRepository().resolve_model, model_id=payload.image_model_id or payload.model_id, connection_id=payload.image_connection_id or payload.connection_id, model=model, kind="image")
                    image_target = target
                image_provider = canonical_connection_view(target)
                model = target.model.upstream_model if target.model else model
            except LookupError as exc:
                raise HTTPException(status_code=404, detail="Agent 图片模型或连接不存在或已禁用") from exc
        else:
            raise HTTPException(status_code=400, detail="Agent 图片请求必须指定有效的稳定资源标识")
        prompt = decision.get("prompt") or payload.message
        image_size = chat_prompt_size_override(payload.message, payload.size) or chat_prompt_size_override(prompt, payload.size) or inherited_size or payload.size
        image_size = snap_size_to_multiple(image_size, 16)
        count = 1 if action == "edit_image" else chat_requested_image_count(payload.message)
        prompts = chat_split_parallel_prompts(prompt, count)
        local_urls, raw_items = [], []
        require_target_access(image_target, user_id)
        try:
            for item_prompt in prompts:
                if image_target is None:
                    raise HTTPException(status_code=400, detail="Agent 图片任务缺少稳定执行目标")
                image_data, raw = await generate_ai_image_target(image_target, prompt=item_prompt, size=image_size, quality=payload.quality, reference_images=tool_refs, user_id=user_id)
                local_urls.append(await save_ai_image_to_output(image_data, prefix="chat_"))
                raw_items.append(raw)
        except httpx.HTTPStatusError as exc:
            body = exc.response.text or ""
            raise HTTPException(status_code=exc.response.status_code, detail=friendly_image_error_detail(body, image_size, model) or body[:300]) from exc
        except httpx.HTTPError as exc:
            raise HTTPException(status_code=502, detail=f"请求上游生图接口失败：{exc}") from exc
        assistant_message = {"id": uuid.uuid4().hex, "role": "assistant", "type": "image", "content": prompt, "image_url": local_urls[0] if local_urls else "", "image_urls": local_urls, "created_at": now_ms(), "model": model, "connection_id": image_target.connection.id, "model_id": image_target.model.id if image_target.model else "", "resource_id": image_target.resource.id if image_target.resource else "", "size": image_size, "image_count": len(local_urls), "prompts": prompts, "agent_action": action, "agent_reply": decision.get("reply") or "", "used_references": tool_refs, "raw_usage": raw_items[0].get("usage") if raw_items and isinstance(raw_items[0], dict) else None}
    else:
        assistant_message = await build_chat_text_reply(payload, conversation)
        assistant_message["agent_action"] = "chat"

    conversation["messages"].append(assistant_message)
    conversation["updated_at"] = now_ms()
    await asyncio.to_thread(save_conversation, user_id, conversation)
    return {"conversation": conversation, "message": assistant_message, "agent": {"action": action, "decision": decision}}

@app.post("/api/chat/stream")
async def chat_stream(payload: ChatRequest, request: Request, x_user_id: str = Header(default="")):
    if payload.mode == "image":
        raise HTTPException(status_code=400, detail="图片模式请使用 /api/chat")
    if not (payload.model_id or payload.connection_id):
        raise HTTPException(status_code=400, detail="流式聊天请求必须指定 model_id 或 connection_id")

    user_id = safe_user_id(x_user_id, request)
    if payload.conversation_id:
        conversation = await asyncio.to_thread(load_conversation, user_id, payload.conversation_id)
    else:
        conversation = await asyncio.to_thread(new_conversation, user_id, display_title(payload.message))
    if not conversation.get("messages"):
        conversation["title"] = display_title(payload.message)

    refs = [ref.dict() for ref in payload.reference_images if ref.url]
    user_message = {
        "id": uuid.uuid4().hex,
        "role": "user",
        "content": payload.message,
        "created_at": now_ms(),
        "attachments": refs,
        "mode": payload.mode,
    }
    conversation["messages"].append(user_message)
    conversation["updated_at"] = now_ms()
    await asyncio.to_thread(save_conversation, user_id, conversation)

    provider = None
    _stream_provider = provider
    model = payload.model
    chat_target = None
    if payload.model_id or payload.connection_id:
        from app.ai.database_repository import DatabaseAIRepository
        try:
            target = await asyncio.to_thread(
                DatabaseAIRepository().resolve_model,
                model_id=payload.model_id,
                connection_id=payload.connection_id,
                model=payload.model,
                kind="chat",
            )
            chat_target = target
            provider = canonical_connection_view(target)
            _stream_provider = provider
            model = target.model.upstream_model
        except LookupError as exc:
            raise HTTPException(status_code=404, detail="聊天模型或连接不存在或已禁用") from exc
    else:
        raise HTTPException(status_code=400, detail="流式聊天请求必须指定有效的稳定资源标识")
    history = conversation["messages"][-MAX_HISTORY_MESSAGES:]
    upstream_messages = [{"role": "system", "content": (payload.system_prompt or "").strip() or SYSTEM_PROMPT}]
    for item in history:
        if item is history[-1] and item.get("role") == "user" and item.get("content") == payload.message:
            continue
        msg = await asyncio.to_thread(upstream_message_from_record, item)
        if msg:
            upstream_messages.append(msg)
    current_content = [{"type": "text", "text": payload.message}]
    for data_url in await latest_chat_image_data_urls(conversation, 1):
        current_content.append({"type": "image_url", "image_url": {"url": data_url}})
    for ref in list(payload.reference_images or [])[:CHAT_ATTACHMENT_MAX]:
        data_url = await run_storage_io(reference_to_data_url, ref.dict(), 1536)
        if data_url:
            current_content.append({"type": "image_url", "image_url": {"url": data_url}})
    upstream_messages.append({"role": "user", "content": current_content if len(current_content) > 1 else payload.message})

    async def stream():
        content_parts = []
        raw_usage = None
        response_id = ""
        yield sse_event({"type": "meta", "conversation": conversation})
        try:
            from app.ai.chat import ChatGateway
            chat_gateway = ChatGateway(timeout=AI_REQUEST_TIMEOUT)
            stream_options = {"stream_options": {"include_usage": True}} if _stream_provider.get("protocol") == "omnilojo" else {}
            async for line in chat_gateway.stream_target(target=chat_target, messages=upstream_messages, user_id=user_id, extra_body=stream_options):
                if not line:
                    continue
                if line.startswith("data:"):
                    line = line[5:].strip()
                if line == "[DONE]":
                    break
                try:
                    chunk = json.loads(line)
                except json.JSONDecodeError:
                    continue
                if isinstance(chunk, dict) and chunk.get("usage"):
                    raw_usage = chunk.get("usage")
                if isinstance(chunk, dict) and chunk.get("id"):
                    response_id = str(chunk.get("id") or "")
                delta = text_delta_from_chat_chunk(chunk)
                if delta:
                    content_parts.append(delta)
                    yield sse_event({"type": "delta", "delta": delta})
        except HTTPException as exc:
            yield sse_event({"type": "error", "detail": str(exc.detail)})
            return
        except httpx.HTTPError as exc:
            yield sse_event({"type": "error", "detail": f"请求上游接口失败：{exc}"})
            return

        assistant_message = {
            "id": uuid.uuid4().hex,
            "role": "assistant",
            "content": "".join(content_parts).strip() or "接口返回了空回复。",
            "created_at": now_ms(),
            "model": model,
            "raw_usage": raw_usage,
        }
        conversation["messages"].append(assistant_message)
        conversation["updated_at"] = now_ms()
        await asyncio.to_thread(save_conversation, user_id, conversation)
        if _stream_provider.get("protocol") == "omnilojo":
            from app.services.usage import record_omnilojo_response_usage
            await asyncio.to_thread(record_omnilojo_response_usage, user_id, _stream_provider, model, {"id": response_id or uuid.uuid4().hex, "usage": raw_usage}, operation="chat")
        yield sse_event({"type": "done", "conversation": conversation, "message": assistant_message})

    return StreamingResponse(stream(), media_type="text/event-stream")

# --- 历史记录 ---

# --- 历史记录 ---
# GET /api/history、POST /api/history/save、POST /api/history/delete 路由已迁移至 app/routers/history.py。

# --- 本地 ComfyUI 生图 ---

@app.post("/api/generate")
def generate(req: GenerateRequest):
    # New workflow submissions must carry a canonical execution target.  Old
    # history records are migrated before they reach this endpoint and are
    # handled by the worker restore path separately.
    if not any(str(value or "").strip() for value in (req.connection_id, req.model_id, req.resource_id)):
        raise HTTPException(status_code=400, detail="工作流请求必须提供 connection_id、model_id 或 resource_id")
    global NEXT_TASK_ID
    target_backend = None
    with TASK_ID_LOCK:
        task_id = NEXT_TASK_ID
        NEXT_TASK_ID += 1

    try:
        required_images = collect_required_comfy_media(req.params)

        target_backend = reserve_best_backend(required_images)

        for image_name in required_images:
            from app.ai.adapters.comfyui_assets import ComfyUIAssetTransport
            need_sync = False
            need_sync = not ComfyUIAssetTransport.input_exists(comfyui_url, target_backend, image_name)

            if need_sync:
                image_content = None
                image_type = "image/png"
                for addr in COMFYUI_INSTANCES:
                    if addr == target_backend: continue
                    fetched = ComfyUIAssetTransport.download_sync(comfyui_url, addr, image_name, kind="input")
                    if fetched:
                        image_content, image_type = fetched
                        break

                if image_content:
                    try:
                        from app.ai.adapters.comfyui_assets import ComfyUIAssetTransport
                        ComfyUIAssetTransport.upload_sync(comfyui_url, target_backend, image_name, image_content, image_type)
                    except Exception:
                        logger.exception("ComfyUI sync upload failed", extra={"event": "upload_failed", "provider": "comfyui", "operation": "sync_upload", "endpoint": target_backend})

        stored_workflow = get_comfy_workflow(req.workflow_json)
        if not stored_workflow:
            raise Exception(f"Workflow file not found: {req.workflow_json}")
        workflow = json.loads(json.dumps(stored_workflow["workflow"]))

        seed = random.randint(1, 10**15)

        if "23" in workflow and req.prompt:
            workflow["23"]["inputs"]["text"] = req.prompt
        if "144" in workflow:
            workflow["144"]["inputs"]["width"] = req.width
            workflow["144"]["inputs"]["height"] = req.height
        if "22" in workflow:
            workflow["22"]["inputs"]["seed"] = seed
        if "158" in workflow:
            workflow["158"]["inputs"]["noise_seed"] = seed
        for node_id in ["146", "181"]:
            if node_id in workflow and "inputs" in workflow[node_id] and "seed" in workflow[node_id]["inputs"]:
                workflow[node_id]["inputs"]["seed"] = seed
        if "184" in workflow and "inputs" in workflow["184"] and "seed" in workflow["184"]["inputs"]:
            workflow["184"]["inputs"]["seed"] = seed
        if "172" in workflow and "inputs" in workflow["172"] and "seed" in workflow["172"]["inputs"]:
            workflow["172"]["inputs"]["seed"] = seed % 4294967295
        if "14" in workflow and "inputs" in workflow["14"] and "seed" in workflow["14"]["inputs"]:
            workflow["14"]["inputs"]["seed"] = seed

        for node_id, node_inputs in req.params.items():
            if node_id in workflow:
                if "inputs" not in workflow[node_id]:
                    workflow[node_id]["inputs"] = {}
                for input_name, value in node_inputs.items():
                    workflow[node_id]["inputs"][input_name] = value

        from app.ai.adapters.comfyui_transport import ComfyUITransport

        async def post_json(url, payload):
            async with shared_http_client(timeout=httpx.Timeout(connect=10, read=30, write=30, pool=10)) as client:
                response = await client.post(url, json=payload)
                response.raise_for_status()
                return response.json()

        transport = ComfyUITransport(
            endpoint=lambda backend, path: comfyui_url(backend, path),
            post_json=post_json,
            history=get_comfy_history,
            timeout_seconds=COMFYUI_HISTORY_TIMEOUT,
        )
        try:
            prompt_id = asyncio.run(transport.submit(target_backend, workflow, req.client_id or CLIENT_ID))
            history_data = asyncio.run(transport.wait(target_backend, prompt_id))
        except Exception as exc:
            raise Exception(str(exc)) from exc
        history_error = comfy_history_error_message(history_data, prompt_id)
        if history_error:
            raise Exception(history_error)

        local_images = []
        local_videos = []
        local_audios = []
        local_texts = []
        local_files = []
        local_items = []
        local_urls = []
        current_timestamp = time.time()
        if 'outputs' in history_data:
            for node_id in history_data['outputs']:
                node_output = history_data['outputs'][node_id]
                for output_key, item in collect_comfy_file_items(node_output):
                    prefix = f"{req.type}_{int(current_timestamp)}_"
                    kind = comfy_output_kind(item)
                    local_path = download_comfy_output(target_backend, item, prefix=prefix)
                    if kind == "image" and req.convert_to_jpg:
                        local_path = convert_output_to_jpg(local_path)
                    name = os.path.basename(str(item.get("filename") or "")) or os.path.basename(str(local_path).split("?", 1)[0])
                    entry = {
                        "url": local_path,
                        "kind": kind,
                        "name": name,
                        "node_id": str(node_id),
                        "output_key": str(output_key),
                    }
                    entry.update(media_response_item(local_path, name=name, kind=kind))
                    if kind == "image":
                        local_images.append(local_path)
                    elif kind == "video":
                        local_videos.append(local_path)
                    elif kind == "audio":
                        local_audios.append(local_path)
                    elif kind == "text":
                        local_texts.append(local_path)
                    else:
                        local_files.append(local_path)
                    local_items.append(entry)
                    local_urls.append(local_path)
                for text, name in comfy_text_values_from_output(node_output):
                    prefix = f"{req.type}_{int(current_timestamp)}_"
                    local_path = save_comfy_text_output(text, prefix=prefix, name=name)
                    entry = {
                        "url": local_path,
                        "kind": "text",
                        "name": os.path.basename(str(local_path).split("?", 1)[0]),
                        "node_id": str(node_id),
                        "output_key": "text",
                    }
                    entry.update(media_response_item(local_path, name=entry["name"], kind="text"))
                    local_texts.append(local_path)
                    local_items.append(entry)
                    local_urls.append(local_path)

        image_items = [item for item in local_items if item.get("kind") == "image"]
        video_items = [item for item in local_items if item.get("kind") == "video"]
        audio_items = [item for item in local_items if item.get("kind") == "audio"]
        text_items = [item for item in local_items if item.get("kind") == "text"]
        file_items = [item for item in local_items if item.get("kind") == "file"]
        result = {
            "prompt": req.prompt if req.prompt else req.workflow_json or "Detail Enhance",
            "images": local_images,
            "image_items": image_items,
            "videos": local_videos,
            "video_items": video_items,
            "audios": local_audios,
            "audio_items": audio_items,
            "texts": local_texts,
            "text_items": text_items,
            "files": local_files,
            "file_items": file_items,
            "items": local_items,
            "outputs": local_urls,
            "seed": seed,
            "timestamp": current_timestamp,
            "type": req.type,
            "workflow_json": req.workflow_json,
            "task_id": task_id,
            "prompt_id": prompt_id,
            "backend": target_backend,
            "params": req.params
        }
        save_to_history(result)
        if GLOBAL_LOOP:
            asyncio.run_coroutine_threadsafe(manager.broadcast_new_image(result, current_user_id()), GLOBAL_LOOP)
        return result

    except Exception as e:
        return {"images": [], "error": str(e)}
    finally:
        if target_backend:
            with LOAD_LOCK:
                if BACKEND_LOCAL_LOAD.get(target_backend, 0) > 0:
                    BACKEND_LOCAL_LOAD[target_backend] -= 1
# --- ComfyUI 工作流管理 ---

# --- ComfyUI 工作流管理数据逻辑 ---
# 常量与 helper 已迁移至 app/routers/workflows.py（原样迁移），5 个管理路由亦在该 router。
# /api/workflows/{name}/run 仍在 main.py（调用 generate），故此处导入以保持原模块级名称可用。
from app.routers.workflows import (
    WORKFLOW_NAME_RE,
)

def runninghub_normalize_field(raw, fallback=None):
    fallback = fallback or {}
    if hasattr(raw, "dict"):
        raw = raw.dict()
    if not isinstance(raw, dict):
        raw = {}
    options = raw.get("options", fallback.get("options", []))
    if isinstance(options, str):
        options = [item.strip() for item in re.split(r"[\r\n,]+", options) if item.strip()]
    elif isinstance(options, list):
        options = [str(item).strip() for item in options if str(item).strip()]
    else:
        options = []
    field_id = str(raw.get("id") or raw.get("fieldId") or raw.get("key") or raw.get("nodeId") or fallback.get("id") or "").strip()
    node_id = str(raw.get("nodeId") or fallback.get("nodeId") or raw.get("node_id") or "").strip()
    field_name = str(raw.get("fieldName") or raw.get("inputName") or raw.get("name") or fallback.get("fieldName") or "").strip()
    field_value = raw.get("fieldValue")
    if field_value is None:
        field_value = raw.get("defaultValue")
    if field_value is None:
        field_value = raw.get("value")
    if field_value is None:
        field_value = fallback.get("fieldValue", "")
    if isinstance(field_value, (dict, list)):
        field_value = json.dumps(field_value, ensure_ascii=False)
    elif field_value is None:
        field_value = ""
    else:
        field_value = str(field_value)
    return {
        "id": field_id or f"{node_id}::{field_name}",
        "nodeId": node_id,
        "fieldName": field_name,
        "fieldValue": field_value,
        "fieldType": str(raw.get("fieldType") or fallback.get("fieldType") or "TEXT"),
        "label": str(raw.get("label") or raw.get("title") or field_name or fallback.get("label") or ""),
        "enabled": bool(raw.get("enabled", fallback.get("enabled", True))),
        "sourceFromUpstream": bool(raw.get("sourceFromUpstream", fallback.get("sourceFromUpstream", True))),
        "group": str(raw.get("group") or fallback.get("group") or ""),
        "note": str(raw.get("note") or fallback.get("note") or ""),
        "options": options,
        "random_enabled": bool(raw.get("random_enabled", fallback.get("random_enabled", False))),
        "min": raw.get("min", fallback.get("min", "")),
        "max": raw.get("max", fallback.get("max", "")),
        "step": raw.get("step", fallback.get("step", "")),
        "imageOrder": int(raw.get("imageOrder") or raw.get("image_order") or fallback.get("imageOrder") or 0),
        "required": bool(raw.get("required", fallback.get("required", False))),
    }

@app.get("/api/comfyui/instances")
def get_comfyui_instances():
    return {"instances": COMFYUI_INSTANCES}

@app.put("/api/comfyui/instances")
def save_comfyui_instances(payload: ComfyInstancesPayload):
    # 接受完整 URL、旧版 host:port 和无端口的 HTTPS 网关域名。
    cleaned = []
    for item in payload.instances:
        if not str(item or "").strip():
            continue
        try:
            s = normalize_comfyui_endpoint(item)
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=f"地址不合法：{item}（{exc}）") from exc
        if s in cleaned:
            continue
        cleaned.append(s)
    if not cleaned:
        raise HTTPException(status_code=400, detail="至少保留一个 ComfyUI 后端地址")
    # 写入 env 文件
    try:
        update_env_values({"COMFYUI_INSTANCES": ",".join(cleaned)})
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"写入 env 失败：{e}")
    # 更新进程中的全局变量
    global COMFYUI_INSTANCES, COMFYUI_ADDRESS, BACKEND_LOCAL_LOAD
    COMFYUI_INSTANCES = cleaned
    COMFYUI_ADDRESS = cleaned[0]
    new_load = {addr: 0 for addr in cleaned}
    for addr, n in (BACKEND_LOCAL_LOAD or {}).items():
        if addr in new_load:
            new_load[addr] = n
    BACKEND_LOCAL_LOAD = new_load
    return {"instances": COMFYUI_INSTANCES}

# --- ComfyUI 工作流管理 ---
# GET /api/workflows、GET/POST /api/workflows、PUT .../config、DELETE ... 共 5 个路由
# 已迁移至 app/routers/workflows.py。/api/workflows/{name}/run 仍在下方（调用 generate）。

@app.post("/api/workflows/{name:path}/run")
def run_workflow(name: str, payload: WorkflowRunRequest):
    if not WORKFLOW_NAME_RE.match(name):
        raise HTTPException(status_code=400, detail="Invalid workflow name")
    if not get_comfy_workflow(name):
        raise HTTPException(status_code=404, detail="Workflow not found")
    if payload.resource_id or payload.connection_id:
        from app.ai.database_repository import DatabaseAIRepository
        try:
            target = DatabaseAIRepository().resolve_executable(
                resource_id=payload.resource_id,
                connection_id=payload.connection_id,
                kind="comfyui_workflow",
            )
        except LookupError as exc:
            raise HTTPException(status_code=404, detail="ComfyUI 工作流资源不存在或已禁用") from exc
        configured_name = str(target.resource.settings.get("workflow_name") or target.resource.settings.get("name") or "").strip()
        if configured_name and configured_name != name:
            raise HTTPException(status_code=409, detail="工作流资源与请求的工作流名称不匹配")
    # 根据 config 的字段把值映射成 params 节点覆盖
    params: Dict[str, Dict[str, Any]] = {}
    for field in payload.config.fields:
        if not field.node or not field.input:
            continue
        if field.id in payload.fields:
            value = payload.fields[field.id]
            # 类型转换
            if field.type in ("number", "slider"):
                try:
                    value = float(value) if (field.step and field.step < 1) else int(float(value))
                except Exception:
                    pass
            elif field.type == "boolean":
                value = bool(value)
            elif field.type == "dropdown":
                # 下拉值如果看起来是数字（如 "1024" / "2048" / "0.8"），自动转成 int/float
                if isinstance(value, str):
                    s = value.strip()
                    try:
                        if s and ('.' in s or 'e' in s.lower()):
                            value = float(s)
                        elif s and (s.lstrip('-').isdigit()):
                            value = int(s)
                    except (ValueError, TypeError):
                        pass
            params.setdefault(field.node, {})[field.input] = value
    req = GenerateRequest(
        prompt="",
        workflow_json=name,
        params=params,
        type="workflow-test",
        client_id=payload.client_id or str(uuid.uuid4()),
        connection_id=payload.connection_id,
        resource_id=payload.resource_id,
    )
    if payload.resource_id:
        req.params.setdefault("__ai_resource", {})["resource_id"] = payload.resource_id
    if payload.connection_id:
        req.params.setdefault("__ai_resource", {})["connection_id"] = payload.connection_id
    return generate(req)


# --- 注册按功能域拆分出的路由 ---
# 每个 router 使用独立 APIRouter()，URL/模型/状态码与原 main.py 完全一致。
from app.routers import conversations as conversations_router
from app.routers import prompts as prompts_router
from app.routers import canvases as canvases_router
from app.routers import assets as assets_router
from app.routers import shared_folders as shared_folders_router
from app.routers import history as history_router
from app.routers import local_assets as local_assets_router
from app.routers import files as files_router
from app.routers import workflows as workflows_router
from app.routers import pages as pages_router
from app.routers import access_control as access_control_router
from app.routers import organizations as organizations_router
from app.routers import feedback as feedback_router
from app.routers import help as help_router
from app.routers import announcement as announcement_router
from app.routers import storage_management as storage_management_router
from app.routers import usage as usage_router
from app.routers import canvas_agent as canvas_agent_router
from app.routers import user_data_migration as user_data_migration_router

app.include_router(conversations_router.router)
app.include_router(prompts_router.router)
app.include_router(canvases_router.router)
app.include_router(assets_router.router)
app.include_router(shared_folders_router.router)
app.include_router(history_router.router)
app.include_router(local_assets_router.router)
app.include_router(files_router.router)
app.include_router(workflows_router.router)
app.include_router(pages_router.router)
app.include_router(access_control_router.router)
app.include_router(organizations_router.router)
app.include_router(feedback_router.router)
app.include_router(help_router.router)
app.include_router(announcement_router.router)
app.include_router(storage_management_router.router)
app.include_router(usage_router.router)
app.include_router(canvas_agent_router.router)
app.include_router(user_data_migration_router.router)

if __name__ == "__main__":
    import argparse, uvicorn
    parser = argparse.ArgumentParser()
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=3000)
    args = parser.parse_args()
    uvicorn.run(app, host=args.host, port=args.port)
