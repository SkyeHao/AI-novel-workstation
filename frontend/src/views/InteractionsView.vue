<template>
  <div class="interactions-view">
   <PageHeader title="交互记录" subtitle="LLM 调用历史 · 按会话分组展示" icon="Document">
     <template #actions>
       <el-tag size="small" type="info" effect="plain" round>共 {{ total }} 条</el-tag>
        <el-button :loading="loading" @click="handleRefresh">
          <el-icon style="margin-right: 6px"><Refresh /></el-icon>
          刷新
        </el-button>
        <el-popconfirm
          title="确定要清空所有交互记录吗？此操作不可恢复。"
          confirm-button-text="清空"
          cancel-button-text="取消"
          confirm-button-type="danger"
          @confirm="handleClearAll"
        >
          <template #reference>
            <el-button type="danger" plain :disabled="total === 0">
              <el-icon style="margin-right: 6px"><Delete /></el-icon>
              清空全部
            </el-button>
          </template>
        </el-popconfirm>
      </template>
   </PageHeader>

    <!-- 页签切换：单 Agent 交互 / 群聊讨论 -->
    <el-tabs v-model="activeTab" class="interaction-tabs" @tab-change="handleTabChange">
      <el-tab-pane label="单 Agent 交互" name="agent">
    <!-- 记录列表 -->
    <el-card class="list-card" shadow="never">
     <div v-loading="loading" class="list-container">
       <!-- 空状态 -->
       <div v-if="!loading && records.length === 0" class="empty-state">
         <div class="empty-icon">
           <el-icon size="48"><DocumentRemove /></el-icon>
         </div>
         <p class="empty-title">暂无交互记录</p>
         <span class="empty-hint">进行聊天测试或执行工作流后，交互记录将自动保存到这里</span>
       </div>

       <!-- 记录卡片流 -->
       <div v-else class="records-flow">
         <div class="group-toolbar">
           <span class="group-hint">
             按作品 → 会话 → 交互三级分组展示
           </span>
            <div class="group-toolbar-actions">
              <el-button link type="primary" size="small" @click="expandAllGroups">
                <el-icon><Expand /></el-icon>
                展开全部
              </el-button>
              <el-button link type="info" size="small" @click="collapseAllGroups">
                <el-icon><Fold /></el-icon>
                收起全部
              </el-button>
            </div>
          </div>

          <el-collapse v-model="activeGroups" class="groups-collapse three-level-collapse">
            <!-- 第一层：作品 -->
            <el-collapse-item
              v-for="pr in projectGroups"
              :key="pr.key"
              :name="pr.key"
              class="project-level"
            >
              <template #title>
                <div class="group-header project-header">
                  <el-icon class="group-icon"><Folder /></el-icon>
                  <span class="group-trigger">{{ pr.projectName }}</span>
                  <el-tag size="small" type="warning" effect="dark" round>
                    {{ pr.sessions.length }} 个会话
                  </el-tag>
                  <el-tag size="small" type="info" effect="plain" round>
                    {{ projectTotalTokens(pr) }} tokens
                  </el-tag>
                  <el-tag v-if="projectHasError(pr)" size="small" type="danger" effect="plain" round>含错误</el-tag>
                  <span class="group-time">{{ formatTime(projectFirstTime(pr)) }}</span>
                </div>
              </template>

              <!-- 第二层：会话 -->
              <el-collapse v-model="activeGroups" class="session-collapse">
                <el-collapse-item
                  v-for="s in pr.sessions"
                  :key="s.key"
                  :name="s.key"
                  class="session-level"
                >
                  <template #title>
                    <div class="group-header session-header">
                      <el-icon class="group-icon"><ChatLineSquare /></el-icon>
                      <span class="group-trigger">{{ s.title }}</span>
                      <el-tag size="small" type="warning" effect="dark" round>
                        {{ s.turns.length }} 次交互
                      </el-tag>
                      <el-tag size="small" type="info" effect="plain" round>
                        {{ sessionTotalTokens(s) }} tokens
                      </el-tag>
                      <el-tag v-if="sessionHasError(s)" size="small" type="danger" effect="plain" round>含错误</el-tag>
                      <el-tag size="small" type="primary" effect="plain" round>
                        会话 {{ shortId(s.sessionId) }}
                      </el-tag>
                      <span class="group-time">{{ formatTime(sessionFirstTime(s)) }}</span>
                      <RowActions
                        class="row-actions"
                        :items="sessionActions()"
                        @command="(cmd: string) => onSessionCommand(cmd, s)"
                      />
                    </div>
                  </template>

                  <!-- 第三层：交互 -->
                  <el-collapse v-model="activeGroups" class="turn-collapse">
                    <el-collapse-item
                      v-for="turn in s.turns"
                      :key="turn.key"
                      :name="turn.key"
                      class="turn-level"
                    >
                      <template #title>
                        <div class="group-header turn-header">
                          <el-icon class="group-icon"><ChatDotRound /></el-icon>
                          <span class="group-trigger">
                            {{ turn.userMessage || turn.items[0]?.title || '（无触发消息）' }}
                          </span>
                          <el-tag size="small" type="warning" effect="dark" round>
                            {{ turn.items.length }} 次调用
                          </el-tag>
                          <el-tag size="small" type="info" effect="plain" round>
                            {{ turnTotalTokens(turn) }} tokens
                          </el-tag>
                          <el-tag v-if="turnHasError(turn)" size="small" type="danger" effect="plain" round>含错误</el-tag>
                          <span class="group-time">{{ formatTime(turn.timestamp) }}</span>
                        </div>
                      </template>

                      <!-- 组内：卡片流 -->
                      <div class="card-flow">
                        <div
                          v-for="(row, idx) in turn.items"
                          :key="row.id"
                          class="interaction-card"
                          :class="{ 'has-error': !!row.error }"
                          @click="handleViewDetail(row)"
                        >
                          <div class="card-main">
                            <div class="card-top">
                              <span class="call-index">#{{ idx + 1 }}</span>
                              <el-tag
                                v-if="row.tool_name"
                                size="small"
                                type="warning"
                                effect="plain"
                              >
                                🔧 {{ row.tool_name }}
                              </el-tag>
                              <el-tag v-else size="small" type="info" effect="plain">LLM 调用</el-tag>
                              <el-tag
                                :type="row.error ? 'danger' : 'success'"
                                size="small"
                                effect="dark"
                                round
                              >
                                {{ row.error ? '错误' : '成功' }}
                              </el-tag>
                              <span class="card-model mono-text">{{ row.model || '-' }}</span>
                              <span class="card-time">{{ formatTime(row.created_at) }}</span>
                            </div>
                            <div class="card-summary">{{ briefSummary(row) }}</div>
                            <div class="card-meta">
                              <el-tag size="small" type="warning" effect="plain" round>
                                {{ row.total_tokens }} tokens
                              </el-tag>
                              <span class="mono-text">{{ row.elapsed_ms }}ms</span>
                            </div>
                          </div>
                          <div class="card-actions" @click.stop>
                            <RowActions
                              :items="recordActions()"
                              @command="(cmd: string) => onRecordCommand(cmd, row)"
                            />
                          </div>
                        </div>
                      </div>
                    </el-collapse-item>
                  </el-collapse>
                </el-collapse-item>
              </el-collapse>
            </el-collapse-item>
          </el-collapse>
        </div>

        <!-- 分页 -->
        <div v-if="total > pageSize" class="pagination-wrap">
          <el-pagination
            v-model:current-page="currentPage"
            :page-size="pageSize"
            :total="total"
            layout="prev, pager, next, total"
            background
            @current-change="handlePageChange"
          />
        </div>
      </div>
    </el-card>
      </el-tab-pane>

      <!-- 群聊讨论页签：以聊天气泡展示完整讨论、共识与最终方案 -->
      <el-tab-pane label="群聊讨论" name="group_chat">
        <el-card class="list-card" shadow="never">
          <div v-loading="chatLoading" class="list-container">
            <!-- 空状态 -->
            <div v-if="!chatLoading && chatGroups.length === 0" class="empty-state">
              <div class="empty-icon">
                <el-icon size="48"><ChatLineSquare /></el-icon>
              </div>
              <p class="empty-title">暂无群聊讨论记录</p>
             <span class="empty-hint">在「圆桌会议」中开展讨论后，完整讨论记录将按作品展示在这里</span>
           </div>

            <!-- 群聊分组：作品 → 讨论会话 -->
            <div v-else class="chat-groups">
              <div class="group-toolbar">
                <span class="group-hint">按作品列出讨论会话 · 展开查看完整讨论、共识与最终方案</span>
                <div class="group-toolbar-actions">
                  <el-button link type="primary" size="small" @click="expandAllChat">
                    <el-icon><Expand /></el-icon>展开全部
                  </el-button>
                  <el-button link type="info" size="small" @click="collapseAllChat">
                    <el-icon><Fold /></el-icon>收起全部
                  </el-button>
                </div>
              </div>

              <el-collapse v-model="expandedChatProjects" class="chat-projects-collapse">
                <el-collapse-item
                  v-for="grp in chatGroups"
                  :key="grp.key"
                  :name="grp.key"
                  class="chat-project-level"
                >
                  <template #title>
                    <div class="chat-project-header">
                      <el-icon class="group-icon"><Folder /></el-icon>
                      <span class="chat-project-name">{{ grp.projectName }}</span>
                      <el-tag size="small" type="warning" effect="dark" round>
                        {{ grp.sessions.length }} 场讨论
                      </el-tag>
                      <span class="group-time">{{ formatTime(grp.lastTime) }}</span>
                    </div>
                  </template>

                  <!-- 会话卡片 -->
                  <div class="chat-session-list">
                    <div v-for="s in grp.sessions" :key="s.id" class="chat-session-card">
                      <div class="chat-session-header" @click="toggleChatSession(s)">
                        <div class="chat-session-title-row">
                          <el-icon class="group-icon"><ChatLineSquare /></el-icon>
                          <span class="chat-session-topic">{{ s.topic }}</span>
                          <el-tag :type="chatStatusTagType(s.status)" size="small" effect="plain" round>
                            {{ chatStatusLabel(s.status) }}
                          </el-tag>
                          <span class="chat-session-meta">
                            {{ s.messages.length }} 条消息 · {{ s.members.length }} 名成员
                          </span>
                          <span class="group-time">{{ formatTime(s.updatedAt) }}</span>
                          <el-icon class="chat-arrow" :class="{ 'is-open': expandedChatSessions.includes(s.id) }">
                            <ArrowDown />
                          </el-icon>
                        </div>
                      </div>

                      <el-collapse-transition>
                        <div v-show="expandedChatSessions.includes(s.id)" class="chat-session-body">
                          <!-- 会话元信息 -->
                          <div class="chat-session-meta-row">
                            <span class="chat-meta-label">开始 {{ formatTime(s.createdAt) }}</span>
                            <span class="chat-meta-label">更新 {{ formatTime(s.updatedAt) }}</span>
                            <span class="chat-meta-label">{{ s.members.length }} 名成员</span>
                          </div>

                          <!-- 成员 -->
                          <div class="chat-member-row">
                            <div v-for="m in s.members" :key="m.id" class="chat-member-chip">
                              <span class="chat-member-avatar" :class="avatarClassFor(m)">{{ m.name.slice(0, 1) }}</span>
                              <span class="chat-member-name">{{ m.name }}</span>
                              <el-tag v-if="m.kind === 'author'" size="small" type="primary" effect="plain">作者</el-tag>
                              <el-tag v-else :type="chatCategoryTagType(m.category)" size="small" effect="plain">
                                {{ chatCategoryLabel(m.category) }}
                              </el-tag>
                            </div>
                          </div>

                          <!-- 消息气泡 -->
                          <div class="chat-msg-list">
                            <template v-for="msg in s.messages" :key="msg.id">
                              <div v-if="msg.kind === 'system'" class="system-message">
                                <div class="system-dot"></div>
                                <span class="system-text">{{ msg.content }}</span>
                              </div>
                              <div v-else-if="msg.kind === 'author'" class="message-row message-author">
                                <div class="bubble-author">
                                  <div class="bubble-meta">
                                    <span class="bubble-name">{{ msg.memberName }}</span>
                                    <span class="bubble-time">{{ formatTime(msg.timestamp) }}</span>
                                  </div>
                                  <div class="bubble-text" v-html="renderMarkdown(msg.content)"></div>
                                </div>
                              </div>
                              <div v-else class="message-row">
                                <div class="msg-avatar" :class="avatarClassFor(msg)">{{ msg.memberName.slice(0, 1) }}</div>
                                <div class="bubble-agent">
                                  <div class="bubble-meta">
                                    <span class="bubble-name">{{ msg.memberName }}</span>
                                    <el-tag :type="chatCategoryTagType(msg.category)" size="small" effect="plain">
                                      {{ chatCategoryLabel(msg.category) }}
                                    </el-tag>
                                    <span class="bubble-time">{{ formatTime(msg.timestamp) }}</span>
                                  </div>
                                  <div class="bubble-text" v-html="renderMarkdown(msg.content)"></div>
                                </div>
                              </div>
                            </template>
                          </div>

                          <!-- 共识节点 -->
                          <div v-if="s.consensusNodes && s.consensusNodes.length" class="chat-consensus-section">
                            <div class="chat-consensus-title">
                              <el-icon><Finished /></el-icon>
                              <span>共识演化（{{ s.consensusNodes.length }} 个节点）</span>
                            </div>
                            <div v-for="(node, idx) in s.consensusNodes" :key="idx" class="chat-consensus-node">
                              <el-tag size="small" :type="node.level >= 1 ? 'success' : 'warning'" effect="dark" round>
                                {{ Math.round((node.level || 0) * 100) }}%
                              </el-tag>
                              <span class="chat-consensus-msg">{{ node.message }}</span>
                            </div>
                          </div>

                          <!-- 最终方案 -->
                          <div v-if="s.summary" class="chat-summary-card">
                            <div class="chat-summary-title">
                              <el-icon><Document /></el-icon>
                              <span>最终方案</span>
                            </div>
                            <div class="chat-summary-text" v-html="renderMarkdown(s.summary)"></div>
                          </div>

                          <!-- LLM 调用记录 -->
                          <div class="chat-calls-section">
                            <div class="chat-calls-header" @click="toggleChatCalls(s)">
                              <el-icon><Connection /></el-icon>
                              <span>LLM 调用记录（{{ chatCalls[s.id]?.length || 0 }} 条）</span>
                              <el-icon class="chat-arrow" :class="{ 'is-open': chatCallsOpen[s.id] }"><ArrowDown /></el-icon>
                            </div>
                            <el-collapse-transition>
                              <div v-show="chatCallsOpen[s.id]" class="chat-calls-body">
                                <el-empty v-if="!(chatCalls[s.id]?.length)" description="暂无调用记录" :image-size="50" />
                                <div v-else class="chat-calls-list">
                                  <div
                                    v-for="(agg, idx) in chatCalls[s.id]"
                                    :key="agg.turn_id"
                                    class="chat-call-row"
                                    @click="handleViewDetail(agg.records[0])"
                                  >
                                    <span class="call-index">#{{ idx + 1 }}</span>
                                    <el-tag
                                      :type="agg.has_error ? 'danger' : 'success'"
                                      size="small"
                                      effect="dark"
                                      round
                                    >
                                      {{ agg.has_error ? '错误' : '成功' }}
                                    </el-tag>
                                    <span class="chat-call-member">{{ agg.records[0]?.member_name || agg.session_title }}</span>
                                    <span class="chat-call-preview">{{ briefSummary(agg.records[0]) }}</span>
                                    <span class="card-time">{{ formatTime(agg.timestamp) }}</span>
                                  </div>
                                </div>
                              </div>
                            </el-collapse-transition>
                          </div>
                        </div>
                      </el-collapse-transition>
                    </div>
                  </div>
                </el-collapse-item>
              </el-collapse>
            </div>
          </div>
        </el-card>
      </el-tab-pane>
    </el-tabs>
    <!-- 详情抽屉 -->
    <el-drawer
      v-model="detailVisible"
      title="交互记录详情"
      direction="rtl"
      size="65%"
      :destroy-on-close="true"
    >
      <div v-loading="detailLoading" class="detail-content">
        <template v-if="detail">
          <!-- 概览信息 -->
          <el-descriptions :column="2" border size="small" class="detail-desc">
            <el-descriptions-item label="标题">{{ detail.title || '无标题' }}</el-descriptions-item>
            <el-descriptions-item label="来源">
              <el-tag
                size="small"
                :type="detail.channel === 'group_chat' ? 'primary' : 'success'"
                effect="plain"
              >
                {{ detail.channel === 'group_chat' ? '群聊讨论' : getSourceLabel(detail.source) }}
              </el-tag>
            </el-descriptions-item>
            <el-descriptions-item label="模型">
              <span class="mono-text">{{ detail.model }}</span>
            </el-descriptions-item>
            <el-descriptions-item label="任务类型">{{ detail.task_type || '-' }}</el-descriptions-item>
            <el-descriptions-item label="Temperature">{{ detail.temperature }}</el-descriptions-item>
            <el-descriptions-item label="Max Tokens">{{ detail.max_tokens ?? '-' }}</el-descriptions-item>
            <el-descriptions-item label="finish_reason">{{ detail.finish_reason }}</el-descriptions-item>
            <el-descriptions-item label="耗时">{{ detail.elapsed_ms }} ms</el-descriptions-item>
            <el-descriptions-item label="prompt_tokens">{{ detail.prompt_tokens }}</el-descriptions-item>
            <el-descriptions-item label="completion_tokens">{{ detail.completion_tokens }}</el-descriptions-item>
            <el-descriptions-item label="total_tokens">
              <el-tag size="small" type="warning" effect="dark">{{ detail.total_tokens }}</el-tag>
            </el-descriptions-item>
            <el-descriptions-item label="时间">{{ formatTime(detail.created_at) }}</el-descriptions-item>
          </el-descriptions>

          <!-- 错误提示 -->
          <el-alert
            v-if="detail.error"
            type="error"
            :title="detail.error"
            show-icon
            :closable="false"
            class="detail-error"
          />

          <!-- 请求消息列表 -->
          <div class="detail-section">
            <div class="section-header">
              <el-icon><Promotion /></el-icon>
              <span>请求消息（{{ detail.messages?.length || 0 }} 条）</span>
            </div>
            <div class="messages-list">
              <div
                v-for="(msg, idx) in (detail.messages || [])"
                :key="idx"
                class="message-item"
              >
                <el-tag
                  :type="roleTagType(msg.role)"
                  size="small"
                  effect="dark"
                  class="message-role"
                  :class="{ 'role-assistant-tag': msg.role === 'assistant' }"
                >
                  {{ msg.role }}
                </el-tag>
                <div class="message-body">
                  <pre v-if="msg.content" class="message-content">{{ getMessageDisplay(msg.content, idx) }}</pre>
                  <div v-if="msg.function_call" class="function-call-block">
                    <el-tag size="small" type="warning" effect="plain">
                      {{ msg.function_call.name }}
                    </el-tag>
                    <pre class="message-content">{{ formatJson(msg.function_call.arguments) }}</pre>
                  </div>
                  <el-button
                    v-if="msg.content && msg.content.length > 500"
                    link
                    type="primary"
                    size="small"
                    @click="toggleMsg(idx)"
                  >
                    {{ expandedMsgs[idx] ? '收起' : '展开全部' }}
                  </el-button>
                </div>
              </div>
            </div>
          </div>

          <!-- 可用函数 -->
          <div v-if="detail.functions && detail.functions.length > 0" class="detail-section">
            <div class="section-header">
              <el-icon><Tools /></el-icon>
              <span>可用函数（{{ detail.functions.length }} 个）</span>
            </div>
            <div class="functions-list">
              <el-tag
                v-for="fn in detail.functions"
                :key="fn.name"
                size="small"
                type="warning"
                effect="plain"
              >
                {{ fn.name }}
              </el-tag>
            </div>
          </div>

          <!-- 响应内容 -->
          <div v-if="detail.response_content" class="detail-section">
            <div class="section-header">
              <el-icon><Download /></el-icon>
              <span>响应内容</span>
            </div>
            <pre class="message-content response-content">{{ detail.response_content }}</pre>
          </div>

          <!-- 响应函数调用 -->
          <div v-if="detail.response_function_call" class="detail-section">
            <div class="section-header">
              <el-icon><Tools /></el-icon>
              <span>响应函数调用</span>
            </div>
            <div class="function-call-block">
              <el-tag size="small" type="warning" effect="plain">
                {{ detail.response_function_call.name }}
              </el-tag>
              <pre class="message-content">{{ formatJson(detail.response_function_call.arguments) }}</pre>
            </div>
          </div>

          <!-- 工具执行结果 -->
          <div v-if="detail.tool_name" class="detail-section">
            <div class="section-header">
              <el-icon><Tools /></el-icon>
              <span>工具执行结果</span>
              <el-tag
                :type="detail.tool_success ? 'success' : 'danger'"
                size="small"
                effect="dark"
                round
                class="tool-status-tag"
              >
                {{ detail.tool_success ? '成功' : '失败' }}
              </el-tag>
            </div>
            <div class="tool-result-block">
              <div class="tool-info-row">
                <span class="tool-info-label">工具名称</span>
                <el-tag size="small" type="primary" effect="plain">{{ detail.tool_name }}</el-tag>
              </div>
              <div class="tool-info-row">
                <span class="tool-info-label">调用参数</span>
                <pre class="message-content tool-args-content">{{ formatJson(detail.tool_args) }}</pre>
              </div>
              <div class="tool-info-row">
                <span class="tool-info-label">执行结果</span>
                <pre
                  class="message-content"
                  :class="detail.tool_success ? 'tool-result-ok' : 'tool-result-err'"
                >{{ detail.tool_result }}</pre>
              </div>
            </div>
          </div>

          <!-- 删除按钮 -->
          <div class="detail-actions">
            <el-popconfirm
              title="确定删除这条记录吗？"
              confirm-button-text="删除"
              cancel-button-text="取消"
              confirm-button-type="danger"
              @confirm="handleDeleteFromDetail"
            >
              <template #reference>
                <el-button type="danger" plain>
                  <el-icon><Delete /></el-icon>
                  删除此记录
                </el-button>
              </template>
            </el-popconfirm>
          </div>
        </template>
      </div>
    </el-drawer>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { marked } from 'marked'
