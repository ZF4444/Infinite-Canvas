from __future__ import annotations
from copy import deepcopy
from typing import Any
from app.models.canvas_agent import CanvasPatch, SemanticPlan, semantic_prompt

_NODE_TYPES = {
    "prompt": "smart-prompt", "smart-prompt": "smart-prompt",
    "image_generation": "smart-image", "video_generation": "smart-image", "workflow_generation": "smart-image",
    "smart-image": "smart-image", "group": "smart-group", "smart-group": "smart-group",
}
_GENERATION_DEFAULTS = {
    "image_generation": {"genKind": "image", "runSettings": {"engine": "api", "apiKind": "image"}},
    "video_generation": {"genKind": "video", "runSettings": {"engine": "api", "apiKind": "video"}},
    "workflow_generation": {"genKind": "workflow", "runSettings": {"engine": "comfy", "comfyWorkflow": "", "comfyParams": {}}},
    "smart-image": {"genKind": "image", "runSettings": {"engine": "api", "apiKind": "image"}},
}

_LAYOUT_COLUMN_GAP = 360.0
_LAYOUT_ROW_GAP = 260.0
_LAYOUT_NODE_WIDTH = 316.0
_LAYOUT_NODE_HEIGHT = 194.0
_LAYOUT_MARGIN = 24.0


def _deep_merge(base: dict[str, Any], override: dict[str, Any]) -> dict[str, Any]:
    """Merge model-provided node data without dropping nested defaults."""
    result = deepcopy(base)
    for key, value in override.items():
        if isinstance(result.get(key), dict) and isinstance(value, dict):
            result[key] = _deep_merge(result[key], value)
        else:
            result[key] = deepcopy(value)
    return result


def _canonical_node_data(node: Any, node_type: str) -> dict[str, Any]:
    params = dict(node.params or {})
    defaults = _GENERATION_DEFAULTS.get(node.semantic_type, {})
    node_data = _deep_merge(defaults, params)

    # Keep generation settings under the same runSettings object as manually
    # created nodes. Accept flat settings only when reading older plans.
    if node_type == "smart-image":
        run_settings = dict(node_data.get("runSettings") or {})
        setting_keys = {
            "engine", "apiKind", "connection_id", "model_id", "resource_id", "model", "ratio",
            "resolution", "quality", "count", "duration", "fps", "aspect_ratio",
            "size", "seed", "comfyWorkflow", "comfyParams", "runninghubWorkflow",
            "workflow_id", "workflowId",
        }
        for key in list(node_data):
            if key in setting_keys:
                run_settings[key] = node_data.pop(key)
        node_data["runSettings"] = run_settings

    node_data.update({
        "type": node_type,
        "title": node.title,
        "text": semantic_prompt(params),
        "capability": node.capability,
    })
    return node_data


def _number(value: Any, default: float) -> float:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return default
    return number if number == number and number not in {float("inf"), float("-inf")} else default


def _placement(value: Any, fallback: dict[str, float]) -> dict[str, float]:
    raw = value if isinstance(value, dict) else {}
    return {
        "x": _number(raw.get("x"), fallback["x"]),
        "y": _number(raw.get("y"), fallback["y"]),
    }


def _node_bounds(node: dict[str, Any]) -> tuple[float, float, float, float]:
    x = _number(node.get("x"), 0)
    y = _number(node.get("y"), 0)
    width = max(1.0, _number(node.get("w"), _LAYOUT_NODE_WIDTH))
    height = max(1.0, _number(node.get("h"), _LAYOUT_NODE_HEIGHT))
    return x, y, width, height


def _placement_is_free(candidate: dict[str, float], occupied: list[dict[str, Any]]) -> bool:
    x, y = candidate["x"], candidate["y"]
    for node in occupied:
        node_x, node_y, width, height = _node_bounds(node)
        if (
            x < node_x + width + _LAYOUT_MARGIN
            and x + _LAYOUT_NODE_WIDTH + _LAYOUT_MARGIN > node_x
            and y < node_y + height + _LAYOUT_MARGIN
            and y + _LAYOUT_NODE_HEIGHT + _LAYOUT_MARGIN > node_y
        ):
            return False
    return True


def _resolve_placement(requested: Any, fallback: dict[str, float], occupied: list[dict[str, Any]]) -> dict[str, float]:
    candidate = _placement(requested, fallback)
    if _placement_is_free(candidate, occupied):
        return candidate

    # The LLM may reuse coordinates from an earlier run. Start from the
    # deterministic auto-layout location, then scan grid cells until free.
    for row in range(100):
        for column in range(3):
            candidate = {
                "x": fallback["x"] + column * _LAYOUT_COLUMN_GAP,
                "y": fallback["y"] + row * _LAYOUT_ROW_GAP,
            }
            if _placement_is_free(candidate, occupied):
                return candidate
    raise ValueError("unable to place agent-created node without overlap")

def semantic_plan_to_patch(plan: SemanticPlan, canvas_id: str, base_version: int, canvas: dict[str, Any] | None = None) -> CanvasPatch:
    refs: dict[str, str] = {}
    operations: list[dict[str, Any]] = []
    existing = list((canvas or {}).get("nodes") or [])
    next_x = max([float(node.get("x", 0) or 0) for node in existing if isinstance(node, dict)] or [0]) + 360
    next_y = max([float(node.get("y", 0) or 0) for node in existing if isinstance(node, dict)] or [0])
    occupied = [dict(node) for node in existing if isinstance(node, dict)]
    create_index = 0
    for step in plan.steps:
        if step.action == "canvas.create_node":
            node = step.node
            if node is None:
                raise ValueError(f"create_node step {step.id} requires node")
            node_type = _NODE_TYPES.get(node.semantic_type)
            if node_type is None:
                raise ValueError(f"unsupported semantic node type: {node.semantic_type}")
            refs[step.id] = step.id
            # Defaults mirror the manual creation path, while params may supply
            # a selected workflow/model. Merge nested runSettings so the model
            # cannot accidentally erase engine/apiKind or workflow defaults.
            node_data = _canonical_node_data(node, node_type)
            fallback = {
                "x": next_x + (create_index % 3) * _LAYOUT_COLUMN_GAP,
                "y": next_y + (create_index // 3) * _LAYOUT_ROW_GAP,
            }
            placement = _resolve_placement(step.placement, fallback, occupied)
            occupied.append({**node_data, **placement})
            operations.append({"op": "add_node", "client_ref": step.id, "placement": placement, "node": node_data})
            create_index += 1
        elif step.action in {"canvas.update_node_params", "canvas.replace_node_content", "canvas.run_node", "canvas.run_group"}:
            operations.append({"op": step.action.removeprefix("canvas."), "node_id": step.target_node_id, "params": (step.node.params if step.node else {}), "content": (semantic_prompt(step.node.params) if step.node else "")})
        elif step.action == "canvas.connect":
            operations.append({"op": "add_connection", "from_ref": refs.get(step.from_step, step.from_step), "to_ref": refs.get(step.to_step, step.to_step), "connection": {"kind": step.relation or "default"}})
    return CanvasPatch(canvas_id=canvas_id, base_version=base_version, operations=operations)
