"""LLM 数据模型定义。"""

from __future__ import annotations

from enum import Enum

from pydantic import BaseModel, Field


class Role(str, Enum):
    """消息角色。"""

    SYSTEM = "system"
    USER = "user"
    ASSISTANT = "assistant"
    FUNCTION = "function"


class ChatMessage(BaseModel):
    """单条聊天消息。"""

    role: Role
    content: str = ""
    function_call: dict | None = None
    name: str | None = None

    def to_dict(self) -> dict:
        d: dict = {"role": self.role.value, "content": self.content}
        if self.function_call:
            d["function_call"] = self.function_call
        if self.name:
            d["name"] = self.name
        return d


class TokenUsage(BaseModel):
    """Token 用量统计。"""

    prompt_tokens: int = 0
    completion_tokens: int = 0
    total_tokens: int = 0


class ChatRequest(BaseModel):
    """聊天请求参数。

    封装 OpenAI Chat Completions API 的常用参数，
    所有 OpenAI 协议兼容服务均支持。
    """

    messages: list[ChatMessage]
    temperature: float = 0.7
    max_tokens: int | None = None
    top_p: float = 1.0
    frequency_penalty: float = 0.0
    presence_penalty: float = 0.0
    stop: list[str] | str | None = None
    seed: int | None = None
    functions: list[dict] | None = None
    function_call: str | dict | None = None

    def to_api_kwargs(self, model: str) -> dict:
        """转换为 OpenAI SDK 的 kwargs 格式。"""
        kwargs: dict = {
            "model": model,
            "messages": [m.to_dict() for m in self.messages],
            "temperature": self.temperature,
            "top_p": self.top_p,
            "frequency_penalty": self.frequency_penalty,
            "presence_penalty": self.presence_penalty,
        }
        if self.max_tokens is not None:
            kwargs["max_tokens"] = self.max_tokens
        if self.stop is not None:
            kwargs["stop"] = self.stop
        if self.seed is not None:
            kwargs["seed"] = self.seed
        if self.functions is not None:
            kwargs["functions"] = self.functions
        if self.function_call is not None:
            kwargs["function_call"] = self.function_call
        return kwargs


class ChatResponse(BaseModel):
    """聊天响应。"""

    content: str = Field(description="生成的文本内容")
    model: str = Field(description="实际使用的模型名称")
    usage: TokenUsage = Field(default_factory=TokenUsage)
    finish_reason: str = Field(default="stop", description="结束原因: stop/length/content_filter")
    raw: dict | None = Field(default=None, description="原始响应（调试用）")
