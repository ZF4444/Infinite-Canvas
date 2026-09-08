"""Fast Track Canvas Agent API."""
from __future__ import annotations

import asyncio
import json
import time

from fastapi import APIRouter, Depends, Header, HTTPException, Request
from fastapi.responses import JSONResponse, Response
from langchain_core.messages import HumanMessage, SystemMessage
from langgraph.types import Command

from app.config import CANVAS_TASK_TIMEOUT_SECONDS
from app.core.access_control import has_page_access
from app.core.auth import current_user_id, safe_user_id
from app.core.logging import audit_event, get_logger
from app.core.metrics import AGENT_EVENT_PRESENTATION_UNKNOWN_TARGETS, AGENT_FAILURES, AGENT_OPERATION_SECONDS, AGENT_RUNS
from app.core.utils import now_ms
from app.core.ws import manager
from app.models import (
    CanvasAgentAnswerRequest,
    CanvasAgentConfirmRequest,
    CanvasAgentMessageRequest,
    CanvasAgentRedoRequest,
    CanvasAgentRetryRequest,
    CanvasAgentReviewRequest,
    CanvasAgentRunCreateRequest,
    CanvasArtifactAdvanceRequest,
    CanvasArtifactStatusRequest,
    CanvasArtifactUpsertRequest,
    CanvasCostEstimateRequest,
    CanvasOrchestrationRequest,
    CanvasProjectAssetShareRequest,
    CanvasPromptCompileRequest,
    CanvasPromptPackCompileRequest,
    CanvasPromptPackGenerateRequest,
    CanvasTemplateCreateRequest,
    CanvasTemplateInstantiateRequest,
)
from app.models.canvas_agent import SemanticPlan, with_semantic_prompt
from app.services.business_metadata import load_canvas_payload
from app.services.canvas_agent.adapter import semantic_plan_to_patch
from app.services.canvas_agent.artifacts import (
    ARTIFACT_STAGES,
    compile_prompt,
    normalize_anchors,
    validate_stage,
)
from app.services.canvas_agent.checkpoint import create_async_checkpointer
from app.services.canvas_agent.context import build_canvas_context
from app.services.canvas_agent.doc_chain import stage_sources, validate_stage_sources
from app.services.canvas_agent.evaluation import (
    evaluate_artifact_quality,
    record_evaluation,
)
from app.services.canvas_agent.events import emit_agent_event
from app.services.canvas_agent.event_factory import EventSpec, patch_applied, progress as progress_event, task_lifecycle
from app.services.canvas_agent.event_types import PRESENTATION_TARGETS
from app.services.canvas_agent.executor import (
    PatchConflictError,
    PatchPermissionError,
    apply_patch_idempotently,
)
from app.services.canvas_agent.model_resolver import (
    CanvasAgentUpstreamError,
    resolve_canvas_agent_model,
)
from app.services.canvas_agent.orchestration import (
    build_specialist_plan,
    enforce_budget,
    estimate_plan_cost,
)
from app.services.canvas_agent.planner import run_canvas_agent
from app.services.canvas_agent.reliability import (
    DEFAULT_RUN_LIMITS,
    canvas_structure_fingerprint,
    classify_failure,
    enforce_plan_limits,
)
from app.services.canvas_agent.skills import (
    get_enabled_skill,
    list_enabled_skill_summaries,
    read_skill,
)
from app.services.canvas_agent.store import (
    append_message,
    create_run,
    create_template,
    delete_run,
    get_artifact,
    get_run,
    get_template,
    latest_plan,
    list_artifacts,
    list_events,
    list_messages,
    list_operations,
    list_project_assets,
    list_runs,
    list_templates,
    rename_run,
    replace_plan_content,
    request_run_command_cancellation,
    save_artifact,
    save_plan,
    set_artifact_status,
    set_plan_status,
    share_project_asset,
    submit_command,
    update_run,
)
from app.services.canvas_agent.task_dispatch import submit_run_requests
from app.services.canvas_tasks import (
    enqueue_canvas_task,
    get_canvas_task,
    release_canvas_task_dispatch,
    update_canvas_task,
)


async def _emit_event_spec(user_id: str, run_id: str, spec: EventSpec) -> None:
    """Send one canonical Agent event through the sole persistence boundary."""
    await emit_agent_event(
        user_id,
        run_id,
        spec.event_type,
        spec.payload,
        phase=spec.phase,
        severity=spec.severity,
    )


def _require_canvas_agent_access() -> str:
    user_id = current_user_id()
    if not has_page_access(user_id, "canvas-agent"):
        raise HTTPException(status_code=403, detail="需要“画布 Agent”页面权限。")
    return user_id

router = APIRouter(dependencies=[Depends(_require_canvas_agent_access)])
logger = get_logger("canvas_agent")

def _user(request: Request, x_user_id: str) -> str:
    return safe_user_id(x_user_id, request)


@router.post("/api/canvas-agent/presentation-diagnostics", status_code=204)
async def canvas_agent_presentation_diagnostics(request: Request, x_user_id: str = Header(default="")):
    """Record a client/server presentation-contract version mismatch."""
    user_id = _user(request, x_user_id)
    try:
        body = await request.json()
    except (json.JSONDecodeError, UnicodeDecodeError):
        return Response(status_code=204)
    target = str((body or {}).get("target") or "")[:64] if isinstance(body, dict) else ""
    if target and target not in PRESENTATION_TARGETS:
        AGENT_EVENT_PRESENTATION_UNKNOWN_TARGETS.inc()
        logger.warning(
            "unknown Canvas Agent presentation target reported by client",
            extra={
                "event": "canvas_agent_event_presentation_unknown_target",
                "user_id": user_id,
                "target": target,
            },
        )
    return Response(status_code=204)


def _can_continue_planning(status: str) -> bool:
    """A completed execution ends one turn, not the Agent conversation."""
    return str(status or "") not in {"cancelled", "failed", "blocked"}


def _normalize_semantic_type(raw: str) -> str:
    """Map a canvas/frontend node type onto a valid SemanticNodeType literal.

    Live canvas nodes carry frontend-only types (e.g. ``smart-asset-image`` for
    pasted/cropped asset nodes, ``smart-loop``) that are not part of the
    SemanticNode contract. Passing them through unmapped makes SemanticPlan
    validation fail during cost estimation, so collapse them to the closest
    valid semantic type with an image default.
    """
    value = str(raw or "").strip()
    mapping = {
        "prompt": "prompt", "smart-prompt": "smart-prompt",
        "image_generation": "image_generation", "video_generation": "video_generation",
        "workflow_generation": "workflow_generation",
        "smart-image": "smart-image", "smart-asset-image": "image_generation",
        "group": "group", "smart-group": "smart-group", "smart-loop": "smart-prompt",
    }
    if value in mapping:
        return mapping[value]
    if "video" in value:
        return "video_generation"
    if "prompt" in value:
        return "smart-prompt"
    return "image_generation"