import DOMPurify from 'dompurify'
import RowActions, { type RowActionItem } from '@/components/RowActions.vue'
import PageHeader from '@/components/PageHeader.vue'
import {
  getAggregatedInteractions,
  getInteractionDetail,
  deleteInteraction,
  deleteSessionInteractions,
  clearInteractions,
  getProjects,
  getAgentSessions,
  listChatSessions,
  type Project,
  type AggregatedInteraction,
  type InteractionListItem,
  type InteractionDetail,
  type AgentRoleCategory,
  type ChatSessionSnapshot,
  type ChatSessionStatus,
} from '@/api'

/** 轮次：一次用户提问对应的一轮 LLM 交互（可能含多次工具调用） */
interface InteractionTurn {
  key: string
  turnId: string
  userMessage: string
  timestamp: string
  items: InteractionListItem[]
}

/** 会话：某个作品下的一次独立会话，含多轮交互 */
interface InteractionSession {
  key: string
  sessionId: string
  title: string
  turns: InteractionTurn[]
}

/** 作品：交互记录按作品聚合 */
interface InteractionProject {
  key: string
  projectId: string
  projectName: string
  sessions: InteractionSession[]
}

/** 群聊：作品下的一次讨论会话（含完整消息、共识、最终方案） */
interface ChatProjectGroup {
  key: string
  projectId: string
  projectName: string
  lastTime: string
  sessions: ChatSessionSnapshot[]
}

