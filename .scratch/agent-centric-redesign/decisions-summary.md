# 决议汇总：AI 小说工作站 Agent 中心化重构

> 状态：规划完成（wayfinder 地图建立，10 张决策票全部闭合）
> 位置：`.scratch/agent-centric-redesign/`；本文档是已决议决策的速览，详情见各票 Answer。

## 目的地（Destination）

把「多页面管线产品」重构为「以统一 Agent 窗口为中枢的单书创作平台」：每本书有可扩展、两级、自由导航的创作状态机；一个通用 Agent 窗口驱动创作，按当前状态组装上下文并借助单书记忆 RAG 自主召回；保留 工作台/世界观/人物卡片/章纲/用户设置 等窗口作为状态的内容面板。

## 已决议（4 条，按顺序）

### T1 · 状态机（grilling）
- 小说级状态 = **状态节点对象** `{key,label,panel,context_assembly_ref,enabled}`；自由导航、单锚点 `current_state`。
- 两级状态：小说级锚点 + 工作单元集合（章节 PENDING→GENERATED→FINALIZED→REVIEWED）。
- **默认状态集 7 个**：创意孵化 / 世界观 / 人物 / 章纲 / 正文 / 审阅 / 伏笔管理（横切可选）。
- **直接改写 Project.status 枚举**（Q4-A）：创意孵化←ideation，世界观+人物+章纲←setting，正文/审阅←writing/reviewing。

### T5 · 单书记忆存储（prototype）
- 记忆四类：正典事实(memory/facts.jsonl 原子+append-only) / 人物关系快照(characters.json) / 伏笔台账(foreshadow.jsonl) / 分层摘要(summaries/L1..L5.json)。
- 两级状态索引：每记录带 state(小说级) + source(工作单元) 标签；按类型分文件。
- 摘要全自动驱动（状态机落盘后触发）；append-only 用 jsonl、快照用 json。

### T6 · RAG 取舍（research）
- 不推翻 ADR-0001，不上向量库；轻量召回三管并用：规则关键词 + Agent 主动工具读 + 分层摘要兜底。
- 预留 MemoryRetriever 接口，MEMORY_RETRIEVAL_MODE=keyword|vector，向量库为 Not-yet 可选项。

### T7 · 上下文编排器（task）
- 重写上下文链路：ContextOrchestrator 取代 ContextManager（旧类废弃，Q5=A）。
- 三个协作对象：PromptAssembler（状态规则拼块）+ MemoryRetriever（轻量 RAG）+ TokenCompressor（预算/裁剪/滑动窗口/摘要）。
- 注入：固定框架 + 状态自定义重点块；召回：turn 前预注入 + Agent 运行中主动检索。
- 压缩改进：摘要与分层摘要 L1~L5 联动、滑动窗口按状态裁剪。
- 冲突标注：废弃 ContextManager 与 ADR-0001「保留底座」有张力，以本票为准；相关 104 测试迁移。

## 当前 frontier（open + 无 blocker 占用）

| 票 | 类型 | 问题 | blocker |
|---|---|---|---|
| 02 state-context-assembly | grilling | 每状态读取数据+注入顺序规则；前置不完备的软/硬拦截 | 01 已闭 |
| 03 agent-window-experience | grilling | 统一 Agent 窗口交互形态；取代每页对话 | 01,05 已闭 |
| 04 tools-state-awareness | research | 工具面扩展（读状态/跳转/记忆检索）；Agent 如何感知当前状态 | 01 已闭 |
| 08 frontend-refactor-scope | grilling | 保留哪些窗口、Agent 窗口成主导航、旧页吸收 | 03(未闭) |

## 未到 frontier（还差 blocker）

| 票 | 类型 | 问题 | 等待 |
|---|---|---|---|
| 09 writing-review-on-agent | task | 正文/审阅在 Agent 中枢下实现（取代 M2/M3 stub） | 03,07 |
| 10 legacy-disposition | task | 既有实现（IDEATION/setting store/沙箱/核心要素/104测试）处置 | 08,09 |

**注**：T3 因 05 闭合已解封。当前正式 frontier：T2、T3、T4。

## Not yet specified（迷雾，待演进）

- 记忆 RAG 召回质量底线（何时"够用"）
- 前置不完备拦截的严格度（软提示 vs 硬拦截）
- Agent 窗口多状态并发表现
- 状态集预置粒度细节
- 上下文组装与旧 ContextManager 残余的清理边界

## Out of scope

- 跨书公共知识库（Q12-B 单书优先）
- 重型基建（Qdrant/Neo4j/LangGraph/批量并行写作）——除非未来再审议