def _hydrate_plan_nodes(plan_json: dict, canvas: dict | None) -> dict:
    """Attach node snapshots to every configurable step for the UI.

    A run step may target a node created earlier in the same plan. That node is
    not present in the persisted canvas yet, so looking only at the canvas
    snapshot leaves the second confirmation card without its title, prompt, or
    parameters. Keep the create-step snapshot as a local source as well.
    """
    nodes = {str(item.get("id") or ""): item for item in (canvas or {}).get("nodes", []) if isinstance(item, dict)}
    planned_nodes = {
        str(step.get("id") or ""): step.get("node")
        for step in plan_json.get("steps", [])
        if isinstance(step, dict) and step.get("action") == "canvas.create_node" and isinstance(step.get("node"), dict)
    }
    for step in plan_json.get("steps", []):
        if not isinstance(step, dict) or not step.get("target_node_id"):
            continue
        target_id = str(step["target_node_id"])
        source = nodes.get(target_id)
        planned = planned_nodes.get(target_id)
        if not source and not planned:
            continue
        if planned and not source and not step.get("node"):
            # The semantic node shape is already what the confirmation UI
            # expects; copy it so later mutation cannot affect the source step.
            step["node"] = json.loads(json.dumps(planned))
            continue
        if not source:
            # Keep a provider-supplied snapshot when the target is not yet
            # persisted and no create-step snapshot is available.
            continue
        # Canvas nodes have accumulated a few storage shapes over time. In
        # particular, `text` can be an imported file path while the actual
        # generation prompt lives in promptDraftText/runPrompt.
        source_params = source.get("params") if isinstance(source.get("params"), dict) else {}
        source_settings = source.get("settings") if isinstance(source.get("settings"), dict) else {}
        source_run_settings = source.get("runSettings") if isinstance(source.get("runSettings"), dict) else {}
        params = dict(source_params)
        if source_settings:
            params.setdefault("runSettings", dict(source_settings))
        if source_run_settings:
            merged_settings = dict(params.get("runSettings") or {})
            merged_settings.update(source_run_settings)
            params["runSettings"] = merged_settings
        prompt = next((source.get(key) for key in ("promptDraftText", "runPrompt", "prompt", "content", "text")
                       if isinstance(source.get(key), str) and source.get(key).strip()), "")
        capability = str(source.get("capability") or "")
        raw_type = str(source.get("type") or source.get("semantic_type") or "")
        semantic_type = _normalize_semantic_type(raw_type)
        if not capability:
            node_type = semantic_type
            api_kind = str(source_run_settings.get("apiKind") or source.get("genKind") or "").lower()
            engine = str(source_run_settings.get("engine") or "").lower()
            if node_type in {"smart-prompt", "prompt"}:
                capability = "prompt.generate"
            elif engine == "comfy":
                capability = f"comfyui.workflow.{'video' if api_kind == 'video' else 'image'}"
            elif engine == "runninghub" or source_run_settings.get("resource_id"):
                capability = f"runninghub.app.{'video' if api_kind == 'video' else 'image'}"
            elif api_kind == "video":
                capability = "video.text_to_video"
            elif node_type in {"smart-image", "image_generation", "video_generation", "workflow_generation"}:
                capability = "image.text_to_image"
        step["node"] = {
            "schema_version": 1,
            "semantic_type": semantic_type,
            "title": source.get("title") or source.get("name") or "",
            "capability": capability,
            "params": with_semantic_prompt(params, prompt),
        }
    return plan_json


async def _require_run(user_id: str, run_id: str) -> dict:
    run = await asyncio.to_thread(get_run, user_id, run_id)
    if not run: raise HTTPException(status_code=404, detail="Agent Run 不存在")
    return run


async def _append_plan_reply(user_id: str, run_id: str) -> str:
    """Persist the user-facing end of a planning turn before rendering its plan."""
    reply = "我已整理好执行计划，请确认后继续。"
    await asyncio.to_thread(append_message, user_id, run_id, "assistant", reply, {"kind": "plan_ready"})
    await emit_agent_event(user_id, run_id, "message.replied", {"reply": reply})
    return reply

async def _append_execution_reply(user_id: str, run_id: str, canvas_id: str, execution_result: dict, tasks: list[dict], model=None) -> None:
    """Persist the post-confirmation Agent reply and its live node references."""
    canvas = await asyncio.to_thread(load_canvas_payload, user_id, canvas_id)
    nodes = {str(node.get("id") or ""): node for node in (canvas or {}).get("nodes", []) if isinstance(node, dict)}
    node_ids = list(dict.fromkeys([
        *[str(node_id) for node_id in (execution_result.get("changed_node_ids") or []) if node_id],
        *[str(item.get("node_id") or "") for item in (execution_result.get("run_requests") or []) if isinstance(item, dict)],
    ]))
    references = [{
        "node_id": node_id,
        "image_index": -1,
        "empty": True,
        "source": "canvas",
        "url": "",
        "thumbnail": "",
        "preview_url": "",
        "name": str(nodes.get(node_id, {}).get("title") or nodes.get(node_id, {}).get("name") or node_id),
    } for node_id in node_ids]
    created = len(execution_result.get("node_refs") or {})
    changed = max(0, len(node_ids) - created)
    fallback = "已创建节点。" if created == 1 else (f"已创建 {created} 个节点。" if created else "已完成画布节点更新。")
    if changed:
        fallback += " 已更新关联节点。"
    if tasks:
        fallback += " 生成任务已提交，结果会显示在下方节点中。"
    if model is not None:
        try:
            response = await model.ainvoke([
                SystemMessage(content="你是画布 Agent。根据已执行工具的真实结果，用中文写一到两句简短交付说明。不要声称任务已完成；若任务已提交，说明正在生成。不要使用 Markdown、列表或提问。"),
                HumanMessage(content=json.dumps({"created_nodes": created, "updated_nodes": changed, "submitted_tasks": len(tasks), "node_names": [item["name"] for item in references]}, ensure_ascii=False)),
            ])
            content = str(getattr(response, "content", "") or "").strip()
            if content and not getattr(response, "tool_calls", None):
                fallback = content[:500]
        except Exception:
            logger.warning("canvas agent execution reply generation failed", exc_info=True, extra={"event": "canvas_agent_execution_reply_failed", "run_id": run_id})
    await asyncio.to_thread(append_message, user_id, run_id, "assistant", fallback, {"kind": "execution_result", "media_references": references})
    await emit_agent_event(user_id, run_id, "message.replied", {"reply": fallback, "media_references": references})

def _merge_existing_params(current: dict, incoming: dict) -> dict:
    """Apply only keys already proposed by the model; do not accept new execution fields from the browser."""
    merged = dict(current)
    for key, value in incoming.items():
        if key not in current:
            continue
        if isinstance(current[key], dict) and isinstance(value, dict):
            merged[key] = _merge_existing_params(current[key], value)
        elif isinstance(value, (str, int, float, bool)) or value is None:
            merged[key] = value
    return merged

async def _apply_confirmation_overrides(user_id: str, run_id: str, plan_row: dict, overrides: list[dict]) -> None:
    if not overrides:
        return
    plan = SemanticPlan.model_validate(plan_row["content_json"])
    steps = {step.id: step for step in plan.steps if step.node is not None}
    if len(overrides) > len(steps):
        raise HTTPException(status_code=422, detail="节点配置数量无效")
    seen: set[str] = set()
    for override in overrides:
        step_id = str(override.get("step_id") or "")
        step = steps.get(step_id)
        if not step or step_id in seen:
            raise HTTPException(status_code=422, detail="节点配置目标无效")
        seen.add(step_id)
        node = step.node
        assert node is not None
        if "title" in override:
            node.title = str(override["title"] or "")[:200]
        params = override.get("params")
        if params is not None:
            if not isinstance(params, dict):
                raise HTTPException(status_code=422, detail="节点参数格式无效")
            node.params = _merge_existing_params(node.params, params)
        # The prompt now lives in params.runSettings.prompt. Accept the legacy
        # top-level "content" override for compatibility and write it there so
        # a user-edited prompt is preserved regardless of the merge guard.
        if "content" in override:
            node.params = with_semantic_prompt(node.params, str(override["content"] or "")[:20000])
    saved = await asyncio.to_thread(replace_plan_content, user_id, run_id, int(plan_row["version"]), plan.model_dump(mode="json"))
    if not saved:
        raise HTTPException(status_code=409, detail="计划版本已过期")


