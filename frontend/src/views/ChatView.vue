<template>
  <div class="chat-view">
    <!-- 顶部可折叠参数面板 -->
    <el-collapse v-model="activeParams" class="params-collapse">
      <el-collapse-item name="params">
        <template #title>
          <div class="collapse-title">
            <el-icon class="collapse-icon"><Setting /></el-icon>
            <span>参数配置</span>
            <el-tag size="small" type="info" effect="plain" round class="collapse-tag">
              {{ getTaskLabel(taskType) }} · T={{ temperature }} · Max={{ maxTokens }}
            </el-tag>
          </div>
        </template>
        <div class="params-row">
          <div class="param-item">
            <span class="param-label">任务类型</span>
            <el-select v-model="taskType" style="width: 150px">
              <el-option label="文本生成" value="text" />
              <el-option label="结构化输出" value="structure" />
              <el-option label="检查校验" value="check" />
            </el-select>
          </div>
          <div class="param-item">
            <span class="param-label">Temperature</span>
            <el-slider
              v-model="temperature"
              :min="0"
              :max="2"
              :step="0.1"
              style="width: 160px"
            />
            <el-input-number
              v-model="temperature"
              :min="0"
              :max="2"
              :step="0.1"
              :precision="1"
              size="small"
              style="width: 90px"
            />
          </div>
          <div class="param-item">
            <span class="param-label">Max Tokens</span>
            <el-input-number
              v-model="maxTokens"
              :min="1"
              :max="100000"
              style="width: 130px"
            />
          </div>
          <div class="param-item param-toggle">
            <span class="param-label">交互记录</span>
            <el-switch v-model="showInteraction" inline-prompt active-text="开" inactive-text="关" />
          </div>
        </div>
      </el-collapse-item>
    </el-collapse>

    <!-- 消息列表区 -->
    <div class="messages-card">
      <div ref="messagesContainer" class="messages-container">
        <div v-if="messages.length === 0" class="empty-state">
          <div class="empty-icon">
            <el-icon size="44"><ChatLineSquare /></el-icon>
          </div>
          <p class="empty-title">开始一段新的对话</p>
          <span class="empty-hint">在下方输入消息，支持 Ctrl+Enter 发送</span>
        </div>

        <div
          v-for="(msg, idx) in messages"
          :key="idx"
          class="message-row"
          :class="`row-${msg.role}`"
        >
          <!-- system 消息：居中黄色标签 -->
          <div v-if="msg.role === 'system'" class="message-system">
            <el-tag type="warning" effect="dark" size="default" round>
              <el-icon class="tag-icon"><WarnTriangleFilled /></el-icon>
              System: {{ msg.content }}
            </el-tag>
          </div>

          <!-- user / assistant 消息：气泡 -->
          <template v-else>
            <div class="message-avatar" :class="`avatar-${msg.role}`">
              <el-icon size="18">
                <User v-if="msg.role === 'user'" />
                <Monitor v-else />
              </el-icon>
            </div>
            <div class="message-bubble-wrap">
              <div class="message-bubble" :class="`bubble-${msg.role}`">
                <pre>{{ msg.content }}<span
                  v-if="streaming && idx === messages.length - 1 && msg.role === 'assistant'"
                  class="typing-cursor"
                ></span></pre>
              </div>
              <!-- AI 消息下方的元信息标签 -->
              <div
                v-if="msg.role === 'assistant' && msg.meta"
                class="message-meta"
              >
                <el-tag size="small" type="primary" effect="plain" round>
                  <el-icon class="tag-icon"><Cpu /></el-icon>
                  {{ msg.meta.model || '未知模型' }}
                </el-tag>
                <el-tag size="small" type="success" effect="plain" round>
                  <el-icon class="tag-icon"><Timer /></el-icon>
                  {{ msg.meta.elapsed_ms }} ms
                </el-tag>
                <el-tag size="small" type="info" effect="plain" round>
                  入 {{ msg.meta.prompt_tokens }}
                </el-tag>
                <el-tag size="small" type="info" effect="plain" round>
                  出 {{ msg.meta.completion_tokens }}
                </el-tag>
                <el-tag size="small" type="warning" effect="plain" round>
                  总 {{ msg.meta.total_tokens }}
                </el-tag>
                <!-- 切换交互详情 -->
                <el-button
                  v-if="showInteraction && msg.interaction"
                  link
                  type="primary"
                  size="small"
                  class="meta-toggle-btn"
                  @click="toggleInteractionPanel(idx)"
                >
                  <el-icon><View /></el-icon>
                  {{ openInteractionPanels.includes(idx) ? '收起交互' : '查看交互' }}
                </el-button>
              </div>

              <!-- LLM 底层交互详情面板 -->
              <div
                v-if="showInteraction && msg.interaction && openInteractionPanels.includes(idx)"
                class="interaction-panel"
              >
                <div class="interaction-panel-header">
                  <el-icon class="panel-icon"><Monitor /></el-icon>
                  <span class="panel-title">LLM 底层交互记录</span>
                  <el-tag size="small" type="primary" effect="plain">{{ msg.interaction.model }}</el-tag>
                  <el-tag size="small" type="info" effect="plain">{{ msg.interaction.elapsed_ms }} ms</el-tag>
                  <el-tag size="small" type="warning" effect="plain">{{ msg.interaction.total_tokens }} tokens</el-tag>
                  <el-tag v-if="msg.interaction.error" size="small" type="danger" effect="dark">错误</el-tag>
                </div>

                <!-- 错误提示 -->
                <el-alert
                  v-if="msg.interaction.error"
                  type="error"
                  :title="msg.interaction.error"
                  show-icon
                  :closable="false"
                  class="interaction-error"
                />

                <!-- 请求部分 -->
                <div class="interaction-section">
                  <div class="section-label">📤 请求</div>
                  <div class="params-row">
                    <el-tag size="small" type="info" effect="plain">
                      temperature: {{ msg.interaction.temperature }}
                    </el-tag>
                    <el-tag v-if="msg.interaction.max_tokens !== null" size="small" type="info" effect="plain">
                      max_tokens: {{ msg.interaction.max_tokens }}
                    </el-tag>
                    <el-tag size="small" type="info" effect="plain">
                      function_call: {{ formatFunctionCall(msg.interaction.function_call) }}
                    </el-tag>
                  </div>

                  <!-- 消息列表 -->
                  <div class="messages-list">
                    <div
                      v-for="(imsg, mIdx) in msg.interaction.messages"
                      :key="mIdx"
                      class="message-item"
                    >
                      <el-tag
                        :type="roleTagType(imsg.role)"
                        size="small"
                        effect="dark"
                        class="message-role"
                        :class="{ 'role-assistant-tag': imsg.role === 'assistant' }"
                      >
                        {{ imsg.role }}
                      </el-tag>
                      <div class="message-body">
                        <pre v-if="imsg.content" class="message-content">{{
                          getMessageDisplay(imsg.content, idx, mIdx)
                        }}</pre>
                        <div v-if="imsg.function_call" class="function-call-block">
                          <el-tag size="small" type="warning" effect="plain">
                            🔧 {{ imsg.function_call.name }}
                          </el-tag>
                          <pre class="message-content">{{ formatJson(imsg.function_call.arguments) }}</pre>
                        </div>
                        <div v-if="imsg.name" class="function-name-tag">
                          <el-tag size="small" type="warning" effect="plain" round>name: {{ imsg.name }}</el-tag>
                        </div>
                        <el-button
                          v-if="imsg.content && imsg.content.length > 500"
                          link
                          type="primary"
                          size="small"
                          @click="toggleMessage(idx, mIdx)"
                        >
                          {{ isMessageExpanded(idx, mIdx) ? '收起' : '展开全部' }}
                        </el-button>
                      </div>
                    </div>
                  </div>

                  <!-- 可用函数定义 -->
                  <div v-if="getFunctionNames(msg.interaction).length > 0" class="functions-block">
                    <div class="section-label">可用函数</div>
                    <div class="functions-list">
                      <el-tag
                        v-for="fnName in getFunctionNames(msg.interaction)"
                        :key="fnName"
                        size="small"
                        type="warning"
                        effect="plain"
                      >
                        {{ fnName }}
                      </el-tag>
                    </div>
                  </div>
                </div>

                <!-- 响应部分 -->
                <div class="interaction-section">
                  <div class="section-label">📥 响应</div>
                  <el-descriptions :column="2" border size="small" class="response-desc">
                    <el-descriptions-item label="finish_reason">
                      {{ msg.interaction.finish_reason }}
                    </el-descriptions-item>
                    <el-descriptions-item label="耗时">
                      {{ msg.interaction.elapsed_ms }} ms
                    </el-descriptions-item>
                    <el-descriptions-item label="prompt_tokens">
                      {{ msg.interaction.prompt_tokens }}
                    </el-descriptions-item>
                    <el-descriptions-item label="completion_tokens">
                      {{ msg.interaction.completion_tokens }}
                    </el-descriptions-item>
                    <el-descriptions-item label="total_tokens">
                      {{ msg.interaction.total_tokens }}
                    </el-descriptions-item>
                    <el-descriptions-item label="时间戳">
                      {{ msg.interaction.timestamp }}
                    </el-descriptions-item>
                  </el-descriptions>

                  <div v-if="msg.interaction.response_content" class="response-content-block">
                    <div class="section-label">响应内容</div>
                    <pre class="message-content">{{ msg.interaction.response_content }}</pre>
                  </div>

                  <div v-if="msg.interaction.response_function_call" class="response-fc-block">
                    <div class="section-label">响应函数调用</div>
                    <el-tag size="small" type="warning" effect="plain">
                      🔧 {{ msg.interaction.response_function_call.name }}
                    </el-tag>
                    <pre class="message-content">{{ formatJson(msg.interaction.response_function_call.arguments) }}</pre>
                  </div>

                  <!-- 工具执行结果 -->
                  <div v-if="msg.interaction.tool_name" class="tool-result-block">
                    <div class="section-label">
                      工具执行结果
                      <el-tag
                        :type="msg.interaction.tool_success ? 'success' : 'danger'"
                        size="small"
                        effect="dark"
                        round
                        class="tool-status-tag"
                      >
                        {{ msg.interaction.tool_success ? '成功' : '失败' }}
                      </el-tag>
                    </div>
                    <div class="tool-info-row">
                      <span class="tool-info-label">工具名称</span>
                      <el-tag size="small" type="primary" effect="plain">
                        🔧 {{ msg.interaction.tool_name }}
                      </el-tag>
                    </div>
                    <div class="tool-info-row">
                      <span class="tool-info-label">调用参数</span>
                      <pre class="message-content tool-args-content">{{ formatJson(msg.interaction.tool_args) }}</pre>
                    </div>
                    <div class="tool-info-row">
                      <span class="tool-info-label">执行结果</span>
                      <pre
                        class="message-content"
                        :class="msg.interaction.tool_success ? 'tool-result-ok' : 'tool-result-err'"
                      >{{ msg.interaction.tool_result }}</pre>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </template>
        </div>
      </div>
    </div>

    <!-- 底部输入区 -->
    <div class="input-card">
      <div class="input-row">
        <el-select
          v-model="currentRole"
          style="width: 120px; flex-shrink: 0"
          size="default"
        >
          <el-option label="System" value="system" />
          <el-option label="User" value="user" />
          <el-option label="Assistant" value="assistant" />
        </el-select>
        <el-input
          v-model="inputText"
          type="textarea"
          :autosize="{ minRows: 1, maxRows: 6 }"
          placeholder="输入消息内容... (Ctrl+Enter 发送)"
          resize="none"
          class="input-textarea"
          @keydown.ctrl.enter.prevent="handleSend"
          @keydown.meta.enter.prevent="handleSend"
        />
        <div class="input-buttons">
          <el-button
            type="primary"
            :loading="sending"
            :disabled="streaming"
            @click="handleSend"
          >
            <el-icon><Promotion /></el-icon>
            <span>发送</span>
          </el-button>
          <el-button
            type="warning"
            :loading="streaming"
            :disabled="sending"
            @click="handleStreamSend"
          >
            <el-icon><VideoPlay /></el-icon>
            <span>流式</span>
          </el-button>
          <el-button @click="handleClear">
            <el-icon><Delete /></el-icon>
            <span>清空</span>
          </el-button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, nextTick } from 'vue'
