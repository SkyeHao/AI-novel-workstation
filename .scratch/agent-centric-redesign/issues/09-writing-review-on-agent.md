# 决策票 09：writing-review-on-agent

Type: task
Status: resolved
Blocked by: 03,07

## Question

正文/审阅在 Agent 中枢下的实现：正文生成=进入正文状态按章纲+记忆写作，审阅=审阅状态处理；取代旧 M2/M3 stub。依赖 T3/T7。
## Answer
正文四步（前置检测→组装上下文→写章落盘→沉淀L1摘要）+选段修改（对比确认）+审阅五步（报告/去AI味/对比应用）+ask_user卡片确认；章状态机 PENDING→GENERATED→REVIEWED/FINALIZED，修改回 GENERATED，落盘触发记忆更新。


