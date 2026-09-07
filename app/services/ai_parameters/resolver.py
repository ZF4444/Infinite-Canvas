"""Backend-owned Provider/model parameter schemas and field resolution."""
from __future__ import annotations

from copy import deepcopy
from typing import Any


IMAGE_RATIO_OPTIONS = [
    "1:1", "2:3", "3:2", "3:4", "4:3", "9:16", "16:9", "21:9", "9:21", "source", "custom",
]
def _field(*, field_id: str, name: str, field_type: str, default: Any = "", options: list[Any] | None = None,
           minimum: float | None = None, maximum: float | None = None, step: float | None = None,
           target: str = "", transform: str = "", supported: bool = True,
           configurable: bool = True) -> dict[str, Any]:
    result: dict[str, Any] = {"id": field_id, "name": name, "type": field_type, "default": default}
    if options is not None:
        result["options"] = options
    if minimum is not None:
        result["min"] = minimum
    if maximum is not None:
        result["max"] = maximum
    if step is not None:
        result["step"] = step
    result["execution"] = {"supported": supported, "target": target, "transform": transform}
    result["ui"] = {"configurable": configurable}
    return result


# System defaults are the fallback for ordinary API Providers. Workflow
# Providers (ComfyUI and RunningHub) resolve their native field contracts.
DEFAULT_API_PARAMETER_SCHEMAS: dict[str, dict[str, Any]] = {
    "image": {"fields": [
        _field(field_id="provider_id", name="Provider", field_type="dropdown", default="", options=[], target="provider_id", transform="selection", configurable=False),
        _field(field_id="model", name="Model", field_type="dropdown", default="", options=[], target="model", transform="selection", configurable=False),
        _field(field_id="resolution", name="Resolution", field_type="dropdown", default="1k", options=["1k", "2k", "4k", "custom"], target="size", transform="image_size"),
        _field(field_id="ratio", name="Aspect ratio", field_type="dropdown", default="1:1", options=IMAGE_RATIO_OPTIONS, target="size", transform="image_size"),
        _field(field_id="customSize", name="Custom size", field_type="text", default="", target="size", transform="image_size", configurable=False),
        _field(field_id="customRatio", name="Custom ratio", field_type="text", default="", target="size", transform="image_size", configurable=False),
        _field(field_id="ratioMatched", name="Matched aspect ratio", field_type="dropdown", default="1:1", options=IMAGE_RATIO_OPTIONS, target="size", transform="image_size", configurable=False),
        _field(field_id="quality", name="Quality", field_type="dropdown", default="auto", options=["auto", "low", "medium", "high"], target="quality", transform="quality"),
        _field(field_id="count", name="Count", field_type="number", default=1, minimum=1, maximum=4, step=1, target="n", transform="integer"),
    ]},
    "video": {"fields": [
        _field(field_id="videoProvider", name="Provider", field_type="dropdown", default="", options=[], target="provider_id", transform="selection", configurable=False),
        _field(field_id="videoModel", name="Model", field_type="dropdown", default="", options=[], target="model", transform="selection", configurable=False),
        _field(field_id="videoDuration", name="Duration", field_type="number", default=5, options=[5, 10, 15], minimum=1, maximum=60, step=1, target="duration", transform="integer"),
        _field(field_id="videoAspect", name="Aspect ratio", field_type="dropdown", default="16:9", options=["16:9", "4:3", "1:1", "3:4", "9:16", "21:9"], target="aspect_ratio", transform="passthrough"),
        _field(field_id="videoResolution", name="Resolution", field_type="dropdown", default="480p", options=["480p", "720p", "1080p"], target="resolution", transform="passthrough"),
        _field(field_id="videoGenerateAudio", name="Generate audio", field_type="boolean", default=False, target="generate_audio", transform="boolean"),
        _field(field_id="videoMultimodal", name="Multimodal input", field_type="boolean", default=True, target="multimodal", transform="boolean"),
        _field(field_id="videoUseFrameRoles", name="Use frame roles", field_type="boolean", default=False, target="frame_roles", transform="boolean"),
    ]},
}

_OVERRIDE_KEYS = {"id", "name", "default", "options", "option_labels", "min", "max", "step"}


def _system_fields(kind: str) -> dict[str, dict[str, Any]]:
    return {str(field["id"]): field for field in DEFAULT_API_PARAMETER_SCHEMAS[kind]["fields"]}


