"""Canonical capability registry for Canvas Agent."""
from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from app.ai.database_repository import DatabaseAIRepository
from app.services.business_metadata import list_comfy_workflows


@dataclass(frozen=True)
class Capability:
    name: str
    description: str = ""
    cost_level: str = "unknown"
    enabled: bool = True
    connection_id: str = ""
    model_id: str = ""
    resource_id: str = ""
    connection_name: str = ""
    model_name: str = ""


class CapabilityRegistry:
    def __init__(self, items: list[Capability] | None = None):
        self._items: dict[str, Capability] = {}
        self._candidates: dict[str, list[Capability]] = {}
        for item in items or []:
            self.register(item)

    def register(self, capability: Capability) -> None:
        self._items.setdefault(capability.name, capability)
        self._candidates.setdefault(capability.name, []).append(capability)

    def get(self, name: str) -> Capability | None:
        return self._items.get(name)

    def resolve(self, name: str, *, requested_model_id: str = "", requested_model: str = "") -> Capability | None:
        for candidate in self._candidates.get(name, []):
            if requested_model_id and candidate.model_id != requested_model_id:
                continue
            if requested_model and candidate.model_name != requested_model:
                continue
            return candidate
        return None

    def list(self) -> list[Capability]:
        return [item for values in self._candidates.values() for item in values]

    def as_dict(self) -> list[dict[str, Any]]:
        """Model-facing capability list.

        Capabilities such as ``runninghub.app.image`` are a broad class shared
        by many concrete targets. Emitting one row per target floods the model
        with identical ``name`` values and invites it to omit the identifiers
        that actually pin a target. Instead, group by capability name and hang
        the distinguishing identifiers off a ``targets`` list, so the model
        picks a capability and then one explicit target.
        """
        grouped: dict[str, dict[str, Any]] = {}
        for item in self.list():
            entry = grouped.setdefault(item.name, {
                "name": item.name,
                "description": item.description,
                "cost_level": item.cost_level,
                "targets": [],
            })
            if item.description and not entry["description"]:
                entry["description"] = item.description
            entry["targets"].append({
                "connection_id": item.connection_id,
                "model_id": item.model_id,
                "resource_id": item.resource_id,
                "display_name": f"{item.connection_name} / {item.model_name or item.resource_id}",
                "enabled": item.enabled,
            })
        return list(grouped.values())


def from_repository(repository: DatabaseAIRepository | None = None) -> CapabilityRegistry:
    repository = repository or DatabaseAIRepository()
    connections = {item.id: item for item in repository.connections()}
    registry = CapabilityRegistry()
    for model in repository.models():
        connection = connections.get(model.connection_id)
        if connection is None:
            continue
        # chat 模型不注册为能力，返回 None 后跳过
        capability_name = {"image": "image.text_to_image", "video": "video.text_to_video"}.get(model.kind)
        if capability_name:
            registry.register(Capability(
                capability_name,
                "",
                {"image": "medium", "video": "high"}[model.kind],
                model.enabled and connection.enabled,
                connection.id, model.id, "", connection.name, model.alias or model.upstream_model,
            ))
    for resource in repository.executable_resources():
        connection = connections.get(resource.connection_id)
        if connection is None:
            continue
        settings = dict(resource.settings or {})
        if resource.kind == "runninghub_app":
            media = "video" if settings.get("media") == "video" else "image"
            name = str(settings.get("capability") or settings.get("type") or f"runninghub.app.{media}")
        else:
            media = "video" if settings.get("media") == "video" else "image"
            name = str(settings.get("capability") or f"comfyui.workflow.{media}")
        description = str(settings.get("note") or "")
        registry.register(Capability(name, description, "high", resource.enabled and connection.enabled, connection.id, "", resource.id, connection.name, resource.name))
    # local workflows have no connection; resolver uses workflow_name as the model key
    for workflow in list_comfy_workflows():
        media = "video" if workflow.get("media") == "video" else "image"
        description = str(workflow.get("note") or "")
        registry.register(Capability(f"comfyui.workflow.{media}", description, "high", workflow.get("enabled", True) is not False, "", "", workflow["name"], "本地 ComfyUI", workflow.get("title") or workflow["name"]))
    return registry
