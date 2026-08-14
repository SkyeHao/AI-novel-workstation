"""AskUserTool 单元测试。"""

from __future__ import annotations

import asyncio

import pytest

from ai_novel_workstation.tools.ask_user import AskUserTool


class TestAskUserTool:
    """ask_user 工具。"""

    @pytest.mark.asyncio
    async def test_execute_returns_user_answer(self) -> None:
        async def ask_fn(question, options, multiple, allow_custom):
            return "玄幻"

        tool = AskUserTool(ask_fn)
        result = await tool.execute(question="选什么题材？", options=["玄幻", "都市"])
        assert result.success
        assert "作者的选择：玄幻" in result.output

    @pytest.mark.asyncio
    async def test_dsml_string_params_normalized(self) -> None:
        """DSML 模式下参数是字符串，需归一化。"""
        captured = {}

        async def ask_fn(question, options, multiple, allow_custom):
            captured.update(question=question, options=options, multiple=multiple, allow_custom=allow_custom)
            return "番茄"

        tool = AskUserTool(ask_fn)
        await tool.execute(
            question="平台？",
            options='["番茄", "起点"]',  # DSML 传入的 JSON 字符串
            multiple="true",
            allow_custom="false",
        )
        assert captured["options"] == ["番茄", "起点"]
        assert captured["multiple"] is True
        assert captured["allow_custom"] is False

    @pytest.mark.asyncio
    async def test_execute_waits_for_answer(self) -> None:
        """工具应暂停直到收到回答。"""
        future = asyncio.get_event_loop().create_future()

        async def ask_fn(question, options, multiple, allow_custom):
            answer = await future
            return answer

        tool = AskUserTool(ask_fn)
        task = asyncio.ensure_future(tool.execute(question="q", options=[]))
        await asyncio.sleep(0)
        assert not task.done()  # 未回答前不返回
        future.set_result("自定义答案")
        result = await task
        assert "自定义答案" in result.output