def _validate_override(field: dict[str, Any], kind: str, label: str) -> dict[str, Any]:
    field_id = str(field.get("id") or "").strip()
    system = _system_fields(kind).get(field_id)
    if system is None:
        raise ValueError(f"parameter_schema.{label}.{field_id} is not supported by the backend")
    raw = deepcopy(field)
    legacy_type = raw.pop("type", None)
    if legacy_type is not None and legacy_type != system["type"]:
        raise ValueError(f"parameter_schema.{label}.{field_id}.type cannot change the system field type")
    legacy_label = raw.pop("label", None)
    if legacy_label is not None and "name" not in raw:
        raw["name"] = legacy_label
    unsupported = set(raw) - _OVERRIDE_KEYS
    if unsupported:
        raise ValueError(f"parameter_schema.{label}.{field_id} cannot override: {', '.join(sorted(unsupported))}")
    item = {key: deepcopy(value) for key, value in raw.items() if key in _OVERRIDE_KEYS}
    item["id"] = field_id
    if "options" in item:
        if not isinstance(item["options"], list):
            raise ValueError(f"parameter_schema.{label}.{field_id}.options must be an array")
        allowed = set(system.get("options") or [])
        if not allowed:
            raise ValueError(f"parameter_schema.{label}.{field_id} does not support options")
        if allowed and not set(item["options"]).issubset(allowed):
            raise ValueError(f"parameter_schema.{label}.{field_id}.options contains unsupported values")
    if "option_labels" in item:
        if not isinstance(item["option_labels"], list) or not all(isinstance(value, str) for value in item["option_labels"]):
            raise ValueError(f"parameter_schema.{label}.{field_id}.option_labels must be an array of strings")
        effective_options = item.get("options", system.get("options") or [])
        if not effective_options:
            raise ValueError(f"parameter_schema.{label}.{field_id}.option_labels requires options")
        if len(item["option_labels"]) != len(effective_options):
            raise ValueError(f"parameter_schema.{label}.{field_id}.option_labels must match options length")
    for key in ("min", "max", "step"):
        if key in item and not isinstance(item[key], (int, float)):
            raise ValueError(f"parameter_schema.{label}.{field_id}.{key} must be a number")
    if "default" in item:
        allowed = item.get("options", system.get("options") or [])
        if allowed and item["default"] not in allowed:
            raise ValueError(f"parameter_schema.{label}.{field_id}.default is not an allowed value")
        if system["type"] in {"number", "slider"} and not isinstance(item["default"], (int, float)):
            raise ValueError(f"parameter_schema.{label}.{field_id}.default must be a number")
        if system["type"] == "boolean" and not isinstance(item["default"], bool):
            raise ValueError(f"parameter_schema.{label}.{field_id}.default must be a boolean")
    lower, upper = item.get("min", system.get("min")), item.get("max", system.get("max"))
    if lower is not None and upper is not None and lower > upper:
        raise ValueError(f"parameter_schema.{label}.{field_id}.min cannot exceed max")
    return item


def normalize_parameter_schema(value: Any) -> dict[str, Any]:
    """Validate model-scoped ordinary-Provider parameter overrides."""
    if value in (None, ""):
        return {}
    if not isinstance(value, dict):
        raise ValueError("parameter_schema must be an object")

    def normalize_scope(scope: Any, label: str) -> dict[str, Any]:
        if scope in (None, ""):
            return {}
        if not isinstance(scope, dict):
            raise ValueError(f"parameter_schema.{label} must be an object")
        fields = scope.get("fields", [])
        if not isinstance(fields, list):
            raise ValueError(f"parameter_schema.{label}.fields must be an array")
        normalized = []
        for field in fields:
            if not isinstance(field, dict) or not str(field.get("id") or "").strip():
                raise ValueError(f"parameter_schema.{label}.fields items require id")
            normalized.append(_validate_override(field, label.rsplit(".", 1)[-1], label))
        return {"fields": normalized}

    models = value.get("models", {})
    if models not in ({}, None) and not isinstance(models, dict):
        raise ValueError("parameter_schema.models must be an object")
    model_schemas = {}
    for model, schema in (models or {}).items():
        model_name = str(model or "").strip()
        if not model_name or not isinstance(schema, dict):
            raise ValueError("parameter_schema.models entries must be objects keyed by model name")
        entry = {kind: normalize_scope(schema[kind], f"models.{model_name}.{kind}") for kind in ("image", "video") if kind in schema}
        if entry:
            model_schemas[model_name] = entry
    return {"models": model_schemas} if model_schemas else {}


def _merge_fields(base: list[dict[str, Any]], overrides: list[dict[str, Any]]) -> list[dict[str, Any]]:
    merged = [deepcopy(field) for field in base]
    positions = {str(field.get("id")): index for index, field in enumerate(merged)}
    for override in overrides:
        merged[positions[str(override["id"])]].update(deepcopy(override))
    return merged


