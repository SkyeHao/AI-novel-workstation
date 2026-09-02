<template>
  <div class="roundtable-agents-tab">
    <div class="asset-intro">
      <div class="asset-intro-text">
        角色蓝图定义了圆桌讨论中的不同立场与职责。每个角色拥有独立的系统提示词与共享上下文偏好。
      </div>
      <div class="asset-intro-tags">
        <el-tag size="small" type="success" effect="plain" round>提案者</el-tag>
        <el-tag size="small" type="warning" effect="plain" round>合成者</el-tag>
        <el-tag size="small" type="info" effect="plain" round>挑刺者</el-tag>
      </div>
    </div>

    <div class="discussion-config">
      <div class="discussion-config-head">
        <span class="discussion-config-title">
          <el-icon><Setting /></el-icon>
          讨论配置
        </span>
        <span class="discussion-config-hint">作用于所有圆桌会议会话，创建讨论时不再单独提供配置</span>
        <span class="toolbar-spacer"></span>
        <el-button plain size="small" :loading="configSaving" @click="resetConfig">恢复默认</el-button>
        <el-button type="primary" size="small" :loading="configSaving" @click="saveConfig">保存配置</el-button>
      </div>
      <div class="discussion-config-body">
        <div class="config-item">
          <div class="config-item-label">
            <span class="config-item-name">上下文 Token 预算</span>
            <span class="config-item-desc">每轮组装给各 Agent 的上下文内容上限，超出的旧内容会被压缩</span>
          </div>
          <el-input-number v-model="config.maxTokens" :min="1024" :step="1024" :max="100000" style="width: 180px" />
        </div>
        <div class="config-item">
          <div class="config-item-label">
            <span class="config-item-name">工具调用次数上限</span>
            <span class="config-item-desc">每个 Agent 每轮发言允许调用只读工具的次数，快用尽时会提醒其及时给出结论</span>
          </div>
          <el-input-number v-model="config.maxToolCalls" :min="1" :max="20" style="width: 180px" />
        </div>
        <div class="config-item config-item-hint">
          <div class="config-item-label">
            <span class="config-item-name">导演与共识裁判</span>
            <span class="config-item-desc">导演与共识裁判已独立为角色卡片，可在下方角色列表中编辑各自的系统提示词、专属模型与运行参数（启用 / 温度 / 超时 / 输出 Token）</span>
          </div>
          <el-tag type="primary" effect="plain" round>见下方角色卡片</el-tag>
        </div>
      </div>
    </div>

    <div class="roles-toolbar">
      <el-tag type="primary" effect="plain" round>{{ roles.length }} 个角色</el-tag>
      <span class="toolbar-spacer"></span>
      <el-button plain :loading="loading" @click="loadData">
        <el-icon style="margin-right: 4px"><Refresh /></el-icon>
        刷新
      </el-button>
      <el-button type="primary" @click="openCreateDialog">
        <el-icon style="margin-right: 4px"><Plus /></el-icon>
        新建角色
      </el-button>
    </div>

    <div class="roles-grid">
      <div v-for="role in roles" :key="role.id" class="role-card" :class="{ 'role-builtin': role.isBuiltin }">
        <div class="role-card-header">
          <div class="role-title-row">
            <span class="role-name">{{ role.name }}</span>
            <el-tag v-if="!role.roleType || role.roleType === 'participant'" :type="getCategoryTagType(role.category)" size="small" effect="plain" round>
              {{ getCategoryLabel(role.category) }}
            </el-tag>
            <el-tag v-if="role.roleType === 'director'" type="danger" size="small" effect="dark" round>导演</el-tag>
            <el-tag v-if="role.roleType === 'judge'" type="warning" size="small" effect="dark" round>共识裁判</el-tag>
          </div>
          <div class="role-actions">
            <el-button link type="primary" size="small" @click="handleDuplicate(role)" :disabled="!role.isBuiltin">
              <el-icon><CopyDocument /></el-icon>
              复制
            </el-button>
            <el-button link type="primary" size="small" @click="handleEdit(role)">
              <el-icon><Edit /></el-icon>
              编辑
            </el-button>
            <el-button link type="danger" size="small" @click="handleDelete(role)" :disabled="role.isBuiltin">
              <el-icon><Delete /></el-icon>
              删除
            </el-button>
          </div>
        </div>
        
        <p class="role-description">{{ role.description }}</p>

        <div class="role-scenario" v-if="getScenarios(role).length">
          <el-tag
            v-for="s in getScenarios(role)"
            :key="s"
            :type="getScenarioTagType(s)"
            size="small"
            effect="plain"
            round
          >
            {{ getScenarioLabel(s) }}
          </el-tag>
        </div>
        
        <div class="role-meta">
          <div class="meta-item">
            <span class="meta-label">上下文:</span>
            <span class="meta-value">{{ role.contextConfig.sharedContextKeys.length }} 项</span>
          </div>
          <div class="meta-item" v-if="role.modelId">
            <span class="meta-label">模型:</span>
            <span class="meta-value">{{ getModelName(role.modelId) }}</span>
          </div>
          <div class="meta-item" v-else>
            <span class="meta-label">模型:</span>
            <span class="meta-value">跟随默认</span>
          </div>
          <template v-if="isSystemRole(role.roleType)">
            <div class="meta-item">
              <span class="meta-label">启用:</span>
              <span class="meta-value" :class="{ 'meta-off': !getSystemRoleEnabled(role) }">
                {{ getSystemRoleEnabled(role) ? '已启用' : '已停用' }}
              </span>
            </div>
            <div class="meta-item" v-if="getSystemRoleConfig(role).temperature != null">
              <span class="meta-label">温度:</span>
              <span class="meta-value">{{ getSystemRoleConfig(role).temperature }}</span>
            </div>
            <div class="meta-item" v-if="getSystemRoleConfig(role).timeoutMs != null">
              <span class="meta-label">超时:</span>
              <span class="meta-value">{{ getSystemRoleConfig(role).timeoutMs }} ms</span>
            </div>
            <div class="meta-item" v-if="getSystemRoleConfig(role).maxTokens != null">
              <span class="meta-label">输出Token:</span>
              <span class="meta-value">{{ getSystemRoleConfig(role).maxTokens }}</span>
            </div>
          </template>
        </div>

      <div class="role-prompt-preview">
          <div class="prompt-label">系统提示词</div>
          <div class="prompt-text">{{ role.systemPrompt.slice(0, 180) }}{{ role.systemPrompt.length > 180 ? "..." : "" }}</div>
        </div>
        <div v-if="role.isBuiltin" class="builtin-badge">
          <el-icon><Lock /></el-icon>
          <span>内置角色</span>
        </div>
      </div>
    </div>

    <el-empty v-if="!loading && roles.length === 0" description="暂无 Agent 角色" />

    <!-- 创建/编辑对话框 -->
    <el-dialog
      v-model="dialogVisible"
      :title="isEdit ? '编辑 Agent 角色' : '新建 Agent 角色'"
      width="700px"
      :close-on-click-modal="false"
    >
      <el-form :model="form" label-width="120px" class="role-form">
        <el-form-item label="角色名称" required>
          <el-input v-model="form.name" placeholder="如：冲突制造者" />
        </el-form-item>
        
        <el-form-item label="角色描述" required>
          <el-input
            v-model="form.description"
            type="textarea"
            :rows="2"
            placeholder="简要描述该角色的职责和立场"
          />
        </el-form-item>
        
        <el-form-item label="角色类别" required>
          <el-select v-model="form.category" placeholder="选择角色类别" style="width: 100%">
            <el-option label="提案者 - 生成独立提案" value="proposer" />
            <el-option label="合成者 - 整合多方意见" value="synthesizer" />
            <el-option label="挑刺者 - 专门挑毛病找漏洞" value="reviewer" />
          </el-select>
        </el-form-item>

        <el-form-item label="适用场景">
          <el-checkbox-group v-model="form.scenario" class="scenario-check-group">
            <el-checkbox v-for="s in scenarioList" :key="s.value" :value="s.value" :label="s.label" />
          </el-checkbox-group>
          <div class="form-hint">标明该角色主要用于哪些创作场景（题材 / 世界观 / 大纲 / 人设 / 剧情），便于讨论时按场景挑选成员；不选则归为「通用」。</div>
        </el-form-item>
        
        <el-form-item label="系统提示词" required>
          <el-input
            v-model="form.systemPrompt"
            type="textarea"
            :rows="8"
            placeholder="定义该角色的核心关注点、倾向和反对的内容"
          />
        </el-form-item>
        
        <el-divider content-position="left">上下文配置</el-divider>
        
        <el-form-item label="共享上下文">
          <el-checkbox-group v-model="form.contextConfig.sharedContextKeys">
            <el-checkbox label="worldview">世界观设定</el-checkbox>
            <el-checkbox label="characters">人物关系</el-checkbox>
            <el-checkbox label="current_chapter">当前章节</el-checkbox>
            <el-checkbox label="foreshadow">伏笔台账</el-checkbox>
            <el-checkbox label="dynamic_settings">动态设定</el-checkbox>
          </el-checkbox-group>
        </el-form-item>

        <el-divider content-position="left">模型配置</el-divider>

        <el-form-item label="角色模型">
          <el-select v-model="form.modelId" clearable filterable placeholder="跟随系统默认模型" style="width: 100%">
            <el-option v-for="m in models" :key="m.id" :label="m.name + (m.is_default ? '（默认）' : '') + ' · ' + m.model" :value="m.id" />
          </el-select>
          <div class="form-hint">为角色指定专属模型；留空则跟随系统默认模型 / 任务分配。</div>
        </el-form-item>

        <template v-if="isSystemRoleEditing">
          <el-divider content-position="left">系统角色运行参数</el-divider>

          <el-form-item label="启用">
            <el-switch v-model="form.systemRoleConfig.enabled" active-text="启用" inactive-text="停用" />
            <div class="form-hint">关闭后该角色在讨论流程中不再参与运行（导演停用则走兜底调度，共识裁判停用则按规则收敛）。</div>
          </el-form-item>

          <el-form-item label="温度">
            <el-input-number v-model="form.systemRoleConfig.temperature" :min="0" :max="2" :step="0.1" style="width: 180px" />
            <div class="form-hint">生成随机性，值越低输出越稳定。</div>
          </el-form-item>

          <el-form-item label="超时(ms)">
            <el-input-number v-model="form.systemRoleConfig.timeoutMs" :min="100" :max="60000" :step="100" style="width: 180px" />
            <div class="form-hint">单次判定 / 决策允许的最大等待时间，超时后按规则兜底。</div>
          </el-form-item>

          <el-form-item label="输出Token">
            <el-input-number v-model="form.systemRoleConfig.maxTokens" :min="100" :max="10000" :step="100" clearable style="width: 180px" />
            <div class="form-hint">输出内容 token 上限，留空表示不限制。</div>
          </el-form-item>
        </template>
        
      </el-form>
      
      <template #footer>
        <el-button @click="dialogVisible = false">取消</el-button>
        <el-button type="primary" @click="saveRole" :loading="saving">保存</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import {
  getAgentRoles,
  createAgentRole,
  updateAgentRole,
  deleteAgentRole,
  duplicateAgentRole,
  getRoundtableConfig,
  updateRoundtableConfig,
  resetRoundtableConfig,
  getModels,
  type AgentRoleAsset,
  type AgentRoleCategory,
  type AgentRoleScenario,
  type ModelEntry,
  type RoundtableConfig,
} from '@/api'

