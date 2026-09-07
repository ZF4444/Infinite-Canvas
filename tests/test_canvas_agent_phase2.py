import pytest

from app.models.canvas_agent import CanvasPatch, SemanticPlan
from app.services.canvas_agent.policy import validate_patch
from app.services.canvas_agent.reliability import canvas_structure_fingerprint, classify_failure, enforce_plan_limits
from app.routers.canvas_agent import _hydrate_plan_nodes


def test_structure_fingerprint_ignores_placement_and_transient_task_state():
    base = {"nodes": [{"id": "n1", "type": "smart-image", "x": 10, "y": 20, "generation_status": "queued"}], "connections": []}
    moved = {"nodes": [{"id": "n1", "type": "smart-image", "x": 900, "y": 400, "generation_status": "succeeded"}], "connections": []}
    changed = {"nodes": [{"id": "n1", "type": "smart-image", "text": "changed"}], "connections": []}
    assert canvas_structure_fingerprint(base) == canvas_structure_fingerprint(moved)
    assert canvas_structure_fingerprint(base) != canvas_structure_fingerprint(changed)


def test_plan_limits_block_excessive_work():
    plan = SemanticPlan.model_validate({"goal": "large", "steps": [{"id": str(i), "action": "canvas.create_node", "node": {"semantic_type": "prompt", "title": "x"}} for i in range(3)]})
    with pytest.raises(ValueError, match="配额"):
        enforce_plan_limits(plan.model_dump(mode="json"), {"max_nodes_created": 2})


def test_user_node_requires_explicit_per_node_authorization():
    patch = CanvasPatch(canvas_id="c", base_version=1, operations=[{"op": "replace_node_content", "node_id": "user:user-node", "content": "new"}])
    with pytest.raises(PermissionError):
        validate_patch(patch, allow_user_node_changes=True, authorized_node_ids=set())
    validate_patch(patch, allow_user_node_changes=True, authorized_node_ids={"user:user-node"})


def test_hydrate_plan_nodes_reuses_created_node_for_followup_execution_step():
    plan = {
        "steps": [
            {"id": "create-image", "action": "canvas.create_node", "node": {
                "semantic_type": "image_generation", "title": "产品主视觉",
                "content": "雨夜城市中的产品",
                "params": {"runSettings": {"model": "demo", "resolution": "2k"}},
            }},
            {"id": "run-image", "action": "canvas.run_node", "target_node_id": "create-image"},
        ]
    }
    hydrated = _hydrate_plan_nodes(plan, {"nodes": []})
    assert hydrated["steps"][1]["node"] == hydrated["steps"][0]["node"]


def test_hydrate_plan_nodes_normalizes_frontend_only_node_types():
    # smart-asset-image is a frontend-only asset node type. Hydration used to
    # copy it verbatim into semantic_type, which then failed SemanticPlan
    # validation during cost estimation.
    plan = {"goal": "render asset", "execution": {"capabilities": ["image.text_to_image"]}, "steps": [
        {"id": "create", "action": "canvas.create_node", "node": {
            "semantic_type": "image_generation", "title": "生成", "capability": "image.text_to_image"}},
        {"id": "run", "action": "canvas.run_node", "target_node_id": "asset-1"},
    ]}
    canvas = {"nodes": [{"id": "asset-1", "type": "smart-asset-image", "title": "素材", "url": "x.png"}]}
    hydrated = _hydrate_plan_nodes(plan, canvas)
    assert hydrated["steps"][1]["node"]["semantic_type"] == "image_generation"
    # The whole plan must remain valid for downstream cost estimation.
    from app.models.canvas_agent import SemanticPlan
    SemanticPlan.model_validate(hydrated)


def test_hydrate_plan_nodes_prefers_generation_prompt_over_imported_file_text():
    plan = {"steps": [{"id": "run", "action": "canvas.run_node", "target_node_id": "n1"}]}
    canvas = {"nodes": [{
        "id": "n1", "type": "smart-image", "title": "Image",
        "text": "data/image copy 18.png", "promptDraftText": "生成一只猫",
        "runSettings": {"model": "demo", "ratio": "16:9"},
    }]}
    hydrated = _hydrate_plan_nodes(plan, canvas)
    node = hydrated["steps"][0]["node"]
    assert node["content"] == "生成一只猫"
    assert node["params"]["runSettings"] == {"model": "demo", "ratio": "16:9"}


def test_hydrate_plan_nodes_uses_latest_canvas_values_over_stale_plan_snapshot():
    plan = {"steps": [{
        "id": "run", "action": "canvas.run_node", "target_node_id": "n1",
        "node": {"semantic_type": "smart-image", "title": "旧标题",
                  "content": "旧提示词", "params": {"runSettings": {"model": "old-model"}}},
    }]}
    canvas = {"nodes": [{
        "id": "n1", "type": "smart-image", "title": "新标题",
        "promptDraftText": "新提示词", "runSettings": {"model": "new-model"},
    }]}
    hydrated = _hydrate_plan_nodes(plan, canvas)
    node = hydrated["steps"][0]["node"]
    assert node["title"] == "新标题"
    assert node["content"] == "新提示词"
    assert node["params"]["runSettings"]["model"] == "new-model"


