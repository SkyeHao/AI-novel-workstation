"""LLM Client 单元测试。

使用 mock 测试，不依赖真实 API 调用。
"""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from ai_novel_workstation.config.settings import LLMModelConfig
from ai_novel_workstation.llm.client import LLMClient
from ai_novel_workstation.llm.exceptions import LLMConfigError
from ai_novel_workstation.llm.manager import LLMClientManager
from ai_novel_workstation.llm.models import ChatMessage, Role

# ============================================================
# LLMClient 测试
# ============================================================


@pytest.fixture
def llm_config() -> LLMModelConfig:
    """测试用的模型配置。"""
    return LLMModelConfig(
        api_key="sk-test-key",
        base_url="https://api.openai.com/v1",
        model="gpt-4o",
        temperature=0.7,
    )


@pytest.fixture
def llm_client(llm_config: LLMModelConfig) -> LLMClient:
    """测试用的 LLM Client。"""
    return LLMClient(llm_config)


def _make_mock_completion(
    content: str = "你好！",
    model: str = "gpt-4o",
    prompt_tokens: int = 10,
    completion_tokens: int = 5,
) -> MagicMock:
    """构造 mock 的 completion 响应对象。"""
    completion = MagicMock()
    completion.model = model
    completion.model_dump.return_value = {"id": "test-id", "model": model}

    choice = MagicMock()
    choice.message.content = content
    choice.finish_reason = "stop"
    completion.choices = [choice]

    usage = MagicMock()
    usage.prompt_tokens = prompt_tokens
    usage.completion_tokens = completion_tokens
    usage.total_tokens = prompt_tokens + completion_tokens
    completion.usage = usage

    return completion


class TestLLMClientInit:
    """LLMClient 初始化测试。"""

    def test_init_success(self, llm_config: LLMModelConfig) -> None:
        """正常初始化。"""
        client = LLMClient(llm_config)
        assert client.config.api_key == "sk-test-key"
        assert client.config.model == "gpt-4o"

    def test_init_empty_api_key(self) -> None:
        """api_key 为空应抛出 LLMConfigError。"""
        config = LLMModelConfig(api_key="", base_url="https://api.openai.com/v1", model="gpt-4o")
        with pytest.raises(LLMConfigError, match="api_key 不能为空"):
            LLMClient(config)


class TestChatSync:
    """同步 chat 接口测试。"""

    def test_chat_with_chat_message_objects(self, llm_client: LLMClient) -> None:
        """使用 ChatMessage 对象调用。"""
        mock_completion = _make_mock_completion(content="你好！", model="gpt-4o")

        with patch.object(
            llm_client._sync_client.chat.completions,
            "create",
            return_value=mock_completion,
        ):
            response = llm_client.chat([
                ChatMessage(role=Role.USER, content="你好"),
            ])

        assert response.content == "你好！"
        assert response.model == "gpt-4o"
        assert response.usage.prompt_tokens == 10
        assert response.usage.completion_tokens == 5
        assert response.usage.total_tokens == 15
        assert response.finish_reason == "stop"

    def test_chat_with_dict_messages(self, llm_client: LLMClient) -> None:
        """使用 dict 格式消息调用。"""
        mock_completion = _make_mock_completion(content="回复")

        with patch.object(
            llm_client._sync_client.chat.completions,
            "create",
            return_value=mock_completion,
        ):
            response = llm_client.chat([
                {"role": "system", "content": "你是助手"},
                {"role": "user", "content": "测试"},
            ])

        assert response.content == "回复"

    def test_chat_with_kwargs_override(self, llm_client: LLMClient) -> None:
        """kwargs 可覆盖默认参数。"""
        mock_completion = _make_mock_completion()

        with patch.object(
            llm_client._sync_client.chat.completions,
            "create",
            return_value=mock_completion,
        ) as mock_create:
            llm_client.chat(
                [ChatMessage(role=Role.USER, content="测试")],
                temperature=0.1,
                max_tokens=100,
            )

        call_kwargs = mock_create.call_args.kwargs
        assert call_kwargs["temperature"] == 0.1
        assert call_kwargs["max_tokens"] == 100


