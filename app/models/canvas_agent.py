"""Versioned, provider-neutral contracts for the Canvas Agent runtime."""
from __future__ import annotations

import json
from typing import Annotated, Any, Literal

from pydantic import BaseModel, BeforeValidator, ConfigDict, Field, WithJsonSchema, model_validator

SCHEMA_VERSION = 1


def semantic_prompt(params: dict[str, Any]) -> str:
    """Read the canonical prompt text from a node's params.

    The prompt is stored under ``runSettings.prompt`` for every engine so the
    canvas node ``text`` field, the top prompt box, and the plan schema share a
    single source of truth. RunningHub apps additionally expose the same text
    through a prompt-role field, but the canonical copy lives here.
    """
    run_settings = params.get("runSettings")
    if isinstance(run_settings, dict):
        value = run_settings.get("prompt")
        if isinstance(value, str):
            return value
    return ""


def with_semantic_prompt(params: dict[str, Any], prompt: str) -> dict[str, Any]:
    """Return params with ``runSettings.prompt`` set to ``prompt``."""
    updated = dict(params or {})
    run_settings = dict(updated.get("runSettings") or {})
    run_settings["prompt"] = prompt
    updated["runSettings"] = run_settings
    return updated


def _decode_json_object(value: Any) -> dict[str, Any]:
    """Accept provider-native JSON strings while retaining dicts in the domain model."""
    if isinstance(value, str):
        try:
            value = json.loads(value)
        except json.JSONDecodeError as exc:
            raise ValueError("must be a JSON object string") from exc
    if not isinstance(value, dict):
        raise ValueError("must be an object")
    return value


# Azure/OpenAI strict JSON Schema forbids arbitrary object properties. The
# provider therefore emits these extensible fields as JSON strings, which the
# validator converts back to dictionaries before they reach the executor.
NativeJsonObject = Annotated[
    dict[str, Any],
    BeforeValidator(_decode_json_object),
    WithJsonSchema({"type": "string", "description": "JSON-encoded object"}),
]


def _make_native_schema_strict(schema: Any) -> None:
    if isinstance(schema, dict):
        schema.pop("default", None)
        properties = schema.get("properties")
        if isinstance(properties, dict):
            schema["required"] = list(properties)
            schema["additionalProperties"] = False
            for property_schema in properties.values():
                _make_native_schema_strict(property_schema)
        for key, value in schema.items():
            if key != "properties":
                _make_native_schema_strict(value)
    elif isinstance(schema, list):
        for item in schema:
            _make_native_schema_strict(item)

class ProtocolModel(BaseModel):
    model_config = ConfigDict(extra="forbid")
    schema_version: int = Field(default=SCHEMA_VERSION, ge=1)

    @classmethod
    def model_json_schema(cls, *args: Any, **kwargs: Any) -> dict[str, Any]:
        schema = super().model_json_schema(*args, **kwargs)
        _make_native_schema_strict(schema)
        return schema

SemanticNodeType = Literal[
    "prompt", "image_generation", "video_generation", "workflow_generation", "group",
    "smart-prompt", "smart-image", "smart-group",
]


class SemanticNode(ProtocolModel):
    semantic_type: SemanticNodeType = Field(
        description="Canvas node kind. Prefer these canonical values: image_generation for image nodes, video_generation for video nodes, workflow_generation for ComfyUI workflow nodes, prompt for text/prompt nodes, group for a node group. The values smart-image, smart-prompt, and smart-group are accepted legacy aliases of image_generation, prompt, and group respectively; do not use them for new plans."
    )
    title: str = Field(default="", description="Short node title.")
    capability: str = Field(default="", description="Capability selected from read_capability_registry, for example image.text_to_image or prompt.generate. A capability can be a broad class (e.g. runninghub.app.image is shared by every RunningHub image app), so it does not by itself identify a specific app or model; set connection_id/resource_id/model_id to pin the exact target.")
    connection_id: str = Field(default="", description="Connection id copied verbatim from the chosen read_capability_registry entry. Required whenever you select a specific provider target.")
    resource_id: str = Field(default="", description="Resource id copied verbatim from the chosen read_capability_registry entry. Set this for executable resources such as a RunningHub app (runninghub.app.*) or a hosted ComfyUI workflow to pin the exact app/workflow. Leave empty for plain model capabilities.")
    model_id: str = Field(default="", description="Model id copied verbatim from the chosen read_capability_registry entry. Set this for plain model capabilities such as image.text_to_image or video.text_to_video. Leave empty for RunningHub apps and workflows, which are pinned by resource_id.")
    params: NativeJsonObject = Field(default_factory=dict, description="Capability-specific parameters as a JSON object. The prompt text lives under runSettings.prompt; other keys depend on the chosen capability, e.g. {\"runSettings\": {\"prompt\": \"a cat\", \"ratio\": \"16:9\"}}. Do not put connection_id/resource_id/model_id here; use the dedicated fields instead.")

    @model_validator(mode="before")
    @classmethod
    def _migrate_legacy_content(cls, data: Any) -> Any:
        """Fold the retired top-level ``content`` field into params.

        Historical plans stored the prompt as ``SemanticNode.content``. The
        field has been merged into ``params.runSettings.prompt``; migrate old
        payloads so ``extra="forbid"`` does not reject them on load.
        """
        if isinstance(data, str):
            try:
                data = json.loads(data)
            except json.JSONDecodeError:
                return data
        if isinstance(data, dict) and "content" in data:
            data = dict(data)
            content = data.pop("content")
            params = _decode_json_object(data.get("params")) if data.get("params") is not None else {}
            if isinstance(content, str) and content and not semantic_prompt(params):
                data["params"] = with_semantic_prompt(params, content)
        return data

