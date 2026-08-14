"""工作流路由。"""

from __future__ import annotations

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field
from sse_starlette.sse import EventSourceResponse

from ai_novel_workstation.api import state
from ai_novel_workstation.llm.exceptions import LLMError
from ai_novel_workstation.workflow.stage1_ideation import Stage1Ideation
from ai_novel_workstation.workflow.stage1_session import get_session_store

router = APIRouter()


def _save_workflow_interactions(
    interactions: list[dict],
    task_type: str = "text",
    session_id: str = "",
    turn_id: str = "",
    user_message: str = "",
) -> None:
    """将工作流中的所有交互记录持久化保存。"""
    try:
        from ai_novel_workstation.storage.interaction_store import save_interaction

        for it in interactions:
            save_interaction(
                source="stage1",
                interaction=it,
                task_type=task_type,
                session_id=session_id,
                turn_id=turn_id,
                user_message=user_message,
            )
    except Exception as e:
        from loguru import logger

        logger.warning(f"保存工作流交互记录失败: {e}")


class Stage1Request(BaseModel):
    """阶段1 请求。"""

    user_input: str = Field(description="作者的创意输入")
    project_name: str = Field(default="", description="项目名称（可选）")
    genre: str = Field(default="", description="题材类型（可选）")
    platform: str = Field(default="", description="目标平台（可选）")
    target_words: str = Field(default="", description="目标字数（可选）")


class Stage1StepData(BaseModel):
    """阶段1 步骤数据（SSE 推送）。"""

    step_index: int
    thought: str = ""
    tool_name: str = ""
    tool_args: str = ""
    observation: str = ""
    is_final: bool = False


