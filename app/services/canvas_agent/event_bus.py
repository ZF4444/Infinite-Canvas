"""Durable Canvas Agent event append service and transactional outbox."""
from __future__ import annotations

from typing import Any

from app.core.logging import get_logger
from app.core.utils import now_ms
from app.services.business_metadata import json_value, metadata_connection, new_id
from .event_types import EVENT_SCHEMA_VERSION, PHASES, SEVERITIES, normalize_event_type, normalize_presentation_payload, sanitize_payload


logger = get_logger("canvas_agent")

_TOOL_GROUP_TERMINAL_TYPES = (
    "progress.tool_completed",
    "progress.tool_failed",
    "skill.loaded",
    "skill.resource_loaded",
    "skill.rejected",
    "skill.resource_rejected",
)
_TOOL_GROUP_TERMINAL_SQL = ",".join(f"'{event_type}'" for event_type in _TOOL_GROUP_TERMINAL_TYPES)


class AgentEventService:
    topic = "agent.event.v1"

    @classmethod
    def append_sync(cls, *, user_id: str, run_id: str, event_type: str, payload: dict[str, Any] | None = None,
                    operation_id: str | None = None, phase: str = "", severity: str = "info") -> dict[str, Any]:
        event_type = normalize_event_type(event_type)
        phase = str(phase or "")
        severity = str(severity or "info")
        if phase not in PHASES:
            raise ValueError(f"unsupported agent event phase: {phase}")
        if severity not in SEVERITIES:
            raise ValueError(f"unsupported agent event severity: {severity}")
        body = normalize_presentation_payload(sanitize_payload(payload))
        # Keep the payload self-describing for persisted-event consumers that
        # do not read the event envelope columns.
        body.setdefault("schema_version", EVENT_SCHEMA_VERSION)
        now = now_ms()
        with metadata_connection() as conn, conn.transaction(), conn.cursor() as cur:
            cur.execute("SELECT 1 FROM canvas_agent_runs WHERE id=%s AND user_id=%s FOR UPDATE", (run_id, user_id))
            if not cur.fetchone():
                raise PermissionError("run not found")
            return cls._append_in_transaction(
                cur,
                user_id=user_id,
                run_id=run_id,
                event_type=event_type,
                payload=body,
                operation_id=operation_id,
                phase=phase,
                severity=severity,
                created_at=now,
            )

    @classmethod
    def _append_in_transaction(
        cls,
        cur: Any,
        *,
        user_id: str,
        run_id: str,
        event_type: str,
        payload: dict[str, Any],
        operation_id: str | None,
        phase: str,
        severity: str,
        created_at: int,
    ) -> dict[str, Any]:
        """Append after the caller has locked and authorized the owning run."""
        cur.execute("SELECT COALESCE(MAX(sequence), 0) + 1 AS sequence FROM canvas_agent_events WHERE run_id=%s", (run_id,))
        sequence = int(cur.fetchone()["sequence"])
        event_id = new_id()
        cur.execute(
            "INSERT INTO canvas_agent_events(id,run_id,sequence,type,payload_json,operation_id,phase,severity,schema_version,created_at) "
            "VALUES(%s,%s,%s,%s,%s,%s,%s,%s,%s,%s) RETURNING *",
            (event_id, run_id, sequence, event_type, json_value(payload), operation_id or None, phase or None, severity, EVENT_SCHEMA_VERSION, created_at),
        )
        event = cur.fetchone()
        outbox_payload = {"user_id": user_id, "event": {
            "schema_version": EVENT_SCHEMA_VERSION, "id": event_id, "sequence": sequence, "run_id": run_id,
            "operation_id": operation_id or "", "type": event_type, "phase": phase, "severity": severity,
            "created_at": created_at, "payload": payload,
        }}
        cur.execute(
            "INSERT INTO canvas_agent_event_outbox(id,event_id,run_id,user_id,topic,payload_json,status,attempts,available_at,created_at,updated_at) "
            "VALUES(%s,%s,%s,%s,%s,%s,'pending',0,%s,%s,%s)",
            (new_id(), event_id, run_id, user_id, cls.topic, json_value(outbox_payload), created_at, created_at, created_at),
        )
        return event

    @classmethod
    def close_expired_tool_group_sync(
        cls,
        *,
        user_id: str,
        run_id: str,
        tool_call_id: str,
        started_at: int,
        event_type: str,
        payload: dict[str, Any],
        phase: str,
        severity: str,
    ) -> bool:
        """Atomically close an expired progress group exactly once."""
        event_type = normalize_event_type(event_type)
        phase = str(phase or "")
        severity = str(severity or "info")
        if phase not in PHASES or severity not in SEVERITIES:
            raise ValueError("invalid timeout event phase or severity")
        body = normalize_presentation_payload(sanitize_payload(payload))
        body.setdefault("schema_version", EVENT_SCHEMA_VERSION)
        with metadata_connection() as conn, conn.transaction(), conn.cursor() as cur:
            # All ordinary appends lock this same row, so the terminal check and
            # insert cannot race a normal worker or a second scanner.
            cur.execute("SELECT 1 FROM canvas_agent_runs WHERE id=%s AND user_id=%s FOR UPDATE", (run_id, user_id))
            if not cur.fetchone():
                return False
            cur.execute(
                "SELECT 1 FROM canvas_agent_events "
                "WHERE run_id=%s AND created_at>=%s AND payload_json->>'tool_call_id'=%s "
                f"AND type IN ({_TOOL_GROUP_TERMINAL_SQL}) LIMIT 1",
                (run_id, started_at, tool_call_id),
            )
            if cur.fetchone():
                return False
            cls._append_in_transaction(
                cur,
                user_id=user_id,
                run_id=run_id,
                event_type=event_type,
                payload=body,
                operation_id=None,
                phase=phase,
                severity=severity,
                created_at=now_ms(),
            )
            return True

    @classmethod
    async def append(cls, **kwargs: Any) -> dict[str, Any]:
        import asyncio
        return await asyncio.to_thread(cls.append_sync, **kwargs)