async def _execute_approved_canvas_patch(user_id: str, run_id: str, canvas_id: str, plan_version: int, authorized_node_ids: list[str]) -> dict:
    """The graph-owned mutation boundary invoked only after confirmation."""
    run = await _require_run(user_id, run_id)
    plan_row = await asyncio.to_thread(latest_plan, user_id, run_id)
    if not plan_row or int(plan_row["version"]) != int(plan_version):
        raise HTTPException(status_code=409, detail="计划版本已过期")
    canvas = await asyncio.to_thread(load_canvas_payload, user_id, canvas_id)
    if not canvas: raise HTTPException(status_code=404, detail="画布不存在")
    current_version = int(canvas.get("version") or 1)
    run_metadata = run.get("metadata_json") or {}
    if current_version != int(run["base_canvas_version"]):
        planned_fingerprint = run_metadata.get("planned_canvas_fingerprint")
        if planned_fingerprint and planned_fingerprint == canvas_structure_fingerprint(canvas):
            await asyncio.to_thread(update_run, user_id, run_id, base_canvas_version=current_version, metadata_json={"placement_recomputed": True})
        else:
            await asyncio.to_thread(update_run, user_id, run_id, status="blocked", phase="planning")
            await emit_agent_event(user_id, run_id, "run.blocked", {"reason": "canvas_structure_conflict", "current_version": current_version, "base_version": run["base_canvas_version"]})
            raise HTTPException(status_code=409, detail={"message": "画布内容或连线已变化，请重新规划", "current_version": current_version})
    from app.services.canvas_agent.events import current_operation_id
    from app.services.canvas_agent.store import command_cancel_requested
    operation_id = current_operation_id()
    if operation_id and await asyncio.to_thread(command_cancel_requested, operation_id):
        raise HTTPException(status_code=409, detail="操作已取消")
    try:
        plan = SemanticPlan.model_validate(plan_row["content_json"])
        plan_json = plan.model_dump(mode="json")
        estimate = estimate_plan_cost(plan_json, budget=(run_metadata.get("limits") or {}).get("max_budget"))
        enforce_budget(estimate)
        plan_json["execution"]["estimated_cost"] = estimate["estimated_cost"]
        plan = SemanticPlan.model_validate(plan_json)
        enforce_plan_limits(plan_json, run_metadata.get("limits"))
        patch = semantic_plan_to_patch(plan, canvas_id, current_version, canvas=canvas)
        await asyncio.to_thread(update_run, user_id, run_id, status="applying", phase="applying")
        result = await asyncio.to_thread(
            apply_patch_idempotently, user_id, run_id, f"{run_id}:plan:{plan_version}", patch,
            risk="confirm", allow_user_node_changes=bool(authorized_node_ids), authorized_node_ids=set(authorized_node_ids),
        )
    except (PatchConflictError, PatchPermissionError, ValueError) as exc:
        AGENT_FAILURES.labels(stage="applying", category=classify_failure(exc)).inc()
        await asyncio.to_thread(update_run, user_id, run_id, status="blocked", phase="applying")
        await emit_agent_event(user_id, run_id, "run.blocked", {"reason": str(exc)[:500]})
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    requested_tasks = len(result.get("run_requests") or [])
    limit_tasks = int((run_metadata.get("limits") or {}).get("max_tasks", DEFAULT_RUN_LIMITS["max_tasks"]))
    if requested_tasks > limit_tasks:
        await asyncio.to_thread(update_run, user_id, run_id, status="blocked", phase="running", metadata_json={"blocked_reason": "task_quota_exceeded"})
        await emit_agent_event(user_id, run_id, "run.blocked", {"reason": "task_quota_exceeded", "requested": requested_tasks, "limit": limit_tasks})
        raise HTTPException(status_code=409, detail="Run 任务配额超限")
    return {**result, "plan_goal": plan.goal, "plan_version": plan_version, "task_limit": limit_tasks}


async def _dispatch_approved_canvas_tasks(user_id: str, run_id: str, canvas_id: str, execution_result: dict, *, model=None) -> list[dict]:
    """Submit deferred generation tasks after the graph records patch success."""
    from app.services.canvas_agent.events import current_operation_id
    from app.services.canvas_agent.store import command_cancel_requested
    operation_id = current_operation_id()
    if operation_id and await asyncio.to_thread(command_cancel_requested, operation_id):
        raise HTTPException(status_code=409, detail="操作已取消")
    try:
        tasks = await submit_run_requests(user_id, canvas_id, run_id, execution_result.get("run_requests") or [], prompt=str(execution_result.get("plan_goal") or ""))
    except Exception as exc:
        AGENT_FAILURES.labels(stage="task_submission", category=classify_failure(exc)).inc()
        await asyncio.to_thread(update_run, user_id, run_id, status="failed", phase="running")
        await emit_agent_event(user_id, run_id, "run.failed", {"error": str(exc)[:500], "stage": "task_submission"})
        raise HTTPException(status_code=502, detail="画布已更新，但生成任务提交失败") from exc
    await asyncio.to_thread(update_run, user_id, run_id, status="running" if tasks else "completed", phase="running" if tasks else "reviewing", metadata_json={"task_ids": [task["task_id"] for task in tasks]})
    run = await _require_run(user_id, run_id)
    AGENT_RUNS.labels(mode=run.get("mode", "fast_track"), status="running" if tasks else "completed").inc()
    audit_event("canvas_agent_plan_applied", action="apply_patch", resource_type="canvas_agent_run", resource_id=run_id, result="success", run_id=run_id, canvas_id=canvas_id, operation_id=f"{run_id}:plan:{execution_result.get('plan_version', '')}", request_id="")
    await manager.broadcast_canvas_updated(canvas_id, now_ms(), "", user_id)
    await _emit_event_spec(user_id, run_id, patch_applied({key: value for key, value in execution_result.items() if key not in {"plan_goal", "task_limit"}}))
    if tasks: await emit_agent_event(user_id, run_id, "tasks.queued", {"tasks": tasks})
    else: await emit_agent_event(user_id, run_id, "run.completed", {"version": execution_result["version"]})
    try:
        await _append_execution_reply(user_id, run_id, canvas_id, execution_result, tasks, model=model)
    except Exception:
        logger.exception("canvas agent execution reply projection failed", extra={"event": "canvas_agent_execution_reply_projection_failed", "run_id": run_id})
    return tasks

@router.post("/api/canvas-agent/runs")
async def create_agent_run(payload: CanvasAgentRunCreateRequest, request: Request, x_user_id: str = Header(default="")):
    user_id = _user(request, x_user_id)
    limits = {**DEFAULT_RUN_LIMITS, **payload.limits, "max_steps": payload.max_steps}
    try: run = await asyncio.to_thread(create_run, user_id, payload.canvas_id, mode=payload.mode, conversation_id=payload.conversation_id, max_steps=payload.max_steps)
    except PermissionError as exc: raise HTTPException(status_code=404, detail=str(exc)) from exc
    await asyncio.to_thread(update_run, user_id, run["id"], metadata_json={"limits": limits})
    AGENT_RUNS.labels(mode=payload.mode, status="created").inc()
    await emit_agent_event(user_id, run["id"], "run.created", {"canvas_id": payload.canvas_id, "mode": payload.mode})
    return {"run": run}

@router.get("/api/canvas-agent/runs")
async def list_agent_runs(canvas_id: str, request: Request, limit: int = 50, x_user_id: str = Header(default="")):
    user_id = _user(request, x_user_id)
    if not canvas_id.strip():
        raise HTTPException(status_code=422, detail="canvas_id 不能为空")
    # The store query scopes by both owner and canvas, so a guessed canvas ID
    # cannot expose runs belonging to another user.
    runs = await asyncio.to_thread(list_runs, user_id, canvas_id, limit=limit)
    return {"runs": runs}

