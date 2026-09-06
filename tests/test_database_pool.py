import asyncio
import sys
from types import SimpleNamespace

import pytest

from app.core import database


class FakePool:
    instances = []

    def __init__(self, **kwargs):
        self.kwargs = kwargs
        self.open_calls = []
        self.close_calls = []
        self.connection_calls = []
        FakePool.instances.append(self)

    async def open(self, **kwargs):
        self.open_calls.append(kwargs)

    async def close(self, **kwargs):
        self.close_calls.append(kwargs)

    def connection(self, **kwargs):
        self.connection_calls.append(kwargs)
        return FakeConnection()


class FakeConnection:
    async def __aenter__(self):
        return "connection"

    async def __aexit__(self, *_args):
        return False


def test_database_pool_is_shared_and_uses_configured_timeouts(monkeypatch):
    FakePool.instances.clear()
    monkeypatch.setattr(database, "_POOL", None)
    monkeypatch.setattr(database, "DATABASE_URL", "postgresql://example/mediaforge")
    monkeypatch.setattr(database, "DATABASE_POOL_MIN_SIZE", 2)
    monkeypatch.setattr(database, "DATABASE_POOL_MAX_SIZE", 8)
    monkeypatch.setattr(database, "DATABASE_POOL_TIMEOUT_SECONDS", 4.0)
    monkeypatch.setattr(database, "DATABASE_CONNECT_TIMEOUT_SECONDS", 6)
    monkeypatch.setitem(sys.modules, "psycopg_pool", SimpleNamespace(AsyncConnectionPool=FakePool))

    async def scenario():
        first = await database.open_database_pool()
        second = await database.open_database_pool()

        assert first is second
        assert len(FakePool.instances) == 1
        assert first.kwargs["min_size"] == 2
        assert first.kwargs["max_size"] == 8
        assert first.kwargs["kwargs"]["connect_timeout"] == 6
        assert "statement_timeout=" in first.kwargs["kwargs"]["options"]
        assert first.open_calls == [{"wait": True, "timeout": 4.0}]
        async with database.database_connection() as conn:
            assert conn == "connection"
        assert first.connection_calls == [{"timeout": 4.0}]

        await database.close_database_pool()
        assert first.close_calls == [{"timeout": 4.0}]

    asyncio.run(scenario())


def test_database_pool_rejects_invalid_sizes(monkeypatch):
    monkeypatch.setattr(database, "_POOL", None)
    monkeypatch.setattr(database, "DATABASE_URL", "postgresql://example/mediaforge")
    monkeypatch.setattr(database, "DATABASE_POOL_MIN_SIZE", 5)
    monkeypatch.setattr(database, "DATABASE_POOL_MAX_SIZE", 2)

    try:
        asyncio.run(database.open_database_pool())
    except RuntimeError as exc:
        assert "DATABASE_POOL_MAX_SIZE" in str(exc)
    else:
        raise AssertionError("invalid pool sizes should fail before opening a pool")


def test_sync_database_bridge_rejects_event_loop_calls(monkeypatch):
    async def scenario():
        monkeypatch.setattr(database, "_DATABASE_LOOP", asyncio.get_running_loop())
        with pytest.raises(RuntimeError, match="事件循环中禁止使用同步数据库桥"):
            with database.database_connection_sync():
                pass

    asyncio.run(scenario())


def test_sync_database_bridge_closes_coroutine_when_pool_is_not_started(monkeypatch):
    monkeypatch.setattr(database, "_DATABASE_LOOP", None)

    async def probe():
        return None

    coroutine = probe()
    with pytest.raises(RuntimeError, match="异步连接池尚未启动"):
        database._run_on_database_loop(coroutine)
    assert coroutine.cr_frame is None
