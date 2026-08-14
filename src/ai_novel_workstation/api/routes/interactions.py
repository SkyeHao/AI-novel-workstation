"""LLM 交互记录管理路由。

提供交互记录的列表查询、详情查看、删除、清空功能。
"""

from __future__ import annotations

from fastapi import APIRouter, HTTPException, Query

from ai_novel_workstation.api.schemas import (
    InteractionDetail,
    InteractionListItem,
    InteractionListResponse,
)
from ai_novel_workstation.storage.interaction_store import (
    clear_all_interactions,
    delete_interaction,
    delete_interactions_by_session,
    get_interaction,
    list_interactions,
)

router = APIRouter()


@router.get("", response_model=InteractionListResponse)
async def list_interactions_api(
    source: str | None = Query(default=None, description="按来源筛选: chat/stage1"),
    limit: int = Query(default=50, ge=1, le=200, description="每页数量"),
    offset: int = Query(default=0, ge=0, description="偏移量"),
) -> InteractionListResponse:
    """获取交互记录列表（分页）。"""
    items, total = list_interactions(source=source, limit=limit, offset=offset)
    return InteractionListResponse(
        items=[InteractionListItem(**item) for item in items],
        total=total,
        limit=limit,
        offset=offset,
    )


@router.delete("/by-session/{session_id}")
async def delete_session_interactions_api(session_id: str) -> dict:
    """删除某会话下的全部交互记录（会话级删除）。"""
    count = delete_interactions_by_session(session_id)
    return {"success": True, "deleted_count": count, "message": f"已删除该会话的 {count} 条记录"}


@router.get("/{record_id}", response_model=InteractionDetail)
async def get_interaction_api(record_id: str) -> InteractionDetail:
    """获取单条交互记录完整详情。"""
    data = get_interaction(record_id)
    if data is None:
        raise HTTPException(status_code=404, detail="交互记录不存在")
    return InteractionDetail(**data)


@router.delete("/{record_id}")
async def delete_interaction_api(record_id: str) -> dict:
    """删除单条交互记录。"""
    success = delete_interaction(record_id)
    if not success:
        raise HTTPException(status_code=404, detail="交互记录不存在")
    return {"success": True, "message": "记录已删除"}


@router.delete("")
async def clear_interactions_api(
    source: str | None = Query(default=None, description="仅清空指定来源，留空则全部清空"),
) -> dict:
    """清空交互记录。"""
    count = clear_all_interactions(source=source)
    return {"success": True, "deleted_count": count, "message": f"已清空 {count} 条记录"}