@router.post("/stage1")
async def run_stage1(body: Stage1Request):
    """执行阶段1：创意输入与项目初始化。

    返回完整结果（非流式）。
    """
    try:
        client = state.get_client_for_task("text")
    except LLMError as e:
        raise HTTPException(status_code=400, detail=str(e))

    stage1 = Stage1Ideation(client=client, max_iterations=10)

    try:
        result = await stage1.run(
            user_input=body.user_input,
            project_name=body.project_name,
            genre=body.genre,
            platform=body.platform,
            target_words=body.target_words,
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        client.close()

    # 持久化保存交互记录
    _save_workflow_interactions(result.interactions)

    return result.to_dict()


@router.post("/stage1/stream")
async def run_stage1_stream(body: Stage1Request):
    """执行阶段1（流式），通过 SSE 实时推送执行步骤。"""

    async def event_generator():
        try:
            client = state.get_client_for_task("text")
        except LLMError as e:
            yield {"event": "error", "data": str(e)}
            return

        stage1 = Stage1Ideation(client=client, max_iterations=10)

        # 由于 ReAct Agent 的 run 方法是一次性返回所有步骤，
        # 这里改为直接调用并返回结果
        try:
            result = await stage1.run(
                user_input=body.user_input,
                project_name=body.project_name,
                genre=body.genre,
                platform=body.platform,
                target_words=body.target_words,
            )

            # 逐步推送
            for i, step in enumerate(result.steps):
                import json

                step_data = {
                    "step_index": i + 1,
                    "thought": step.thought,
                    "tool_name": step.tool_name,
                    "tool_args": json.dumps(step.tool_args, ensure_ascii=False),
                    "observation": step.observation[:500] if step.observation else "",
                    "is_final": step.is_final,
                }
                yield {"event": "step", "data": json.dumps(step_data, ensure_ascii=False)}

            # 推送最终结果（包含交互记录）
            import json

            final_data = {
                "success": result.success,
                "final_output": result.final_output,
                "project_path": result.project_path,
                "vision_doc_path": result.vision_doc_path,
                "error": result.error,
                "interactions": result.interactions,
            }
            yield {"event": "done", "data": json.dumps(final_data, ensure_ascii=False)}

            # 持久化保存交互记录
            _save_workflow_interactions(result.interactions)

        except Exception as e:
            import json

            yield {"event": "error", "data": json.dumps({"error": str(e)})}
        finally:
            client.close()

    return EventSourceResponse(event_generator())


# ======================================================================
# 阶段1 多轮对话会话（session 版）
# ======================================================================


class SessionCreateRequest(BaseModel):
    """创建会话请求。"""

    project_id: str = Field(default="", description="所属项目 ID（项目作用域会话）")
    project_name: str = Field(default="", description="项目名称（可选，留空从首条消息提取）")
    genre: str = Field(default="", description="题材类型（可选）")
    platform: str = Field(default="", description="目标平台（可选）")
    target_words: str = Field(default="", description="目标字数（可选）")
    tool_call_mode: str = Field(default="jsonfc", description="工具调用模式: native/jsonfc/dsml/auto")


class SessionMessageRequest(BaseModel):
    """会话消息请求。"""

    message: str = Field(description="用户消息")


class SessionAnswerRequest(BaseModel):
    """会话提问回答请求。"""

    answer: str = Field(description="用户对 ask_user 问题的回答")


class SessionInfoOut(BaseModel):
    """会话信息输出。"""

    session_id: str
    project_id: str = ""
    project_name: str = ""
    genre: str = ""
    platform: str = ""
    target_words: str = ""
    done: bool = False
    created_at: str = ""
    updated_at: str = ""
    message_count: int = 0
    project_path: str = ""
    vision_doc_path: str = ""
    vision_doc_exists: bool = False


class Stage1TurnOut(BaseModel):
    """单轮对话输出。"""

    reply: str = ""
    is_done: bool = False
    steps: list[dict] = Field(default_factory=list)
    interactions: list[dict] = Field(default_factory=list)
    success: bool = False
    project_path: str = ""
    vision_doc_path: str = ""
    error: str = ""


def _get_session(session_id: str):
    """获取会话，不存在则抛 404。"""
    session = get_session_store().get(session_id)
    if session is None:
        raise HTTPException(status_code=404, detail=f"会话不存在: {session_id}")
    return session


@router.post("/sessions", response_model=SessionInfoOut)
async def create_session(body: SessionCreateRequest):
    """创建阶段1 多轮对话会话（可绑定项目）。

    若项目已存在进行中（未完成）的会话，则复用该会话而非新建，
    保证"一个项目一个活跃会话"，不同项目会话严格隔离。
    """
    try:
        client = state.get_client_for_task("text")
    except LLMError as e:
        raise HTTPException(status_code=400, detail=str(e))

    kwargs = body.model_dump()
    project_id = body.project_id or ""

    # 项目作用域：project_id 对应项目目录名
    if project_id:
        try:
            from ai_novel_workstation.storage.project_store import get_project_store

            project = get_project_store().get(project_id)
            kwargs["project_id"] = project_id
            kwargs["project_name"] = kwargs.get("project_name") or project.name
        except Exception as e:
            client.close()
            raise HTTPException(status_code=404, detail=str(e))

        # 复用项目已有的进行中会话（严格按 project_id 隔离）
        store = get_session_store()
        snapshots = store.list_by_project(project_id, kwargs.get("project_name", ""))
        active = next((s for s in snapshots if not s.get("done")), None)
        if active:
            client.close()
            existing = store.get(active["session_id"])
            if existing is not None:
                return SessionInfoOut(**existing.info)

    session = get_session_store().create(client, **kwargs)
    return SessionInfoOut(**session.info)


@router.get("/sessions")
async def list_sessions(project_id: str = "", project_name: str = ""):
    """按项目列出会话（返回最近会话摘要）。"""
    store = get_session_store()
    snapshots = store.list_by_project(project_id, project_name)
    return [
        {
            "session_id": s["session_id"],
            "project_id": s.get("project_id", ""),
            "project_name": s.get("project_name", ""),
            "done": s.get("done", False),
            "created_at": s.get("created_at", ""),
            "updated_at": s.get("updated_at", ""),
            "message_count": len(s.get("messages") or []) - 1,
        }
        for s in snapshots
    ]


@router.get("/sessions/{session_id}/messages")
async def get_session_messages(session_id: str):
    """获取会话的消息历史（用于恢复展示）。"""
    store = get_session_store()
    messages = store.get_messages(session_id)
    if messages is None:
        raise HTTPException(status_code=404, detail=f"会话不存在: {session_id}")
    return {"session_id": session_id, "messages": messages}


@router.get("/sessions/{session_id}", response_model=SessionInfoOut)
async def get_session(session_id: str):
    """查询会话信息。"""
    session = _get_session(session_id)
    return SessionInfoOut(**session.info)


@router.delete("/sessions/{session_id}")
async def delete_session(session_id: str):
    """删除会话。"""
    _get_session(session_id)
    await get_session_store().delete(session_id)
    return {"success": True, "session_id": session_id}


@router.post("/sessions/{session_id}/message", response_model=Stage1TurnOut)
async def send_session_message(session_id: str, body: SessionMessageRequest):
    """发送一轮消息（非流式）。"""
    session = _get_session(session_id)
    if session.done:
        raise HTTPException(status_code=400, detail="会话已完成，请新建会话继续")

    result = await session.send_message(body.message)

    # 交互记录已由 session 内部每次 LLM 调用完成时持久化，这里仅保存会话快照
    get_session_store().save(session)

    return Stage1TurnOut(**result.to_dict())


@router.post("/sessions/{session_id}/message/stream")
async def send_session_message_stream(session_id: str, body: SessionMessageRequest):
    """发送一轮消息（SSE 流式，实时推送每个 ReAct 执行步骤）。"""
    session = _get_session(session_id)
    if session.done:
        raise HTTPException(status_code=400, detail="会话已完成，请新建会话继续")

    async def event_generator():
        import asyncio
        import json

        queue: asyncio.Queue = asyncio.Queue()

        async def run_turn():
            try:
                result = await session.send_message(
                    body.message,
                    step_callback=lambda s: queue.put(("step", s)),
                    stream_callback=lambda t: queue.put(("chunk", t)),
                    thinking_callback=lambda t: queue.put(("thinking", t)),
                    on_ask=lambda info: queue.put(("ask", info)),
                )
                await queue.put(("done", result))
            except Exception as e:
                await queue.put(("error", str(e)))

        task = asyncio.create_task(run_turn())
        try:
            while True:
                kind, payload = await queue.get()
                if kind == "step":
                    yield {"event": "step", "data": json.dumps(payload, ensure_ascii=False)}
                elif kind == "chunk":
                    yield {"event": "chunk", "data": payload}
                elif kind == "thinking":
                    yield {"event": "thinking", "data": payload}
                elif kind == "ask":
                    yield {"event": "ask", "data": json.dumps(payload, ensure_ascii=False)}
                elif kind == "done":
                    get_session_store().save(session)
                    yield {"event": "done", "data": json.dumps(payload.to_dict(), ensure_ascii=False)}
                    break
                else:
                    yield {"event": "error", "data": json.dumps({"error": payload})}
                    break
        finally:
            await task

    return EventSourceResponse(event_generator())


@router.post("/sessions/{session_id}/answer")
async def submit_session_answer(session_id: str, body: SessionAnswerRequest):
    """提交用户对 ask_user 问题的回答，让等待中的 Agent 继续。"""
    session = _get_session(session_id)
    ok = session.submit_answer(body.answer)
    if not ok:
        raise HTTPException(status_code=400, detail="当前没有等待回答的问题")
    return {"success": True, "message": "回答已提交"}
