"""通用 LLM Client，兼容所有 OpenAI 协议 API。

支持：
- OpenAI / Azure OpenAI / 通义千问 / DeepSeek / Moonshot 等所有 OpenAI 协议兼容服务
- 同步与异步调用
- 流式输出
- 自动重试（tenacity）
- Token 计数（tiktoken）
- 超时控制
"""

from __future__ import annotations

from collections.abc import AsyncIterator, Iterator
from typing import Any

import tiktoken
from loguru import logger
from openai import AsyncOpenAI, OpenAI
from tenacity import (
    retry,
    retry_if_exception_type,
    stop_after_attempt,
    wait_exponential,
)

from ai_novel_workstation.config.settings import LLMModelConfig
from ai_novel_workstation.llm.exceptions import (
    LLMAuthError,
    LLMConfigError,
    LLMRateLimitError,
    LLMRequestError,
    LLMResponseError,
    LLMTimeoutError,
)
from ai_novel_workstation.llm.models import ChatMessage, ChatRequest, ChatResponse, TokenUsage


class LLMClient:
    """通用 LLM 客户端，封装 OpenAI SDK。

    通过自定义 base_url 兼容所有 OpenAI 协议 API 服务。

    Usage:
        # 同步调用
        config = LLMModelConfig(api_key="sk-xxx", base_url="https://api.openai.com/v1", model="gpt-4o")
        client = LLMClient(config)
        response = client.chat([ChatMessage(role="user", content="你好")])

        # 异步调用
        response = await client.achat([ChatMessage(role="user", content="你好")])

        # 流式输出
        for chunk in client.stream([ChatMessage(role="user", content="写一段话")]):
            print(chunk, end="", flush=True)
    """

    def __init__(self, config: LLMModelConfig, interaction_logger=None) -> None:
        if not config.api_key:
            raise LLMConfigError("api_key 不能为空")

        self.config = config
        self._name = f"{config.base_url}/{config.model}"
        self._interaction_logger = interaction_logger

        # 初始化 OpenAI SDK 客户端（同步 + 异步）
        self._sync_client = OpenAI(
            api_key=config.api_key,
            base_url=config.base_url,
            timeout=config.timeout,
            max_retries=0,  # 由 tenacity 接管重试
        )
        self._async_client = AsyncOpenAI(
            api_key=config.api_key,
            base_url=config.base_url,
            timeout=config.timeout,
            max_retries=0,
        )

        # Token 计数器（优先用模型对应编码，回退到 cl100k_base）
        try:
            self._encoding = tiktoken.encoding_for_model(config.model)
        except KeyError:
            self._encoding = tiktoken.get_encoding("cl100k_base")

        logger.debug(f"LLMClient 初始化完成: {self._name}")

    # ------------------------------------------------------------------
    # 同步接口
    # ------------------------------------------------------------------

    @retry(
        retry=retry_if_exception_type((LLMRequestError, LLMTimeoutError)),
        stop=stop_after_attempt(3),
        wait=wait_exponential(multiplier=1, min=2, max=30),
        reraise=True,
    )
    def chat(
        self,
        messages: list[ChatMessage] | list[dict[str, str]],
        **kwargs: Any,
    ) -> ChatResponse:
        """同步聊天接口。

        Args:
            messages: 消息列表，可为 ChatMessage 对象或 dict
            **kwargs: 覆盖默认参数（temperature, max_tokens, top_p 等）

        Returns:
            ChatResponse 响应
        """
        request = self._build_request(messages, **kwargs)
        api_kwargs = request.to_api_kwargs(self.config.model)

        logger.debug(f"[{self._name}] 同步请求, messages={len(request.messages)} 条")

        try:
            completion = self._sync_client.chat.completions.create(**api_kwargs)
        except Exception as exc:
            raise self._wrap_exception(exc) from exc

        return self._parse_response(completion)

    def stream(
        self,
        messages: list[ChatMessage] | list[dict[str, str]],
        **kwargs: Any,
    ) -> Iterator[str]:
        """同步流式输出，逐 token 返回文本。

        Args:
            messages: 消息列表
            **kwargs: 覆盖默认参数

        Yields:
            str: 每个文本片段
        """
        request = self._build_request(messages, **kwargs)
        api_kwargs = request.to_api_kwargs(self.config.model)
        api_kwargs["stream"] = True

        logger.debug(f"[{self._name}] 流式请求, messages={len(request.messages)} 条")

        try:
            stream = self._sync_client.chat.completions.create(**api_kwargs)
            for chunk in stream:
                delta = chunk.choices[0].delta if chunk.choices else None
                if delta and delta.content:
                    yield delta.content
        except Exception as exc:
            raise self._wrap_exception(exc) from exc

    # ------------------------------------------------------------------
    # 异步接口
    # ------------------------------------------------------------------

    @retry(
        retry=retry_if_exception_type((LLMRequestError, LLMTimeoutError)),
        stop=stop_after_attempt(3),
        wait=wait_exponential(multiplier=1, min=2, max=30),
        reraise=True,
    )
    async def achat(
        self,
        messages: list[ChatMessage] | list[dict[str, str]],
        **kwargs: Any,
    ) -> ChatResponse:
        """异步聊天接口。

        Args:
            messages: 消息列表
            **kwargs: 覆盖默认参数

        Returns:
            ChatResponse 响应
        """
        import time as _time

        request = self._build_request(messages, **kwargs)
        api_kwargs = request.to_api_kwargs(self.config.model)

        logger.debug(f"[{self._name}] 异步请求, messages={len(request.messages)} 条")

        # 记录交互请求
        interaction = None
        if self._interaction_logger:
            interaction = self._interaction_logger.record(
                messages=request.messages,
                model=self.config.model,
                temperature=request.temperature,
                max_tokens=request.max_tokens,
                functions=request.functions,
                function_call=request.function_call,
            )

        start = _time.perf_counter()

        try:
            completion = await self._async_client.chat.completions.create(**api_kwargs)
        except Exception as exc:
            # 记录错误
            if interaction:
                interaction.elapsed_ms = int((_time.perf_counter() - start) * 1000)
                interaction.error = str(exc)
            raise self._wrap_exception(exc) from exc

        response = self._parse_response(completion)

        # 填充交互响应
        if interaction:
            interaction.elapsed_ms = int((_time.perf_counter() - start) * 1000)
            interaction.response_content = response.content
            interaction.finish_reason = response.finish_reason
            interaction.prompt_tokens = response.usage.prompt_tokens
            interaction.completion_tokens = response.usage.completion_tokens
            interaction.total_tokens = response.usage.total_tokens
            # 从 raw 中提取 function_call
            if response.raw:
                choices = response.raw.get("choices", [])
                if choices:
                    msg = choices[0].get("message", {})
                    interaction.response_function_call = msg.get("function_call")

        return response

    async def astream(
        self,
        messages: list[ChatMessage] | list[dict[str, str]],
        **kwargs: Any,
    ) -> AsyncIterator[str]:
        """异步流式输出，逐 token 返回文本。

        Args:
            messages: 消息列表
            **kwargs: 覆盖默认参数，支持 on_delta 回调（每个 chunk 的 delta 对象，
                含 content / function_call，用于感知原生 function_call 的到达时序）

        Yields:
            str: 每个文本片段
        """
        import time as _time

        on_delta = kwargs.pop("on_delta", None)

        request = self._build_request(messages, **kwargs)
        api_kwargs = request.to_api_kwargs(self.config.model)
        api_kwargs["stream"] = True

        logger.debug(f"[{self._name}] 异步流式请求, messages={len(request.messages)} 条")

        # 记录交互请求
        interaction = None
        if self._interaction_logger:
            interaction = self._interaction_logger.record(
                messages=request.messages,
                model=self.config.model,
                temperature=request.temperature,
                max_tokens=request.max_tokens,
                functions=request.functions,
                function_call=request.function_call,
            )

        start = _time.perf_counter()
        parts: list[str] = []
        finish_reason = "stop"
        usage: TokenUsage | None = None
        fc_name = ""
        fc_args = ""

        try:
            stream = await self._async_client.chat.completions.create(**api_kwargs)
            async for chunk in stream:
                # 最后一个 chunk 可能携带 usage / finish_reason
                if getattr(chunk, "usage", None):
                    usage = chunk.usage
                if chunk.choices:
                    finish_reason = chunk.choices[0].finish_reason or finish_reason
                    delta = chunk.choices[0].delta
                    if delta:
                        # 感知原生 function_call 到达时序
                        if on_delta:
                            on_delta(delta)
                        if delta.content:
                            parts.append(delta.content)
                            yield delta.content
                        # 流式 function_call：name 与 arguments 分块到达，需累积
                        fc = getattr(delta, "function_call", None)
                        if fc:
                            if getattr(fc, "name", None):
                                fc_name = fc.name
                            if getattr(fc, "arguments", None):
                                fc_args += fc.arguments
        except Exception as exc:
            if interaction:
                interaction.elapsed_ms = int((_time.perf_counter() - start) * 1000)
                interaction.error = str(exc)
            raise self._wrap_exception(exc) from exc

        content = "".join(parts)

        # 填充交互响应
        if interaction:
            interaction.elapsed_ms = int((_time.perf_counter() - start) * 1000)
            interaction.response_content = content
            interaction.finish_reason = finish_reason
            if fc_name:
                interaction.response_function_call = {"name": fc_name, "arguments": fc_args}
            if usage:
                interaction.prompt_tokens = usage.prompt_tokens or 0
                interaction.completion_tokens = usage.completion_tokens or 0
                interaction.total_tokens = usage.total_tokens or 0
            else:
                interaction.prompt_tokens = self.count_tokens(messages)
                interaction.completion_tokens = self.count_text_tokens(content)
                interaction.total_tokens = interaction.prompt_tokens + interaction.completion_tokens

    # ------------------------------------------------------------------
    # Token 计数
    # ------------------------------------------------------------------

    def count_tokens(self, messages: list[ChatMessage] | list[dict[str, str]]) -> int:
        """估算消息列表的 token 数。

        Args:
            messages: 消息列表

        Returns:
            总 token 数（含角色标记开销）
        """
        total = 0
        for msg in self._normalize_messages(messages):
            # 每条消息约 4 token 开销（<|im_start|>role\n content <|im_end|>\n）
            total += 4
            total += len(self._encoding.encode(msg.content))
        total += 2  # 每轮对话结尾开销
        return total

    def count_text_tokens(self, text: str) -> int:
        """估算纯文本的 token 数。"""
        return len(self._encoding.encode(text))

    # ------------------------------------------------------------------
    # 内部方法
    # ------------------------------------------------------------------

    def _build_request(
        self,
        messages: list[ChatMessage] | list[dict[str, str]],
        **kwargs: Any,
    ) -> ChatRequest:
        """构建请求对象，合并默认参数与传入参数。"""
        normalized = self._normalize_messages(messages)

        return ChatRequest(
            messages=normalized,
            temperature=kwargs.pop("temperature", self.config.temperature),
            max_tokens=kwargs.pop("max_tokens", self.config.max_tokens),
            top_p=kwargs.pop("top_p", 1.0),
            frequency_penalty=kwargs.pop("frequency_penalty", 0.0),
            presence_penalty=kwargs.pop("presence_penalty", 0.0),
            stop=kwargs.pop("stop", None),
            seed=kwargs.pop("seed", None),
            functions=kwargs.pop("functions", None),
            function_call=kwargs.pop("function_call", None),
        )

    @staticmethod
    def _normalize_messages(
        messages: list[ChatMessage] | list[dict[str, str]],
    ) -> list[ChatMessage]:
        """将 dict 消息统一转为 ChatMessage 对象。"""
        result: list[ChatMessage] = []
        for msg in messages:
            if isinstance(msg, ChatMessage):
                result.append(msg)
            elif isinstance(msg, dict):
                result.append(ChatMessage(
                    role=msg["role"],
                    content=msg.get("content", ""),
                    function_call=msg.get("function_call"),
                    name=msg.get("name"),
                ))
            else:
                raise LLMConfigError(f"不支持的消息类型: {type(msg)}")
        return result

    def _parse_response(self, completion: Any) -> ChatResponse:
        """解析 OpenAI SDK 响应为 ChatResponse。"""
        try:
            choice = completion.choices[0]
            content = choice.message.content or ""
            usage = completion.usage

            token_usage = TokenUsage()
            if usage:
                token_usage = TokenUsage(
                    prompt_tokens=usage.prompt_tokens,
                    completion_tokens=usage.completion_tokens,
                    total_tokens=usage.total_tokens,
                )

            return ChatResponse(
                content=content,
                model=completion.model,
                usage=token_usage,
                finish_reason=choice.finish_reason or "stop",
                raw=completion.model_dump() if hasattr(completion, "model_dump") else None,
            )
        except (IndexError, AttributeError) as exc:
            raise LLMResponseError(f"响应解析失败: {exc}") from exc

    @staticmethod
    def _wrap_exception(exc: Exception) -> Exception:
        """将底层异常转换为本模块异常。"""
        # openai 库的异常类层次: openai.APIError → openai.APIStatusError / openai.APIConnectionError
        exc_type_name = type(exc).__name__

        # 认证错误
        if exc_type_name in ("AuthenticationError",) or (
            hasattr(exc, "status_code") and exc.status_code == 401
        ):
            return LLMAuthError()

        # 速率限制
        if exc_type_name in ("RateLimitError",) or (
            hasattr(exc, "status_code") and exc.status_code == 429
        ):
            return LLMRateLimitError()

        # 超时
        if exc_type_name in ("APITimeoutError", "Timeout"):
            return LLMTimeoutError(f"请求超时: {exc}")

        # 连接错误
        if exc_type_name in ("APIConnectionError", "APIError"):
            status = getattr(exc, "status_code", None)
            return LLMRequestError(f"请求失败: {exc}", status_code=status)

        # 其他
        status = getattr(exc, "status_code", None)
        return LLMRequestError(f"未知错误: {exc}", status_code=status)

    def close(self) -> None:
        """关闭客户端，释放连接。"""
        self._sync_client.close()
        # AsyncOpenAI 需要异步关闭，这里仅同步关闭
        # 在异步上下文中应使用 await client.aclose()

    async def aclose(self) -> None:
        """异步关闭客户端。"""
        self._sync_client.close()
        await self._async_client.close()

    def get_last_interaction(self):
        """获取最后一条交互记录（供调用方回填工具结果等）。

        Returns:
            LLMInteraction | None
        """
        if self._interaction_logger:
            return self._interaction_logger.get_last()
        return None

    def __repr__(self) -> str:
        return f"LLMClient(model={self.config.model}, base_url={self.config.base_url})"
