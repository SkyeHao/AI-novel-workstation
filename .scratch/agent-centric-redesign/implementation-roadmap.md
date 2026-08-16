# 实现路线图：Agent 中心化重构

> 状态：规划完成（10 张决策票闭合，ADR-0005 已记录）。本文档把决策拆成可执行批次。
> 依赖决策：`.scratch/agent-centric-redesign/decisions-summary.md` · ADR `docs/adr/0005-agent-centric-redesign.md`

## 批次 1 —— 后端地基（存储 + 上下文编排）

- [ ] T1 状态落地：`Project.status` 枚举改写为新状态集；状态节点对象模型（`{key,label,panel,context_assembly_ref,enabled}`）；单锚点 + 工作单元集合；`prereq-check` 对齐新状态
- [ ] T5 `storage/memory_store.py`：四类记忆读写（facts/foreshadow jsonl、characters/summaries json）、state/source 标签、路径沙箱校验；目录对齐 `memory/`
- [ ] T6 `MemoryRetriever` 接口 + keyword 实现（规则召回：人物名/伏笔关键词/章号/状态标签）+ `MEMORY_RETRIEVAL_MODE` 配置
- [ ] T7 `ContextOrchestrator`：`PromptAssembler` + `MemoryRetriever` + `TokenCompressor`，取代 `ContextManager`（滑动窗口/预算/摘要语义迁移 + 摘要联动分层摘要）
- [ ] 测试：memory_store / MemoryRetriever / ContextOrchestrator 新测试；旧 context 测试迁移

## 批次 2 —— Agent 工作流与工具面

- [ ] T10 创意孵化从零写：基于核心要素 JSON（保留）+ 通用 SSE/ask_user 机制；废弃 stage1_session/stage1_ideation 独立会话语义
- [ ] T2 状态组装规则：每个状态的 `context_assembly_ref` 实现（读哪些数据 + 顺序 + 重点块）；前置不完备软提示 + 硬拦截开关
- [ ] T4 工具面：`read_current_state` / `list_states` / `switch_state` / `memory_search`；Agent 感知单锚点状态并按状态组装
- [ ] 测试：创意孵化工作流 / 状态感知工具 / 组装规则

## 批次 3 —— 前端重构（Agent 独立页 + 内容面板）

- [ ] T3/T8 AgentWindow 组件（独立一等页面）：SSE 流式 + 升级 ask_user 结构化卡片 + 单对话线状态自动感知
- [ ] T8 状态内容面板：工作台（保留）/设定（世界观/人物/章纲面板）/正文/审阅/伏笔管理/用户设置
- [ ] T8 删旧视图：IdeationView/SettingsView/WritingView/ReadingView/ReviewView/ChatView 移除，路由重排
- [ ] 前端联调：面板点选/字段编辑 → Agent 对话确认 → 记忆/设定落盘

## 批次 4 —— 正文/审阅收尾 + 全量验证

- [ ] T9 正文工作流：前置检测 → 组装上下文 → 写章落盘（chapters/{no}.md + facts/伏笔更新）→ L1 摘要沉淀
- [ ] T9 选段修改：选段 → Agent 改写 → 原文/改写对比 → ask_user 确认应用；章节回 GENERATED
- [ ] T9 审阅工作流：审阅报告（结构/节奏/逻辑/代入感 + 去AI味建议）→ 对比应用/放弃 → REVIEWED + review 记录
- [ ] T9 章状态机联动：PENDING→GENERATED→REVIEWED/FINALIZED，修改回 GENERATED，落盘触发记忆更新
- [ ] T10-Q5 测试收尾：分类迁移 + 新测试补齐（编排器/记忆/前端 API）；全量 `pytest` 回归

## 依赖关系（批次间）

批次 1 → 2（编排器/记忆是 Agent 工作流的基础）→ 3（前端消费新 API/状态）→ 4（正文/审阅用上整条链路）。
批次 1 内建议顺序：T1/T5 存储 → T6 检索 → T7 编排器。

## 演进项（Not-yet，实现后细化）

- 召回质量底线与评测；前置拦截严格度调参；多状态并发表现；向量库可选项（MEMORY_RETRIEVAL_MODE=vector）。
