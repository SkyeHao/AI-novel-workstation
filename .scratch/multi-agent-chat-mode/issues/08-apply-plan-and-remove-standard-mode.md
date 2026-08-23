# 08 — 应用最终方案与移除标准模式

**What to build:** 群聊产出的最终方案可落地：保存为文档 / 应用到大纲 / 应用到人设（复用既有应用逻辑）；标准模式整体下线——移除执行器与轮询路由，前端入口全面切换到群聊房间，旧入口与引用清理干净。

**Blocked by:** 04, 07

**Status:** resolved

- [x] 最终方案可保存文档、应用到大纲、应用到人设，落地结果可验证。
- [x] 标准模式执行器与轮询路由已移除，全仓检索无残留引用。
- [x] 前端旧讨论入口全部切换到群聊房间，流程闭环。
- [x] 移除后回归冒烟：开启群聊 → 讨论 → 总结 → 应用 全链路可用。

## Answer

已完成，提交 b85c38c。

- 最终方案应用（backend/src/workflow/chat_apply.ts）：新增 applyChatSessionPlan，三目标落地——document 保存为 memory/discussions/方案-<sessionId前8>.md 并登记 plan 类型文档；outline / characters 让 LLM 把方案合并进既有设定（保留现有结构、方案未涉及则原样返回），写入 settings/outline.json / settings/characters.json；ChatApplyError 区分业务失败；extractJson 容忍围栏代码块。路由 POST /api/chat-sessions/:id/apply 校验 completed + summary，复用 getClientForTask(text)，返回 400/404/500。
- 标准模式下线：删除 workflow/discussion.ts、api/routes/discussions.ts、前端 DiscussionView.vue；server.ts 移除 discussion 路由注册；frontend/src/api/index.ts 删除旧 Discussion 块（保留 getAggregatedInteractions 与群聊 Chat 系列）。
- 前端闭环（frontend/src/views/GroupChatView.vue）：讨论完成且生成最终方案后展示「应用最终方案」面板，提供保存为文档 / 应用到大纲 / 应用到人设三个按钮（loading 防重复）；done 事件保存 summary，恢复会话时回填。
- 测试：新增 test/chat_apply.test.ts 6 例（document / outline / characters / json 围栏 / 空 summary / 未知 target），黑盒断言落盘文件与设定读取。全量 135 例通过，后端 tsc、前端 vue-tsc 通过；全仓检索无旧标准模式残留（仅保留合法项：路由 /discussion 指向 GroupChatView、VectorDiscussionContext 类名等）。
