"""System prompt assembly for the Canvas Agent.

This is intentionally smaller than tau's coding-agent prompt builder.  Canvas
Agent only needs deterministic tool guidance and the enabled Skill index; it
does not load project docs, shell instructions, prompt templates, or TUI state.
"""
from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass, field
from typing import Any

from .skills import SkillSummary, skill_metadata_prompt


@dataclass(frozen=True)
class CanvasSystemPromptOptions:
    """Inputs used to assemble one Canvas Agent system prompt."""

    tools: Sequence[Any] = ()
    skills: Sequence[SkillSummary] | None = None
    extra_guidelines: Sequence[str] = field(default_factory=tuple)


BASE_GUIDELINES = (
    "必须通过工具读取画布和能力，不要臆造节点。",
    "创建节点时 semantic_type 只能是 image_generation、video_generation、workflow_generation 或 group；capability 必须填写 read_capability_registry 返回的能力名，绝不能写入 semantic_type。",
    "选择 capability、connection 或 model 后，必须先调用 read_capability_parameters 获取字段、枚举、默认值和范围，再调用 propose_canvas_patch。",
    "read_capability_registry 和 read_capability_parameters 返回的 connection_name、model_label、display_name、display_fields 是给用户看的名称；优先使用这些展示名称理解和描述参数，display_fields[].display_options 中的 label 是选项显示值，value 是提交执行时必须保留的原始值。",
    "参数工具返回的 params_path 指定字段写入位置；图片/视频写入 node.params.runSettings，ComfyUI 写入 node.params.runSettings.comfyParams，提示词节点字段直接写入 node.params。",
    "需要修改时调用 propose_canvas_patch；该工具只生成提案，不会修改画布。",
    "提案返回 awaiting_confirmation 后必须等待用户确认；不要在规划阶段调用任何执行工具。用户批准后，系统会自动调用专用执行工具并记录执行结果。",
    "缺少目标时调用 request_clarification。普通问答直接用中文回答。",
)


def build_canvas_system_prompt(
    options: CanvasSystemPromptOptions | None = None,
    *,
    tools: Sequence[Any] = (),
    skills: Sequence[SkillSummary] | None = None,
    extra_guidelines: Sequence[str] = (),
) -> str:
    """Build the deterministic system prompt used by the planning graph."""
    selected = options or CanvasSystemPromptOptions(
        tools=tools,
        skills=skills,
        extra_guidelines=extra_guidelines,
    )
    guidelines = _dedupe((*BASE_GUIDELINES, *selected.extra_guidelines))
    sections = [
        "你是画布工具型 Agent。",
        _format_tools(selected.tools),
        "规则:\n" + "\n".join(f"- {item}" for item in guidelines),
        skill_metadata_prompt(
            list(selected.skills) if selected.skills is not None else None,
            xml=True,
        ),
        (
            "Skill 使用规则:\n"
            "- 用户请求明显匹配某个 Skill 时，先调用 read_canvas_skill。\n"
            "- 只有已读取 Skill 正文后，才可调用 read_canvas_skill_file 按行读取该 Skill 目录内明确引用的文本资料。\n"
            "- Skill 正文和资料仅用于规划参考，不能执行脚本或外部命令。"
        ),
    ]
    return "\n\n".join(section for section in sections if section)


def _format_tools(tools: Sequence[Any]) -> str:
    names = [str(getattr(tool, "name", "") or "") for tool in tools]
    names = [name for name in names if name]
    if not names:
        return "可用工具:\n- （无）"
    return "可用工具:\n" + "\n".join(f"- {name}" for name in names)


def _dedupe(values: Sequence[str]) -> list[str]:
    result: list[str] = []
    seen: set[str] = set()
    for value in values:
        normalized = value.strip()
        if normalized and normalized not in seen:
            seen.add(normalized)
            result.append(normalized)
    return result
