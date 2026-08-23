# 07 — 讨论记录持久化与恢复

**What to build:** 群聊完整记录按书持久化（memory/discussions/<sessionId>.json），讨论进行中内存常驻、共识节点与最终方案落库；刷新页面或重启应用后会话与历史可恢复，作者可随时查看完整讨论记录复盘；持久化层预留接口便于后续切换存储。

**Blocked by:** 02

**Status:** resolved

- [x] 会话进行中与结束后，完整记录按书写入文件（黑盒断言：重启后可加载）。
- [x] 刷新 / 重启后会话与历史可恢复，前端重新进入可续看。
- [x] 共识节点与最终方案单独落库，与过程记录分离。
- [x] 持久化层以接口隔离，切换存储不侵入编排器。

## Answer

已完成。

- 持久化层（backend/src/storage/chat_store.ts）：
  - ChatStore 接口：save / appendMessage / appendConsensus / setSummary / setStatus / load / list，编排器与路由只依赖接口，切换存储不侵入。
  - FileChatStore 实现：按书落盘 memory/discussions/<sessionId>.json（完整过程记录）+ <sessionId>.consensus.json（共识节点 + 最终方案，成果分离）；save 按消息 id 合并（追加不删，防旧快照覆盖丢记录）；损坏文件返回 null/[] 不抛异常；list 按 updatedAt 倒序。
- ChatSession 集成：config 新增可选 chatStore；start() 落初始记录，每条 Agent / 作者消息增量 appendMessage，共识达成 appendConsensus、合成者产出 setSummary，完成 / 终止 / 异常时 setStatus + 最终 save；getSnapshot() 扩展为 ChatSessionSnapshot（含 summary + consensusNodes）。
- 路由（chat_sessions.ts）：start 注入 FileChatStore；新增 GET /api/chat-sessions?projectId= 返回项目内会话列表（含共识 / 最终方案）；GET /:id 与 /:id/stream 在内存未命中时回退磁盘——终态会话回放历史后补发 done，重启后仍可续看。
- 测试：新增 test/chat_store.test.ts 7 例——FileChatStore 往返一致 / 两文件分离 / 增量追加与幂等 / list 排序 / 损坏文件降级，以及 ChatSession+FileChatStore 黑盒（共识完成后从磁盘 load 出完整消息 + 共识节点 + 最终方案；手动终止落盘 terminated）。全量 129 例通过；后端 tsc 无新增报错（仅工单 08 将清除的预存报错）。
