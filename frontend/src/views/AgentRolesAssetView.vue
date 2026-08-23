<template>
  <div class="agent-roles-view">
    <PageHeader title="Agent 角色蓝图" subtitle="多 Agent 讨论架构中的可复用角色资产" icon="UserFilled">
      <template #actions>
        <el-tag type="primary" effect="plain" round>{{ roles.length }} 个角色</el-tag>
        <el-button plain :loading="loading" @click="loadData">
          <el-icon style="margin-right: 4px"><Refresh /></el-icon>
          刷新
        </el-button>
        <el-button
          type="primary"
          :disabled="selectedRoleIds.length === 0 || !currentProject.id"
          @click="startGroupChat"
        >
          <el-icon style="margin-right: 4px"><ChatDotRound /></el-icon>
          开始群聊<template v-if="selectedRoleIds.length > 0">（{{ selectedRoleIds.length }}）</template>
        </el-button>
        <el-button type="primary" @click="openCreateDialog">
          <el-icon style="margin-right: 4px"><Plus /></el-icon>
          新建角色
        </el-button>
      </template>
    </PageHeader>

    <div class="asset-intro">
      <div class="asset-intro-text">
        Agent 角色蓝图定义了多 Agent 讨论中的不同立场和职责。每个角色拥有独立的系统提示词、模型配置和上下文偏好。
        内置角色不可修改，但可以复制为自定义角色进行个性化调整。
      </div>
      <div class="asset-intro-tags">
        <el-tag size="small" type="success" effect="plain" round>提案者</el-tag>
        <el-tag size="small" type="warning" effect="plain" round>合成者</el-tag>
        <el-tag size="small" type="info" effect="plain" round>评审者</el-tag>
      </div>
    </div>

    <div class="roles-grid">
      <div v-for="role in roles" :key="role.id" class="role-card" :class="{ 'role-builtin': role.isBuiltin }">
        <div class="role-pick-row">
          <el-checkbox :model-value="selectedRoleIds.includes(role.id)" @change="toggleRoleSelect(role.id, $event)">
            参与本次群聊
          </el-checkbox>
        </div>
        <div class="role-card-header">
          <div class="role-title-row">
            <span class="role-name">{{ role.name }}</span>
            <el-tag :type="getCategoryTagType(role.category)" size="small" effect="plain" round>
              {{ getCategoryLabel(role.category) }}
            </el-tag>
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
        
        <div class="role-meta">
          <div class="meta-item">
            <span class="meta-label">模型配置:</span>
            <span class="meta-value">{{ getModelConfigLabel(role) }}</span>
          </div>
          <div class="meta-item">
            <span class="meta-label">温度:</span>
            <span class="meta-value">{{ getTemperature(role) }}</span>
          </div>
          <div class="meta-item">
            <span class="meta-label">上下文:</span>
            <span class="meta-value">{{ role.contextConfig.sharedContextKeys.length }} 项</span>
          </div>
        </div>

        <div class="role-prompt-preview">
          <div class="prompt-label">系统提示词预览:</div>
          <div class="prompt-text">{{ role.systemPrompt.substring(0, 150) }}{{ role.systemPrompt.length > 150 ? '...' : '' }}</div>
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
            <el-option label="评审者 - 评审最终方案" value="reviewer" />
          </el-select>
        </el-form-item>
        
        <el-form-item label="系统提示词" required>
          <el-input
            v-model="form.systemPrompt"
            type="textarea"
            :rows="8"
            placeholder="定义该角色的核心关注点、倾向和反对的内容"
          />
        </el-form-item>
        
        <el-divider content-position="left">模型配置</el-divider>
        
        <el-form-item label="配置模式">
          <el-radio-group v-model="form.modelConfig.mode">
            <el-radio label="reference">引用全局配置</el-radio>
            <el-radio label="custom">自定义配置</el-radio>
          </el-radio-group>
        </el-form-item>
        
        <template v-if="form.modelConfig.mode === 'custom'">
          <el-form-item label="模型选择">
            <el-select
              v-model="form.modelConfig.custom.modelId"
              placeholder="留空使用默认模型"
              clearable
              style="width: 100%"
            >
              <el-option
                v-for="model in models.filter(m => m.status === 'ok')"
                :key="model.id"
                :label="model.name + ' (' + model.model + ')'"
                :value="model.id"
              />
            </el-select>
            <div class="form-hint">
              留空则使用"模型管理"中为 text 任务分配的模型
            </div>
          </el-form-item>
          
          <el-form-item label="温度">
            <el-slider
              v-model="form.modelConfig.custom.temperature"
              :min="0"
              :max="2"
              :step="0.1"
              show-input
              :show-input-controls="false"
            />
          </el-form-item>
          
          <el-form-item label="最大 Token">
            <el-input-number
              v-model="form.modelConfig.custom.maxTokens"
              :min="1"
              :step="512"
              style="width: 100%"
            />
          </el-form-item>
        </template>
        
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
        
        <el-form-item label="角色侧重提示">
          <el-input
            v-model="form.contextConfig.roleFocusHint"
            type="textarea"
            :rows="2"
            placeholder="注入到上下文中的角色侧重说明"
          />
        </el-form-item>
      </el-form>
      
      <template #footer>
        <el-button @click="dialogVisible = false">取消</el-button>
        <el-button type="primary" @click="saveRole" :loading="saving">保存</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import {
  getAgentRoles,
  createAgentRole,
  updateAgentRole,
  deleteAgentRole,
  duplicateAgentRole,
  getModels,
  type AgentRoleAsset,
  type AgentRoleCategory,
  type ModelEntry,
} from '@/api'
import PageHeader from '@/components/PageHeader.vue'
import { useCurrentProject } from '@/stores/currentProject'

