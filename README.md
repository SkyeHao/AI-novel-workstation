# AI 小说工作站

工程化 AI 辅助长篇网络小说创作系统（20 万~500 万字量级）。基于 **Agent 中心化重构**（ADR-0005）与 **全栈 TypeScript 迁移**（ADR-0006）。

> 📌 术语见 [CONTEXT.md](./CONTEXT.md)，决策记录见 [docs/adr/](./docs/adr/)，迁移计划见 [docs/迁移计划-全栈TS.md](./docs/迁移计划-全栈TS.md)，实现路线图见 [.scratch/agent-centric-redesign/](./.scratch/agent-centric-redesign/)，桌面调试见 [docs/desktop调试手册.md](./docs/desktop调试手册.md)。

## 架构总览

```
frontend/            Vue3 + TS 前端（Vite / Element Plus）
backend/             Fastify 5 + TS 后端（node: ESM，strict）
└── src/
    ├── config/      路径与全局配置（用户配置目录 .env）
    ├── llm/         多模型客户端（OpenAI 协议兼容，按小说状态取模型 + 降级链）
    ├── storage/     项目 / 设定 / 记忆 / 检索 / 交互记录（文件系统 + JSONL）
    ├── tools/       工具面：file_read / file_write / web_search / ask_user
    │                以及 T4 新增：read_current_state / list_states / switch_state / memory_search
    ├── agent/       ReAct Agent（native / jsonfc / dsml / auto 四种工具调用模式）
    │                ContextOrchestrator（T7）：系统提示 / 记忆召回 / 拼接 / token 压缩
    ├── workflow/    创意孵化（IDEATION_SYSTEM_PROMPT+核心要素）、设定生成、正文四步、审阅五步
    └── api/         Fastify 路由：projects / config / chat / workflow / files / interactions / agent
```

## T1–T10 落地情况

| 主题 | 实现 |
| --- | --- |
| T1 状态机 | 7 个状态节点（创意孵化/世界观/人物/章纲/正文/审阅 + 横切伏笔管理），自由导航、单锚点 `current_state`、两级状态（小说级 + 工作单元 `work_unit`）、每书可扩展启用集 |
| T2 状态组装 | 每状态 `context_assembly_ref`；前置不完备=软提示 + 硬拦截开关 |
| T3 Agent 窗口 | 独立一等页面（`/projects/:id/agent`），主导航对话 + 状态面板；ask_user 升级为结构化选择卡片；单持续对话线（按书持久化 `memory/agent_chat.jsonl`），切状态由编排器重组 |
| T4 工具面 | 新增 `read_current_state` / `list_states` / `switch_state` / `memory_search` |
| T5 记忆 | `facts.jsonl`（append-only + supersedes）/ `characters.json` / `foreshadow.jsonl`（埋/收/兑现）/ `summaries/L1..L5.json`，条目标 `state`/`source`，摘要全自动驱动 |
| T6 轻量 RAG | 不上向量库（ADR-0001）；规则关键词召回 + Agent 主动工具读取 + 分层摘要兜底（`MEMORY_RETRIEVAL_MODE=keyword|vector`） |
| T7 编排器 | `ContextOrchestrator` 取代旧 ContextManager；`PromptAssembler` + `MemoryRetriever` + `TokenCompressor`（token 预算 / 裁剪 / 滑动窗口 / LLM 摘要压缩，联动 L2~L5） |
| T8 前端 | Agent 独立页面 + 内容页独立存在（世界观/人物/章纲/正文/审阅/伏笔/工作台/设置），删旧视图 |
| T9 正文/审阅 | 正文四步（前置检测→组装上下文→写章落盘→L1 摘要）；选段修改（原文/改写对比）；审阅五步（报告→去AI味建议→对比应用→REVIEWED）；章状态机 PENDING→GENERATED→REVIEWED |
| T10 处置 | 删除 stage1 独立会话；创意孵化并入 Agent 窗口（保留核心要素 JSON + SSE/ask_user 机制）；移除 Python 代码库 |

## 快速开始

### 1. 安装依赖

```bash
cd backend && npm install
cd ../frontend && npm install
```

### 2. 配置 LLM

两种方式任选其一：

- **前端模型池**：启动后访问 `/config`（用户设置），添加模型并按小说状态（创意孵化/世界观/人物/章纲/正文/审阅/伏笔管理）分配；
- **环境变量**：编辑 `%APPDATA%\AI-Novel-Workstation\.env`（或仓库根 `.env`，首次运行自动迁移），填入：

```
LLM_TEXT_API_KEY=sk-xxx
LLM_TEXT_BASE_URL=https://api.openai.com/v1
LLM_TEXT_MODEL=gpt-4o
```

### 3. 启动

```bash
# 后端（开发，热重载）
cd backend && npm run dev            # http://127.0.0.1:8000

# 后端（生产）
cd backend && npm run build && npm start

# 前端
cd frontend && npm run dev           # http://localhost:5173
```

> 后端产物默认路径 `data/`（app-state.json / interactions.jsonl），小说项目数据默认 `data/projects/`，可在「用户设置 → 项目目录」修改。

### 4. 测试与类型检查

```bash
cd backend && npm test               # vitest（22 项核心行为测试）
cd backend && npx tsc -p tsconfig.json
cd frontend && npm run build         # vue-tsc + vite build
```

## 主要流程

1. **创意孵化**（Agent 窗口）：与 Agent 共创确认核心要素 → 写入 `核心要素.json` → 生成《故事愿景文档》。
2. **设定生成**：世界观 / 人物卡片 / 章纲 / 风格，可一键「基于核心要素生成」（structure 模型）。
3. **正文创作**：章纲就绪后，在「正文」页写章（writing 模型），自动产出 L1 摘要并登记正典事实。
4. **审阅与去 AI 味**：审阅报告 → 结构化建议 → 逐条对比应用 → 标记 REVIEWED（check 模型）。
5. **伏笔管理**：横切状态，台账驱动正文预注入。

## 工具调用模式

- `native`：OpenAI 原生 function calling；
- `jsonfc`（默认）：强制 JSON 协议 `{"thought","tool_call","done"}`，适合不支持原生 FC 的模型；
- `dsml`：DSML 文本标签格式；
- `auto`：优先原生，回退 DSML。

## 目录速查

- 决策地图与票：`.scratch/agent-centric-redesign/`
- 迁移任务票：`.scratch/ts-migration/issues/`
- 蓝图 / 技术设计：`docs/蓝图.md`、`docs/技术设计.md`
- 领域词汇：`CONTEXT.md`
