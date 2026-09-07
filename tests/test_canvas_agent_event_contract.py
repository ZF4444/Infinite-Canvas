import json

from app.services.canvas_agent.event_factory import (
    patch_applied,
    skill_loaded,
    task_lifecycle,
    tool_completed,
    tool_started,
    tool_timed_out,
)
from app.services.canvas_agent.event_types import (
    event_envelope,
    normalize_event_type,
    normalize_presentation_payload,
    sanitize_payload,
    validate_presentation_payload,
)


def test_event_contract_rejects_unknown_types_and_redacts_secrets():
    try:
        normalize_event_type("unexpected.event")
    except ValueError:
        pass
    else:
        raise AssertionError("unknown event type must be rejected")
    payload = sanitize_payload({"api_key": "secret", "nested": {"Authorization": "token"}, "message": "ok"})
    assert payload == {"api_key": "[redacted]", "nested": {"Authorization": "[redacted]"}, "message": "ok"}


def test_event_envelope_has_stable_client_fields():
    envelope = event_envelope({"id": "evt", "run_id": "run", "sequence": 2, "type": "progress.agent", "created_at": 1, "payload_json": {"message": "working"}})
    assert envelope["schema_version"] == 1
    assert envelope["run_id"] == "run"
    assert envelope["payload"]["message"] == "working"


def test_presentation_contract_keeps_tool_group_and_closed_states_consistent():
    started = tool_started(tool_name="read_canvas_skill", tool_call_id="call-1")
    assert started.payload["presentation"] == {
        "targets": ["conversation_progress"],
        "group_id": "tool:call-1",
        "state": "started",
    }
    loaded = skill_loaded(tool_call_id="call-1", name="demo", content_sha256="abc")
    validate_presentation_payload(loaded.payload)
    assert loaded.payload["presentation"]["state"] == "succeeded"
    assert loaded.payload["presentation"]["group_id"] == "tool:call-1"
    audit = tool_completed(tool_name="read_canvas_skill", tool_call_id="call-1", visible=False)
    assert "presentation" not in audit.payload


def test_task_and_patch_events_declare_canvas_refresh_projection():
    task = task_lifecycle("succeeded", {"task_id": "task-1", "node_id": "node-1", "result": {}})
    assert task.payload["presentation"]["targets"] == ["canvas_refresh"]
    patch = patch_applied({"version": 3})
    assert patch.payload["presentation"]["targets"] == ["canvas_refresh"]
    cancelled = task_lifecycle("interrupted", {"task_id": "task-1"})
    assert cancelled.event_type == "task.cancelled"
    assert cancelled.payload["status"] == "cancelled"


def test_invalid_presentation_degrades_without_breaking_event_payload():
    payload = {"message": "working", "presentation": {"targets": ["run_javascript"]}}
    normalize_presentation_payload(payload)
    assert "presentation" not in payload


def test_timed_out_tool_event_closes_the_original_group():
    timeout = tool_timed_out(tool_name="read_canvas_skill", tool_call_id="call-timeout")
    validate_presentation_payload(timeout.payload)
    assert timeout.event_type == "progress.tool_failed"
    assert timeout.payload["timeout"] is True
    assert timeout.payload["presentation"]["group_id"] == "tool:call-timeout"
    assert timeout.payload["presentation"]["state"] == "failed"


def test_expired_tool_group_reconciliation_only_counts_atomic_closures(monkeypatch):
    import asyncio
    from app.services.canvas_agent import event_bus

    group = {
        "user_id": "user-1",
        "run_id": "run-1",
        "tool_call_id": "call-1",
        "tool_name": "read_canvas_skill",
        "created_at": 100,
    }
    closed = []
    monkeypatch.setattr(event_bus, "scan_open_tool_groups_sync", lambda _timeout: (1, [group]))
    monkeypatch.setattr(
        event_bus.AgentEventService,
        "close_expired_tool_group_sync",
        lambda **kwargs: closed.append(kwargs) or True,
    )

    assert asyncio.run(event_bus.reconcile_expired_tool_groups()) == 1
    assert closed[0]["run_id"] == "run-1"
    assert closed[0]["payload"]["timeout"] is True
    assert closed[0]["payload"]["presentation"]["group_id"] == "tool:call-1"


def test_m4_event_observability_metrics_are_exported():
    from app.core.metrics import render_metrics

    metrics = render_metrics()
    assert b"mediaforge_canvas_agent_event_presentation_invalid_total" in metrics
    assert b"mediaforge_canvas_agent_event_presentation_unknown_targets_total" in metrics
    assert b"mediaforge_canvas_agent_tool_group_timeouts_total" in metrics
    assert b"mediaforge_canvas_agent_open_tool_groups" in metrics


