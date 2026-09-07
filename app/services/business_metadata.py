"""Business metadata schema and small persistence helpers.

The service is deliberately independent from the file storage implementation:
files are owned by ``files`` and this module only owns business rows and their
explicit file references. PostgreSQL is required; there is no JSON fallback.
"""
from __future__ import annotations

import json
import os
import time
import uuid
from typing import Any, Dict, Iterable, Optional

from app.config import DATABASE_URL
from app.core.database import database_connection_sync
from app.core.utils import now_ms

BUSINESS_METADATA_SQL = """
CREATE TABLE IF NOT EXISTS history_records (
    id TEXT PRIMARY KEY, user_id TEXT NOT NULL, type TEXT NOT NULL DEFAULT 'zimage',
    prompt TEXT NOT NULL DEFAULT '', is_cloud BOOLEAN NOT NULL DEFAULT FALSE,
    created_at BIGINT NOT NULL, updated_at BIGINT NOT NULL, extra_json JSONB NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX IF NOT EXISTS idx_history_records_user_created ON history_records(user_id, created_at DESC);
CREATE TABLE IF NOT EXISTS history_record_files (
    id TEXT PRIMARY KEY, history_record_id TEXT NOT NULL REFERENCES history_records(id) ON DELETE CASCADE,
    file_id TEXT NOT NULL REFERENCES files(id) ON DELETE RESTRICT, sort_order INTEGER NOT NULL DEFAULT 0,
    role TEXT NOT NULL DEFAULT '', created_at BIGINT NOT NULL, UNIQUE(history_record_id, file_id, role)
);
CREATE INDEX IF NOT EXISTS idx_history_record_files_file ON history_record_files(file_id);
CREATE TABLE IF NOT EXISTS asset_libraries (
    id TEXT PRIMARY KEY, user_id TEXT NOT NULL, name TEXT NOT NULL, type TEXT NOT NULL DEFAULT 'default',
    is_default BOOLEAN NOT NULL DEFAULT FALSE, created_at BIGINT NOT NULL, updated_at BIGINT NOT NULL,
    UNIQUE(user_id, name)
);
ALTER TABLE asset_libraries ADD COLUMN IF NOT EXISTS payload_json JSONB NOT NULL DEFAULT '{}'::jsonb;
CREATE TABLE IF NOT EXISTS asset_categories (
    id TEXT PRIMARY KEY, library_id TEXT NOT NULL REFERENCES asset_libraries(id) ON DELETE CASCADE,
    name TEXT NOT NULL, type TEXT NOT NULL DEFAULT 'default', sort_order INTEGER NOT NULL DEFAULT 0,
    created_at BIGINT NOT NULL, updated_at BIGINT NOT NULL, UNIQUE(library_id, name)
);
CREATE TABLE IF NOT EXISTS asset_items (
    id TEXT PRIMARY KEY, category_id TEXT NOT NULL REFERENCES asset_categories(id) ON DELETE CASCADE,
    file_id TEXT NOT NULL REFERENCES files(id) ON DELETE RESTRICT, name TEXT NOT NULL DEFAULT '', kind TEXT NOT NULL DEFAULT 'file',
    created_at BIGINT NOT NULL, updated_at BIGINT NOT NULL, extra_json JSONB NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX IF NOT EXISTS idx_asset_items_category ON asset_items(category_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_asset_items_file ON asset_items(file_id);
CREATE TABLE IF NOT EXISTS conversations (
    id TEXT PRIMARY KEY, user_id TEXT NOT NULL, title TEXT NOT NULL DEFAULT '', created_at BIGINT NOT NULL,
    updated_at BIGINT NOT NULL, extra_json JSONB NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX IF NOT EXISTS idx_conversations_user_updated ON conversations(user_id, updated_at DESC);
CREATE TABLE IF NOT EXISTS conversation_messages (
    id TEXT PRIMARY KEY, conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    role TEXT NOT NULL, content TEXT NOT NULL DEFAULT '', sort_order INTEGER NOT NULL DEFAULT 0,
    created_at BIGINT NOT NULL, updated_at BIGINT NOT NULL, extra_json JSONB NOT NULL DEFAULT '{}'::jsonb
);
CREATE TABLE IF NOT EXISTS conversation_message_files (
    id TEXT PRIMARY KEY, message_id TEXT NOT NULL REFERENCES conversation_messages(id) ON DELETE CASCADE,
    file_id TEXT NOT NULL REFERENCES files(id) ON DELETE RESTRICT, sort_order INTEGER NOT NULL DEFAULT 0,
    kind TEXT NOT NULL DEFAULT '', role TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_conversation_message_files_file ON conversation_message_files(file_id);
CREATE TABLE IF NOT EXISTS smart_canvases (
    id TEXT PRIMARY KEY, user_id TEXT NOT NULL, title TEXT NOT NULL DEFAULT '', icon TEXT NOT NULL DEFAULT '',
    owner TEXT NOT NULL DEFAULT '', color TEXT NOT NULL DEFAULT '', pinned BOOLEAN NOT NULL DEFAULT FALSE,
    created_at BIGINT NOT NULL, updated_at BIGINT NOT NULL, deleted_at BIGINT, viewport_json JSONB NOT NULL DEFAULT '{}'::jsonb,
    version BIGINT NOT NULL DEFAULT 1
);
ALTER TABLE smart_canvases ADD COLUMN IF NOT EXISTS version BIGINT NOT NULL DEFAULT 1;
CREATE INDEX IF NOT EXISTS idx_smart_canvases_user_updated ON smart_canvases(user_id, updated_at DESC);
UPDATE smart_canvases SET deleted_at = NULL WHERE deleted_at = 0;
CREATE TABLE IF NOT EXISTS smart_canvas_nodes (
    id TEXT PRIMARY KEY, canvas_id TEXT NOT NULL REFERENCES smart_canvases(id) ON DELETE CASCADE,
    node_type TEXT NOT NULL DEFAULT '', position_x DOUBLE PRECISION NOT NULL DEFAULT 0,
    position_y DOUBLE PRECISION NOT NULL DEFAULT 0, sort_order INTEGER NOT NULL DEFAULT 0,
    data_json JSONB NOT NULL DEFAULT '{}'::jsonb, created_at BIGINT NOT NULL, updated_at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_smart_canvas_nodes_canvas_sort ON smart_canvas_nodes(canvas_id, sort_order);
CREATE TABLE IF NOT EXISTS smart_canvas_node_files (
    id TEXT PRIMARY KEY, node_id TEXT NOT NULL REFERENCES smart_canvas_nodes(id) ON DELETE CASCADE,
    file_id TEXT NOT NULL REFERENCES files(id) ON DELETE RESTRICT, field_name TEXT NOT NULL DEFAULT '',
    sort_order INTEGER NOT NULL DEFAULT 0, role TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_smart_canvas_node_files_node ON smart_canvas_node_files(node_id);
CREATE INDEX IF NOT EXISTS idx_smart_canvas_node_files_file ON smart_canvas_node_files(file_id);
CREATE TABLE IF NOT EXISTS canvas_agent_runs (
    id TEXT PRIMARY KEY, user_id TEXT NOT NULL, canvas_id TEXT NOT NULL REFERENCES smart_canvases(id) ON DELETE CASCADE,
    conversation_id TEXT NOT NULL DEFAULT '', mode TEXT NOT NULL DEFAULT 'fast_track', status TEXT NOT NULL DEFAULT 'created',
    phase TEXT NOT NULL DEFAULT 'planning', base_canvas_version BIGINT NOT NULL DEFAULT 1, step_count INTEGER NOT NULL DEFAULT 0,
    max_steps INTEGER NOT NULL DEFAULT 12, created_at BIGINT NOT NULL, updated_at BIGINT NOT NULL, metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX IF NOT EXISTS idx_canvas_agent_runs_user_updated ON canvas_agent_runs(user_id, updated_at DESC);
CREATE TABLE IF NOT EXISTS canvas_agent_messages (
    id TEXT PRIMARY KEY, run_id TEXT NOT NULL REFERENCES canvas_agent_runs(id) ON DELETE CASCADE, role TEXT NOT NULL,
    content TEXT NOT NULL DEFAULT '', sequence BIGINT NOT NULL, created_at BIGINT NOT NULL, metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb,
    UNIQUE(run_id, sequence)
);
CREATE TABLE IF NOT EXISTS canvas_agent_plans (
    id TEXT PRIMARY KEY, run_id TEXT NOT NULL REFERENCES canvas_agent_runs(id) ON DELETE CASCADE, version INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'draft', content_json JSONB NOT NULL, created_at BIGINT NOT NULL, updated_at BIGINT NOT NULL,
    UNIQUE(run_id, version)
);
CREATE TABLE IF NOT EXISTS canvas_agent_operations (
    id TEXT PRIMARY KEY, run_id TEXT NOT NULL REFERENCES canvas_agent_runs(id) ON DELETE CASCADE, idempotency_key TEXT NOT NULL UNIQUE,
    type TEXT NOT NULL, risk TEXT NOT NULL DEFAULT 'safe', status TEXT NOT NULL DEFAULT 'pending', input_json JSONB NOT NULL DEFAULT '{}'::jsonb,
    result_json JSONB NOT NULL DEFAULT '{}'::jsonb, error TEXT, created_at BIGINT NOT NULL, updated_at BIGINT NOT NULL
);
ALTER TABLE canvas_agent_operations ADD COLUMN IF NOT EXISTS client_request_id TEXT NOT NULL DEFAULT '';
ALTER TABLE canvas_agent_operations ADD COLUMN IF NOT EXISTS lease_owner TEXT;
ALTER TABLE canvas_agent_operations ADD COLUMN IF NOT EXISTS lease_until BIGINT;
ALTER TABLE canvas_agent_operations ADD COLUMN IF NOT EXISTS cancel_requested_at BIGINT;
ALTER TABLE canvas_agent_operations ADD COLUMN IF NOT EXISTS started_at BIGINT;
ALTER TABLE canvas_agent_operations ADD COLUMN IF NOT EXISTS finished_at BIGINT;
CREATE INDEX IF NOT EXISTS idx_canvas_agent_operations_run ON canvas_agent_operations(run_id, created_at);
CREATE INDEX IF NOT EXISTS idx_canvas_agent_operations_claim ON canvas_agent_operations(status, lease_until, created_at);
CREATE TABLE IF NOT EXISTS canvas_agent_artifacts (
    id TEXT PRIMARY KEY, run_id TEXT NOT NULL REFERENCES canvas_agent_runs(id) ON DELETE CASCADE, type TEXT NOT NULL,
    version INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'draft', content_json JSONB NOT NULL, source_artifact_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
    created_at BIGINT NOT NULL, updated_at BIGINT NOT NULL, stale BOOLEAN NOT NULL DEFAULT FALSE,
    approved_by TEXT NOT NULL DEFAULT '', approved_at BIGINT, rejection_note TEXT NOT NULL DEFAULT '', UNIQUE(run_id, type, version)
);
ALTER TABLE canvas_agent_artifacts ADD COLUMN IF NOT EXISTS stale BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE canvas_agent_artifacts ADD COLUMN IF NOT EXISTS approved_by TEXT NOT NULL DEFAULT '';
ALTER TABLE canvas_agent_artifacts ADD COLUMN IF NOT EXISTS approved_at BIGINT;
ALTER TABLE canvas_agent_artifacts ADD COLUMN IF NOT EXISTS rejection_note TEXT NOT NULL DEFAULT '';
CREATE TABLE IF NOT EXISTS canvas_agent_events (
    id TEXT PRIMARY KEY, run_id TEXT NOT NULL REFERENCES canvas_agent_runs(id) ON DELETE CASCADE, sequence BIGINT NOT NULL,
    type TEXT NOT NULL, payload_json JSONB NOT NULL DEFAULT '{}'::jsonb, created_at BIGINT NOT NULL, UNIQUE(run_id, sequence)
);
ALTER TABLE canvas_agent_events ADD COLUMN IF NOT EXISTS operation_id TEXT;
ALTER TABLE canvas_agent_events ADD COLUMN IF NOT EXISTS phase TEXT;
ALTER TABLE canvas_agent_events ADD COLUMN IF NOT EXISTS severity TEXT NOT NULL DEFAULT 'info';
ALTER TABLE canvas_agent_events ADD COLUMN IF NOT EXISTS schema_version INTEGER NOT NULL DEFAULT 1;
CREATE INDEX IF NOT EXISTS idx_canvas_agent_events_run ON canvas_agent_events(run_id, sequence);
CREATE INDEX IF NOT EXISTS idx_canvas_agent_events_operation ON canvas_agent_events(operation_id, sequence);
CREATE TABLE IF NOT EXISTS canvas_agent_event_outbox (
    id TEXT PRIMARY KEY, event_id TEXT NOT NULL UNIQUE REFERENCES canvas_agent_events(id) ON DELETE CASCADE,
    run_id TEXT NOT NULL REFERENCES canvas_agent_runs(id) ON DELETE CASCADE, user_id TEXT NOT NULL,
    topic TEXT NOT NULL, payload_json JSONB NOT NULL, status TEXT NOT NULL DEFAULT 'pending', attempts INTEGER NOT NULL DEFAULT 0,
    available_at BIGINT NOT NULL, delivered_at BIGINT, last_error TEXT NOT NULL DEFAULT '',
    created_at BIGINT NOT NULL, updated_at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_canvas_agent_event_outbox_pending ON canvas_agent_event_outbox(status, available_at, created_at);
CREATE TABLE IF NOT EXISTS canvas_agent_skills (
    id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE, description TEXT NOT NULL DEFAULT '', version TEXT NOT NULL DEFAULT '1',
    enabled BOOLEAN NOT NULL DEFAULT TRUE, metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb, created_at BIGINT NOT NULL, updated_at BIGINT NOT NULL
);
CREATE TABLE IF NOT EXISTS canvas_agent_evaluations (
    id TEXT PRIMARY KEY, scenario_id TEXT NOT NULL, run_id TEXT, metrics_json JSONB NOT NULL,
    created_at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_canvas_agent_evaluations_scenario_created ON canvas_agent_evaluations(scenario_id, created_at DESC);
CREATE TABLE IF NOT EXISTS canvas_agent_templates (
    id TEXT PRIMARY KEY, user_id TEXT NOT NULL, name TEXT NOT NULL, description TEXT NOT NULL DEFAULT '',
    version INTEGER NOT NULL DEFAULT 1, content_json JSONB NOT NULL DEFAULT '{}'::jsonb,
    source_run_id TEXT REFERENCES canvas_agent_runs(id) ON DELETE SET NULL,
    visibility TEXT NOT NULL DEFAULT 'private', created_at BIGINT NOT NULL, updated_at BIGINT NOT NULL,
    UNIQUE(user_id, name, version)
);
CREATE INDEX IF NOT EXISTS idx_canvas_agent_templates_user_updated ON canvas_agent_templates(user_id, updated_at DESC);
CREATE TABLE IF NOT EXISTS canvas_agent_project_assets (
    id TEXT PRIMARY KEY, user_id TEXT NOT NULL, project_id TEXT NOT NULL,
    canvas_id TEXT NOT NULL REFERENCES smart_canvases(id) ON DELETE CASCADE,
    artifact_id TEXT NOT NULL REFERENCES canvas_agent_artifacts(id) ON DELETE CASCADE,
    asset_type TEXT NOT NULL DEFAULT 'artifact', visibility TEXT NOT NULL DEFAULT 'project', created_at BIGINT NOT NULL,
    UNIQUE(user_id, project_id, artifact_id)
);
CREATE INDEX IF NOT EXISTS idx_canvas_agent_project_assets_user_project ON canvas_agent_project_assets(user_id, project_id, created_at DESC);
CREATE TABLE IF NOT EXISTS app_settings (
    key TEXT PRIMARY KEY, value_json JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at BIGINT NOT NULL, updated_at BIGINT NOT NULL, version BIGINT NOT NULL DEFAULT 1
);
ALTER TABLE app_settings ADD COLUMN IF NOT EXISTS version BIGINT NOT NULL DEFAULT 1;
CREATE TABLE IF NOT EXISTS ai_connections (
    id TEXT PRIMARY KEY, protocol TEXT NOT NULL, name TEXT NOT NULL DEFAULT '',
    base_url TEXT NOT NULL DEFAULT '', secret_ref TEXT NOT NULL DEFAULT '',
    enabled BOOLEAN NOT NULL DEFAULT TRUE, primary_connection BOOLEAN NOT NULL DEFAULT FALSE,
    settings_json JSONB NOT NULL DEFAULT '{}'::jsonb, version BIGINT NOT NULL DEFAULT 1,
    created_at BIGINT NOT NULL, updated_at BIGINT NOT NULL
);
CREATE TABLE IF NOT EXISTS ai_connection_secrets (
    connection_id TEXT NOT NULL, secret_name TEXT NOT NULL,
    secret_ciphertext BYTEA NOT NULL, version BIGINT NOT NULL DEFAULT 1,
    updated_at BIGINT NOT NULL, PRIMARY KEY(connection_id, secret_name)
);
CREATE TABLE IF NOT EXISTS ai_models (
    id TEXT PRIMARY KEY, connection_id TEXT NOT NULL REFERENCES ai_connections(id) ON DELETE CASCADE,
    kind TEXT NOT NULL, upstream_model TEXT NOT NULL, protocol TEXT NOT NULL,
    alias TEXT NOT NULL DEFAULT '', capabilities_json JSONB NOT NULL DEFAULT '[]'::jsonb,
    settings_json JSONB NOT NULL DEFAULT '{}'::jsonb,
    enabled BOOLEAN NOT NULL DEFAULT TRUE, created_at BIGINT NOT NULL, updated_at BIGINT NOT NULL
);
ALTER TABLE ai_models ADD COLUMN IF NOT EXISTS settings_json JSONB NOT NULL DEFAULT '{}'::jsonb;
CREATE INDEX IF NOT EXISTS idx_ai_models_connection_kind ON ai_models(connection_id, kind, enabled);
CREATE TABLE IF NOT EXISTS ai_resources (
    id TEXT PRIMARY KEY, connection_id TEXT NOT NULL REFERENCES ai_connections(id) ON DELETE CASCADE,
    kind TEXT NOT NULL, name TEXT NOT NULL DEFAULT '', schema_json JSONB NOT NULL DEFAULT '{}'::jsonb,
    settings_json JSONB NOT NULL DEFAULT '{}'::jsonb, enabled BOOLEAN NOT NULL DEFAULT TRUE,
    created_at BIGINT NOT NULL, updated_at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_ai_resources_connection_kind ON ai_resources(connection_id, kind, enabled);
CREATE TABLE IF NOT EXISTS comfy_workflows (
    name TEXT PRIMARY KEY, workflow_json JSONB NOT NULL, config_json JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at BIGINT NOT NULL, updated_at BIGINT NOT NULL
);
ALTER TABLE comfy_workflows DROP COLUMN IF EXISTS builtin;
CREATE INDEX IF NOT EXISTS idx_comfy_workflows_updated ON comfy_workflows(updated_at DESC);
CREATE TABLE IF NOT EXISTS ai_task_archive (
    task_id TEXT PRIMARY KEY, owner_id TEXT NOT NULL DEFAULT '', task_type TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL,
    created_at DOUBLE PRECISION NOT NULL, completed_at DOUBLE PRECISION NOT NULL,
    upstream_task_id TEXT NOT NULL DEFAULT '', error TEXT NOT NULL DEFAULT '', payload_json JSONB NOT NULL DEFAULT '{}'::jsonb,
    connection_id TEXT NOT NULL DEFAULT '', model_id TEXT NOT NULL DEFAULT '', resource_id TEXT NOT NULL DEFAULT ''
);
ALTER TABLE ai_task_archive ADD COLUMN IF NOT EXISTS connection_id TEXT NOT NULL DEFAULT '';
ALTER TABLE ai_task_archive ADD COLUMN IF NOT EXISTS model_id TEXT NOT NULL DEFAULT '';
ALTER TABLE ai_task_archive ADD COLUMN IF NOT EXISTS resource_id TEXT NOT NULL DEFAULT '';
CREATE INDEX IF NOT EXISTS idx_ai_task_archive_owner_created ON ai_task_archive(owner_id, completed_at DESC);
CREATE TABLE IF NOT EXISTS user_settings (
    user_id TEXT NOT NULL, key TEXT NOT NULL, value_json JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at BIGINT NOT NULL, updated_at BIGINT NOT NULL, PRIMARY KEY(user_id, key)
);
CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY, username TEXT NOT NULL, created_at BIGINT NOT NULL
);
CREATE TABLE IF NOT EXISTS organizations (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, created_at BIGINT NOT NULL, updated_at BIGINT NOT NULL,
    UNIQUE(name)
);
ALTER TABLE users ADD COLUMN IF NOT EXISTS org_id TEXT REFERENCES organizations(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_users_org ON users(org_id);
CREATE TABLE IF NOT EXISTS organization_budgets (
    organization_id TEXT PRIMARY KEY REFERENCES organizations(id) ON DELETE CASCADE,
    monthly_budget_cny NUMERIC(14, 4), enabled BOOLEAN NOT NULL DEFAULT FALSE,
    created_at BIGINT NOT NULL, updated_at BIGINT NOT NULL
);
CREATE TABLE IF NOT EXISTS user_budgets (
    user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    monthly_budget_usd NUMERIC(14, 4) NOT NULL DEFAULT 0, enabled BOOLEAN NOT NULL DEFAULT TRUE,
    created_at BIGINT NOT NULL, updated_at BIGINT NOT NULL
);
ALTER TABLE user_budgets ALTER COLUMN monthly_budget_usd SET DEFAULT 0;
ALTER TABLE user_budgets ALTER COLUMN enabled SET DEFAULT TRUE;
CREATE TABLE IF NOT EXISTS runninghub_usage_records (
    id TEXT PRIMARY KEY, upstream_task_id TEXT NOT NULL UNIQUE,
    connection_id TEXT NOT NULL DEFAULT '', model_id TEXT NOT NULL DEFAULT '', resource_id TEXT NOT NULL DEFAULT '',
    user_id TEXT NOT NULL DEFAULT '', org_id TEXT,
    operation TEXT NOT NULL DEFAULT '', model TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'submitted',
    submitted_at BIGINT NOT NULL, completed_at BIGINT,
    consume_money_cny NUMERIC(14, 4) NOT NULL DEFAULT 0,
    third_party_money_cny NUMERIC(14, 4) NOT NULL DEFAULT 0,
    total_money_cny NUMERIC(14, 4) NOT NULL DEFAULT 0,
    consume_coins NUMERIC(14, 4) NOT NULL DEFAULT 0,
    task_cost_seconds NUMERIC(14, 4) NOT NULL DEFAULT 0,
    raw_usage JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at BIGINT NOT NULL, updated_at BIGINT NOT NULL
);
ALTER TABLE runninghub_usage_records ADD COLUMN IF NOT EXISTS connection_id TEXT NOT NULL DEFAULT '';
ALTER TABLE runninghub_usage_records ADD COLUMN IF NOT EXISTS model_id TEXT NOT NULL DEFAULT '';
ALTER TABLE runninghub_usage_records ADD COLUMN IF NOT EXISTS resource_id TEXT NOT NULL DEFAULT '';
CREATE INDEX IF NOT EXISTS idx_runninghub_usage_org_submitted ON runninghub_usage_records(org_id, submitted_at DESC);
CREATE INDEX IF NOT EXISTS idx_runninghub_usage_user_submitted ON runninghub_usage_records(user_id, submitted_at DESC);
CREATE TABLE IF NOT EXISTS omnilojo_usage_records (
    id TEXT PRIMARY KEY, upstream_log_id TEXT NOT NULL,
    connection_id TEXT NOT NULL DEFAULT '', model_id TEXT NOT NULL DEFAULT '', resource_id TEXT NOT NULL DEFAULT '',
    request_id TEXT NOT NULL DEFAULT '', upstream_request_id TEXT NOT NULL DEFAULT '',
    user_id TEXT NOT NULL DEFAULT '', org_id TEXT, external_username TEXT NOT NULL DEFAULT '', token_name TEXT NOT NULL DEFAULT '',
    model TEXT NOT NULL DEFAULT '', quota NUMERIC(18, 4) NOT NULL DEFAULT 0,
    cost_usd NUMERIC(14, 6) NOT NULL DEFAULT 0, total_money_cny NUMERIC(14, 4) NOT NULL DEFAULT 0,
    prompt_tokens BIGINT NOT NULL DEFAULT 0, completion_tokens BIGINT NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'succeeded', created_at BIGINT NOT NULL, raw_log JSONB NOT NULL DEFAULT '{}'::jsonb,
    inserted_at BIGINT NOT NULL, updated_at BIGINT NOT NULL, UNIQUE(connection_id, upstream_log_id)
);
ALTER TABLE omnilojo_usage_records ADD COLUMN IF NOT EXISTS request_id TEXT NOT NULL DEFAULT '';
ALTER TABLE omnilojo_usage_records ADD COLUMN IF NOT EXISTS upstream_request_id TEXT NOT NULL DEFAULT '';
ALTER TABLE omnilojo_usage_records ADD COLUMN IF NOT EXISTS connection_id TEXT NOT NULL DEFAULT '';
ALTER TABLE omnilojo_usage_records ADD COLUMN IF NOT EXISTS model_id TEXT NOT NULL DEFAULT '';
ALTER TABLE omnilojo_usage_records ADD COLUMN IF NOT EXISTS resource_id TEXT NOT NULL DEFAULT '';
-- Databases created before the canonical-connection cutover keyed usage on
-- provider_id. Backfill connection_id, relax the now-unwritten legacy column
-- and move the dedupe constraint onto connection_id, so an unmigrated
-- deployment does not fail on every usage insert. The legacy column itself is
-- archived and dropped by scripts/drop_ai_legacy_schema.py.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_attribute
             WHERE attrelid='omnilojo_usage_records'::regclass
               AND attname='provider_id' AND attnum > 0 AND NOT attisdropped) THEN
    UPDATE omnilojo_usage_records SET connection_id=provider_id WHERE connection_id='' AND provider_id<>'';
    ALTER TABLE omnilojo_usage_records ALTER COLUMN provider_id DROP NOT NULL;
    ALTER TABLE omnilojo_usage_records ALTER COLUMN provider_id SET DEFAULT '';
  END IF;
  -- The legacy (provider_id, upstream_log_id) key would collide once every new
  -- row leaves provider_id empty, so replace it with the canonical key.
  IF EXISTS (SELECT 1 FROM pg_constraint
             WHERE conrelid='omnilojo_usage_records'::regclass AND contype='u'
               AND pg_get_constraintdef(oid) LIKE '%(provider_id, upstream_log_id)%') THEN
    EXECUTE (SELECT format('ALTER TABLE omnilojo_usage_records DROP CONSTRAINT %I', conname)
             FROM pg_constraint WHERE conrelid='omnilojo_usage_records'::regclass AND contype='u'
               AND pg_get_constraintdef(oid) LIKE '%(provider_id, upstream_log_id)%' LIMIT 1);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                 WHERE conrelid='omnilojo_usage_records'::regclass AND contype='u'
                   AND pg_get_constraintdef(oid) LIKE '%(connection_id, upstream_log_id)%') THEN
    ALTER TABLE omnilojo_usage_records ADD CONSTRAINT omnilojo_usage_connection_log_key UNIQUE(connection_id, upstream_log_id);
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS idx_omnilojo_usage_org_created ON omnilojo_usage_records(org_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_omnilojo_usage_created ON omnilojo_usage_records(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_omnilojo_usage_user_created ON omnilojo_usage_records(user_id, created_at DESC);
-- Protocol-neutral token usage ledger. Historical Omnilojo rows are migrated
-- by scripts/migrate_omnilojo_usage.py, outside application startup.
CREATE TABLE IF NOT EXISTS ai_usage_records (
    id TEXT PRIMARY KEY, protocol TEXT NOT NULL DEFAULT 'openai', upstream_log_id TEXT NOT NULL,
    connection_id TEXT NOT NULL DEFAULT '', model_id TEXT NOT NULL DEFAULT '', resource_id TEXT NOT NULL DEFAULT '',
    request_id TEXT NOT NULL DEFAULT '', upstream_request_id TEXT NOT NULL DEFAULT '',
    user_id TEXT NOT NULL DEFAULT '', org_id TEXT, external_username TEXT NOT NULL DEFAULT '', token_name TEXT NOT NULL DEFAULT '',
    model TEXT NOT NULL DEFAULT '', operation TEXT NOT NULL DEFAULT '', quota NUMERIC(18, 4) NOT NULL DEFAULT 0,
    cost_usd NUMERIC(14, 6) NOT NULL DEFAULT 0, total_money_cny NUMERIC(14, 4) NOT NULL DEFAULT 0,
    prompt_tokens BIGINT NOT NULL DEFAULT 0, completion_tokens BIGINT NOT NULL DEFAULT 0,
    text_input_tokens BIGINT NOT NULL DEFAULT 0, image_input_tokens BIGINT NOT NULL DEFAULT 0,
    cached_tokens BIGINT NOT NULL DEFAULT 0, total_tokens BIGINT NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'succeeded', usage_available BOOLEAN NOT NULL DEFAULT TRUE,
    pricing_configured BOOLEAN NOT NULL DEFAULT FALSE,
    created_at BIGINT NOT NULL, raw_log JSONB NOT NULL DEFAULT '{}'::jsonb,
    inserted_at BIGINT NOT NULL, updated_at BIGINT NOT NULL,
    UNIQUE(protocol, connection_id, upstream_log_id)
);
ALTER TABLE ai_usage_records ADD COLUMN IF NOT EXISTS protocol TEXT NOT NULL DEFAULT 'openai';
ALTER TABLE ai_usage_records ADD COLUMN IF NOT EXISTS operation TEXT NOT NULL DEFAULT '';
ALTER TABLE ai_usage_records ADD COLUMN IF NOT EXISTS cached_tokens BIGINT NOT NULL DEFAULT 0;
ALTER TABLE ai_usage_records ADD COLUMN IF NOT EXISTS total_tokens BIGINT NOT NULL DEFAULT 0;
ALTER TABLE ai_usage_records ADD COLUMN IF NOT EXISTS text_input_tokens BIGINT NOT NULL DEFAULT 0;
ALTER TABLE ai_usage_records ADD COLUMN IF NOT EXISTS image_input_tokens BIGINT NOT NULL DEFAULT 0;
ALTER TABLE ai_usage_records ADD COLUMN IF NOT EXISTS usage_available BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE ai_usage_records ADD COLUMN IF NOT EXISTS pricing_configured BOOLEAN NOT NULL DEFAULT FALSE;
CREATE INDEX IF NOT EXISTS idx_ai_usage_org_created ON ai_usage_records(org_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_usage_created ON ai_usage_records(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_usage_user_created ON ai_usage_records(user_id, created_at DESC);
CREATE TABLE IF NOT EXISTS user_sessions (
    token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    username TEXT NOT NULL, created_at BIGINT NOT NULL, last_seen BIGINT NOT NULL, expires_at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_user_sessions_expires ON user_sessions(expires_at);
CREATE TABLE IF NOT EXISTS feedback_entries (
    id TEXT PRIMARY KEY, user_id TEXT NOT NULL, username TEXT NOT NULL, type TEXT NOT NULL,
    content TEXT NOT NULL, page TEXT NOT NULL DEFAULT '', user_agent TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'open', admin_note TEXT NOT NULL DEFAULT '',
    created_at BIGINT NOT NULL, updated_at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_feedback_status_created ON feedback_entries(status, created_at DESC);
CREATE TABLE IF NOT EXISTS help_pages (
    slug TEXT PRIMARY KEY, content TEXT NOT NULL DEFAULT '', updated_at BIGINT NOT NULL
);
"""


