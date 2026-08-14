"""项目路由：工作台（项目列表/新建/切换/归档）。"""

from __future__ import annotations

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from ai_novel_workstation.storage.project_store import (
    ProjectError,
    ProjectNotFoundError,
    ProjectStore,
    get_project_store,
)

router = APIRouter()


def _store() -> ProjectStore:
    return get_project_store()


class ProjectCreate(BaseModel):
    """新建项目请求。"""

    name: str = Field(description="项目名称（同时为目录名）")
    idea: str = Field(default="", description="一句话核心梗")
    target_words: int = Field(default=0, ge=0)
    platform: str = Field(default="")
    genre: str = Field(default="", description="题材类型")


class ProjectUpdate(BaseModel):
    """更新项目请求。"""

    name: str | None = None
    status: str | None = None
    target_words: int | None = Field(default=None, ge=0)
    platform: str | None = None
    genre: str | None = None
    idea: str | None = None


class ProjectOut(BaseModel):
    """项目输出。"""

    id: str
    name: str
    status: str
    target_words: int
    platform: str
    genre: str
    idea: str
    created_at: str
    updated_at: str


@router.get("", response_model=list[ProjectOut])
async def list_projects() -> list[dict]:
    """项目列表（按更新时间倒序）。"""
    return [p.to_dict() for p in _store().list()]


@router.post("", response_model=ProjectOut)
async def create_project(body: ProjectCreate) -> dict:
    """新建项目并初始化目录。"""
    try:
        project = _store().create(
            name=body.name,
            idea=body.idea,
            target_words=body.target_words,
            platform=body.platform,
            genre=body.genre,
        )
    except ProjectError as e:
        raise HTTPException(status_code=400, detail=str(e))
    return project.to_dict()


@router.get("/{project_id}", response_model=ProjectOut)
async def get_project(project_id: str) -> dict:
    """项目详情。"""
    try:
        return _store().get(project_id).to_dict()
    except ProjectNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))


@router.put("/{project_id}", response_model=ProjectOut)
async def update_project(project_id: str, body: ProjectUpdate) -> dict:
    """更新项目（改名/改状态/改参数）。"""
    fields = body.model_dump(exclude_unset=True)
    if fields.get("name"):
        fields["name"] = _store()._clean_name(fields["name"])
    try:
        project = _store().update(project_id, **fields)
    except ProjectNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))
    return project.to_dict()


@router.delete("/{project_id}")
async def delete_project(project_id: str) -> dict:
    """删除项目。"""
    try:
        _store().delete(project_id)
    except ProjectNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))
    return {"success": True, "project_id": project_id}


@router.get("/{project_id}/exists")
async def project_exists(project_id: str) -> dict:
    """项目是否存在。"""
    try:
        _store().get(project_id)
        return {"exists": True}
    except ProjectNotFoundError:
        return {"exists": False}


# ======================================================================
# 设定路由
# ======================================================================


@router.get("/{project_id}/settings/{setting_type}")
async def get_setting(project_id: str, setting_type: str) -> dict:
    """读取指定设定（缺失时返回默认结构）。"""
    from ai_novel_workstation.storage.settings_store import SettingsStore

    settings = SettingsStore(_store())
    try:
        data = settings.get(project_id, setting_type)
    except Exception as e:
        raise HTTPException(status_code=404, detail=str(e))
    return data


@router.put("/{project_id}/settings/{setting_type}")
async def save_setting(project_id: str, setting_type: str, body: dict) -> dict:
    """保存设定（整体覆盖）。"""
    from ai_novel_workstation.storage.settings_store import SettingsStore

    settings = SettingsStore(_store())
    try:
        settings.save(project_id, setting_type, body)
    except Exception as e:
        raise HTTPException(status_code=404, detail=str(e))
    return body


# ======================================================================
# 设定生成
# ======================================================================


class GenerateSettingsRequest(BaseModel):
    """生成设定请求。"""

    setting_type: str = Field(default="all", description="worldview/characters/outline/style/all")


@router.post("/{project_id}/settings/generate")
async def generate_settings(project_id: str, body: GenerateSettingsRequest):
    """基于已确认的核心要素生成结构化设定。"""
    from ai_novel_workstation.api import state
    from ai_novel_workstation.llm.exceptions import LLMError
    from ai_novel_workstation.storage.settings_store import SettingsStore
    from ai_novel_workstation.workflow.settings_generator import (
        SettingsGenerator,
        generate_all,
    )

    try:
        project = _store().get(project_id)
    except ProjectNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))

    try:
        client = state.get_client_for_task("structure")
    except LLMError as e:
        raise HTTPException(status_code=400, detail=str(e))

    settings = SettingsStore(_store())
    try:
        if body.setting_type == "all":
            results = await generate_all(client, settings, project)
        else:
            data = await SettingsGenerator(client, settings).generate(project, body.setting_type)
            results = {body.setting_type: data}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        client.close()

    # 更新项目状态为设定中
    try:
        _store().update(project_id, status="setting")
    except Exception as e:
        from loguru import logger

        logger.warning(f"更新项目状态失败: {e}")
    return {"success": True, "settings": results}


class PrereqCheckResult(BaseModel):
    """前置设定完备检测结果。"""

    complete: bool
    missing: list[str] = Field(default_factory=list)
    details: dict[str, bool] = Field(default_factory=dict)


@router.get("/{project_id}/vision-doc")
async def get_vision_doc(project_id: str) -> dict:
    """读取项目的《故事愿景文档》（IDEATION 产出，项目根目录）。"""
    from ai_novel_workstation.storage.project_store import get_project_store

    try:
        root = get_project_store().project_root(project_id)
    except Exception as e:
        raise HTTPException(status_code=404, detail=str(e))

    path = root / "故事愿景文档.md"
    if not path.exists():
        return {"exists": False, "content": "", "path": ""}
    try:
        content = path.read_text(encoding="utf-8")
        return {"exists": True, "content": content, "path": str(path)}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/{project_id}/documents")
async def list_documents(project_id: str) -> dict:
    """列出项目内的所有 Markdown 文档（供渲染预览）。"""
    from ai_novel_workstation.storage.project_store import get_project_store

    try:
        root = get_project_store().project_root(project_id)
    except Exception as e:
        raise HTTPException(status_code=404, detail=str(e))

    docs: list[dict] = []
    if root.exists():
        for path in root.rglob("*.md"):
            try:
                stat = path.stat()
                rel = path.relative_to(root).as_posix()
                docs.append(
                    {
                        "name": path.name,
                        "path": rel,
                        "size": stat.st_size,
                        "modified": stat.st_mtime,
                    }
                )
            except Exception:
                continue
    docs.sort(key=lambda d: d["path"])
    return {"documents": docs}


@router.get("/{project_id}/prereq-check", response_model=PrereqCheckResult)
async def prereq_check(project_id: str) -> dict:
    """前置设定完备检测：对照必要设定清单检查。"""
    from ai_novel_workstation.storage.settings_store import SettingsStore

    try:
        _store().get(project_id)
    except ProjectNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))

    settings = SettingsStore(_store())
    checks = {
        "worldview": "世界观设定",
        "characters": "人物卡片",
        "outline": "大纲规划",
        "style": "风格设定",
    }
    details: dict[str, bool] = {}
    missing: list[str] = []
    for key, label in checks.items():
        ok = settings.exists(project_id, key)
        details[key] = ok
        if not ok:
            missing.append(label)
    return {"complete": not missing, "missing": missing, "details": details}
