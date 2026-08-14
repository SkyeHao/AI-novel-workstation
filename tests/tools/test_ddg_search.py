"""ddg（ddgs 库）搜索实现 单元测试。

独立测试类 TestDdgsSearch：mock ddgs.DDGS，
验证基于 ddgs 库（backend=bing）的搜索逻辑，不依赖真实网络。
"""

from __future__ import annotations

from unittest.mock import AsyncMock, patch

import pytest

from ai_novel_workstation.tools.base import ToolResult
from ai_novel_workstation.tools.web_search import WebSearchTool, _format_ddgs_item


class TestDdgsSearch:
    """ddgs 库搜索实现。"""

    @pytest.mark.asyncio
    async def test_search_success_formats_results(self) -> None:
        """ddgs 库返回结果应被格式化为 '标题 — 链接 — 摘要'。"""
        items = [
            {"title": "玄幻小说 热门", "href": "https://a.com", "body": "玄幻 2026 趋势"},
            {"title": "程序员修仙", "href": "https://b.com", "body": "代码修仙流"},
        ]

        with patch(
            "ai_novel_workstation.tools.web_search.asyncio.to_thread",
            new=AsyncMock(return_value=items),
        ):
            tool = WebSearchTool()
            result = await tool._ddgs_search("玄幻 热门", 5)

        assert result.success
        assert "来源: ddg" in result.output
        assert "玄幻小说 热门" in result.output
        assert "https://a.com" in result.output
        assert "玄幻 2026 趋势" in result.output

    @pytest.mark.asyncio
    async def test_search_passes_arguments(self) -> None:
        """ddgs 库调用应传入 query / region / backend / max_results。"""
        captured: dict = {}

        class FakeDDGS:
            def __init__(self, *args, **kwargs):
                captured["init"] = kwargs

            def text(self, **kwargs):
                captured["text"] = kwargs
                return [{"title": "T1", "href": "https://a.com", "body": "B1"}]

        async def run_sync(fn, *args, **kwargs):
            return fn()

        with (
            patch(
                "ai_novel_workstation.tools.web_search.asyncio.to_thread",
                side_effect=run_sync,
            ),
            patch("ddgs.DDGS", FakeDDGS),
        ):
            tool = WebSearchTool()
            result = await tool._ddgs_search("查询词", 7)

        assert result.success
        assert captured["init"]["timeout"] == 8.0
        assert captured["text"]["query"] == "查询词"
        assert captured["text"]["max_results"] == 7
        assert captured["text"]["region"] == "cn-zh"
        assert captured["text"]["backend"] == "bing"  # 指定 Bing 后端

    @pytest.mark.asyncio
    async def test_search_empty_results(self) -> None:
        """无结果时应返回成功且提示未找到。"""
        with patch(
            "ai_novel_workstation.tools.web_search.asyncio.to_thread",
            new=AsyncMock(return_value=[]),
        ):
            tool = WebSearchTool()
            result = await tool._ddgs_search("不存在的内容", 5)

        assert result.success
        assert "未找到结果" in result.output

    @pytest.mark.asyncio
    async def test_search_exception_returns_failure(self) -> None:
        """ddgs 库抛异常时应返回失败结果，而不是向上抛出。"""
        with patch(
            "ai_novel_workstation.tools.web_search.asyncio.to_thread",
            new=AsyncMock(side_effect=RuntimeError("ddgs 请求失败")),
        ):
            tool = WebSearchTool()
            result = await tool._ddgs_search("查询", 5)

        assert result.success is False
        assert "请求失败" in result.error

    @pytest.mark.asyncio
    async def test_execute_uses_baidu_first_then_ddg(self, monkeypatch) -> None:
        """execute 按默认顺序：baidu 优先，ddg 其次。"""
        monkeypatch.delenv("TAVILY_API_KEY", raising=False)
        monkeypatch.delenv("SERPER_API_KEY", raising=False)
        monkeypatch.delenv("WEB_SEARCH_PROVIDERS", raising=False)
        tool = WebSearchTool()
        calls: list[str] = []

        async def fake_search(provider: str, query: str, max_results: int) -> ToolResult:
            calls.append(provider)
            if provider == "baidu":
                return ToolResult(success=False, output="", error="被拦截")
            return ToolResult(success=True, output="ok")

        with patch.object(tool, "_search_with", side_effect=fake_search):
            await tool.execute("查询")

        assert calls[0] == "baidu"  # 百度优先
        assert "ddg" in calls  # 百度失败后轮到 ddg

    def test_format_ddgs_item(self) -> None:
        """条目格式化。"""
        assert _format_ddgs_item(
            {"title": "T", "href": "https://h", "body": "B"}
        ) == "T — https://h — B"
        # 空摘要
        assert _format_ddgs_item({"title": "T", "href": "https://h", "body": ""}) == "T — https://h"
        # 无标题无摘要
        assert _format_ddgs_item({"title": "", "href": "", "body": ""}) == ""
