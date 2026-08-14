"""设定生成：根据已确认的核心要素，生成结构化设定（世界观/人物卡片/大纲/风格）。

以"确认齐备"为前提（由 IDEATION 阶段产出核心要素），这里不做逐项对话，
一次性生成四类设定，写入项目 settings/ 目录（结构化 JSON）。
"""

from __future__ import annotations

import json
import re

from loguru import logger

from ai_novel_workstation.llm.models import ChatMessage, Role
from ai_novel_workstation.storage.project_store import Project
from ai_novel_workstation.storage.settings_store import SettingsStore
from ai_novel_workstation.workflow.prompts import (
    SETTINGS_GENERATE_PROMPT,
    SETTINGS_STRUCT_TEMPLATES,
)

# 从 LLM 输出中提取 JSON（可能被 markdown 代码块包裹）
_JSON_FENCE_RE = re.compile(r"```(?:json)?\s*(.*?)```", re.DOTALL)


class SettingsGenerationError(Exception):
    """设定生成异常。"""


class SettingsGenerator:
    """设定生成器。"""

    def __init__(self, client, settings_store: SettingsStore, temperature: float = 0.6) -> None:
        self._client = client
        self._settings_store = settings_store
        self._temperature = temperature

    @staticmethod
    def load_vision_doc(project: Project) -> str:
        """读取项目的《故事愿景文档》（若有），用于注入设定生成。

        Returns:
            愿景文档全文；不存在或读取失败返回空字符串
        """
        from ai_novel_workstation.storage.project_store import get_project_store

        try:
            store = get_project_store()
            # 项目根目录（若项目名即目录名）
            root = store.project_root(project.name)
            path = root / "故事愿景文档.md"
            if not path.exists():
                return ""
            return path.read_text(encoding="utf-8")
        except Exception as e:
            logger.warning(f"读取愿景文档失败: {e}")
            return ""

    async def generate(self, project: Project, setting_type: str) -> dict:
        """生成一类设定并保存。

        Args:
            project: 项目实体
            setting_type: worldview / characters / outline / style

        Returns:
            生成的设定 dict

        Raises:
            SettingsGenerationError: 生成或解析失败
        """
        prompt = SETTINGS_GENERATE_PROMPT.format(
            project_name=project.name,
            idea=project.idea,
            setting_type=setting_type,
            setting_label=_TYPE_LABELS.get(setting_type, setting_type),
        )

        # 注入《故事愿景文档》作为设定的上游依据（IDEATION 的精华沉淀）
        vision_doc = self.load_vision_doc(project)
        if vision_doc:
            prompt += (
                "\n\n## 《故事愿景文档》（已与作者确认的核心要素，必须严格遵循）\n"
                + vision_doc
            )
        else:
            prompt += (
                "\n\n## 提示\n未找到《故事愿景文档》。请仅基于核心梗和常识生成，"
                "关键决策可在生成前通过前端 ask_user 向作者确认。"
            )

        prompt += "\n\n" + SETTINGS_STRUCT_TEMPLATES.get(setting_type, "{}")

        try:
            response = await self._client.achat(
                [ChatMessage(role=Role.SYSTEM, content=prompt)],
                temperature=self._temperature,
            )
        except Exception as e:
            raise SettingsGenerationError(f"LLM 调用失败: {e}") from e

        data = _parse_json(response.content)
        if not data:
            raise SettingsGenerationError(f"无法解析 {setting_type} 设定的 JSON 输出")

        # 规范化到期望结构
        data = _normalize(data, setting_type)
        self._settings_store.save(project.id, setting_type, data)
        logger.info(f"设定已生成: {project.name}/{setting_type}")
        return data


async def generate_all(
    client,
    settings_store: SettingsStore,
    project: Project,
) -> dict[str, dict]:
    """生成四类设定（顺序执行，任何失败立即抛异常）。"""
    results: dict[str, dict] = {}
    for st in _SETTING_TYPES:
        results[st] = await SettingsGenerator(client, settings_store).generate(project, st)
    return results


# ----------------------------------------------------------------------
# 内部
# ----------------------------------------------------------------------

_SETTING_TYPES = ("worldview", "characters", "outline", "style")

_TYPE_LABELS = {
    "worldview": "世界观",
    "characters": "人物卡片",
    "outline": "大纲",
    "style": "风格",
}


def _parse_json(content: str) -> dict | None:
    """从 LLM 输出中提取 JSON 对象。"""
    if not content:
        return None
    # 优先尝试直接解析
    try:
        return json.loads(content)
    except json.JSONDecodeError:
        pass
    # 尝试提取代码块
    m = _JSON_FENCE_RE.search(content)
    if m:
        try:
            return json.loads(m.group(1).strip())
        except json.JSONDecodeError:
            pass
    # 尝试截取第一个 { 到最后一个 }
    start, end = content.find("{"), content.rfind("}")
    if start >= 0 and end > start:
        try:
            return json.loads(content[start : end + 1])
        except json.JSONDecodeError:
            pass
    return None


def _normalize(data: dict, setting_type: str) -> dict:
    """将 LLM 输出规范化到期望结构。"""
    if setting_type == "worldview":
        return {"sections": {"era": "", "rules": "", "geography": "", "factions": "", "history": "", **data.get("sections", {})}}
    if setting_type == "characters":
        chars = data.get("characters", data.get("characters_list", []))
        return {"characters": chars if isinstance(chars, list) else []}
    if setting_type == "outline":
        root = data.get("root", {})
        if isinstance(root, dict):
            return {"root": root}
        # 兼容直接给出 children 的情况
        return {"root": {"type": "total", "summary_short": "", "summary_long": "", "children": data.get("children", [])}}
    if setting_type == "style":
        style = data.get("style", data.get("style_desc", ""))
        return {"style": style if isinstance(style, str) else str(style)}
    return data
