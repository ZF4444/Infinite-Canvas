"""Shared asynchronous PostgreSQL connection-pool lifecycle and access helpers."""

from __future__ import annotations

import asyncio
from contextlib import asynccontextmanager
import re
from threading import Lock
import time
from typing import Any

import psycopg

from app.config import (
    DATABASE_CONNECT_TIMEOUT_SECONDS,
    DATABASE_LOCK_TIMEOUT_MS,
    DATABASE_POOL_MAX_IDLE_SECONDS,
    DATABASE_POOL_MAX_LIFETIME_SECONDS,
    DATABASE_POOL_MAX_SIZE,
    DATABASE_POOL_MIN_SIZE,
    DATABASE_POOL_TIMEOUT_SECONDS,
    DATABASE_SLOW_QUERY_THRESHOLD_MS,
    DATABASE_STATEMENT_TIMEOUT_MS,
    DATABASE_URL,
)
from app.core.logging import get_logger
from app.core.metrics import (
    DB_ACTIVE_CONNECTIONS,
    DB_LOCK_WAITING,
    DB_POOL_WAIT_SECONDS,
    DB_QUERY_SECONDS,
    DB_SLOW_QUERIES,
    TRANSIENT_RETRIES,
    update_pool_stats,
)
from app.core.retry import retry_delay_seconds, retry_max_attempts, retry_operation_id


logger = get_logger("database")
_POOL: Any = None
_POOL_LOCK = Lock()
_DATABASE_LOOP: asyncio.AbstractEventLoop | None = None


class DatabaseUnavailableError(RuntimeError):
    """A transient PostgreSQL failure that should be exposed as HTTP 503."""


def _query_operation(query: Any) -> str:
    text = str(query or "").lstrip()
    match = re.match(r"([A-Za-z]+)", text)
    return (match.group(1).upper() if match else "OTHER")[:16]


class ObservableAsyncCursor(psycopg.AsyncCursor):
    """Async cursor that records query latency without exposing SQL or parameters."""

    async def execute(self, query, params=None, *, prepare=None, binary=None):
        operation = _query_operation(query)
        started = time.perf_counter()
        status = "success"
        try:
            return await super().execute(query, params, prepare=prepare, binary=binary)
        except Exception:
            status = "error"
            raise
        finally:
            elapsed = time.perf_counter() - started
            DB_QUERY_SECONDS.labels(operation=operation, status=status).observe(elapsed)
            if elapsed * 1000 >= DATABASE_SLOW_QUERY_THRESHOLD_MS:
                DB_SLOW_QUERIES.labels(operation=operation).inc()
                logger.warning(
                    "slow PostgreSQL query",
                    extra={
                        "event": "database_slow_query",
                        "operation": operation,
                        "duration_ms": round(elapsed * 1000, 2),
                    },
                )


def _validate_pool_settings() -> None:
    if DATABASE_POOL_MIN_SIZE < 0:
        raise RuntimeError("DATABASE_POOL_MIN_SIZE 不能小于 0")
    if DATABASE_POOL_MAX_SIZE < 1 or DATABASE_POOL_MAX_SIZE < DATABASE_POOL_MIN_SIZE:
        raise RuntimeError("DATABASE_POOL_MAX_SIZE 必须大于等于 DATABASE_POOL_MIN_SIZE 且至少为 1")
    if DATABASE_POOL_TIMEOUT_SECONDS <= 0 or DATABASE_CONNECT_TIMEOUT_SECONDS <= 0:
        raise RuntimeError("数据库连接与连接池超时必须大于 0")
    if DATABASE_STATEMENT_TIMEOUT_MS < 1000 or DATABASE_LOCK_TIMEOUT_MS < 1000:
        raise RuntimeError("数据库语句与锁超时不能小于 1000 毫秒")


