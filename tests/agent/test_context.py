"""上下文管理器单元测试。

不依赖真实 API：使用真实 LLMClient 做 token 估算（tiktoken 本地编码），
摘要生成通过 mock 验证。
"""

from __future__ import annotations

from unittest.mock import AsyncMock, patch

import pytest

from ai_novel_workstation.agent.context import ContextManager
from ai_novel_workstation.config.settings import LLMModelConfig
from ai_novel_workstation.llm.client import LLMClient
from ai_novel_workstation.llm.models import ChatMessage, Role


@pytest.fixture
def client() -> LLMClient:
    """测试用 LLM Client（仅用于 token 估算）。"""
    return LLMClient(
        LLMModelConfig(
            api_key="sk-test",
            base_url="https://api.openai.com/v1",
            model="gpt-4o",
        )
    )


def _msg(role: Role, content: str) -> ChatMessage:
    return ChatMessage(role=role, content=content)


class TestBudget:
    """预算模型。"""

    def test_budget_calculation(self, client: LLMClient) -> None:
        cm = ContextManager(client, context_window=1000, reserved_output_tokens=200)
        assert cm.budget == 800

    def test_budget_minimum(self, client: LLMClient) -> None:
        cm = ContextManager(client, context_window=500, reserved_output_tokens=2000)
        assert cm.budget == 512  # 不小于下限


class TestPerMessageTruncation:
    """单条消息裁剪。"""

    def test_long_function_message_truncated(self, client: LLMClient) -> None:
        cm = ContextManager(
            client,
            context_window=100000,
            max_observation_tokens=100,
            enable_summary=False,
        )
        long_obs = "观" * 3000
        messages = [
            _msg(Role.SYSTEM, "sys"),
            _msg(Role.USER, "user"),
            _msg(Role.FUNCTION, long_obs),
        ]
        kept, dropped = cm.trim(messages)
        assert dropped == []
        # function 消息应被截断
        assert len(kept[2].content) < len(long_obs)
        assert kept[2].content.endswith("[已截断]")
        assert cm.estimate([kept[2]]) < cm.estimate([_msg(Role.FUNCTION, long_obs)])

    def test_normal_message_kept_under_limit(self, client: LLMClient) -> None:
        cm = ContextManager(client, context_window=100000, max_message_tokens=100)
        kept, _ = cm.trim([_msg(Role.SYSTEM, "sys"), _msg(Role.USER, "短消息")])
        assert kept[1].content == "短消息"


class TestSlidingWindow:
    """滑动窗口。"""

    def test_drops_oldest_keeps_system_and_latest(self, client: LLMClient) -> None:
        cm = ContextManager(
            client,
            context_window=1200,
            reserved_output_tokens=200,
            enable_summary=False,
        )
        messages = [_msg(Role.SYSTEM, "sys")]
        for i in range(30):
            messages.append(_msg(Role.USER, f"用户问题{i} " + "很长的内容" * 10))
            messages.append(_msg(Role.ASSISTANT, f"回答{i} " + "很长的内容" * 10))

        kept, dropped = cm.trim(messages)
        assert cm.estimate(kept) <= cm.budget
        assert len(dropped) > 0
        # 系统提示词必须保留
        assert kept[0].role == Role.SYSTEM
        # 最新（最后）的消息必须保留
        assert kept[-1] is messages[-1]

    def test_function_pair_integrity(self, client: LLMClient) -> None:
        """裁剪后不得出现游离的 function 消息。"""
        cm = ContextManager(
            client,
            context_window=1200,
            reserved_output_tokens=200,
            enable_summary=False,
        )
        messages = [
            _msg(Role.SYSTEM, "sys"),
            _msg(Role.USER, "q1"),
            ChatMessage(
                role=Role.ASSISTANT,
                content="call",
                function_call={"name": "web_search", "arguments": "{}"},
            ),
            _msg(Role.FUNCTION, "obs1"),
            _msg(Role.USER, "q2"),
            _msg(Role.ASSISTANT, "a2"),
            _msg(Role.USER, "q3"),
            ChatMessage(
                role=Role.ASSISTANT,
                content="call",
                function_call={"name": "file_write", "arguments": "{}"},
            ),
            _msg(Role.FUNCTION, "obs2"),
        ]

        kept, _ = cm.trim(messages)
        # 从索引 1 起，function 消息必须紧跟 assistant（function_call）之后
        for i in range(1, len(kept)):
            if kept[i].role == Role.FUNCTION:
                assert kept[i - 1].role == Role.ASSISTANT
        # 第一条非 system 消息不能是 function
        assert len(kept) < 2 or kept[1].role != Role.FUNCTION


class TestSummary:
    """摘要压缩。"""

    @pytest.mark.asyncio
    async def test_summary_injected_on_drop(self, client: LLMClient) -> None:
        cm = ContextManager(
            client,
            context_window=1500,
            reserved_output_tokens=300,
            enable_summary=True,
        )
        messages = [_msg(Role.SYSTEM, "sys")]
        for i in range(30):
            messages.append(_msg(Role.USER, f"用户问题{i} " + "很长的内容" * 10))
            messages.append(_msg(Role.ASSISTANT, f"回答{i} " + "很长的内容" * 10))

        with patch.object(
            cm,
            "_summarize",
            new=AsyncMock(return_value="1. 作者需求：写玄幻小说\n2. 已决定：番茄平台"),
        ):
            result = await cm.process(messages)

        # 摘要应注入到系统提示词
        assert "历史对话摘要" in result[0].content
        assert "作者需求" in result[0].content

    @pytest.mark.asyncio
    async def test_summary_skipped_when_no_drop(self, client: LLMClient) -> None:
        cm = ContextManager(client, context_window=100000, enable_summary=True)
        with patch.object(cm, "_summarize", new=AsyncMock()) as mock_summarize:
            result = await cm.process([_msg(Role.SYSTEM, "sys"), _msg(Role.USER, "hi")])
        mock_summarize.assert_not_awaited()
        assert "历史对话摘要" not in result[0].content
