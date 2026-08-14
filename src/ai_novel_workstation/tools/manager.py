"""工具管理器。

注册、查找、执行工具。
"""

from __future__ import annotations

from loguru import logger

from ai_novel_workstation.tools.base import BaseTool, ToolResult


class ToolManager:
    """工具管理器。"""

    def __init__(self) -> None:
        self._tools: dict[str, BaseTool] = {}

    def register(self, tool: BaseTool) -> None:
        """注册工具。"""
        self._tools[tool.name] = tool
        logger.info(f"注册工具: {tool.name}")

    def unregister(self, name: str) -> None:
        """注销工具。"""
        if name in self._tools:
            del self._tools[name]
            logger.info(f"注销工具: {name}")

    def get(self, name: str) -> BaseTool | None:
        """获取工具。"""
        return self._tools.get(name)

    def list_names(self) -> list[str]:
        """列出所有工具名。"""
        return list(self._tools.keys())

    def list_tools(self) -> list[BaseTool]:
        """列出所有工具。"""
        return list(self._tools.values())

    async def execute(self, name: str, **kwargs) -> ToolResult:
        """执行工具。"""
        tool = self._tools.get(name)
        if tool is None:
            return ToolResult(
                success=False,
                output="",
                error=f"工具不存在: {name}，可用工具: {self.list_names()}",
            )

        try:
            result = await tool.execute(**kwargs)
            logger.debug(f"工具 {name} 执行完成: success={result.success}")
            return result
        except Exception as e:
            logger.exception(f"工具 {name} 执行异常")
            return ToolResult(success=False, output="", error=str(e))

    def to_prompt(self) -> str:
        """转为 LLM 可读的工具列表。"""
        if not self._tools:
            return "（无可用工具）"
        return "\n\n".join(tool.to_prompt() for tool in self._tools.values())

    def to_openai_functions(self) -> list[dict]:
        """转为 OpenAI function calling 格式列表。"""
        return [tool.to_openai_function() for tool in self._tools.values()]
