"""集中配置：路径常量、环境变量、全局锁与队列。

从 main.py 的「配置区域」原样迁移，值保持完全一致。

注意 BASE_DIR：本文件位于 app/ 下，项目根是其上一级目录，
因此用 dirname(dirname(__file__)) 还原出与原 main.py 相同的 BASE_DIR。
"""
import os
import tempfile
import uuid
from threading import Lock

# --- 路径常量 ---
CLIENT_ID = str(uuid.uuid4())
# 项目根目录（app/ 的上一级），与原 main.py 中 BASE_DIR 取值一致
BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
WORKFLOW_DIR = os.path.join(BASE_DIR, "workflows")
WORKFLOW_PATH = os.path.join(WORKFLOW_DIR, "Z-Image.json")
STATIC_DIR = os.path.join(BASE_DIR, "static")
API_ENV_FILE = os.path.join(BASE_DIR, "API", ".env")
DATA_DIR = os.path.join(BASE_DIR, "data")
HELP_DEFAULT_PAGE = "index"
LOCAL_IMAGE_IMPORT_MAX_BYTES = int(os.getenv("LOCAL_IMAGE_IMPORT_MAX_BYTES", str(50 * 1024 * 1024)))
LOCAL_IMAGE_IMPORT_EXTS = {".png", ".jpg", ".jpeg", ".webp", ".gif"}