def _connect():
    return database_connection_sync()


def initialize_business_metadata() -> bool:
    if not DATABASE_URL:
        raise RuntimeError("业务元数据系统必须配置 DATABASE_URL；不支持本地 JSON 存储")
    with _connect() as conn:
        with conn.cursor() as cur:
            cur.execute(BUSINESS_METADATA_SQL)
    migrate_local_workflows()
    return True


def new_id() -> str:
    return str(uuid.uuid4())


def json_value(value: Any) -> str:
    return json.dumps(value if value is not None else {}, ensure_ascii=False)


def sync_ai_legacy_projection(providers: Iterable[dict[str, Any]], workflows: Iterable[dict[str, Any]] = ()) -> int:
    """Idempotently import legacy providers into the new AI resource tables."""
    from urllib.parse import quote
    now = int(time.time() * 1000)
    count = 0
    rows = [item for item in (providers or []) if isinstance(item, dict) and item.get("id")]
    if not rows:
        return 0
    with metadata_connection() as conn, conn.cursor() as cur:
        # A previous projection version attached workflows to every Provider.
        # Clear only migration-owned rows before rebuilding the canonical set.
        cur.execute("DELETE FROM ai_resources WHERE id LIKE 'legacy:%'")
        for provider in rows:
            pid = str(provider["id"]).strip().lower()
            connection_id = f"legacy:{pid}"
            cur.execute(
                """INSERT INTO ai_connections(id,protocol,name,base_url,enabled,primary_connection,settings_json,created_at,updated_at)
                VALUES(%s,%s,%s,%s,%s,%s,%s,%s,%s)
                ON CONFLICT(id) DO UPDATE SET protocol=EXCLUDED.protocol,name=EXCLUDED.name,base_url=EXCLUDED.base_url,
                enabled=EXCLUDED.enabled,primary_connection=EXCLUDED.primary_connection,settings_json=EXCLUDED.settings_json,updated_at=EXCLUDED.updated_at""",
                (connection_id, str(provider.get("protocol") or "openai"), str(provider.get("name") or pid), str(provider.get("base_url") or ""), bool(provider.get("enabled", True)), bool(provider.get("primary", False)), json_value(provider), now, now),
            )
            # Copy centralized secrets once to the connection namespace. The
            # old secret remains readable only during this migration release.
            try:
                from app.services.connection_secrets import (
                    get_connection_secret,
                    set_connection_secret,
                )
                secret = get_connection_secret(f"legacy:{pid}", "api_key")
                if secret:
                    set_connection_secret(connection_id, "api_key", secret)
                for name in ("omnilojo_management_token", "access_key_id", "secret_access_key"):
                    value = get_connection_secret(f"legacy:{pid}", name)
                    if value:
                        set_connection_secret(connection_id, name, value)
            except RuntimeError:
                # APP_SECRET_KEY is optional for legacy .env deployments; the
                # final deployment validator rejects that mode before cutover.
                pass
            # This import owns only legacy-namespaced execution resources.
            # Rebuild them so a repeated import cannot attach a workflow to an
            # unrelated connection or retain removed RunningHub applications.
            cur.execute("DELETE FROM ai_resources WHERE connection_id=%s", (connection_id,))
            for kind, key in (("chat", "chat_models"), ("image", "image_models"), ("video", "video_models")):
                for raw_model in provider.get(key) or []:
                    model = str(raw_model or "").strip()
                    if not model:
                        continue
                    model_id = f"{connection_id}:{kind}:{quote(model, safe='')}"
                    # Legacy projections now carry one canonical protocol per
                    # connection; no per-model protocol override is consulted.
                    protocol = str(provider.get("protocol") or "openai").strip().lower()
                    cur.execute(
                        """INSERT INTO ai_models(id,connection_id,kind,upstream_model,protocol,alias,capabilities_json,settings_json,created_at,updated_at)
                        VALUES(%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
                        ON CONFLICT(id) DO UPDATE SET protocol=EXCLUDED.protocol,alias=EXCLUDED.alias,capabilities_json=EXCLUDED.capabilities_json,settings_json=EXCLUDED.settings_json,updated_at=EXCLUDED.updated_at""",
                        (model_id, connection_id, kind, model, protocol, str((provider.get("model_aliases") or {}).get(model) or model), json_value([]), json_value({"parameter_schema": (((provider.get("parameter_schema") or {}).get("models") or {}).get(model) or {})}), now, now),
                    )
                    count += 1
            if pid == "runninghub":
                for app in provider.get("rh_apps") or []:
                    if not isinstance(app, dict) or not (app.get("id") or app.get("appId") or app.get("webappId")):
                        continue
                    app_id = str(app.get("id") or app.get("appId") or app.get("webappId"))
                    resource_id = f"{connection_id}:runninghub_app:{quote(app_id, safe='')}"
                    cur.execute("""INSERT INTO ai_resources(id,connection_id,kind,name,schema_json,settings_json,created_at,updated_at)
                        VALUES(%s,%s,'runninghub_app',%s,%s,%s,%s,%s)""",
                        (resource_id, connection_id, str(app.get("name") or app_id), json_value(app.get("fields") or {}), json_value(app), now, now))
            if pid == "comfyui":
                for workflow in (workflows or []):
                    if not isinstance(workflow, dict) or not workflow.get("name"):
                        continue
                    resource_id = f"{connection_id}:comfyui_workflow:{quote(str(workflow['name']), safe='')}"
                    cur.execute("""INSERT INTO ai_resources(id,connection_id,kind,name,schema_json,settings_json,created_at,updated_at)
                        VALUES(%s,%s,'comfyui_workflow',%s,%s,%s,%s,%s)""",
                        (resource_id, connection_id, str(workflow["name"]), json_value(workflow.get("config") or {}), json_value(workflow), now, now))
    return count


