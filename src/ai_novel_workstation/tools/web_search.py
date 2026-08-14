"""联网搜索工具。

支持多个搜索源，按优先级依次尝试（可用则用）：

免费源（无需 Key）：
- ddg:     通过 ddgs 库实现，指定 Bing 后端（backend="bing"，当前网络可达）
- baidu:   https://www.baidu.com/s （中文查询相关性最好，作为默认首选）
- bing:    https://www.bing.com/search
- cn_bing: https://cn.bing.com/search

API 源（需配置 Key，更稳定）：
- tavily:  https://api.tavily.com/search       需要环境变量 TAVILY_API_KEY
- serper:  https://google.serper.dev/search    需要环境变量 SERPER_API_KEY

优先级顺序通过环境变量 WEB_SEARCH_PROVIDERS 自定义（逗号分隔），默认：
    baidu,ddg,tavily,serper,bing,cn_bing
未配置 Key 的 API 源会被自动跳过。
"""

from __future__ import annotations

import asyncio
import json
import os
import re
from typing import Any

import httpx

from ai_novel_workstation.tools.base import BaseTool, ToolParameter, ToolResult

_DEFAULT_PROVIDERS = "baidu,ddg,tavily,serper,bing,cn_bing"
_TIMEOUT = 8.0

_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    ),
    "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
}


def _parse_tavily(data: dict) -> list[str]:
    out: list[str] = []
    for r in data.get("results", []):
        title = (r.get("title") or "").strip()
        if not title:
            continue
        url = r.get("url") or ""
        content = (r.get("content") or "").strip()
        line = f"{title} — {url}"
        if content:
            line += f" — {content[:300]}"
        out.append(line)
    return out


def _parse_serper(data: dict) -> list[str]:
    out: list[str] = []
    for r in data.get("organic", []):
        title = (r.get("title") or "").strip()
        if not title:
            continue
        url = r.get("link") or ""
        snippet = (r.get("snippet") or "").strip()
        line = f"{title} — {url}"
        if snippet:
            line += f" — {snippet}"
        out.append(line)
    return out


def _format_ddgs_item(r: dict) -> str:
    """格式化 ddgs 库返回的搜索结果条目。"""
    title = (r.get("title") or "").strip()
    href = (r.get("href") or "").strip()
    body = (r.get("body") or "").strip()

    if not title and not body:
        return ""

    line = title or "(无标题)"
    if href:
        line += f" — {href}"
    if body:
        line += f" — {body}"
    return line


# 搜索源定义
_SEARCH_PROVIDERS: dict[str, dict[str, Any]] = {
    "ddg": {
        "kind": "ddgs",  # 通过 duckduckgo-search 库实现
    },
    "tavily": {
        "kind": "json_post",
        "url": "https://api.tavily.com/search",
        "key_env": "TAVILY_API_KEY",
        "auth_header": False,
        "body": lambda key, query, max_results: {
            "api_key": key,
            "query": query,
            "max_results": max_results,
            "search_depth": "basic",
        },
        "parse": _parse_tavily,
    },
    "serper": {
        "kind": "json_post",
        "url": "https://google.serper.dev/search",
        "key_env": "SERPER_API_KEY",
        "auth_header": True,
        "body": lambda key, query, max_results: {"q": query, "num": max_results},
        "parse": _parse_serper,
    },
    "bing": {
        "kind": "form_get",
        "url": "https://www.bing.com/search",
        "param": "q",
    },
    "cn_bing": {
        "kind": "form_get",
        "url": "https://cn.bing.com/search",
        "param": "q",
    },
    "baidu": {
        "kind": "form_get",
        "url": "https://www.baidu.com/s",
        "param": "wd",
    },
}


