import asyncio

import pytest

from app.models.canvas_agent import SemanticPlan
from app.services.canvas_agent.adapter import semantic_plan_to_patch
from app.services.canvas_agent.capabilities import Capability, CapabilityRegistry
from app.services.canvas_agent.policy import assess_patch, validate_patch
from app.services.canvas_agent.evaluation import evaluate_plan
from app.services.canvas_agent.runtime import create_canvas_agent

def test_semantic_plan_converts_to_versioned_patch():
    plan = SemanticPlan.model_validate({"goal": "create visual", "steps": [
        {"id": "prompt", "action": "canvas.create_node", "node": {"semantic_type": "smart-prompt", "content": "product"}},
        {"id": "image", "action": "canvas.create_node", "node": {"semantic_type": "smart-image", "capability": "image.text_to_image"}},
        {"id": "edge", "action": "canvas.connect", "from_step": "prompt", "to_step": "image", "relation": "prompt"},
    ]})
    patch = semantic_plan_to_patch(plan, "canvas-1", 4)
    assert patch.schema_version == 1
    assert patch.base_version == 4
    assert [item.op for item in patch.operations] == ["add_node", "add_node", "add_connection"]
    validate_patch(patch)

def test_semantic_node_type_is_constrained_and_generation_nodes_match_canvas_contract():
    with pytest.raises(Exception):
        SemanticPlan.model_validate({"goal": "invalid", "steps": [{"id": "bad", "action": "canvas.create_node", "node": {"semantic_type": "capability"}}]})
    plan = SemanticPlan.model_validate({"goal": "image", "steps": [{"id": "image", "action": "canvas.create_node", "node": {"semantic_type": "image_generation", "capability": "image.text_to_image"}}]})
    node = semantic_plan_to_patch(plan, "canvas-1", 1).operations[0].node
    assert node["type"] == "smart-image"
    assert node["genKind"] == "image"
    assert node["runSettings"] == {"engine": "api", "apiKind": "image"}


def test_agent_generation_node_preserves_manual_run_settings_contract():
    plan = SemanticPlan.model_validate({
        "goal": "猫狗大战",
        "steps": [{
            "id": "step_create_catdog_2k_t2i_v2",
            "action": "canvas.create_node",
            "node": {
                "semantic_type": "image_generation",
                "title": "猫狗大战（2K生图）",
                "content": "猫狗大战",
                "capability": "image.text_to_image",
                "params": {"runSettings": {
                    "count": 1,
                    "model": "gemini-3.1-flash-image-preview",
                    "ratio": "1:1",
                    "quality": "auto",
                    "resolution": "2k",
                    "provider_id": "custom-api-2",
                }},
            },
        }],
    })
    node = semantic_plan_to_patch(plan, "canvas-1", 36).operations[0].node
    assert node["genKind"] == "image"
    assert node["runSettings"]["engine"] == "api"
    assert node["runSettings"]["apiKind"] == "image"
    assert node["runSettings"]["provider_id"] == "custom-api-2"
    assert node["runSettings"]["resolution"] == "2k"
    assert node["text"] == "猫狗大战"
    assert "provider_id" not in node


def test_agent_generation_node_accepts_legacy_flat_settings():
    plan = SemanticPlan.model_validate({
        "goal": "image",
        "steps": [{
            "id": "image",
            "action": "canvas.create_node",
            "node": {
                "semantic_type": "image_generation",
                "params": {"provider_id": "custom-api-2", "model": "demo", "ratio": "1:1"},
            },
        }],
    })
    node = semantic_plan_to_patch(plan, "canvas-1", 1).operations[0].node
    assert "provider_id" not in node["runSettings"]
    assert node["runSettings"]["model"] == "demo"
    assert node["runSettings"]["ratio"] == "1:1"


