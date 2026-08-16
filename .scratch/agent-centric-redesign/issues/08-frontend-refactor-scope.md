# 决策票 08：frontend-refactor-scope

Type: grilling
Status: resolved
Blocked by: 03

## Question

前端重构范围：保留哪些窗口（工作台/世界观/人物卡片/章纲/用户设置），Agent 窗口如何成为主导航中枢；旧 IDEATION/正文/阅读/审阅页如何被吸收。依赖 T3 的窗口形态。


## Answer

前端重构范围已定（纳入用户对 Q1/Q4 的调整）：

- **Q1=Agent 独立页面（用户修正）**：Agent 是**独立的一等页面**，不是"内容区被 Agent 包裹"。工作台 / 设定(世界观/人物/章纲) / 正文 / 审阅 / 用户设置 等页面**依旧独立存在**作为顶层页。AgentWindow（主导航中枢对话）与其并列，通过感知当前状态 + 记忆/上下文协作，而非把所有页面吸进内容区。**此修正对 T3-Q1 的"主导航+内容区"形态作修订**。
- **Q2=A（旧页吸收为状态面板）**：IDEATION→创意孵化面板；正文/阅读/审阅→正文/审阅状态面板（含可选全屏只读）；设定中心→世界观/人物/章纲三面板。
- **Q3=A（旁路保留）**：工作台(/projects 项目列表)、用户设置(/config)为顶层独立页；ChatView 调试能力收进配置页；交互记录(Interactions)保留为用户设置下子入口。
- **Q4=C（全新建 + 删旧视图，用户指定）**：新建 AgentWindow + 各状态面板，旧业务视图（IdeationView/SettingsView/WritingView/ReadingView/ReviewView 等）逐步删除替换，不留旧页复用。

**T3/T8 形态差异标注**：T3-Q1 定为"Agent 主导航 + 内容区随状态切换面板"；T8-Q1 用户刷为"Agent 独立页面存在，其余内容页独立"。以 T8 为准——Agent 与内容页并列独立，而非包裹。记入 CONTEXT.md。
