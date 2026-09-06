"""Redis-backed state and leases for asynchronous canvas generation tasks."""

from __future__ import annotations

import json
import time
import uuid
from typing import Any

from redis.exceptions import RedisError

from app.config import (
    CANVAS_TASK_TIMEOUT_SECONDS,
    REDIS_CANVAS_TASK_LEASE_SECONDS,
    REDIS_CANVAS_TASK_PREFIX,
    REDIS_CANVAS_TASK_CONSUMER_GROUP,
    REDIS_CANVAS_TASK_DISPATCH_TTL_SECONDS,
    REDIS_CANVAS_TASK_PENDING_CLAIM_IDLE_MS,
    REDIS_CANVAS_TASK_STREAM,
    REDIS_CANVAS_TASK_STREAM_MAXLEN,
    REDIS_CANVAS_TASK_TTL_SECONDS,
)
from app.core.redis_client import RedisUnavailableError, get_redis_client
from app.core.log_context import get_log_context


_INDEX_KEY = f"{REDIS_CANVAS_TASK_PREFIX}active"
_DEAD_LETTER_STREAM = f"{REDIS_CANVAS_TASK_STREAM}:dead-letter"
_REFRESH_LEASE_SCRIPT = """
if redis.call('GET', KEYS[1]) == ARGV[1] then
  return redis.call('EXPIRE', KEYS[1], ARGV[2])
end
return 0
"""
_RELEASE_LEASE_SCRIPT = """
if redis.call('GET', KEYS[1]) == ARGV[1] then
  return redis.call('DEL', KEYS[1])
end
return 0
"""
_UPDATE_TASK_IF_STATUS_SCRIPT = """
-- TASK_UPDATE_IF_STATUS
local raw = redis.call('GET', KEYS[1])
if not raw then
  return false
end
local record = cjson.decode(raw)
if ARGV[1] ~= '' and record['status'] ~= ARGV[1] then
  return false
end
local changes = cjson.decode(ARGV[2])
for key, value in pairs(changes) do
  record[key] = value
end
record['updated_at'] = tonumber(ARGV[3])
record['version'] = tonumber(record['version'] or 0) + 1
local encoded = cjson.encode(record)
redis.call('SET', KEYS[1], encoded, 'EX', ARGV[4])
if record['status'] == 'queued' or record['status'] == 'running' then
  redis.call('ZADD', KEYS[2], tonumber(ARGV[3]) + tonumber(ARGV[4]), ARGV[5])
else
  redis.call('ZREM', KEYS[2], ARGV[5])
end
return encoded
"""
_UPDATE_CLAIMED_TASK_SCRIPT = """
-- TASK_UPDATE_IF_CLAIMED
if redis.call('GET', KEYS[2]) ~= ARGV[1] then
  return false
end
local raw = redis.call('GET', KEYS[1])
if not raw then
  return false
end
local record = cjson.decode(raw)
if record['cancellation_requested'] == true then
  return false
end
local changes = cjson.decode(ARGV[2])
for key, value in pairs(changes) do
  record[key] = value
end
record['updated_at'] = tonumber(ARGV[3])
record['version'] = tonumber(record['version'] or 0) + 1
local encoded = cjson.encode(record)
redis.call('SET', KEYS[1], encoded, 'EX', ARGV[4])
if record['status'] == 'queued' or record['status'] == 'running' then
  redis.call('ZADD', KEYS[3], tonumber(ARGV[3]) + tonumber(ARGV[4]), ARGV[5])
else
  redis.call('ZREM', KEYS[3], ARGV[5])
end
return encoded
"""


def _task_key(task_id: str) -> str:
    return f"{REDIS_CANVAS_TASK_PREFIX}{task_id}"


def _lease_key(task_id: str) -> str:
    return f"{REDIS_CANVAS_TASK_PREFIX}lease:{task_id}"


def _dispatch_key(task_id: str) -> str:
    return f"{REDIS_CANVAS_TASK_PREFIX}dispatch:{task_id}"


def _unavailable(operation: str, exc: BaseException) -> RedisUnavailableError:
    return RedisUnavailableError(f"Redis 画布任务存储不可用（{operation}）")


