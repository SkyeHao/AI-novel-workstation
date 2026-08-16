# 决策票 02：state-context-assembly

Type: grilling
Status: resolved
Blocked by: 01

## Question

每个状态定义『读哪些数据 + 按何顺序注入』的上下文组装规则；以及『前置不完备』时如何提示（软/硬拦截）。依赖 T1 的状态集。
## Answer
每状态的 context_assembly_ref 声明：读哪些数据（核心要素/设定片段/相关记忆/前文摘要）+注入顺序与重点块；前置不完备为软提示（提示补齐可继续）+ 硬拦截开关（未齐备禁止生成）。状态集预置粒度：预置7状态，允许每书选启用。


