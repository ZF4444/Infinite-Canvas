"""Scoped LangChain tools for the Canvas Agent."""
from __future__ import annotations
import asyncio
import json
from typing import Any, Awaitable, Callable
from langchain.tools import ToolRuntime
from langchain_core.messages import ToolMessage
from langchain_core.tools import StructuredTool, tool
from langgraph.types import Command
from app.models.canvas_agent import SemanticPlan
from .capabilities import CapabilityRegistry
from app.services.ai_parameters import capability_parameters
from .context import build_canvas_context
from .policy import assess_patch
from .adapter import semantic_plan_to_patch
from .store import latest_artifact, save_plan
from .skills import read_skill_document, read_skill_resource


def submit_semantic_plan(plan: dict[str, Any]) -> SemanticPlan:
    """Validate the legacy planner payload against the canonical plan schema."""
    return SemanticPlan.model_validate(plan)

def build_canvas_tools(*, user_id: str, run_id: str, canvas_id: str,
                       get_canvas: Callable[[], Awaitable[dict[str, Any]]] | None = None,
                       execute_patch: Callable[[int, list[str]], Awaitable[dict[str, Any]]] | None = None,
                       include_execution: bool = False,
                       registry: CapabilityRegistry | None = None,
                       emit_skill_event: Callable[[str, dict[str, Any]], Awaitable[Any]] | None = None) -> list[StructuredTool]:
    """Create tools scoped to one authenticated Agent Run."""
    def agent_display_schema(schema: dict[str, Any], connection_id: str, model: str) -> dict[str, Any]:
        from app.ai.database_repository import DatabaseAIRepository
        repository = DatabaseAIRepository()
        connection = next((item for item in repository.connections() if item.id == connection_id), None)
        selected = next((item for item in repository.models() if item.connection_id == connection_id and item.upstream_model == model), None)
        model_label = str(selected.alias if selected else model or "")
        result = dict(schema)
        result["display_connection"] = str(connection.name if connection else connection_id or "")
        result["display_model"] = model_label
        result["display_fields"] = []
        for field in schema.get("fields") or []:
            item = dict(field)
            options = list(field.get("options") or [])
            labels = list(field.get("option_labels") or [])
            if len(labels) != len(options): labels = [str(value) for value in options]
            item["display_name"] = str(field.get("name") or field.get("id") or "")
            item["display_options"] = [{"value": value, "label": labels[index]} for index, value in enumerate(options)]
            default = field.get("default")
            item["display_default"] = labels[options.index(default)] if default in options else default
            result["display_fields"].append(item)
        return result

    @tool
    async def read_canvas_context(selected_node_ids: list[str] | None = None) -> dict[str, Any]:
        """Read current canvas nodes, connections, and selected context."""
        return await asyncio.to_thread(build_canvas_context, user_id, canvas_id, selected_node_ids=selected_node_ids or [])

    @tool
    async def read_capability_registry() -> list[dict[str, Any]]:
        """List capabilities available to canvas nodes."""
        return (registry or CapabilityRegistry()).as_dict()

    @tool
    async def read_capability_parameters(capability: str, connection_id: str = "", model_id: str = "", resource_id: str = "", model: str = "") -> dict[str, Any]:
        """Read the same node parameter schema used by the canvas configuration UI."""
        schema = await asyncio.to_thread(
            capability_parameters,
            capability=capability,
            connection_id=connection_id,
            model_id=model_id,
            resource_id=resource_id,
            model=model,
        )
        # The display labels are stored alongside the canonical AI resources.
        # Keep this legacy synchronous repository lookup off the ASGI loop.
        return await asyncio.to_thread(agent_display_schema, schema, connection_id, model)

    @tool
    async def read_artifact(artifact_type: str = "") -> dict[str, Any] | None:
        """Read the latest artifact owned by this Agent Run."""
        return await asyncio.to_thread(latest_artifact, user_id, run_id, artifact_type)

    async def skill_event(event_type: str, payload: dict[str, Any]) -> None:
        if emit_skill_event:
            await emit_skill_event(event_type, payload)

    @tool
    async def read_canvas_skill(name: str, runtime: ToolRuntime) -> Command:
        """Read one enabled Skill body after permission and integrity validation."""
        try:
            document = await asyncio.to_thread(read_skill_document, name)
        except Exception as exc:
            await skill_event("skill.rejected", {"skill": {"name": str(name)[:64]}, "reason": str(exc)[:500]})
            return Command(update={"messages": [ToolMessage(content=f"Skill 读取被拒绝：{exc}", tool_call_id=runtime.tool_call_id)]})
        loaded = list(runtime.state.get("loaded_skills") or [])
        item = {"name": document.name, "content_sha256": document.content_sha256}
        if item not in loaded:
            loaded.append(item)
        await skill_event("skill.loaded", {"skill": {"name": document.name, "content_sha256": document.content_sha256}})
        return Command(update={
            "loaded_skills": loaded,
            "messages": [ToolMessage(
                content=document.content,
                tool_call_id=runtime.tool_call_id,
                name="read_canvas_skill",
                artifact={"name": document.name, "content_sha256": document.content_sha256},
            )],
        })

    @tool
    async def read_canvas_skill_file(
        skill_name: str,
        path: str,
        offset: int = 1,
        limit: int = 400,
        runtime: ToolRuntime = None,
    ) -> Command:
        """Read a text file under an already loaded Skill.

        `path` must be relative to that Skill directory. Use offset (1-based)
        and limit to read large reference files progressively. This tool is
        read-only and cannot access canvas files or arbitrary server paths.
        """
        loaded = list((runtime.state if runtime else {}).get("loaded_skills") or [])
        if str(skill_name or "") not in {str(item.get("name") or "") for item in loaded}:
            reason = "必须先读取对应的 Skill 正文"
            await skill_event("skill.resource_rejected", {
                "skill": {"name": str(skill_name)[:64]},
                "resource": {"path": str(path)[:500]},
                "reason": reason,
            })
            return Command(update={"messages": [ToolMessage(
                content=f"Skill 资源读取被拒绝：{reason}",
                tool_call_id=runtime.tool_call_id if runtime else "",
                name="read_canvas_skill_file",
            )]})
        try:
            resource = await asyncio.to_thread(
                read_skill_resource, skill_name, path, offset=offset, limit=limit,
            )
        except Exception as exc:
            await skill_event("skill.resource_rejected", {
                "skill": {"name": str(skill_name)[:64]},
                "resource": {"path": str(path)[:500]},
                "reason": str(exc)[:500],
            })
            return Command(update={"messages": [ToolMessage(
                content=f"Skill 资源读取被拒绝：{exc}",
                tool_call_id=runtime.tool_call_id if runtime else "",
                name="read_canvas_skill_file",
            )]})
        await skill_event("skill.resource_loaded", {
            "skill": {"name": resource.name},
            "resource": {
                "path": resource.path,
                "content_sha256": resource.content_sha256,
                "start_line": resource.start_line,
                "end_line": resource.end_line,
                "total_lines": resource.total_lines,
                "truncated": resource.truncated,
            },
        })
        continuation = (
            f"\n\n[内容未完；使用 offset={resource.end_line + 1} 继续读取。]"
            if resource.truncated else ""
        )
        return Command(update={"messages": [ToolMessage(
            content=resource.content + continuation,
            tool_call_id=runtime.tool_call_id if runtime else "",
            name="read_canvas_skill_file",
            artifact={
                "skill_name": resource.name,
                "path": resource.path,
                "content_sha256": resource.content_sha256,
                "start_line": resource.start_line,
                "end_line": resource.end_line,
                "total_lines": resource.total_lines,
                "truncated": resource.truncated,
            },
        )]})


    @tool(args_schema=SemanticPlan)
    async def propose_canvas_patch(**plan_fields: Any) -> dict[str, Any]:
        """Validate and persist a complete canvas plan without changing the canvas."""
        semantic_plan = SemanticPlan.model_validate(plan_fields)
        canvas = await (get_canvas() if get_canvas else read_canvas_context.ainvoke({}))
        patch = semantic_plan_to_patch(semantic_plan, canvas_id, int(canvas.get("canvas_version") or canvas.get("version") or 1), canvas=canvas)
        assessment = assess_patch(patch)
        saved = await asyncio.to_thread(save_plan, user_id, run_id, semantic_plan.model_dump(mode="json"), status="awaiting_confirmation")
        return {"status": "awaiting_confirmation", "plan_version": saved["version"], "plan": semantic_plan.model_dump(mode="json"), "risk": assessment["risk"], "requires_confirmation": True, "operation_count": assessment["operation_count"]}

    @tool
    async def request_clarification(question: str) -> dict[str, Any]:
        """Ask the user for missing canvas information."""
        return {"requires_user_input": True, "question": str(question)[:2000]}

    @tool
    async def execute_canvas_patch(plan_version: int, authorized_node_ids: list[str] | None, runtime: ToolRuntime) -> Command:
        """Execute an approved plan through the existing Patch Executor."""
        if execute_patch is None: raise RuntimeError("Canvas execution boundary is not configured")
        result = await execute_patch(int(plan_version), list(authorized_node_ids or []))
        return Command(update={
            "execution_result": result,
            "messages": [ToolMessage(
                content=json.dumps(result, ensure_ascii=False),
                tool_call_id=runtime.tool_call_id,
                name="execute_canvas_patch",
            )],
        })

    tools = [
        read_canvas_context, read_capability_registry, read_capability_parameters, read_artifact,
        read_canvas_skill, read_canvas_skill_file,
        propose_canvas_patch, request_clarification,
    ]
    # Planning graphs must not expose the mutation tool. The graph only adds
    # it to its deterministic post-confirmation ToolNode.
    if include_execution and execute_patch is not None:
        tools.append(execute_canvas_patch)
    return tools
