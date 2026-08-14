"""项目存储：项目模型、目录初始化与 CRUD。

项目数据存于作品库根（PROJECT_DIR）下，与代码分离：
    {PROJECT_DIR}/{项目名}/
    ├── project.json
    ├── ideation/
    ├── settings/
    ├── chapters/
    ├── memory/
    └── review/
"""

from __future__ import annotations

import json
import uuid
from datetime import datetime
from pathlib import Path

from loguru import logger

from ai_novel_workstation.storage.path_safety import safe_resolve

# 项目状态
STATUS_IDEATION = "ideation"
STATUS_SETTING = "setting"
STATUS_WRITING = "writing"
STATUS_REVIEWING = "reviewing"

VALID_STATUSES = (STATUS_IDEATION, STATUS_SETTING, STATUS_WRITING, STATUS_REVIEWING)


class ProjectError(Exception):
    """项目相关异常。"""


class ProjectNotFoundError(ProjectError):
    """项目不存在。"""


class Project:
    """小说项目实体。"""

    def __init__(
        self,
        name: str,
        id: str | None = None,
        status: str = STATUS_IDEATION,
        target_words: int = 0,
        platform: str = "",
        genre: str = "",
        idea: str = "",
        created_at: str | None = None,
        updated_at: str | None = None,
    ) -> None:
        self.id = id or str(uuid.uuid4())
        self.name = name
        self.status = status
        self.target_words = target_words
        self.platform = platform
        self.genre = genre
        self.idea = idea
        now = datetime.now().isoformat(timespec="seconds")
        self.created_at = created_at or now
        self.updated_at = updated_at or now

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "name": self.name,
            "status": self.status,
            "target_words": self.target_words,
            "platform": self.platform,
            "genre": self.genre,
            "idea": self.idea,
            "created_at": self.created_at,
            "updated_at": self.updated_at,
        }

    @classmethod
    def from_dict(cls, data: dict) -> Project:
        return cls(
            id=data.get("id") or data.get("name", ""),
            name=data.get("name", ""),
            status=data.get("status", STATUS_IDEATION),
            target_words=data.get("target_words", 0),
            platform=data.get("platform", ""),
            genre=data.get("genre", ""),
            idea=data.get("idea", ""),
            created_at=data.get("created_at"),
            updated_at=data.get("updated_at"),
        )