const emit = defineEmits<{
  (e: 'count', count: number): void
}>()

const loading = ref(false)
const saving = ref(false)
const configSaving = ref(false)
const roles = ref<AgentRoleAsset[]>([])
const models = ref<ModelEntry[]>([])
const config = ref<RoundtableConfig>({
  maxTokens: 8000,
  maxToolCalls: 3,
  scheduler: { enabled: true, modelId: null, temperature: 0.3, timeoutMs: 60000, maxTokens: 300 },
  consensus: { enabled: true, timeoutMs: 60000, temperature: 0.2, maxTokens: null },
})
const dialogVisible = ref(false)
const isEdit = ref(false)
const editingId = ref<string | null>(null)
const editingRoleType = ref<'participant' | 'director' | 'judge' | null>(null)

const isSystemRoleEditing = computed(() => editingRoleType.value === 'director' || editingRoleType.value === 'judge')

const form = ref({
  name: '',
  description: '',
  category: 'proposer' as AgentRoleCategory,
  scenario: [] as AgentRoleScenario[],
  modelId: null as string | null,
  systemPrompt: '',
  contextConfig: {
    sharedContextKeys: [] as string[],
  },
  systemRoleConfig: {
    enabled: true,
    temperature: 0.3,
    timeoutMs: 60000,
    maxTokens: null as number | null,
  },
})