class SemanticStep(ProtocolModel):
    id: str = Field(description="Unique step identifier within this plan, e.g. \"step_1\". Referenced by from_step/to_step in connect actions.")
    action: Literal["canvas.create_node", "canvas.update_node_params", "canvas.replace_node_content", "canvas.connect", "canvas.run_node", "canvas.run_group"] = Field(
        description="Canvas operation to perform. create_node adds a new node; update_node_params changes params on an existing node; "
        "replace_node_content replaces prompt text; connect links two nodes; run_node/run_group triggers execution."
    )
    node: SemanticNode | None = Field(default=None, description="Node definition. Required for create_node (uses semantic_type, title, capability, params). For update_node_params and replace_node_content only node.params is read; other fields are ignored, so set semantic_type to match the target node and put changes under params. Omit entirely for connect and run actions.")
    target_node_id: str = Field(default="", description="Real id of an existing canvas node for update_node_params, replace_node_content, and run_node actions, or an existing group id for run_group. Leave empty when creating a new node; connect actions use from_step/to_step instead.")
    from_step: str = Field(default="", description="Source endpoint of a connect action. Use a step id from this plan to reference a node created here, or an existing canvas node's real id (from read_canvas_context) to connect from a node already on the canvas. Must differ from to_step.")
    to_step: str = Field(default="", description="Target endpoint of a connect action. Use a step id from this plan to reference a node created here, or an existing canvas node's real id (from read_canvas_context) to connect to a node already on the canvas. Must differ from from_step.")
    relation: str = Field(default="", description="Edge label for a connect action, e.g. \"output\" or \"reference\".")
    placement: NativeJsonObject = Field(default_factory=dict, description="Canvas layout hint as a JSON object, e.g. {\"x\": 100, \"y\": 200}. Omit to let the canvas auto-place.")

class PlanExecution(ProtocolModel):
    auto_run: bool = Field(default=False, description="If true, execute all steps immediately after the plan is confirmed without further user interaction.")
    parallelism: int = Field(default=1, ge=1, le=16, description="Maximum number of steps to run concurrently. Use 1 for sequential execution; higher values speed up independent steps.")
    capabilities: list[str] = Field(default_factory=list, description="All capability identifiers required by this plan, e.g. [\"image.text_to_image\", \"prompt.generate\"]. Used for pre-flight checks.")
    estimated_cost: float = Field(default=0, ge=0, description="Estimated total execution cost in abstract credits. Set to 0 if unknown.")

class PlanConfirmation(ProtocolModel):
    required: bool = Field(default=True, description="Whether the user must explicitly approve this plan before execution. Set to false only for trivially safe, single-step actions.")
    reason: str = Field(default="", description="Human-readable explanation of why confirmation is required, shown to the user before they approve.")

class SemanticPlan(ProtocolModel):
    mode: Literal["fast_track", "doc_chain"] = Field(
        default="fast_track",
        description="Execution strategy. fast_track: execute steps directly with minimal LLM calls. doc_chain: use a document-grounded reasoning chain for complex multi-step plans."
    )
    goal: str = Field(min_length=1, description="One-sentence description of what this plan achieves, written from the user's perspective.")
    questions: list[str] = Field(default_factory=list, description="Clarifying questions to ask the user before executing, when the request is ambiguous. Leave empty if the goal is clear.")
    steps: list[SemanticStep] = Field(default_factory=list, description="Ordered list of canvas operations that together achieve the goal. Steps are executed in order unless parallelism > 1.")
    execution: PlanExecution = Field(default_factory=PlanExecution, description="Runtime execution settings for this plan.")
    confirmation: PlanConfirmation = Field(default_factory=PlanConfirmation, description="User confirmation gate before the plan runs.")


class IntentDecision(ProtocolModel):
    """First-stage routing result for a Canvas Agent message."""
    intent: Literal["canvas_action", "chat", "clarification"]
    reply: str = ""

class PatchOperation(ProtocolModel):
    op: Literal["add_node", "update_node_params", "replace_node_content", "add_connection", "remove_connection", "add_group", "move_node", "run_node", "run_group"]
    client_ref: str = ""
    node_id: str = ""
    node: dict[str, Any] = Field(default_factory=dict)
    params: dict[str, Any] = Field(default_factory=dict)
    content: str = ""
    from_ref: str = ""
    to_ref: str = ""
    connection: dict[str, Any] = Field(default_factory=dict)
    group: dict[str, Any] = Field(default_factory=dict)
    placement: dict[str, Any] = Field(default_factory=dict)

class CanvasPatch(ProtocolModel):
    canvas_id: str
    base_version: int = Field(ge=1)
    operations: list[PatchOperation] = Field(default_factory=list)

class AgentRun(ProtocolModel):
    id: str
    canvas_id: str
    conversation_id: str = ""
    mode: Literal["fast_track", "doc_chain"] = "fast_track"
    status: str = "created"
    phase: str = "planning"
    base_canvas_version: int = 1
    step_count: int = 0
    max_steps: int = 12

class AgentOperation(ProtocolModel):
    id: str
    run_id: str
    idempotency_key: str
    type: str
    risk: str = "safe"
    status: str = "pending"
    input: dict[str, Any] = Field(default_factory=dict)
    result: dict[str, Any] = Field(default_factory=dict)
    error: str | None = None

class Artifact(ProtocolModel):
    id: str
    run_id: str
    type: str
    version: int = 1
    status: str = "draft"
    content: dict[str, Any] = Field(default_factory=dict)
    source_artifact_ids: list[str] = Field(default_factory=list)

class AgentEvent(ProtocolModel):
    id: str
    run_id: str
    sequence: int
    type: str
    payload: dict[str, Any] = Field(default_factory=dict)