def test_unknown_presentation_target_reports_a_diagnostic_without_failing_client(monkeypatch):
    import asyncio

    from app.core.metrics import AGENT_EVENT_PRESENTATION_UNKNOWN_TARGETS
    from app.routers import canvas_agent

    class Request:
        async def json(self):
            return {"target": "future_surface"}

    monkeypatch.setattr(canvas_agent, "_user", lambda *_args: "user-1")
    before = AGENT_EVENT_PRESENTATION_UNKNOWN_TARGETS._value.get()
    response = asyncio.run(canvas_agent.canvas_agent_presentation_diagnostics(Request()))
    assert response.status_code == 204
    assert AGENT_EVENT_PRESENTATION_UNKNOWN_TARGETS._value.get() == before + 1


def test_worker_auth_context_is_available_in_to_thread():
    import asyncio
    from app.core.auth import current_user_id, current_user_var

    async def check() -> str:
        token = current_user_var.set("agent-owner")
        try:
            return await asyncio.to_thread(current_user_id)
        finally:
            current_user_var.reset(token)

    assert asyncio.run(check()) == "agent-owner"


def test_agent_task_projection_keeps_structured_media_and_clears_terminal_state(monkeypatch):
    from app.services.canvas_agent import events

    timer_values = iter([1000, 2000, 3000])
    monkeypatch.setattr(events, "now_ms", lambda: next(timer_values))
    node = {"id": "node-1", "type": "smart-image"}
    updates = []

    class Cursor:
        def execute(self, query, params=()):
            if "UPDATE smart_canvas_nodes" in query:
                projected = json.loads(params[0])
                updates.append(projected)
                node.clear()
                node.update(projected)
        def fetchone(self):
            if not hasattr(self, "calls"): self.calls = 0
            self.calls += 1
            if self.calls == 1: return {"canvas_id": "canvas-1"}
            if self.calls == 2: return {"data_json": node}
            return {"version": 2}
        def __enter__(self): return self
        def __exit__(self, *_): return False

    class Connection:
        def cursor(self): return Cursor()
        def transaction(self): return self
        def __enter__(self): return self
        def __exit__(self, *_): return False

    monkeypatch.setattr(events, "metadata_connection", lambda: Connection())
    queued = {"task_id": "task-1", "node_id": "node-1", "status": "queued", "kind": "image", "expected_count": 1}
    assert events._project_task_to_canvas("user", "run", queued) == 2
    assert updates[-1]["pendingTasks"] == [{"taskId": "task-1", "kind": "image", "connectionId": "", "modelId": "", "resourceId": "", "expectedCount": 1, "status": "queued"}]
    assert updates[-1]["queued"] is True
    assert updates[-1]["runStartedAt"] > 0
    started_at = updates[-1]["runStartedAt"]

    assert events._project_task_to_canvas("user", "run", {"task_id": "task-1", "node_id": "node-1", "status": "running"}) == 2
    assert updates[-1]["pendingTasks"][0]["expectedCount"] == 1
    assert updates[-1]["running"] is True

    succeeded = {**queued, "status": "succeeded", "result": {"image_items": [{"file_id": "image-1", "natural_w": 864, "natural_h": 1536}]}}
    assert events._project_task_to_canvas("user", "run", succeeded) == 2
    assert updates[-1]["images"] == [{"file_id": "image-1", "natural_w": 864, "natural_h": 1536}]
    assert updates[-1]["pending"] == 0
    assert "pendingTasks" not in updates[-1]
    assert "queued" not in updates[-1]
    assert "running" not in updates[-1]
    assert updates[-1]["runStartedAt"] == started_at
    assert updates[-1]["runFinishedAt"] >= started_at
    assert updates[-1]["runElapsedMs"] >= 0

    rerun = {"task_id": "task-2", "node_id": "node-1", "status": "queued", "kind": "image", "expected_count": 1}
    assert events._project_task_to_canvas("user", "run", rerun) == 2
    assert updates[-1]["runStartedAt"] == 3000


def test_tool_completed_detail_overrides_default_label():
    default = tool_completed(tool_name="read_canvas_context", tool_call_id="call-1")
    assert default.payload["message"] == "已完成画布上下文"
    override = tool_completed(
        tool_name="read_canvas_context",
        tool_call_id="call-1",
        detail="已完成画布上下文读取",
    )
    assert override.payload["message"] == "已完成画布上下文读取"


def test_read_canvas_context_completion_detail_full_vs_specific_nodes():
    from app.services.canvas_agent.runtime import _completion_detail

    # Full read: no selected node ids.
    assert _completion_detail("read_canvas_context", {}, {"selected_nodes": []}) == "已完成画布上下文读取"

    # Specific nodes resolve to their display titles/names.
    result = {
        "selected_nodes": [
            {"id": "n1", "title": "构图节点"},
            {"id": "n2", "name": "上色"},
        ]
    }
    detail = _completion_detail(
        "read_canvas_context",
        {"selected_node_ids": ["n1", "n2"]},
        result,
    )
    assert detail == "已读取构图节点、上色节点"

    # Unresolvable ids fall back to the raw id.
    fallback = _completion_detail(
        "read_canvas_context",
        {"selected_node_ids": ["missing"]},
        {"selected_nodes": []},
    )
    assert fallback == "已读取missing节点"

    # Non-context tools keep the default label (empty detail).
    assert _completion_detail("read_artifact", {}, None) == ""