// 列表状态
const records = ref<AggregatedInteraction[]>([])
const projects = ref<Project[]>([])
/** 会话标题映射：project_id::session_id -> 会话标题 */
const sessionTitles = ref<Record<string, string>>({})
const total = ref(0)
const loading = ref(false)
const currentPage = ref(1)
const pageSize = ref(20)
// 详情状态
const detailVisible = ref(false)
const detailLoading = ref(false)
const detail = ref<InteractionDetail | null>(null)
const expandedMsgs = ref<Record<number, boolean>>({})

// 页签与群聊状态
const activeTab = ref<'agent' | 'group_chat'>('agent')
const chatLoading = ref(false)
const chatGroups = ref<ChatProjectGroup[]>([])
const expandedChatProjects = ref<string[]>([])
const expandedChatSessions = ref<string[]>([])
const chatCalls = ref<Record<string, AggregatedInteraction[]>>({})
const chatCallsOpen = ref<Record<string, boolean>>({})
const chatCallsLoading = ref<Record<string, boolean>>({})

/** 来源标签 */
const getSourceLabel = (source: string): string => {
  const map: Record<string, string> = {
    chat: '群聊讨论',
    chat_test: '聊天测试',
    chat_apply: '方案应用',
    stage1: '创意工作流',
  }
  return map[source] || source
}