async def create_canvas_task(task: dict[str, Any]) -> dict[str, Any]:
    task_id = str(task["id"])
    now = time.time()
    record = {**task, "created_at": task.get("created_at", now), "updated_at": task.get("updated_at", now), "version": int(task.get("version") or 1)}
    # A durable task crosses request and worker boundaries. Preserve its
    # correlation fields here so downstream provider and storage logs retain
    # the request that submitted the generation.
    context = get_log_context()
    for key in ("request_id", "trace_id", "username", "run_id", "operation_id"):
        if context.get(key) and not record.get(key):
            record[key] = context[key]
    record.setdefault("run_id", record.get("agent_run_id") or None)
    record.setdefault("operation_id", task_id)
    # Stable IDs are the persistence contract.  Runtime adapters may still
    # need a provider/model name, but those values must never be written into
    # newly-created task requests once a canonical target is present.
    request = record.get("request")
    if isinstance(request, dict):
        has_stable_target = any(str(record.get(key) or request.get(key) or "").strip() for key in ("connection_id", "model_id", "resource_id"))
        has_legacy_target = any(str(record.get(key) or request.get(key) or "").strip() for key in ("provider_id", "provider", "model"))
        if has_legacy_target and not has_stable_target:
            raise ValueError("Canvas task requests must include connection_id, model_id, or resource_id")
    if isinstance(request, dict) and any(str(record.get(key) or request.get(key) or "").strip() for key in ("connection_id", "model_id", "resource_id")):
        request = dict(request)
        for key in ("provider_id", "provider", "model"):
            request.pop(key, None)
        for key in ("connection_id", "model_id", "resource_id"):
            value = record.get(key) or request.get(key)
            if value:
                request[key] = value
        record["request"] = request
    client = get_redis_client()
    try:
        pipeline = client.pipeline(transaction=False)
        pipeline.set(_task_key(task_id), json.dumps(record, separators=(",", ":")), ex=REDIS_CANVAS_TASK_TTL_SECONDS)
        pipeline.zadd(_INDEX_KEY, {task_id: now + REDIS_CANVAS_TASK_TTL_SECONDS})
        await pipeline.execute()
    except RedisError as exc:
        raise _unavailable("create", exc) from exc
    return record


async def get_canvas_task(task_id: str) -> dict[str, Any] | None:
    client = get_redis_client()
    try:
        raw = await client.get(_task_key(task_id))
    except RedisError as exc:
        raise _unavailable("read", exc) from exc
    if not raw:
        return None
    try:
        record = json.loads(raw)
    except (TypeError, ValueError):
        return None
    return record if isinstance(record, dict) else None


async def update_canvas_task(task_id: str, *, expected_status: str = "", **changes: Any) -> dict[str, Any] | None:
    """Atomically update a task, optionally only from an expected state."""
    now = time.time()
    client = get_redis_client()
    try:
        raw = await client.eval(
            _UPDATE_TASK_IF_STATUS_SCRIPT,
            2,
            _task_key(task_id),
            _INDEX_KEY,
            expected_status,
            json.dumps(changes, separators=(",", ":")),
            now,
            REDIS_CANVAS_TASK_TTL_SECONDS,
            task_id,
        )
    except RedisError as exc:
        raise _unavailable("update", exc) from exc
    if not raw:
        return None
    try:
        record = json.loads(raw)
    except (TypeError, ValueError):
        return None
    if not isinstance(record, dict):
        return None
    await _emit_agent_task_event(record)
    return record


async def update_claimed_canvas_task(
    task_id: str, lease_token: str, **changes: Any,
) -> dict[str, Any] | None:
    """Atomically persist a worker result only while it owns the task lease.

    ``lease_token`` is a fencing token, not a stable worker ID. A worker that
    wakes after its lease expired cannot overwrite output written by the worker
    that subsequently acquired the task.
    """
    now = time.time()
    client = get_redis_client()
    try:
        raw = await client.eval(
            _UPDATE_CLAIMED_TASK_SCRIPT,
            3,
            _task_key(task_id),
            _lease_key(task_id),
            _INDEX_KEY,
            lease_token,
            json.dumps(changes, separators=(",", ":")),
            now,
            REDIS_CANVAS_TASK_TTL_SECONDS,
            task_id,
        )
    except RedisError as exc:
        raise _unavailable("claimed_update", exc) from exc
    if not raw:
        return None
    try:
        record = json.loads(raw)
    except (TypeError, ValueError):
        return None
    if not isinstance(record, dict):
        return None
    await _emit_agent_task_event(record)
    return record