class ProjectStore:
    """项目存储（基于作品库根目录的文件系统）。"""

    def __init__(self, base_dir: Path) -> None:
        self._base_dir = base_dir
        self._base_dir.mkdir(parents=True, exist_ok=True)

    # ------------------------------------------------------------------
    # 路径
    # ------------------------------------------------------------------

    def project_root(self, project_id: str) -> Path:
        return safe_resolve(self._base_dir, project_id)

    def meta_path(self, project_id: str) -> Path:
        return self.project_root(project_id) / "project.json"

    def resolve(self, project_id: str, rel_path: str) -> Path:
        """在项目沙箱内解析路径（供工具/路由使用）。"""
        return safe_resolve(self.project_root(project_id), rel_path)

    # ------------------------------------------------------------------
    # CRUD
    # ------------------------------------------------------------------

    def list(self) -> list[Project]:
        """列出全部项目（按更新时间倒序）。"""
        projects: list[Project] = []
        for entry in self._base_dir.iterdir():
            if not entry.is_dir():
                continue
            meta = entry / "project.json"
            if meta.exists():
                try:
                    projects.append(Project.from_dict(json.loads(meta.read_text(encoding="utf-8"))))
                except Exception:
                    logger.warning(f"读取项目元数据失败: {meta}")
        projects.sort(key=lambda p: p.updated_at, reverse=True)
        return projects

    def get(self, project_id: str) -> Project:
        """获取项目；不存在抛 ProjectNotFoundError。"""
        root = self.project_root(project_id)
        if not root.exists():
            raise ProjectNotFoundError(f"项目不存在: {project_id}")
        meta = root / "project.json"
        if meta.exists():
            return Project.from_dict(json.loads(meta.read_text(encoding="utf-8")))
        # 有目录但无元数据：按目录名构造
        return Project(name=project_id, id=project_id)

    def create(self, name: str, idea: str = "", **kwargs) -> Project:
        """创建项目并初始化目录结构。

        Args:
            name: 项目名称（同时用作目录名，非法字符会被清洗）
            idea: 一句话核心梗
            **kwargs: 其他字段（status/target_words/platform）

        Raises:
            ProjectError: 项目已存在或名称非法
        """
        clean = self._clean_name(name)
        if not clean:
            raise ProjectError("项目名称不能为空")

        root = self.project_root(clean)
        if root.exists():
            raise ProjectError(f"项目已存在: {clean}")

        project = Project(name=clean, idea=idea, id=clean, **kwargs)
        self._init_directories(root)
        self.save(project)
        logger.info(f"创建项目: {project.name} ({project.id})")
        return project

    def save(self, project: Project) -> None:
        """保存项目元数据。"""
        project.updated_at = datetime.now().isoformat(timespec="seconds")
        root = self.project_root(project.name)
        root.mkdir(parents=True, exist_ok=True)
        (root / "project.json").write_text(
            json.dumps(project.to_dict(), ensure_ascii=False, indent=2),
            encoding="utf-8",
        )

    def update(self, project_id: str, **fields) -> Project:
        """更新项目字段。"""
        project = self.get(project_id)
        for key, value in fields.items():
            if value is not None and hasattr(project, key):
                setattr(project, key, value)
        self.save(project)
        return project

    def delete(self, project_id: str) -> None:
        """删除项目目录及其关联会话。"""
        root = self.project_root(project_id)
        if not root.exists():
            raise ProjectNotFoundError(f"项目不存在: {project_id}")
        import shutil

        shutil.rmtree(root)

        # 删除该项目关联的会话快照（按 project_id 与 project_name 匹配）
        self._delete_project_sessions(project_id)
        logger.info(f"删除项目: {project_id}")

    def _delete_project_sessions(self, project_id: str) -> None:
        """删除某项目关联的所有会话快照（避免同名新项目恢复旧会话）。"""
        try:
            from ai_novel_workstation.workflow import stage1_session as mod

            # 直接删除磁盘快照（按 project_id 与 project_name 匹配）
            if not mod._SESSIONS_DIR.exists():
                return
            for path in mod._SESSIONS_DIR.glob("*.json"):
                try:
                    import json

                    data = json.loads(path.read_text(encoding="utf-8"))
                except Exception:
                    continue
                if data.get("project_id") == project_id:
                    path.unlink()
                    logger.info(f"删除项目会话快照: {path.stem}")
        except Exception as e:
            logger.warning(f"删除项目会话失败: {e}")

    # ------------------------------------------------------------------
    # 内部
    # ------------------------------------------------------------------

    @staticmethod
    def _clean_name(name: str) -> str:
        """清洗项目名：去非法文件名字符、限制长度。"""
        import re

        cleaned = re.sub(r'[\\/:*?"<>|\s]+', "", name.strip())
        return cleaned[:64]

    @staticmethod
    def _init_directories(root: Path) -> None:
        for sub in ("ideation/sessions", "settings", "chapters", "memory/summaries", "review"):
            (root / sub).mkdir(parents=True, exist_ok=True)


# 全局单例（由 API 层按当前 PROJECT_DIR 初始化）
_store: ProjectStore | None = None


def get_project_store() -> ProjectStore:
    """获取全局项目存储单例（懒加载，基于当前 PROJECT_DIR）。"""
    global _store
    if _store is None:
        from ai_novel_workstation.api import state

        _store = ProjectStore(state.get_project_dir_path())
    return _store


def reset_project_store() -> None:
    """重置单例（测试用）。"""
    global _store
    _store = None


def safe_resolve_in_project(project_id: str, rel_path: str) -> Path:
    """在项目沙箱内安全解析路径（路由层便捷入口）。"""
    return get_project_store().resolve(project_id, rel_path)