@router.patch("/api/canvas-agent/runs/{run_id}")
async def rename_agent_run(run_id: str, request: Request, x_user_id: str = Header(default="")):
    user_id = _user(request, x_user_id)
    try:
        payload = await request.json()
        run = await asyncio.to_thread(rename_run, user_id, run_id, payload.get("title", ""))
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    if not run: raise HTTPException(status_code=404, detail="会话不存在")
    return {"run": run}

@router.delete("/api/canvas-agent/runs/{run_id}")
async def delete_agent_run(run_id: str, request: Request, x_user_id: str = Header(default="")):
    user_id = _user(request, x_user_id)
    if not await asyncio.to_thread(delete_run, user_id, run_id): raise HTTPException(status_code=404, detail="会话不存在")
    return {"deleted": True, "run_id": run_id}

@router.get("/api/canvas-agent/runs/{run_id}")
async def get_agent_run(run_id: str, request: Request, x_user_id: str = Header(default="")):
    user_id = _user(request, x_user_id); run = await _require_run(user_id, run_id)
    messages, plan, events, operations, artifacts = await asyncio.gather(
        asyncio.to_thread(list_messages, user_id, run_id),
        asyncio.to_thread(latest_plan, user_id, run_id),
        asyncio.to_thread(list_events, user_id, run_id),
        asyncio.to_thread(list_operations, user_id, run_id),
        asyncio.to_thread(list_artifacts, user_id, run_id),
    )
    task_ids = list((run.get("metadata_json") or {}).get("task_ids") or [])
    tasks = await asyncio.gather(*(get_canvas_task(task_id) for task_id in task_ids)) if task_ids else []
    return {"run": run, "messages": messages, "plan": plan, "events": events, "operations": operations, "artifacts": artifacts, "tasks": [task for task in tasks if task]}

async def execute_message_command(user_id: str, run_id: str, payload: CanvasAgentMessageRequest):
    """Run one planning turn for a new user message and persist the resulting plan.

    Builds the canvas context, resolves the LLM model, invokes the LangGraph
    agent, and saves the produced ``SemanticPlan`` with status
    ``awaiting_confirmation``. If the graph returns no plan (e.g. a pure
    conversational reply), the assistant message is persisted directly and the
    function returns early without a plan. On upstream provider errors the run
    is marked ``failed`` and a 503 is raised so the caller can retry; all other
    exceptions yield 422.

    Args:
        user_id: Authenticated owner of the run.
        run_id: Target Canvas Agent run.
        payload: User message content plus optional model/connection overrides
            and node selection hints.

    Returns:
        A dict with ``run``, ``plan`` (when produced), and ``reply``.

    Raises:
        HTTPException 409: Run status does not allow further planning.
        HTTPException 503: Upstream LLM provider is unavailable (retryable).
        HTTPException 422: Planning failed for any other reason.
    """
    run = await _require_run(user_id, run_id)
    if not _can_continue_planning(run["status"]): raise HTTPException(status_code=409, detail="Run 当前状态不可继续规划")
    if run["status"] == "completed":
        # A new user request starts the next planning turn on the same
        # LangGraph thread. The completed status only describes the previous
        # patch execution, not the lifetime of the conversation.
        run = await asyncio.to_thread(update_run, user_id, run_id, status="planning", phase="planning") or run
    try:
        await _emit_event_spec(user_id, run_id, progress_event("context", "正在读取画布上下文…"))
        context = await asyncio.to_thread(build_canvas_context, user_id, run["canvas_id"], selected_node_ids=payload.selected_node_ids, mention_node_ids=payload.mention_node_ids, media_references=payload.media_references)
        context["run_id"] = run_id
        context["user_id"] = user_id
        context["canvas_id"] = run["canvas_id"]
        model = await asyncio.to_thread(
            resolve_canvas_agent_model, model=payload.model, model_id=payload.model_id, connection_id=payload.connection_id,
        )
        async def progress(event_run_id: str, spec: EventSpec):
            await _emit_event_spec(user_id, event_run_id, spec)
        # Closures passed into the graph so it can mutate the canvas without
        # importing router symbols directly (avoids circular dependencies).
        async def execute_patch(plan_version: int, authorized_node_ids: list[str]) -> dict:
            return await _execute_approved_canvas_patch(user_id, run_id, run["canvas_id"], plan_version, authorized_node_ids)
        async def dispatch_tasks(execution_result: dict) -> list[dict]:
            return await _dispatch_approved_canvas_tasks(user_id, run_id, run["canvas_id"], execution_result, model=model)
        async with create_async_checkpointer() as checkpointer:
            graph_result = await run_canvas_agent(model, payload.content, context, checkpointer=checkpointer, emit_progress=progress, execute_patch=execute_patch, dispatch_tasks=dispatch_tasks)
        latest = await asyncio.to_thread(latest_plan, user_id, run_id)
        if not latest:
            # The graph answered conversationally without producing a plan.
            messages = graph_result.get("messages") or []
            reply = str(getattr(messages[-1], "content", "我可以帮助你处理画布内容。")) if messages else "我可以帮助你处理画布内容。"
            await asyncio.to_thread(append_message, user_id, run_id, "assistant", reply, {"kind": "tool_agent_reply"})
            await emit_agent_event(user_id, run_id, "message.replied", {"reply": reply})
            return {"run": await asyncio.to_thread(get_run, user_id, run_id), "reply": reply}
        plan = SemanticPlan.model_validate(latest["content_json"])
        await asyncio.to_thread(update_run, user_id, run_id, metadata_json={"model_thread_started": True, "model_id": payload.model_id, "model_connection_id": payload.connection_id})
        plan_json = plan.model_dump(mode="json")
        # Attach live canvas node snapshots so the confirmation UI can render
        # titles and parameters for nodes that don't exist in the canvas yet.
        plan_json = _hydrate_plan_nodes(plan_json, await asyncio.to_thread(load_canvas_payload, user_id, run["canvas_id"]))
        estimate = estimate_plan_cost(plan_json)
        plan_json["execution"]["estimated_cost"] = estimate["estimated_cost"]
        plan = SemanticPlan.model_validate(plan_json)
        enforce_plan_limits(plan_json, (run.get("metadata_json") or {}).get("limits"))
        saved = await asyncio.to_thread(save_plan, user_id, run_id, plan_json, status="awaiting_confirmation")
        # Snapshot the canvas fingerprint so execute_confirm_command can detect
        # structural changes between planning and confirmation.
        await asyncio.to_thread(update_run, user_id, run_id, status="awaiting_confirmation", phase="planning", base_canvas_version=context["canvas_version"], step_count=int(run.get("step_count") or 0) + 1, metadata_json={"planned_canvas_fingerprint": canvas_structure_fingerprint(await asyncio.to_thread(load_canvas_payload, user_id, run["canvas_id"]))})
    except CanvasAgentUpstreamError as exc:
        logger.exception(
            "canvas agent planning provider unavailable",
            extra={"event": "canvas_agent_planning_provider_unavailable", "run_id": run_id, "canvas_id": run["canvas_id"], "phase": "message"},
        )
        AGENT_FAILURES.labels(stage="planning", category="transient").inc()
        await asyncio.to_thread(update_run, user_id, run_id, status="failed", phase="planning")
        await emit_agent_event(user_id, run_id, "run.failed", {"error": str(exc), "category": "transient"})
        raise HTTPException(status_code=503, detail=str(exc), headers={"Retry-After": "3"}) from exc
    except Exception as exc:
        logger.exception(
            "canvas agent planning failed",
            extra={"event": "canvas_agent_planning_failed", "run_id": run_id, "canvas_id": run["canvas_id"], "phase": "message"},
        )
        AGENT_FAILURES.labels(stage="planning", category=classify_failure(exc)).inc()
        await asyncio.to_thread(update_run, user_id, run_id, status="failed", phase="planning")
        await emit_agent_event(user_id, run_id, "run.failed", {"error": str(exc)[:500]})
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    reply = await _append_plan_reply(user_id, run_id)
    await emit_agent_event(user_id, run_id, "plan.created", {"plan_version": saved["version"], "plan": plan.model_dump(mode="json")})
    return {"run": await asyncio.to_thread(get_run, user_id, run_id), "plan": saved, "reply": reply}

