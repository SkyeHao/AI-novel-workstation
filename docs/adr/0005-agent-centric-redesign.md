# 0005：Agent 中心化重构 —— 状态机 + 单书记忆 RAG + 上下文编排器

将产品从「多页面管线」重构为「以统一 Agent 窗口为中枢的单书创作平台」（决策票见 `.scratch/agent-centric-redesign/`，全部 10 票闭合）。

## 决策

- **两级状态机（T1）**：小说级状态 = 状态节点对象 `{key,label,panel,context_assembly_ref,enabled}`，自由导航、单锚点；工作单元（章节等）独立进度状态。默认 7 状态：创意孵化/世界观/人物/章纲/正文/审阅/伏笔管理（横切可选）。直接改写 `Project.status` 枚举。
- **记忆存储（T5）**：单书记忆四类——正典事实 `facts.jsonl`（原子+append-only）、人物关系 `characters.json`、伏笔台账 `foreshadow.jsonl`、分层摘要 `summaries/L1..L5`；每记录带 state/source 标签；摘要由状态机全自动触发。
- **RAG 取舍（T6）**：不推翻 ADR-0001「不上向量库」；轻量三管召回（规则关键词 + Agent 主动工具读 + 分层摘要兜底）；预留 `MemoryRetriever` 接口，`MEMORY_RETRIEVAL_MODE=keyword|vector`，向量库为 Not-yet 可选项。
- **上下文编排器（T7）**：`ContextOrchestrator` 取代 `ContextManager`（旧类废弃）；三个协作对象 `PromptAssembler`/`MemoryRetriever`/`TokenCompressor`；状态驱动块序；摘要与分层摘要联动。
- **Agent 窗口与前端（T3/T8）**：Agent 为独立一等页面，其余内容页（工作台/设定/正文/审阅/用户设置）独立存在并按状态映射；全新建前端视图，旧业务视图删除；通用 SSE + ask_user 机制保留为 Agent 窗口交互基础。
- **既有处置（T10）**：废弃 stage1 独立会话语义（创意孵化从零写），保留 `core_elements.py` 核心要素 JSON（ADR-0003）与 SSE/ask_user 机制；存储/工具/LLM 层保留；测试分类迁移。

## 原因

用户的真实预期是 Agent 专用产品：Agent 读取小说当前状态、按状态组织记忆与上下文、在任意步骤与作者协作；旧「每页一个对话」与线性管线不符合该预期。本地单机、低依赖定位要求记忆/检索走轻量实现而非向量库。

## 后果

- 本 ADR 修订 ADR-0001 的「保留已验证底座」范围：上下文管理（ContextManager）不再属于保留底座，归入被重写的记忆/上下文层。
- 修订 ADR-0002 的产品页形态：六页产品让位于「Agent 独立页 + 内容页」。
- 重构接续里程碑路线图（见 `.scratch/agent-centric-redesign/decisions-summary.md` 与实现路线图）。