def migrate_local_workflows() -> int:
    """Import legacy workflow JSON/config files without overwriting DB edits."""
    from app.config import WORKFLOW_DIR
    now = int(time.time() * 1000)
    imported = 0
    if not os.path.isdir(WORKFLOW_DIR):
        return 0
    rows = []
    for root, _, files in os.walk(WORKFLOW_DIR):
        for filename in files:
            if not filename.endswith('.json') or filename.endswith('.config.json'):
                continue
            path = os.path.join(root, filename)
            rel = os.path.relpath(path, WORKFLOW_DIR).replace(os.sep, '/')
            try:
                with open(path, encoding='utf-8') as f:
                    workflow = json.load(f)
                cfg_path = path[:-5] + '.config.json'
                config = {}
                if os.path.exists(cfg_path):
                    with open(cfg_path, encoding='utf-8') as f:
                        config = json.load(f) or {}
                rows.append((rel, json_value(workflow), json_value(config), now, now))
            except (OSError, ValueError, TypeError):
                continue
    if not rows:
        return 0
    with metadata_connection() as conn, conn.cursor() as cur:
        for row in rows:
            cur.execute("""INSERT INTO comfy_workflows(name,workflow_json,config_json,created_at,updated_at)
                VALUES(%s,%s,%s,%s,%s) ON CONFLICT(name) DO NOTHING RETURNING name""", row)
            if cur.fetchone():
                imported += 1
    return imported