const scenarioList: { value: AgentRoleScenario; label: string }[] = [
  { value: 'theme', label: '题材' },
  { value: 'worldview', label: '世界观' },
  { value: 'outline', label: '大纲' },
  { value: 'character', label: '人设' },
  { value: 'plot', label: '剧情' },
  { value: 'general', label: '通用' },
]

function getScenarioLabel(s: AgentRoleScenario): string {
  const labels: Record<AgentRoleScenario, string> = {
    theme: '题材',
    worldview: '世界观',
    outline: '大纲',
    character: '人设',
    plot: '剧情',
    general: '通用',
  }
  return labels[s] || s
}

function getScenarioTagType(s: AgentRoleScenario): string {
  const types: Record<AgentRoleScenario, string> = {
    theme: 'primary',
    worldview: 'success',
    outline: 'warning',
    character: 'danger',
    plot: 'info',
    general: '',
  }
  return types[s] || 'info'
}

function getScenarios(role: AgentRoleAsset): AgentRoleScenario[] {
  return Array.isArray(role.scenario) && role.scenario.length > 0 ? role.scenario : ['general']
}

function getCategoryLabel(category: AgentRoleCategory): string {
  const labels: Record<AgentRoleCategory, string> = {
    proposer: '提案者',
    synthesizer: '合成者',
    reviewer: '挑刺者',
  }
  return labels[category] || category
}