class TestChatAsync:
    """异步 chat 接口测试。"""

    @pytest.mark.asyncio
    async def test_achat_success(self, llm_client: LLMClient) -> None:
        """异步调用成功。"""
        mock_completion = _make_mock_completion(content="异步回复")

        with patch.object(
            llm_client._async_client.chat.completions,
            "create",
            new_callable=AsyncMock,
            return_value=mock_completion,
        ):
            response = await llm_client.achat([
                ChatMessage(role=Role.USER, content="异步测试"),
            ])

        assert response.content == "异步回复"


class TestStream:
    """流式输出测试。"""

    def test_stream_sync(self, llm_client: LLMClient) -> None:
        """同步流式输出。"""
        # 构造 mock stream
        chunks = []
        for text in ["你", "好", "！"]:
            chunk = MagicMock()
            delta = MagicMock()
            delta.content = text
            chunk.choices = [MagicMock(delta=delta)]
            chunks.append(chunk)

        with patch.object(
            llm_client._sync_client.chat.completions,
            "create",
            return_value=iter(chunks),
        ):
            result = list(llm_client.stream([
                ChatMessage(role=Role.USER, content="你好"),
            ]))

        assert result == ["你", "好", "！"]


class TestTokenCount:
    """Token 计数测试。"""

    def test_count_text_tokens(self, llm_client: LLMClient) -> None:
        """纯文本 token 计数。"""
        count = llm_client.count_text_tokens("你好世界")
        assert count > 0

    def test_count_message_tokens(self, llm_client: LLMClient) -> None:
        """消息列表 token 计数。"""
        count = llm_client.count_tokens([
            ChatMessage(role=Role.SYSTEM, content="你是助手"),
            ChatMessage(role=Role.USER, content="你好"),
        ])
        assert count > 10  # 至少包含内容 token + 4*2 开销 + 2 结尾

    def test_count_dict_tokens(self, llm_client: LLMClient) -> None:
        """dict 格式消息 token 计数。"""
        count = llm_client.count_tokens([
            {"role": "user", "content": "测试"},
        ])
        assert count > 0


# ============================================================
# LLMClientManager 测试
# ============================================================


class TestLLMClientManager:
    """多模型管理器测试。"""

    def test_register_and_get(self) -> None:
        """注册并获取 client。"""
        manager = LLMClientManager()
        config = LLMModelConfig(
            api_key="sk-test",
            base_url="https://api.openai.com/v1",
            model="gpt-4o",
        )
        manager.register("text", config)

        client = manager.get_client("text")
        assert client.config.model == "gpt-4o"

    def test_fallback(self) -> None:
        """未配置任务应降级。"""
        manager = LLMClientManager()
        config = LLMModelConfig(
            api_key="sk-test",
            base_url="https://api.openai.com/v1",
            model="gpt-4o-mini",
        )
        manager.register("check", config)

        # "text" 未注册，应降级到 "check"
        client = manager.get_client("text")
        assert client.config.model == "gpt-4o-mini"

    def test_no_client_error(self) -> None:
        """无可用 client 应抛出异常。"""
        manager = LLMClientManager()
        with pytest.raises(LLMConfigError, match="没有可用的 LLM client"):
            manager.get_client("text")

    def test_available_tasks(self) -> None:
        """已注册任务列表。"""
        manager = LLMClientManager()
        manager.register("text", LLMModelConfig(
            api_key="sk-1", base_url="https://a.com/v1", model="gpt-4o",
        ))
        manager.register("check", LLMModelConfig(
            api_key="sk-2", base_url="https://b.com/v1", model="gpt-4o-mini",
        ))

        assert set(manager.available_tasks) == {"text", "check"}