@pytest.mark.parametrize(("settings", "capability"), [
    ({"engine": "comfy", "apiKind": "image"}, "comfyui.workflow.image"),
    ({"engine": "comfy", "apiKind": "video"}, "comfyui.workflow.video"),
    ({"provider_id": "runninghub", "apiKind": "image"}, "image.text_to_image"),
])
def test_hydrate_plan_nodes_infers_provider_specific_capability(settings, capability):
    plan = {"steps": [{"id": "run", "action": "canvas.run_node", "target_node_id": "n1"}]}
    canvas = {"nodes": [{"id": "n1", "type": "smart-image", "runSettings": settings}]}
    assert _hydrate_plan_nodes(plan, canvas)["steps"][0]["node"]["capability"] == capability

def test_confirm_endpoint_rejects_stale_plan_version(monkeypatch):
    import asyncio
    from fastapi import HTTPException
    from app.models import CanvasAgentConfirmRequest
    from app.routers import canvas_agent

    async def fake_run(*_args): return {"status": "awaiting_confirmation"}
    monkeypatch.setattr(canvas_agent, "_user", lambda *_args: "owner")
    monkeypatch.setattr(canvas_agent, "_require_run", fake_run)
    monkeypatch.setattr(canvas_agent, "latest_plan", lambda *_args: {"version": 2})
    with pytest.raises(HTTPException) as exc:
        asyncio.run(canvas_agent.confirm_agent_plan("run-1", CanvasAgentConfirmRequest(plan_version=1), object()))
    assert exc.value.status_code == 409


def test_completed_run_can_start_the_next_planning_turn():
    from app.routers.canvas_agent import _can_continue_planning

    assert _can_continue_planning("completed") is True
    assert _can_continue_planning("running") is True
    assert _can_continue_planning("cancelled") is False
    assert _can_continue_planning("failed") is False
    assert _can_continue_planning("blocked") is False


def test_canvas_media_references_use_the_saved_node_media(monkeypatch):
    from app.services.canvas_agent import context

    monkeypatch.setattr(context, "load_canvas_payload", lambda *_args: {
        "version": 7,
        "nodes": [{"id": "node-1", "title": "猫", "images": [{"url": "/api/files/first"}, {"url": "/api/files/second"}]}],
        "connections": [],
    })

    result = context.build_canvas_context("owner", "canvas-1", media_references=[
        {"node_id": "node-1", "image_index": 1, "url": "https://example.invalid/forged"},
        {"node_id": "missing", "image_index": 0},
    ])

    assert result["media_references"] == [{
        "node_id": "node-1", "image_index": 1, "url": "/api/files/second", "label": "图1", "node_label": "猫", "source": "canvas",
    }]


@pytest.mark.parametrize("event_type", ["plan.confirmed", "plan.rejected"])
def test_plan_decision_is_a_supported_agent_event(event_type):
    from app.services.canvas_agent.event_types import normalize_event_type

    assert normalize_event_type(event_type) == event_type


def test_rejected_plan_resumes_graph_and_keeps_run_available(monkeypatch):
    import asyncio
    from contextlib import asynccontextmanager
    from app.models import CanvasAgentConfirmRequest
    from app.routers import canvas_agent
    from app.services.canvas_agent import runtime

    run = {"id": "run-1", "canvas_id": "canvas-1", "status": "awaiting_confirmation"}
    updates, events, resumes = [], [], []

    async def fake_require_run(*_args):
        return dict(run)

    @asynccontextmanager
    async def fake_checkpointer():
        yield object()

    class FakeGraph:
        async def ainvoke(self, command, *, config):
            resumes.append((command.resume, config))
            return {}

    def fake_update_run(*_args, **changes):
        run.update(changes)
        updates.append(changes)
        return dict(run)

    async def fake_emit(*_args):
        events.append((_args[2], _args[3]))

    monkeypatch.setattr(canvas_agent, "_require_run", fake_require_run)
    monkeypatch.setattr(canvas_agent, "latest_plan", lambda *_args: {"version": 1})
    monkeypatch.setattr(canvas_agent, "create_async_checkpointer", fake_checkpointer)
    monkeypatch.setattr(canvas_agent, "update_run", fake_update_run)
    monkeypatch.setattr(canvas_agent, "set_plan_status", lambda *_args: None)
    monkeypatch.setattr(canvas_agent, "get_run", lambda *_args: dict(run))
    monkeypatch.setattr(canvas_agent, "emit_agent_event", fake_emit)
    monkeypatch.setattr(runtime, "create_canvas_agent", lambda **_kwargs: FakeGraph())

    result = asyncio.run(canvas_agent.execute_confirm_command("owner", "run-1", CanvasAgentConfirmRequest(plan_version=1, approved=False)))

    assert resumes == [({"approved": False}, {"configurable": {"thread_id": "run-1"}})]
    assert updates == [{"status": "planning", "phase": "planning"}]
    assert result["run"]["status"] == "planning"
    assert events == []


@pytest.mark.parametrize("error,category", [("upstream timeout", "transient"), ("canvas version conflict", "conflict"), ("budget limit exceeded", "quota"), ("permission denied", "permission"), ("invalid schema", "permanent")])
def test_failure_classification(error, category):
    assert classify_failure(error) == category