import { ElMessage } from 'element-plus'
import {
  chat,
  chatStream,
  type ChatMessage,
  type TaskType,
  type Role,
  type ChatResponse,
  type LLMInteraction,
} from '@/api'

// 展示用消息类型（携带可选元信息与交互记录）
interface DisplayMessage extends ChatMessage {
  meta?: ChatResponse | null
  interaction?: LLMInteraction | null
}

// 顶部参数
const taskType = ref<TaskType>('text')
const temperature = ref(0.7)
const maxTokens = ref(1024)
const activeParams = ref<string[]>(['params'])
const showInteraction = ref(true)

// 底部输入
const currentRole = ref<Role>('user')
const inputText = ref('')

// 消息列表与状态
const messages = ref<DisplayMessage[]>([])
const sending = ref(false)
const streaming = ref(false)
const messagesContainer = ref<HTMLElement | null>(null)

// 交互面板展开状态
const openInteractionPanels = ref<number[]>([])
const expandedMessages = ref<Record<string, boolean>>({})
const MESSAGE_TRUNCATE_LIMIT = 500

// 任务类型 → 中文标签
const getTaskLabel = (task: TaskType): string => {
  const map: Record<TaskType, string> = {
    text: '文本生成',
    structure: '结构化输出',
    check: '检查校验',
  }
  return map[task]
}