def list_comfy_workflows() -> list[dict[str, Any]]:
    with metadata_connection() as conn, conn.cursor() as cur:
        cur.execute("SELECT name,config_json FROM comfy_workflows")
        rows = cur.fetchall()
    result = []
    for row in rows:
        config = row['config_json'] or {}
        result.append({'name': row['name'], 'title': config.get('title') or row['name'].replace('.json', ''), 'note': config.get('note') or '', 'field_count': len(config.get('fields') or []), 'media': config.get('media') if config.get('media') in {'image','video'} else 'image', 'cover': config.get('cover') if isinstance(config.get('cover'), dict) else {}, 'enabled': config.get('enabled', True) is not False})
    return sorted(result, key=lambda item: (0 if item['name'].startswith('custom/') else 1, item['title']))


def get_comfy_workflow(name: str) -> dict[str, Any] | None:
    with metadata_connection() as conn, conn.cursor() as cur:
        cur.execute("SELECT name,workflow_json,config_json FROM comfy_workflows WHERE name=%s", (name,))
        row = cur.fetchone()
    if not row:
        return None
    config = dict(row['config_json'] or {})
    config.setdefault('title', name.replace('.json', ''))
    config.setdefault('fields', [])
    config['media'] = config.get('media') if config.get('media') in {'image','video'} else 'image'
    config['enabled'] = config.get('enabled', True) is not False
    return {'name': row['name'], 'workflow': row['workflow_json'], 'config': config}


