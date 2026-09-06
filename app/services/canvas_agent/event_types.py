"""Stable public contract for Canvas Agent run events."""
from __future__ import annotations

from typing import Any
import os

from app.core.logging import get_logger

EVENT_SCHEMA_VERSION = 1
MAX_EVENT_PAYLOAD_BYTES = 24_000

PRESENTATION_TARGETS = {
    "conversation_progress",
    "skill_badge",
    "canvas_refresh",
    "system_notice",
}
PRESENTATION_STATES = {"started", "updated", "succeeded", "failed", "rejected"}

PHASES = {"", "context", "model", "agent", "tool", "skill", "validation", "confirmation", "execution", "reviewing", "running", "planning", "applying", "cancelling", "message", "answer"}
SEVERITIES = {"info", "warning", "error"}

EVENT_TYPES = {
    "run.created", "run.completed", "run.failed", "run.blocked", "run.cancelled", "run.reviewed", "run.retrying",
    "operation.accepted", "operation.queued", "operation.started", "operation.succeeded", "operation.failed", "operation.cancel_requested", "operation.cancelled",
    "progress", "progress.context", "progress.model", "progress.agent", "progress.tool_started", "progress.tool_completed", "progress.tool_failed", "progress.validation", "progress.confirmation", "progress.execution",
    "message.replied", "plan.created", "plan.confirmed", "plan.rejected", "patch.applied", "tasks.queued", "task.queued", "task.running", "task.succeeded", "task.failed", "task.timed_out", "task.cancelled", "task.retrying",
    "artifact.created", "artifact.advanced", "artifact.status_changed", "artifact.quality_evaluated", "prompt_pack.compiled", "prompt_pack.tasks_queued", "orchestration.proposed", "template.instantiated", "project_asset.shared",
    "skill.discovered", "skill.loaded", "skill.resource_loaded", "skill.rejected", "skill.resource_rejected", "skill.invalidated",
}

logger = get_logger("canvas_agent")

_SENSITIVE_KEYS = {"api_key", "apikey", "authorization", "cookie", "password", "secret", "token", "access_key", "private_key"}


def normalize_event_type(value: str) -> str:
    event_type = str(value or "").removeprefix("agent.")
    if event_type not in EVENT_TYPES:
        # Keep enough runtime identity to diagnose stale/mixed worker processes.
        logger.error(
            "unsupported canvas agent event type",
            extra={
                "event": "canvas_agent_event_type_unsupported",
                "requested_event_type": str(value or ""),
                "normalized_event_type": event_type,
                "process_id": os.getpid(),
                "module_file": __file__,
                "event_types_contains": event_type in EVENT_TYPES,
                "event_types_count": len(EVENT_TYPES),
            },
        )
        raise ValueError(f"unsupported agent event type: {event_type}")
    return event_type


def sanitize_payload(value: dict[str, Any] | None) -> dict[str, Any]:
    """Drop credentials and cap payload size before it reaches DB/Redis/browser."""
    def clean(item: Any, depth: int = 0) -> Any:
        if depth > 8:
            return "[truncated]"
        if isinstance(item, dict):
            return {str(key): "[redacted]" if str(key).lower() in _SENSITIVE_KEYS else clean(child, depth + 1) for key, child in item.items()}
        if isinstance(item, (list, tuple)):
            return [clean(child, depth + 1) for child in item[:100]]
        if isinstance(item, str):
            return item[:8_000]
        return item

    payload = clean(dict(value or {}))
    import json
    encoded = json.dumps(payload, ensure_ascii=False, default=str)
    if len(encoded.encode("utf-8")) <= MAX_EVENT_PAYLOAD_BYTES:
        return payload
    return {"message": str(payload.get("message") or "事件内容过大，已截断")[:2_000], "truncated": True}


def validate_presentation_payload(payload: dict[str, Any]) -> None:
    """Validate the optional, declarative UI projection for an Agent event."""
    presentation = payload.get("presentation")
    if presentation is None:
        return
    if not isinstance(presentation, dict):
        raise ValueError("agent event presentation must be an object")
    targets = presentation.get("targets")
    if not isinstance(targets, list) or not targets or any(target not in PRESENTATION_TARGETS for target in targets):
        raise ValueError("agent event presentation has unsupported targets")
    if "conversation_progress" in targets:
        if not str(payload.get("message") or "").strip():
            raise ValueError("conversation progress event requires a message")
        if not str(presentation.get("group_id") or "").strip():
            raise ValueError("conversation progress event requires a group_id")
        if presentation.get("state") not in PRESENTATION_STATES:
            raise ValueError("conversation progress event has unsupported state")
    tool_name = str(payload.get("tool_name") or "")
    tool_call_id = str(payload.get("tool_call_id") or "")
    if tool_name and not tool_call_id:
        raise ValueError("tool event requires a tool_call_id")
    if tool_call_id and "conversation_progress" in targets:
        if str(presentation.get("group_id") or "") != f"tool:{tool_call_id}":
            raise ValueError("tool progress group_id must match tool_call_id")


def normalize_presentation_payload(payload: dict[str, Any]) -> dict[str, Any]:
    """Keep display-contract bugs observable without breaking Agent execution."""
    try:
        validate_presentation_payload(payload)
    except ValueError as exc:
        from app.core.metrics import AGENT_EVENT_PRESENTATION_INVALID
        logger.error(
            "invalid canvas agent event presentation",
            extra={"event": "canvas_agent_event_presentation_invalid", "error": str(exc)},
        )
        AGENT_EVENT_PRESENTATION_INVALID.inc()
        payload.pop("presentation", None)
    return payload


def event_envelope(event: dict[str, Any]) -> dict[str, Any]:
    return {
        "schema_version": int(event.get("schema_version") or EVENT_SCHEMA_VERSION),
        "id": str(event["id"]),
        "sequence": int(event["sequence"]),
        "run_id": str(event["run_id"]),
        "operation_id": str(event.get("operation_id") or ""),
        "type": str(event["type"]),
        "phase": str(event.get("phase") or ""),
        "severity": str(event.get("severity") or "info"),
        "created_at": int(event["created_at"]),
        "payload": dict(event.get("payload_json") or {}),
    }
