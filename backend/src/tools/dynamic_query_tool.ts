/** 动态设定查询工具（query_dynamic）。
 * 按账本粒度查询指定动态设定内容（非全量获取），供 Agent 在需要时主动获取某个设定/某个内容。
 * 权限按当前节点受控（NODE_DYNAMIC_READABLE），避免上下文溢出。 */
import { AbstractTool, ToolResult } from "./base.js";
import { DynamicSettingsStore, ALL_ACCOUNTS, ACCOUNT_METAS, type AccountType } from "../storage/dynamic_settings.js";

export interface DynamicQueryContext {
  projectId: string;
  dynamicStore: DynamicSettingsStore;
  getCurrentState(): string;
}

/** 节点 x 动态账本可读矩阵 */
export const NODE_DYNAMIC_READABLE: Record<string, AccountType[]> = {
  ideation: ["chapter_summaries", "hooks"],
  worldview: ["chapter_summaries", "hooks"],
  characters: ["chapter_summaries", "hooks"],
  outline: ["chapter_summaries", "hooks"],
  writing: [...ALL_ACCOUNTS],
  review: [...ALL_ACCOUNTS],
  style: ["characters", "locations", "items", "events", "chapter_summaries", "hooks"],
};

interface FilterOptions {
  name: string;
  chapter: number | null;
  status: string;
  field: string;
  limit: number;
}

export class QueryDynamicTool extends AbstractTool {
  constructor(private ctx: DynamicQueryContext) {
    super();
  }

  readonly name = "query_dynamic";
  readonly description =
    "查询本书动态设定账本中指定的内容（人物状态/地点状态/物品/事件流/时间线/伏笔/信息视角/章节摘要与钩子/章尾钩子）。" +
    "指定 account（账本）并按需用 name/chapter/status/perspective 缩小范围，返回该账本的部分内容而非全量。" +
    "例如：查询主角人物状态 query_dynamic(account=characters, name=林逸)；查询上一章钩子 query_dynamic(account=chapter_summaries, chapter=上一章号)。";
  readonly parameters = [
    { name: "account", type: "string", description: "账本类型：characters/locations/items/events/timeline/foreshadow/info_perspective/chapter_summaries/hooks", required: true, default: null },
    { name: "name", type: "string", description: "实体名或关键词（characters/locations/items 按名称；events/timeline 按事件内容；info_perspective 按事实内容）", required: false, default: "" },
    { name: "field", type: "string", description: "只返回指定字段（如 status/level/owner/hook），缺省返回全部字段", required: false, default: "" },
    { name: "chapter", type: "integer", description: "按章节过滤（events/chapter_summaries/hooks/foreshadow.planted_chapter）", required: false, default: null },
    { name: "status", type: "string", description: "按状态过滤（foreshadow：埋设/悬置/消费/超期；hooks：open/reaped；items：丢失/损坏等）", required: false, default: "" },
    { name: "perspective", type: "string", description: "info_perspective 专用：truth=世界真相 / display=读者已知", required: false, default: "" },
    { name: "limit", type: "integer", description: "返回条数上限（默认 10，最大 50）", required: false, default: 10 },
  ];

