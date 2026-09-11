"""File access routes backed by file_id."""

import os

from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse, Response

from app.core.media import content_type_for_path
from app.core.storage_io import run_storage_io
from app.services.storage import (
    ensure_media_derivatives,
    get_file_by_id,
    get_object_bytes,
    materialize_media_url,
    media_poster_object_key,
    media_thumb_object_key,
    object_exists,
)

router = APIRouter()
PREVIEW_CACHE_HEADERS = {"Cache-Control": "private, max-age=3600"}
THUMB_CACHE_HEADERS = {"Cache-Control": "private, max-age=31536000, immutable"}
THUMB_FALLBACK_CACHE_HEADERS = {"Cache-Control": "private, max-age=300"}


def _materialized_path_sync(file_id: str):
    entry = get_file_by_id(file_id)
    if not entry:
        return None
    path = materialize_media_url(entry.get("url") or "")
    if not path or not os.path.isfile(path):
        return None
    return entry, path


async def _materialized_path(file_id: str):
    result = await run_storage_io(_materialized_path_sync, file_id)
    if not result:
        raise HTTPException(status_code=404, detail="文件不存在")
    return result


def _video_placeholder_svg(label: str = "VIDEO") -> bytes:
    text = (label or "VIDEO")[:18]
    svg = f"""<svg xmlns="http://www.w3.org/2000/svg" width="256" height="192" viewBox="0 0 256 192">
<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#0f172a"/><stop offset="1" stop-color="#334155"/></linearGradient></defs>
<rect width="256" height="192" rx="18" fill="url(#g)"/>
<circle cx="128" cy="88" r="34" fill="rgba(255,255,255,0.12)"/>
<path d="M118 68 L154 88 L118 108 Z" fill="#fff"/>
<text x="128" y="154" text-anchor="middle" font-family="Arial,sans-serif" font-size="18" fill="#e2e8f0">{text}</text>
</svg>"""
    return svg.encode("utf-8")


@router.get("/api/files/{file_id}")
async def get_file_meta(file_id: str):
    entry = await run_storage_io(get_file_by_id, file_id)
    if not entry:
        raise HTTPException(status_code=404, detail="文件不存在")
    return {
        "file_id": entry.get("file_id"),
        "name": entry.get("original_name") or entry.get("filename") or "",
        "kind": entry.get("kind") or "",
        "mime_type": entry.get("content_type") or "application/octet-stream",
        "size": entry.get("size") or 0,
        "created_at": entry.get("created_at") or 0,
        "preview_url": entry.get("url") or "",
        "download_url": entry.get("download_url") or "",
    }


@router.get("/api/files/{file_id}/preview")
async def preview_file(file_id: str):
    _, path = await _materialized_path(file_id)
    return FileResponse(path, media_type=content_type_for_path(path), headers=PREVIEW_CACHE_HEADERS)


def _thumbnail_derivative_sync(entry, kind, bucket, object_key):
    derived_exists = object_exists(bucket, object_key)
    if not derived_exists:
        ensure_media_derivatives(entry)
        derived_exists = object_exists(bucket, object_key)
    if not derived_exists:
        return None
    return get_object_bytes(bucket, object_key)


@router.get("/api/files/{file_id}/thumb")
async def thumbnail_file(file_id: str):
    entry = await run_storage_io(get_file_by_id, file_id)
    if not entry:
        raise HTTPException(status_code=404, detail="文件不存在")
    kind = str(entry.get("kind") or "").strip().lower()
    bucket = str(entry.get("bucket") or "").strip()
    object_key = media_thumb_object_key(entry) if kind == "image" else media_poster_object_key(entry)
    try:
        if kind in {"image", "video"}:
            content = await run_storage_io(_thumbnail_derivative_sync, entry, kind, bucket, object_key)
            if content is not None:
                media_type = "image/webp" if kind == "image" else "image/jpeg"
                return Response(content=content, media_type=media_type, headers=THUMB_CACHE_HEADERS)
    except Exception:
        pass
    if kind == "video":
        return Response(
            content=_video_placeholder_svg(entry.get("original_name") or "VIDEO"),
            media_type="image/svg+xml",
            headers=THUMB_FALLBACK_CACHE_HEADERS,
        )
    _, path = await _materialized_path(file_id)
    return FileResponse(path, media_type=content_type_for_path(path), headers=THUMB_FALLBACK_CACHE_HEADERS)


@router.get("/api/files/{file_id}/download")
async def download_file(file_id: str):
    entry, path = await _materialized_path(file_id)
    filename = entry.get("original_name") or entry.get("filename") or os.path.basename(path)
    return FileResponse(path, media_type=content_type_for_path(path), filename=filename)
