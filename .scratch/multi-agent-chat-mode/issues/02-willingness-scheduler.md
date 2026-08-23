# 02 — 意愿度发言调度

**What to build:** 群聊中任一时刻至多一位 Agent 发言，其余等待；系统按意愿度为每位成员算分并选出最高者发言：等待时间加成（越久越开口）+ 角色特性加成 + 冷却惩罚（刚发过言衰减、防垄断）+ 随机扰动；话题相关性项先以关键词 / 随机降级实现；超时兜底（30s 无人发言强制开口）防冷场；speaker / agent_status 事件实时推送当前发言人、思考 / 生成状态与得分明细。

**Blocked by:** 01

**Status:** resolved

- [ ] 黑盒断言：任一时刻只有一个 Agent 在生成，无并发生成。
- [ ] 冷却生效：连发多次后让位；等待加成生效：久未发言者得分上升。
- [ ] 30s 无人发言时兜底机制强制下一位开口，不冷场。
- [ ] speaker 事件含得分明细，agent_status 反映思考 / 生成中，前端实时展示「谁在发言 / 思考及原因」。

## Answer

已完成。

- 新增 backend/src/workflow/speaker_scheduler.ts：意愿度公式（被@ +100 / 等待 +0~30 / 话题相关性 +0~50 关键词降级 / 角色特性 proposer+8·reviewer+12·synthesizer+5 / 冷却 -50~-20 / 随机 +0~10）、pickNext / forceHighest / mention / trackMessage / recordTurn / computeScores；时间与随机可注入，使测试确定性。
- 改造 backend/src/workflow/chat_session.ts：接入调度器，maxRounds 改为发言总预算（默认 8），新增 idleTimeoutMs（30s）与 cooldownMs（20s）配置，发言循环改为意愿度调度 + 兜底等待（冷却到期自然恢复 / 超时强制最高分开口 / 终止返回）；_runAgentTurn 新增 speaker 事件（含得分明细与 reason）、thinking/generating 状态与 replyTo 字段。
- 测试：backend/test/chat_session.test.ts 新增 8 例（工单 02 共 5 例 + 调度器直接断言 4 例），黑盒断言 任一时刻仅一位 Agent 生成 / 冷却让位 / 等待加成 / 30s 兜底强制开口 / speaker 事件得分明细，共 13 例全部通过。
- 说明：既有工单 01 测试因调度器引入冷却而需注入固定时钟与小冷却/兜底值，已同步修正（外部行为断言不变）。
