import asyncio
import os
import uuid

import pytest

pytestmark = pytest.mark.skipif(not os.getenv("DATABASE_URL"), reason="DATABASE_URL is required")

def test_patch_transaction_and_idempotency():
    from app.core.database import close_database_pool, open_database_pool
    from app.models.canvas_agent import CanvasPatch
    from app.services.business_metadata import initialize_business_metadata, json_value, metadata_connection
    from app.services.canvas_agent.executor import PatchConflictError, apply_patch, apply_patch_idempotently

    def run_sync():
        initialize_business_metadata()
        uid = "phase0-test-" + uuid.uuid4().hex[:12]
        canvas_id = "phase0-canvas-" + uuid.uuid4().hex[:12]
        run_id = "phase0-run-" + uuid.uuid4().hex[:12]
        now = 1000000000000
        try:
            with metadata_connection() as conn, conn.transaction(), conn.cursor() as cur:
                cur.execute("INSERT INTO users(id,username,created_at) VALUES(%s,%s,%s)", (uid, uid, now))
                cur.execute("INSERT INTO smart_canvases(id,user_id,title,created_at,updated_at,version,viewport_json) VALUES(%s,%s,%s,%s,%s,1,%s)", (canvas_id, uid, "phase0", now, now, json_value({"viewport": {}, "payload": {"connections": []}})))
                cur.execute("INSERT INTO canvas_agent_runs(id,user_id,canvas_id,created_at,updated_at) VALUES(%s,%s,%s,%s,%s)", (run_id, uid, canvas_id, now, now))
            patch = CanvasPatch(canvas_id=canvas_id, base_version=1, operations=[
                {"op": "add_node", "client_ref": "prompt", "node": {"type": "smart-prompt", "text": "hello"}},
                {"op": "add_node", "client_ref": "image", "node": {"type": "smart-image"}},
                {"op": "add_connection", "from_ref": "prompt", "to_ref": "image", "connection": {"kind": "prompt"}},
            ])
            result = apply_patch_idempotently(uid, run_id, run_id + ":create", patch)
            assert apply_patch_idempotently(uid, run_id, run_id + ":create", patch) == result
            with pytest.raises(PatchConflictError):
                apply_patch(uid, patch)
            invalid = CanvasPatch(canvas_id=canvas_id, base_version=2, operations=[
                {"op": "add_node", "client_ref": "bad", "node": {"type": "smart-prompt"}},
                {"op": "add_connection", "from_ref": "bad", "to_ref": "missing"},
            ])
            with pytest.raises(ValueError): apply_patch(uid, invalid, run_id=run_id)
            with metadata_connection() as conn, conn.cursor() as cur:
                cur.execute("SELECT version FROM smart_canvases WHERE id=%s", (canvas_id,)); assert cur.fetchone()["version"] == 2
                cur.execute("SELECT COUNT(*) AS count FROM smart_canvas_nodes WHERE canvas_id=%s", (canvas_id,)); assert cur.fetchone()["count"] == 2
        finally:
            with metadata_connection() as conn, conn.transaction(), conn.cursor() as cur: cur.execute("DELETE FROM users WHERE id=%s", (uid,))

    async def run():
        await open_database_pool()
        try: await asyncio.to_thread(run_sync)
        finally: await close_database_pool()
    asyncio.run(run())

def test_agent_store_persists_versioned_business_facts():
    from app.core.database import close_database_pool, open_database_pool
    from app.services.business_metadata import initialize_business_metadata, json_value, metadata_connection
    from app.services.canvas_agent.store import append_event, append_message, begin_operation, create_run, finish_operation, save_artifact, save_plan

    def run_sync():
        initialize_business_metadata()
        uid = "phase0-store-" + uuid.uuid4().hex[:12]; canvas_id = "phase0-store-canvas-" + uuid.uuid4().hex[:12]; now = 1000000000000
        try:
            with metadata_connection() as conn, conn.transaction(), conn.cursor() as cur:
                cur.execute("INSERT INTO users(id,username,created_at) VALUES(%s,%s,%s)", (uid,uid,now))
                cur.execute("INSERT INTO smart_canvases(id,user_id,title,created_at,updated_at,version,viewport_json) VALUES(%s,%s,%s,%s,%s,1,%s)", (canvas_id,uid,"store",now,now,json_value({"viewport":{},"payload":{}})))
            run = create_run(uid, canvas_id)
            assert append_message(uid, run["id"], "user", "hello")["sequence"] == 1
            assert save_plan(uid, run["id"], {"goal":"hello"})["content_json"]["schema_version"] == 1
            assert save_artifact(uid, run["id"], "shot_list", {"shots":[]})["content_json"]["schema_version"] == 1
            operation = begin_operation(uid, run["id"], run["id"] + ":op", "canvas.apply_patch", {"patch":{}})
            assert finish_operation(operation["idempotency_key"], status="succeeded", result={"ok":True})["result_json"]["schema_version"] == 1
            assert append_event(uid, run["id"], "agent.plan.created", {"plan_version":1})["payload_json"]["schema_version"] == 1
        finally:
            with metadata_connection() as conn, conn.transaction(), conn.cursor() as cur: cur.execute("DELETE FROM users WHERE id=%s", (uid,))

    async def run():
        await open_database_pool()
        try: await asyncio.to_thread(run_sync)
        finally: await close_database_pool()
    asyncio.run(run())


