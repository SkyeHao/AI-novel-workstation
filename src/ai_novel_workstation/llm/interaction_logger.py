"""LLM 交互记录器。

记录每次 LLM 调用的完整请求和响应，供前端展示和调试。
"""

from __future__ import annotations

from dataclasses import dataclass, field

from ai_novel_workstation.llm.models import ChatMessage


@dataclass
class LLMInteraction:
    """单次 LLM 交互记录。"""

    # 请求信息
    messages: list[dict] = field(default_factory=list)
    model: str = ""
    temperature: float = 0.7
    max_tokens: int | None = None
    functions: list[dict] | None = None
    function_call: str | dict | None = None

    # 响应信息
    response_content: str = ""
    response_function_call: dict | None = None
    finish_reason: str = ""
    prompt_tokens: int = 0
    completion_tokens: int = 0
    total_tokens: int = 0

    # 工具执行结果（LLM 触发 function_call 后，工具执行的结果）
    tool_name: str = ""
    tool_args: dict = field(default_factory=dict)
    tool_result: str = ""
    tool_success: bool = True

    # 元信息
    elapsed_ms: int = 0
    error: str = ""
    timestamp: str = ""

    def to_dict(self) -> dict:
        return {
            "messages": self.messages,
            "model": self.model,
            "temperature": self.temperature,
            "max_tokens": self.max_tokens,
            "functions": self.functions,
            "function_call": self.function_call,
            "response_content": self.response_content,
            "response_function_call": self.response_function_call,
            "finish_reason": self.finish_reason,
            "prompt_tokens": self.prompt_tokens,
            "completion_tokens": self.completion_tokens,
            "total_tokens": self.total_tokens,
            "tool_name": self.tool_name,
            "tool_args": self.tool_args,
            "tool_result": self.tool_result,
            "tool_success": self.tool_success,
            "elapsed_ms": self.elapsed_ms,
            "error": self.error,
            "timestamp": self.timestamp,
        }


class InteractionLogger:
    """LLM 交互记录器。

    作为 LLMClient 的观察者，记录每次调用的完整信息。
    """

    def __init__(self) -> None:
        self._interactions: list[LLMInteraction] = []

    def record(
        self,
        messages: list[ChatMessage] | list[dict],
        model: str,
        temperature: float = 0.7,
        max_tokens: int | None = None,
        functions: list[dict] | None = None,
        function_call: str | dict | None = None,
    ) -> LLMInteraction:
        """记录请求，返回 interaction 对象供后续填充响应。"""
        from datetime import datetime

        # 序列化消息
        serialized: list[dict] = []
        for msg in messages:
            if isinstance(msg, ChatMessage):
                serialized.append(msg.to_dict())
            elif isinstance(msg, dict):
                serialized.append(msg)

        interaction = LLMInteraction(
            messages=serialized,
            model=model,
            temperature=temperature,
            max_tokens=max_tokens,
            functions=functions,
            function_call=function_call,
            timestamp=datetime.now().isoformat(timespec="seconds"),
        )
        self._interactions.append(interaction)
        return interaction

    def get_all(self) -> list[LLMInteraction]:
        """获取所有交互记录。"""
        return list(self._interactions)

    def get_last(self) -> LLMInteraction | None:
        """获取最后一条交互记录。"""
        if self._interactions:
            return self._interactions[-1]
        return None

    def clear(self) -> None:
        """清空记录。"""
        self._interactions.clear()

    def to_list(self) -> list[dict]:
        """转为字典列表。"""
        return [i.to_dict() for i in self._interactions]
