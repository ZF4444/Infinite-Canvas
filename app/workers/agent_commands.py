"""Durable command worker for long-running Canvas Agent operations."""
from __future__ import annotations

import asyncio
import os
import socket
from typing import Any

from fastapi import HTTPException

from app.config import AGENT_COMMAND_POLL_SECONDS
from app.core.auth import USERS, current_user_var
from app.core.log_context import reset_log_context, set_log_context
from app.core.logging import get_logger
from app.services.canvas_agent.event_bus import AgentEventService
from app.services.canvas_agent.store import (
    claim_next_command,
    command_cancel_requested,
    finish_command,
    refresh_command_lease,
    update_run,
)

WORKER_ID = f"{socket.gethostname()}:{os.getpid()}"
logger = get_logger("canvas_agent")


async def _emit(user_id: str, run_id: str, operation_id: str, event_type: str, *, phase: str = "", severity: str = "info", payload: dict[str, Any] | None = None) -> None:
    await AgentEventService.append(user_id=user_id, run_id=run_id, operation_id=operation_id, event_type=event_type, phase=phase, severity=severity, payload=payload or {})


def _run_for_operation(operation_id: str) -> dict[str, Any] | None:
    from app.services.business_metadata import metadata_connection
    with metadata_connection() as conn, conn.cursor() as cur:
        cur.execute("SELECT r.* FROM canvas_agent_operations o JOIN canvas_agent_runs r ON r.id=o.run_id WHERE o.id=%s", (operation_id,))
        return cur.fetchone()


def _summary(result: Any) -> dict[str, Any]:
    body = result if isinstance(result, dict) else {}
    run = body.get("run") if isinstance(body.get("run"), dict) else {}
    return {"run_status": run.get("status", ""), "has_tasks": bool(body.get("tasks"))}


async def execute_command(operation: dict[str, Any]) -> None:
    """Execute a single claimed Canvas Agent command to completion.

    Resolves the run behind ``operation``, sets up per-command user/log/operation
    context, keeps the lease alive while running, and dispatches to the matching
    command handler based on the operation ``type``. Terminal state (succeeded,
    failed, blocked, or cancelled) is always persisted via ``finish_command`` and
    mirrored to the event bus, and all context tokens are reset on exit.

    Args:
        operation: The claimed operation row, expected to contain ``id``,
            ``run_id``, ``type`` and an optional ``input_json`` payload.
    """
    # Imported lazily to avoid a circular import between the worker and routers.
    from app.models import (
        CanvasAgentAnswerRequest,
        CanvasAgentConfirmRequest,
        CanvasAgentMessageRequest,
    )
    from app.routers.canvas_agent import (
        execute_answer_command,
        execute_confirm_command,
        execute_message_command,
    )
    from app.services.canvas_agent.events import (
        reset_current_operation,
        set_current_operation,
    )

    operation_id, run_id, kind = str(operation["id"]), str(operation["run_id"]), str(operation["type"])
    # Synchronous DB reads run in a thread to keep the event loop responsive.
    run = await asyncio.to_thread(_run_for_operation, operation_id)
    if not run:
        await asyncio.to_thread(finish_command, operation_id, status="failed", error="Run 不存在")
        return
    user_id = str(run["user_id"])
    # Honor a cancellation requested after the command was claimed.
    if await asyncio.to_thread(command_cancel_requested, operation_id):
        await asyncio.to_thread(finish_command, operation_id, status="cancelled", result={})
        await _emit(user_id, run_id, operation_id, "operation.cancelled", phase="cancelling", payload={"message": "Agent 命令已取消"})
        return
    phase = "confirmation" if kind == "agent.confirm" else "planning"
    username = str((USERS.get(user_id) or {}).get("username") or user_id)
    # Bind the acting user and structured log fields for the duration of the command.
    user_token = current_user_var.set(user_id)
    log_token = set_log_context(user_id=user_id, username=username, task_id=operation_id, run_id=run_id, operation_id=operation_id)
    await _emit(user_id, run_id, operation_id, "operation.started", phase=phase, payload={"message": "Agent 命令开始执行"})
    token = set_current_operation(operation_id)

    async def renew_lease() -> None:
        # Periodically extend the lease so another worker does not reclaim this run.
        while True:
            await asyncio.sleep(30)
            if not await asyncio.to_thread(refresh_command_lease, operation_id, WORKER_ID):
                return

    lease_task = asyncio.create_task(renew_lease())
    try:
        # Dispatch to the handler for this command type and record success.
        body = dict(operation.get("input_json") or {})
        if kind == "agent.message":
            result = await execute_message_command(user_id, run_id, CanvasAgentMessageRequest.model_validate(body))
        elif kind == "agent.answer":
            result = await execute_answer_command(user_id, run_id, CanvasAgentAnswerRequest.model_validate(body))
        elif kind == "agent.confirm":
            result = await execute_confirm_command(user_id, run_id, CanvasAgentConfirmRequest.model_validate(body))
        else:
            raise ValueError(f"unsupported command type: {kind}")
        await asyncio.to_thread(finish_command, operation_id, status="succeeded", result=_summary(result))
        await _emit(user_id, run_id, operation_id, "operation.succeeded", phase="execution" if kind == "agent.confirm" else "planning", payload={"message": "Agent 命令已完成"})
    except HTTPException as exc:
        # 409 means a transient conflict (retryable), so mark blocked instead of failed.
        detail = exc.detail if isinstance(exc.detail, str) else "命令无法继续执行"
        await asyncio.to_thread(finish_command, operation_id, status="blocked" if exc.status_code == 409 else "failed", error=str(detail))
        if exc.status_code != 409:
            await asyncio.to_thread(update_run, user_id, run_id, status="failed", phase=phase)
        logger.error(
            "canvas agent command rejected",
            extra={
                "event": "canvas_agent_command_rejected",
                "command_type": kind,
                "operation_id": operation_id,
                "run_id": run_id,
                "worker_id": WORKER_ID,
                "status_code": exc.status_code,
                "detail": str(detail)[:500],
            },
        )
        await _emit(user_id, run_id, operation_id, "operation.failed", phase="execution" if kind == "agent.confirm" else "planning", severity="error", payload={"message": str(detail), "status_code": exc.status_code})
    except Exception as exc:
        logger.exception(
            "canvas agent command failed",
            extra={
                "event": "canvas_agent_command_failed",
                "command_type": kind,
                "operation_id": operation_id,
                "run_id": run_id,
                "worker_id": WORKER_ID,
            },
        )
        await asyncio.to_thread(finish_command, operation_id, status="failed", error=str(exc))
        await asyncio.to_thread(update_run, user_id, run_id, status="failed", phase=phase)
        await _emit(user_id, run_id, operation_id, "operation.failed", phase="execution" if kind == "agent.confirm" else "planning", severity="error", payload={"message": "Agent 命令执行失败", "error": str(exc)[:500]})
    finally:
        # Stop lease renewal and unwind all context tokens set for this command.
        lease_task.cancel()
        reset_current_operation(token)
        reset_log_context(log_token)
        current_user_var.reset(user_token)


async def agent_command_worker_loop() -> None:
    while True:
        try:
            operation = await asyncio.to_thread(claim_next_command, WORKER_ID)
            if operation:
                await execute_command(operation)
            else:
                await asyncio.sleep(AGENT_COMMAND_POLL_SECONDS)
        except asyncio.CancelledError:
            raise
        except Exception:
            await asyncio.sleep(AGENT_COMMAND_POLL_SECONDS)
