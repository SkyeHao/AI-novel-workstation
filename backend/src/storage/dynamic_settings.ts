/** 动态设定账本存储（工单 02：动态设定账本层）。
 * 9 类账本：人物动态状态 / 地点势力状态 / 物品状态 / 事件流 / 故事时间线 / 伏笔台账 / 信息与视角状态 / 章节摘要链 / 章尾钩子。
 * 动态设定由正文生成章末自动回写，界面只读。 */
import * as fs from "node:fs";
import * as path from "node:path";
import type { ProjectStore } from "./project_store.js";

export type AccountType =
  | "characters"
  | "locations"
  | "items"
  | "events"
  | "timeline"
  | "foreshadow"
  | "info_perspective"
  | "chapter_summaries"
  | "hooks";

export const ALL_ACCOUNTS: AccountType[] = [
  "characters",
  "locations",
  "items",
  "events",
  "timeline",
  "foreshadow",
  "info_perspective",
  "chapter_summaries",
  "hooks",
];

export interface DynamicAccount {
  entries?: Array<Record<string, unknown>>;
  truth?: Array<Record<string, unknown>>;
  display?: Array<Record<string, unknown>>;
  meta?: { last_chapter?: number; updated_at?: string };
  [key: string]: unknown;
}


/** 账本语义分类：entity=实体账本，flow=流式账本，ledger=台账，dual=双栏对照。 */
export type AccountKind = "entity" | "flow" | "ledger" | "dual";

export interface AccountField {
  key: string;
  label: string;
}

export interface AccountMeta {
  label: string;
  kind: AccountKind;
  description: string;
  fields: AccountField[];
}

export const ACCOUNT_METAS: Record<AccountType, AccountMeta> = {
  characters: {
    label: "人物状态",
    kind: "entity",
    description: "随章节演进的人物动态状态，字段随题材模板变化（都市：身份/职业/处境；玄幻：境界/战力/伤势…），Agent 可自由扩展",
    fields: [
      { key: "name", label: "名称" },
      { key: "status", label: "状态" },
    ],
  },
  locations: {
    label: "地点势力",
    kind: "entity",
    description: "地点与势力的当前状态",
    fields: [
      { key: "name", label: "名称" },
      { key: "status", label: "状态" },
    ],
  },
  items: {
    label: "物品",
    kind: "entity",
    description: "物品状态与当前持有者",
    fields: [
      { key: "name", label: "名称" },
      { key: "owner", label: "持有者" },
      { key: "status", label: "状态" },
    ],
  },
  events: {
    label: "事件流",
    kind: "flow",
    description: "按章节记录的故事事件",
    fields: [
      { key: "chapter", label: "章节" },
      { key: "description", label: "事件" },
    ],
  },
  timeline: {
    label: "时间线",
    kind: "flow",
    description: "按故事时间推进的事件时间线",
    fields: [
      { key: "time", label: "时间" },
      { key: "event", label: "事件" },
    ],
  },
  foreshadow: {
    label: "伏笔台账",
    kind: "ledger",
    description: "伏笔埋设/悬置/消费/超期状态看板",
    fields: [
      { key: "planted_chapter", label: "埋设章" },
      { key: "expected_chapter", label: "期望回收章" },
      { key: "status", label: "状态" },
      { key: "description", label: "伏笔内容" },
    ],
  },
  info_perspective: {
    label: "信息视角",
    kind: "dual",
    description: "世界真相 vs 读者已知的信息差对照",
    fields: [
      { key: "fact", label: "事实" },
    ],
  },
  chapter_summaries: {
    label: "章节摘要",
    kind: "flow",
    description: "每章摘要与章尾钩子",
    fields: [
      { key: "chapter", label: "章节" },
      { key: "summary", label: "摘要" },
      { key: "hook", label: "章尾钩子" },
    ],
  },
  hooks: {
    label: "章尾钩子",
    kind: "ledger",
    description: "每章章尾钩子独立账本，含待衔接/已衔接生命周期",
    fields: [
      { key: "chapter", label: "章节" },
      { key: "type", label: "类型" },
      { key: "content", label: "钩子内容" },
      { key: "status", label: "状态" },
      { key: "reaped_chapter", label: "衔接章" },
    ],
  },
};

/** 获取账本元数据。 */
export function accountMeta(account: AccountType): AccountMeta {
  return ACCOUNT_METAS[account];
}

/** 账本条目计数（entries/truth/display 优先级）。 */
export function accountCount(data: DynamicAccount | null): number {
  if (!data) return 0;
  if (Array.isArray(data.entries)) return data.entries.length;
  if (Array.isArray(data.truth)) return data.truth.length;
  if (Array.isArray(data.display)) return data.display.length;
  return 0;
}
export class DynamicSettingsStore {
  private _projectStore: ProjectStore;

  constructor(projectStore: ProjectStore) {
    this._projectStore = projectStore;
  }

  /** 获取账本目录路径 */
  private _accountDir(projectId: string): string {
    const projectRoot = this._projectStore.project_root(projectId);
    return path.join(projectRoot, "dynamic_settings");
  }

  /** 获取账本文件路径 */
  private _accountPath(projectId: string, account: AccountType): string {
    return path.join(this._accountDir(projectId), account + ".json");
  }

  /** 加载账本数据 */
  load(projectId: string, account: AccountType): DynamicAccount | null {
    if (!ALL_ACCOUNTS.includes(account)) {
      return null;
    }
    const filePath = this._accountPath(projectId, account);
    if (!fs.existsSync(filePath)) {
      return null;
    }
    try {
      const content = fs.readFileSync(filePath, "utf-8");
      return JSON.parse(content) as DynamicAccount;
    } catch {
      return null;
    }
  }

  /** 更新账本数据 */
  update(projectId: string, account: AccountType, data: DynamicAccount): void {
    if (!ALL_ACCOUNTS.includes(account)) {
      throw new Error("未知账本类型: " + account);
    }
    const dir = this._accountDir(projectId);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    const filePath = this._accountPath(projectId, account);
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf-8");
  }

  /** 列出所有账本类型 */
  listAccounts(projectId: string): AccountType[] {
    return [...ALL_ACCOUNTS];
  }

  /** 检查账本是否存在 */
  exists(projectId: string, account: AccountType): boolean {
    if (!ALL_ACCOUNTS.includes(account)) {
      return false;
    }
    const filePath = this._accountPath(projectId, account);
    return fs.existsSync(filePath);
  }

  /** 删除账本 */
  delete(projectId: string, account: AccountType): void {
    if (!ALL_ACCOUNTS.includes(account)) {
      return;
    }
    const filePath = this._accountPath(projectId, account);
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  }
}