async def execute_answer_command(user_id: str, run_id: str, payload: CanvasAgentAnswerRequest):
    run = await _require_run(user_id, run_id)
    metadata = run.get("metadata_json") or {}
    try:
        await _emit_event_spec(user_id, run_id, progress_event("context", "正在恢复画布上下文…"))
        context = await asyncio.to_thread(build_canvas_context, user_id, run["canvas_id"])
        context["run_id"] = run_id
        context["user_id"] = user_id
        context["canvas_id"] = run["canvas_id"]
        model_name = payload.model
        model_id = payload.model_id or metadata.get("model_id", "")
        connection_id = payload.connection_id or metadata.get("model_connection_id", "")
        model = await asyncio.to_thread(resolve_canvas_agent_model, model=model_name, model_id=model_id, connection_id=connection_id)
        async def progress(event_run_id: str, spec: EventSpec):
            await _emit_event_spec(user_id, event_run_id, spec)
        async def execute_patch(plan_version: int, authorized_node_ids: list[str]) -> dict:
            return await _execute_approved_canvas_patch(user_id, run_id, run["canvas_id"], plan_version, authorized_node_ids)
        async def dispatch_tasks(execution_result: dict) -> list[dict]:
            return await _dispatch_approved_canvas_tasks(user_id, run_id, run["canvas_id"], execution_result, model=model)
        async with create_async_checkpointer() as checkpointer:
            graph_result = await run_canvas_agent(model, payload.answer, context, checkpointer=checkpointer, emit_progress=progress, execute_patch=execute_patch, dispatch_tasks=dispatch_tasks)
        latest = await asyncio.to_thread(latest_plan, user_id, run_id)
        if not latest:
            return {"run": await asyncio.to_thread(get_run, user_id, run_id), "reply": "请补充你希望对画布执行的操作。"}
        plan = SemanticPlan.model_validate(latest["content_json"])
        plan_json = _hydrate_plan_nodes(plan.model_dump(mode="json"), await asyncio.to_thread(load_canvas_payload, user_id, run["canvas_id"]))
        plan = SemanticPlan.model_validate(plan_json)
        saved = await asyncio.to_thread(save_plan, user_id, run_id, plan.model_dump(mode="json"), status="awaiting_confirmation")
        await asyncio.to_thread(update_run, user_id, run_id, status="awaiting_confirmation", phase="planning", base_canvas_version=context["canvas_version"], metadata_json={"model_thread_started": True, "model_name": model_name, "model_id": model_id, "model_connection_id": connection_id})
        reply = await _append_plan_reply(user_id, run_id)
        await emit_agent_event(user_id, run_id, "plan.created", {"plan_version": saved["version"], "plan": plan.model_dump(mode="json"), "resumed": True})
        return {"run": await asyncio.to_thread(get_run, user_id, run_id), "plan": saved, "reply": reply}
    except CanvasAgentUpstreamError as exc:
        logger.exception(
            "canvas agent planning provider unavailable",
            extra={"event": "canvas_agent_planning_provider_unavailable", "run_id": run_id, "canvas_id": run["canvas_id"], "phase": "answer"},
        )
        await asyncio.to_thread(update_run, user_id, run_id, status="failed", phase="planning")
        await emit_agent_event(user_id, run_id, "run.failed", {"error": str(exc), "category": "transient"})
        raise HTTPException(status_code=503, detail=str(exc), headers={"Retry-After": "3"}) from exc
    except Exception as exc:
        logger.exception(
            "canvas agent planning failed",
            extra={"event": "canvas_agent_planning_failed", "run_id": run_id, "canvas_id": run["canvas_id"], "phase": "answer"},
        )
        await asyncio.to_thread(update_run, user_id, run_id, status="failed", phase="planning")
        await emit_agent_event(user_id, run_id, "run.failed", {"error": str(exc)[:500]})
        raise HTTPException(status_code=422, detail=str(exc)) from exc

async def execute_confirm_command(user_id: str, run_id: str, payload: CanvasAgentConfirmRequest):
    run = await _require_run(user_id, run_id); plan_row = await asyncio.to_thread(latest_plan, user_id, run_id)
    if not plan_row or int(plan_row["version"]) != payload.plan_version: raise HTTPException(status_code=409, detail="计划版本已过期")
    if run["status"] != "awaiting_confirmation": raise HTTPException(status_code=409, detail="Run 不在等待确认状态")
    if not payload.approved:
        # A rejected plan ends only the interrupted planning turn. Resume the
        # graph so its confirmation interrupt is consumed before accepting the
        # next user message on this Run.
        async with create_async_checkpointer() as checkpointer:
            from app.services.canvas_agent.runtime import create_canvas_agent
            graph = create_canvas_agent(model=None, user_id=user_id, run_id=run_id, canvas_id=run["canvas_id"], checkpointer=checkpointer)
            await graph.ainvoke(Command(resume={"approved": False}), config={"configurable": {"thread_id": run_id}})
        await asyncio.to_thread(update_run, user_id, run_id, status="planning", phase="planning")
        await asyncio.to_thread(set_plan_status, user_id, run_id, payload.plan_version, "rejected")
        return {"run": await asyncio.to_thread(get_run, user_id, run_id), "approved": False}
    await _apply_confirmation_overrides(user_id, run_id, plan_row, payload.node_overrides)
    # Resume the same graph thread. The graph deterministically emits the
    # execution tool call, records its ToolMessage, then dispatches tasks.
    metadata = run.get("metadata_json") or {}
    model_name = ""
    model = await asyncio.to_thread(
        resolve_canvas_agent_model, model=model_name, model_id=metadata.get("model_id", ""), connection_id=metadata.get("model_connection_id", ""),
    )
    await _emit_event_spec(user_id, run_id, progress_event("context", "正在校验当前画布…"))
    context = await asyncio.to_thread(build_canvas_context, user_id, run["canvas_id"])
    context.update({"run_id": run_id, "user_id": user_id, "canvas_id": run["canvas_id"]})
    async def progress(event_run_id: str, spec: EventSpec):
        await _emit_event_spec(user_id, event_run_id, spec)
    async def execute_patch(plan_version: int, authorized_node_ids: list[str]) -> dict:
        return await _execute_approved_canvas_patch(user_id, run_id, run["canvas_id"], plan_version, authorized_node_ids)
    async def dispatch_tasks(execution_result: dict) -> list[dict]:
        return await _dispatch_approved_canvas_tasks(user_id, run_id, run["canvas_id"], execution_result, model=model)
    async with create_async_checkpointer() as checkpointer:
        from app.services.canvas_agent.runtime import create_canvas_agent
        graph = create_canvas_agent(model=model, user_id=user_id, run_id=run_id, canvas_id=run["canvas_id"], checkpointer=checkpointer, emit_progress=progress, execute_patch=execute_patch, dispatch_tasks=dispatch_tasks)
        graph_result = await graph.ainvoke(Command(resume={"approved": True, "plan_version": payload.plan_version, "authorized_node_ids": payload.authorized_node_ids}), config={"configurable": {"thread_id": run_id}})
    await asyncio.to_thread(set_plan_status, user_id, run_id, payload.plan_version, "confirmed")
    return {"run": await asyncio.to_thread(get_run, user_id, run_id), "result": graph_result.get("execution_result") or {}, "tasks": graph_result.get("tasks") or []}

