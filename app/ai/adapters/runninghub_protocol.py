"""Pure RunningHub task protocol parsing helpers."""
from __future__ import annotations

import os
import urllib.parse
from collections.abc import Mapping
from typing import Any

from fastapi import HTTPException


def endpoint(base_url: str, path: str) -> str:
    root = str(base_url or "").rstrip("/")
    if not root:
        raise ValueError("RunningHub connection has no Base URL")
    return f"{root}{path}"


def authorization_headers(api_key: str, *, json_body: bool = True) -> dict[str, str]:
    token = str(api_key or "").strip()
    if token.lower().startswith("bearer "):
        token = token[7:].strip()
    headers = {"Accept": "application/json", "Authorization": f"Bearer {token}" if token else ""}
    if json_body:
        headers["Content-Type"] = "application/json"
    return headers


def extract_task_id(payload: Any) -> str:
    if not isinstance(payload, dict):
        return ""
    for key in ("taskId", "task_id"):
        if payload.get(key):
            return str(payload[key])
    return extract_task_id(payload.get("data"))


def extract_outputs(payload: Any) -> list[str]:
    found: list[str] = []
    seen: set[str] = set()
    keys = {"fileUrl", "file_url", "download_url", "imageUrl", "image_url", "videoUrl", "video_url", "audioUrl", "audio_url", "fileName"}

    def visit(value: Any, depth: int = 0) -> None:
        if depth > 10:
            return
        if isinstance(value, dict):
            for key, child in value.items():
                if key in keys:
                    for item in child if isinstance(child, list) else [child]:
                        text = str(item or "").strip()
                        if text and text not in seen:
                            seen.add(text)
                            found.append(text)
                elif key != "fieldValue":
                    visit(child, depth + 1)
        elif isinstance(value, list):
            for item in value:
                visit(item, depth + 1)

    visit(payload)
    return found


def output_ext(remote: str) -> str:
    return os.path.splitext(urllib.parse.urlsplit(str(remote or "")).path)[1].lstrip(".").lower()


def output_kind(ext: str) -> str:
    ext = str(ext or "").lower().lstrip(".")
    if ext in {"mp4", "mov", "webm", "mkv", "avi"}:
        return "video"
    if ext in {"mp3", "wav", "m4a", "aac", "ogg", "flac"}:
        return "audio"
    if ext in {"png", "jpg", "jpeg", "webp", "gif", "bmp", "avif"}:
        return "image"
    return "file"


def normalized_status(raw: Any, code: Any, urls: list[str]) -> str:
    data = raw.get("data") if isinstance(raw, dict) else {}
    # RunningHub sometimes includes a generic/terminal-looking status beside
    # the queue response. The queue codes/messages are authoritative: the
    # task was accepted and must continue polling rather than surface an
    # error to the canvas user.
    messages = " ".join(
        str(item.get(key) or "")
        for item in (raw, data)
        if isinstance(item, dict)
        for key in ("code", "msg", "message", "errorMessage", "failReason")
    ).upper()
    if code in (803, "803", 804, "804") or "APIKEY_TASK_IS_QUEUED" in messages or "APIKEY_TASK_IS_RUNNING" in messages:
        return "RUNNING"
    status = next((str(item.get("status") or "").upper() for item in (raw, data) if isinstance(item, dict) and item.get("status")), "")
    if status in {"SUCCESS", "SUCCEEDED", "COMPLETED"}:
        return "SUCCESS"
    if status in {"FAILED", "ERROR", "CANCELLED"}:
        return "FAILED"
    if urls:
        return "SUCCESS"
    return "RUNNING" if code in (0, "0", None, 803, "803", 804, "804") else "FAILED"


def fail_reason(raw: Any) -> str:
    if not isinstance(raw, dict):
        return "RunningHub 任务失败"
    data = raw.get("data") if isinstance(raw.get("data"), dict) else {}
    return str(data.get("errorMessage") or data.get("failReason") or raw.get("msg") or raw.get("errorMessage") or "RunningHub 任务失败")


def extract_image(raw: Any) -> dict[str, str]:
    item = next((item for item in extract_outputs(raw) if output_kind(output_ext(item)) == "image"), "")
    if not item:
        raise HTTPException(status_code=502, detail="RunningHub 未返回图片结果。")
    return {"type": "url", "value": item}


def find_app(resource_settings: Mapping[str, Any] | None, model: str) -> Mapping[str, Any] | None:
    """Find a configured RunningHub app by its stable/external identifier."""
    settings = resource_settings or {}
    apps = settings.get("rh_apps") if isinstance(settings, Mapping) else None
    key = str(model or "").strip()
    return next((entry for entry in apps or [] if isinstance(entry, Mapping) and str(entry.get("app_id") or "").strip() == key), None)
