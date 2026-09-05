"""Tool-calling LangGraph runtime for the Canvas Agent."""
from __future__ import annotations

from typing import Annotated, Any, Awaitable, Callable, TypedDict

from langchain_core.messages import AIMessage, BaseMessage, SystemMessage
from langchain_core.tools import StructuredTool
from langgraph.graph import END, START, StateGraph
from langgraph.graph.message import add_messages
from langgraph.prebuilt import ToolNode
from langgraph.types import interrupt

from .system_prompt import build_canvas_system_prompt
from .tools import build_canvas_tools


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
    tools: list[StructuredTool] | None = None,
    emit_skill_event: Callable[[str, dict[str, Any]], Awaitable[Any]]
    | None = None):
    planning_tools = tools or build_canvas_tools(
        user_id=user_id,
        run_id=run_id,
        canvas_id=canvas_id,
        get_canvas=get_canvas,
        emit_skill_event=emit_skill_event,
    )
    execution_tools = build_canvas_tools(
        user_id=user_id,
        run_id=run_id,
        canvas_id=canvas_id,
        get_canvas=get_canvas,
        execute_patch=execute_patch,
        include_execution=True,
        emit_skill_event=emit_skill_event,
    ) if execute_patch is not None else []
    planning_tool_node = ToolNode(planning_tools)
    execution_tool_node = ToolNode(
        execution_tools) if execution_tools else None

    async def progress(phase: str, message: str):
        if emit_progress:
            await emit_progress(run_id, {"phase": phase, "message": message})

    def tool_progress_message(call: dict[str, Any]) -> str:
        messages = {
            "read_canvas_context": "正在读取画布上下文…",
            "read_capability_registry": "正在查询可用能力…",
            "read_capability_parameters": "正在读取节点配置…",
            "read_artifact": "正在读取关联素材…",
            "read_canvas_skill": "正在读取技能说明…",
            "read_canvas_skill_file": "正在读取技能参考资料…",
            "propose_canvas_patch": "正在生成执行计划…",
            "request_clarification": "正在整理需要补充的信息…",
        }
        return messages.get(str(call.get("name") or ""), "正在调用画布工具…")

    async def agent_node(state: CanvasAgentState) -> dict[str, Any]:
        await progress("agent", "模型分析中…")
        system = SystemMessage(content=build_canvas_system_prompt(tools=planning_tools))
        response = await model.bind_tools(planning_tools).ainvoke(
            [system, *(state.get("messages") or [])])
        return {"messages": [response]}

    async def tools_node(state: CanvasAgentState) -> dict[str, Any]:
        last = (state.get("messages")
                or [])[-1] if state.get("messages") else None
        calls = list(getattr(last, "tool_calls", []) or [])
        # Report only real user-meaningful tool invocations. Tool completion is
        # deliberately omitted: the next analysis step or Agent reply closes it.
        for call in calls:
            await progress("tool_started", tool_progress_message(call))
        try:
            result = await planning_tool_node.ainvoke(state)
        except Exception:
            for call in calls:
                await progress("tool_failed",
                               f"工具 {call.get('name') or 'unknown'} 执行失败")
            raise
        return result

    async def confirmation_node(state: CanvasAgentState) -> dict[str, Any]:
        await progress("confirmation", "计划已生成，等待用户确认…")
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
        await progress("confirmation", "用户已确认，继续执行…")
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
        await progress("execution", "正在执行已确认的画布变更…")
        return await execution_tool_node.ainvoke(state)

    async def dispatch_tasks_node(state: CanvasAgentState) -> dict[str, Any]:
        result = dict(state.get("execution_result") or {})
        if not result:
            raise RuntimeError(
                "Canvas patch execution did not return a result")
        if dispatch_tasks is None: return {"tasks": []}
        await progress("execution", "画布变更已应用，正在提交生成任务…")
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
