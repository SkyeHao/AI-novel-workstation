"""联网搜索工具单元测试。

不依赖真实网络：provider 选择用 monkeypatch，网络调用用 mock。
"""

from __future__ import annotations

from unittest.mock import AsyncMock, patch

import pytest

from ai_novel_workstation.tools.base import ToolResult
from ai_novel_workstation.tools.web_search import (
    WebSearchTool,
    _parse_serper,
    _parse_tavily,
)


class TestProviderSelection:
    """搜索源选择逻辑。"""

    def test_skips_api_providers_without_key(self, monkeypatch) -> None:
        monkeypatch.delenv("TAVILY_API_KEY", raising=False)
        monkeypatch.delenv("SERPER_API_KEY", raising=False)
        monkeypatch.delenv("WEB_SEARCH_PROVIDERS", raising=False)

        providers = WebSearchTool._get_providers()
        assert "bing" in providers
        assert "tavily" not in providers
        assert "serper" not in providers

    def test_includes_api_provider_with_key(self, monkeypatch) -> None:
        monkeypatch.setenv("TAVILY_API_KEY", "sk-tavily")
        monkeypatch.delenv("SERPER_API_KEY", raising=False)
        monkeypatch.delenv("WEB_SEARCH_PROVIDERS", raising=False)

        providers = WebSearchTool._get_providers()
        assert providers[0] == "baidu"  # 默认优先级 baidu 在最前
        assert "ddg" in providers  # ddgs 库（bing 后端）
        assert "tavily" in providers  # 配置了 key 的 API 源可用
        assert "serper" not in providers  # 未配置 key 仍跳过

    def test_custom_order(self, monkeypatch) -> None:
        monkeypatch.setenv("WEB_SEARCH_PROVIDERS", "serper,bing")
        monkeypatch.setenv("SERPER_API_KEY", "sk-serper")

        assert WebSearchTool._get_providers() == ["serper", "bing"]


class TestHtmlParsers:
    """免费抓取源 HTML 解析。"""

    def test_parse_bing_html(self) -> None:
        html = (
            '<li class="b_algo"><h2><a href="https://example.com/a">玄幻小说 热门</a></h2>'
            '<p>玄幻 2026 趋势分析</p></li>'
            '<li class="b_algo"><h2><a href="https://example.com/b">程序员修仙</a></h2>'
            "<p>代码修仙流</p></li>"
        )
        results = WebSearchTool._parse_bing_html(html, 5)
        assert len(results) == 2
        assert "玄幻小说 热门" in results[0]
        assert "https://example.com/a" in results[0]
        assert "趋势分析" in results[0]

    def test_parse_baidu_html(self) -> None:
        html = (
            '<h3 class="cosc-title t title_4QsBx">'
            '<a class="cosc-title-a" href="http://www.baidu.com/link?url=abc">'
            "<span><em>玄幻</em>小说热门</span></a></h3>"
            '<!--s-data:{"summaryData":{"generalLines":[{"data":[{"text":"玄幻 2026 趋势分析"}]}]}}-->'
            "<h3 class=\"cosc-title\"><a href=\"http://www.baidu.com/link?url=def\">躺平重生</a></h3>"
        )
        results = WebSearchTool._parse_baidu_html(html, 5)
        assert len(results) == 2
        assert "玄幻小说热门" in results[0]
        assert "http://www.baidu.com/link?url=abc" in results[0]
        assert "趋势分析" in results[0]  # 摘要来自 s-data JSON

    def test_extract_baidu_summary(self) -> None:
        block = (
            '<h3 class="cosc-title">x</h3>'
            '<!--s-data:{"summaryData":{"generalLines":[{"data":[{"text":"A段"}]},{"data":[{"text":"B段"}]}]}}-->'
        )
        summary = WebSearchTool._extract_baidu_summary(block)
        assert "A段" in summary
        assert "B段" in summary

    def test_is_blocked_page(self) -> None:
        assert WebSearchTool._is_blocked_page("baidu", "百度安全验证 请滑动验证") is True
        assert WebSearchTool._is_blocked_page("baidu", "正常搜索结果") is False


class TestApiParsers:
    """API 源响应解析。"""

    def test_parse_tavily(self) -> None:
        data = {"results": [{"title": "T1", "url": "https://u1", "content": "c1"}]}
        out = _parse_tavily(data)
        assert out[0].startswith("T1 — https://u1")
        assert "c1" in out[0]

    def test_parse_serper(self) -> None:
        data = {"organic": [{"title": "T1", "link": "https://u1", "snippet": "s1"}]}
        out = _parse_serper(data)
        assert out[0].startswith("T1 — https://u1")
        assert "s1" in out[0]


class TestExecute:
    """execute 主流程。"""

    @pytest.mark.asyncio
    async def test_max_results_coerced(self, monkeypatch) -> None:
        monkeypatch.setenv("WEB_SEARCH_PROVIDERS", "bing")
        tool = WebSearchTool()
        captured: dict = {}

        async def fake_search(provider: str, query: str, max_results: int) -> ToolResult:
            captured["max_results"] = max_results
            return ToolResult(success=True, output="ok")

        with patch.object(tool, "_search_with", side_effect=fake_search):
            result = await tool.execute("测试", max_results="7")

        assert result.success
        assert captured["max_results"] == 7

    @pytest.mark.asyncio
    async def test_all_providers_fail_returns_error(self, monkeypatch) -> None:
        monkeypatch.setenv("WEB_SEARCH_PROVIDERS", "bing")
        tool = WebSearchTool()
        with patch.object(
            tool,
            "_search_with",
            new=AsyncMock(
                return_value=ToolResult(success=False, output="", error="搜索超时")
            ),
        ):
            result = await tool.execute("测试")

        assert result.success is False
        assert "全部搜索源失败" in result.error

    @pytest.mark.asyncio
    async def test_first_provider_success_stops(self, monkeypatch) -> None:
        monkeypatch.setenv("WEB_SEARCH_PROVIDERS", "bing,cn_bing")
        tool = WebSearchTool()
        calls: list[str] = []

        async def fake_search(provider: str, query: str, max_results: int) -> ToolResult:
            calls.append(provider)
            return ToolResult(success=True, output="ok")

        with patch.object(tool, "_search_with", side_effect=fake_search):
            await tool.execute("测试")

        assert calls == ["bing"]  # 首个成功即停止，不再尝试 cn_bing