async def open_database_pool() -> Any:
    """Create and warm the process-local async pool during application startup."""
    global _POOL, _DATABASE_LOOP
    if _POOL is not None:
        return _POOL
    if not DATABASE_URL:
        raise RuntimeError("业务元数据系统必须配置 DATABASE_URL")

    _validate_pool_settings()
    with _POOL_LOCK:
        if _POOL is not None:
            return _POOL
        try:
            from psycopg.rows import dict_row
            from psycopg_pool import AsyncConnectionPool
        except ImportError as exc:
            raise RuntimeError("PostgreSQL 异步连接池依赖不可用，请执行 uv sync") from exc

        _DATABASE_LOOP = asyncio.get_running_loop()
        _POOL = AsyncConnectionPool(
            conninfo=DATABASE_URL,
            min_size=DATABASE_POOL_MIN_SIZE,
            max_size=DATABASE_POOL_MAX_SIZE,
            timeout=DATABASE_POOL_TIMEOUT_SECONDS,
            max_idle=DATABASE_POOL_MAX_IDLE_SECONDS,
            max_lifetime=DATABASE_POOL_MAX_LIFETIME_SECONDS,
            kwargs={
                "autocommit": True,
                "row_factory": dict_row,
                "cursor_factory": ObservableAsyncCursor,
                "connect_timeout": DATABASE_CONNECT_TIMEOUT_SECONDS,
                "options": (
                    f"-c statement_timeout={DATABASE_STATEMENT_TIMEOUT_MS} "
                    f"-c lock_timeout={DATABASE_LOCK_TIMEOUT_MS}"
                ),
            },
            open=False,
        )
        pool = _POOL
    try:
        await pool.open(wait=True, timeout=DATABASE_POOL_TIMEOUT_SECONDS)
    except Exception:
        await pool.close(timeout=DATABASE_POOL_TIMEOUT_SECONDS)
        with _POOL_LOCK:
            if _POOL is pool:
                _POOL = None
                _DATABASE_LOOP = None
        raise
    logger.info(
        "PostgreSQL async connection pool opened",
        extra={
            "event": "database_pool_opened",
            "min_size": DATABASE_POOL_MIN_SIZE,
            "max_size": DATABASE_POOL_MAX_SIZE,
            "timeout_seconds": DATABASE_POOL_TIMEOUT_SECONDS,
        },
    )
    return pool


def _is_transient_database_error(exc: BaseException) -> bool:
    try:
        from psycopg_pool import PoolTimeout
    except ImportError:
        return False
    return isinstance(exc, (PoolTimeout, psycopg.OperationalError, psycopg.errors.QueryCanceled))


@asynccontextmanager
async def database_connection(*, max_attempts: int | None = None):
    """Check out an async pooled connection and normalize transient failures."""
    started = time.perf_counter()
    wait_observed = False
    operation_id = retry_operation_id("db")
    connection_context = None
    try:
        attempts = retry_max_attempts() if max_attempts is None else max(1, int(max_attempts))
        for attempt in range(1, attempts + 1):
            try:
                pool = await open_database_pool()
                connection_context = pool.connection(timeout=DATABASE_POOL_TIMEOUT_SECONDS)
                conn = await connection_context.__aenter__()
                break
            except Exception as exc:
                if connection_context is not None:
                    try:
                        await connection_context.__aexit__(type(exc), exc, exc.__traceback__)
                    except Exception:
                        pass
                    connection_context = None
                if not _is_transient_database_error(exc) or attempt >= attempts:
                    raise
                delay = retry_delay_seconds(attempt)
                TRANSIENT_RETRIES.labels(backend="postgres", operation="connection_checkout").inc()
                logger.warning(
                    "retrying PostgreSQL connection checkout",
                    extra={
                        "event": "database_retry_scheduled",
                        "operation": "connection_checkout",
                        "operation_id": operation_id,
                        "attempt": attempt,
                        "max_attempts": attempts,
                        "delay_seconds": round(delay, 3),
                        "error_type": type(exc).__name__,
                    },
                )
                await asyncio.sleep(delay)
        else:
            raise DatabaseUnavailableError("PostgreSQL 服务暂时不可用，请稍后重试")

        DB_POOL_WAIT_SECONDS.observe(time.perf_counter() - started)
        wait_observed = True
        try:
            yield conn
        except BaseException as exc:
            if connection_context is not None:
                await connection_context.__aexit__(type(exc), exc, exc.__traceback__)
                connection_context = None
            raise
        finally:
            if connection_context is not None:
                await connection_context.__aexit__(None, None, None)
    except DatabaseUnavailableError:
        raise
    except Exception as exc:
        if not _is_transient_database_error(exc):
            raise
        logger.warning(
            "PostgreSQL unavailable",
            extra={
                "event": "database_unavailable",
                "operation_id": operation_id,
                "error_type": type(exc).__name__,
            },
        )
        raise DatabaseUnavailableError("PostgreSQL 服务暂时不可用，请稍后重试") from exc
    finally:
        if not wait_observed:
            DB_POOL_WAIT_SECONDS.observe(time.perf_counter() - started)


