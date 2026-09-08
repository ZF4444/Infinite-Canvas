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
from app.services.ai_parameters import capability_parameters

from .adapter import capability_schema_resolver, semantic_plan_to_patch
from .capabilities import CapabilityRegistry, from_repository
from .context import build_canvas_context
from .event_factory import SKILL_ARTIFACT_KIND
from .policy import assess_patch
from .skills import read_skill_document, read_skill_resource
from .store import latest_artifact, save_plan


def submit_semantic_plan(plan: dict[str, Any]) -> SemanticPlan:
    """Validate the legacy planner payload against the canonical plan schema."""
    return SemanticPlan.model_validate(plan)

def build_canvas_tools(*, user_id: str, run_id: str, canvas_id: str,
                       get_canvas: Callable[[], Awaitable[dict[str, Any]]] | None = None,
                       execute_patch: Callable[[int, list[str]], Awaitable[dict[str, Any]]] | None = None,
                       include_execution: bool = False) -> list[StructuredTool]:
    """Create tools scoped to one authenticated Agent Run."""
    def agent_display_schema(schema: dict[str, Any], connection_id: str, model: str) -> dict[str, Any]:
        """Project the backend field contract into a lean, model-facing view.

        The raw ``capability_parameters`` schema carries execution metadata
        (``execution.target``/``transform``), UI hints (``ui.configurable``),
        and duplicated raw ``options``/``option_labels`` that the frontend and
        executor need but the planner does not. Emitting all of it doubles the
        token cost and forces the model to guess which copy to use. Return only
        what the planner needs to choose values: a display name, a role, and
        options as ``{value,label}`` pairs alongside a canonical default.
        """
        from app.ai.database_repository import DatabaseAIRepository
        repository = DatabaseAIRepository()
        connection = next((item for item in repository.connections() if item.id == connection_id), None)
        selected = next((item for item in repository.models() if item.connection_id == connection_id and item.upstream_model == model), None)
        model_label = str(selected.alias if selected else model or "")
        fields: list[dict[str, Any]] = []
        for field in schema.get("fields") or []:
            options = list(field.get("options") or [])
            labels = list(field.get("option_labels") or [])
            if len(labels) != len(options):
                labels = [str(value) for value in options]
            item: dict[str, Any] = {
                "id": str(field.get("id") or ""),
                "name": str(field.get("name") or field.get("id") or ""),
            }
            role = str(field.get("role") or "")
            if role:
                item["role"] = role
            item["type"] = str(field.get("type") or "text")
            if options:
                item["options"] = [{"value": value, "label": labels[index]} for index, value in enumerate(options)]
            if field.get("default") is not None:
                item["default"] = field.get("default")
            for key in ("min", "max", "step"):
                if field.get(key) is not None:
                    item[key] = field.get(key)
            fields.append(item)
        return {
            "capability": str(schema.get("capability") or ""),
            "params_path": str(schema.get("params_path") or "runSettings"),
            "display_connection": str(connection.name if connection else connection_id or ""),
            "display_model": model_label,
            "fields": fields,
        }

    @tool
    async def read_canvas_context(selected_node_ids: list[str] | None = None) -> dict[str, Any]:
        """Read current canvas nodes, connections, and selected context."""
        return await asyncio.to_thread(build_canvas_context, user_id, canvas_id, selected_node_ids=selected_node_ids or [])

    @tool
    async def read_capability_registry() -> list[dict[str, Any]]:
        """List capabilities available to canvas nodes."""
        return (await asyncio.to_thread(from_repository)).as_dict()

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

    @tool
    async def read_canvas_skill(name: str, runtime: ToolRuntime) -> Command:
        """Read one enabled Skill body after permission and integrity validation."""
        try:
            document = await asyncio.to_thread(read_skill_document, name)
        except Exception as exc:
            return Command(update={"messages": [ToolMessage(
                content=f"Skill 读取被拒绝：{exc}",
                tool_call_id=runtime.tool_call_id,
                name="read_canvas_skill",
                artifact={
                    "kind": SKILL_ARTIFACT_KIND,
                    "event": "skill.rejected",
                    "name": str(name)[:64],
                    "reason": str(exc),
                },
            )]})
        loaded = list(runtime.state.get("loaded_skills") or [])
        item = {"name": document.name, "content_sha256": document.content_sha256}
        if item not in loaded:
            loaded.append(item)
        return Command(update={
            "loaded_skills": loaded,
            "messages": [ToolMessage(
                content=document.content,
                tool_call_id=runtime.tool_call_id,
                name="read_canvas_skill",
                artifact={
                    "kind": SKILL_ARTIFACT_KIND,
                    "event": "skill.loaded",
                    "name": document.name,
                    "content_sha256": document.content_sha256,
                },
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
            return Command(update={"messages": [ToolMessage(
                content=f"Skill 资源读取被拒绝：{reason}",
                tool_call_id=runtime.tool_call_id if runtime else "",
                name="read_canvas_skill_file",
                artifact={
                    "kind": SKILL_ARTIFACT_KIND,
                    "event": "skill.resource_rejected",
                    "name": str(skill_name)[:64],
                    "path": str(path)[:500],
                    "reason": reason,
                },
            )]})
        try:
            resource = await asyncio.to_thread(
                read_skill_resource, skill_name, path, offset=offset, limit=limit,
            )
        except Exception as exc:
            return Command(update={"messages": [ToolMessage(
                content=f"Skill 资源读取被拒绝：{exc}",
                tool_call_id=runtime.tool_call_id if runtime else "",
                name="read_canvas_skill_file",
                artifact={
                    "kind": SKILL_ARTIFACT_KIND,
                    "event": "skill.resource_rejected",
                    "name": str(skill_name)[:64],
                    "path": str(path)[:500],
                    "reason": str(exc),
                },
            )]})
        resource_metadata = {
            "path": resource.path,
            "content_sha256": resource.content_sha256,
            "start_line": resource.start_line,
            "end_line": resource.end_line,
            "total_lines": resource.total_lines,
            "truncated": resource.truncated,
        }
        continuation = (
            f"\n\n[内容未完；使用 offset={resource.end_line + 1} 继续读取。]"
            if resource.truncated else ""
        )
        return Command(update={"messages": [ToolMessage(
            content=resource.content + continuation,
            tool_call_id=runtime.tool_call_id if runtime else "",
            name="read_canvas_skill_file",
            artifact={
                "kind": SKILL_ARTIFACT_KIND,
                "event": "skill.resource_loaded",
                "name": resource.name,
                "resource": resource_metadata,
                "skill_name": resource.name,
                "path": resource.path,
                "start_line": resource.start_line,
                "end_line": resource.end_line,
                "total_lines": resource.total_lines,
                "truncated": resource.truncated,
                "content_sha256": resource.content_sha256,
            },
        )]})


    @tool(args_schema=SemanticPlan)
    async def propose_canvas_patch(**plan_fields: Any) -> dict[str, Any]:
        """Validate and persist a complete canvas plan without changing the canvas."""
        semantic_plan = SemanticPlan.model_validate(plan_fields)
        canvas = await (get_canvas() if get_canvas else read_canvas_context.ainvoke({}))
        version = int(canvas.get("canvas_version") or canvas.get("version") or 1)
        patch = await asyncio.to_thread(
            semantic_plan_to_patch, semantic_plan, canvas_id, version,
            canvas, capability_schema_resolver,
        )
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
        # read_canvas_context,
        # read_capability_registry, read_capability_parameters, read_artifact,
        read_canvas_skill, read_canvas_skill_file,
        # propose_canvas_patch, request_clarification,
    ]
    # Planning graphs must not expose the mutation tool. The graph only adds
    # it to its deterministic post-confirmation ToolNode.
    if include_execution and execute_patch is not None:
        tools.append(execute_canvas_patch)
    return tools
