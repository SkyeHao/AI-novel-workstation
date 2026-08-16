# 决策票 06：rag-retrieval-tradeoff

Type: research
Status: resolved
Blocked by: 05

## Question

是否推翻 ADR『第一版不上向量库』：引入 embedding+检索（Qdrant 或轻量 SQLite FTS/向量）还是先用关键词+分层摘要；向量库设为可选项。与现有 ADR 冲突最直接。


## Answer

RAM/RAG 取舍已定：**不推翻 ADR-0001**，本轮采用轻量召回，向量库保留为可选项（后续经转置可加）。

- **Q1=A（轻量，不上向量库）**：单书记忆（T5 四类、几十 MB 文本）用「关键词匹配 + 分层摘要」召回即可满足写作时"该回忆什么"。不引入 embedding/向量库（Qdrant/Chroma/FAISS），符合本地单机与低依赖定位。ADR-0001「不上 Qdrant」维持。
- **Q2=C（三管并用）**：①规则召回：按人物名/伏笔关键词/章号/状态标签过滤 facts/foreshadow 返回命中条；②Agent 主动工具读取：file_read 深度翻源；③分层摘要 L1~L5 作 long-range 记忆兜底注入。三管构成完整"轻量 RAG"。
- **Q3=A（预留接口）**：一层薄的 `MemoryRetriever` 接口，`MEMORY_RETRIEVAL_MODE` 配置切换 keyword|vector。keyword 实现本轮落地，vector 后补（Not-yet）。兑现"向量库可选项"。

下游输入：T7（上下文编排器）据此实现 `MemoryRetriever` keyword 实现 + 摘要注入；T3/T9 据此给 Agent 配"记忆检索"工具面。
