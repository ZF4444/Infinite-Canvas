"""Bounded canvas projection supplied to the planner."""
from __future__ import annotations

from typing import Any

from app.services.business_metadata import load_canvas_payload

_MAX_NODES = 50
_MAX_CONNECTIONS = 200


def _connection_endpoints(connection: dict[str, Any]) -> tuple[str, str]:
    """Resolve a connection's source/target ids using the executor's key aliases."""
    source = str(connection.get("from") or connection.get("from_node") or connection.get("source") or "")
    target = str(connection.get("to") or connection.get("to_node") or connection.get("target") or "")
    return source, target


def build_canvas_context(
    user_id: str,
    canvas_id: str,
    *,
    selected_node_ids: list[str] = (),
    mention_node_ids: list[str] = (),
    run_node_ids: list[str] = (),
    media_references: list[dict[str, Any]] = (),
) -> dict[str, Any]:
    """Build a bounded canvas projection for the planner.

    Loads the canvas owned by *user_id*, filters nodes to those explicitly
    selected/mentioned/targeted (or all nodes when none are specified), and
    resolves *media_references* to concrete image URLs from canvas node outputs
    or the asset library.

    Args:
        user_id: Authenticated owner; raises ``PermissionError`` if the canvas
            does not belong to this user.
        canvas_id: Target canvas identifier.
        selected_node_ids: Nodes highlighted by the user in the UI.
        mention_node_ids: Nodes referenced via ``@mention`` in the message.
        run_node_ids: Nodes targeted for execution by the caller.
        media_references: Raw reference descriptors from the client; each entry
            is resolved to a ``{"node_id", "image_index", "url", ...}`` dict.
            Entries with ``source == "asset"`` are passed through directly.
            Entries whose node or image cannot be resolved are silently dropped.

    Returns:
        A dict with keys:
        - ``canvas_id``: echoed back for traceability.
        - ``canvas_version``: current canvas version number.
        - ``selected_nodes``: up to 50 filtered node dicts.
        - ``selected_nodes_truncated``: whether the node list was capped at 50.
        - ``node_count``: total node count before filtering.
        - ``connections``: up to 200 connection dicts. When any nodes are
          selected/mentioned/targeted, only edges touching that subgraph are
          included; otherwise all canvas connections are returned.
        - ``connection_count``: number of scoped connections before the 200 cap.
        - ``connections_truncated``: whether the connection list was capped at 200.
        - ``media_references``: resolved reference list.

    Raises:
        PermissionError: Canvas not found or not owned by *user_id*.
    """
    canvas = load_canvas_payload(user_id, canvas_id)
    if canvas is None: raise PermissionError("canvas not found or not owned by user")
    nodes = [node for node in canvas.get("nodes", []) if isinstance(node, dict)]
    wanted = set(selected_node_ids) | set(mention_node_ids) | set(run_node_ids)
    selected = [node for node in nodes if not wanted or str(node.get("id")) in wanted]
    all_connections = [conn for conn in (canvas.get("connections") or []) if isinstance(conn, dict)]
    if wanted:
        # Keep only edges touching the focused subgraph so unrelated canvas
        # wiring does not leak into the planner as noise.
        scoped_connections = [conn for conn in all_connections if wanted & set(_connection_endpoints(conn))]
    else:
        scoped_connections = all_connections
    by_id = {str(node.get("id")): node for node in nodes}
    references = []
    for raw in media_references or []:
        if not isinstance(raw, dict):
            continue
        node_id = str(raw.get("node_id") or raw.get("nodeId") or "")
        source = str(raw.get("source") or "canvas")
        if source == "asset":
            url = str(raw.get("url") or "").strip()
            if url:
                references.append({"node_id": "", "image_index": 0, "url": url, "label": f"图{len(references) + 1}", "node_label": str(raw.get("name") or "资产库素材"), "source": "asset"})
            continue
        try:
            image_index = int(raw.get("image_index", raw.get("imageIndex", 0)))
        except (TypeError, ValueError):
            continue
        node = by_id.get(node_id)
        if bool(raw.get("empty")) and node:
            references.append({"node_id": node_id, "image_index": -1, "url": "", "label": f"图{len(references) + 1}", "node_label": str(node.get("title") or node.get("name") or node_id), "source": "canvas", "empty": True})
            continue
        images = node.get("images") if node else None
        if not isinstance(images, list) or image_index < 0 or image_index >= len(images):
            continue
        image = images[image_index]
        if not isinstance(image, dict):
            continue
        url = str(image.get("url") or image.get("preview_url") or image.get("previewUrl") or "").strip()
        if not url:
            continue
        references.append({"node_id": node_id, "image_index": image_index, "url": url, "label": f"图{len(references) + 1}", "node_label": str(node.get("title") or node.get("name") or node_id), "source": "canvas"})
    return {"canvas_id": canvas_id, "canvas_version": int(canvas.get("version") or 1),
            "selected_nodes": selected[:_MAX_NODES], "selected_nodes_truncated": len(selected) > _MAX_NODES,
            "node_count": len(nodes),
            "connections": scoped_connections[:_MAX_CONNECTIONS], "connection_count": len(scoped_connections),
            "connections_truncated": len(scoped_connections) > _MAX_CONNECTIONS,
            "media_references": references}
