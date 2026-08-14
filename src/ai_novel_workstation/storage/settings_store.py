"""设定存储：世界观 / 人物卡片 / 大纲 / 风格 的 JSON 读写。

数据存于项目目录 settings/ 下，字段级更新由路由层处理。
"""

from __future__ import annotations

import json
from datetime import datetime
from pathlib import Path

from loguru import logger

from ai_novel_workstation.storage.project_store import ProjectNotFoundError, ProjectStore

# 设定类型 → 文件名
SETTING_FILES = {
    "worldview": "worldview.json",
    "characters": "characters.json",
    "outline": "outline.json",
    "style": "style.json",
}

# 各设定类型的默认结构
DEFAULT_SETTINGS: dict[str, dict] = {
    "worldview": {
        "sections": {
            "era": "",
            "rules": "",
            "geography": "",
            "factions": "",
            "history": "",
        }
    },
    "characters": {"characters": []},
    "outline": {
        "root": {
            "type": "total",
            "summary_short": "",
            "summary_long": "",
            "children": [],
        }
    },
    "style": {"style": ""},
}


class SettingsError(Exception):
    """设定相关异常。"""


class SettingsStore:
    """设定存储。"""

    def __init__(self, project_store: ProjectStore) -> None:
        self._project_store = project_store

    def _settings_dir(self, project_id: str) -> Path:
        root = self._project_store.project_root(project_id)
        if not root.exists():
            raise ProjectNotFoundError(f"项目不存在: {project_id}")
        d = root / "settings"
        d.mkdir(parents=True, exist_ok=True)
        return d

    def get(self, project_id: str, setting_type: str) -> dict:
        """读取指定设定；文件缺失时返回默认结构。"""
        if setting_type not in SETTING_FILES:
            raise SettingsError(f"不支持的设定类型: {setting_type}")
        path = self._settings_dir(project_id) / SETTING_FILES[setting_type]
        if not path.exists():
            return json.loads(json.dumps(DEFAULT_SETTINGS[setting_type], ensure_ascii=False))
        try:
            return json.loads(path.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            logger.warning(f"设定文件损坏，返回默认: {path}")
            return json.loads(json.dumps(DEFAULT_SETTINGS[setting_type], ensure_ascii=False))

    def save(self, project_id: str, setting_type: str, data: dict) -> dict:
        """保存设定（整体覆盖）。"""
        if setting_type not in SETTING_FILES:
            raise SettingsError(f"不支持的设定类型: {setting_type}")
        path = self._settings_dir(project_id) / SETTING_FILES[setting_type]
        path.write_text(
            json.dumps(data, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )
        logger.debug(f"设定已保存: {project_id}/{setting_type}")
        return data

    def exists(self, project_id: str, setting_type: str) -> bool:
        """设定文件是否存在（已生成过）。"""
        path = self._settings_dir(project_id) / SETTING_FILES[setting_type]
        return path.exists()


class SettingSnapshot:
    """设定快照（用于判定非空）。"""

    @staticmethod
    def is_empty(data: dict, setting_type: str) -> bool:
        """判定设定是否仍为空（未生成或全空）。"""
        if setting_type == "worldview":
            return not any(v for v in data.get("sections", {}).values())
        if setting_type == "characters":
            return not data.get("characters")
        if setting_type == "outline":
            root = data.get("root", {})
            return not (root.get("summary_short") or root.get("summary_long") or root.get("children"))
        if setting_type == "style":
            return not data.get("style")
        return not data


def touch(project_id: str) -> None:
    """触碰项目更新时间（save 时由 project_store 处理）。"""
    _ = datetime.now().isoformat(timespec="seconds")