def test_agent_node_placement_avoids_existing_and_same_patch_overlaps():
    plan = SemanticPlan.model_validate({
        "goal": "create images",
        "steps": [
            {"id": "first", "action": "canvas.create_node", "placement": {"x": 560, "y": 640}, "node": {"semantic_type": "image_generation"}},
            {"id": "second", "action": "canvas.create_node", "placement": {"x": 560, "y": 640}, "node": {"semantic_type": "image_generation"}},
        ],
    })
    canvas = {"nodes": [
        {"id": "a", "x": 560, "y": 640, "type": "smart-image"},
        {"id": "b", "x": 760, "y": 820, "type": "smart-image"},
    ]}
    patch = semantic_plan_to_patch(plan, "canvas-1", 36, canvas)
    placements = [operation.placement for operation in patch.operations]
    assert placements == [{"x": 1120.0, "y": 820.0}, {"x": 1480.0, "y": 820.0}]


def test_agent_node_placement_preserves_non_overlapping_model_suggestion():
    plan = SemanticPlan.model_validate({
        "goal": "create image",
        "steps": [{"id": "image", "action": "canvas.create_node", "placement": {"x": 2000, "y": 100}, "node": {"semantic_type": "image_generation"}}],
    })
    patch = semantic_plan_to_patch(plan, "canvas-1", 1, {"nodes": [{"x": 0, "y": 0}]})
    assert patch.operations[0].placement == {"x": 2000.0, "y": 100.0}

def test_policy_marks_execution_as_confirmation_required():
    plan = SemanticPlan.model_validate({"goal": "run", "steps": [{"id": "run", "action": "canvas.run_node", "target_node_id": "agent-node"}]})
    patch = semantic_plan_to_patch(plan, "canvas-1", 1)
    assert assess_patch(patch)["requires_confirmation"] is True

def test_registry_resolves_canonical_capabilities_by_model_id():
    registry = CapabilityRegistry([
        Capability("prompt.generate", model_id="chat-1", connection_id="connection-a", model_name="chat"),
        Capability("image.text_to_image", model_id="image-1", connection_id="connection-a", model_name="img"),
        Capability("video.text_to_video", model_id="video-1", connection_id="connection-a", model_name="vid", cost_level="high"),
    ])
    assert registry.resolve("prompt.generate", requested_model_id="chat-1").connection_id == "connection-a"
    assert registry.resolve("image.text_to_image", requested_model_id="image-1").model_name == "img"
    assert registry.get("video.text_to_video").cost_level == "high"

def test_capability_parameters_use_workflow_and_provider_sources():
    from app.services.ai_parameters import capability_parameters
    comfy = capability_parameters(
        capability="comfyui.workflow.image", model="custom/demo.json",
        provider_loader=lambda: [{"id": "comfyui", "enabled": True}],
        workflow_loader=lambda _name: {"config": {"fields": [{"id": "seed", "type": "dropdown", "options": [1, 2]}]}},
    )
    assert comfy["fields"][0]["options"] == [1, 2]
    assert comfy["params_path"] == "runSettings.comfyParams"
    prompt = capability_parameters(
        capability="prompt.generate", provider_id="chat", model="chat-1",
        provider_loader=lambda: [{"id": "chat", "enabled": True, "chat_models": ["chat-1"]}],
    )
    assert prompt["fields"][1]["options"] == ["chat-1"]
    assert prompt["params_path"] == "node"
    rh = capability_parameters(
        capability="runninghub.app.image", provider_id="runninghub", model="app-1",
        provider_loader=lambda: [{"id": "runninghub", "enabled": True, "rh_apps": [{"id": "app-1", "fields": [{"nodeId": "1", "fieldName": "ratio", "fieldType": "SELECT", "fieldData": ["1:1", "16:9"]}]}]}],
    )
    assert rh["fields"][0]["options"] == ["1:1", "16:9"]



def test_fixed_evaluation_records_protocol_metrics():
    metrics = evaluate_plan("prompt-to-image", {"goal": "image", "steps": [
        {"id": "prompt", "action": "canvas.create_node", "node": {"semantic_type": "smart-prompt"}},
        {"id": "image", "action": "canvas.create_node", "node": {"semantic_type": "smart-image"}},
        {"id": "edge", "action": "canvas.connect", "from_step": "prompt", "to_step": "image"},
    ]})
    assert metrics["structured_plan_success"] is True
    assert metrics["patch_validation_passed"] is True
    assert metrics["confirmation_consistent"] is True

