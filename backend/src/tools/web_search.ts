/** 联网搜索工具（TS 版，迁移自 tools/web_search.py）。
 * 免费抓取源：bing / cn_bing / baidu（原生 fetch，零 Key）；
 * API 源：tavily / serper（需配置 Key）。
 * 优先级通过 WEB_SEARCH_PROVIDERS 环境变量自定义，默认 baidu,ddg,tavily,serper,bing,cn_bing。 */
import { AbstractTool, ToolResult } from "./base.js";

const DEFAULT_PROVIDERS = "baidu,ddg,tavily,serper,bing,cn_bing";
const TIMEOUT_MS = 8000;

const HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
  "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
};

async function fetchWithTimeout(url: string, init: RequestInit = {}, timeoutMs = TIMEOUT_MS): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

function stripTags(html: string): string {
  return html.replace(/<script[\s\S]*?<\/script>/gi, "").replace(/<style[\s\S]*?<\/style>/gi, "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

function parseBingHtml(html: string, maxResults: number): string[] {
  const results: string[] = [];
  const items = html.match(/<li class="b_algo"[\s\S]*?<\/li>/g) ?? [];
  for (const li of items.slice(0, maxResults)) {
    const titleM = li.match(/<h2[^>]*>\s*<a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/);
    if (!titleM) continue;
    const url = titleM[1];
    const title = stripTags(titleM[2]);
    if (!title) continue;
    const snippetM = li.match(/<p[^>]*>([\s\S]*?)<\/p>/);
    const snippet = snippetM ? stripTags(snippetM[1]) : "";
    results.push(`${title} — ${url}${snippet ? " — " + snippet : ""}`);
  }
  return results;
}

function parseBaiduHtml(html: string, maxResults: number): string[] {
  const results: string[] = [];
  const blocks = html.split(/<h3[^>]*class="[^"]*cosc-title[^"]*"[^>]*>/);
  for (const block of blocks.slice(1, maxResults + 1)) {
    const a = block.match(/<a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/);
    if (!a) continue;
    const url = a[1];
    const title = stripTags(a[2]);
    if (!title) continue;
    const sIdx = block.indexOf('"summaryData"');
    let snippet = "";
    if (sIdx >= 0) {
      const start = block.lastIndexOf("s-data:", sIdx);
      const end = block.indexOf("-->", sIdx);
      if (start >= 0 && end > start) {
        try {
          const raw = block.slice(start + "s-data:".length, end);
          const data = JSON.parse(raw) as unknown;
          const texts: string[] = [];
          const walk = (obj: unknown): void => {
            if (obj && typeof obj === "object") {
              for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
                if (k === "text" && typeof v === "string") texts.push(v);
                else walk(v);
              }
            } else if (Array.isArray(obj)) {
              for (const v of obj) walk(v);
            }
          };
          walk(data);
          snippet = stripTags(texts.join(" ")).slice(0, 300);
        } catch {
          /* 忽略 */
        }
      }
    }
    results.push(`${title} — ${url}${snippet ? " — " + snippet : ""}`);
  }
  return results;
}

function buildResult(query: string, provider: string, results: string[]): ToolResult {
  if (results.length === 0) return new ToolResult(true, `搜索 '${query}' 未找到结果。`);
  const lines = [`搜索 '${query}' 的结果（来源: ${provider}）：`, ""];
  results.forEach((r, i) => lines.push(`${i + 1}. ${r}`));
  return new ToolResult(true, lines.join("\n"));
}

export class WebSearchTool extends AbstractTool {
  readonly name = "web_search";
  readonly description =
    "联网搜索市场趋势、题材热度、参考文献或资料。支持多搜索源自动降级（bing/baidu/tavily/serper）。";

  readonly parameters = [
    { name: "query", type: "string", description: "搜索关键词", required: true, default: null },
    { name: "max_results", type: "integer", description: "返回条数（默认 5）", required: false, default: 5 },
  ];

  async execute(kwargs: Record<string, unknown>): Promise<ToolResult> {
    const query = String(kwargs.query ?? "").trim();
    const maxResults = Number(kwargs.max_results ?? 5);
    if (!query) return new ToolResult(false, "", "query 不能为空");

    const providers = (process.env.WEB_SEARCH_PROVIDERS ?? DEFAULT_PROVIDERS)
      .split(",")
      .map((p) => p.trim())
      .filter((p) => p);

    for (const provider of providers) {
      try {
        if (provider === "bing" || provider === "cn_bing") {
          const url = provider === "cn_bing" ? "https://cn.bing.com/search" : "https://www.bing.com/search";
          const html = await (await fetchWithTimeout(`${url}?q=${encodeURIComponent(query)}`, { headers: HEADERS })).text();
          const results = parseBingHtml(html, maxResults);
          if (results.length > 0) return buildResult(query, provider, results);
        } else if (provider === "baidu") {
          const html = await (await fetchWithTimeout(`https://www.baidu.com/s?wd=${encodeURIComponent(query)}`, { headers: HEADERS })).text();
          const results = parseBaiduHtml(html, maxResults);
          if (results.length > 0) return buildResult(query, provider, results);
        } else if (provider === "tavily") {
          const key = process.env.TAVILY_API_KEY;
          if (!key) continue;
          const resp = await fetchWithTimeout(
            "https://api.tavily.com/search",
            { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ api_key: key, query, max_results: maxResults }) }
          );
          const data = (await resp.json()) as { results?: Array<{ title?: string; url?: string; content?: string }> };
          const results = (data.results ?? []).map((r) => `${r.title ?? ""} — ${r.url ?? ""}${r.content ? " — " + r.content.slice(0, 200) : ""}`);
          if (results.length > 0) return buildResult(query, provider, results);
        } else if (provider === "serper") {
          const key = process.env.SERPER_API_KEY;
          if (!key) continue;
          const resp = await fetchWithTimeout(
            "https://google.serper.dev/search",
            { method: "POST", headers: { "Content-Type": "application/json", "X-API-KEY": key }, body: JSON.stringify({ q: query, num: maxResults }) }
          );
          const data = (await resp.json()) as { organic?: Array<{ title?: string; link?: string; snippet?: string }> };
          const results = (data.organic ?? []).map((r) => `${r.title ?? ""} — ${r.link ?? ""}${r.snippet ? " — " + r.snippet : ""}`);
          if (results.length > 0) return buildResult(query, provider, results);
        }
      } catch (err) {
        console.warn(`[web_search] 源 ${provider} 失败: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    return new ToolResult(false, "", "所有搜索源均不可用");
  }
}