def save_comfy_workflow_config(name: str, config: dict[str, Any]) -> dict[str, Any] | None:
    from app.core.utils import now_ms
    config = dict(config or {})
    config['media'] = config.get('media') if config.get('media') in {'image','video'} else 'image'
    with metadata_connection() as conn, conn.cursor() as cur:
        cur.execute("UPDATE comfy_workflows SET config_json=%s,updated_at=%s WHERE name=%s RETURNING config_json", (json_value(config), now_ms(), name))
        row = cur.fetchone()
    return row['config_json'] if row else None


def delete_comfy_workflow(name: str) -> bool:
    with metadata_connection() as conn, conn.cursor() as cur:
        cur.execute("DELETE FROM comfy_workflows WHERE name=%s RETURNING name", (name,))
        return cur.fetchone() is not None


def dedupe_runninghub_resources() -> int:
    """Collapse duplicate RH resources into one canonical row per app ID.

    Older projections could create several ``ai_resources`` rows for the same
    RunningHub application.  Runtime selection is keyed by the external app
    ID, so retain the newest row and merge useful settings before deleting
    duplicates.  The resulting resource uses the canonical ``id/appId/
    webappId`` aliases required by the new format.
    """
    with metadata_connection() as conn, conn.cursor() as cur:
        cur.execute("SELECT id,connection_id,name,settings_json,enabled,updated_at FROM ai_resources WHERE kind='runninghub_app' ORDER BY updated_at DESC,id DESC")
        rows = cur.fetchall()
        groups: dict[str, list[Any]] = {}
        for row in rows:
            settings = dict(row['settings_json'] or {})
            raw = settings.get('raw') if isinstance(settings.get('raw'), dict) else {}
            app_id = str(raw.get('webappId') or raw.get('appId') or settings.get('webappId') or settings.get('appId') or settings.get('id') or '').strip()
            if not app_id:
                continue
            groups.setdefault(app_id, []).append((row, settings))
        removed = 0
        for app_id, entries in groups.items():
            primary, primary_settings = entries[0]
            merged = {}
            for row, settings in reversed(entries):
                merged.update(settings)
            merged['app_id'] = app_id
            for key in ('id', 'appId', 'webappId'):
                merged.pop(key, None)
            name = str(primary['name'] or merged.get('title') or app_id)
            cur.execute("UPDATE ai_resources SET name=%s,settings_json=%s,updated_at=%s WHERE id=%s", (name, json_value(merged), now_ms(), primary['id']))
            for duplicate, _ in entries[1:]:
                cur.execute("DELETE FROM ai_resources WHERE id=%s", (duplicate['id'],))
                removed += 1
        return removed


