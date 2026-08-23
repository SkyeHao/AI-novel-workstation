# 0010：多 Agent 群聊模式 —— 意愿度调度 + 共识检测 + 分层上下文

将「标准模式」的并行产出 + 汇总升级为「群聊模式」：多个 Agent 角色与作者在实时讨论房间内自由发言，达成共识后由合成者产出最终方案；标准模式整体移除。

## 决策

- **群聊替代标准模式**：移除标准模式执行器 `discussion.ts` 与轮询路由 `discussions.ts`；新增 `ChatSession` 编排器作为唯一测试 seam，面向路由 / 前端暴露 `start / sendUserMessage / stop / resume`，串起 调度 → 上下文 → 发言 → 意愿度 → 共识 → 合成 全生命周期。
- **发言权调度（意愿度制）**：单一发言者模型，任一时刻至多一个 Agent 生成，其余等待；意愿度 = 被@加成(+100) + 等待时间(+0~30) + 话题相关性(+0~50) + 角色特性(+0~20) − 冷却惩罚(−20~−50) + 随机扰动(+0~10)；事件驱动 + `IDLE_TIMEOUT`（默认 30s）定时兜底防冷场。
- **作者参与**：作者为群成员，消息并行插入、不阻塞当前生成；支持 @角色名 定向召唤（+100 强加成）与点击成员快速 @；发言计入讨论历史与上下文。
- **共识检测（综合检测）**：三路信号并判定——关键词信号（「我同意 / 一致 / 达成共识」等）+ 观点收敛（最近 8 条发言向量聚类，簇内相似度 ≥ 阈值）+ Agent 自评（发言附带 consensus 字段）；连续 2 轮加权超阈值触发；单路阈值默认 关键词 0.6 / 收敛 0.75 / 自评 0.7。
- **上下文管理（分层摘要）**：L1（最近 5 条完整消息）+ L2（最近 20 条滚动摘要）+ L3（全讨论要点 + 作者历史指令），按模型窗口控预算，超限降级摘要粒度。
- **实时推送（SSE）**：复用 `agent.ts` 既有 SSE 模式与心跳；新增事件 `chat_message` / `speaker`（含得分明细）/ `agent_status` / `consensus` / `system` / `done` / `error`。
- **本地 Embedding + 向量库**：`@xenova/transformers` 加载 `paraphrase-multilingual-MiniLM-L12-v2`（384 维，本地离线）+ Qdrant（Docker 6333）+ `@qdrant/js-client-rest`，用于话题相关性与观点收敛；连接失败降级为关键词 + 随机，不阻塞主流程。**不推翻 ADR-0001**：单书记忆 RAG 仍维持 keyword 轻量召回，本 feature 是「讨论内」的独立检索场景。
- **消息存储（分层）**：内存（实时）+ 落库（共识节点 / 最终方案）+ 文件 `memory/discussions/<sessionId>.json`（完整记录按书持久化，刷新 / 重启可恢复）。
- **参与角色**：复用 `agent_roles` 资产（提案者 / 合成者），讨论开始时按前端所选角色组建群，合成者在共识达成时执行总结。

## 原因

标准模式存在三处结构性缺陷：① 各 Agent 独立生成初始提案后汇总，彼此没有交锋 / 追问 / 让步，冲突制造者、情感锚点等角色设定优势体现不出，讨论结果趋于平庸；② 作者被隔离在流程外，只能在审查点追加指令，无法实时引导、打断讨论；③ 前端体验为管线式而非对话，讨论过程不可见，执行中易「卡住」，作者不知道 Agent 正在做什么。群聊模式以「意愿度调度 + 实时推送 + 分层上下文 + 三路共识」系统性解决以上问题，并把作者纳入群成员。

## 后果

- 后端：移除 `discussion.ts` / `discussions.ts`；新增 `chat_session.ts`（编排器）、`speaker_scheduler.ts`、`consensus_detector.ts`、`context_assembler.ts`、`sse_notifier.ts`、`embedding.ts`、`vector_store.ts`、`chat_store.ts`；新增路由 `chat_sessions.ts`。
- 前端：`DiscussionView.vue` 重构为群聊界面（保留应用阶段入口）；新增 SSE 事件处理与「当前发言人 / 输入中 / 共识预警」展示。
- 新增依赖：`@xenova/transformers@^2.17.0`、`@qdrant/js-client-rest@^1.7.0`；运行要求 Node.js 18+、Docker（Qdrant 6333）。
- 新环境变量：`QDRANT_URL`、`IDLE_TIMEOUT`（默认 30）、共识阈值（关键词 / 收敛 / 自评，默认 0.6 / 0.75 / 0.7）。
- 设计文档：`docs/design/multi-agent-chat-mode.md`；测试接缝与验收口径：`.scratch/multi-agent-chat-mode/spec.md`。