async def _accept_command(user_id: str, run_id: str, operation_type: str, payload: dict) -> JSONResponse:
    try:
        operation, created = await asyncio.to_thread(submit_command, user_id, run_id, operation_type, str(payload.get("client_request_id") or ""), payload)
    except RuntimeError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    if created:
        await emit_agent_event(user_id, run_id, "operation.accepted", {"message": "请求已受理，等待 Agent Worker 执行", "command_type": operation_type}, operation_id=operation["id"], phase="confirmation" if operation_type == "agent.confirm" else "planning")
    events = await asyncio.to_thread(list_events, user_id, run_id)
    return JSONResponse(status_code=202, content={"run_id": run_id, "operation_id": operation["id"], "status": operation["status"], "events_after_sequence": max((int(event["sequence"]) for event in events), default=0)})

@router.post("/api/canvas-agent/runs/{run_id}/messages")
async def post_agent_message(run_id: str, payload: CanvasAgentMessageRequest, request: Request, x_user_id: str = Header(default="")):
    user_id = _user(request, x_user_id); run = await _require_run(user_id, run_id)
    if not _can_continue_planning(run["status"]): raise HTTPException(status_code=409, detail="Run 当前状态不可继续规划")
    return await _accept_command(user_id, run_id, "agent.message", payload.model_dump())

@router.post("/api/canvas-agent/runs/{run_id}/answers")
async def answer_agent_question(run_id: str, payload: CanvasAgentAnswerRequest, request: Request, x_user_id: str = Header(default="")):
    user_id = _user(request, x_user_id); await _require_run(user_id, run_id)
    return await _accept_command(user_id, run_id, "agent.answer", payload.model_dump())

@router.post("/api/canvas-agent/runs/{run_id}/confirm")
async def confirm_agent_plan(run_id: str, payload: CanvasAgentConfirmRequest, request: Request, x_user_id: str = Header(default="")):
    user_id = _user(request, x_user_id); run = await _require_run(user_id, run_id)
    plan = await asyncio.to_thread(latest_plan, user_id, run_id)
    if not plan or int(plan["version"]) != payload.plan_version: raise HTTPException(status_code=409, detail="计划版本已过期")
    if run["status"] != "awaiting_confirmation": raise HTTPException(status_code=409, detail="Run 不在等待确认状态")
    return await _accept_command(user_id, run_id, "agent.confirm", payload.model_dump())

@router.post("/api/canvas-agent/runs/{run_id}/cancel")
async def cancel_agent_run(run_id: str, request: Request, x_user_id: str = Header(default="")):
    user_id = _user(request, x_user_id); run = await _require_run(user_id, run_id)
    if run["status"] in {"completed", "cancelled"}: return {"run": run}
    operations = await asyncio.to_thread(request_run_command_cancellation, user_id, run_id)
    for operation in operations:
        await emit_agent_event(user_id, run_id, "operation.cancel_requested", {"message": "已请求取消 Agent 命令"}, operation_id=operation["id"], phase="cancelling")
    task_ids = list((run.get("metadata_json") or {}).get("task_ids") or [])
    for task_id in task_ids:
        task = await get_canvas_task(task_id)
        if task and task.get("status") in {"queued", "running"}:
            await update_canvas_task(task_id, expected_status=task["status"], status="cancelled", cancellation_requested=True, error="Run 已取消")
            await release_canvas_task_dispatch(task_id)
    await asyncio.to_thread(update_run, user_id, run_id, status="cancelled", phase="cancelling")
    await emit_agent_event(user_id, run_id, "run.cancelled", {})
    return {"run": await asyncio.to_thread(get_run, user_id, run_id)}

@router.post("/api/canvas-agent/runs/{run_id}/retry")
async def retry_agent_run(run_id: str, payload: CanvasAgentRetryRequest, request: Request, x_user_id: str = Header(default="")):
    user_id = _user(request, x_user_id); run = await _require_run(user_id, run_id)
    metadata = run.get("metadata_json") or {}; retries = int(metadata.get("auto_repairs", 0) or 0); max_repairs = int((metadata.get("limits") or {}).get("max_auto_repairs", DEFAULT_RUN_LIMITS["max_auto_repairs"]))
    if retries >= max_repairs:
        await asyncio.to_thread(update_run, user_id, run_id, status="blocked", phase="reviewing", metadata_json={"blocked_reason": "auto_repair_quota_exceeded"})
        raise HTTPException(status_code=409, detail="Run 自动修复次数已用尽")
    await asyncio.to_thread(update_run, user_id, run_id, status="planning", phase="planning", metadata_json={"auto_repairs": retries + 1})
    await emit_agent_event(user_id, run_id, "run.retrying", {"operation_id": payload.operation_id})
    return {"run": await asyncio.to_thread(get_run, user_id, run_id)}

@router.post("/api/canvas-agent/runs/{run_id}/redo")
async def redo_agent_node(run_id: str, payload: CanvasAgentRedoRequest, request: Request, x_user_id: str = Header(default="")):
    """Create a child Run for a local prompt replacement and rerun branch."""
    user_id = _user(request, x_user_id); parent = await _require_run(user_id, run_id)
    canvas = await asyncio.to_thread(load_canvas_payload, user_id, parent["canvas_id"])
    if not canvas or not any(str(node.get("id")) == payload.node_id for node in canvas.get("nodes", []) if isinstance(node, dict)):
        raise HTTPException(status_code=404, detail="目标节点不存在")
    child = await asyncio.to_thread(create_run, user_id, parent["canvas_id"], mode=parent.get("mode", "fast_track"), conversation_id=parent.get("conversation_id", ""), base_canvas_version=int(canvas.get("version") or 1), max_steps=int(parent.get("max_steps") or 12))
    await asyncio.to_thread(update_run, user_id, child["id"], metadata_json={"parent_run_id": run_id, "redo_node_id": payload.node_id, "limits": (parent.get("metadata_json") or {}).get("limits", DEFAULT_RUN_LIMITS)})
    await asyncio.to_thread(append_message, user_id, child["id"], "user", payload.prompt, {"kind": "local_redo", "parent_run_id": run_id, "node_id": payload.node_id})
    plan = SemanticPlan(mode="fast_track", goal=payload.prompt, steps=[
        {"id": "replace", "action": "canvas.replace_node_content", "target_node_id": payload.node_id, "node": {"semantic_type": "prompt", "content": payload.prompt}},
        {"id": "rerun", "action": "canvas.run_node", "target_node_id": payload.node_id},
    ], confirmation={"required": True, "reason": "局部重做将替换目标节点内容并重新提交生成任务"}, execution={"auto_run": True, "parallelism": 1, "capabilities": ["canvas.replace_node_content", "canvas.run_node"], "estimated_cost": 1})
    saved = await asyncio.to_thread(save_plan, user_id, child["id"], plan.model_dump(mode="json"), status="awaiting_confirmation")
    await asyncio.to_thread(update_run, user_id, child["id"], status="awaiting_confirmation", phase="planning", metadata_json={"planned_canvas_fingerprint": canvas_structure_fingerprint(canvas)})
    await emit_agent_event(user_id, child["id"], "plan.created", {"plan_version": saved["version"], "plan": plan.model_dump(mode="json"), "parent_run_id": run_id, "local_redo": True})
    return {"run": await asyncio.to_thread(get_run, user_id, child["id"]), "plan": saved, "parent_run_id": run_id}