/** 时间格式化 */
const formatTime = (iso: string): string => {
  if (!iso) return '-'
  try {
    const d = new Date(iso)
    return d.toLocaleString('zh-CN', {
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    })
  } catch {
    return iso
  }
}

/** Markdown 渲染 + 消毒 */
function renderMarkdown(text: string): string {
  if (!text) return ''
  const raw = marked.parse(text, { breaks: true }) as string
  return DOMPurify.sanitize(raw)
}

/** 群聊会话状态标签 */
const CHAT_STATUS_LABELS: Record<ChatSessionStatus, string> = {
  idle: '等待开始',
  running: '讨论中',
  synthesizing: '合成中',
  completed: '已完成',
  terminated: '已终止',
}

function chatStatusLabel(status: ChatSessionStatus): string {
  return CHAT_STATUS_LABELS[status] || status
}

function chatStatusTagType(status: ChatSessionStatus): 'success' | 'danger' | 'warning' | 'info' {
  if (status === 'completed') return 'success'
  if (status === 'terminated') return 'danger'
  if (status === 'running' || status === 'synthesizing') return 'warning'
  return 'info'
}

/** Agent 角色分类标签 */
function chatCategoryLabel(category?: AgentRoleCategory | string): string {
  const labels: Record<string, string> = {
    proposer: '提案者',
    synthesizer: '合成者',
    reviewer: '挑刺者',
  }
  if (!category) return ''
  return labels[category] || category
}

function chatCategoryTagType(category?: AgentRoleCategory | string): 'success' | 'warning' | 'info' {
  const types: Record<string, 'success' | 'warning' | 'info'> = {
    proposer: 'success',
    synthesizer: 'warning',
    reviewer: 'info',
  }
  if (!category) return 'info'
  return types[category] || 'info'
}

/** 头像配色：作者红 / 提案者绿 / 合成者橙 / 挑刺者灰 / 普通 Agent 蓝 */
function avatarClassFor(target: { kind?: string; category?: AgentRoleCategory }): string {
  if (target.kind === 'author') return 'avatar-author'
  if (target.category === 'proposer') return 'avatar-proposer'
  if (target.category === 'synthesizer') return 'avatar-synthesizer'
  if (target.category === 'reviewer') return 'avatar-reviewer'
  return 'avatar-agent'
}

/** 角色标签类型 */
const roleTagType = (role: string): 'primary' | 'success' | 'info' | 'warning' | 'danger' => {
  switch (role) {
    case 'system': return 'primary'
    case 'user': return 'success'
    case 'assistant': return 'info'
    case 'function': return 'warning'
    default: return 'info'
  }
}