  async execute(kwargs: Record<string, unknown>): Promise<ToolResult> {
    const account = String(kwargs.account ?? "").trim() as AccountType;
    if (!account || !ALL_ACCOUNTS.includes(account)) {
      return new ToolResult(false, "", "account 必填且必须是合法账本：" + ALL_ACCOUNTS.join("/"));
    }
    const node = this.ctx.getCurrentState();
    const readable = NODE_DYNAMIC_READABLE[node] ?? [];
    if (!readable.includes(account)) {
      return new ToolResult(
        false,
        "",
        `当前节点（${node}）不可读账本 ${account}${readable.length ? "，可读：" + readable.join("/") : ""}`
      );
    }

    const name = String(kwargs.name ?? "").trim();
    const field = String(kwargs.field ?? "").trim();
    const chapterRaw = kwargs.chapter;
    const chapter =
      chapterRaw === null || chapterRaw === undefined || chapterRaw === ""
        ? null
        : Number(chapterRaw);
    const status = String(kwargs.status ?? "").trim();
    const perspective = String(kwargs.perspective ?? "").trim();
    const limit = Math.min(Math.max(Number(kwargs.limit ?? 10) || 10, 1), 50);

    const data = this.ctx.dynamicStore.load(this.ctx.projectId, account);
    if (!data) return new ToolResult(true, `（账本 ${account} 暂无数据，尚未回写）`);

    const filterOpts: FilterOptions = { name, chapter, status, field, limit };

    // 双栏账本（info_perspective）：truth/display 各为一个列表
    if (account === "info_perspective") {
      const side = perspective === "display" ? "display" : "truth";
      const list = Array.isArray(data[side]) ? (data[side] as Array<Record<string, unknown>>) : [];
      const hits = this._filterList(list, filterOpts);
      return new ToolResult(true, this._formatInfoPerspective(side, hits));
    }

    const entries = Array.isArray(data.entries) ? (data.entries as Array<Record<string, unknown>>) : [];
    const hits = this._filterList(entries, filterOpts);
    return new ToolResult(true, this._formatEntries(account, hits));
  }

  private _filterList(list: Array<Record<string, unknown>>, opts: FilterOptions): Array<Record<string, unknown>> {
    let out = list;
    if (opts.name) {
      const kw = opts.name.trim();
      out = out.filter((e) => {
        const hay = String(e.name ?? e.owner ?? e.description ?? e.event ?? e.fact ?? e.time ?? e.content ?? "");
        return hay.includes(kw);
      });
    }
    if (opts.chapter !== null) {
      out = out.filter((e) => {
        const c = Number(e.chapter ?? e.planted_chapter);
        return Number.isFinite(c) ? c === opts.chapter : true;
      });
    }
    if (opts.status) {
      out = out.filter((e) => String(e.status ?? "") === opts.status);
    }
    if (opts.field) {
      out = out.map((e) => ({ [opts.field as string]: e[opts.field as string] }));
    }
    out = [...out].sort((a, b) => {
      const ca = Number(a.chapter ?? a.planted_chapter);
      const cb = Number(b.chapter ?? b.planted_chapter);
      if (Number.isFinite(ca) && Number.isFinite(cb)) return ca - cb;
      return 0;
    });
    return out.slice(0, opts.limit);
  }

  private _formatEntries(account: AccountType, hits: Array<Record<string, unknown>>): string {
    if (hits.length === 0) return `（账本 ${account} 无匹配记录）`;
    const meta = ACCOUNT_METAS[account];
    const lines = hits.map((e, i) => {
      const parts: string[] = [];
      for (const f of meta.fields) {
        const v = e[f.key];
        if (v === undefined || v === null || v === "") continue;
        parts.push(`${f.label}: ${Array.isArray(v) ? v.join("、") : String(v)}`);
      }
      for (const [k, v] of Object.entries(e)) {
        if (meta.fields.some((f) => f.key === k)) continue;
        if (v === undefined || v === null || v === "") continue;
        parts.push(`${k}: ${String(v)}`);
      }
      return `${i + 1}. ${parts.join("；")}`;
    });
    return `${meta.label}（${hits.length} 条）：
${lines.join("\n")}`;
  }

  private _formatInfoPerspective(side: string, hits: Array<Record<string, unknown>>): string {
    const label = side === "truth" ? "世界真相" : "读者已知";
    if (hits.length === 0) return `（信息视角-${label} 无匹配记录）`;
    const lines = hits.map((e, i) => `${i + 1}. ${String(e.fact ?? "")}`);
    return `信息视角-${label}（${hits.length} 条）：
${lines.join("\n")}`;
  }
}

