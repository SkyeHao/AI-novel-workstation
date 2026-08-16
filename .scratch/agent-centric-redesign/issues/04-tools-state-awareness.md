# 决策票 04：tools-state-awareness

Type: research
Status: resolved
Blocked by: 01

## Question

现有工具系统（web_search/file_read/file_write/ask_user）+ 新增『读当前状态/状态列表/跳转状态/记忆RAG检索』等 Agent 原生工具；Agent 如何『读到小说当前状态』并按其操作。对照现有 ReAct Agent 与 ToolManager 代码。
## Answer
工具面新增状态感知工具：read_current_state / list_states / switch_state / memory_search(MemoryRetriever)；Agent 通过 read_current_state 读取单锚点状态并按状态组装。现有 web_search/file_read/file_write/ask_user 保留。