function getCategoryTagType(category: AgentRoleCategory): string {
  const types: Record<AgentRoleCategory, string> = {
    proposer: 'success',
    synthesizer: 'warning',
    reviewer: 'info',
  }
  return types[category] || 'info'
}

function getModelName(id: string): string {
  const m = models.value.find((x) => x.id === id)
  return m ? m.name : '（模型已删除）'
}

function isSystemRole(roleType?: string): boolean {
  return roleType === 'director' || roleType === 'judge'
}

function getSystemRoleConfig(role: AgentRoleAsset) {
  return role.systemRoleConfig ?? {}
}

function getSystemRoleEnabled(role: AgentRoleAsset): boolean {
  return role.systemRoleConfig?.enabled ?? true
}

function defaultSystemRoleConfig() {
  return {
    enabled: true,
    temperature: 0.3,
    timeoutMs: 60000,
    maxTokens: null as number | null,
  }
}

function fillSystemRoleConfig(src?: {
  enabled?: boolean
  temperature?: number
  timeoutMs?: number
  maxTokens?: number | null
}) {
  return {
    enabled: src?.enabled ?? true,
    temperature: src?.temperature ?? 0.3,
    timeoutMs: src?.timeoutMs ?? 60000,
    maxTokens: src?.maxTokens ?? null,
  }
}



async function loadConfig() {
  try {
    const res = await getRoundtableConfig()
    config.value = {
      maxTokens: res.data.maxTokens,
      maxToolCalls: res.data.maxToolCalls,
      scheduler: res.data.scheduler ?? { enabled: true, modelId: null, temperature: 0.3, timeoutMs: 60000, maxTokens: 300 },
      consensus: res.data.consensus ?? { enabled: true, timeoutMs: 60000, temperature: 0.2, maxTokens: null },
    }
  } catch (err) {
    console.warn('加载圆桌会议配置失败:', err)
  }
}

async function loadModels() {
  try {
    const res = await getModels()
    models.value = res.data || []
  } catch (err) {
    console.warn('加载模型列表失败:', err)
    models.value = []
  }
}

async function saveConfig() {
  configSaving.value = true
  try {
    const res = await updateRoundtableConfig(config.value)
    config.value = {
      maxTokens: res.data.maxTokens,
      maxToolCalls: res.data.maxToolCalls,
      scheduler: res.data.scheduler ?? config.value.scheduler,
      consensus: res.data.consensus ?? config.value.consensus,
    }
    ElMessage.success('讨论配置已保存')
  } catch (err) {
    console.error('保存讨论配置失败:', err)
    ElMessage.error('保存讨论配置失败')
  } finally {
    configSaving.value = false
  }
}

async function resetConfig() {
  configSaving.value = true
  try {
    const res = await resetRoundtableConfig()
    config.value = {
      maxTokens: res.data.maxTokens,
      maxToolCalls: res.data.maxToolCalls,
      scheduler: res.data.scheduler ?? { enabled: true, modelId: null, temperature: 0.3, timeoutMs: 60000, maxTokens: 300 },
      consensus: res.data.consensus ?? { enabled: true, timeoutMs: 60000, temperature: 0.2, maxTokens: null },
    }
    ElMessage.success('已恢复默认配置')
  } catch (err) {
    console.error('重置讨论配置失败:', err)
    ElMessage.error('重置讨论配置失败')
  } finally {
    configSaving.value = false
  }
}

