"""聊天测试路由。"""

from __future__ import annotations

import time

from fastapi import APIRouter, HTTPException
from sse_starlette.sse import EventSourceResponse

from ai_novel_workstation.api import state
from ai_novel_workstation.api.schemas import (
    ChatRequestIn,
    ChatResponseOut,
    LLMInteractionOut,
    TokenCountRequest,
    TokenCountResponse,
)
from ai_novel_workstation.llm.exceptions import LLMError
from ai_novel_workstation.llm.interaction_logger import InteractionLogger
from ai_novel_workstation.llm.models import ChatMessage

router = APIRouter()


def _to_chat_messages(messages_in: list) -> list[ChatMessage]:
    """将 API 输入消息转为 ChatMessage。"""
    return [ChatMessage(role=m.role, content=m.content) for m in messages_in]


@router.post("/", response_model=ChatResponseOut)
async def chat(body: ChatRequestIn) -> ChatResponseOut:
    """同步聊天测试。"""
    # 创建本次请求专属的交互记录器
    interaction_logger = InteractionLogger()

    try:
        client = state.get_client_for_task(body.task, interaction_logger=interaction_logger)
    except LLMError as e:
        raise HTTPException(status_code=400, detail=str(e))

    messages = _to_chat_messages(body.messages)
    kwargs: dict = {}
    if body.temperature is not None:
        kwargs["temperature"] = body.temperature
    if body.max_tokens is not None:
        kwargs["max_tokens"] = body.max_tokens

    start = time.perf_counter()
    try:
        response = await client.achat(messages, **kwargs)
    except LLMError as e:
        raise HTTPException(status_code=502, detail=str(e))
    elapsed_ms = int((time.perf_counter() - start) * 1000)

    # 提取交互记录
    interaction_out: LLMInteractionOut | None = None
    interactions = interaction_logger.get_all()
    if interactions:
        it = interactions[-1]
        interaction_out = LLMInteractionOut(
            messages=it.messages,
            model=it.model,
            temperature=it.temperature,
            max_tokens=it.max_tokens,
            functions=it.functions,
            function_call=it.function_call,
            response_content=it.response_content,
            response_function_call=it.response_function_call,
            finish_reason=it.finish_reason,
            prompt_tokens=it.prompt_tokens,
            completion_tokens=it.completion_tokens,
            total_tokens=it.total_tokens,
            tool_name=it.tool_name,
            tool_args=it.tool_args,
            tool_result=it.tool_result,
            tool_success=it.tool_success,
            elapsed_ms=it.elapsed_ms,
            error=it.error,
            timestamp=it.timestamp,
        )
        # 持久化保存交互记录
        try:
            from ai_novel_workstation.storage.interaction_store import save_interaction

            save_interaction(
                source="chat",
                interaction=it.to_dict(),
                task_type=body.task,
            )
        except Exception as e:
            # 保存失败不影响主流程
            from loguru import logger

            logger.warning(f"保存交互记录失败: {e}")

    return ChatResponseOut(
        content=response.content,
        model=response.model,
        prompt_tokens=response.usage.prompt_tokens,
        completion_tokens=response.usage.completion_tokens,
        total_tokens=response.usage.total_tokens,
        finish_reason=response.finish_reason,
        elapsed_ms=elapsed_ms,
        interaction=interaction_out,
    )


@router.post("/stream")
async def chat_stream(body: ChatRequestIn):
    """流式聊天测试，SSE 返回。"""
    try:
        client = state.get_client_for_task(body.task)
    except LLMError as e:
        raise HTTPException(status_code=400, detail=str(e))

    messages = _to_chat_messages(body.messages)
    kwargs: dict = {}
    if body.temperature is not None:
        kwargs["temperature"] = body.temperature
    if body.max_tokens is not None:
        kwargs["max_tokens"] = body.max_tokens

    async def event_generator():
        try:
            async for chunk in client.astream(messages, **kwargs):
                yield {"event": "chunk", "data": chunk}
            yield {"event": "done", "data": "[DONE]"}
        except LLMError as e:
            yield {"event": "error", "data": str(e)}

    return EventSourceResponse(event_generator())


@router.post("/tokens", response_model=TokenCountResponse)
async def count_tokens(body: TokenCountRequest) -> TokenCountResponse:
    """估算消息列表的 token 数。"""
    try:
        client = state.get_client_for_task(body.task)
    except LLMError as e:
        raise HTTPException(status_code=400, detail=str(e))

    messages = _to_chat_messages(body.messages)
    count = client.count_tokens(messages)
    return TokenCountResponse(token_count=count)
