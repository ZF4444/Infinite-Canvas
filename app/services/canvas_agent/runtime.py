"""Tool-calling LangGraph runtime for the Canvas Agent."""
from __future__ import annotations

import json
import uuid
from typing import Annotated, Any, Awaitable, Callable, TypedDict

from langchain_core.messages import AIMessage, BaseMessage, SystemMessage
from langchain_core.tools import StructuredTool
from langgraph.graph import END, START, StateGraph
from langgraph.graph.message import add_messages
from langgraph.prebuilt import ToolNode
from langgraph.types import interrupt

from .system_prompt import build_canvas_system_prompt
from .tools import build_canvas_tools
from .event_factory import EventSpec, progress as progress_event, skill_event_from_artifact, tool_completed, tool_failed, tool_started


class CanvasAgentState(TypedDict, total=False):
    messages: Annotated[list[BaseMessage], add_messages]
    run_id: str
    user_id: str
    canvas_id: str
    loaded_skills: list[dict[str, str]]
    confirmed: bool
    plan_version: int
    authorized_node_ids: list[str]
    execution_result: dict[str, Any]
    tasks: list[dict[str, Any]]


def _result_messages(result: Any) -> list[Any]:
    """Flatten ToolNode output messages across its two return shapes.

    Tools that return plain values yield a ``{"messages": [...]}`` dict, while
    tools that return ``Command(update=...)`` yield a list of ``Command``
    objects whose ``update`` carries the messages. Normalize both so callers
    can index ToolMessages uniformly.
    """
    messages: list[Any] = []
    if isinstance(result, dict):
        messages.extend(result.get("messages") or [])
    elif isinstance(result, (list, tuple)):
        for item in result:
            update = getattr(item, "update", None)
            if isinstance(update, dict):
                messages.extend(update.get("messages") or [])
            elif isinstance(item, dict):
                messages.extend(item.get("messages") or [])
    return messages


def _index_tool_results(result: Any) -> dict[str, Any]:
    """Map tool_call_id -> parsed ToolMessage content from a ToolNode result."""
    indexed: dict[str, Any] = {}
    for message in _result_messages(result):
        call_id = getattr(message, "tool_call_id", None)
        if not call_id:
            continue
        content = getattr(message, "content", None)
        if isinstance(content, str):
            try:
                content = json.loads(content)
            except (ValueError, TypeError):
                pass
        indexed[str(call_id)] = content
    return indexed


def _index_tool_artifacts(result: Any) -> dict[str, Any]:
    """Map tool_call_id -> ToolMessage.artifact from a ToolNode result."""
    indexed: dict[str, Any] = {}
    for message in _result_messages(result):
        call_id = getattr(message, "tool_call_id", None)
        if not call_id:
            continue
        indexed[str(call_id)] = getattr(message, "artifact", None)
    return indexed


def _node_display_name(node: dict[str, Any]) -> str:
    return str(node.get("title") or node.get("name") or node.get("id") or "").strip()


def _completion_detail(
    tool_name: str,
    args: dict[str, Any],
    tool_result: Any,
) -> str:
    """Describe what a read covered; empty string keeps the default label."""
    if tool_name != "read_canvas_context":
        return ""
    selected_ids = [
        str(node_id).strip()
        for node_id in (args.get("selected_node_ids") or [])
        if str(node_id).strip()
    ]
    if not selected_ids:
        return "已完成画布上下文读取"
    names: list[str] = []
    if isinstance(tool_result, dict):
        by_id = {
            str(node.get("id")): node
            for node in (tool_result.get("selected_nodes") or [])
            if isinstance(node, dict)
        }
        for node_id in selected_ids:
            node = by_id.get(node_id)
            name = _node_display_name(node) if isinstance(node, dict) else ""
            names.append(name or node_id)
    else:
        names = selected_ids
    return f"已读取{ '、'.join(names) }节点"