# --- 对象存储配置 ---
DATABASE_URL = str(os.getenv("DATABASE_URL", "")).strip()
DATABASE_POOL_MIN_SIZE = int(os.getenv("DATABASE_POOL_MIN_SIZE", "4"))
DATABASE_POOL_MAX_SIZE = int(os.getenv("DATABASE_POOL_MAX_SIZE", "20"))
DATABASE_POOL_TIMEOUT_SECONDS = float(os.getenv("DATABASE_POOL_TIMEOUT_SECONDS", "3"))
DATABASE_CONNECT_TIMEOUT_SECONDS = int(os.getenv("DATABASE_CONNECT_TIMEOUT_SECONDS", "5"))
DATABASE_POOL_MAX_IDLE_SECONDS = float(os.getenv("DATABASE_POOL_MAX_IDLE_SECONDS", "300"))
DATABASE_POOL_MAX_LIFETIME_SECONDS = float(os.getenv("DATABASE_POOL_MAX_LIFETIME_SECONDS", "3600"))
DATABASE_STATEMENT_TIMEOUT_MS = int(os.getenv("DATABASE_STATEMENT_TIMEOUT_MS", "10000"))
DATABASE_LOCK_TIMEOUT_MS = int(os.getenv("DATABASE_LOCK_TIMEOUT_MS", "3000"))
DATABASE_SLOW_QUERY_THRESHOLD_MS = float(os.getenv("DATABASE_SLOW_QUERY_THRESHOLD_MS", "500"))
REDIS_URL = str(os.getenv("REDIS_URL", "")).strip()
REDIS_MAX_CONNECTIONS = int(os.getenv("REDIS_MAX_CONNECTIONS", "200"))
REDIS_CONNECT_TIMEOUT_SECONDS = float(os.getenv("REDIS_CONNECT_TIMEOUT_SECONDS", "1"))
# Canvas workers use a 1-second Redis Streams long poll. Keep the command
# timeout comfortably above it so an empty queue is not treated as an outage.
REDIS_SOCKET_TIMEOUT_SECONDS = float(os.getenv("REDIS_SOCKET_TIMEOUT_SECONDS", "5"))
REDIS_SESSION_PREFIX = str(os.getenv("REDIS_SESSION_PREFIX", "mediaforge:session:")).strip()
REDIS_LAST_SEEN_WRITE_INTERVAL_SECONDS = int(os.getenv("REDIS_LAST_SEEN_WRITE_INTERVAL_SECONDS", "60"))
REDIS_LAST_SEEN_FLUSH_INTERVAL_SECONDS = int(os.getenv("REDIS_LAST_SEEN_FLUSH_INTERVAL_SECONDS", "300"))
REDIS_CANVAS_TASK_PREFIX = str(os.getenv("REDIS_CANVAS_TASK_PREFIX", "mediaforge:canvas-task:")).strip()
REDIS_CANVAS_TASK_TTL_SECONDS = max(300, int(os.getenv("REDIS_CANVAS_TASK_TTL_SECONDS", str(7 * 24 * 60 * 60))))
CANVAS_TASK_TIMEOUT_SECONDS = max(30, int(os.getenv("CANVAS_TASK_TIMEOUT_SECONDS", "900")))
REDIS_CANVAS_TASK_LEASE_SECONDS = max(15, int(os.getenv("REDIS_CANVAS_TASK_LEASE_SECONDS", "90")))
REDIS_CANVAS_TASK_RECOVERY_INTERVAL_SECONDS = max(5, int(os.getenv("REDIS_CANVAS_TASK_RECOVERY_INTERVAL_SECONDS", "15")))
REDIS_CANVAS_TASK_STREAM = str(os.getenv("REDIS_CANVAS_TASK_STREAM", "mediaforge:canvas-task:queue")).strip()
REDIS_CANVAS_TASK_CONSUMER_GROUP = str(os.getenv("REDIS_CANVAS_TASK_CONSUMER_GROUP", "canvas-workers")).strip()
REDIS_WEBSOCKET_CHANNEL = str(os.getenv("REDIS_WEBSOCKET_CHANNEL", "mediaforge:websocket-events")).strip()
REDIS_AGENT_EVENT_CHANNEL = str(os.getenv("REDIS_AGENT_EVENT_CHANNEL", "mediaforge:agent-events")).strip()
AGENT_EVENT_OUTBOX_POLL_SECONDS = max(0.05, float(os.getenv("AGENT_EVENT_OUTBOX_POLL_SECONDS", "0.25")))
AGENT_EVENT_OUTBOX_BATCH_SIZE = max(1, int(os.getenv("AGENT_EVENT_OUTBOX_BATCH_SIZE", "100")))
AGENT_EVENT_TOOL_GROUP_TIMEOUT_SECONDS = max(30, int(os.getenv("AGENT_EVENT_TOOL_GROUP_TIMEOUT_SECONDS", "300")))
AGENT_EVENT_TOOL_GROUP_SCAN_SECONDS = max(5, int(os.getenv("AGENT_EVENT_TOOL_GROUP_SCAN_SECONDS", "15")))
AGENT_COMMAND_WORKER_ENABLED = str(os.getenv("AGENT_COMMAND_WORKER_ENABLED", "true")).strip().lower() in {"1", "true", "yes", "on"}
AGENT_COMMAND_POLL_SECONDS = max(0.05, float(os.getenv("AGENT_COMMAND_POLL_SECONDS", "0.25")))
REDIS_CANVAS_TASK_DISPATCH_TTL_SECONDS = max(30, int(os.getenv("REDIS_CANVAS_TASK_DISPATCH_TTL_SECONDS", "120")))
REDIS_CANVAS_TASK_PENDING_CLAIM_IDLE_MS = max(1_000, int(os.getenv("REDIS_CANVAS_TASK_PENDING_CLAIM_IDLE_MS", "120000")))
REDIS_CANVAS_TASK_STREAM_MAXLEN = max(1_000, int(os.getenv("REDIS_CANVAS_TASK_STREAM_MAXLEN", "10000")))
CANVAS_TASK_WORKER_ENABLED = str(os.getenv("CANVAS_TASK_WORKER_ENABLED", "true")).strip().lower() in {"1", "true", "yes", "on"}
CANVAS_TASK_RECOVERY_ENABLED = str(os.getenv("CANVAS_TASK_RECOVERY_ENABLED", "true")).strip().lower() in {"1", "true", "yes", "on"}
CANVAS_TASK_WORKER_CONCURRENCY = max(1, int(os.getenv("CANVAS_TASK_WORKER_CONCURRENCY", "100")))
MINIO_ENDPOINT = str(os.getenv("MINIO_ENDPOINT", "")).strip()
MINIO_ACCESS_KEY = str(os.getenv("MINIO_ACCESS_KEY", "")).strip()
MINIO_SECRET_KEY = str(os.getenv("MINIO_SECRET_KEY", "")).strip()
MINIO_SECURE = str(os.getenv("MINIO_SECURE", "false")).strip().lower() in {"1", "true", "yes", "on"}
MINIO_CONNECT_TIMEOUT_SECONDS = float(os.getenv("MINIO_CONNECT_TIMEOUT_SECONDS", "5"))
MINIO_READ_TIMEOUT_SECONDS = float(os.getenv("MINIO_READ_TIMEOUT_SECONDS", "30"))
BLOCKING_IO_WORKERS = max(1, int(os.getenv("BLOCKING_IO_WORKERS", "12")))
BLOCKING_IO_QUEUE_LIMIT = max(0, int(os.getenv("BLOCKING_IO_QUEUE_LIMIT", "50")))
# --- 共享外部 HTTP 客户端（应用级单例，避免每次请求重建连接池） ---
HTTP_CLIENT_TIMEOUT_CONNECT_SECONDS = float(os.getenv("HTTP_CLIENT_TIMEOUT_CONNECT_SECONDS", "20"))
HTTP_CLIENT_TIMEOUT_READ_SECONDS = float(os.getenv("HTTP_CLIENT_TIMEOUT_READ_SECONDS", "300"))
HTTP_CLIENT_TIMEOUT_WRITE_SECONDS = float(os.getenv("HTTP_CLIENT_TIMEOUT_WRITE_SECONDS", "60"))
HTTP_CLIENT_TIMEOUT_POOL_SECONDS = float(os.getenv("HTTP_CLIENT_TIMEOUT_POOL_SECONDS", "60"))
HTTP_CLIENT_MAX_CONNECTIONS = int(os.getenv("HTTP_CLIENT_MAX_CONNECTIONS", "200"))
HTTP_CLIENT_KEEPALIVE_CONNECTIONS = int(os.getenv("HTTP_CLIENT_KEEPALIVE_CONNECTIONS", "100"))
HEALTH_CHECK_TIMEOUT_SECONDS = float(os.getenv("HEALTH_CHECK_TIMEOUT_SECONDS", "5"))
TRANSIENT_RETRY_MAX_ATTEMPTS = int(os.getenv("TRANSIENT_RETRY_MAX_ATTEMPTS", "3"))
TRANSIENT_RETRY_BASE_DELAY_SECONDS = float(os.getenv("TRANSIENT_RETRY_BASE_DELAY_SECONDS", "0.2"))
TRANSIENT_RETRY_MAX_DELAY_SECONDS = float(os.getenv("TRANSIENT_RETRY_MAX_DELAY_SECONDS", "1"))
TRANSIENT_RETRY_JITTER_SECONDS = float(os.getenv("TRANSIENT_RETRY_JITTER_SECONDS", "0.1"))
MINIO_BUCKET_PRIVATE = str(os.getenv("MINIO_BUCKET_PRIVATE", "mediaforge-private")).strip() or "mediaforge-private"
MINIO_BUCKET_PUBLIC = str(os.getenv("MINIO_BUCKET_PUBLIC", "mediaforge-public")).strip() or "mediaforge-public"
MINIO_BUCKET_TEMP = str(os.getenv("MINIO_BUCKET_TEMP", "mediaforge-temp")).strip() or "mediaforge-temp"
STORAGE_CACHE_DIR = str(
    os.getenv("STORAGE_CACHE_DIR", os.path.join(tempfile.gettempdir(), "mediaforge-storage-cache"))
).strip() or os.path.join(tempfile.gettempdir(), "mediaforge-storage-cache")
STORAGE_CACHE_CLEANUP_ENABLED = str(
    os.getenv("STORAGE_CACHE_CLEANUP_ENABLED", "true")
).strip().lower() in {"1", "true", "yes", "on"}
STORAGE_CACHE_MAX_BYTES = int(os.getenv("STORAGE_CACHE_MAX_BYTES", str(20 * 1024 * 1024 * 1024)))
STORAGE_CACHE_TARGET_BYTES = int(os.getenv("STORAGE_CACHE_TARGET_BYTES", str(15 * 1024 * 1024 * 1024)))
STORAGE_CACHE_IDLE_TTL_SECONDS = int(os.getenv("STORAGE_CACHE_IDLE_TTL_SECONDS", str(7 * 24 * 60 * 60)))
STORAGE_CACHE_CLEANUP_INTERVAL_SECONDS = int(os.getenv("STORAGE_CACHE_CLEANUP_INTERVAL_SECONDS", "600"))
STORAGE_CACHE_TMP_TTL_SECONDS = int(os.getenv("STORAGE_CACHE_TMP_TTL_SECONDS", "3600"))
STORAGE_CACHE_ACCESS_GRACE_SECONDS = int(os.getenv("STORAGE_CACHE_ACCESS_GRACE_SECONDS", "900"))
STORAGE_CACHE_MIN_FREE_BYTES = int(os.getenv("STORAGE_CACHE_MIN_FREE_BYTES", str(10 * 1024 * 1024 * 1024)))
STORAGE_CACHE_ACCESS_TOUCH_INTERVAL_SECONDS = int(os.getenv("STORAGE_CACHE_ACCESS_TOUCH_INTERVAL_SECONDS", "300"))
STORAGE_CACHE_ORPHAN_SCAN_ENABLED = str(os.getenv("STORAGE_CACHE_ORPHAN_SCAN_ENABLED", "true")).strip().lower() in {"1", "true", "yes", "on"}
STORAGE_CACHE_ORPHAN_SCAN_INTERVAL_SECONDS = int(os.getenv("STORAGE_CACHE_ORPHAN_SCAN_INTERVAL_SECONDS", "86400"))
STORAGE_CACHE_CLEANUP_BATCH_SIZE = int(os.getenv("STORAGE_CACHE_CLEANUP_BATCH_SIZE", "1000"))
STORAGE_CACHE_DRY_RUN = str(os.getenv("STORAGE_CACHE_DRY_RUN", "false")).strip().lower() in {"1", "true", "yes", "on"}
STORAGE_QUOTA_ENABLED = str(os.getenv("STORAGE_QUOTA_ENABLED", "true")).strip().lower() in {"1", "true", "yes", "on"}
STORAGE_USER_QUOTA_BYTES = int(os.getenv("STORAGE_USER_QUOTA_BYTES", str(10 * 1024 * 1024 * 1024)))
STORAGE_CLEANUP_ENABLED = str(os.getenv("STORAGE_CLEANUP_ENABLED", "true")).strip().lower() in {"1", "true", "yes", "on"}
STORAGE_CLEANUP_INTERVAL_SECONDS = int(os.getenv("STORAGE_CLEANUP_INTERVAL_SECONDS", "3600"))
STORAGE_CLEANUP_BATCH_SIZE = int(os.getenv("STORAGE_CLEANUP_BATCH_SIZE", "500"))
STORAGE_METADATA_PURGE_ENABLED = str(os.getenv("STORAGE_METADATA_PURGE_ENABLED", "true")).strip().lower() in {"1", "true", "yes", "on"}
STORAGE_METADATA_PURGE_RETENTION_DAYS = int(os.getenv("STORAGE_METADATA_PURGE_RETENTION_DAYS", "7"))
STORAGE_INPUT_RETENTION_DAYS = int(os.getenv("STORAGE_INPUT_RETENTION_DAYS", "7"))
STORAGE_UPLOAD_RETENTION_DAYS = int(os.getenv("STORAGE_UPLOAD_RETENTION_DAYS", "7"))
STORAGE_OUTPUT_RETENTION_DAYS = int(os.getenv("STORAGE_OUTPUT_RETENTION_DAYS", "7"))
STORAGE_TEMP_RETENTION_DAYS = int(os.getenv("STORAGE_TEMP_RETENTION_DAYS", "3"))