def test_expired_tool_group_is_closed_once_across_concurrent_reconcilers():
    from concurrent.futures import ThreadPoolExecutor

    from app.services.business_metadata import initialize_business_metadata, json_value, metadata_connection
    from app.services.canvas_agent.event_bus import AgentEventService, scan_open_tool_groups_sync
    from app.services.canvas_agent.event_factory import tool_started, tool_timed_out

    def run_sync():
        initialize_business_metadata()
        uid = "event-timeout-owner-" + uuid.uuid4().hex[:12]
        canvas_id = "event-timeout-canvas-" + uuid.uuid4().hex[:12]
        run_id = "event-timeout-run-" + uuid.uuid4().hex[:12]
        now = 1_000_000_000_000
        tool_call_id = "call-" + uuid.uuid4().hex
        try:
            with metadata_connection() as conn, conn.transaction(), conn.cursor() as cur:
                cur.execute("INSERT INTO users(id,username,created_at) VALUES(%s,%s,%s)", (uid, uid, now))
                cur.execute(
                    "INSERT INTO smart_canvases(id,user_id,title,created_at,updated_at,version,viewport_json) VALUES(%s,%s,%s,%s,%s,1,%s)",
                    (canvas_id, uid, "event timeout", now, now, json_value({"viewport": {}, "payload": {}})),
                )
                cur.execute("INSERT INTO canvas_agent_runs(id,user_id,canvas_id,created_at,updated_at) VALUES(%s,%s,%s,%s,%s)", (run_id, uid, canvas_id, now, now))

            started = tool_started(tool_name="read_canvas_skill", tool_call_id=tool_call_id)
            event = AgentEventService.append_sync(
                user_id=uid,
                run_id=run_id,
                event_type=started.event_type,
                payload=started.payload,
                phase=started.phase,
                severity=started.severity,
            )
            # Make this group older than the scanner threshold without sleeping.
            stale_at = now - 60_000
            with metadata_connection() as conn, conn.transaction(), conn.cursor() as cur:
                cur.execute("UPDATE canvas_agent_events SET created_at=%s WHERE id=%s", (stale_at, event["id"]))

            open_count, expired = scan_open_tool_groups_sync(30)
            group = next(item for item in expired if item["run_id"] == run_id)
            assert open_count >= 1
            assert group["tool_call_id"] == tool_call_id

            timeout = tool_timed_out(tool_name="read_canvas_skill", tool_call_id=tool_call_id)

            def close_once() -> bool:
                return AgentEventService.close_expired_tool_group_sync(
                    user_id=uid,
                    run_id=run_id,
                    tool_call_id=tool_call_id,
                    started_at=int(group["created_at"]),
                    event_type=timeout.event_type,
                    payload=timeout.payload,
                    phase=timeout.phase,
                    severity=timeout.severity,
                )

            with ThreadPoolExecutor(max_workers=2) as executor:
                results = list(executor.map(lambda _: close_once(), range(2)))
            assert results.count(True) == 1

            open_after, expired_after = scan_open_tool_groups_sync(30)
            assert not any(item["run_id"] == run_id for item in expired_after)
            with metadata_connection() as conn, conn.cursor() as cur:
                cur.execute(
                    "SELECT type,payload_json FROM canvas_agent_events WHERE run_id=%s ORDER BY sequence",
                    (run_id,),
                )
                events = cur.fetchall()
            timeout_events = [item for item in events if item["type"] == "progress.tool_failed"]
            assert len(timeout_events) == 1
            assert timeout_events[0]["payload_json"]["presentation"]["group_id"] == f"tool:{tool_call_id}"
            assert timeout_events[0]["payload_json"]["timeout"] is True
            assert open_after >= 0
        finally:
            with metadata_connection() as conn, conn.transaction(), conn.cursor() as cur:
                cur.execute("DELETE FROM users WHERE id=%s", (uid,))

    async def run():
        from app.core.database import close_database_pool, open_database_pool

        await open_database_pool()
        try:
            await asyncio.to_thread(run_sync)
        finally:
            await close_database_pool()

    asyncio.run(run())