const router = useRouter()
const currentProject = useCurrentProject()
const loading = ref(false)
const saving = ref(false)
const roles = ref<AgentRoleAsset[]>([])
const models = ref<ModelEntry[]>([])
const selectedRoleIds = ref<string[]>([])
const dialogVisible = ref(false)
const isEdit = ref(false)
const editingId = ref<string | null>(null)

const form = ref({
  name: '',
  description: '',
  category: 'proposer' as AgentRoleCategory,
  systemPrompt: '',
  modelConfig: {
    mode: 'custom' as 'reference' | 'custom',
    custom: {
      modelId: '',
      temperature: 0.7,
      maxTokens: 4096,
    },
  },
  contextConfig: {
    sharedContextKeys: [] as string[],
    roleFocusHint: '',
  },
})

function getCategoryLabel(category: AgentRoleCategory): string {
  const labels: Record<AgentRoleCategory, string> = {
    proposer: '提案者',
    synthesizer: '合成者',
    reviewer: '评审者',
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

function getModelConfigLabel(role: AgentRoleAsset): string {
  if (role.modelConfig.mode === 'reference') {
    return '引用全局'
  }
  const modelId = role.modelConfig.custom?.modelId
  return modelId ? modelId : '默认模型'
}

function getTemperature(role: AgentRoleAsset): number {
  if (role.modelConfig.mode === 'custom' && role.modelConfig.custom) {
    return role.modelConfig.custom.temperature
  }
  return 0.7
}

function toggleRoleSelect(roleId: string, checked: boolean | string | number) {
  if (checked) {
    if (!selectedRoleIds.value.includes(roleId)) selectedRoleIds.value.push(roleId)
  } else {
    selectedRoleIds.value = selectedRoleIds.value.filter((id) => id !== roleId)
  }
}

function startGroupChat() {
  if (!currentProject.id) {
    ElMessage.warning('请先在右上角选择一个作品，再开始群聊')
    return
  }
  if (selectedRoleIds.value.length === 0) {
    ElMessage.warning('请至少勾选一个参与角色')
    return
  }
  router.push({
    path: `/projects/${currentProject.id}/discussion`,
    query: { roles: selectedRoleIds.value.join(',') },
  })
}

async function loadModels() {
  try {
    const res = await getModels()
    models.value = res.data || []
  } catch (err) {
    console.warn('加载模型列表失败:', err)
  }
}

async function loadData() {
  loading.value = true
  try {
    const res = await getAgentRoles()
    roles.value = res.data || []
  } catch (err) {
    ElMessage.error('加载 Agent 角色失败')
    roles.value = []
  } finally {
    loading.value = false
  }
}

function openCreateDialog() {
  isEdit.value = false
  editingId.value = null
  form.value = {
    name: '',
    description: '',
    category: 'proposer',
    systemPrompt: '',
    modelConfig: {
      mode: 'custom',
      custom: {
        modelId: '',
        temperature: 0.7,
        maxTokens: 4096,
      },
    },
    contextConfig: {
      sharedContextKeys: ['worldview', 'characters', 'current_chapter'],
      roleFocusHint: '',
    },
  }
  dialogVisible.value = true
}

function handleEdit(role: AgentRoleAsset) {
  isEdit.value = true
  editingId.value = role.id
  form.value = {
    name: role.name,
    description: role.description,
    category: role.category,
    systemPrompt: role.systemPrompt,
    modelConfig: JSON.parse(JSON.stringify(role.modelConfig)),
    contextConfig: JSON.parse(JSON.stringify(role.contextConfig)),
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
  
  saving.value = true
  try {
    if (isEdit.value && editingId.value) {
      await updateAgentRole(editingId.value, form.value)
      ElMessage.success('更新成功')
    } else {
      await createAgentRole(form.value)
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
  loadModels()
})
</script>

<style scoped>
.agent-roles-view {
  max-width: 1400px;
  margin: 0 auto;
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