/** 项目名映射：未关联作品时显示占位 */
function projectNameOf(projectId: string): string {
  if (!projectId) return '未关联作品'
  return projects.value.find((p) => p.id === projectId)?.name || '未关联作品'
}

/** 三级分组：作品 → 会话 → 轮次（基于服务端聚合的交互记录） */
const projectGroups = computed<InteractionProject[]>(() => {
  const projectsOut: InteractionProject[] = []
  const pmap = new Map<string, InteractionProject>()
  const smap = new Map<string, InteractionSession>()
  for (const item of records.value) {
    const pkey = item.project_id || 'unknown'
    const skey = pkey + '::' + (item.session_id || 'unknown')
    let pr = pmap.get(pkey)
    if (!pr) {
      pr = { key: pkey, projectId: item.project_id, projectName: projectNameOf(item.project_id), sessions: [] }
      pmap.set(pkey, pr)
      projectsOut.push(pr)
    }
    let s = smap.get(skey)
    if (!s) {
      const title =
        item.session_title ||
        sessionTitles.value[skey] ||
        item.user_message ||
        item.records[0]?.title ||
        '（无标题会话）'
      s = { key: skey, sessionId: item.session_id, title, turns: [] }
      smap.set(skey, s)
      pr.sessions.push(s)
    }
    s.turns.push({
      key: skey + '::' + (item.turn_id || item.records[0]?.id || 'single'),
      turnId: item.turn_id || '',
      userMessage: item.user_message || '',
      timestamp: item.timestamp || item.records[0]?.created_at || '',
      items: item.records || [],
    })
  }
  // 会话内轮次按时间倒序（最新在前）
  for (const pr of projectsOut) {
    for (const s of pr.sessions) {
      s.turns.sort((a, b) => (a.timestamp < b.timestamp ? 1 : -1))
    }
  }
  return projectsOut
})

/** 当前展开的分组 */
const activeGroups = ref<string[]>([])

/** 一组记录的总 tokens */
const groupTotalTokens = (items: InteractionListItem[]): number =>
  items.reduce((sum, i) => sum + (i.total_tokens || 0), 0)

/** 一组记录中是否有错误 */
const groupHasError = (items: InteractionListItem[]): boolean => items.some((i) => !!i.error)

const projectTotalTokens = (pr: InteractionProject): number =>
  groupTotalTokens(pr.sessions.flatMap((s) => s.turns.flatMap((t) => t.items)))
const projectHasError = (pr: InteractionProject): boolean =>
  pr.sessions.some((s) => s.turns.some((t) => groupHasError(t.items)))
const projectFirstTime = (pr: InteractionProject): string => pr.sessions[0]?.turns[0]?.timestamp || ''
const sessionTotalTokens = (s: InteractionSession): number =>
  groupTotalTokens(s.turns.flatMap((t) => t.items))
const sessionHasError = (s: InteractionSession): boolean => s.turns.some((t) => groupHasError(t.items))
const sessionFirstTime = (s: InteractionSession): string => s.turns[0]?.timestamp || ''
const turnTotalTokens = (t: InteractionTurn): number => groupTotalTokens(t.items)
const turnHasError = (t: InteractionTurn): boolean => groupHasError(t.items)

/** 会话 ID 缩写 */
const shortId = (id: string): string => {
  return id ? id.slice(0, 8) : ''
}

/** 展开全部 / 收起全部 */
const expandAllGroups = () => {
  activeGroups.value = projectGroups.value.flatMap((pr) => [
    pr.key,
    ...pr.sessions.flatMap((s) => [s.key, ...s.turns.map((t) => t.key)]),
  ])
}

const collapseAllGroups = () => {
  activeGroups.value = []
}

/** 简要展示 LLM 输出：工具结果优先，其次为响应文本 */
const briefSummary = (row: InteractionListItem): string => {
  const toolText = row.tool_result?.trim() || ''
  const respText = row.response_content?.trim() || ''
  const text = toolText || respText || row.title || ''
  const compact = text.replace(/\s+/g, ' ')
  return compact.length > 120 ? compact.slice(0, 120) + '...' : compact
}

/** 加载所有涉及项目的会话标题 */
const loadSessionTitles = async () => {
  const pids = new Set<string>()
  for (const r of records.value) {
    if (r.project_id) pids.add(r.project_id)
  }
  const titleMap: Record<string, string> = {}
  await Promise.all(
    Array.from(pids).map(async (pid) => {
      try {
        const { data } = await getAgentSessions(pid)
        for (const s of data.sessions) {
          titleMap[`${pid}::${s.id}`] = s.title
        }
      } catch {
        // 单个项目会话加载失败不影响整体
      }
    })
  )
  sessionTitles.value = titleMap
}

/** 加载列表数据 */
const loadList = async (expand = true) => {
  loading.value = true
  try {
    const offset = (currentPage.value - 1) * pageSize.value
    const [listRes, projectsRes] = await Promise.all([
      getAggregatedInteractions({ channel: 'agent', limit: pageSize.value, offset }),
      getProjects(),
    ])
    records.value = listRes.data.items
    total.value = listRes.data.total
    projects.value = projectsRes.data
    await loadSessionTitles()
    // 默认展开所有分组，方便查看层级关系
    if (expand) expandAllGroups()
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : '未知错误'
    ElMessage.error('加载列表失败: ' + msg)
  } finally {
    loading.value = false
  }
}

/** 刷新 */
const handleRefresh = () => {
  loadList()
}

/** 加载群聊会话列表：按作品聚合 */
const loadChatGroups = async () => {
  chatLoading.value = true
  try {
    const projectsRes = await getProjects()
    const groups: ChatProjectGroup[] = []
    await Promise.all(
      projectsRes.data.map(async (p) => {
        try {
          const { data } = await listChatSessions(p.id)
          if (!data.sessions || data.sessions.length === 0) return
          const sorted = [...data.sessions].sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1))
          groups.push({
            key: p.id,
            projectId: p.id,
            projectName: p.name,
            lastTime: sorted[0].updatedAt,
            sessions: sorted,
          })
        } catch {
          // 单个作品加载失败不影响整体
        }
      })
    )
    groups.sort((a, b) => (a.lastTime < b.lastTime ? 1 : -1))
    chatGroups.value = groups
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : '未知错误'
    ElMessage.error('加载群聊记录失败: ' + msg)
  } finally {
    chatLoading.value = false
  }
}

/** 展开 / 收起单个讨论会话 */
const toggleChatSession = (s: ChatSessionSnapshot) => {
  const idx = expandedChatSessions.value.indexOf(s.id)
  if (idx === -1) {
    expandedChatSessions.value.push(s.id)
  } else {
    expandedChatSessions.value.splice(idx, 1)
  }
}