def _run_on_database_loop(coro):
    loop = _DATABASE_LOOP
    if loop is None or not loop.is_running():
        # The caller has already created a coroutine (for example,
        # ``context.__aenter__()``). Close it before rejecting the sync bridge
        # so a failed availability probe does not leak an un-awaited coroutine.
        if hasattr(coro, "close"):
            coro.close()
        raise RuntimeError("PostgreSQL 异步连接池尚未启动")
    try:
        running_loop = asyncio.get_running_loop()
    except RuntimeError:
        running_loop = None
    if running_loop is loop:
        if hasattr(coro, "close"):
            coro.close()
        raise RuntimeError("事件循环中禁止使用同步数据库桥；请 await database_connection()")
    return asyncio.run_coroutine_threadsafe(coro, loop).result()


class _SyncCursorProxy:
    def __init__(self, async_connection):
        self._connection = async_connection
        self._context = None
        self._cursor = None

    def __enter__(self):
        self._context = self._connection.cursor()
        self._cursor = _run_on_database_loop(self._context.__aenter__())
        return self

    def __exit__(self, exc_type, exc, traceback):
        return _run_on_database_loop(self._context.__aexit__(exc_type, exc, traceback))

    def execute(self, query, params=None):
        _run_on_database_loop(self._cursor.execute(query, params))
        return self

    def fetchone(self):
        return _run_on_database_loop(self._cursor.fetchone())

    def fetchall(self):
        return _run_on_database_loop(self._cursor.fetchall())


class _SyncTransactionProxy:
    def __init__(self, async_connection):
        self._context = async_connection.transaction()

    def __enter__(self):
        _run_on_database_loop(self._context.__aenter__())
        return self

    def __exit__(self, exc_type, exc, traceback):
        return _run_on_database_loop(self._context.__aexit__(exc_type, exc, traceback))


class _SyncConnectionProxy:
    def __init__(self, async_connection):
        self._connection = async_connection

    def cursor(self):
        return _SyncCursorProxy(self._connection)

    def transaction(self):
        return _SyncTransactionProxy(self._connection)


class _SyncDatabaseConnection:
    """Thread-only compatibility bridge backed by the shared async pool."""

    def __init__(self, max_attempts: int | None):
        self._context = database_connection(max_attempts=max_attempts)

    def __enter__(self):
        connection = _run_on_database_loop(self._context.__aenter__())
        return _SyncConnectionProxy(connection)

    def __exit__(self, exc_type, exc, traceback):
        return _run_on_database_loop(self._context.__aexit__(exc_type, exc, traceback))


def database_connection_sync(*, max_attempts: int | None = None):
    """Use the async pool from an existing worker thread.

    This bridge exists for synchronous MinIO/media workflows while those paths
    are migrated. It deliberately rejects calls made on the application event
    loop so synchronous database access cannot silently block requests.
    """

    return _SyncDatabaseConnection(max_attempts)


async def refresh_database_metrics() -> None:
    """Refresh point-in-time pool, active-session, and lock-wait gauges."""
    pool = _POOL
    if pool is None:
        return
    update_pool_stats(pool.get_stats())
    try:
        async with database_connection() as conn:
            async with conn.cursor() as cur:
                await cur.execute(
                    """
                    SELECT
                        COUNT(*) FILTER (WHERE state = 'active') AS active,
                        COUNT(*) FILTER (WHERE wait_event_type = 'Lock') AS lock_waiting
                    FROM pg_stat_activity
                    WHERE datname = current_database()
                    """
                )
                row = await cur.fetchone() or {}
        DB_ACTIVE_CONNECTIONS.set(int(row.get("active") or 0))
        DB_LOCK_WAITING.set(int(row.get("lock_waiting") or 0))
    except Exception:
        logger.exception("failed to refresh PostgreSQL metrics", extra={"event": "database_metrics_refresh_failed"})


async def close_database_pool() -> None:
    """Stop accepting checkouts and release all PostgreSQL connections."""
    global _POOL, _DATABASE_LOOP
    with _POOL_LOCK:
        pool = _POOL
        _POOL = None
    if pool is None:
        _DATABASE_LOOP = None
        return
    await pool.close(timeout=DATABASE_POOL_TIMEOUT_SECONDS)
    _DATABASE_LOOP = None
    logger.info("PostgreSQL async connection pool closed", extra={"event": "database_pool_closed"})
