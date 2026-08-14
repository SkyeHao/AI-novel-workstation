"""文件读取路由。

提供给前端预览生成的项目文档（如《故事愿景文档》）使用。
路径解析基于作品库根（PROJECT_DIR），并强制沙箱校验。
"""

from __future__ import annotations

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel

router = APIRouter()


class FileReadResponse(BaseModel):
    """文件读取响应。"""

    success: bool
    content: str = ""
    error: str = ""


@router.get("/read", response_model=FileReadResponse)
async def read_file(
    path: str = Query(..., description="文件路径（相对路径相对于作品库根，或作品库内绝对路径）"),
    encoding: str = Query("utf-8", description="文件编码"),
) -> FileReadResponse:
    """读取指定路径的文件内容。

    路径经作品库沙箱校验（禁止逃逸出 PROJECT_DIR）。
    """
    from ai_novel_workstation.api import state

    try:
        file_path = state.resolve_project_path(path)
    except ValueError as e:
        raise HTTPException(status_code=403, detail=str(e))

    if not file_path.exists():
        raise HTTPException(status_code=404, detail=f"文件不存在: {path}")

    if not file_path.is_file():
        raise HTTPException(status_code=400, detail=f"路径不是文件: {path}")

    # 限制文件大小（10MB）
    size = file_path.stat().st_size
    if size > 10 * 1024 * 1024:
        raise HTTPException(status_code=413, detail=f"文件过大（{size / 1024 / 1024:.1f}MB），限制 10MB")

    try:
        content = file_path.read_text(encoding=encoding)
        return FileReadResponse(success=True, content=content if content else "（文件为空）")
    except UnicodeDecodeError:
        raise HTTPException(status_code=400, detail=f"编码错误，尝试用 {encoding} 解码失败")
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