/** 展开 / 收起某会话的 LLM 调用记录（首次展开时加载） */
const toggleChatCalls = async (s: ChatSessionSnapshot) => {
  if (!chatCallsOpen.value[s.id]) {
    chatCallsOpen.value[s.id] = true
    if (!chatCalls.value[s.id] && !chatCallsLoading.value[s.id]) {
      chatCallsLoading.value[s.id] = true
      try {
        const { data } = await getAggregatedInteractions({
          channel: 'group_chat',
          session_id: 'chat:' + s.id,
          limit: 200,
        })
        chatCalls.value[s.id] = data.items || []
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : '未知错误'
        ElMessage.error('加载 LLM 调用记录失败: ' + msg)
      } finally {
        chatCallsLoading.value[s.id] = false
      }
    }
  } else {
    chatCallsOpen.value[s.id] = false
  }
}

/** 展开全部群聊会话 */
const expandAllChat = () => {
  expandedChatProjects.value = chatGroups.value.map((g) => g.key)
  expandedChatSessions.value = chatGroups.value.flatMap((g) =>
    g.sessions.filter((s) => s.messages.length > 0).map((s) => s.id)
  )
}

/** 收起全部群聊会话 */
const collapseAllChat = () => {
  expandedChatProjects.value = []
  expandedChatSessions.value = []
  chatCallsOpen.value = {}
}

/** 页签切换：避免单 Agent 分组展开状态污染群聊页签 */
const handleTabChange = (name: string | number) => {
  if (name === 'group_chat') {
    loadChatGroups()
  }
}

/** 分页变化 */
const handlePageChange = () => {
  loadList()
}

/** 查看详情 */
const handleViewDetail = async (row: InteractionListItem) => {
  detailVisible.value = true
  detailLoading.value = true
  detail.value = null
  expandedMsgs.value = {}
  try {
    const { data } = await getInteractionDetail(row.id)
    detail.value = data
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : '未知错误'
    ElMessage.error('加载详情失败: ' + msg)
    detailVisible.value = false
  } finally {
    detailLoading.value = false
  }
}

/** 删除单条 */
const handleDelete = async (row: InteractionListItem) => {
  try {
    await deleteInteraction(row.id)
    ElMessage.success('记录已删除')
    // 如果当前页删空了，回到上一页
    if (records.value.length === 1 && currentPage.value > 1) {
      currentPage.value--
    }
    loadList()
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : '未知错误'
    ElMessage.error('删除失败: ' + msg)
  }
}

/** 删除整个会话的所有交互记录 */
const handleDeleteSession = async (s: InteractionSession) => {
  if (!s.sessionId) {
    ElMessage.warning('该分组没有会话标识，无法按会话删除')
    return
  }
  try {
    const { data } = await deleteSessionInteractions(s.sessionId)
    ElMessage.success(data.message || `已删除该会话的 ${data.deleted_count ?? 0} 条记录`)
    loadList()
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : '未知错误'
    ElMessage.error('删除会话记录失败: ' + msg)
  }
}

/** 会话三点菜单 */
function sessionActions(): RowActionItem[] {
  return [
    { command: 'delete', label: '删除整个会话', icon: 'Delete', type: 'danger' },
  ]
}

async function onSessionCommand(cmd: string, s: InteractionSession) {
  if (cmd !== 'delete') return
  try {
    await ElMessageBox.confirm(
      '删除该会话下的全部交互记录？此操作不可恢复。',
      '删除会话',
      { type: 'warning', confirmButtonText: '删除会话', cancelButtonText: '取消' }
    )
  } catch {
    return
  }
  handleDeleteSession(s)
}

/** 记录行三点菜单 */
function recordActions(): RowActionItem[] {
  return [
    { command: 'view', label: '查看详情', icon: 'View' },
    { command: 'delete', label: '删除记录', icon: 'Delete', type: 'danger', divided: true },
  ]
}

async function onRecordCommand(cmd: string, row: InteractionListItem) {
  if (cmd === 'view') {
    handleViewDetail(row)
    return
  }
  if (cmd !== 'delete') return
  try {
    await ElMessageBox.confirm(
      '确定删除这条记录吗？此操作不可恢复。',
      '删除记录',
      { type: 'warning', confirmButtonText: '删除', cancelButtonText: '取消' }
    )
  } catch {
    return
  }
  handleDelete(row)
}

/** 从详情抽屉中删除 */
const handleDeleteFromDetail = async () => {
  if (!detail.value) return
  try {
    await deleteInteraction(detail.value.id)
    ElMessage.success('记录已删除')
    detailVisible.value = false
    if (records.value.length === 1 && currentPage.value > 1) {
      currentPage.value--
    }
    loadList()
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : '未知错误'
    ElMessage.error('删除失败: ' + msg)
  }
}

/** 清空全部 */
const handleClearAll = async () => {
  try {
    const { data } = await clearInteractions(undefined)
    ElMessage.success(data.message)
    currentPage.value = 1
    loadList()
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : '未知错误'
    ElMessage.error('清空失败: ' + msg)
  }
}

/** 消息展开/收起 */
const toggleMsg = (idx: number) => {
  expandedMsgs.value[idx] = !expandedMsgs.value[idx]
}

/** 消息展示（超长折叠） */
const getMessageDisplay = (content: string, idx: number): string => {
  if (content.length <= 500) return content
  return expandedMsgs.value[idx] ? content : content.slice(0, 500) + '\n...'
}

/** JSON 格式化 */
const formatJson = (value: string | Record<string, any> | null | undefined): string => {
  if (value === null || value === undefined || value === '') return ''
  if (typeof value === 'string') {
    try {
      return JSON.stringify(JSON.parse(value), null, 2)
    } catch {
      return value
    }
  }
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}

  // 实时刷新：每 5 秒拉取一次，新产生的交互记录自动出现（不打断用户的分组展开状态）
  let refreshTimer: number | undefined
  onMounted(() => {
    loadList()
    loadChatGroups()
    refreshTimer = window.setInterval(() => loadList(false), 5000)
  })
  onBeforeUnmount(() => {
    if (refreshTimer !== undefined) window.clearInterval(refreshTimer)
  })
</script>

<style scoped>
.interactions-view {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

/* ====== 工具栏 ====== */
.toolbar-card :deep(.el-card__body) {
  padding: 14px 20px;
}

.toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
}

.toolbar-left {
  display: flex;
  align-items: center;
  gap: 8px;
}

.toolbar-icon {
  color: var(--app-primary);
  font-size: 18px;
}

.toolbar-title {
  font-size: 16px;
  font-weight: 600;
  color: var(--text-primary);
}

.toolbar-right {
  display: flex;
  align-items: center;
  gap: 8px;
}

/* ====== 列表 ====== */
.list-card :deep(.el-card__body) {
  padding: 20px;
}

.list-container {
  min-height: 300px;
}

/* 空状态 */
.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 60px 20px;
  color: var(--text-placeholder);
  gap: 10px;
}

