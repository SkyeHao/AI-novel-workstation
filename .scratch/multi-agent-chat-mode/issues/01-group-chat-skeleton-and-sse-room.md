# 01 — 群聊会话骨架与实时房间

**What to build:** 从资产页选择参与角色（复用既有 Agent 角色蓝图，可自定义）、讨论主题与注入的静态设定，开启一个群聊会话；进入实时讨论房间，看到成员列表（头像 / 名字 / 角色定位标签）、消息流与系统消息（成员加入 / 会话状态）。后端以 ChatSession 编排器作为唯一执行入口（本 feature 唯一黑盒测试 seam），串起状态机与 SSE 实时推送（system / chat_message / done / error）；会话可正常结束。

**Blocked by:** None — can start immediately.

**Status:** resolved

- [ ] 作者能从资产页选角色 / 主题 / 静态设定开启群聊并进入房间，成员列表展示头像、名字、角色定位。
- [ ] 后端 ChatSession 经黑盒 seam 断言状态流转 idle→running→completed，且会话可被结束。
- [ ] SSE 事件（system / chat_message / done / error）按序实时推送到前端并正确渲染。
- [ ] 全部行为经统一入口黑盒断言（注入 fake LLM），不触碰内部模块。

## Answer

已完成并提交（commit f1edff8）。

- 后端：ChatSession 编排器（状态机 idle→running→completed/terminated、事件订阅、sendUserMessage 并行插入、stop、骨架轮流发言循环）；/api/chat-sessions 路由（start/get/message/stop/stream，SSE 复用 agent.ts 模式：心跳 + 断线回放 + done/error 后关流），已挂载到 server.ts。
- 测试：backend/test/chat_session.test.ts 5 例黑盒测试（fake LLM 注入），状态流转 / 重复 start / stop→terminated / LLM 异常→error / 作者消息并行插入，全部通过。
- 前端：GroupChatView.vue（配置阶段：主题/角色/静态设定/轮数 → 实时房间：成员面板/消息流/系统消息/发言状态/作者输入，SSE 实时渲染 + 断线重连 + 刷新恢复）；资产页 AgentRolesAssetView.vue 增加「参与讨论」勾选与「开始群聊」入口；路由 /projects/:id/discussion 切换到群聊视图。
- 说明：frontend/src/router/index.ts 中的路由切换改动因与用户未提交的前端重构同文件，未纳入本次提交（工作区仍生效）。
