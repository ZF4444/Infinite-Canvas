"""Submit approved generation intents through the existing Canvas Task queue."""
from __future__ import annotations
import uuid
import asyncio
import time
from app.config import CANVAS_TASK_TIMEOUT_SECONDS
from app.ai.runtime import authorize_target_task, normalize_canvas_image_payload
from typing import Any
from app.services.business_metadata import load_canvas_payload
from app.services.canvas_tasks import create_canvas_task, enqueue_canvas_task
from .capabilities import from_repository


def _image_request_for_node(node: dict[str, Any], fallback_capability: Any, fallback_prompt: str,
                            prompts_by_node: dict[str, str] | None) -> dict[str, Any]:
    """Use the same persisted runSettings contract as manually-run image nodes."""
    settings = node.get("runSettings") if isinstance(node.get("runSettings"), dict) else {}
    if str(node.get("genKind") or "image") != "image" or str(settings.get("apiKind") or "image") != "image":
        raise ValueError("指定节点不是 API 生图节点")
    connection_id = str(settings.get("connection_id") or node.get("connection_id") or "")
    model_id = str(settings.get("model_id") or node.get("model_id") or "")
    resource_id = str(settings.get("resource_id") or node.get("resource_id") or "")
    model = str(settings.get("model") or node.get("model") or "")
    if not (connection_id or model_id or resource_id):
        raise ValueError("指定生图节点未配置 connection_id/model_id/resource_id")
    prompt = str((prompts_by_node or {}).get(node["id"]) or node.get("text") or fallback_prompt or "").strip()
    if not prompt:
        raise ValueError("指定生图节点缺少提示词")
    count = settings.get("count", settings.get("n", 1))
    try:
        count = min(4, max(1, int(count)))
    except (TypeError, ValueError):
        count = 1
    # Keep the raw canvas settings with the task. The normal canvas endpoint
    # resolves model parameter mappings from this object before execution.
    request = {
        "prompt": prompt,
        "connection_id": connection_id,
        "model_id": model_id,
        "resource_id": resource_id,
        "model": model,
        "size": "1024x1024",
        "quality": str(settings.get("quality") or "auto"),
        "n": count,
        "reference_images": [],
        "run_settings": settings,
    }
    # Persist authoritative resource identifiers when the node still carries
    # only its legacy target snapshot.
    try:
        from app.ai.database_repository import DatabaseAIRepository
        repo = DatabaseAIRepository()
        # Resolution is performed by the async submitter; keep this helper
        # synchronous because it is also used by unit tests and tooling.
    except LookupError:
        pass
    # Agent tasks enter the Redis queue directly, whereas manual canvas runs
    # pass through this normalizer in the HTTP endpoint. Reuse it here so
    # both paths use identical ratio/size and target-field conversion.
    return request


async def submit_run_requests(user_id: str, canvas_id: str, run_id: str, requests: list[dict[str, Any]], *, prompt: str, prompts_by_node: dict[str, str] | None = None) -> list[dict[str, Any]]:
    canvas = await asyncio.to_thread(load_canvas_payload, user_id, canvas_id)
    if not canvas: raise PermissionError("canvas not found")
    nodes = {str(node.get("id")): node for node in canvas.get("nodes", []) if isinstance(node, dict)}
    registry = await asyncio.to_thread(from_repository)
    capability = registry.get("image.text_to_image")
    submitted = []
    for item in requests:
        if item.get("op") != "run_node":
            raise ValueError(f"暂不支持执行操作：{item.get('op') or 'unknown'}")
        node = nodes.get(str(item.get("node_id") or ""))
        if not node:
            raise ValueError("指定的画布节点不存在")
        if node.get("type") == "smart-prompt":
            # Prompt generation is currently persisted on the node by the
            # caller/model flow; it is not an online-image queue task.
            raise ValueError("提示词节点不能直接执行生图，请指定生图节点")
        if node.get("type") != "smart-image":
            raise ValueError("指定节点不是生图节点")
        if capability is None:
            raise ValueError("当前没有可用的生图模型")
        task_id = f"canvas_agent_img_{uuid.uuid4().hex}"
        request = _image_request_for_node(node, capability, prompt, prompts_by_node)
        from app.models import OnlineImageRequest
        request = (await asyncio.to_thread(
            normalize_canvas_image_payload,
            OnlineImageRequest.model_validate(request),
        )).model_dump(mode="json")
        try:
            from app.ai.database_repository import DatabaseAIRepository
            repo = DatabaseAIRepository()
            if request.get("resource_id"):
                target = await asyncio.to_thread(repo.resolve_executable, resource_id=request["resource_id"], kind="image")
                request.update({"connection_id": target.connection.id, "resource_id": target.resource.id})
            else:
                target = await asyncio.to_thread(repo.resolve_model, model_id=request.get("model_id", ""), connection_id=request.get("connection_id", ""), model=request.get("model", ""), kind="image")
                request.update({"connection_id": target.connection.id, "model_id": target.model.id, "model": target.model.upstream_model})
        except (LookupError, RuntimeError):
            raise ValueError("生图节点的稳定资源标识无效或已禁用")
        # Reuse the existing access-control resolver; the Agent never chooses
        # an unapproved connection/model pair directly.
        await authorize_target_task(target, user_id)
        persisted_request = dict(request)
        for key in ("provider_id", "provider", "model"):
            persisted_request.pop(key, None)
        task_data = {
            "id": task_id, "type": "online-image", "status": "queued",
            "connection_id": request.get("connection_id", ""),
            "model_id": request.get("model_id", ""),
            "resource_id": request.get("resource_id", ""),
            "owner_id": user_id, "agent_run_id": run_id,
            "agent_node_id": node["id"],
            "deadline_at": time.time() + CANVAS_TASK_TIMEOUT_SECONDS,
            "attempt": 1, "request": persisted_request,
        }
        if not (task_data["connection_id"] or task_data["model_id"] or task_data["resource_id"]):
            raise ValueError("生图任务未解析到有效的 connection_id/model_id")
        await create_canvas_task(task_data)
        # Queue submission is the first authoritative lifecycle transition.
        # Project it immediately so the canvas node shows a pending state
        # before a worker claims the task and begins image generation.
        from .event_factory import task_lifecycle
        from .events import emit_agent_event
        task_event = task_lifecycle("queued", {
            "task_id": task_id,
            "node_id": node["id"],
            "status": "queued",
            "connection_id": request.get("connection_id", ""),
            "model_id": request.get("model_id", ""),
            "resource_id": request.get("resource_id", ""),
            "kind": "image",
            "expected_count": request["n"],
        })
        await emit_agent_event(
            user_id,
            run_id,
            task_event.event_type,
            task_event.payload,
            phase=task_event.phase,
            severity=task_event.severity,
        )
        # The queued projection must be committed before workers can claim the
        # task. Otherwise a fast success can be overwritten by a late queued
        # event and leave the node permanently disabled.
        await enqueue_canvas_task(task_id)
        submitted.append({"task_id": task_id, "node_id": node["id"], "status": "queued"})
    return submitted
