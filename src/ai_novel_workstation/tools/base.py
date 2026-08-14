"""工具基类。

所有工具继承 BaseTool，实现 execute 方法。
工具通过 name / description / parameters 暴露给 LLM。
"""

from __future__ import annotations

from abc import ABC, abstractmethod
from typing import Any

from pydantic import BaseModel, Field


class ToolParameter(BaseModel):
    """工具参数定义。"""

    name: str = Field(description="参数名")
    type: str = Field(description="参数类型: string/integer/number/boolean")
    description: str = Field(description="参数说明")
    required: bool = Field(default=True)
    default: Any | None = None


class ToolResult(BaseModel):
    """工具执行结果。"""

    success: bool
    output: str = Field(description="工具输出内容（给 LLM 观察）")
    error: str = Field(default="")


class BaseTool(ABC):
    """工具基类。"""

    @property
    @abstractmethod
    def name(self) -> str:
        """工具名称（LLM 调用时使用）。"""

    @property
    @abstractmethod
    def description(self) -> str:
        """工具描述（给 LLM 理解工具用途）。"""

    @property
    @abstractmethod
    def parameters(self) -> list[ToolParameter]:
        """工具参数列表。"""

    @abstractmethod
    async def execute(self, **kwargs: Any) -> ToolResult:
        """执行工具。"""

    def to_prompt(self) -> str:
        """转为 LLM 可读的工具描述。"""
        params_str = "\n".join(
            f"  - {p.name} ({p.type}): {p.description}"
            + ("" if p.required else " (可选)")
            + (f" [默认: {p.default}]" if p.default is not None else "")
            for p in self.parameters
        )
        return f"工具: {self.name}\n描述: {self.description}\n参数:\n{params_str}"

    def to_openai_function(self) -> dict:
        """转为 OpenAI function calling 格式。"""
        properties: dict[str, Any] = {}
        required: list[str] = []
        for p in self.parameters:
            properties[p.name] = {
                "type": p.type,
                "description": p.description,
            }
            if p.default is not None:
                properties[p.name]["default"] = p.default
            if p.required:
                required.append(p.name)

        return {
            "name": self.name,
            "description": self.description,
            "parameters": {
                "type": "object",
                "properties": properties,
                "required": required,
            },
        }
