# 05 — 分层上下文组装（L1/L2/L3）

**What to build:** 每位 Agent 发言前按固定顺序组装上下文：系统提示（角色蓝图 + 角色特性）→ 静态设定（按注入项）→ L3 全讨论要点 + 作者指令 → L2 最近 20 条滚动摘要 → L1 最近 5 条完整消息 → 触发消息原文；按模型窗口控制预算、超限降级摘要粒度；发言附带「回应的是哪条消息 / 哪位成员」的引用，让讨论脉络可溯。

**Blocked by:** 02

**Status:** resolved

- [ ] 黑盒断言：给不同角色组装出的上下文注入 系统提示 / 静态设定 / L3 / L2 / L1 顺序正确，且静态设定来自所选注入项。
- [ ] 长讨论超预算时按规则降级（L2→L1 摘要粒度），不硬超窗口。
- [ ] 每个 Agent 发言包含回应引用，前端能展示「回应谁」。
- [ ] 作者历史指令进入 L3，影响后续发言。

## Answer

已完成。

- 后端：新增 backend/src/workflow/context_assembler.ts 上下文组装器——按固定顺序组装：系统提示（角色蓝图 systemPrompt + 角色定位 description）→ 静态设定（成员 sharedContextKeys 优先，其次全局默认键，最后全部键）→ L3 全局要点（关键议题 + 作者历史指令）→ L2 最近 20 条滚动摘要（逐条压缩至约 60 字）→ L1 最近 5 条完整消息 → 触发消息（被回应原文）→ 任务指令。
- 预算控制：默认 maxTokens 8000（按 2 字符/token 近似，可注入 countTokens）；超限逐级降级——① 压缩 L2 为占位说明 ② 截断静态设定超长值（300 字）③ 从旧到新裁剪 L1 ④ 硬预算截断头部保留任务指令；degraded 标记暴露降级状态，绝不硬超窗口。
- 集成：ChatSession 新增 _assembler（注入 LLM 的 count_text_tokens）与 _authorInstructions（作者发言保留最近 5 条，进入 L3）；_runAgentTurn 发言前用组装器产出 systemPrompt + userPrompt；每条 Agent 消息带 replyTo 回应引用，前端可展示「回应谁」。
- 路由：chat_sessions.ts 的 roleToMember 透传 contextConfig.sharedContextKeys；ChatMember 接口新增可选 sharedContextKeys。
- 测试：新增 6 例黑盒断言——系统提示含角色定位、静态设定按 sharedContextKeys 注入（无键角色回退全量）、作者历史指令进入 L3、L1/L2/L3 分层顺序、replyTo 回应引用与触发层原文、超预算降级（静态截断 + L2 压缩、任务指令始终保留）。chat_session.test.ts 共 26 例全部通过；后端 tsc 无新增报错（仅工单 08 将清除的预存报错）。
