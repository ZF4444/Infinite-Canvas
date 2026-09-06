"""Prometheus metrics shared by database, storage, and background jobs."""

from __future__ import annotations

from prometheus_client import CollectorRegistry, Counter, Gauge, Histogram, generate_latest


REGISTRY = CollectorRegistry()

DB_POOL_SIZE = Gauge("mediaforge_pg_pool_size", "Current PostgreSQL pool size.", registry=REGISTRY)
DB_POOL_AVAILABLE = Gauge("mediaforge_pg_pool_available", "Idle PostgreSQL pool connections.", registry=REGISTRY)
DB_POOL_WAITING = Gauge("mediaforge_pg_pool_waiting", "Requests currently waiting for a PostgreSQL connection.", registry=REGISTRY)
DB_POOL_WAIT_SECONDS = Histogram(
    "mediaforge_pg_pool_wait_seconds",
    "Time spent waiting to check out a PostgreSQL connection.",
    buckets=(0.001, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2, 3, 5),
    registry=REGISTRY,
)
DB_QUERY_SECONDS = Histogram(
    "mediaforge_pg_query_seconds",
    "PostgreSQL query duration by operation and result.",
    ("operation", "status"),
    buckets=(0.001, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2, 5, 10),
    registry=REGISTRY,
)
DB_SLOW_QUERIES = Counter(
    "mediaforge_pg_slow_queries_total",
    "Queries exceeding the configured slow-query threshold.",
    ("operation",),
    registry=REGISTRY,
)
DB_ACTIVE_CONNECTIONS = Gauge("mediaforge_pg_active_connections", "Active PostgreSQL sessions for the current database.", registry=REGISTRY)
DB_LOCK_WAITING = Gauge("mediaforge_pg_lock_waiting", "PostgreSQL sessions waiting on locks.", registry=REGISTRY)

REDIS_AVAILABLE = Gauge(
    "mediaforge_redis_available",
    "Whether the required Redis authentication cache is reachable.",
    registry=REGISTRY,
)
REDIS_OPERATION_SECONDS = Histogram(
    "mediaforge_redis_operation_seconds",
    "Redis operation duration.",
    ("operation",),
    buckets=(0.0005, 0.001, 0.0025, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1),
    registry=REGISTRY,
)
AUTH_SESSION_CACHE_REQUESTS = Counter(
    "mediaforge_auth_session_cache_requests_total",
    "Authentication session cache lookups by result.",
    ("result",),
    registry=REGISTRY,
)

MINIO_OPERATION_SECONDS = Histogram(
    "mediaforge_minio_operation_seconds",
    "MinIO operation duration by operation and result.",
    ("operation", "status"),
    buckets=(0.001, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2, 5, 10, 30),
    registry=REGISTRY,
)
MINIO_FAILURES = Counter(
    "mediaforge_minio_failures_total",
    "Failed MinIO operations.",
    ("operation", "error_type"),
    registry=REGISTRY,
)
BLOCKING_IO_ACTIVE = Gauge(
    "mediaforge_blocking_io_active",
    "Synchronous storage operations currently running in worker threads.",
    registry=REGISTRY,
)
BLOCKING_IO_QUEUED = Gauge(
    "mediaforge_blocking_io_queued",
    "Synchronous storage operations waiting for a worker thread.",
    registry=REGISTRY,
)
BLOCKING_IO_REJECTED = Counter(
    "mediaforge_blocking_io_rejected_total",
    "Synchronous storage operations rejected because the bounded adapter is full.",
    registry=REGISTRY,
)
MINIO_BUCKET_BYTES = Gauge(
    "mediaforge_minio_bucket_catalog_bytes",
    "Active object bytes registered in PostgreSQL by MinIO bucket.",
    ("bucket",),
    registry=REGISTRY,
)
MINIO_BUCKET_OBJECTS = Gauge(
    "mediaforge_minio_bucket_catalog_objects",
    "Active objects registered in PostgreSQL by MinIO bucket.",
    ("bucket",),
    registry=REGISTRY,
)