def parameter_schema_definitions() -> dict[str, Any]:
    """Definitions editable in API settings, including execution metadata."""
    return deepcopy(DEFAULT_API_PARAMETER_SCHEMAS)


def _resolved_api_schema(kind: str, provider: dict[str, Any] | None, model: str) -> tuple[list[dict[str, Any]], list[str]]:
    fields = deepcopy(DEFAULT_API_PARAMETER_SCHEMAS[kind]["fields"])
    sources = ["system.default"]
    scope = (((provider or {}).get("parameter_schema") or {}).get("models") or {}).get(model, {}).get(kind, {})
    if isinstance(scope, dict) and scope.get("fields"):
        fields = _merge_fields(fields, scope["fields"])
        sources.append("provider.parameter_schema.models")
    return fields, sources


def _normalize_rh_field(field: dict[str, Any]) -> dict[str, Any]:
    raw_type = str(field.get("fieldType") or "").upper()
    options = next((field[key] for key in ("fieldData", "options", "list", "values", "enum", "choices", "items", "selectOptions", "dropdown") if isinstance(field.get(key), list)), None)
    field_type = "dropdown" if raw_type in {"LIST", "SELECT", "DROPDOWN", "COMBO", "ENUM"} else "slider" if raw_type == "SLIDER" else "number" if raw_type in {"NUMBER", "FLOAT", "INTEGER", "INT"} else "boolean" if raw_type in {"BOOLEAN", "BOOL"} else raw_type.lower() if raw_type in {"IMAGE", "VIDEO", "AUDIO"} else "text"
    # Role mirrors the canvas node's rhFieldKind() so clients can route prompt
    # text to the prompt box and treat image/video/audio fields as reference
    # inputs (fed by node connections) rather than editable parameters.
    role = ("image" if raw_type == "IMAGE" else "video" if raw_type == "VIDEO" else "audio" if raw_type == "AUDIO"
            else "prompt" if raw_type in {"PROMPT", "TEXTAREA"} else field_type)
    default = field.get("fieldValue")
    if isinstance(default, list):
        default = default[0] if default else ""
    return {"id": f"{field.get('nodeId') or ''}::{field.get('fieldName') or ''}", "nodeId": str(field.get("nodeId") or ""), "fieldName": str(field.get("fieldName") or ""), "name": str(field.get("label") or field.get("fieldName") or "Field"), "type": field_type, "role": role, "default": default if default is not None and not isinstance(default, dict) else "", "options": options or [], "min": field.get("min"), "max": field.get("max"), "step": field.get("step")}