def test_runtime_uses_explicit_planning_and_execution_graph():
    from langchain_core.language_models.fake_chat_models import FakeListChatModel
    agent = create_canvas_agent(model=FakeListChatModel(responses=["ok"]))
    assert {"agent", "tools", "confirmation", "execute", "dispatch_tasks"}.issubset(agent.nodes)

def test_langgraph_checkpoint_resumes_same_thread_with_command():
    from langgraph.checkpoint.memory import InMemorySaver
    from langgraph.graph import END, START, StateGraph
    from langgraph.types import Command, interrupt

    def approval_node(state):
        return {"answer": interrupt({"question": "approve?"})}

    graph_builder = StateGraph(dict)
    graph_builder.add_node("approval", approval_node)
    graph_builder.add_edge(START, "approval"); graph_builder.add_edge("approval", END)
    graph = graph_builder.compile(checkpointer=InMemorySaver())
    config = {"configurable": {"thread_id": "run-checkpoint-test"}}
    first = graph.invoke({"input": "plan"}, config=config)
    assert first["__interrupt__"]
    resumed = graph.invoke(Command(resume="approved"), config=config)
    assert resumed["answer"] == "approved"

def test_checkpoint_replay_does_not_repeat_side_effect_after_resume():
    from langgraph.checkpoint.memory import InMemorySaver
    from langgraph.graph import END, START, StateGraph
    from langgraph.types import Command, interrupt
    calls = []
    def effect_node(state):
        interrupt({"confirmation": "required"})
        calls.append(state["operation_id"])
        return {"done": True}
    builder = StateGraph(dict); builder.add_node("effect", effect_node)
    builder.add_edge(START, "effect"); builder.add_edge("effect", END)
    graph = builder.compile(checkpointer=InMemorySaver())
    config = {"configurable": {"thread_id": "run-effect-test"}}
    graph.invoke({"operation_id": "operation-1"}, config=config)
    assert calls == []
    graph.invoke(Command(resume="approved"), config=config)
    assert calls == ["operation-1"]

def test_model_planner_rejects_invalid_tool_calls_and_uses_command_resume(monkeypatch):
    import asyncio
    from langgraph.types import Command
    from app.services.canvas_agent import planner, runtime

    calls = []
    captured = {}
    class Agent:
        async def ainvoke(self, invocation, config):
            calls.append((invocation, config))
            return {"structured_response": {"goal": "safe plan", "steps": []}}
    monkeypatch.setattr(runtime, "create_canvas_agent", lambda **kwargs: captured.update(kwargs) or Agent())
    plan = asyncio.run(planner.plan_with_deep_agent(None, "answer", {"run_id": "run-1"}, harness_key="fake", resume=True))
    assert plan.goal == "safe plan"
    from langchain.agents.structured_output import ProviderStrategy
    assert isinstance(captured["response_format"], ProviderStrategy)
    assert captured["response_format"].schema is SemanticPlan
    assert captured["tools"] == []
    assert isinstance(calls[0][0], Command)
    assert calls[0][0].resume == "answer"
    assert calls[0][1]["configurable"]["thread_id"] == "run-1"
    with pytest.raises(ValueError, match="无效工具参数"):
        planner.reject_invalid_tool_calls({"messages": [{"invalid_tool_calls": [{"name": "submit_semantic_plan"}]}]})


def test_intent_router_defaults_to_chat_and_requires_explicit_canvas_action(monkeypatch):
    import asyncio
    from app.services.canvas_agent import planner, runtime

    captured = {}

    class Agent:
        async def ainvoke(self, invocation, config):
            captured["user"] = invocation["messages"][0]["content"]
            return {"response": {"intent": "chat", "reply": "你好，我可以帮你分析画布或回答问题。"}}

    monkeypatch.setattr(runtime, "create_canvas_agent", lambda **kwargs: captured.update(kwargs) or Agent())
    decision = asyncio.run(planner.classify_intent(None, "你好", {"run_id": "run-1", "node_count": 2}, harness_key="fake"))

    assert decision.intent == "chat"
    assert "默认选择 chat" in captured["system_prompt"]
    assert "必须同时满足" in captured["system_prompt"]
    assert "在画布上新建一个文生图节点" in captured["system_prompt"]
    assert "用户消息：你好" in captured["user"]
    assert "画布上下文：节点数=2" in captured["user"]

