<template>
  <div class="interactions-view">
    <!-- 顶部工具栏 -->
    <el-card class="toolbar-card" shadow="never">
      <div class="toolbar">
        <div class="toolbar-left">
          <el-icon class="toolbar-icon"><Document /></el-icon>
          <span class="toolbar-title">LLM 交互记录</span>
          <el-tag size="small" type="info" effect="plain" round>
            共 {{ total }} 条
          </el-tag>
        </div>
        <div class="toolbar-right">
          <el-select
            v-model="filterSource"
            placeholder="全部来源"
            clearable
            style="width: 140px"
            @change="handleFilterChange"
          >
            <el-option label="聊天测试" value="chat" />
            <el-option label="创意工作流" value="stage1" />
          </el-select>
          <el-button @click="handleRefresh" :loading="loading">
            <el-icon><Refresh /></el-icon>
            <span>刷新</span>
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
                <el-icon><Delete /></el-icon>
                <span>清空全部</span>
              </el-button>
            </template>
          </el-popconfirm>
        </div>
      </div>
    </el-card>

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
              按会话分组展示，每条记录可独立删除
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

          <el-collapse v-model="activeGroups" class="groups-collapse">
            <el-collapse-item
              v-for="g in groupedRecords"
              :key="g.key"
              :name="g.key"
            >
              <template #title>
                <div class="group-header">
                  <el-icon class="group-icon"><ChatLineSquare /></el-icon>
                  <span class="group-trigger">
                    {{ g.userMessage || g.items[0]?.title || '（无触发消息）' }}
                  </span>
                  <el-tag size="small" type="warning" effect="dark" round>
                    {{ g.items.length }} 次调用
                  </el-tag>
                  <el-tag size="small" type="info" effect="plain" round>
                    {{ groupTotalTokens(g) }} tokens
                  </el-tag>
                  <el-tag
                    v-if="groupHasError(g)"
                    size="small"
                    type="danger"
                    effect="plain"
                    round
                  >
                    含错误
                  </el-tag>
                  <el-tag v-if="g.sessionId" size="small" type="primary" effect="plain" round>
                    会话 {{ shortId(g.sessionId) }}
                  </el-tag>
                  <span class="group-time">{{ formatTime(g.timestamp) }}</span>
                  <RowActions
                    class="row-actions"
                    :items="sessionActions()"
                    @command="(cmd: string) => onSessionCommand(cmd, g)"
                  />
                </div>
              </template>

              <!-- 组内：卡片流 -->
              <div class="card-flow">
                <div
                  v-for="(row, idx) in g.items"
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
              <el-tag size="small" :type="detail.source === 'chat' ? 'primary' : 'success'" effect="plain">
                {{ getSourceLabel(detail.source) }}
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
import { ref, computed, onMounted } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import RowActions, { type RowActionItem } from '@/components/RowActions.vue'
import {
  getInteractions,
  getInteractionDetail,
  deleteInteraction,
  deleteSessionInteractions,
  clearInteractions,
  type InteractionListItem,
  type InteractionDetail,
} from '@/api'

/** 按会话/轮次分组的记录组 */
interface InteractionGroup {
  key: string
  userMessage: string
  timestamp: string
  sessionId: string
  turnId: string
  items: InteractionListItem[]
}

// 列表状态
const records = ref<InteractionListItem[]>([])
const total = ref(0)
const loading = ref(false)
const currentPage = ref(1)
const pageSize = ref(20)
const filterSource = ref<string>('')

// 详情状态
const detailVisible = ref(false)
const detailLoading = ref(false)
const detail = ref<InteractionDetail | null>(null)
const expandedMsgs = ref<Record<number, boolean>>({})

/** 来源标签 */
const getSourceLabel = (source: string): string => {
  const map: Record<string, string> = {
    chat: '聊天测试',
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

/** 分组：同一会话的同一轮（session_id + turn_id）的多次调用归为一组 */
const groupedRecords = computed<InteractionGroup[]>(() => {
  const groups: InteractionGroup[] = []
  const map = new Map<string, InteractionGroup>()
  for (const item of records.value) {
    const key =
      item.session_id && item.turn_id
        ? `${item.session_id}::${item.turn_id}`
        : `single::${item.id}`
    let g = map.get(key)
    if (!g) {
      g = {
        key,
        userMessage: item.user_message || '',
        timestamp: item.created_at,
        sessionId: item.session_id,
        turnId: item.turn_id,
        items: [],
      }
      map.set(key, g)
      groups.push(g)
    }
    g.items.push(item)
  }
  return groups
})

/** 当前展开的分组 */
const activeGroups = ref<string[]>([])

/** 组内总 tokens */
const groupTotalTokens = (g: InteractionGroup): number => {
  return g.items.reduce((sum, i) => sum + (i.total_tokens || 0), 0)
}

/** 组内是否有错误 */
const groupHasError = (g: InteractionGroup): boolean => {
  return g.items.some((i) => !!i.error)
}

/** 会话 ID 缩写 */
const shortId = (id: string): string => {
  return id ? id.slice(0, 8) : ''
}

/** 展开全部 / 收起全部 */
const expandAllGroups = () => {
  activeGroups.value = groupedRecords.value.map((g) => g.key)
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

/** 加载列表数据 */
const loadList = async () => {
  loading.value = true
  try {
    const offset = (currentPage.value - 1) * pageSize.value
    const { data } = await getInteractions(
      filterSource.value || undefined,
      pageSize.value,
      offset
    )
    records.value = data.items
    total.value = data.total
    // 默认展开所有分组，方便查看层级关系
    expandAllGroups()
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

/** 筛选变化 */
const handleFilterChange = () => {
  currentPage.value = 1
  loadList()
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
const handleDeleteSession = async (g: InteractionGroup) => {
  if (!g.sessionId) {
    ElMessage.warning('该分组没有会话标识，无法按会话删除')
    return
  }
  try {
    const { data } = await deleteSessionInteractions(g.sessionId)
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

async function onSessionCommand(cmd: string, g: InteractionGroup) {
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
  handleDeleteSession(g)
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
    const { data } = await clearInteractions(filterSource.value || undefined)
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

onMounted(() => {
  loadList()
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
  border-color: rgba(79, 140, 255, 0.4);
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
  border-color: rgba(79, 140, 255, 0.4);
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
  background: #f5f7fa;
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
</style>
