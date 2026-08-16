# wayfinder:map — AI 小说工作站 Agent 中心化重构

## Destination

把 AI 小说工作站从「多页面管线产品」重构为「以统一 Agent 窗口为中枢的单书创作平台」：每本书有可扩展、两级、自由导航的创作状态机；一个通用 Agent 窗口驱动创作，按当前状态组装上下文并借助单书记忆 RAG 自主召回；保留 工作台/世界观/人物卡片/章纲/用户设置 等窗口作为状态的内容面板。在 Agent 中枢上重新实现正文/审阅（取代旧 M2/M3 stub）。

## Notes

- 领域：单书 AI 网文创作；Agent 中心 + 状态机 + 记忆 RAG。
- 技能：每次选票前 consult 此 map；决议时用 `/grilling`+`/domain-modeling`；涉及记忆/RAG 参照本仓库 ADR（0001 保留底座/0002 产品级 UI/0003 事实源/0004 done=阶段完成）。
- 关键词汇见 `CONTEXT.md`（本轮已新增：状态演进周期/两级状态/可扩展状态集/通用 Agent 窗口/状态上下文组装/单书记忆 RAG/统一 Agent 窗口+内容面板）。
- 本地 tracker：`.scratch/agent-centric-redesign/map.md` + `issues/NN-*.md`；blocker 用 `Blocked by: NN, NN` 行。

## Decisions so far

- [01-state-machine](.scratch/agent-centric-redesign/issues/01-state-machine.md) — 两层状态机契约：状态=节点对象（单锚点+工作单元集合），7 默认状态（创意孵化/世界观/人物/章纲/正文/审阅/伏笔管理），直接改写 Project.status。
- [02-state-context-assembly](.scratch/agent-centric-redesign/issues/02-state-context-assembly.md) — 状态组装规则：context_assembly_ref 声明读哪些数据+顺序+重点块；前置不完备软提示+硬拦截开关。
- [03-agent-window-experience](.scratch/agent-centric-redesign/issues/03-agent-window-experience.md) — 统一 Agent 窗口：主导航对话+内容区随状态切换；面板可点选/可编辑；升级 ask_user 卡片；单对话线状态自动感知。
- [04-tools-state-awareness](.scratch/agent-centric-redesign/issues/04-tools-state-awareness.md) — 工具面新增 read_current_state/list_states/switch_state/memory_search；Agent 感知单锚点状态。
- [05-memory-storage-model](.scratch/agent-centric-redesign/issues/05-memory-storage-model.md) — 单书记忆四类（facts jsonl/人物 json/伏笔 jsonl/分层摘要 L1-5），两级状态索引，摘要全自动，append-only 用 jsonl。
- [06-rag-retrieval-tradeoff](.scratch/agent-centric-redesign/issues/06-rag-retrieval-tradeoff.md) — 不推翻 ADR-0001：轻量三管召回（规则关键词+Agent工具+分层摘要），MemoryRetriever 接口预留，向量库 Not-yet。
- [07-context-orchestrator](.scratch/agent-centric-redesign/issues/07-context-orchestrator.md) — 重写上下文链路：ContextOrchestrator 取代 ContextManager，三协作对象，状态驱动块序，摘要联动分层摘要。
- [08-frontend-refactor-scope](.scratch/agent-centric-redesign/issues/08-frontend-refactor-scope.md) — 前端：Agent 独立一等页面（修订 T3 包裹形态）；旧页吸收为状态面板；全新建+删旧视图。
- [09-writing-review-on-agent](.scratch/agent-centric-redesign/issues/09-writing-review-on-agent.md) — 正文四步+选段修改、审阅五步+去AI味、ask_user 卡片确认；章状态机与 T5 记忆联动。
- [10-legacy-disposition](.scratch/agent-centric-redesign/issues/10-legacy-disposition.md) — 删 stage1（创意孵化从零写）；存储层保留对齐记忆；ContextManager→ContextOrchestrator；前端全新建、LLM 保留；测试分类迁移。规划完成。
## Not yet specified

- 记忆 RAG 的召回质量底线（何时"召回够用"）
- 状态启动时"前置不完备"拦到多严（软提示 vs 硬拦截）
- Agent 窗口在多状态并发时的表现（一次只能在一个状态吗）
- 状态集预置的粒度细节
- 上下文组装与旧 ContextManager 的融合/替换边界

## Out of scope

- 跨书公共知识库（Q12-B：单书记忆优先，跨书为副）
- 重型基建（Qdrant/Neo4j/LangGraph/批量并行写作）——除非决策票 T6 明确推翻



