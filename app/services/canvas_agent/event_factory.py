"""Canonical, user-visible Canvas Agent event semantics.

This module has no persistence or transport responsibilities. Callers construct
an ``EventSpec`` here, then submit it through ``emit_agent_event``.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Any


@dataclass(frozen=True)
class EventSpec:
    event_type: str
    payload: dict[str, Any]
    phase: str = ""
    severity: str = "info"


_TOOL_LABELS = {
    "read_canvas_context": "画布上下文",
    "read_capability_registry": "可用能力",
    "read_capability_parameters": "节点配置",
    "read_artifact": "关联素材",
    "read_canvas_skill": "技能说明",
    "read_canvas_skill_file": "技能参考资料",
    "propose_canvas_patch": "执行计划",
    "request_clarification": "补充信息",
    "execute_canvas_patch": "画布变更",
}

_TASK_MESSAGES = {
    "queued": "生成任务已提交",
    "running": "生成任务执行中",
    "succeeded": "生成任务已完成",
    "failed": "生成任务失败",
    "timed_out": "生成任务超时",
    "cancelled": "生成任务已取消",
    "retrying": "生成任务正在重试",
}


def _presentation(
    *targets: str,
    group_id: str = "",
    state: str = "",
    history: bool = False,
) -> dict[str, Any]:
    body: dict[str, Any] = {"targets": list(targets)}
    if group_id:
        body["group_id"] = group_id
    if state:
        body["state"] = state
    if history:
        body["history"] = True
    return body


def progress(phase: str, message: str) -> EventSpec:
    """Create a non-terminal run-level progress update."""
    return EventSpec(
        event_type=f"progress.{phase}",
        phase=phase,
        payload={
            "message": str(message)[:500],
            "presentation": _presentation(
                "conversation_progress",
                group_id=f"phase:{phase}",
                state="updated",
            ),
        },
    )


def tool_started(*, tool_name: str, tool_call_id: str) -> EventSpec:
    label = _TOOL_LABELS.get(tool_name, "画布工具")
    return EventSpec(
        event_type="progress.tool_started",
        phase="tool",
        payload={
            "message": f"正在读取{label}" if tool_name.startswith("read_") else f"正在处理{label}",
            "tool_name": tool_name,
            "tool_call_id": tool_call_id,
            "subject": {"kind": "tool", "name": tool_name},
            "presentation": _presentation(
                "conversation_progress",
                group_id=f"tool:{tool_call_id}",
                state="started",
            ),
        },
    )


def tool_completed(*, tool_name: str, tool_call_id: str, visible: bool = True) -> EventSpec:
    label = _TOOL_LABELS.get(tool_name, "画布工具")
    payload = {
        "message": f"已完成{label}",
        "tool_name": tool_name,
        "tool_call_id": tool_call_id,
        "subject": {"kind": "tool", "name": tool_name},
    }
    if visible:
        payload["presentation"] = _presentation(
            "conversation_progress",
            group_id=f"tool:{tool_call_id}",
            state="succeeded",
            history=True,
        )
    return EventSpec(
        event_type="progress.tool_completed",
        phase="tool",
        payload=payload,
    )


def tool_failed(*, tool_name: str, tool_call_id: str) -> EventSpec:
    label = _TOOL_LABELS.get(tool_name, "画布工具")
    return EventSpec(
        event_type="progress.tool_failed",
        phase="tool",
        severity="error",
        payload={
            "message": f"{label}执行失败",
            "tool_name": tool_name,
            "tool_call_id": tool_call_id,
            "subject": {"kind": "tool", "name": tool_name},
            "presentation": _presentation(
                "conversation_progress",
                group_id=f"tool:{tool_call_id}",
                state="failed",
                history=True,
            ),
        },
    )


def tool_timed_out(*, tool_name: str, tool_call_id: str) -> EventSpec:
    """Close a stale tool group without relying on a crashed worker."""
    label = _TOOL_LABELS.get(tool_name, "画布工具")
    return EventSpec(
        event_type="progress.tool_failed",
        phase="tool",
        severity="error",
        payload={
            "message": f"{label}执行超时，已自动结束",
            "tool_name": tool_name,
            "tool_call_id": tool_call_id,
            "subject": {"kind": "tool", "name": tool_name},
            "timeout": True,
            "presentation": _presentation(
                "conversation_progress",
                group_id=f"tool:{tool_call_id}",
                state="failed",
                history=True,
            ),
        },
    )


def skill_loaded(*, tool_call_id: str, name: str, content_sha256: str) -> EventSpec:
    skill = {"name": name, "content_sha256": content_sha256}
    return EventSpec(
        event_type="skill.loaded",
        phase="skill",
        payload={
            "message": f"已读取 {name} 技能",
            "tool_name": "read_canvas_skill",
            "tool_call_id": tool_call_id,
            "skill": skill,
            "subject": {"kind": "skill", **skill},
            "presentation": _presentation(
                "conversation_progress",
                "skill_badge",
                group_id=f"tool:{tool_call_id}",
                state="succeeded",
                history=True,
            ),
        },
    )


def skill_rejected(*, tool_call_id: str, name: str, reason: str) -> EventSpec:
    return EventSpec(
        event_type="skill.rejected",
        phase="skill",
        severity="warning",
        payload={
            "message": f"读取 {name} 技能被拒绝：{str(reason)[:200]}",
            "tool_name": "read_canvas_skill",
            "tool_call_id": tool_call_id,
            "skill": {"name": name},
            "subject": {"kind": "skill", "name": name},
            "reason": str(reason)[:500],
            "presentation": _presentation(
                "conversation_progress",
                group_id=f"tool:{tool_call_id}",
                state="rejected",
                history=True,
            ),
        },
    )


def skill_resource_loaded(*, tool_call_id: str, name: str, resource: dict[str, Any]) -> EventSpec:
    path = str(resource.get("path") or "Skill 资源")
    return EventSpec(
        event_type="skill.resource_loaded",
        phase="skill",
        payload={
            "message": f"已读取 {path}",
            "tool_name": "read_canvas_skill_file",
            "tool_call_id": tool_call_id,
            "skill": {"name": name},
            "resource": resource,
            "subject": {"kind": "skill_resource", "skill_name": name, "path": path},
            "presentation": _presentation(
                "conversation_progress",
                group_id=f"tool:{tool_call_id}",
                state="succeeded",
                history=True,
            ),
        },
    )


def skill_resource_rejected(*, tool_call_id: str, name: str, path: str, reason: str) -> EventSpec:
    return EventSpec(
        event_type="skill.resource_rejected",
        phase="skill",
        severity="warning",
        payload={
            "message": f"读取 {path or 'Skill 资源'} 被拒绝：{str(reason)[:200]}",
            "tool_name": "read_canvas_skill_file",
            "tool_call_id": tool_call_id,
            "skill": {"name": name},
            "resource": {"path": path},
            "subject": {"kind": "skill_resource", "skill_name": name, "path": path},
            "reason": str(reason)[:500],
            "presentation": _presentation(
                "conversation_progress",
                group_id=f"tool:{tool_call_id}",
                state="rejected",
                history=True,
            ),
        },
    )


def task_lifecycle(status: str, payload: dict[str, Any]) -> EventSpec:
    status = {"interrupted": "cancelled"}.get(str(status), str(status))
    body = dict(payload)
    body["status"] = status
    task_id = str(body.get("task_id") or "")
    body.update({
        "message": _TASK_MESSAGES.get(status, "生成任务状态已更新"),
        "subject": {"kind": "task", "id": task_id, "node_id": str(body.get("node_id") or "")},
        "presentation": _presentation("canvas_refresh"),
    })
    if status in {"failed", "timed_out"}:
        body["presentation"] = _presentation("canvas_refresh", "system_notice")
    return EventSpec(
        event_type=f"task.{status}",
        phase="running",
        severity="error" if status in {"failed", "timed_out"} else "info",
        payload=body,
    )


def patch_applied(payload: dict[str, Any]) -> EventSpec:
    body = dict(payload)
    body.setdefault("message", "画布变更已应用")
    body["presentation"] = _presentation("canvas_refresh")
    return EventSpec(
        event_type="patch.applied",
        phase="execution",
        payload=body,
    )