@router.post("/api/canvas-agent/runs/{run_id}/tasks/{task_id}/retry")
async def retry_agent_task(run_id: str, task_id: str, request: Request, x_user_id: str = Header(default="")):
    user_id = _user(request, x_user_id); run = await _require_run(user_id, run_id)
    task = await get_canvas_task(task_id)
    if not task or task.get("owner_id") != user_id or task.get("agent_run_id") != run_id:
        raise HTTPException(status_code=404, detail="Agent 任务不存在")
    if task.get("status") not in {"failed", "interrupted", "timed_out"}:
        raise HTTPException(status_code=409, detail="只有失败任务可以重试")
    if not any(str(task.get(key) or (task.get("request") or {}).get(key) or "").strip() for key in ("connection_id", "model_id", "resource_id")):
        raise HTTPException(status_code=409, detail="任务缺少已迁移的 connection_id/model_id/resource_id，无法重试")
    await release_canvas_task_dispatch(task_id)
    queued = await update_canvas_task(task_id, expected_status=task.get("status") or "failed", status="queued", error="", attempt=int(task.get("attempt", 1) or 1) + 1, deadline_at=time.time() + CANVAS_TASK_TIMEOUT_SECONDS)
    if not queued: raise HTTPException(status_code=409, detail="任务状态已变化")
    await enqueue_canvas_task(task_id)
    retry_event = task_lifecycle("retrying", {
        "task_id": task_id,
        "node_id": task.get("agent_node_id"),
        "status": "retrying",
    })
    await _emit_event_spec(user_id, run_id, retry_event)
    return {"task": queued}

@router.post("/api/canvas-agent/runs/{run_id}/review")
async def review_agent_run(run_id: str, payload: CanvasAgentReviewRequest, request: Request, x_user_id: str = Header(default="")):
    user_id = _user(request, x_user_id); run = await _require_run(user_id, run_id)
    status = str(payload.status or "approved").strip().lower()
    if status not in {"approved", "rejected", "needs_revision"}:
        raise HTTPException(status_code=422, detail="无效的 Review 状态")
    next_status = "completed" if status == "approved" else "blocked"
    await asyncio.to_thread(update_run, user_id, run_id, status=next_status, phase="reviewing", metadata_json={"review_status": status, "review_note": payload.note})
    await emit_agent_event(user_id, run_id, "run.reviewed", {"status": status, "note": payload.note})
    return {"run": await asyncio.to_thread(get_run, user_id, run_id)}

@router.get("/api/canvas-agent/runs/{run_id}/events")
async def get_agent_events(run_id: str, request: Request, after_sequence: int = 0, limit: int = 500, x_user_id: str = Header(default="")):
    user_id = _user(request, x_user_id); await _require_run(user_id, run_id)
    events = await asyncio.to_thread(list_events, user_id, run_id, after_sequence=after_sequence, limit=limit)
    return {"events": events, "after_sequence": after_sequence, "next_sequence": int(events[-1]["sequence"]) if events else int(after_sequence), "has_more": len(events) >= min(max(1, limit), 2000)}

@router.get("/api/canvas-agent/runs/{run_id}/artifacts")
async def get_agent_artifacts(run_id: str, request: Request, artifact_type: str = "", x_user_id: str = Header(default="")):
    user_id = _user(request, x_user_id); await _require_run(user_id, run_id)
    if artifact_type: validate_stage(artifact_type)
    return {"artifacts": await asyncio.to_thread(list_artifacts, user_id, run_id, artifact_type=artifact_type)}

@router.post("/api/canvas-agent/runs/{run_id}/artifacts")
async def upsert_agent_artifact(run_id: str, payload: CanvasArtifactUpsertRequest, request: Request, x_user_id: str = Header(default="")):
    user_id = _user(request, x_user_id); await _require_run(user_id, run_id); stage = validate_stage(payload.type)
    if payload.status not in {"draft", "approved", "rejected"}: raise HTTPException(status_code=422, detail="无效的 Artifact 状态")
    content = normalize_anchors(payload.content) if stage == "asset_anchors" else payload.content
    artifact = await asyncio.to_thread(save_artifact, user_id, run_id, stage, content, status=payload.status, source_artifact_ids=payload.source_artifact_ids)
    await emit_agent_event(user_id, run_id, "artifact.created", {"artifact_id": artifact["id"], "type": stage, "version": artifact["version"], "stale_downstream": True})
    return {"artifact": artifact}

@router.post("/api/canvas-agent/runs/{run_id}/artifacts/advance")
async def advance_agent_artifact(run_id: str, payload: CanvasArtifactAdvanceRequest, request: Request, x_user_id: str = Header(default="")):
    user_id = _user(request, x_user_id); await _require_run(user_id, run_id)
    stage = validate_stage(payload.target_stage)
    all_artifacts = await asyncio.to_thread(list_artifacts, user_id, run_id)
    sources = [item for item in all_artifacts if item["id"] in set(payload.source_artifact_ids)]
    if not payload.source_artifact_ids:
        required_types = set(stage_sources(stage))
        sources = [item for item in all_artifacts if item.get("type") in required_types and item.get("status") == "approved" and not item.get("stale")]
    try: validate_stage_sources(stage, sources)
    except ValueError as exc: raise HTTPException(status_code=409, detail=str(exc)) from exc
    source_ids = [item["id"] for item in sources]
    content = normalize_anchors(payload.content) if stage == "asset_anchors" else payload.content
    artifact = await asyncio.to_thread(save_artifact, user_id, run_id, stage, content, status="draft", source_artifact_ids=source_ids)
    await emit_agent_event(user_id, run_id, "artifact.advanced", {"artifact_id": artifact["id"], "type": stage, "version": artifact["version"], "source_artifact_ids": source_ids})
    return {"artifact": artifact, "required_sources": stage_sources(stage)}

@router.post("/api/canvas-agent/runs/{run_id}/artifacts/{artifact_id}/status")
async def update_agent_artifact_status(run_id: str, artifact_id: str, payload: CanvasArtifactStatusRequest, request: Request, x_user_id: str = Header(default="")):
    user_id = _user(request, x_user_id); await _require_run(user_id, run_id)
    if payload.status not in {"approved", "rejected", "stale", "draft"}: raise HTTPException(status_code=422, detail="无效的 Artifact 状态")
    artifact = await asyncio.to_thread(set_artifact_status, user_id, run_id, artifact_id, payload.status, actor=user_id, rejection_note=payload.note)
    if not artifact: raise HTTPException(status_code=404, detail="Artifact 不存在")
    await emit_agent_event(user_id, run_id, "artifact.status_changed", {"artifact_id": artifact_id, "status": payload.status, "version": artifact["version"]})
    return {"artifact": artifact}

@router.post("/api/canvas-agent/runs/{run_id}/prompt-compile")
async def compile_agent_prompt(run_id: str, payload: CanvasPromptCompileRequest, request: Request, x_user_id: str = Header(default="")):
    user_id = _user(request, x_user_id); await _require_run(user_id, run_id)
    anchors = {}
    if payload.anchor_artifact_id:
        artifact = await asyncio.to_thread(get_artifact, user_id, run_id, payload.anchor_artifact_id)
        if not artifact: raise HTTPException(status_code=404, detail="Anchor Artifact 不存在")
        if artifact.get("stale"): raise HTTPException(status_code=409, detail="Anchor Artifact 已过期，请先重新批准")
        anchors = artifact.get("content_json") or {}
    return {"compiled": compile_prompt(shot=payload.shot, anchors=anchors)}

