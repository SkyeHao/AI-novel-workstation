# 决策票 07：context-orchestrator

Type: task
Status: resolved
Blocked by: 05,06

## Question

状态组装 + 记忆召回 + 滑动窗口/摘要 的统一编排器设计：如何与现有 ContextManager 融合/替换。依赖 T5/T6。


## Answer

重写上下文管理整条链路：`ContextOrchestrator` 取代现有 `ContextManager`，全量承载系统提示/记忆召回/拼接/压缩，旧 ContextManager 废弃（Q5=A）。

- **职责（Q1=重写）**：系统提示、记忆召回、拼接、压缩/预算全部归新编排器。
- **模块划分（Q6=C）**：三个高内聚协作对象——`PromptAssembler`（按 T1 状态规则→注入块拼接）、`MemoryRetriever`（T6 的轻量 RAG）、`TokenCompressor`（token 预算/per-message 裁剪/滑动窗口/摘要压缩）。
- **注入结构（Q2=C）**：固定外层框架（系统提示 + 当前状态说明 + 记忆召回 + 相关设定片段 + 分层摘要 L2~L5 + 对话历史），每个状态在 `context_assembly_ref` 里声明"重点块/精简块"。状态驱动块序。
- **召回时机（Q3=C）**：turn 前预注入"该状态必然要的"（活跃伏笔/出场人物/前文摘要）+ 运行中 Agent 可主动调记忆检索工具。
- **压缩改进（Q7=B）**：重写时顺手改进——摘要纳入 T5 分层摘要联动（对话摘要归入 L 级体系）、滑动窗口按状态智能裁剪；token 预算/per-message 裁剪语义迁自旧 ContextManager。

**冲突标注（供 T10 处置引用）**：废弃 `ContextManager` 属"重做已验证底座"的一部分，与 ADR-0001「保留已验证底座」中的上下文管理条目冲突；ADR 层面以本票为准（上下文管理归入被重做的记忆/上下文层）。现有 104 测试相关部分迁移至 `ContextOrchestrator`。