STORAGE_CACHE_BYTES = Gauge(
    "mediaforge_storage_cache_bytes",
    "Bytes currently used by materialized local media cache files.",
    registry=REGISTRY,
)
STORAGE_CACHE_FILES = Gauge(
    "mediaforge_storage_cache_files",
    "Files currently stored in the materialized local media cache.",
    registry=REGISTRY,
)
STORAGE_CACHE_HITS = Counter(
    "mediaforge_storage_cache_hits_total",
    "Materialized media cache hits.",
    registry=REGISTRY,
)
STORAGE_CACHE_MISSES = Counter(
    "mediaforge_storage_cache_misses_total",
    "Materialized media cache misses.",
    registry=REGISTRY,
)
STORAGE_CACHE_EVICTIONS = Counter(
    "mediaforge_storage_cache_evictions_total",
    "Local media cache files evicted by reason.",
    ("reason",),
    registry=REGISTRY,
)
STORAGE_CACHE_DOWNLOAD_BYTES = Counter(
    "mediaforge_storage_cache_download_bytes_total",
    "Bytes downloaded from MinIO while materializing local cache files.",
    registry=REGISTRY,
)
STORAGE_CACHE_MATERIALIZE_SECONDS = Histogram(
    "mediaforge_storage_cache_materialize_seconds",
    "Time spent resolving a materialized local media path.",
    ("result",),
    buckets=(0.001, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2, 5, 10, 30, 60),
    registry=REGISTRY,
)
STORAGE_CACHE_CLEANUP_FAILURES = Counter(
    "mediaforge_storage_cache_cleanup_failures_total",
    "Failed local media cache cleanup runs.",
    registry=REGISTRY,
)

BACKGROUND_FAILURES = Counter(
    "mediaforge_background_failures_total",
    "Background job failures that require alerting.",
    ("job",),
    registry=REGISTRY,
)
BACKGROUND_RUNS = Counter(
    "mediaforge_background_runs_total",
    "Completed background job runs by result.",
    ("job", "status"),
    registry=REGISTRY,
)

TRANSIENT_RETRIES = Counter(
    "mediaforge_transient_retries_total",
    "Retries of transient dependency failures.",
    ("backend", "operation"),
    registry=REGISTRY,
)

AI_CONNECTION_REQUESTS = Counter(
    "mediaforge_ai_connection_requests_total",
    "AI connection operations by connection, operation, and result.",
    ("connection", "operation", "status"),
    registry=REGISTRY,
)
AI_CONNECTION_REQUEST_SECONDS = Histogram(
    "mediaforge_ai_connection_request_seconds",
    "AI connection operation duration by connection and operation.",
    ("connection", "operation"),
    buckets=(0.1, 0.25, 0.5, 1, 2, 5, 10, 30, 60, 120, 300, 600, 1800),
    registry=REGISTRY,
)
AI_CONNECTION_INFLIGHT = Gauge(
    "mediaforge_ai_connection_inflight",
    "AI connection operations currently executing.",
    ("connection", "operation"),
    registry=REGISTRY,
)

AGENT_RUNS = Counter(
    "mediaforge_canvas_agent_runs_total",
    "Canvas Agent runs by mode and terminal/current status.",
    ("mode", "status"),
    registry=REGISTRY,
)
AGENT_FAILURES = Counter(
    "mediaforge_canvas_agent_failures_total",
    "Canvas Agent failures classified by stage and category.",
    ("stage", "category"),
    registry=REGISTRY,
)
AGENT_OPERATION_SECONDS = Histogram(
    "mediaforge_canvas_agent_operation_seconds",
    "Canvas Agent operation latency.",
    ("operation", "status"),
    buckets=(0.001, 0.01, 0.1, 0.5, 1, 2, 5, 10, 30, 60, 300),
    registry=REGISTRY,
)
AGENT_EVENT_OUTBOX = Gauge(
    "mediaforge_canvas_agent_event_outbox",
    "Canvas Agent durable event outbox records by status.",
    ("status",),
    registry=REGISTRY,
)
AGENT_EVENT_PUBLISHES = Counter(
    "mediaforge_canvas_agent_event_publishes_total",
    "Canvas Agent outbox publish attempts by result.",
    ("result",),
    registry=REGISTRY,
)
AGENT_EVENT_PRESENTATION_INVALID = Counter(
    "mediaforge_canvas_agent_event_presentation_invalid_total",
    "Canvas Agent events whose presentation metadata was dropped during validation.",
    registry=REGISTRY,
)
AGENT_EVENT_TOOL_GROUP_TIMEOUTS = Counter(
    "mediaforge_canvas_agent_tool_group_timeouts_total",
    "Canvas Agent tool progress groups force-closed after exceeding the timeout.",
    registry=REGISTRY,
)
AGENT_EVENT_PRESENTATION_UNKNOWN_TARGETS = Counter(
    "mediaforge_canvas_agent_event_presentation_unknown_targets_total",
    "Unknown Canvas Agent presentation targets reported by clients.",
    registry=REGISTRY,
)
AGENT_EVENT_OPEN_TOOL_GROUPS = Gauge(
    "mediaforge_canvas_agent_open_tool_groups",
    "Currently open Canvas Agent tool progress groups observed by the scanner.",
    registry=REGISTRY,
)


def update_pool_stats(stats: dict) -> None:
    DB_POOL_SIZE.set(float(stats.get("pool_size", 0) or 0))
    DB_POOL_AVAILABLE.set(float(stats.get("pool_available", 0) or 0))
    DB_POOL_WAITING.set(float(stats.get("requests_waiting", 0) or 0))


def render_metrics() -> bytes:
    return generate_latest(REGISTRY)
