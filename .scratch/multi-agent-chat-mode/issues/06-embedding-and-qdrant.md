# 06 — 本地 Embedding + Qdrant 集成

**What to build:** 引入本地多语言 Embedding（paraphrase-multilingual-MiniLM-L12-v2，384 维，离线）+ Qdrant 向量库：话题相关性打分接入发言意愿度（最近消息 vs 角色相关设定相似度，+0~50），观点收敛接入共识检测（最近 8 条发言向量聚类，簇内相似度 ≥ 阈值）；连接失败自动降级为关键词 + 随机，不阻塞讨论主流程；服务层预留切换接口。

**Blocked by:** 04

**Status:** resolved

- [ ] 话题相关性真实影响意愿度：跑题时相关性把讨论拉回（黑盒断言：相关性高分者优先发言）。
- [ ] 观点收敛使用向量聚类：观点趋同的讨论触发共识（黑盒断言）。
- [ ] Qdrant 不可用时自动降级为关键词 + 随机，讨论照常推进、不报错卡死。
- [ ] Embedding 与向量检索为独立服务模块，预留运行时切换接口。

## Answer

已完成。

- 独立服务模块：
  - backend/src/vector/embedding.ts —— EmbeddingService 接口 + TransformersEmbeddingService 实现（Xenova/paraphrase-multilingual-MiniLM-L12-v2，384 维，离线推理）；ensureReady 失败返回 false 不抛出，含加载超时。
  - backend/src/vector/store.ts —— VectorStore 接口 + QdrantVectorStore 实现（@qdrant/js-client-rest，默认 http://127.0.0.1:6333，collection chat_messages，Cosine）；连接失败静默降级；导出 cosine / clusterSimilarity 纯函数。
  - backend/src/vector/context.ts —— VectorDiscussionContext：把两服务组合成两路同步信号（Embedding 异步、调度器/共识检测器同步，靠会话开始预热成员画像 + 每条发言后异步缓存向量解决）：
    1) relevance(member, recentText) → 0~50：成员画像向量（name + description + sharedContextKeys 静态设定）vs 最近发言向量余弦×50；
    2) convergence(recent) → boolean：最近发言向量簇内相似度 ≥ 0.75。
    任一环节未就绪 / 未命中自动回退关键词 + 随机 / 跨成员表态一致，绝不抛出。
- ChatSession 集成：config 新增可选 vector（embedding / store / readyTimeoutMs，默认 4000ms）；start() 有界等待向量预热，超时降级不阻塞；每条 Agent 发言在共识检测前向量化（trackText），作者消息同步进入向量上下文；话题相关性经 relevanceFn 接入意愿度、观点收敛经 convergenceFn 接入共识检测。
- 路由接线：chat_sessions.ts 懒加载单例 vectorBundle（Embedding + Qdrant），不可用时 ChatSession 自动降级，不阻断讨论。
- 测试：chat_session.test.ts 新增 3 例黑盒断言——① 相关性高分成员连续优先发言（发言含对侧关键词但向量贴近本侧画像，证明走向量而非关键词）；② 发言无关键词 / 低自评，仅凭向量趋同即触发合成者总结；③ Embedding 不可用时讨论照常完成不报错。新增 test/vector.test.ts 5 例（cosine / clusterSimilarity 纯函数、VectorDiscussionContext 就绪/降级两路）。全量 122 例通过；后端 tsc 无新增报错（仅工单 08 将清除的预存报错）。