.empty-icon {
  width: 80px;
  height: 80px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  background: linear-gradient(135deg, #fff3e0 0%, #ffe0e0 100%);
  color: #e6a23c;
  margin-bottom: 6px;
}

.empty-title {
  margin: 0;
  font-size: 15px;
  font-weight: 500;
  color: var(--text-regular);
}

.empty-hint {
  font-size: 12px;
  color: var(--text-placeholder);
}

/* 分组展示 */
.group-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 16px;
  padding-bottom: 12px;
  border-bottom: 1px solid var(--border-color-light);
  flex-wrap: wrap;
  gap: 6px;
}

.group-hint {
  font-size: 12px;
  color: var(--text-placeholder);
}

.group-toolbar-actions {
  display: flex;
  gap: 4px;
}

.groups-collapse {
  border: none;
}

.groups-collapse :deep(.el-collapse-item) {
  margin-bottom: 16px;
}

.groups-collapse :deep(.el-collapse-item__header) {
  height: auto;
  min-height: 48px;
  line-height: 1.4;
  padding: 10px 14px;
  background: var(--content-bg);
  border-radius: 8px;
  border: 1px solid var(--border-color-light);
  margin-bottom: 8px;
}

.groups-collapse :deep(.el-collapse-item__header.is-active) {
  border-color: rgba(99, 102, 241, 0.4);
}

.groups-collapse :deep(.el-collapse-item__wrap) {
  border-bottom: none;
  overflow: visible;
}

.groups-collapse :deep(.el-collapse-item__content) {
  padding-bottom: 4px;
}

.group-header {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  width: 100%;
  padding-right: 32px;
}

.group-icon {
  color: var(--app-primary);
  flex-shrink: 0;
}