async def _emit_agent_task_event(task: dict[str, Any]) -> None:
    """Project task lifecycle changes into the owning Agent Run event stream."""
    run_id = str(task.get("agent_run_id") or "")
    user_id = str(task.get("owner_id") or "")
    if not run_id or not user_id:
        return
    status = str(task.get("status") or "")
    event_type = {"queued": "task.queued", "running": "task.running", "succeeded": "task.succeeded", "failed": "task.failed", "interrupted": "task.cancelled", "cancelled": "task.cancelled", "timed_out": "task.timed_out"}.get(status)
    if not event_type:
        return
    try:
        from app.services.canvas_agent.events import emit_agent_event
        from app.services.canvas_agent.reliability import classify_failure
        from app.services.canvas_agent.event_factory import task_lifecycle
        task_event = task_lifecycle(status, {
            "task_id": task.get("id"),
            "node_id": task.get("agent_node_id"),
            "status": status,
            "error": task.get("error") or "",
            "failure_category": classify_failure(task.get("error") or "") if status in {"failed", "timed_out"} else "",
            "result": task.get("result") if status == "succeeded" else None,
        })
        await emit_agent_event(
            user_id,
            run_id,
            task_event.event_type,
            task_event.payload,
            phase=task_event.phase,
            severity=task_event.severity,
        )
    except Exception:
        # Task completion remains durable in Redis, but a missing projection
        # must be visible: otherwise generated media never reaches its node.
        import logging
        logging.getLogger("aistudio.app.canvas_tasks").exception(
            "failed to project canvas task result to Agent run",
            extra={"event": "canvas_agent_task_projection_failed", "task_id": task.get("id"), "run_id": run_id, "node_id": task.get("agent_node_id")},
        )


async def claim_canvas_task(task_id: str, worker_id: str) -> str | None:
    """Acquire a lease and return a per-attempt fencing token."""
    client = get_redis_client()
    lease_token = f"{worker_id}:{uuid.uuid4().hex}"
    try:
        claimed = await client.set(_lease_key(task_id), lease_token, nx=True, ex=REDIS_CANVAS_TASK_LEASE_SECONDS)
        return lease_token if claimed else None
    except RedisError as exc:
        raise _unavailable("claim", exc) from exc


async def refresh_canvas_task_lease(task_id: str, worker_id: str) -> bool:
    client = get_redis_client()
    try:
        return bool(await client.eval(
            _REFRESH_LEASE_SCRIPT, 1, _lease_key(task_id), worker_id, REDIS_CANVAS_TASK_LEASE_SECONDS,
        ))
    except RedisError as exc:
        raise _unavailable("lease_refresh", exc) from exc


async def release_canvas_task_claim(task_id: str, worker_id: str) -> None:
    client = get_redis_client()
    try:
        await client.eval(_RELEASE_LEASE_SCRIPT, 1, _lease_key(task_id), worker_id)
    except RedisError as exc:
        raise _unavailable("release", exc) from exc


async def has_canvas_task_claim(task_id: str) -> bool:
    client = get_redis_client()
    try:
        return bool(await client.get(_lease_key(task_id)))
    except RedisError as exc:
        raise _unavailable("lease_read", exc) from exc


async def ensure_canvas_task_consumer_group() -> None:
    client = get_redis_client()
    try:
        try:
            await client.xgroup_create(REDIS_CANVAS_TASK_STREAM, REDIS_CANVAS_TASK_CONSUMER_GROUP, id="0", mkstream=True)
        except RedisError as exc:
            if "BUSYGROUP" not in str(exc):
                raise
    except RedisError as exc:
        raise _unavailable("consumer_group", exc) from exc


async def enqueue_canvas_task(task_id: str) -> str:
    client = get_redis_client()
    try:
        claimed = await client.set(
            _dispatch_key(task_id), "1", nx=True, ex=REDIS_CANVAS_TASK_DISPATCH_TTL_SECONDS,
        )
        if not claimed:
            return ""
        try:
            return str(await client.xadd(
                REDIS_CANVAS_TASK_STREAM, {"task_id": task_id}, maxlen=REDIS_CANVAS_TASK_STREAM_MAXLEN,
                approximate=True,
            ))
        except RedisError:
            await client.delete(_dispatch_key(task_id))
            raise
    except RedisError as exc:
        raise _unavailable("enqueue", exc) from exc


