"""Public entry points for the tool-calling Canvas Agent."""
from __future__ import annotations

import asyncio
from typing import Any

from langchain.agents.structured_output import ProviderStrategy
from langchain_core.messages import HumanMessage
from langgraph.types import Command

from app.models.canvas_agent import (
    IntentDecision,
    SemanticNode,
    SemanticPlan,
    SemanticStep,
)

from . import runtime
from .tools import build_canvas_tools


async def run_canvas_agent(model: Any, message: str, context: dict[str, Any], *, checkpointer: Any = None,
                           emit_progress=None, tools=None, execute_patch=None, dispatch_tasks=None, **legacy_kwargs) -> dict[str, Any]:
    # Compatibility for callers of the pre-state-graph planner contract.
    if legacy_kwargs.get("harness_key") is not None:
        return await _legacy_plan(model, message, context, resume=bool(legacy_kwargs.get("resume")))
    run_id = str(context.get("run_id") or "canvas-agent")
    user_id = str(context.get("user_id") or "")
    canvas_id = str(context.get("canvas_id") or "")
    tools = build_canvas_tools(user_id=user_id, run_id=run_id, canvas_id=canvas_id,
                               get_canvas=context.get("get_canvas"))
    graph = runtime.create_canvas_agent(model=model, user_id=user_id, run_id=run_id,
                                canvas_id=canvas_id, checkpointer=checkpointer,
                                emit_progress=emit_progress, get_canvas=context.get("get_canvas"),
                                execute_patch=execute_patch, dispatch_tasks=dispatch_tasks, tools=tools)
    references = list(context.get("media_references") or [])
    if references:
        from app.ai.runtime import reference_to_data_url
        parts: list[dict[str, Any]] = [{"type": "text", "text": message}]
        included = 0
        for ref in references:
            if included >= 12:
                break
            label = ref.get("label")
            node_desc = ref.get("node_label") or ref.get("node_id") or "未知节点"
            node_id = str(ref.get("node_id") or "").strip()
            id_hint = f"（节点 id: {node_id}）" if node_id else ""
            # Placeholder references carry no image; keep their canvas context as
            # text so the model still knows the node was mentioned.
            if ref.get("empty") or not str(ref.get("url") or "").strip():
                parts.append({"type": "text", "text": f"[{label}] 引用画布节点「{node_desc}」{id_hint}（暂无图像）"})
                continue
            data_url = await asyncio.to_thread(reference_to_data_url, ref, 1536)
            if not data_url:
                parts.append({"type": "text", "text": f"[{label}] 引用画布节点「{node_desc}」{id_hint}（图像不可用）"})
                continue
            # Emit the node context immediately before its image so text labels
            # and images stay aligned even when entries are skipped or truncated.
            parts.append({"type": "text", "text": f"[{label}] 来自画布节点「{node_desc}」{id_hint}，如下图："})
            parts.append({"type": "image_url", "image_url": {"url": data_url}})
            included += 1
        human = HumanMessage(content=parts)
    else:
        human = HumanMessage(content=message)
    return await graph.ainvoke({"run_id": run_id, "messages": [human]},
                               config={"configurable": {"thread_id": run_id}})

async def plan_with_state_graph(model: Any, message: str, context: dict[str, Any], *, checkpointer=None,
                                emit_progress=None, **kwargs):
    return await run_canvas_agent(model, message, context, checkpointer=checkpointer, emit_progress=emit_progress, **kwargs)

plan_with_deep_agent = plan_with_state_graph

async def classify_intent(model: Any, message: str, context: dict[str, Any], **kwargs):
    if kwargs.get("harness_key") is not None:
        return await _legacy_intent(model, message, context)
    return await run_canvas_agent(model, message, context, **kwargs)


async def _legacy_plan(model: Any, message: str, context: dict[str, Any], *, resume: bool = False) -> SemanticPlan:
    run_id = str(context.get("run_id") or "canvas-agent")
    agent = runtime.create_canvas_agent(response_format=ProviderStrategy(SemanticPlan), tools=[])
    invocation = Command(resume=message) if resume else {"messages": [HumanMessage(content=message)]}
    result = await agent.ainvoke(invocation, config={"configurable": {"thread_id": run_id}})
    return SemanticPlan.model_validate(result.get("structured_response") or result)


async def _legacy_intent(model: Any, message: str, context: dict[str, Any]) -> IntentDecision:
    run_id = str(context.get("run_id") or "canvas-agent")
    node_count = int(context.get("node_count") or 0)
    system_prompt = ("默认选择 chat。只有用户明确要求修改画布时才选择 canvas_action，必须同时满足明确的画布操作意图和目标。"
                     "例如：在画布上新建一个文生图节点。")
    user_prompt = f"用户消息：{message}\n画布上下文：节点数={node_count}"
    agent = runtime.create_canvas_agent(system_prompt=system_prompt, tools=[])
    result = await agent.ainvoke({"messages": [{"role": "user", "content": user_prompt}]},
                                 config={"configurable": {"thread_id": run_id}})
    return IntentDecision.model_validate(result.get("response") or result)


def reject_invalid_tool_calls(state: dict[str, Any]) -> None:
    for message in state.get("messages") or []:
        for call in (message.get("invalid_tool_calls") if isinstance(message, dict) else getattr(message, "invalid_tool_calls", [])) or []:
            raise ValueError(f"无效工具参数: {call.get('name') or 'unknown'}")


def _normalize_plan(raw: Any, context: dict[str, Any] | None = None) -> SemanticPlan:
    if isinstance(raw, SemanticPlan):
        return raw
    data = dict(raw or {})
    steps = [step for step in (data.get("steps") or []) if isinstance(step, dict) and step.get("action")]
    operations = ((data.get("execution") or {}).get("operations") or [])
    if not steps and operations:
        for index, operation in enumerate(operations):
            if operation.get("op") != "create_node":
                continue
            node = operation.get("node") or {}
            node_type = {"smart-prompt": "prompt", "smart-image": "image_generation", "smart-group": "group"}.get(node.get("type"), node.get("type", "prompt"))
            steps.append({"id": operation.get("client_ref") or f"step-{index + 1}", "action": "canvas.create_node",
                          "node": {"semantic_type": node_type, "title": node.get("title", ""), "content": node.get("text", ""),
                                   "capability": node.get("capability", ""), "params": node.get("params") or {}}})
    data["steps"] = steps
    data.pop("execution", None)
    data.pop("confirmation", None)
    return SemanticPlan.model_validate(data)
