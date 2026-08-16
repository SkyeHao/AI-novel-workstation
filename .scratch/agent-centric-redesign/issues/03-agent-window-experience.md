# 决策票 03：agent-window-experience

Type: grilling
Status: resolved
Blocked by: 01,05

## Question

统一 Agent 窗口的交互形态：对话驱动一切、状态面板联动、asking 确认机制、SSE 流式；如何取代旧的『每页一个对话』。需要一个通用 Agent 交互窗口（Q11-C/Q13 中枢包裹）。


## Answer

统一 Agent 窗口交互形态已定（Agent 中枢体验核心，喂给 T8/T9）：

- **Q1=A（主导航 = Agent 窗口 + 内容区随状态切换）**：Agent 对话常驻（对话驱动一切）；内容区显示当前状态的产物面板，选哪个状态/产物就切换对应面板。落 T1 单锚点 current_state。
- **Q2=B（面板可点选 + 字段级可编辑）**：面板可点选（选中某章/人物/伏笔让 Agent 针对处理），字段级可编辑（编辑后让 Agent 确认再沉淀进记忆/正典）。
- **Q3=A（沿用升级 ask_user 结构化卡片）**：复用已验证的 ask_user 机制，升级为结构化卡片浮在对话流（选项/多选/自定义），回答后 Agent 继续；与内容面板联动。
- **Q4=B（单对话线 + 状态自动感知）**：Agent 窗口是同一持续对话线；切换状态时 ContextOrchestrator（T7）按新状态组装上下文，Agent 感知当前状态继续。不碎成每状态独立对话。

前端落地：以现有 IdeationView 的 SSE 流式 + ask_user 为雏形，扩展为通用 AgentWindow 组件（主导航），内容面板组件化。依赖 T8 细化前端范围与路由。