@router.post("/api/canvas-agent/runs/{run_id}/prompt-pack/compile")
async def compile_agent_prompt_pack(run_id: str, payload: CanvasPromptPackCompileRequest, request: Request, x_user_id: str = Header(default="")):
    user_id = _user(request, x_user_id); await _require_run(user_id, run_id)
    shot_list = await asyncio.to_thread(get_artifact, user_id, run_id, payload.shot_list_artifact_id)
    anchors = await asyncio.to_thread(get_artifact, user_id, run_id, payload.anchor_artifact_id)
    if not shot_list or not anchors: raise HTTPException(status_code=404, detail="Shot List 或 Anchor Artifact 不存在")
    if shot_list.get("stale") or anchors.get("stale") or shot_list.get("status") != "approved" or anchors.get("status") != "approved": raise HTTPException(status_code=409, detail="Shot List 与 Anchor 必须已批准且未过期")
    shots = (shot_list.get("content_json") or {}).get("shots") or []
    prompts = [compile_prompt(shot=shot, anchors=anchors.get("content_json") or {}) for shot in shots if isinstance(shot, dict)]
    artifact = await asyncio.to_thread(save_artifact, user_id, run_id, "prompt_pack", {"prompts": prompts}, status="draft", source_artifact_ids=[shot_list["id"], anchors["id"]])
    await emit_agent_event(user_id, run_id, "prompt_pack.compiled", {"artifact_id": artifact["id"], "version": artifact["version"], "prompt_count": len(prompts)})
    return {"artifact": artifact}

@router.post("/api/canvas-agent/runs/{run_id}/prompt-pack/{artifact_id}/generate")
async def generate_from_prompt_pack(run_id: str, artifact_id: str, payload: CanvasPromptPackGenerateRequest, request: Request, x_user_id: str = Header(default="")):
    user_id = _user(request, x_user_id); run = await _require_run(user_id, run_id)
    pack = await asyncio.to_thread(get_artifact, user_id, run_id, artifact_id)
    if not pack: raise HTTPException(status_code=404, detail="Prompt Pack 不存在")
    if pack.get("stale") or pack.get("status") != "approved": raise HTTPException(status_code=409, detail="Prompt Pack 必须已批准且未过期")
    prompts = (pack.get("content_json") or {}).get("prompts") or []
    requested_ids = list(payload.node_ids)
    prompt_map = {str(item.get("shot_id") or ""): str(item.get("prompt") or "") for item in prompts if isinstance(item, dict)}
    if requested_ids and len(requested_ids) != len(prompts): raise HTTPException(status_code=422, detail="节点数量必须与 Prompt Pack 数量一致")
    if not requested_ids: raise HTTPException(status_code=422, detail="生成 Prompt Pack 必须提供目标画布节点")
    node_ids = requested_ids
    requests = [{"op": "run_node", "node_id": node_id} for node_id in node_ids]
    prompts_by_node = {node_id: prompt for node_id, prompt in zip(node_ids, [item.get("prompt", "") for item in prompts])}
    tasks = await submit_run_requests(user_id, run["canvas_id"], run_id, requests, prompt="", prompts_by_node=prompts_by_node)
    await asyncio.to_thread(update_run, user_id, run_id, status="running", phase="running", metadata_json={"task_ids": [task["task_id"] for task in tasks], "prompt_pack_id": artifact_id})
    await emit_agent_event(user_id, run_id, "prompt_pack.tasks_queued", {"artifact_id": artifact_id, "tasks": tasks})
    return {"tasks": tasks}

@router.get("/api/canvas-agent/skills")
async def list_agent_skills():
    return {"skills": [summary.__dict__ for summary in list_enabled_skill_summaries()]}

@router.get("/api/canvas-agent/skills/{name}")
async def read_agent_skill(name: str):
    if not get_enabled_skill(name): raise HTTPException(status_code=404, detail="Skill 不存在或未启用")
    return {"name": name, "content": read_skill(name)}

@router.post("/api/canvas-agent/runs/{run_id}/cost-estimate")
async def estimate_agent_run_cost(run_id: str, payload: CanvasCostEstimateRequest, request: Request, x_user_id: str = Header(default="")):
    user_id = _user(request, x_user_id); await _require_run(user_id, run_id)
    plan = await asyncio.to_thread(latest_plan, user_id, run_id)
    if not plan: raise HTTPException(status_code=404, detail="尚无可估算成本的计划")
    return {"estimate": estimate_plan_cost(plan["content_json"], budget=payload.budget)}

@router.post("/api/canvas-agent/runs/{run_id}/orchestrate")
async def orchestrate_agent_run(run_id: str, payload: CanvasOrchestrationRequest, request: Request, x_user_id: str = Header(default="")):
    user_id = _user(request, x_user_id); await _require_run(user_id, run_id)
    try: orchestration = build_specialist_plan(payload.goal, roles=payload.roles)
    except ValueError as exc: raise HTTPException(status_code=422, detail=str(exc)) from exc
    await emit_agent_event(user_id, run_id, "orchestration.proposed", orchestration)
    return {"orchestration": orchestration, "budget": payload.budget}

@router.post("/api/canvas-agent/runs/{run_id}/artifacts/{artifact_id}/quality")
async def evaluate_agent_artifact_quality(run_id: str, artifact_id: str, request: Request, x_user_id: str = Header(default="")):
    user_id = _user(request, x_user_id); await _require_run(user_id, run_id)
    artifact = await asyncio.to_thread(get_artifact, user_id, run_id, artifact_id)
    if not artifact: raise HTTPException(status_code=404, detail="Artifact 不存在")
    metrics = evaluate_artifact_quality(artifact)
    evaluation_id = await asyncio.to_thread(record_evaluation, metrics, run_id=run_id)
    await emit_agent_event(user_id, run_id, "artifact.quality_evaluated", {"artifact_id": artifact_id, "evaluation_id": evaluation_id, "score": metrics["score"]})
    return {"evaluation_id": evaluation_id, "metrics": metrics}

@router.get("/api/canvas-agent/templates")
async def get_agent_templates(request: Request, x_user_id: str = Header(default="")):
    return {"templates": await asyncio.to_thread(list_templates, _user(request, x_user_id))}

@router.post("/api/canvas-agent/templates")
async def create_agent_template(payload: CanvasTemplateCreateRequest, request: Request, x_user_id: str = Header(default="")):
    user_id = _user(request, x_user_id)
    if payload.source_run_id: await _require_run(user_id, payload.source_run_id)
    template = await asyncio.to_thread(create_template, user_id, payload.name, payload.content, description=payload.description, source_run_id=payload.source_run_id)
    return {"template": template}

@router.post("/api/canvas-agent/templates/{template_id}/instantiate")
async def instantiate_agent_template(template_id: str, payload: CanvasTemplateInstantiateRequest, request: Request, x_user_id: str = Header(default="")):
    user_id = _user(request, x_user_id); await _require_run(user_id, payload.run_id)
    template = await asyncio.to_thread(get_template, user_id, template_id)
    if not template: raise HTTPException(status_code=404, detail="模板不存在")
    await emit_agent_event(user_id, payload.run_id, "template.instantiated", {"template_id": template_id, "version": template["version"]})
    return {"template": template, "content": template["content_json"]}

@router.get("/api/canvas-agent/project-assets")
async def get_agent_project_assets(project_id: str, request: Request, x_user_id: str = Header(default="")):
    if not project_id: raise HTTPException(status_code=422, detail="project_id 必填")
    return {"assets": await asyncio.to_thread(list_project_assets, _user(request, x_user_id), project_id)}

@router.post("/api/canvas-agent/project-assets")
async def share_agent_project_asset(payload: CanvasProjectAssetShareRequest, request: Request, x_user_id: str = Header(default="")):
    user_id = _user(request, x_user_id); await _require_run(user_id, payload.run_id)
    try: asset = await asyncio.to_thread(share_project_asset, user_id, payload.run_id, payload.artifact_id, payload.project_id, asset_type=payload.asset_type)
    except PermissionError as exc: raise HTTPException(status_code=404, detail=str(exc)) from exc
    await emit_agent_event(user_id, payload.run_id, "project_asset.shared", {"asset_id": asset["id"], "project_id": payload.project_id, "artifact_id": payload.artifact_id})
    return {"asset": asset}