def scan_open_tool_groups_sync(timeout_seconds: int, *, limit: int = 200) -> tuple[int, list[dict[str, Any]]]:
    """Return current open groups and the subset past the configured timeout."""
    timeout_ms = max(1, int(timeout_seconds)) * 1000
    cutoff = now_ms() - timeout_ms
    open_groups_sql = (
        "FROM canvas_agent_events started JOIN canvas_agent_runs run ON run.id=started.run_id "
        "WHERE started.type='progress.tool_started' "
        "AND COALESCE(started.payload_json->>'tool_call_id','')<>'' "
        "AND NOT EXISTS (SELECT 1 FROM canvas_agent_events terminal "
        "WHERE terminal.run_id=started.run_id AND terminal.created_at>=started.created_at "
        "AND terminal.payload_json->>'tool_call_id'=started.payload_json->>'tool_call_id' "
        f"AND terminal.type IN ({_TOOL_GROUP_TERMINAL_SQL}))"
    )
    with metadata_connection() as conn, conn.cursor() as cur:
        cur.execute(f"SELECT COUNT(*) AS count {open_groups_sql}")
        open_count = int(cur.fetchone()["count"])
        cur.execute(
            "SELECT started.run_id,run.user_id,started.created_at,"
            "started.payload_json->>'tool_call_id' AS tool_call_id,"
            "COALESCE(started.payload_json->>'tool_name','unknown') AS tool_name "
            f"{open_groups_sql} AND started.created_at<=%s "
            "ORDER BY started.created_at LIMIT %s",
            (cutoff, max(1, min(limit, 1_000))),
        )
        return open_count, [dict(row) for row in cur.fetchall()]


async def reconcile_expired_tool_groups() -> int:
    """Measure open groups and force-close stale ones with a terminal event."""
    import asyncio

    from app.config import AGENT_EVENT_TOOL_GROUP_TIMEOUT_SECONDS
    from app.core.metrics import AGENT_EVENT_OPEN_TOOL_GROUPS, AGENT_EVENT_TOOL_GROUP_TIMEOUTS
    from .event_factory import tool_timed_out

    open_count, expired = await asyncio.to_thread(
        scan_open_tool_groups_sync,
        AGENT_EVENT_TOOL_GROUP_TIMEOUT_SECONDS,
    )
    AGENT_EVENT_OPEN_TOOL_GROUPS.set(open_count)
    closed = 0
    for group in expired:
        spec = tool_timed_out(
            tool_name=str(group.get("tool_name") or "unknown"),
            tool_call_id=str(group["tool_call_id"]),
        )
        did_close = await asyncio.to_thread(
            AgentEventService.close_expired_tool_group_sync,
            user_id=str(group["user_id"]),
            run_id=str(group["run_id"]),
            tool_call_id=str(group["tool_call_id"]),
            started_at=int(group["created_at"]),
            event_type=spec.event_type,
            payload=spec.payload,
            phase=spec.phase,
            severity=spec.severity,
        )
        if did_close:
            closed += 1
            AGENT_EVENT_TOOL_GROUP_TIMEOUTS.inc()
            logger.warning(
                "canvas agent tool group timed out",
                extra={
                    "event": "canvas_agent_tool_group_timed_out",
                    "run_id": group["run_id"],
                    "tool_call_id": group["tool_call_id"],
                    "tool_name": group["tool_name"],
                },
            )
    return closed


