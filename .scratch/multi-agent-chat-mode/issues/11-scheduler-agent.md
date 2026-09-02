# 11 — 统一调度 Agent（群聊导演）替代每轮征询全员意愿

**What to build:** 将工单 02 的「每轮并行征询全员意愿（willingness_probe）」改为统一调度 Agent（群聊导演）：每次决策只调用一个导演角色，输入讨论主题、成员信息（含已发言次数 / 距上次发言轮数）、近期发言与历史摘要，输出下一位发言者的排序。导演可配置独立模型 / 温度 / 超时 / 输出 token。

**Blocked by:** 09

**Status:** resolved

## 设计决策（已与用户确认）

1. **软约束**：导演能看到每位成员「已发言次数 / 距上次发言轮数」，由提示词引导发言平衡；代码不硬性拦截冷却中的成员（导演可点名刚发言者继续补充）。
2. **被@强优先**：作者@某人时直接下一轮归被@者，不经导演（speaker_scheduler.hasMention → pickNext）。
3. **独立配置**：导演可配置独立模型 / 温度 / 超时 / 输出 token；缺省回落讨论同款 LLM 与默认参数。

## Answer

已完成。

- 新增 backend/src/workflow/scheduler_agent.ts：SCHEDULER_SYSTEM_PROMPT、buildSchedulerUserPrompt（[TOPIC]/[MEMBERS]/[RECENT]/[HISTORY]/[TRIGGER]/[STATUS]）、parseSchedulerResponse（JSON 排序解析、过滤非法成员、去重、取前 3、按 priority 排序）、probeSchedulerDecision（默认 3s 超时 / 300 tokens / temp 0.3）。
- 新增 backend/src/assets/roundtable_config.ts：SchedulerRoundtableConfig { enabled, modelId, temperature, timeoutMs, maxTokens } 与 normalizeScheduler 归一化；RoundtableConfig.scheduler 字段（默认启用，modelId null 表示与讨论共用模型）。
- backend/src/api/state.ts：新增 getClientByModelId(id, logger) —— 模型存在返回 client（带 logger 时新建，否则缓存），不存在返回 null。
- 改造 backend/src/workflow/chat_session.ts：新增 schedulerAgent 配置（SchedulerAgentOptions）、scheduler_probe 事件、_pickBySchedulerAgent（被@强优先 → 组装成员统计/近期/历史 → 导演决策，失败/超时回退规则调度与兜底等待）、发言统计 _speakCounts / _lastSpeakTurn 供软约束。
- 改造 backend/src/api/routes/chat_sessions.ts：/start 读取 roundtableCfg.scheduler，modelId 存在且 getClientByModelId 成功 → 导演独立 client，否则回落讨论同款。
- 前端 frontend/src/components/RoundtableAgentsTab.vue：讨论配置区新增「调度 Agent（群聊导演）」开关与导演模型 / 温度 / 超时 / 输出 Token 配置（可清空模型回落共用）。
- 前端 frontend/src/views/GroupChatView.vue：意愿征询条替换为「调度决策」折叠条（展示 ranking 每行 成员 + 优先级 + 理由、选中高亮、导演指引、兜底标签）；scheduler_probe 事件上屏为可折叠系统消息；清理废弃的 probingIds / member-probing。
- 事件类型：willingness_probe → scheduler_probe（data: { round, ranking[{memberId, priority, reason}], note?, chosenId, fallback, parseOk, raw }），前后端与 knownEvents 已同步。
- 测试：新增 backend/test/scheduler_agent.test.ts 9 例（解析过滤/去重/排序/取3、缺字段兜底、解析失败回退、超时回退、LLM 抛错回退、提示词组装）；全量 vitest 153 例通过，vue-tsc --noEmit 通过。

## Comments

遗留：backend/src/workflow/willingness_probe.ts 已无任何导入，成为孤儿模块；如需彻底移除可单独清理（保留不影响运行）。