def capability_parameters(*, capability: str, provider_id: str = "", model: str = "", connection_id: str = "", model_id: str = "", resource_id: str = "", provider_loader=None, workflow_loader=None) -> dict[str, Any]:
    """Return the field contract for a Provider model or native workflow."""
    stable_target = bool(connection_id or model_id or resource_id)
    if stable_target:
        from app.ai.database_repository import DatabaseAIRepository
        repo = DatabaseAIRepository()
        if resource_id:
            target = repo.resolve_executable(resource_id=resource_id)
            provider_id, connection_id, model = target.connection.id, target.connection.id, target.resource.id
            selected = {"id": target.connection.id, "name": target.connection.name, "protocol": target.connection.protocol, "enabled": target.connection.enabled, "rh_apps": [], "comfy_workflows": []}
            if target.resource.kind == "runninghub_app":
                selected["rh_apps"] = [{**target.resource.settings, "id": target.resource.id, "name": target.resource.name}]
            elif target.resource.kind == "comfyui_workflow":
                selected["comfy_workflows"] = [{**target.resource.settings, "name": target.resource.name}]
        else:
            target = repo.resolve_model(model_id=model_id, connection_id=connection_id, model=model)
            provider_id, connection_id, model = target.connection.id, target.connection.id, target.model.upstream_model
            model_schema = deepcopy(dict(target.model.settings).get("parameter_schema") or {})
            selected = {"id": target.connection.id, "name": target.connection.name, "protocol": target.connection.protocol, "enabled": target.connection.enabled, f"{target.model.kind}_models": [model], "model_aliases": {model: target.model.alias}, "parameter_schema": {"models": {model: model_schema}}}
        providers = [selected]
    else:
        # Provider-shaped input is retained solely for reading historical
        # canvas definitions. New runtime requests must provide a canonical
        # connection/model/resource identifier.
        if provider_loader is None:
            raise ValueError("capability parameters require connection_id, model_id, or resource_id")
        providers = [item for item in (provider_loader() or []) if isinstance(item, dict) and item.get("enabled", True)]
    selected = next((item for item in providers if item.get("id") == provider_id), None)
    if capability.startswith("comfyui.workflow."):
        if workflow_loader is None:
            from app.routers.workflows import get_workflow
            workflow_loader = get_workflow
        if not model:
            raise ValueError("ComfyUI workflow capability requires model/workflow")
        config = (workflow_loader(model).get("config") or {})
        return {"capability": capability, "connection_id": connection_id, "model_id": model_id, "resource_id": resource_id, "model": model, "params_path": "runSettings.comfyParams", "fields": list(config.get("fields") or []), "source": ["workflow.config.fields"]}
    if provider_id == "runninghub" or capability.startswith("runninghub."):
        provider = selected or next((item for item in providers if item.get("id") == "runninghub"), None)
        app = next((item for item in (provider or {}).get("rh_apps") or [] if model in {str(item.get("app_id") or ""), str(item.get("id") or ""), str(item.get("appId") or ""), str(item.get("webappId") or "")}), None)
        if app is None:
            raise ValueError("RunningHub application not found")
        return {"capability": capability, "connection_id": connection_id, "model_id": model_id, "resource_id": resource_id, "model": model, "params_path": "runSettings.rhParams", "fields": [_normalize_rh_field(field) for field in app.get("fields") or [] if isinstance(field, dict)], "source": ["runninghub.rh_apps.fields"]}
    if capability == "prompt.generate":
        return {"capability": capability, "connection_id": connection_id, "model_id": model_id, "resource_id": resource_id, "provider_id": provider_id, "model": model, "fields": [_field(field_id="llmProvider", name="Provider", field_type="dropdown", default=provider_id, options=[item.get("id") for item in providers if item.get("chat_models")]), _field(field_id="llmModel", name="Model", field_type="dropdown", default=model, options=list((selected or {}).get("chat_models") or [])), _field(field_id="llmInstruction", name="Instruction", field_type="textarea", default="")], "params_path": "node", "source": ["provider.chat_models"]}
    kind = "video" if capability == "video.text_to_video" else "image"
    fields, sources = _resolved_api_schema(kind, selected, model)
    provider_field = next(field for field in fields if field["id"] in {"provider_id", "videoProvider"})
    model_field = next(field for field in fields if field["id"] in {"model", "videoModel"})
    provider_field.update(default=provider_id, options=[item.get("id") for item in providers if item.get(f"{kind}_models")])
    models = list((selected or {}).get(f"{kind}_models") or [])
    aliases = (selected or {}).get("model_aliases") or {}
    model_field.update(default=model, options=models)
    if not model_field.get("option_labels"):
        model_field["option_labels"] = [str(aliases.get(item) or item) for item in models]
    return {"capability": capability, "connection_id": connection_id, "model_id": model_id, "resource_id": resource_id, "provider_id": provider_id, "model": model, "params_path": "runSettings", "fields": fields, "source": sources}


def validate_run_settings(*, kind: str, provider_id: str, model: str, settings: dict[str, Any], provider_loader=None, connection_id: str = "", model_id: str = "", resource_id: str = "") -> dict[str, Any]:
    """Validate declared ordinary-Provider settings and return canonical values."""
    schema = capability_parameters(capability="video.text_to_video" if kind == "video" else "image.text_to_image", provider_id=provider_id, model=model, connection_id=connection_id, model_id=model_id, resource_id=resource_id, provider_loader=provider_loader)
    values: dict[str, Any] = {}
    for field in schema["fields"]:
        field_id, value, field_type = str(field["id"]), settings.get(field["id"], field.get("default")), field.get("type")
        if field_type in {"number", "slider"}:
            try:
                value = float(value) if field.get("step") and float(field["step"]) < 1 else int(float(value))
            except (TypeError, ValueError) as exc:
                raise ValueError(f"{field_id} must be a number") from exc
            if (field.get("min") is not None and value < field["min"]) or (field.get("max") is not None and value > field["max"]):
                raise ValueError(f"{field_id} is outside the allowed range")
        elif field_type == "boolean":
            value = str(value).strip().lower() in {"1", "true", "yes", "on"} if isinstance(value, str) else bool(value)
        elif field_type == "dropdown":
            value, options = str(value or ""), field.get("options") or []
            if options and value not in options:
                raise ValueError(f"{field_id} is not an allowed value")
        values[field_id] = value
    return {"fields": schema["fields"], "values": values}