def _file_refs(value: Any, field_name: str = ""):
    if isinstance(value, dict):
        file_id = str(value.get("file_id") or "").strip()
        if file_id:
            yield file_id, field_name, str(value.get("role") or "")
        for key, child in value.items():
            yield from _file_refs(child, str(key))
    elif isinstance(value, list):
        for child in value:
            yield from _file_refs(child, field_name)


def insert_history_record(user_id: str, record: Dict[str, Any], file_refs: Iterable[Dict[str, Any]] = ()) -> str:
    """Insert a history record and its file references atomically."""
    from app.core.utils import now_ms
    rid = new_id()
    raw_created = record.get("created_at")
    if raw_created is None and record.get("timestamp") is not None:
        raw_created = float(record.get("timestamp") or 0) * 1000
    try:
        now = int(raw_created) if raw_created else now_ms()
    except (TypeError, ValueError):
        now = now_ms()
    extra = dict(record.get("extra_json") or {})
    extra.update({
        key: value for key, value in record.items()
        if key not in {"id", "user_id", "type", "prompt", "is_cloud", "timestamp", "created_at", "updated_at", "images", "image_refs", "extra_json"}
    })
    with _connect() as conn:
        with conn.transaction():
            with conn.cursor() as cur:
                cur.execute("INSERT INTO history_records(id,user_id,type,prompt,is_cloud,created_at,updated_at,extra_json) VALUES(%s,%s,%s,%s,%s,%s,%s,%s)", (rid, user_id, record.get('type','zimage'), record.get('prompt',''), bool(record.get('is_cloud')), now, now, json_value(extra)))
                for order, ref in enumerate(file_refs):
                    fid = str(ref.get('file_id') or '').strip()
                    if fid:
                        cur.execute("INSERT INTO history_record_files(id,history_record_id,file_id,sort_order,role,created_at) SELECT %s,%s,%s,%s,%s,%s WHERE EXISTS (SELECT 1 FROM files WHERE id=%s AND deleted_at IS NULL AND status <> 'deleted' FOR KEY SHARE)", (new_id(), rid, fid, order, ref.get('role',''), now, fid))
    return rid


