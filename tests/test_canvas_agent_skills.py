import asyncio
import threading

import pytest
from langchain_core.messages import AIMessage, ToolMessage
from langgraph.graph import END, START, StateGraph
from langgraph.graph.message import add_messages
from langgraph.prebuilt import ToolNode
from typing import Annotated, TypedDict
from app.services.canvas_agent.runtime import create_canvas_agent

from app.services.canvas_agent import skills
from app.services.canvas_agent.tools import build_canvas_tools
from app.services.canvas_agent.system_prompt import build_canvas_system_prompt


def test_skill_catalog_is_injected_by_the_prompt_not_exposed_as_an_agent_tool():
    names = {
        item.name for item in build_canvas_tools(
            user_id="user", run_id="run", canvas_id="canvas",
        )
    }

    assert "list_canvas_skills" not in names
    assert {"read_canvas_skill", "read_canvas_skill_file"} <= names


def test_canvas_system_prompt_uses_tau_style_sections_and_skill_metadata():
    prompt = build_canvas_system_prompt(tools=[type("Tool", (), {"name": "read_canvas_skill"})()])

    assert "可用工具:" in prompt
    assert "规则:" in prompt
    assert "<available_skills>" in prompt
    assert "<name>image-generation</name>" in prompt
    assert "Skill 正文和资料仅用于规划参考" in prompt


def test_skill_metadata_prompt_supports_explicit_skill_input_and_xml_format():
    summary = skills.SkillSummary("demo", "Demo <workflow>")

    assert skills.skill_metadata_prompt([summary]) == (
        "可用 Skill（仅元数据，未加载正文）：\n- demo: Demo <workflow>"
    )
    xml = skills.skill_metadata_prompt([summary], xml=True)
    assert "<name>demo</name>" in xml
    assert "Demo &lt;workflow&gt;" in xml


def test_capability_parameters_display_lookup_runs_off_event_loop(monkeypatch):
    from app.ai.domain import Connection, ModelResource
    from app.services.canvas_agent import tools as canvas_tools

    event_loop_thread = threading.get_ident()

    class Repository:
        def connections(self):
            assert threading.get_ident() != event_loop_thread
            return [Connection("conn-banana", "openai", "Banana", "https://example.test/v1", True)]

        def models(self):
            assert threading.get_ident() != event_loop_thread
            return [ModelResource("banana2", "conn-banana", "banan2", "image", "openai", alias="Banan 2")]

    monkeypatch.setattr("app.ai.database_repository.DatabaseAIRepository", Repository)
    monkeypatch.setattr(canvas_tools, "capability_parameters", lambda **_kwargs: {
        "fields": [{"id": "quality", "options": ["standard"], "default": "standard"}],
    })
    tool = next(item for item in build_canvas_tools(user_id="user", run_id="run", canvas_id="canvas") if item.name == "read_capability_parameters")

    result = asyncio.run(tool.ainvoke({"capability": "image.text_to_image", "connection_id": "conn-banana", "model": "banan2"}))

    assert result["display_connection"] == "Banana"
    assert result["display_model"] == "Banan 2"


def test_execution_tool_records_a_tool_message_and_execution_result():
    class State(TypedDict):
        messages: Annotated[list, add_messages]
        execution_result: dict

    async def execute_patch(plan_version, authorized_node_ids):
        assert plan_version == 1
        assert authorized_node_ids == ["node-1"]
        return {"version": 2, "node_refs": {"create-image": "node-1"}, "run_requests": []}

    tools = build_canvas_tools(
        user_id="user", run_id="run", canvas_id="canvas",
        execute_patch=execute_patch, include_execution=True,
    )
    execute_tool = next(item for item in tools if item.name == "execute_canvas_patch")
    graph_builder = StateGraph(State)
    graph_builder.add_node("execute", ToolNode([execute_tool]))
    graph_builder.add_edge(START, "execute")
    graph_builder.add_edge("execute", END)
    result = asyncio.run(graph_builder.compile().ainvoke({"messages": [AIMessage(content="", tool_calls=[{
        "id": "execute-call", "name": "execute_canvas_patch",
        "args": {"plan_version": 1, "authorized_node_ids": ["node-1"]}, "type": "tool_call",
    }])]}))

    assert result["execution_result"]["node_refs"] == {"create-image": "node-1"}
    message = next(item for item in result["messages"] if isinstance(item, ToolMessage))
    assert message.tool_call_id == "execute-call"
    assert '"node-1"' in message.content