async function loadData() {
  loading.value = true
  try {
    const res = await getAgentRoles()
    roles.value = res.data || []
    emit('count', roles.value.length)
  } catch (err) {
    ElMessage.error('加载 Agent 角色失败')
    roles.value = []
    emit('count', 0)
  } finally {
    loading.value = false
  }
}

function openCreateDialog() {
  isEdit.value = false
  editingId.value = null
  editingRoleType.value = null
  form.value = {
    name: '',
    description: '',
    category: 'proposer',
    scenario: ['general'],
    modelId: null,
    systemPrompt: '',
    contextConfig: {
      sharedContextKeys: ['worldview', 'characters', 'current_chapter'],
    },
    systemRoleConfig: defaultSystemRoleConfig(),
  }
  dialogVisible.value = true
}

function handleEdit(role: AgentRoleAsset) {
  isEdit.value = true
  editingId.value = role.id
  editingRoleType.value = role.roleType ?? 'participant'
  form.value = {
    name: role.name,
    description: role.description,
    category: role.category,
    scenario: getScenarios(role),
    modelId: role.modelId ?? null,
    systemPrompt: role.systemPrompt,
    contextConfig: JSON.parse(JSON.stringify(role.contextConfig)),
    systemRoleConfig: fillSystemRoleConfig(role.systemRoleConfig),
  }
  dialogVisible.value = true
}

async function handleDuplicate(role: AgentRoleAsset) {
  try {
    await duplicateAgentRole(role.id)
    ElMessage.success('复制成功')
    await loadData()
  } catch (err) {
    ElMessage.error('复制失败')
  }
}

async function handleDelete(role: AgentRoleAsset) {
  if (role.isBuiltin) {
    ElMessage.warning('内置角色不可删除')
    return
  }
  // 不允许删掉最后一个合成者：会话必须至少含一名合成者收敛最终方案
  if (role.category === 'synthesizer') {
    const remainingSynthesizers = roles.value.filter((r) => r.category === 'synthesizer' && r.id !== role.id)
    if (remainingSynthesizers.length === 0) {
      ElMessage.warning('至少需要保留一名合成者角色，否则无法创建圆桌会议会话')
      return
    }
  }
  try {
    await ElMessageBox.confirm(
      `确定要删除角色 "${role.name}" 吗？此操作不可恢复。`,
      '确认删除',
      { type: 'warning' }
    )
    await deleteAgentRole(role.id)
    ElMessage.success('删除成功')
    await loadData()
  } catch (err) {
    if (err !== 'cancel') {
      ElMessage.error('删除失败')
    }
  }
}

async function saveRole() {
  if (!form.value.name || !form.value.description || !form.value.systemPrompt) {
    ElMessage.warning('请填写必填项')
    return
  }

  // 未勾选任何场景时回退为「通用」，保证后端存的是有效数组
  if (!form.value.scenario || form.value.scenario.length === 0) {
    form.value.scenario = ['general']
  }

  // 角色模型留空 → 显式置 null，避免清空时后端因 null 跳过而残留旧值
  const payload = { ...form.value, modelId: form.value.modelId || null }

  // 系统角色运行参数仅对导演 / 共识裁判生效，普通成员不携带该字段，避免在参与者身上留下无用配置
  if (editingRoleType.value !== 'director' && editingRoleType.value !== 'judge') {
    delete (payload as Record<string, unknown>).systemRoleConfig
  }
  
  saving.value = true
  try {
    if (isEdit.value && editingId.value) {
      await updateAgentRole(editingId.value, payload)
      ElMessage.success('更新成功')
    } else {
      await createAgentRole(payload)
      ElMessage.success('创建成功')
    }
    dialogVisible.value = false
    await loadData()
  } catch (err) {
    ElMessage.error('保存失败')
  } finally {
    saving.value = false
  }
}

onMounted(() => {
  loadData()
  loadConfig()
  loadModels()
})
</script>

<style scoped>
.roundtable-agents-tab {
  display: flex;
  flex-direction: column;
}

.roles-toolbar {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 14px;
}

.toolbar-spacer {
  flex: 1;
}

