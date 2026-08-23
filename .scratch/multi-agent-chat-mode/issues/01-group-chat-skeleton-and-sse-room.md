# 01 — 群聊会话骨架与实时房间

**What to build:** 从资产页选择参与角色（复用既有 Agent 角色蓝图，可自定义）、讨论主题与注入的静态设定，开启一个群聊会话；进入实时讨论房间，看到成员列表（头像 / 名字 / 角色定位标签）、消息流与系统消息（成员加入 / 会话状态）。后端以 ChatSession 编排器作为唯一执行入口（本 feature 唯一黑盒测试 seam），串起状态机与 SSE 实时推送（system / chat_message / done / error）；会话可正常结束。

**Blocked by:** None — can start immediately.

**Status:** ready-for-agent

- [ ] 作者能从资产页选角色 / 主题 / 静态设定开启群聊并进入房间，成员列表展示头像、名字、角色定位。
- [ ] 后端 ChatSession 经黑盒 seam 断言状态流转 idle→running→completed，且会话可被结束。
- [ ] SSE 事件（system / chat_message / done / error）按序实时推送到前端并正确渲染。
- [ ] 全部行为经统一入口黑盒断言（注入 fake LLM），不触碰内部模块。