def create_canvas_agent(
    *,
    model: Any,
    user_id: str = "",
    run_id: str = "",
    canvas_id: str = "",
    checkpointer: Any = None,
    emit_progress: Callable[..., Awaitable[Any]] | None = None,
    get_canvas=None,
    execute_patch=None,
    dispatch_tasks=None,
    tools: list[StructuredTool] | None = None):
    planning_tools = tools or build_canvas_tools(
        user_id=user_id,
        run_id=run_id,
        canvas_id=canvas_id,
        get_canvas=get_canvas,
    )
    execution_tools = build_canvas_tools(
        user_id=user_id,
        run_id=run_id,
        canvas_id=canvas_id,
        get_canvas=get_canvas,
        execute_patch=execute_patch,
        include_execution=True,
    ) if execute_patch is not None else []
    planning_tool_node = ToolNode(planning_tools)
    execution_tool_node = ToolNode(
        execution_tools) if execution_tools else None

    async def emit(spec: EventSpec) -> None:
        if emit_progress:
            await emit_progress(run_id, spec)

    async def agent_node(state: CanvasAgentState) -> dict[str, Any]:
        await emit(progress_event("agent", "模型分析中…"))
        system = SystemMessage(content=build_canvas_system_prompt(tools=planning_tools))
        response = await model.bind_tools(planning_tools).ainvoke(
            [system, *(state.get("messages") or [])])
        return {"messages": [response]}

    async def tools_node(state: CanvasAgentState) -> dict[str, Any]:
        last = (state.get("messages")
                or [])[-1] if state.get("messages") else None
        calls = list(getattr(last, "tool_calls", []) or [])
        domain_terminal_tools = {
            "read_canvas_skill",
            "read_canvas_skill_file",
            "propose_canvas_patch",
            "execute_canvas_patch",
        }
        # (tool_name, tool_call_id, args) so completion events can describe
        # what a read actually covered (e.g. specific nodes vs. full canvas).
        call_records: list[tuple[str, str, dict[str, Any]]] = []
        for call in calls:
            tool_name = str(call.get("name") or "unknown")
            tool_call_id = str(call.get("id") or f"generated-{uuid.uuid4().hex}")
            if not call.get("id"):
                call["id"] = tool_call_id
            args = call.get("args") if isinstance(call.get("args"), dict) else {}
            call_records.append((tool_name, tool_call_id, args))
            await emit(tool_started(tool_name=tool_name, tool_call_id=tool_call_id))
        try:
            result = await planning_tool_node.ainvoke(state)
        except Exception:
            for tool_name, tool_call_id, _args in call_records:
                await emit(tool_failed(tool_name=tool_name, tool_call_id=tool_call_id))
            raise
        results_by_call_id = _index_tool_results(result)
        artifacts_by_call_id = _index_tool_artifacts(result)
        for tool_name, tool_call_id, args in call_records:
            skill_spec = skill_event_from_artifact(
                tool_call_id, artifacts_by_call_id.get(tool_call_id))
            if skill_spec is not None:
                await emit(skill_spec)
            await emit(tool_completed(
                tool_name=tool_name,
                tool_call_id=tool_call_id,
                visible=tool_name not in domain_terminal_tools,
                detail=_completion_detail(
                    tool_name, args, results_by_call_id.get(tool_call_id)),
            ))
        return result

    async def confirmation_node(state: CanvasAgentState) -> dict[str, Any]:
        await emit(progress_event("confirmation", "计划已生成，等待用户确认…"))
        decision = interrupt({
            "type": "canvas.confirmation_required",
            "run_id": run_id
        })
        approved = bool(decision.get("approved")) if isinstance(
            decision, dict) else bool(decision)
        if not approved: return {"confirmed": False}
        plan_version = int(decision.get("plan_version") or 0) if isinstance(
            decision, dict) else 0
        if plan_version < 1: raise ValueError("确认请求缺少计划版本")
        authorized_node_ids = list(
            decision.get("authorized_node_ids") or []) if isinstance(
                decision, dict) else []
        await emit(progress_event("confirmation", "用户已确认，继续执行…"))
        call_id = f"execute-{run_id}-{plan_version}"
        return {
            "confirmed":
            True,
            "plan_version":
            plan_version,
            "authorized_node_ids":
            authorized_node_ids,
            "messages": [
                AIMessage(content="",
                          tool_calls=[{
                              "id": call_id,
                              "name": "execute_canvas_patch",
                              "args": {
                                  "plan_version": plan_version,
                                  "authorized_node_ids": authorized_node_ids
                              },
                              "type": "tool_call",
                          }])
            ],
        }

    async def execute_node(state: CanvasAgentState) -> dict[str, Any]:
        if execution_tool_node is None:
            raise RuntimeError("Canvas execution boundary is not configured")
        await emit(progress_event("execution", "正在执行已确认的画布变更…"))
        return await execution_tool_node.ainvoke(state)

    async def dispatch_tasks_node(state: CanvasAgentState) -> dict[str, Any]:
        result = dict(state.get("execution_result") or {})
        if not result:
            raise RuntimeError(
                "Canvas patch execution did not return a result")
        if dispatch_tasks is None: return {"tasks": []}
        await emit(progress_event("execution", "画布变更已应用，正在提交生成任务…"))
        tasks = await dispatch_tasks(result)
        return {"tasks": tasks}

    def route_agent(state: CanvasAgentState) -> str:
        """Route after agent_node: call tools if the model issued tool calls, else finish."""
        last = (state.get("messages")
                or [])[-1] if state.get("messages") else None
        return "tools" if isinstance(last,
                                     AIMessage) and last.tool_calls else END

    def route_tools(state: CanvasAgentState) -> str:
        """Route after tools_node: enter confirmation when propose_canvas_patch signals it, else loop back to agent."""
        last = (state.get("messages")
                or [])[-1] if state.get("messages") else None
        text = str(getattr(last, "content", ""))
        # propose_canvas_patch embeds a sentinel string in its ToolMessage content.
        return "confirmation" if "awaiting_confirmation" in text or "requires_confirmation" in text else "agent"

    def route_confirmation(state: CanvasAgentState) -> str:
        """Route after confirmation_node: proceed to execution on approval, finish on rejection."""
        return "execute" if state.get("confirmed") else END

    graph = StateGraph(CanvasAgentState)
    graph.add_node("agent", agent_node)
    graph.add_node("tools", tools_node)
    graph.add_node("confirmation", confirmation_node)
    graph.add_node("execute", execute_node)
    graph.add_node("dispatch_tasks", dispatch_tasks_node)
    graph.add_edge(START, "agent")
    graph.add_conditional_edges("agent", route_agent, {
        "tools": "tools",
        END: END
    })
    graph.add_conditional_edges("tools", route_tools, {
        "agent": "agent",
        "confirmation": "confirmation"
    })
    graph.add_conditional_edges("confirmation", route_confirmation, {
        "execute": "execute",
        END: END
    })
    graph.add_edge("execute", "dispatch_tasks")
    graph.add_edge("dispatch_tasks", END)
    return graph.compile(checkpointer=checkpointer)