class WebSearchTool(BaseTool):
    """联网搜索工具。"""

    @property
    def name(self) -> str:
        return "web_search"

    @property
    def description(self) -> str:
        return "联网搜索查询关键词，返回搜索结果摘要。用于查询网文市场趋势、热门题材、平台榜单等。"

    @property
    def parameters(self) -> list[ToolParameter]:
        return [
            ToolParameter(
                name="query",
                type="string",
                description="搜索关键词",
            ),
            ToolParameter(
                name="max_results",
                type="integer",
                description="最大返回结果数",
                required=False,
                default=5,
            ),
        ]

    async def execute(
        self,
        query: str,
        max_results: int | str = 5,
        **kwargs: Any,
    ) -> ToolResult:
        try:
            max_results = int(max_results)
        except (TypeError, ValueError):
            max_results = 5
        max_results = max(1, min(max_results, 10))

        providers = self._get_providers()
        errors: list[str] = []

        for provider in providers:
            try:
                result = await self._search_with(provider, query, max_results)
                if result.success:
                    return result
                errors.append(f"{provider}: {result.error}")
            except Exception as e:
                errors.append(f"{provider}: {type(e).__name__}: {e}")

        return ToolResult(
            success=False,
            output="",
            error=f"全部搜索源失败: {' | '.join(errors)}",
        )

    # ------------------------------------------------------------------
    # Provider 选择与执行
    # ------------------------------------------------------------------

    @staticmethod
    def _get_providers() -> list[str]:
        """按优先级返回可用的搜索源（未配置 Key 的 API 源自动跳过）。"""
        raw = os.getenv("WEB_SEARCH_PROVIDERS", _DEFAULT_PROVIDERS)
        providers = [p.strip() for p in raw.split(",") if p.strip()]

        result: list[str] = []
        for p in providers:
            spec = _SEARCH_PROVIDERS.get(p)
            if spec is None:
                continue
            key_env = spec.get("key_env")
            if key_env and not os.getenv(key_env, "").strip():
                continue  # API 源未配置 Key，跳过
            result.append(p)

        return result or ["bing"]

    async def _search_with(self, provider: str, query: str, max_results: int) -> ToolResult:
        """使用指定搜索源搜索。"""
        spec = _SEARCH_PROVIDERS[provider]
        kind = spec["kind"]

        if kind == "ddgs":
            return await self._ddgs_search(query, max_results)

        try:
            if kind == "json_post":
                return await self._json_post_search(spec, query, max_results)
            if kind == "form_get":
                async with httpx.AsyncClient(
                    timeout=_TIMEOUT, follow_redirects=True, headers=_HEADERS
                ) as client:
                    resp = await client.get(spec["url"], params={spec["param"]: query})
                    resp.raise_for_status()
                    if self._is_blocked_page(provider, resp.text):
                        return ToolResult(success=False, output="", error="搜索源被拦截（验证码/安全验证）")
                    results = self._parse_html(provider, resp.text, max_results)
            else:  # form_post
                async with httpx.AsyncClient(
                    timeout=_TIMEOUT, follow_redirects=True, headers=_HEADERS
                ) as client:
                    resp = await client.post(
                        spec["url"],
                        data={spec["param"]: query, "kl": "cn-zh"},
                    )
                    resp.raise_for_status()
                    results = self._parse_html(provider, resp.text, max_results)
        except httpx.TimeoutException:
            return ToolResult(success=False, output="", error="搜索超时")
        except httpx.HTTPStatusError as e:
            return ToolResult(success=False, output="", error=f"HTTP {e.response.status_code}")
        except Exception as e:
            return ToolResult(success=False, output="", error=f"请求失败: {e}")

        return self._build_result(query, provider, results)

    @staticmethod
    def _is_blocked_page(provider: str, html: str) -> bool:
        """判断搜索源是否返回了验证码/拦截页。"""
        if provider == "baidu":
            return any(
                k in html
                for k in ("百度安全验证", "wappass", "请开启JS", "访问过于频繁")
            )
        return False

    async def _ddgs_search(self, query: str, max_results: int) -> ToolResult:
        """使用 ddgs 库搜索（同步库，放入线程池避免阻塞事件循环）。

        指定 backend="bing"：DuckDuckGo 后端在当前网络不可达，
        而 ddgs 内置的 Bing 引擎可用。
        """

        def _run() -> list[dict]:
            from ddgs import DDGS

            items = DDGS(timeout=_TIMEOUT).text(
                query=query,
                region="cn-zh",
                safesearch="moderate",
                backend="bing",
                max_results=max_results,
            )
            return list(items or [])

        try:
            items = await asyncio.to_thread(_run)
        except Exception as e:
            return ToolResult(success=False, output="", error=f"请求失败: {e}")

        results = [s for s in (_format_ddgs_item(r) for r in items) if s]
        return self._build_result(query, "ddg", results)

    async def _json_post_search(
        self, spec: dict[str, Any], query: str, max_results: int
    ) -> ToolResult:
        """调用 JSON 形式的搜索 API（Tavily / Serper）。"""
        key = os.getenv(spec["key_env"], "").strip()
        if not key:
            return ToolResult(success=False, output="", error=f"未配置 {spec['key_env']}")

        headers = dict(_HEADERS)
        if spec.get("auth_header"):
            headers["X-API-KEY"] = key
        payload = spec["body"](key, query, max_results)

        try:
            async with httpx.AsyncClient(timeout=_TIMEOUT, headers=headers) as client:
                resp = await client.post(spec["url"], json=payload)
                resp.raise_for_status()
                data = resp.json()
        except httpx.TimeoutException:
            return ToolResult(success=False, output="", error="搜索超时")
        except httpx.HTTPStatusError as e:
            return ToolResult(success=False, output="", error=f"HTTP {e.response.status_code}")
        except ValueError:
            return ToolResult(success=False, output="", error="响应不是有效 JSON")
        except Exception as e:
            return ToolResult(success=False, output="", error=f"请求失败: {e}")

        results = spec["parse"](data)
        return self._build_result(query, "api", results)

    @staticmethod
    def _build_result(query: str, provider: str, results: list[str]) -> ToolResult:
        if not results:
            return ToolResult(success=True, output=f"搜索 '{query}' 未找到结果。")

        output_lines = [f"搜索 '{query}' 的结果（来源: {provider}）：\n"]
        for i, r in enumerate(results, 1):
            output_lines.append(f"{i}. {r}")

        return ToolResult(success=True, output="\n".join(output_lines))

    # ------------------------------------------------------------------
    # HTML 解析（免费抓取源：bing / cn_bing）
    # ------------------------------------------------------------------

    @staticmethod
    def _parse_html(provider: str, html: str, max_results: int) -> list[str]:
        if provider == "baidu":
            return WebSearchTool._parse_baidu_html(html, max_results)
        return WebSearchTool._parse_bing_html(html, max_results)

    @staticmethod
    def _parse_baidu_html(html: str, max_results: int) -> list[str]:
        """解析百度搜索结果页（cosc-title 标题块 + s-data 摘要）。"""
        results: list[str] = []
        title_blocks = re.split(r'<h3[^>]*class="[^"]*cosc-title[^"]*"[^>]*>', html)

        for block in title_blocks[1 : max_results + 1]:
            a = re.search(r'<a[^>]*href="([^"]+)"[^>]*>(.*?)</a>', block, re.DOTALL)
            if not a:
                continue
            url = a.group(1)
            title = re.sub(r"<[^>]+>", "", a.group(2)).strip()
            if not title:
                continue

            snippet = WebSearchTool._extract_baidu_summary(block)
            line = f"{title} — {url}"
            if snippet:
                line += f" — {snippet}"
            results.append(line)

        return results

    @staticmethod
    def _extract_baidu_summary(block: str) -> str:
        """从百度结果块中提取摘要（位于 <!--s-data:{...}--> 注释的 JSON 中）。"""
        idx = block.find('"summaryData"')
        if idx < 0:
            return ""
        start = block.rfind("s-data:", 0, idx)
        end = block.find("-->", idx)
        if start < 0 or end < 0:
            return ""
        raw = block[start + len("s-data:"):end]
        try:
            data = json.loads(raw)
        except json.JSONDecodeError:
            return ""

        texts: list[str] = []

        def _walk(obj) -> None:
            if isinstance(obj, dict):
                for k, v in obj.items():
                    if k == "text" and isinstance(v, str):
                        texts.append(v)
                    else:
                        _walk(v)
            elif isinstance(obj, list):
                for v in obj:
                    _walk(v)

        _walk(data)
        snippet = re.sub(r"<[^>]+>", "", " ".join(texts)).strip()
        return snippet[:300]

    @staticmethod
    def _parse_bing_html(html: str, max_results: int) -> list[str]:
        """解析 Bing 搜索结果页（<li class="b_algo"> 结构）。"""
        results: list[str] = []
        li_pattern = re.compile(r'<li class="b_algo".*?</li>', re.DOTALL)

        for li in li_pattern.findall(html)[:max_results]:
            title_m = re.search(
                r'<h2[^>]*>\s*<a[^>]*href="([^"]+)"[^>]*>(.*?)</a>', li, re.DOTALL
            )
            if not title_m:
                continue
            url = title_m.group(1)
            title = re.sub(r"<[^>]+>", "", title_m.group(2)).strip()
            if not title:
                continue

            snippet = ""
            snippet_m = re.search(r"<p[^>]*>(.*?)</p>", li, re.DOTALL)
            if snippet_m:
                snippet = re.sub(r"<[^>]+>", "", snippet_m.group(1)).strip()

            line = f"{title} — {url}"
            if snippet:
                line += f" — {snippet}"
            results.append(line)

        return results