# --- 有界阻塞 IO 适配层（同步 MinIO SDK 统一入口） ---
# 所有异步路由调用同步 MinIO SDK 时必须经过 app.core.storage_io.run_storage_io，
# 不允许在业务代码中直接使用 asyncio.to_thread()/anyio.to_thread.run_sync()，
# 否则无法统一控制并发、队列长度和指标。

# --- 模型字段默认值/校验所需常量 ---
VOLCENGINE_DEFAULT_PROJECT_NAME = "default"
VOLCENGINE_DEFAULT_REGION = "cn-beijing"
ONLINE_IMAGE_PROMPT_MAX_LENGTH = int(os.getenv("ONLINE_IMAGE_PROMPT_MAX_LENGTH", "20000"))
VIDEO_PROMPT_MAX_LENGTH = int(os.getenv("VIDEO_PROMPT_MAX_LENGTH", "4000"))
LLM_MESSAGE_MAX_LENGTH = int(os.getenv("LLM_MESSAGE_MAX_LENGTH", "20000"))
# 视频任务轮询超时（秒）
VIDEO_POLL_TIMEOUT = float(os.getenv("VIDEO_POLL_TIMEOUT", "1800"))

# --- 全局锁 ---
TASK_ID_LOCK = Lock()
HISTORY_LOCK = Lock()
GLOBAL_CONFIG_LOCK = Lock()
FEEDBACK_LOCK = Lock()
HELP_LOCK = Lock()
ANNOUNCEMENT_LOCK = Lock()
CONVERSATION_LOCK = Lock()
CANVAS_LOCK = Lock()
LOAD_LOCK = Lock()