def metadata_connection():
    """Return a PostgreSQL connection; business metadata never has a JSON fallback."""
    if not DATABASE_URL:
        raise RuntimeError("业务元数据系统必须配置 DATABASE_URL")
    return _connect()


def get_app_setting(key: str, default: Any = None) -> Any:
    with metadata_connection() as conn, conn.cursor() as cur:
        cur.execute("SELECT value_json FROM app_settings WHERE key=%s", (key,))
        row = cur.fetchone()
    return row["value_json"] if row else default


def get_app_setting_with_version(key: str, default: Any = None) -> tuple[Any, int]:
    with metadata_connection() as conn, conn.cursor() as cur:
        cur.execute("SELECT value_json,version FROM app_settings WHERE key=%s", (key,))
        row = cur.fetchone()
    return (row["value_json"], int(row["version"])) if row else (default, 0)


def set_app_setting(key: str, value: Any) -> Any:
    from app.core.utils import now_ms
    now = now_ms()
    with metadata_connection() as conn, conn.cursor() as cur:
        cur.execute("INSERT INTO app_settings(key,value_json,created_at,updated_at) VALUES(%s,%s,%s,%s) ON CONFLICT(key) DO UPDATE SET value_json=EXCLUDED.value_json,updated_at=EXCLUDED.updated_at,version=app_settings.version+1", (key, json_value(value), now, now))
    return value


def set_app_setting_if_version(key: str, value: Any, expected_version: int) -> int | None:
    """Compare-and-set an application setting and return its next version."""
    from app.core.utils import now_ms
    now = now_ms()
    with metadata_connection() as conn, conn.cursor() as cur:
        cur.execute(
            """INSERT INTO app_settings(key,value_json,created_at,updated_at,version)
               VALUES(%s,%s,%s,%s,1)
               ON CONFLICT(key) DO UPDATE SET value_json=EXCLUDED.value_json,
                   updated_at=EXCLUDED.updated_at,version=app_settings.version+1
               WHERE app_settings.version=%s RETURNING version""",
            (key, json_value(value), now, now, expected_version),
        )
        row = cur.fetchone()
    return int(row["version"]) if row else None


def archive_ai_task(task: Dict[str, Any]) -> None:
    """Persist a terminal task once so Redis expiration does not erase its audit trail."""
    from app.core.utils import now_ms
    task_id = str(task.get("id") or "").strip()
    if not task_id:
        return
    request = task.get("request") if isinstance(task.get("request"), dict) else {}
    connection_id = str(task.get("connection_id") or request.get("connection_id") or "")
    model_id = str(task.get("model_id") or request.get("model_id") or "")
    resource_id = str(task.get("resource_id") or request.get("resource_id") or "")
    payload = {key: value for key, value in task.items() if key not in {"request", "result", "provider_id", "provider", "model"}}
    payload.update({key: value for key, value in {
        "connection_id": connection_id, "model_id": model_id, "resource_id": resource_id,
    }.items() if value})
    with metadata_connection() as conn, conn.cursor() as cur:
        cur.execute(
            """INSERT INTO ai_task_archive(task_id,owner_id,task_type,status,created_at,completed_at,upstream_task_id,error,payload_json,connection_id,model_id,resource_id)
               VALUES(%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
               ON CONFLICT(task_id) DO UPDATE SET status=EXCLUDED.status, completed_at=EXCLUDED.completed_at,
                 upstream_task_id=EXCLUDED.upstream_task_id, error=EXCLUDED.error, payload_json=EXCLUDED.payload_json,
                 connection_id=EXCLUDED.connection_id, model_id=EXCLUDED.model_id, resource_id=EXCLUDED.resource_id""",
            (task_id, str(task.get("owner_id") or ""), str(task.get("type") or ""), str(task.get("status") or ""),
             float(task.get("created_at") or now_ms() / 1000), float(task.get("updated_at") or now_ms() / 1000),
             str(task.get("upstream_task_id") or ""), str(task.get("error") or ""), json_value(payload),
             connection_id, model_id, resource_id),
        )


def get_user_setting(user_id: str, key: str, default: Any = None) -> Any:
    with metadata_connection() as conn, conn.cursor() as cur:
        cur.execute("SELECT value_json FROM user_settings WHERE user_id=%s AND key=%s", (user_id, key))
        row = cur.fetchone()
    return row["value_json"] if row else default


def set_user_setting(user_id: str, key: str, value: Any) -> Any:
    from app.core.utils import now_ms
    now = now_ms()
    with metadata_connection() as conn, conn.cursor() as cur:
        cur.execute("INSERT INTO user_settings(user_id,key,value_json,created_at,updated_at) VALUES(%s,%s,%s,%s,%s) ON CONFLICT(user_id,key) DO UPDATE SET value_json=EXCLUDED.value_json,updated_at=EXCLUDED.updated_at", (user_id, key, json_value(value), now, now))
    return value


def save_canvas_payload(user_id: str, canvas: Dict[str, Any]) -> None:
    now = int(canvas.get("updated_at") or 0)
    payload = dict(canvas)
    nodes = payload.pop("nodes", [])
    try:
        deleted_at = int(payload.get("deleted_at") or 0) or None
    except (TypeError, ValueError):
        deleted_at = None
    with metadata_connection() as conn, conn.transaction(), conn.cursor() as cur:
        cur.execute("INSERT INTO smart_canvases(id,user_id,title,icon,owner,color,pinned,created_at,updated_at,deleted_at,viewport_json,version) VALUES(%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s) ON CONFLICT(id) DO UPDATE SET title=EXCLUDED.title,icon=EXCLUDED.icon,owner=EXCLUDED.owner,color=EXCLUDED.color,pinned=EXCLUDED.pinned,updated_at=EXCLUDED.updated_at,deleted_at=EXCLUDED.deleted_at,viewport_json=EXCLUDED.viewport_json,version=smart_canvases.version+1", (payload["id"], user_id, payload.get("title", ""), payload.get("icon", ""), payload.get("owner", ""), payload.get("color", ""), bool(payload.get("pinned")), payload.get("created_at", now), now, deleted_at, json_value({"viewport": payload.get("viewport", {}), "payload": {k:v for k,v in payload.items() if k not in {"id","title","icon","owner","color","pinned","created_at","updated_at","deleted_at","viewport","version"}}}), int(payload.get("version") or 1)))
        cur.execute("SELECT id,sort_order,data_json FROM smart_canvas_nodes WHERE canvas_id=%s", (payload["id"],))
        existing_nodes = {row["id"]: row for row in cur.fetchall()}
        for order, node in enumerate(nodes):
            node_id = node.get("id") or new_id()
            node["id"] = node_id
            existing = existing_nodes.pop(node_id, None)
            node_changed = existing is None or existing["data_json"] != node
            if existing is None:
                cur.execute("INSERT INTO smart_canvas_nodes(id,canvas_id,node_type,position_x,position_y,sort_order,data_json,created_at,updated_at) VALUES(%s,%s,%s,%s,%s,%s,%s,%s,%s)", (node_id, payload["id"], node.get("type", node.get("node_type", "")), float(node.get("x", 0) or 0), float(node.get("y", 0) or 0), order, json_value(node), node.get("created_at", now), now))
            elif node_changed or existing["sort_order"] != order:
                cur.execute("UPDATE smart_canvas_nodes SET node_type=%s,position_x=%s,position_y=%s,sort_order=%s,data_json=%s,updated_at=%s WHERE id=%s AND canvas_id=%s", (node.get("type", node.get("node_type", "")), float(node.get("x", 0) or 0), float(node.get("y", 0) or 0), order, json_value(node), now, node_id, payload["id"]))
            old_refs = list(_file_refs(existing["data_json"])) if existing else []
            new_refs = list(_file_refs(node))
            if existing is None or old_refs != new_refs:
                if existing is not None:
                    cur.execute("DELETE FROM smart_canvas_node_files WHERE node_id=%s", (node_id,))
                for ref_order, (file_id, field_name, role) in enumerate(new_refs):
                    cur.execute("INSERT INTO smart_canvas_node_files(id,node_id,file_id,field_name,sort_order,role) SELECT %s,%s,%s,%s,%s,%s WHERE EXISTS (SELECT 1 FROM files WHERE id=%s AND deleted_at IS NULL AND status <> 'deleted' FOR KEY SHARE)", (new_id(), node_id, file_id, field_name, ref_order, role, file_id))
        for removed_node_id in existing_nodes:
            cur.execute("DELETE FROM smart_canvas_nodes WHERE id=%s AND canvas_id=%s", (removed_node_id, payload["id"]))