.discussion-config {
  border: 1px solid var(--accent-border, #c7d2fe);
  background: linear-gradient(135deg, rgba(79, 70, 229, 0.05) 0%, rgba(255, 255, 255, 0.6) 100%);
  border-radius: 10px;
  margin-bottom: 16px;
  overflow: hidden;
}

.discussion-config-head {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 12px 16px;
  border-bottom: 1px solid rgba(79, 70, 229, 0.12);
  flex-wrap: wrap;
}

.discussion-config-title {
  display: flex;
  align-items: center;
  gap: 6px;
  font-weight: 600;
  color: var(--text-title);
  font-size: 14px;
}

.discussion-config-title .el-icon {
  color: var(--accent);
}

.discussion-config-hint {
  font-size: 12px;
  color: var(--text-muted);
}

.discussion-config-body {
  display: flex;
  flex-direction: column;
  gap: 0;
}

.config-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 12px 16px;
}

.config-item + .config-item {
  border-top: 1px dashed var(--border-color-light);
}

.config-item-label {
  display: flex;
  flex-direction: column;
  gap: 2px;
  flex: 1;
}

.config-item-name {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-regular);
}

.config-item-desc {
  font-size: 12px;
  color: var(--text-muted);
  line-height: 1.5;
}

.asset-intro {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  padding: 14px 18px;
  margin-bottom: 16px;
  background: var(--surface);
  border: 1px solid var(--border-color-light);
  border-radius: 10px;
  flex-wrap: wrap;
}

.asset-intro-text {
  flex: 1;
  min-width: 260px;
  font-size: 13px;
  color: var(--text-secondary);
  line-height: 1.7;
}

.asset-intro-tags {
  display: flex;
  gap: 8px;
  flex-shrink: 0;
  flex-wrap: wrap;
}

.roles-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(380px, 1fr));
  gap: 16px;
}

.role-card {
  position: relative;
  padding: 20px;
  background: #fff;
  border: 1px solid var(--border-color-light);
  border-radius: 12px;
  transition: all 0.2s ease;
}

.role-card:hover {
  border-color: var(--accent-border);
  box-shadow: 0 6px 20px rgba(79, 70, 229, 0.08);
  transform: translateY(-2px);
}

.role-card.role-builtin {
  background: linear-gradient(135deg, #f8fafc 0%, #f1f5f9 100%);
}

.role-pick-row {
  display: flex;
  justify-content: flex-end;
  margin-bottom: 10px;
}

.role-pick-row .el-checkbox__label {
  font-size: 12px;
  color: var(--text-secondary);
}

.role-card-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 12px;
}

.role-title-row {
  display: flex;
  align-items: center;
  gap: 8px;
  flex: 1;
}

.role-name {
  font-size: 17px;
  font-weight: 700;
  color: var(--text-title);
}

.role-actions {
  display: flex;
  gap: 4px;
  flex-shrink: 0;
}

.role-description {
  font-size: 13px;
  color: var(--text-secondary);
  line-height: 1.6;
  margin: 0 0 16px;
  min-height: 40px;
}

.role-scenario {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-bottom: 12px;
}

.scenario-check-group {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 16px;
}

.role-meta {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 12px;
  background: var(--surface-hover);
  border-radius: 8px;
  margin-bottom: 12px;
}

.meta-item {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
}

.meta-label {
  color: var(--text-muted);
  min-width: 70px;
}

.meta-value {
  color: var(--text-regular);
  font-weight: 500;
}

.meta-value.meta-off {
  color: #f56c6c;
  font-weight: 600;
}

.role-prompt-preview {
  padding: 12px;
  background: #fafafa;
  border: 1px solid var(--border-color-light);
  border-radius: 8px;
  margin-bottom: 12px;
}

.prompt-label {
  font-size: 11px;
  color: var(--text-muted);
  margin-bottom: 6px;
  font-weight: 600;
}

.prompt-text {
  font-size: 12px;
  color: var(--text-secondary);
  line-height: 1.6;
  font-family: 'Consolas', 'Monaco', monospace;
  white-space: pre-wrap;
  word-break: break-word;
}

.builtin-badge {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 12px;
  background: rgba(79, 70, 229, 0.08);
  border: 1px solid rgba(79, 70, 229, 0.2);
  border-radius: 6px;
  font-size: 12px;
  color: var(--accent);
  font-weight: 500;
}

.form-hint {
  font-size: 12px;
  color: var(--text-secondary);
  margin-top: 4px;
}

.role-form {
  max-height: 600px;
  overflow-y: auto;
  padding-right: 8px;
}
</style>