def test_skill_document_reads_complete_body_and_metadata_prompt():
    document = skills.read_skill_document("canvas-capabilities")
    assert document.name == "canvas-capabilities"
    assert document.content.startswith("# Canvas Capabilities")
    assert len(document.content_sha256) == 64
    assert "canvas-capabilities:" in skills.skill_metadata_prompt()


def test_image_generation_skill_is_registered_with_matching_frontmatter():
    document = skills.read_skill_document("image-generation")
    assert document.name == "image-generation"
    assert "image.text_to_image" in document.content


def test_disabled_skill_is_hidden_and_cannot_be_read(monkeypatch):
    monkeypatch.setattr(skills, "_skill_enablement", lambda: {"canvas-capabilities": False})
    assert "canvas-capabilities" not in [skill.name for skill in skills.list_enabled_skill_summaries()]
    with pytest.raises(KeyError):
        skills.read_skill_document("canvas-capabilities")


def test_skill_frontmatter_must_match_catalog(monkeypatch, tmp_path):
    root = tmp_path / "skills"
    skill_dir = root / "demo-skill"
    skill_dir.mkdir(parents=True)
    (skill_dir / "SKILL.md").write_text("---\nname: wrong-name\nversion: 1.0.0\n---\n# Demo\n", encoding="utf-8")
    with pytest.raises(ValueError, match="必须匹配目录名"):
        skills.list_skill_summaries(root=str(root))


def test_skill_directory_is_discovered_without_python_registration(tmp_path):
    root = tmp_path / "skills"
    skill_dir = root / "demo-skill"
    skill_dir.mkdir(parents=True)
    (skill_dir / "SKILL.md").write_text(
        "---\nname: demo-skill\ndescription: Demo workflow\n---\n# Demo\n",
        encoding="utf-8",
    )
    summary = skills.list_skill_summaries(root=str(root))[0]
    assert summary.name == "demo-skill"
    assert skills.read_skill_document("demo-skill", root=str(root)).content.endswith("# Demo\n")


def test_skill_resource_read_is_relative_bounded_and_supports_continuation(tmp_path):
    root = tmp_path / "skills"
    skill_dir = root / "demo-skill"
    skill_dir.mkdir(parents=True)
    (skill_dir / "SKILL.md").write_text(
        "---\nname: demo-skill\ndescription: Demo workflow\n---\n# Demo\n",
        encoding="utf-8",
    )
    reference = skill_dir / "references"
    reference.mkdir()
    (reference / "guide.md").write_text("one\ntwo\nthree\n", encoding="utf-8")

    first = skills.read_skill_resource("demo-skill", "references/guide.md", limit=2, root=str(root))
    second = skills.read_skill_resource("demo-skill", "references/guide.md", offset=3, root=str(root))

    assert first.path == "references/guide.md"
    assert first.content == "one\ntwo"
    assert first.start_line == 1
    assert first.end_line == 2
    assert first.truncated is True
    assert second.content == "three\n"
    assert second.truncated is False
    with pytest.raises(ValueError, match="Skill 目录内"):
        skills.read_skill_resource("demo-skill", "../outside.md", root=str(root))


