"""FastAPI 应用入口。

启动方式：
    uv run uvicorn ai_novel_workstation.api.app:app --reload --port 8000
"""

from __future__ import annotations

from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from ai_novel_workstation.api.routes import (
    chat,
    config,
    files,
    interactions,
    projects,
    workflow,
)


@asynccontextmanager
async def lifespan(app: FastAPI):
    """应用生命周期：启动时把 .env 中的搜索配置注入进程环境变量。"""
    from ai_novel_workstation.api import state

    state.init_search_env()
    yield


app = FastAPI(
    title="AI 生成小说工作站 API",
    version="0.1.0",
    description="LLM 客户端测试接口",
    lifespan=lifespan,
)

# CORS：允许前端开发服务器访问
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "http://localhost:5174",
        "http://127.0.0.1:5174",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/api/health")
async def health() -> dict:
    """健康检查。"""
    return {"status": "ok"}


app.include_router(projects.router, prefix="/api/projects", tags=["项目管理"])
app.include_router(config.router, prefix="/api/config", tags=["配置管理"])
app.include_router(chat.router, prefix="/api/chat", tags=["聊天测试"])
app.include_router(workflow.router, prefix="/api/workflow", tags=["工作流"])
app.include_router(files.router, prefix="/api/files", tags=["文件读取"])
app.include_router(interactions.router, prefix="/api/interactions", tags=["交互记录"])
