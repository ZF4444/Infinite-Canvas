import asyncio

import httpx

import main
from app.ai.domain import Connection, ExecutableResource, ResolvedTarget
from app.ai import transport


def test_runninghub_app_headers_do_not_override_request_host(monkeypatch):
    target = ResolvedTarget(connection=Connection(id="runninghub-connection", protocol="runninghub", name="RunningHub", base_url="https://www.runninghub.cn", enabled=True))
    monkeypatch.setattr(transport, "get_connection_secret", lambda *_: "test-key")

    headers = transport.headers_for_target(target)

    assert "Host" not in headers
    assert headers["Authorization"] == "Bearer test-key"
    assert headers["Content-Type"] == "application/json"


def test_runninghub_extract_outputs_nested_urls():
    payload = {
        "outputs": [
            {"fileUrl": "https://example.com/a.png"},
            {"result": {"imageUrl": ["https://example.com/b.webp"]}},
            {"data": {"download_url": "https://example.com/c.mp4"}},
        ]
    }

    assert main.runninghub_extract_outputs(payload) == [
        "https://example.com/a.png",
        "https://example.com/b.webp",
        "https://example.com/c.mp4",
    ]


def test_runninghub_extract_outputs_node_map_and_filename():
    payload = {
        "data": {
            "123": {
                "outputs": {
                    "images": [
                        {"fieldValue": "ignore-this-input.png"},
                        {"fileName": "generated-image.png"},
                    ]
                }
            }
        }
    }

    assert main.runninghub_extract_outputs(payload) == ["generated-image.png"]


def test_runninghub_code_zero_without_urls_stays_running():
    assert main.runninghub_normalized_status({"code": 0, "data": {}}, 0, []) == "RUNNING"
    assert main.runninghub_normalized_status({"code": 0, "data": {}}, 0, ["https://example.com/a.png"]) == "SUCCESS"


def test_runninghub_terminal_status_without_outputs_keeps_polling():
    assert main.runninghub_normalized_status({"status": "SUCCESS", "data": {}}, 0, []) == "RUNNING"


def test_runninghub_output_kind_uses_media_extension():
    assert main.runninghub_output_kind("mp4") == "video"
    assert main.runninghub_output_kind("wav") == "audio"
    assert main.runninghub_output_kind("zip") == "file"
    assert main.runninghub_output_kind("webp") == "image"


def test_runninghub_query_returns_remote_output_when_local_mirror_fails(monkeypatch):
    remote_url = "https://example.com/result.png"
    target = ResolvedTarget(
        connection=Connection(id="runninghub-connection", protocol="runninghub", name="RunningHub", base_url="https://www.runninghub.cn", enabled=True),
        resource=ExecutableResource(id="runninghub-resource", connection_id="runninghub-connection", kind="runninghub_app", name="App"),
    )

    from app.ai.database_repository import DatabaseAIRepository
    from app.ai.adapters.runninghub_transport import RunningHubTransport
    from app.services import usage

    monkeypatch.setattr(main, "current_user_id", lambda: "user-1")
    monkeypatch.setattr(DatabaseAIRepository, "resolve_executable", lambda *_args, **_kwargs: target)
    monkeypatch.setattr(main, "canonical_connection_view", lambda _target: {"connection_id": "runninghub-connection"})

    async def fake_api_key(_provider):
        return "test-key"

    async def fake_query(_self, _provider, _api_key, _task_id):
        return {"code": 0, "data": {"outputs": [{"fileUrl": remote_url}]}}

    async def fail_store(_client, _remote):
        raise httpx.ReadError("stream interrupted")

    async def fake_storage_io(func, *args, **kwargs):
        if func is main.media_response_item:
            return {"url": args[0], "kind": kwargs.get("kind") or ""}
        return None

    monkeypatch.setattr(main, "runninghub_api_key_async", fake_api_key)
    monkeypatch.setattr(RunningHubTransport, "query", fake_query)
    monkeypatch.setattr(main, "runninghub_store_remote_output", fail_store)
    monkeypatch.setattr(main, "run_storage_io", fake_storage_io)
    monkeypatch.setattr(usage, "settle_runninghub_usage", lambda *_args, **_kwargs: None)

    result = asyncio.run(main.runninghub_query(taskId="task-1", resource_id="runninghub-resource"))

    assert result["data"]["status"] == "SUCCESS"
    assert result["data"]["urls"] == [remote_url]