// 滚动消息列表到底部
const scrollToBottom = () => {
  nextTick(() => {
    if (messagesContainer.value) {
      messagesContainer.value.scrollTop = messagesContainer.value.scrollHeight
    }
  })
}

// 切换某条 assistant 消息的交互面板
const toggleInteractionPanel = (idx: number) => {
  const pos = openInteractionPanels.value.indexOf(idx)
  if (pos >= 0) {
    openInteractionPanels.value.splice(pos, 1)
  } else {
    openInteractionPanels.value.push(idx)
  }
}

// 构建发送给 API 的消息列表（深拷贝，避免响应式代理影响序列化）
const buildRequestMessages = (): ChatMessage[] => {
  return messages.value.map((m) => ({ role: m.role, content: m.content }))
}

// 同步发送
const handleSend = async () => {
  const content = inputText.value.trim()
  if (!content) {
    ElMessage.warning('请输入消息内容')
    return
  }
  if (sending.value || streaming.value) return

  // 添加当前消息到列表
  messages.value.push({ role: currentRole.value, content })
  inputText.value = ''
  scrollToBottom()

  sending.value = true

  try {
    const { data } = await chat({
      task: taskType.value,
      messages: buildRequestMessages(),
      temperature: temperature.value,
      max_tokens: maxTokens.value,
    })
    messages.value.push({
      role: 'assistant',
      content: data.content,
      meta: data,
      interaction: data.interaction || null,
    })
    // 默认展开最新一条的交互面板
    if (showInteraction.value && data.interaction) {
      openInteractionPanels.value.push(messages.value.length - 1)
    }
    scrollToBottom()
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : '未知错误'
    ElMessage.error('请求失败: ' + msg)
  } finally {
    sending.value = false
  }
}

