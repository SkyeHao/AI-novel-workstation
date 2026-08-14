"""向用户提问工具（人机交互）。

当 Agent 需要作者做出选择（题材、平台、设定偏好等）时调用本工具：
- 前端展示选择框（单选 / 多选 / 自定义文本输入）
- 工具暂停，等待用户回答后继续 ReAct 循环

DSML 模式下参数为字符串，执行时做了类型归一化。
"""

from __future__ import annotations

import json
from collections.abc import Awaitable, Callable
from typing import Any

from ai_novel_workstation.tools.base import BaseTool, ToolParameter, ToolResult


def _to_bool(value: Any) -> bool:
    if isinstance(value, bool):
        return value
    if isinstance(value, str):
        return value.strip().lower() in ("true", "1", "yes", "y", "是")
    return bool(value)


def _to_list(value: Any) -> list[str]:
    if value is None:
        return []
    if isinstance(value, list):
        return [str(x) for x in value]
    if isinstance(value, str):
        s = value.strip()
        if not s:
            return []
        try:
            parsed = json.loads(s)
            if isinstance(parsed, list):
                return [str(x) for x in parsed]
        except json.JSONDecodeError:
            pass
        return [x.strip() for x in s.split(",") if x.strip()]
    return [str(value)]


class AskUserTool(BaseTool):
    """向作者提问工具。"""

    def __init__(
        self,
        ask_fn: Callable[[str, list[str], bool, bool], Awaitable[str]],
    ) -> None:
        """初始化。

        Args:
            ask_fn: 异步回调，签名 (question, options, multiple, allow_custom) -> 用户回答
        """
        self._ask_fn = ask_fn

    @property
    def name(self) -> str:
        return "ask_user"

    @property
    def description(self) -> str:
        return (
            "当需要作者做出选择（如题材、平台、设定偏好、创作方向等）时调用本工具，"
            "向作者展示选项并等待其回答。支持单选、多选、自定义文本输入。"
            "适合在创作方向不确定、需要作者拍板时使用。"
        )

    @property
    def parameters(self) -> list[ToolParameter]:
        return [
            ToolParameter(
                name="question",
                type="string",
                description="向作者提出的问题",
            ),
            ToolParameter(
                name="options",
                type="array",
                description="候选选项列表，如 [\"玄幻\", \"都市\"]",
                required=False,
                default=[],
            ),
            ToolParameter(
                name="multiple",
                type="boolean",
                description="是否允许多选",
                required=False,
                default=False,
            ),
            ToolParameter(
                name="allow_custom",
                type="boolean",
                description="是否允许作者输入自定义文本",
                required=False,
                default=True,
            ),
        ]

    async def execute(
        self,
        question: str = "",
        options: Any = None,
        multiple: Any = False,
        allow_custom: Any = True,
        **kwargs: Any,
    ) -> ToolResult:
        question = str(question or "").strip() or "请做出选择"
        opts = _to_list(options)
        multi = _to_bool(multiple)
        custom = _to_bool(allow_custom)

        answer = await self._ask_fn(question, opts, multi, custom)
        return ToolResult(success=True, output=f"作者的选择：{answer}")