def test_semantic_plan_tool_blocks_invalid_parameters():
    from app.services.canvas_agent.tools import submit_semantic_plan
    with pytest.raises(Exception):
        submit_semantic_plan({"goal": "x", "steps": [{"id": "bad", "action": "delete_canvas"}]})


def test_planner_normalizes_known_legacy_canvas_operations():
    from app.services.canvas_agent.planner import _normalize_plan

    plan = _normalize_plan({
        "goal": "新建文生图节点",
        "steps": [{"id": "s1", "name": "创建节点", "details": {"node_type": "smart-prompt"}}],
        "execution": {"mode": "canvas_ops_plan", "operations": [{"op": "create_node", "client_ref": "prompt-1", "node": {"type": "smart-prompt", "text": "雨夜城市"}}]},
        "confirmation": {"summary": "需要确认"},
    }, {})

    assert plan.steps[0].action == "canvas.create_node"
    assert plan.steps[0].node.semantic_type == "prompt"
    from app.models.canvas_agent import semantic_prompt
    assert semantic_prompt(plan.steps[0].node.params) == "雨夜城市"

def test_provider_adapter_preserves_invalid_tool_calls_for_planner_blocking():
    from app.services.canvas_agent.model_resolver import MediaForgeChatModel
    valid, invalid = MediaForgeChatModel._tool_calls([
        {"id": "ok", "function": {"name": "submit_semantic_plan", "arguments": '{"goal":"x","steps":[]}'}},
        {"id": "bad", "function": {"name": "submit_semantic_plan", "arguments": '{"goal":'}},
    ])
    assert valid[0]["args"]["goal"] == "x"
    assert invalid[0]["type"] == "invalid_tool_call"
    assert invalid[0]["args"] == '{"goal":'
    assert MediaForgeChatModel._tool_choice("any") == "required"
    assert MediaForgeChatModel._tool_choice("auto") == "auto"


def test_provider_adapter_forwards_native_response_format(monkeypatch):
    import asyncio
    from langchain.agents.structured_output import ProviderStrategy
    from langchain_core.messages import HumanMessage
    from app.models.canvas_agent import SemanticPlan
    from app.services.canvas_agent.model_resolver import MediaForgeChatModel

    model = MediaForgeChatModel(endpoint="https://example.invalid/v1/chat/completions", model_name="gpt-test")
    captured = {}

    async def post(body):
        captured["body"] = body
        return {"choices": [{"message": {"content": '{"goal":"ok","steps":[]}'}}]}

    monkeypatch.setattr(model, "_post_with_retry", post)
    strategy = ProviderStrategy(SemanticPlan)
    result = asyncio.run(model._agenerate([HumanMessage(content="plan")], response_format=strategy.to_model_kwargs()["response_format"]))

    assert captured["body"]["response_format"]["type"] == "json_schema"
    assert captured["body"]["response_format"]["json_schema"]["name"] == "SemanticPlan"
    assert result.generations[0].message.content == '{"goal":"ok","steps":[]}'


def test_semantic_plan_native_schema_is_azure_strict_compatible():
    from langchain.agents.structured_output import ProviderStrategy

    schema = ProviderStrategy(SemanticPlan).to_model_kwargs()["response_format"]["json_schema"]["schema"]

    def assert_strict(node):
        if isinstance(node, dict):
            assert "default" not in node
            properties = node.get("properties")
            if isinstance(properties, dict):
                assert node["required"] == list(properties)
                assert node["additionalProperties"] is False
            for value in node.values():
                assert_strict(value)
        elif isinstance(node, list):
            for value in node:
                assert_strict(value)

    assert_strict(schema)
    node_schema = schema["$defs"]["SemanticNode"]["properties"]
    assert node_schema["params"]["type"] == "string"
    assert schema["$defs"]["SemanticStep"]["properties"]["placement"]["type"] == "string"
    plan = SemanticPlan.model_validate({"goal": "x", "steps": [{"id": "n", "action": "canvas.create_node", "node": {"semantic_type": "prompt", "params": "{\"model\":\"demo\"}"}, "placement": "{\"x\":1}"}]})
    assert plan.steps[0].node.params == {"model": "demo"}
    assert plan.steps[0].placement == {"x": 1}