.group-trigger {
  font-weight: 600;
  font-size: 13px;
  color: var(--text-primary);
  min-width: 0;
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.group-time {
  font-size: 12px;
  color: var(--text-secondary);
  white-space: nowrap;
}

.call-index {
  font-family: 'Consolas', monospace;
  font-size: 12px;
  color: var(--text-secondary);
}

.output-summary {
  font-size: 12px;
  color: var(--text-regular);
  line-height: 1.5;
}

.muted-text {
  color: var(--text-placeholder);
  font-size: 12px;
}

/* ====== 记录卡片流 ====== */
.card-flow {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 8px 2px;
}

.interaction-card {
  display: flex;
  align-items: flex-start;
  gap: 14px;
  border: 1px solid var(--border-color-light);
  border-radius: 10px;
  padding: 14px 16px;
  background: var(--card-bg);
  cursor: pointer;
  transition: all var(--transition-base);
}

.interaction-card:hover {
  border-color: rgba(99, 102, 241, 0.4);
  box-shadow: var(--card-shadow);
  transform: translateY(-1px);
}

.interaction-card.has-error {
  border-left: 3px solid var(--app-danger);
}

.card-main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.card-top {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.card-model {
  font-size: 12px;
  color: var(--text-secondary);
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.card-time {
  font-size: 12px;
  color: var(--text-placeholder);
  white-space: nowrap;
}

.card-summary {
  font-size: 12px;
  color: var(--text-regular);
  line-height: 1.5;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  word-break: break-word;
}

.card-meta {
  display: flex;
  align-items: center;
  gap: 10px;
}

.card-actions {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-shrink: 0;
}

/* 标题单元格 */
.title-cell {
  display: flex;
  align-items: center;
  gap: 8px;
}

.title-icon {
  flex-shrink: 0;
  font-size: 15px;
}

.title-icon.source-chat {
  color: var(--app-primary);
}

.title-icon.source-stage1 {
  color: var(--el-color-success);
}

.title-text {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.mono-text {
  font-family: 'Consolas', 'Monaco', 'Courier New', monospace;
  font-size: 12px;
  color: var(--text-regular);
}

.time-text {
  font-size: 12px;
  color: var(--text-secondary);
}

/* 分页 */
.pagination-wrap {
  display: flex;
  justify-content: center;
  padding: 16px 0;
}

/* ====== 详情抽屉 ====== */
.detail-content {
  padding: 0 20px 20px;
}

.detail-desc {
  margin-bottom: 16px;
}

.detail-error {
  margin-bottom: 16px;
}

.detail-section {
  margin-bottom: 20px;
}

.section-header {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 14px;
  font-weight: 600;
  color: var(--text-primary);
  margin-bottom: 10px;
  padding-bottom: 6px;
  border-bottom: 1px solid var(--border-color-light);
}

.section-header .el-icon {
  color: var(--app-primary);
}

.messages-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.message-item {
  display: flex;
  gap: 10px;
  align-items: flex-start;
}

.message-role {
  flex-shrink: 0;
  min-width: 70px;
  text-align: center;
}

/* assistant 角色标签覆盖为紫色 */
.message-role.role-assistant-tag {
  background-color: #9c27b0 !important;
  border-color: #9c27b0 !important;
  color: #fff !important;
}

.message-body {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.message-content {
  margin: 0;
  padding: 10px 12px;
  background: #f5f5f7;
  border: 1px solid #ebeef5;
  border-radius: 6px;
  font-size: 12px;
  line-height: 1.6;
  color: var(--text-regular);
  font-family: 'Consolas', 'Monaco', 'Courier New', monospace;
  white-space: pre-wrap;
  word-break: break-word;
  max-height: 400px;
  overflow-y: auto;
}

.response-content {
  background: #f0f9eb;
  border-color: #e1f3d8;
}

.function-call-block {
  display: flex;
  flex-direction: column;
  gap: 6px;
  align-items: flex-start;
}

.functions-list {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
}

.detail-actions {
  margin-top: 24px;
  padding-top: 16px;
  border-top: 1px solid var(--border-color-light);
  display: flex;
  justify-content: center;
}

/* 工具执行结果 */
.tool-status-tag {
  margin-left: 4px;
}

.tool-result-block {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.tool-info-row {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.tool-info-label {
  font-size: 12px;
  color: var(--text-secondary);
  font-weight: 500;
}

.tool-args-content {
  background: #fdf6ec;
  border-color: #faecd8;
}

.tool-result-ok {
  background: #f0f9eb;
  border-color: #e1f3d8;
}

.tool-result-err {
  background: #fef0f0;
  border-color: #fde2e2;
}

/* ====== 三级分组样式 ====== */
.three-level-collapse :deep(.project-level > .el-collapse-item__header) {
  background: linear-gradient(135deg, #f8fafc 0%, #f1f5f9 100%);
  font-weight: 600;
}

.three-level-collapse :deep(.project-level > .el-collapse-item__wrap) {
  padding-left: 16px;
  border-left: 2px solid var(--app-primary);
  margin-left: 8px;
}

.session-collapse :deep(.session-level > .el-collapse-item__header) {
  background: #fafbfc;
}

.session-collapse :deep(.session-level > .el-collapse-item__wrap) {
  padding-left: 12px;
  border-left: 1px solid var(--border-color-light);
  margin-left: 6px;
}

.turn-collapse :deep(.turn-level > .el-collapse-item__header) {
  background: #fff;
}

.project-header {
  font-size: 14px;
}

.session-header {
  font-size: 13px;
}

.turn-header {
  font-size: 12px;
}

/* ====== 群聊页签（会话卡片 + 聊天气泡） ====== */
.interaction-tabs :deep(.el-tabs__nav-wrap) {
  margin-bottom: 4px;
}

.chat-projects-collapse {
  border: none;
}

.chat-projects-collapse :deep(.el-collapse-item__header) {
  height: auto;
  min-height: 46px;
  line-height: 1.4;
  padding: 10px 14px;
  background: linear-gradient(135deg, #f8fafc 0%, #f1f5f9 100%);
  border-radius: 8px;
  border: 1px solid var(--border-color-light);
  margin-bottom: 8px;
}

.chat-projects-collapse :deep(.el-collapse-item__wrap) {
  border-bottom: none;
  background: transparent;
}

.chat-projects-collapse :deep(.el-collapse-item__content) {
  padding-bottom: 8px;
}

.chat-project-header {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding-right: 32px;
}

.chat-project-name {
  font-weight: 600;
  font-size: 14px;
  color: var(--text-primary);
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.chat-session-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 4px 2px 4px 14px;
}

.chat-session-card {
  border: 1px solid var(--border-color-light);
  border-radius: 10px;
  background: var(--card-bg);
  overflow: hidden;
  transition: border-color var(--transition-base);
}

.chat-session-card:hover {
  border-color: rgba(99, 102, 241, 0.4);
}

.chat-session-header {
  cursor: pointer;
  padding: 12px 14px;
  user-select: none;
}

.chat-session-title-row {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.chat-session-topic {
  font-weight: 600;
  font-size: 13px;
  color: var(--text-primary);
  flex: 1;
  min-width: 120px;
  overflow-wrap: anywhere;
}

.chat-session-meta {
  font-size: 12px;
  color: var(--text-secondary);
  white-space: nowrap;
}

.chat-arrow {
  color: var(--text-placeholder);
  transition: transform var(--transition-base);
}

.chat-arrow.is-open {
  transform: rotate(180deg);
  color: var(--app-primary);
}

.chat-session-body {
  border-top: 1px dashed var(--border-color-light);
  padding: 14px;
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.chat-session-meta-row {
  display: flex;
  gap: 12px;
  flex-wrap: wrap;
}

.chat-meta-label {
  font-size: 12px;
  color: var(--text-placeholder);
}

/* 成员 chips */
.chat-member-row {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}

.chat-member-chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 4px 10px 4px 4px;
  border: 1px solid var(--border-color-light);
  border-radius: 999px;
  background: var(--content-bg);
  font-size: 12px;
}

.chat-member-avatar {
  width: 26px;
  height: 26px;
  border-radius: 50%;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: #fff;
  font-size: 12px;
  flex-shrink: 0;
}

.chat-member-name {
  font-weight: 500;
  color: var(--text-primary);
}

.avatar-proposer { background: linear-gradient(135deg, #10B981, #059669); }
.avatar-synthesizer { background: linear-gradient(135deg, #F59E0B, #D97706); }
.avatar-reviewer { background: linear-gradient(135deg, #64748B, #475569); }
.avatar-agent { background: linear-gradient(135deg, #4F46E5, #2563EB); }
.avatar-author { background: linear-gradient(135deg, #EF4444, #DC2626); }

/* 消息气泡 */
.chat-msg-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.system-message {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  color: var(--text-aux, var(--text-placeholder));
  font-size: 12px;
  padding: 2px 0;
}

.system-dot {
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: var(--text-placeholder);
}

.system-text {
  max-width: 88%;
  text-align: center;
  overflow-wrap: anywhere;
}

.message-row {
  display: flex;
  align-items: flex-start;
  gap: 10px;
}

.message-row.message-author {
  justify-content: flex-end;
}

.msg-avatar {
  width: 32px;
  height: 32px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #fff;
  font-size: 13px;
  flex-shrink: 0;
}

.bubble-agent {
  background: var(--surface, var(--content-bg));
  border: 1px solid var(--border-color-light);
  border-radius: 10px;
  padding: 10px 14px;
  max-width: 82%;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.04);
}

.bubble-author {
  background: var(--app-primary);
  color: #fff;
  border-radius: 10px;
  padding: 10px 14px;
  max-width: 82%;
}

.bubble-meta {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 6px;
  flex-wrap: wrap;
}

.bubble-name {
  font-weight: 600;
  font-size: 12px;
}

.bubble-time {
  font-size: 12px;
  color: var(--text-placeholder);
  margin-left: auto;
}

.bubble-author .bubble-time {
  color: rgba(255, 255, 255, 0.75);
}

.bubble-text {
  font-size: 13px;
  line-height: 1.6;
  word-break: break-word;
}

.bubble-text :deep(p) {
  margin: 0 0 8px;
}

.bubble-text :deep(p:last-child) {
  margin-bottom: 0;
}

/* 共识节点 */
.chat-consensus-section {
  border: 1px dashed #e6a23c;
  border-radius: 10px;
  padding: 12px 14px;
  background: #fdf9ef;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.chat-consensus-title,
.chat-summary-title {
  display: flex;
  align-items: center;
  gap: 6px;
  font-weight: 600;
  font-size: 13px;
  color: var(--text-primary);
}

.chat-consensus-node {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
}

.chat-consensus-msg {
  flex: 1;
  min-width: 0;
  color: var(--text-regular);
  overflow-wrap: anywhere;
}

/* 最终方案 */
.chat-summary-card {
  border: 1px solid #e1f3d8;
  border-radius: 10px;
  padding: 12px 14px;
  background: #f6ffed;
}

.chat-summary-text {
  margin-top: 8px;
  font-size: 13px;
  line-height: 1.7;
  color: var(--text-primary);
  word-break: break-word;
}

/* LLM 调用记录 */
.chat-calls-section {
  border: 1px solid var(--border-color-light);
  border-radius: 10px;
  overflow: hidden;
}

.chat-calls-header {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 10px 14px;
  cursor: pointer;
  font-size: 13px;
  font-weight: 500;
  color: var(--text-primary);
  user-select: none;
  background: var(--content-bg);
}

.chat-calls-header .el-icon:first-child {
  color: var(--app-primary);
}

.chat-calls-header span {
  flex: 1;
}

.chat-calls-body {
  padding: 8px 14px 12px;
  border-top: 1px solid var(--border-color-light);
}

.chat-calls-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.chat-call-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 7px 10px;
  border: 1px solid var(--border-color-light);
  border-radius: 8px;
  background: var(--card-bg);
  cursor: pointer;
  transition: border-color var(--transition-base), background var(--transition-base);
  flex-wrap: wrap;
}

.chat-call-row:hover {
  border-color: rgba(99, 102, 241, 0.4);
  background: var(--content-bg);
}

.chat-call-member {
  font-size: 12px;
  font-weight: 500;
  color: var(--text-primary);
  white-space: nowrap;
}

.chat-call-preview {
  flex: 1;
  min-width: 100px;
  font-size: 12px;
  color: var(--text-secondary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