def claim_outbox_batch(limit: int = 100) -> list[dict[str, Any]]:
    """Lease events for one publisher. PostgreSQL remains the retry authority."""
    now = now_ms()
    with metadata_connection() as conn, conn.transaction(), conn.cursor() as cur:
        cur.execute(
            "SELECT * FROM canvas_agent_event_outbox WHERE status IN ('pending','retrying') AND available_at<=%s "
            "ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT %s", (now, max(1, min(limit, 500))),
        )
        rows = cur.fetchall()
        for row in rows:
            cur.execute("UPDATE canvas_agent_event_outbox SET status='publishing',attempts=attempts+1,updated_at=%s WHERE id=%s", (now, row["id"]))
            row["attempts"] = int(row.get("attempts") or 0) + 1
        return rows


def mark_outbox_delivered(outbox_id: str) -> None:
    with metadata_connection() as conn, conn.cursor() as cur:
        now = now_ms()
        cur.execute("UPDATE canvas_agent_event_outbox SET status='delivered',delivered_at=%s,updated_at=%s WHERE id=%s", (now, now, outbox_id))


def retry_outbox(outbox_id: str, attempts: int, error: str) -> None:
    now = now_ms()
    delay_ms = min(60_000, 250 * (2 ** min(8, max(0, attempts - 1))))
    status = "dead" if attempts >= 12 else "retrying"
    with metadata_connection() as conn, conn.cursor() as cur:
        cur.execute("UPDATE canvas_agent_event_outbox SET status=%s,available_at=%s,last_error=%s,updated_at=%s WHERE id=%s", (status, now + delay_ms, str(error)[:1000], now, outbox_id))


async def agent_event_outbox_loop() -> None:
    """Publish persisted events at least once; clients dedupe by run/sequence."""
    import asyncio
    import time

    from app.config import (
        AGENT_EVENT_OUTBOX_BATCH_SIZE,
        AGENT_EVENT_OUTBOX_POLL_SECONDS,
        AGENT_EVENT_TOOL_GROUP_SCAN_SECONDS,
    )
    from app.core.agent_event_pubsub import publish_agent_event
    from app.core.metrics import AGENT_EVENT_PUBLISHES
    last_tool_group_scan = 0.0
    while True:
        try:
            monotonic_now = time.monotonic()
            if monotonic_now - last_tool_group_scan >= AGENT_EVENT_TOOL_GROUP_SCAN_SECONDS:
                last_tool_group_scan = monotonic_now
                await reconcile_expired_tool_groups()
            rows = await asyncio.to_thread(claim_outbox_batch, AGENT_EVENT_OUTBOX_BATCH_SIZE)
            if not rows:
                await asyncio.sleep(AGENT_EVENT_OUTBOX_POLL_SECONDS)
                continue
            for row in rows:
                try:
                    await publish_agent_event(dict(row.get("payload_json") or {}))
                    await asyncio.to_thread(mark_outbox_delivered, row["id"])
                    AGENT_EVENT_PUBLISHES.labels(result="delivered").inc()
                except Exception as exc:
                    await asyncio.to_thread(retry_outbox, row["id"], int(row.get("attempts") or 1), exc)
                    AGENT_EVENT_PUBLISHES.labels(result="retrying").inc()
        except asyncio.CancelledError:
            raise
        except Exception:
            logger.exception("Canvas Agent event publisher or tool-group reconciliation failed")
            await asyncio.sleep(AGENT_EVENT_OUTBOX_POLL_SECONDS)