def test_skill_tools_write_loaded_state_and_require_level_two_before_level_three():
    events = []

    async def emit(event_run_id, spec):
        events.append(spec.event_type)

    tools = build_canvas_tools(user_id="user", run_id="run", canvas_id="canvas")

    class Model:
        calls = 0

        def bind_tools(self, _tools):
            return self

        async def ainvoke(self, _messages):
            self.calls += 1
            if self.calls == 1:
                return AIMessage(content="", tool_calls=[{"name": "read_canvas_skill", "args": {"name": "canvas-capabilities"}, "id": "call-skill", "type": "tool_call"}])
            return AIMessage(content="done")

    result = asyncio.run(create_canvas_agent(model=Model(), user_id="user", run_id="run", canvas_id="canvas", tools=tools, emit_progress=emit).ainvoke({"messages": []}))
    assert result["loaded_skills"][0]["name"] == "canvas-capabilities"
    assert any(message.tool_call_id == "call-skill" for message in result["messages"] if hasattr(message, "tool_call_id"))
    # The tool node now owns emission: the skill event is wrapped by the
    # tool group envelope (started -> skill.loaded -> completed).
    assert [event for event in events if event.startswith("skill.")] == ["skill.loaded"]
    assert events.count("progress.tool_started") == 1
    assert events.count("progress.tool_completed") == 1


def test_skill_file_tool_requires_loaded_skill_and_reads_reference_progressively():
    events = []

    async def emit(event_run_id, spec):
        events.append(spec.event_type)

    tools = build_canvas_tools(user_id="user", run_id="run", canvas_id="canvas")

    class Model:
        calls = 0

        def bind_tools(self, _tools):
            return self

        async def ainvoke(self, _messages):
            self.calls += 1
            if self.calls == 1:
                return AIMessage(content="", tool_calls=[{
                    "name": "read_canvas_skill",
                    "args": {"name": "canvas-capabilities"},
                    "id": "call-skill",
                    "type": "tool_call",
                }])
            if self.calls == 2:
                return AIMessage(content="", tool_calls=[{
                    "name": "read_canvas_skill_file",
                    "args": {
                        "skill_name": "canvas-capabilities",
                        "path": "references/capability-reading.md",
                        "limit": 1,
                    },
                    "id": "call-reference",
                    "type": "tool_call",
                }])
            return AIMessage(content="done")

    result = asyncio.run(create_canvas_agent(
        model=Model(), user_id="user", run_id="run", canvas_id="canvas", tools=tools, emit_progress=emit,
    ).ainvoke({"messages": []}))

    reference_message = next(
        message for message in result["messages"]
        if isinstance(message, ToolMessage) and message.tool_call_id == "call-reference"
    )
    assert "[内容未完；使用 offset=2 继续读取。]" in reference_message.content
    assert [event for event in events if event.startswith("skill.")] == ["skill.loaded", "skill.resource_loaded"]


def test_skill_file_tool_rejects_a_skill_that_was_not_loaded():
    from app.services.canvas_agent.event_factory import skill_event_from_artifact

    tool = next(
        item for item in build_canvas_tools(
            user_id="user", run_id="run", canvas_id="canvas",
        ) if item.name == "read_canvas_skill_file"
    )

    class State(TypedDict):
        messages: Annotated[list, add_messages]
        loaded_skills: list[dict[str, str]]

    graph_builder = StateGraph(State)
    graph_builder.add_node("read", ToolNode([tool]))
    graph_builder.add_edge(START, "read")
    graph_builder.add_edge("read", END)
    result = asyncio.run(graph_builder.compile().ainvoke({
        "loaded_skills": [],
        "messages": [AIMessage(content="", tool_calls=[{
            "id": "call-unloaded-resource",
            "name": "read_canvas_skill_file",
            "args": {
                "skill_name": "canvas-capabilities",
                "path": "references/capability-reading.md",
            },
            "type": "tool_call",
        }])],
    }))

    message = next(
        item for item in result["messages"]
        if isinstance(item, ToolMessage) and item.tool_call_id == "call-unloaded-resource"
    )
    assert "必须先读取对应的 Skill 正文" in message.content
    # The tool no longer emits events; it tags the ToolMessage with a
    # discriminated artifact that the runtime tool node translates centrally.
    spec = skill_event_from_artifact("call-unloaded-resource", message.artifact)
    assert spec is not None
    assert spec.event_type == "skill.resource_rejected"