def update_canvas_metadata(user_id: str, canvas_id: str, *, title: Optional[str] = None,
                           icon: Optional[str] = None, owner: Optional[str] = None,
                           color: Optional[str] = None, pinned: Optional[bool] = None) -> Optional[Dict[str, Any]]:
    """Update canvas metadata without loading or rewriting its nodes."""
    with metadata_connection() as conn, conn.cursor() as cur:
        cur.execute(
            """WITH updated AS (
                   UPDATE smart_canvases
                   SET title=COALESCE(%s,title), icon=COALESCE(%s,icon),
                       owner=COALESCE(%s,owner), color=COALESCE(%s,color),
                       pinned=COALESCE(%s,pinned)
                   WHERE id=%s AND user_id=%s
                   RETURNING id,title,icon,owner,color,pinned,created_at,updated_at,version
               )
               SELECT updated.*, (SELECT COUNT(*) FROM smart_canvas_nodes WHERE canvas_id=updated.id) AS node_count
               FROM updated""",
            (title, icon, owner, color, pinned, canvas_id, user_id),
        )
        return cur.fetchone()


def touch_canvas_payload(user_id: str, canvas_id: str, updated_at: int) -> Optional[Dict[str, Any]]:
    """Advance a canvas timestamp without rewriting its nodes or file references."""
    with metadata_connection() as conn, conn.cursor() as cur:
        cur.execute(
            """WITH updated AS (
                   UPDATE smart_canvases SET updated_at=%s
                   WHERE id=%s AND user_id=%s
                   RETURNING id,title,icon,owner,color,pinned,created_at,updated_at,version
               )
               SELECT updated.*, (SELECT COUNT(*) FROM smart_canvas_nodes WHERE canvas_id=updated.id) AS node_count
               FROM updated""",
            (updated_at, canvas_id, user_id),
        )
        return cur.fetchone()


def load_canvas_payload(user_id: str, canvas_id: str) -> Optional[Dict[str, Any]]:
    with metadata_connection() as conn, conn.cursor() as cur:
        cur.execute("SELECT * FROM smart_canvases WHERE id=%s AND user_id=%s", (canvas_id, user_id)); row = cur.fetchone()
        if not row: return None
        cur.execute("SELECT data_json FROM smart_canvas_nodes WHERE canvas_id=%s ORDER BY sort_order", (canvas_id,)); nodes = [r["data_json"] for r in cur.fetchall()]
    meta = row.get("viewport_json") or {}; payload = dict(meta.get("payload") or {})
    payload.update({"id": row["id"], "title": row["title"], "icon": row["icon"], "owner": row["owner"], "color": row["color"], "pinned": row["pinned"], "created_at": row["created_at"], "updated_at": row["updated_at"], "deleted_at": row["deleted_at"], "version": int(row.get("version") or 1), "viewport": meta.get("viewport") or {}, "nodes": nodes})
    return payload


def _latest_canvas_image_ref(node: Any) -> Optional[Dict[str, str]]:
    """Return the newest image reference from one image node payload."""
    if not isinstance(node, dict) or not isinstance(node.get("images"), list):
        return None
    for item in reversed(node["images"]):
        if not isinstance(item, dict):
            continue
        kind = str(item.get("kind") or "image").strip().lower()
        if kind in {"video", "audio"}:
            continue
        file_id = str(item.get("file_id") or "").strip()
        url = str(item.get("url") or "").strip()
        if file_id or url:
            return {"file_id": file_id, "url": url}
    return None


def list_canvas_records(user_id: str) -> list:
    """聚合查询画布列表，并按画布提取一个最新图像节点的引用。

    只通过 LATERAL 子查询读取每个画布的一条候选节点，避免「先查全部 id
    再逐个 load_canvas_payload」的 N+1 + 全量节点加载模式。
    返回的字典字段与 load_canvas_payload 的元数据字段保持一致（不含 nodes/viewport），
    交由调用方复用现有的规范化逻辑（如 canvas_record）。
    """
    with metadata_connection() as conn, conn.cursor() as cur:
        cur.execute(
            """
            SELECT c.id, c.title, c.icon, c.owner, c.color, c.pinned,
                   c.created_at, c.updated_at, c.version, c.viewport_json,
                   COUNT(n.id) AS node_count, latest_image.data_json AS latest_image_json
            FROM smart_canvases c
            LEFT JOIN smart_canvas_nodes n ON n.canvas_id = c.id
            LEFT JOIN LATERAL (
                SELECT image_node.data_json
                FROM smart_canvas_nodes image_node
                WHERE image_node.canvas_id = c.id
                  AND jsonb_typeof(image_node.data_json->'images') = 'array'
                  AND jsonb_array_length(image_node.data_json->'images') > 0
                  AND EXISTS (
                      SELECT 1
                      FROM jsonb_array_elements(image_node.data_json->'images') image_ref
                      WHERE COALESCE(image_ref->>'kind', 'image') NOT IN ('video', 'audio')
                        AND (image_ref ? 'file_id' OR image_ref ? 'url')
                  )
                ORDER BY image_node.updated_at DESC, image_node.sort_order DESC
                LIMIT 1
            ) latest_image ON TRUE
            WHERE c.user_id=%s AND c.deleted_at IS NULL
            GROUP BY c.id, c.title, c.icon, c.owner, c.color, c.pinned,
                     c.created_at, c.updated_at, c.version, c.viewport_json, latest_image.data_json
            """,
            (user_id,),
        )
        rows = cur.fetchall()
    records = []
    for row in rows:
        meta = row.get("viewport_json") or {}
        payload = dict(meta.get("payload") or {})
        thumbnail = _latest_canvas_image_ref(row.get("latest_image_json"))
        records.append({
            "id": row["id"],
            "title": row["title"],
            "icon": row["icon"],
            "owner": row["owner"],
            "color": row["color"],
            "pinned": row["pinned"],
            "created_at": row["created_at"],
            "updated_at": row["updated_at"],
            "version": int(row.get("version") or 1),
            "kind": payload.get("kind"),
            "node_count": int(row["node_count"] or 0),
            "thumbnail": thumbnail or {},
        })
    return records


def delete_canvas_payload(user_id: str, canvas_id: str) -> None:
    with metadata_connection() as conn, conn.cursor() as cur:
        cur.execute("DELETE FROM smart_canvases WHERE id=%s AND user_id=%s", (canvas_id, user_id))