// 流式发送
const handleStreamSend = async () => {
  const content = inputText.value.trim()
  if (!content) {
    ElMessage.warning('请输入消息内容')
    return
  }
  if (sending.value || streaming.value) return

  // 添加当前消息到列表
  messages.value.push({ role: currentRole.value, content })
  inputText.value = ''
  scrollToBottom()

  streaming.value = true

  // 预先创建 assistant 消息占位，流式内容会逐步填充
  messages.value.push({ role: 'assistant', content: '', meta: null, interaction: null })
  const assistantIdx = messages.value.length - 1
  scrollToBottom()

  try {
    // 构建请求消息（排除占位的 assistant 消息）
    const requestMessages = messages.value
      .slice(0, assistantIdx)
      .map((m) => ({ role: m.role, content: m.content }))

    const generator = chatStream({
      task: taskType.value,
      messages: requestMessages,
      temperature: temperature.value,
      max_tokens: maxTokens.value,
    })

    for await (const event of generator) {
      if (event.type === 'chunk') {
        messages.value[assistantIdx].content += event.content
        scrollToBottom()
      } else if (event.type === 'done') {
        break
      } else if (event.type === 'error') {
        ElMessage.error('流式错误: ' + event.content)
        // 如果占位消息为空，移除它
        if (!messages.value[assistantIdx].content) {
          messages.value.splice(assistantIdx, 1)
        }
        break
      }
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : '未知错误'
    ElMessage.error('流式请求失败: ' + msg)
    // 如果占位消息为空，移除它
    if (!messages.value[assistantIdx]?.content) {
      messages.value.splice(assistantIdx, 1)
    }
  } finally {
    streaming.value = false
  }
}

// 清空对话
const handleClear = () => {
  messages.value = []
  inputText.value = ''
  openInteractionPanels.value = []
  expandedMessages.value = {}
}

// ====== 交互记录相关工具函数 ======

/** 角色对应的 el-tag 类型 */
const roleTagType = (role: string): 'primary' | 'success' | 'info' | 'warning' | 'danger' => {
  switch (role) {
    case 'system': return 'primary'
    case 'user': return 'success'
    case 'assistant': return 'info'
    case 'function': return 'warning'
    default: return 'info'
  }
}

/** 消息是否展开 */
const isMessageExpanded = (msgIdx: number, mIdx: number): boolean => {
  return !!expandedMessages.value[`${msgIdx}-${mIdx}`]
}

/** 切换消息展开状态 */
const toggleMessage = (msgIdx: number, mIdx: number) => {
  const key = `${msgIdx}-${mIdx}`
  expandedMessages.value[key] = !expandedMessages.value[key]
}

/** 获取消息展示内容（超过阈值默认折叠） */
const getMessageDisplay = (content: string, msgIdx: number, mIdx: number): string => {
  if (content.length <= MESSAGE_TRUNCATE_LIMIT) return content
  return isMessageExpanded(msgIdx, mIdx) ? content : content.slice(0, MESSAGE_TRUNCATE_LIMIT) + '\n...'
}

/** 美化 JSON 字符串 */
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

/** 格式化 function_call 参数展示 */
const formatFunctionCall = (fc: string | Record<string, any> | null): string => {
  if (fc === null) return 'auto'
  if (typeof fc === 'string') return fc
  return JSON.stringify(fc)
}

/** 获取交互记录中可用的函数名称列表 */
const getFunctionNames = (interaction: LLMInteraction): string[] => {
  if (!interaction.functions) return []
  return interaction.functions.map((fn) => fn.name).filter(Boolean)
}
</script>

<style scoped>
.chat-view {
  display: flex;
  flex-direction: column;
  gap: 12px;
  height: calc(100vh - 56px - 40px);
}

/* ====== 顶部可折叠参数面板 ====== */
.params-collapse {
  flex-shrink: 0;
  border-radius: 8px;
  overflow: hidden;
  border: none;
  box-shadow: 0 2px 12px 0 rgba(0, 0, 0, 0.06);
}

.params-collapse :deep(.el-collapse-item__header) {
  height: 48px;
  padding: 0 16px;
  background: #ffffff;
  border-bottom: 1px solid var(--border-color-light);
}

.params-collapse :deep(.el-collapse-item__wrap) {
  background: #ffffff;
}

.params-collapse :deep(.el-collapse-item__content) {
  padding: 14px 16px;
}

.collapse-title {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
}

.collapse-icon {
  color: var(--app-primary);
}

.collapse-tag {
  margin-left: auto;
  margin-right: 12px;
}

.params-row {
  display: flex;
  gap: 24px;
  align-items: center;
  flex-wrap: wrap;
}

.param-item {
  display: flex;
  align-items: center;
  gap: 8px;
}

.param-toggle {
  margin-left: auto;
}

.param-label {
  font-size: 13px;
  color: var(--text-regular);
  white-space: nowrap;
}

/* ====== 消息列表区 ====== */
.messages-card {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  background: #ffffff;
  border-radius: 8px;
  box-shadow: 0 2px 12px 0 rgba(0, 0, 0, 0.06);
}

.messages-container {
  height: 100%;
  overflow-y: auto;
  padding: 20px 24px;
}

.empty-state {
  height: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  color: var(--text-placeholder);
  gap: 10px;
}

.empty-icon {
  width: 76px;
  height: 76px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  background: linear-gradient(135deg, #f0f5ff 0%, #e8edff 100%);
  color: var(--app-primary);
  margin-bottom: 6px;
}

.empty-title {
  margin: 0;
  font-size: 16px;
  font-weight: 500;
  color: var(--text-regular);
}

.empty-hint {
  font-size: 12px;
  color: var(--text-placeholder);
}

/* ====== 消息行 ====== */
.message-row {
  margin-bottom: 18px;
  display: flex;
  gap: 10px;
  align-items: flex-start;
}

.row-system {
  justify-content: center;
}

.row-user {
  flex-direction: row-reverse;
}

.message-system {
  display: flex;
  justify-content: center;
  width: 100%;
}

/* 头像 */
.message-avatar {
  width: 34px;
  height: 34px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #ffffff;
  flex-shrink: 0;
  margin-top: 2px;
}

.avatar-user {
  background: linear-gradient(135deg, #409eff 0%, #6f8cff 100%);
  box-shadow: 0 2px 8px rgba(64, 158, 255, 0.3);
}

.avatar-assistant {
  background: linear-gradient(135deg, #67c23a 0%, #85d667 100%);
  box-shadow: 0 2px 8px rgba(103, 194, 58, 0.3);
}

/* 气泡容器 */
.message-bubble-wrap {
  display: flex;
  flex-direction: column;
  max-width: 70%;
  gap: 6px;
}

.row-user .message-bubble-wrap {
  align-items: flex-end;
}

/* 气泡 */
.message-bubble {
  padding: 10px 14px;
  border-radius: 12px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.06);
  word-break: break-word;
}

.bubble-user {
  background: linear-gradient(135deg, #409eff 0%, #5a9eff 100%);
  color: #ffffff;
  border-top-right-radius: 4px;
}

.bubble-assistant {
  background: #f5f7fa;
  color: var(--text-primary);
  border: 1px solid var(--border-color-light);
  border-top-left-radius: 4px;
}

.message-bubble pre {
  margin: 0;
  white-space: pre-wrap;
  word-wrap: break-word;
  font-family: inherit;
  font-size: 14px;
  line-height: 1.6;
}

/* 打字光标 */
.typing-cursor {
  display: inline-block;
  width: 7px;
  height: 16px;
  background: var(--app-primary);
  margin-left: 2px;
  vertical-align: text-bottom;
  animation: blink 1s steps(2, start) infinite;
  border-radius: 1px;
}

@keyframes blink {
  to {
    visibility: hidden;
  }
}

/* 元信息标签组 */
.message-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  align-items: center;
}

.tag-icon {
  margin-right: 2px;
  vertical-align: -2px;
}

.meta-toggle-btn {
  margin-left: 4px;
}

/* ====== LLM 交互详情面板 ====== */
.interaction-panel {
  margin-top: 4px;
  background: #fafbfc;
  border: 1px solid var(--border-color-light);
  border-left: 3px solid var(--app-primary);
  border-radius: 8px;
  padding: 14px;
  max-width: 100%;
  width: 760px;
  box-sizing: border-box;
  animation: panelIn 0.2s ease;
}

@keyframes panelIn {
  from {
    opacity: 0;
    transform: translateY(-4px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

.interaction-panel-header {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  margin-bottom: 12px;
  padding-bottom: 10px;
  border-bottom: 1px dashed var(--border-color-light);
}

.panel-icon {
  color: var(--app-primary);
}

.panel-title {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-primary);
}

.interaction-error {
  margin-bottom: 12px;
}

.interaction-section {
  margin-bottom: 16px;
}

.interaction-section:last-child {
  margin-bottom: 0;
}

.interaction-section .section-label {
  font-size: 13px;
  font-weight: 600;
  margin-bottom: 8px;
  color: var(--text-regular);
}

.params-row {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  margin-bottom: 12px;
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
  min-width: 64px;
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
  background: #ffffff;
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

.function-call-block {
  display: flex;
  flex-direction: column;
  gap: 6px;
  align-items: flex-start;
}

.function-name-tag {
  display: flex;
}

.functions-block {
  margin-top: 12px;
}

.functions-list {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
}

.response-desc {
  margin-top: 8px;
}

.response-content-block,
.response-fc-block {
  margin-top: 12px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

/* 工具执行结果 */
.tool-result-block {
  margin-top: 12px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.tool-status-tag {
  margin-left: 4px;
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

/* ====== 底部输入区 ====== */
.input-card {
  flex-shrink: 0;
  background: #ffffff;
  border-radius: 8px;
  padding: 12px 14px;
  box-shadow: 0 2px 12px 0 rgba(0, 0, 0, 0.06);
}

.input-row {
  display: flex;
  gap: 10px;
  align-items: flex-end;
}

.input-textarea {
  flex: 1;
}

.input-textarea :deep(.el-textarea__inner) {
  border-radius: 8px;
  box-shadow: 0 0 0 1px var(--border-color) inset;
  transition: box-shadow 0.25s cubic-bezier(0.4, 0, 0.2, 1);
}

.input-textarea :deep(.el-textarea__inner:focus) {
  box-shadow: 0 0 0 1px var(--app-primary) inset;
}

.input-buttons {
  display: flex;
  flex-direction: column;
  gap: 6px;
  flex-shrink: 0;
}

.input-buttons .el-button {
  margin-left: 0 !important;
}
</style>