async def dequeue_canvas_tasks(consumer_id: str, *, block_ms: int = 1000) -> list[tuple[str, str]]:
    client = get_redis_client()
    try:
        messages = await client.xreadgroup(
            REDIS_CANVAS_TASK_CONSUMER_GROUP, consumer_id,
            {REDIS_CANVAS_TASK_STREAM: ">"}, count=1, block=block_ms,
        )
    except RedisError as exc:
        raise _unavailable("dequeue", exc) from exc
    return [
        (str(message_id), str(fields.get("task_id") or ""))
        for _stream, entries in messages or []
        for message_id, fields in entries
        if fields.get("task_id")
    ]


async def reclaim_canvas_task_messages(consumer_id: str) -> list[tuple[str, str]]:
    """Claim pending messages from workers that stopped making progress."""
    client = get_redis_client()
    try:
        claimed = await client.xautoclaim(
            REDIS_CANVAS_TASK_STREAM,
            REDIS_CANVAS_TASK_CONSUMER_GROUP,
            consumer_id,
            min_idle_time=REDIS_CANVAS_TASK_PENDING_CLAIM_IDLE_MS,
            start_id="0-0",
            count=1,
        )
    except RedisError as exc:
        raise _unavailable("pending_claim", exc) from exc
    entries = claimed[1] if isinstance(claimed, (tuple, list)) and len(claimed) > 1 else []
    return [
        (str(message_id), str(fields.get("task_id") or ""))
        for message_id, fields in entries or []
        if fields.get("task_id")
    ]


async def acknowledge_canvas_task(message_id: str) -> None:
    client = get_redis_client()
    try:
        await client.xack(REDIS_CANVAS_TASK_STREAM, REDIS_CANVAS_TASK_CONSUMER_GROUP, message_id)
    except RedisError as exc:
        raise _unavailable("ack", exc) from exc


async def dead_letter_canvas_task(message_id: str, task_id: str, reason: str) -> None:
    """Move an unrecoverable stream delivery to a durable operator-visible queue."""
    client = get_redis_client()
    try:
        pipeline = client.pipeline(transaction=True)
        pipeline.xadd(_DEAD_LETTER_STREAM, {"task_id": task_id, "message_id": message_id, "reason": str(reason)[:1000], "failed_at": str(time.time())})
        pipeline.xack(REDIS_CANVAS_TASK_STREAM, REDIS_CANVAS_TASK_CONSUMER_GROUP, message_id)
        pipeline.delete(_dispatch_key(task_id))
        await pipeline.execute()
    except RedisError as exc:
        raise _unavailable("dead_letter", exc) from exc


async def list_dead_letter_canvas_tasks(limit: int = 100) -> list[dict[str, str]]:
    client = get_redis_client()
    try:
        entries = await client.xrevrange(_DEAD_LETTER_STREAM, "+", "-", count=max(1, min(500, int(limit))))
    except RedisError as exc:
        raise _unavailable("dead_letter_list", exc) from exc
    return [{"entry_id": str(entry_id), **{str(key): str(value) for key, value in fields.items()}} for entry_id, fields in entries]


async def remove_dead_letter_canvas_task(entry_id: str) -> bool:
    client = get_redis_client()
    try:
        return bool(await client.xdel(_DEAD_LETTER_STREAM, entry_id))
    except RedisError as exc:
        raise _unavailable("dead_letter_remove", exc) from exc


async def release_canvas_task_dispatch(task_id: str) -> None:
    client = get_redis_client()
    try:
        await client.delete(_dispatch_key(task_id))
    except RedisError as exc:
        raise _unavailable("dispatch_release", exc) from exc


async def list_recoverable_canvas_tasks() -> list[dict[str, Any]]:
    client = get_redis_client()
    try:
        await client.zremrangebyscore(_INDEX_KEY, "-inf", time.time())
        task_ids = await client.zrange(_INDEX_KEY, 0, -1)
    except RedisError as exc:
        raise _unavailable("recover_list", exc) from exc
    records = []
    for task_id in task_ids:
        record = await get_canvas_task(str(task_id))
        if record and record.get("status") in {"queued", "running"}:
            records.append(record)
    return records