def test_artifact_versions_propagate_stale_to_downstream():
    from app.core.database import close_database_pool, open_database_pool
    from app.services.business_metadata import initialize_business_metadata, json_value, metadata_connection
    from app.services.canvas_agent.store import create_run, list_artifacts, save_artifact

    def run_sync():
        initialize_business_metadata()
        uid = "phase3-artifact-" + uuid.uuid4().hex[:12]; canvas_id = "phase3-artifact-canvas-" + uuid.uuid4().hex[:12]; now = 1000000000000
        try:
            with metadata_connection() as conn, conn.transaction(), conn.cursor() as cur:
                cur.execute("INSERT INTO users(id,username,created_at) VALUES(%s,%s,%s)", (uid, uid, now))
                cur.execute("INSERT INTO smart_canvases(id,user_id,title,created_at,updated_at,version,viewport_json) VALUES(%s,%s,%s,%s,%s,1,%s)", (canvas_id, uid, "phase3", now, now, json_value({"viewport": {}, "payload": {}})))
            run = create_run(uid, canvas_id)
            brief = save_artifact(uid, run["id"], "brief", {"text": "v1"}, status="approved")
            script = save_artifact(uid, run["id"], "script", {"text": "script"}, source_artifact_ids=[brief["id"]])
            shot_list = save_artifact(uid, run["id"], "shot_list", {"shots": []}, source_artifact_ids=[script["id"]])
            save_artifact(uid, run["id"], "brief", {"text": "v2"})
            stored = next(item for item in list_artifacts(uid, run["id"]) if item["id"] == script["id"])
            assert stored["stale"] is True
            assert next(item for item in list_artifacts(uid, run["id"]) if item["id"] == shot_list["id"])["stale"] is True
        finally:
            with metadata_connection() as conn, conn.transaction(), conn.cursor() as cur: cur.execute("DELETE FROM users WHERE id=%s", (uid,))

    async def run():
        await open_database_pool()
        try: await asyncio.to_thread(run_sync)
        finally: await close_database_pool()
    asyncio.run(run())

def test_phase4_templates_and_project_assets_are_owner_scoped():
    from app.core.database import close_database_pool, open_database_pool
    from app.services.business_metadata import initialize_business_metadata, json_value, metadata_connection
    from app.services.canvas_agent.store import create_run, create_template, list_project_assets, list_templates, save_artifact, share_project_asset

    def run_sync():
        initialize_business_metadata()
        uid = "phase4-owner-" + uuid.uuid4().hex[:12]; other = "phase4-other-" + uuid.uuid4().hex[:12]
        canvas_id = "phase4-canvas-" + uuid.uuid4().hex[:12]; now = 1000000000000
        try:
            with metadata_connection() as conn, conn.transaction(), conn.cursor() as cur:
                for user_id in (uid, other): cur.execute("INSERT INTO users(id,username,created_at) VALUES(%s,%s,%s)", (user_id, user_id, now))
                cur.execute("INSERT INTO smart_canvases(id,user_id,title,created_at,updated_at,version,viewport_json) VALUES(%s,%s,%s,%s,%s,1,%s)", (canvas_id, uid, "phase4", now, now, json_value({"viewport": {}, "payload": {}})))
            run = create_run(uid, canvas_id)
            template = create_template(uid, "product-launch", {"goal": "launch"}, source_run_id=run["id"])
            assert list_templates(uid)[0]["id"] == template["id"]
            assert list_templates(other) == []
            artifact = save_artifact(uid, run["id"], "brief", {"text": "launch"})
            shared = share_project_asset(uid, run["id"], artifact["id"], "project-a")
            assert list_project_assets(uid, "project-a")[0]["id"] == shared["id"]
            assert list_project_assets(other, "project-a") == []
        finally:
            with metadata_connection() as conn, conn.transaction(), conn.cursor() as cur: cur.execute("DELETE FROM users WHERE id IN (%s,%s)", (uid, other))

    async def run():
        await open_database_pool()
        try: await asyncio.to_thread(run_sync)
        finally: await close_database_pool()
    asyncio.run(run())

