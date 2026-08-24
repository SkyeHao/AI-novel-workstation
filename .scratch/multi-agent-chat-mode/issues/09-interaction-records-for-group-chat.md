# 09 — 群聊会话在交互记录中的独立存储与展示

**What to build:** 将群聊与单 Agent 的交互记录从存储结构到展示方式彻底区分：群聊主记录以按书的 chat_store（结构化、含成员/共识）为准；其 LLM 调用在全局 interactions.jsonl 中新增 channel 判别字段并标注发言成员，随会话级联删除；交互记录页拆为「单 Agent 交互」「群聊讨论」两个页签，群聊以聊天气泡展示完整讨论并可下钻查看调用记录。

**Blocked by:** 07, 08

**Status:** resolved

## 背景

当前群聊与单 Agent 的记录混在同一个全局 interactions.jsonl 里：
- 群聊每次 LLM 调用以 source=chat / session_id="chat:<uuid>" 写入原始调用记录，与单 Agent 共用同一棵「作品 → 会话 → 轮次」展示树，看不出成员发言与讨论脉络。
- 群聊真正的记录（成员、完整对话、共识）存在独立的 chat_store（按书 memory/discussions/<id>.json），形成两份真相。
- 删除群聊会话只清 chat_store，interactions.jsonl 里的 chat 记录成为孤儿。

## 设计

### 存储结构

1. 群聊主记录 = chat_store（按书、结构化、含成员 / 状态 / 共识 / 最终方案）。这是群聊的“交互记录”本体。
2. 群聊 LLM 调用调试层 = interactions.jsonl，新增 channel 判别字段：
   - channel ∈ { agent, group_chat }，与用户视角的“单 Agent / 群聊”一一对应。
   - group_chat 记录标注 member_id / member_name（哪个 Agent 发的言），便于按消息下钻调用详情。
   - 旧数据在读取时按 source + session_id 前缀推导 channel，无需迁移。
3. 单 Agent（含创意工作流 stage1、旧聊天测试 chat_test）= channel=agent，沿用现有 JSONL 结构。
4. 级联一致性：删除群聊会话时，同时清除该会话在 interactions.jsonl 中的全部记录（deleteBySession）。

### 展示方式

交互记录页拆为两个页签：
- 「单 Agent 交互」：保留现有「作品 → 会话 → 轮次」三级分组，仅显示 channel=agent 的记录。
- 「群聊讨论」：按作品列出 chat_store 中的讨论会话，展开后以聊天气泡渲染完整讨论（作者 / 各 Agent 发言、成员标签、共识与最终方案），并可按会话展开查看其 LLM 调用记录（channel=group_chat）。

## 验收

- [x] StoredInteraction 具备 channel 字段；保存群聊记录时标注 member_id / member_name。
- [x] aggregateInteractions / listInteractions 支持 channel 过滤；旧数据按 source+session_id 推导 channel。
- [x] 删除群聊会话时，interactions.jsonl 中该会话记录一并清除。
- [x] 交互记录页具备「单 Agent 交互」「群聊讨论」页签；群聊页签以气泡展示完整讨论与共识。
- [x] 后端测试与前端类型检查通过。

## Answer

已按设计完成群聊与单 Agent 交互记录在存储与展示上的彻底区分。

存储层（interaction_store.ts）：
- StoredInteraction 新增 channel（agent/group_chat）、member_id、member_name 字段。
- deriveChannel() 对新数据直接读 channel，旧数据按 source + session_id 前缀推导（chat:/chat_apply 前缀 → group_chat），无需迁移。
- saveInteraction 支持通过 opts 标注 channel 与成员；listInteractions / aggregateInteractions 支持 channel 过滤，聚合结果带 channel 字段。

群聊路由（chat_sessions.ts）：
- /start 用 speaker / agent_status 事件追踪当前发言成员，每条 LLM 调用 saveInteraction("chat", ...) 时标注 channel=group_chat + 成员。
- /apply 记录 channel=group_chat、member_name=「方案应用」。
- DELETE /:id 追加 deleteBySession("chat:" + id)，级联清除该会话在 interactions.jsonl 的全部记录。
- 旧聊天测试路由 source 由 "chat" 改为 "chat_test"，避免被误归入群聊渠道。

交互记录路由（interactions.ts）与前端 API：/ 与 /aggregated 透传 channel 过滤，前端类型同步新增 channel/member 字段与 chat_test/chat_apply 来源。

展示层（InteractionsView.vue）：
- 页面拆为「单 Agent 交互」「群聊讨论」两个页签；单 Agent 页签仅加载 channel=agent 的记录，保留原三级分组。
- 群聊页签按作品聚合 chat_store 中的讨论会话：支持展开/收起会话，以聊天气泡渲染完整讨论（系统提示居中、作者右对齐、Agent 左对齐带头像与分类标签），并展示成员 chips、共识演化节点、最终方案卡。
- 每个会话可展开「LLM 调用记录」，按 channel=group_chat + session_id=chat:<id> 拉取并下钻详情；详情抽屉对群聊记录显示「群聊讨论」来源标签。

验证：后端 tsc 通过；vitest 144 例全部通过；前端 vue-tsc 通过、vite build 成功。
