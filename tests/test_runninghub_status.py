from main import runninghub_normalized_status
from main import _canonical_runninghub_settings


def test_runninghub_outputs_task_running_code_stays_pending():
    assert runninghub_normalized_status({"code": 804, "msg": "APIKEY_TASK_IS_RUNNING"}, 804, []) == "RUNNING"


def test_runninghub_outputs_task_queued_code_stays_pending():
    assert runninghub_normalized_status({"code": 803, "msg": "APIKEY_TASK_IS_QUEUED"}, 803, []) == "RUNNING"


def test_runninghub_queued_message_overrides_misleading_terminal_status():
    assert runninghub_normalized_status({"code": 803, "status": "FAILED", "msg": "APIKEY_TASK_IS_QUEUED"}, 803, []) == "RUNNING"


def test_runninghub_outputs_unknown_error_still_fails():
    assert runninghub_normalized_status({"code": 500, "msg": "failed"}, 500, []) == "FAILED"


def test_runninghub_settings_migrate_to_canonical_app_id():
    settings = _canonical_runninghub_settings({
        "id": "1947105314179309570",
        "appId": "2085207180373966849",
        "webappId": "2085207180373966849",
    })

    assert settings["app_id"] == "1947105314179309570"
    assert "id" not in settings
    assert "appId" not in settings
    assert "webappId" not in settings