def test_postgres_checkpointer_recovers_command_resume_same_thread():
    from langgraph.graph import END, START, StateGraph
    from langgraph.types import Command, interrupt
    from app.services.canvas_agent.checkpoint import create_checkpointer

    thread_id = "checkpoint-test-" + uuid.uuid4().hex
    def approval_node(_state):
        return {"answer": interrupt({"question": "approve?"})}
    try:
        with create_checkpointer() as saver:
            builder = StateGraph(dict)
            builder.add_node("approval", approval_node)
            builder.add_edge(START, "approval"); builder.add_edge("approval", END)
            graph = builder.compile(checkpointer=saver)
            config = {"configurable": {"thread_id": thread_id}}
            first = graph.invoke({"input": "plan"}, config=config)
            resumed = graph.invoke(Command(resume="approved"), config=config)
            assert first["__interrupt__"]
            assert resumed["answer"] == "approved"
    finally:
        import psycopg
        with psycopg.connect(os.environ["DATABASE_URL"]) as conn, conn.cursor() as cur:
            for table in ("checkpoint_writes", "checkpoint_blobs", "checkpoints"):
                cur.execute(f"DELETE FROM {table} WHERE thread_id=%s", (thread_id,))

def test_checkpoint_replay_with_canvas_executor_is_idempotent():
    from langgraph.graph import END, START, StateGraph
    from langgraph.types import Command, interrupt
    from app.services.canvas_agent.checkpoint import create_checkpointer
    from app.services.canvas_agent.executor import apply_patch_idempotently
    from app.models.canvas_agent import CanvasPatch
    from app.services.business_metadata import initialize_business_metadata, json_value, metadata_connection

    def run_sync():
        initialize_business_metadata()
        uid = "checkpoint-exec-" + uuid.uuid4().hex[:12]; canvas_id = "checkpoint-canvas-" + uuid.uuid4().hex[:12]
        run_id = "checkpoint-run-" + uuid.uuid4().hex[:12]; thread_id = run_id; now = 1000000000000
        try:
            with metadata_connection() as conn, conn.transaction(), conn.cursor() as cur:
                cur.execute("INSERT INTO users(id,username,created_at) VALUES(%s,%s,%s)", (uid, uid, now))
                cur.execute("INSERT INTO smart_canvases(id,user_id,title,created_at,updated_at,version,viewport_json) VALUES(%s,%s,%s,%s,%s,1,%s)", (canvas_id, uid, "checkpoint", now, now, json_value({"viewport": {}, "payload": {}})))
                cur.execute("INSERT INTO canvas_agent_runs(id,user_id,canvas_id,created_at,updated_at) VALUES(%s,%s,%s,%s,%s)", (run_id, uid, canvas_id, now, now))
            patch = CanvasPatch(canvas_id=canvas_id, base_version=1, operations=[{"op": "add_node", "client_ref": "effect", "node": {"type": "smart-prompt", "text": "once"}}])
            def effect_node(_state):
                interrupt({"confirmation": "required"})
                result = apply_patch_idempotently(uid, run_id, run_id + ":effect", patch)
                return {"version": result["version"]}
            builder = StateGraph(dict); builder.add_node("effect", effect_node)
            builder.add_edge(START, "effect"); builder.add_edge("effect", END)
            with create_checkpointer() as saver:
                graph = builder.compile(checkpointer=saver); config = {"configurable": {"thread_id": thread_id}}
                assert graph.invoke({"input": "x"}, config=config)["__interrupt__"]
                resumed = graph.invoke(Command(resume="approved"), config=config)
                assert resumed["version"] == 2
            with metadata_connection() as conn, conn.cursor() as cur:
                cur.execute("SELECT COUNT(*) AS count FROM smart_canvas_nodes WHERE canvas_id=%s", (canvas_id,)); assert cur.fetchone()["count"] == 1
                cur.execute("SELECT COUNT(*) AS count FROM canvas_agent_operations WHERE run_id=%s AND status='succeeded'", (run_id,)); assert cur.fetchone()["count"] == 1
        finally:
            with metadata_connection() as conn, conn.transaction(), conn.cursor() as cur: cur.execute("DELETE FROM users WHERE id=%s", (uid,))
            import psycopg
            with psycopg.connect(os.environ["DATABASE_URL"]) as conn, conn.cursor() as cur:
                for table in ("checkpoint_writes", "checkpoint_blobs", "checkpoints"): cur.execute(f"DELETE FROM {table} WHERE thread_id=%s", (thread_id,))

    async def run():
        from app.core.database import close_database_pool, open_database_pool
        await open_database_pool()
        try: await asyncio.to_thread(run_sync)
        finally: await close_database_pool()
    asyncio.run(run())
