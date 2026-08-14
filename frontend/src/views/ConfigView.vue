<template>
  <div class="config-view">
    <!-- 页面标题 -->
    <el-card class="page-header" shadow="never">
      <div class="header-content">
        <div class="header-title-group">
          <h2>模型池配置</h2>
          <p>管理模型池并为三类任务分配模型：文本生成、结构化输出、检查校验</p>
        </div>
        <div class="header-actions">
          <el-button type="primary" plain :loading="loading" @click="loadAll">
            <el-icon><Refresh /></el-icon>
            <span>刷新</span>
          </el-button>
          <el-button type="primary" @click="openAddDialog">
            <el-icon><Plus /></el-icon>
            <span>添加模型</span>
          </el-button>
        </div>
      </div>
    </el-card>

    <!-- 项目目录配置 -->
    <el-card class="project-dir-card" shadow="never">
      <template #header>
        <div class="card-header-title">
          <el-icon class="header-icon"><FolderOpened /></el-icon>
          <span>项目目录配置</span>
          <el-tag size="small" type="success" effect="plain" round>
            {{ projectDir.exists ? '目录已就绪' : '目录待创建' }}
          </el-tag>
        </div>
      </template>
      <div class="project-dir-body">
        <div class="dir-input-row">
          <el-input
            v-model="projectDirInput"
            placeholder="输入项目默认目录路径（如 projects 或 D:\MyNovels）"
            clearable
            class="dir-input"
            @keyup.enter="handleSaveProjectDir"
          >
            <template #prefix>
              <el-icon><Folder /></el-icon>
            </template>
          </el-input>
          <el-button
            type="primary"
            :loading="savingProjectDir"
            @click="handleSaveProjectDir"
          >
            <el-icon><Check /></el-icon>
            <span>保存</span>
          </el-button>
          <el-button @click="handleResetProjectDir">
            <el-icon><RefreshLeft /></el-icon>
            <span>重置</span>
          </el-button>
        </div>
        <div class="dir-info">
          <el-icon class="dir-info-icon"><InfoFilled /></el-icon>
          <span class="dir-info-text">
            绝对路径：<code class="dir-path-code">{{ projectDir.absolute_path || '-' }}</code>
          </span>
          <span class="dir-info-hint">所有生成的项目内容将存储在此目录下</span>
        </div>
      </div>
    </el-card>

    <!-- 联网搜索配置 -->
    <el-card class="search-config-card" shadow="never">
      <template #header>
        <div class="card-header-title">
          <el-icon class="header-icon"><Search /></el-icon>
          <span>联网搜索配置</span>
          <el-tag size="small" type="info" effect="plain" round>
            为搜索工具配置 API Key 与优先级
          </el-tag>
        </div>
      </template>

      <el-form label-position="top" class="search-config-form">
        <div class="search-config-row">
          <el-form-item label="Tavily API Key（https://tavily.com）">
            <el-input
              v-model="searchTavilyKey"
              type="password"
              show-password
              :placeholder="searchConfig.tavily_configured
                ? `已配置（${searchConfig.tavily_api_key}），留空保持不变`
                : '输入 Tavily API Key，留空则不启用'"
              clearable
            />
          </el-form-item>
          <el-form-item label="Serper API Key（https://serper.dev）">
            <el-input
              v-model="searchSerperKey"
              type="password"
              show-password
              :placeholder="searchConfig.serper_configured
                ? `已配置（${searchConfig.serper_api_key}），留空保持不变`
                : '输入 Serper API Key，留空则不启用'"
              clearable
            />
          </el-form-item>
        </div>
        <div class="search-config-row">
          <el-form-item label="搜索源优先级（逗号分隔）">
            <el-input
              v-model="searchProvidersInput"
              placeholder="如 baidu,ddg,bing（留空使用默认顺序：baidu,ddg,tavily,serper,bing,cn_bing）"
              clearable
            />
            <div class="search-providers-hint">
              可选：ddg（ddgs库·Bing后端）、baidu、bing、cn_bing、tavily、serper。未配置 Key 的 API 源会自动跳过。
            </div>
          </el-form-item>
        </div>
        <div class="search-config-actions">
          <el-button type="primary" :loading="savingSearch" @click="handleSaveSearchConfig">
            <el-icon><Check /></el-icon>
            <span>保存</span>
          </el-button>
        </div>
      </el-form>
    </el-card>

    <!-- 区域一：模型池管理 -->
    <el-card class="pool-card" shadow="never">
      <template #header>
        <div class="card-header-title">
          <el-icon class="header-icon"><Box /></el-icon>
          <span>模型池</span>
          <el-tag size="small" type="info" effect="plain" round>
            {{ models.length }} 个模型
          </el-tag>
        </div>
      </template>

      <el-table
        v-loading="loading"
        :data="models"
        style="width: 100%"
        empty-text="暂无模型，请点击「添加模型」按钮"
      >
        <el-table-column prop="name" label="名称" min-width="120" />
        <el-table-column label="服务商" min-width="100">
          <template #default="{ row }">
            {{ getProviderName(row.provider_id) }}
          </template>
        </el-table-column>
        <el-table-column prop="model" label="模型" min-width="140" />
        <el-table-column label="Base URL" min-width="200" show-overflow-tooltip>
          <template #default="{ row }">
            <span class="mono">{{ row.base_url }}</span>
          </template>
        </el-table-column>
        <el-table-column label="状态" width="100" align="center">
          <template #default="{ row }">
            <el-tag :type="getStatusType(row.status)" effect="light" size="small">
              {{ getStatusLabel(row.status) }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="上次测试" width="160" align="center">
          <template #default="{ row }">
            {{ formatTime(row.last_tested) }}
          </template>
        </el-table-column>
        <el-table-column label="操作" width="260" fixed="right">
          <template #default="{ row }">
            <el-button
              size="small"
              :loading="!!testingMap[row.id]"
              @click="handleTest(row)"
            >
              <el-icon v-if="!testingMap[row.id]"><Connection /></el-icon>
              <span>测试</span>
            </el-button>
            <el-button size="small" type="primary" @click="openEditDialog(row)">
              <el-icon><Edit /></el-icon>
              <span>编辑</span>
            </el-button>
            <el-popconfirm
              title="确定删除此模型吗？"
              @confirm="handleDelete(row)"
            >
              <template #reference>
                <el-button size="small" type="danger">
                  <el-icon><Delete /></el-icon>
                  <span>删除</span>
                </el-button>
              </template>
            </el-popconfirm>
          </template>
        </el-table-column>
      </el-table>
    </el-card>

    <!-- 区域二：任务分配 -->
    <div class="section-title">
      <el-icon class="section-icon"><SetUp /></el-icon>
      <span>任务分配</span>
    </div>

    <div class="assignment-grid">
      <el-card
        v-for="task in taskTypes"
        :key="task"
        class="assignment-card"
        :class="`task-${task}`"
        shadow="hover"
      >
        <!-- 顶部彩色标识条 -->
        <div class="card-stripe" :class="`stripe-${task}`"></div>

        <!-- 卡片头部：任务名 -->
        <div class="card-top">
          <div class="task-info">
            <div class="task-icon" :class="`icon-${task}`">
              <el-icon size="18">
                <Edit v-if="task === 'text'" />
                <Document v-else-if="task === 'structure'" />
                <CircleCheck v-else />
              </el-icon>
            </div>
            <div class="task-meta">
              <span class="task-name">{{ getTaskLabel(task) }}</span>
              <span class="task-desc">{{ getTaskDesc(task) }}</span>
            </div>
          </div>
        </div>

        <!-- 分配内容 -->
        <div class="assignment-body">
          <p class="assignment-desc">{{ getTaskDescription(task) }}</p>

          <template v-if="models.length === 0">
            <el-alert
              title="请先添加模型"
              type="warning"
              :closable="false"
              show-icon
            />
          </template>
          <template v-else>
            <el-select
              v-model="assignmentMap[task]"
              placeholder="选择模型"
              style="width: 100%"
              @change="onAssignmentChange(task)"
            >
              <el-option label="未分配" value="" />
              <el-option
                v-for="m in models"
                :key="m.id"
                :label="m.name"
                :value="m.id"
              />
            </el-select>
          </template>
        </div>
      </el-card>
    </div>

    <!-- 添加/编辑对话框 -->
    <el-dialog
      v-model="dialogVisible"
      width="640px"
      :close-on-click-modal="false"
      class="edit-dialog"
    >
      <template #header>
        <div class="dialog-header">
          <el-icon size="20" class="dialog-icon">
            <Plus v-if="dialogMode === 'add'" />
            <Edit v-else />
          </el-icon>
          <div class="dialog-title">
            {{ dialogMode === 'add' ? '添加模型' : '编辑模型' }}
          </div>
        </div>
      </template>

      <el-form :model="form" label-width="120px" label-position="right">
        <!-- 分区：连接配置 -->
        <div class="form-section">
          <div class="form-section-title">
            <el-icon><Connection /></el-icon>
            <span>连接配置</span>
          </div>

          <!-- 服务商选择 -->
          <el-form-item label="服务商">
            <el-select
              v-model="form.provider_id"
              placeholder="请选择 LLM 服务商"
              style="width: 100%"
              @change="onProviderChange"
            >
              <el-option
                v-for="p in providers"
                :key="p.id"
                :label="p.name"
                :value="p.id"
              />
              <el-option label="自定义" value="custom" />
            </el-select>
          </el-form-item>

          <!-- 申请 API Key 链接 -->
          <el-form-item v-if="currentProviderWebsite" label=" ">
            <el-link type="primary" :href="currentProviderWebsite" target="_blank" :underline="false">
              <el-icon style="margin-right: 4px"><Link /></el-icon>
              前往 {{ currentProviderName }} 申请 API Key
            </el-link>
          </el-form-item>

          <!-- 名称 -->
          <el-form-item label="名称">
            <el-input
              v-model="form.name"
              placeholder="请输入模型显示名称"
            />
          </el-form-item>

          <!-- API Key -->
          <el-form-item label="API Key">
            <el-input
              v-model="form.api_key"
              :placeholder="dialogMode === 'edit'
                ? `当前: ${currentMaskedKey || '（未设置）'}，留空则不修改`
                : '请输入 API Key'"
              show-password
              clearable
            />
          </el-form-item>

          <!-- Base URL -->
          <el-form-item label="Base URL">
            <el-input
              v-model="form.base_url"
              :placeholder="isCustomProvider ? '请输入 API 基础地址' : '由服务商自动带出'"
              :disabled="!isCustomProvider"
            />
          </el-form-item>

          <!-- 模型名称（可从列表选择，也可手动输入） -->
          <el-form-item label="模型名称">
            <el-select
              v-model="form.model"
              :placeholder="currentProviderModels.length ? '选择或输入模型名称' : '例如 gpt-5.4-thinking'"
              style="width: 100%"
              filterable
              allow-create
              default-first-option
            >
              <el-option
                v-for="m in currentProviderModels"
                :key="m.name"
                :label="m.label"
                :value="m.name"
              >
                <span>{{ m.label }}</span>
                <el-tag
                  v-if="m.recommended_for.length > 0"
                  type="success"
                  size="small"
                  effect="light"
                  style="margin-left: 8px"
                >
                  {{ m.recommended_for.map(t => ({text:'正文',structure:'结构',check:'校验'}[t] || t)).join('/') }}推荐
                </el-tag>
              </el-option>
            </el-select>
          </el-form-item>
        </div>

        <!-- 分区：生成参数 -->
        <div class="form-section">
          <div class="form-section-title">
            <el-icon><Operation /></el-icon>
            <span>生成参数</span>
          </div>
          <el-form-item label="Temperature">
            <div class="slider-row">
              <el-slider
                v-model="form.temperature"
                :min="0"
                :max="2"
                :step="0.1"
                class="slider"
              />
              <el-input-number
                v-model="form.temperature"
                :min="0"
                :max="2"
                :step="0.1"
                :precision="1"
                size="small"
              />
            </div>
          </el-form-item>
          <el-form-item label="Max Tokens">
            <div class="slider-row">
              <el-input-number
                v-model="form.max_tokens"
                :min="1"
                :max="100000"
              />
              <el-button
                text
                type="info"
                @click="form.max_tokens = null"
              >
                置空（不限）
              </el-button>
            </div>
          </el-form-item>
          <el-form-item label="Timeout (秒)">
            <el-input-number
              v-model="form.timeout"
              :min="1"
              :max="600"
            />
          </el-form-item>
          <el-form-item label="Max Retries">
            <el-input-number
              v-model="form.max_retries"
              :min="0"
              :max="10"
            />
          </el-form-item>
        </div>
      </el-form>

      <template #footer>
        <el-button @click="dialogVisible = false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="saveModel">
          <el-icon><Check /></el-icon>
          <span>{{ dialogMode === 'add' ? '添加' : '保存' }}</span>
        </el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, computed, onMounted } from 'vue'
import { ElMessage } from 'element-plus'
import {
  getModels,
  createModel,
  updateModel,
  deleteModel,
  testModel,
  getAssignments,
  updateAssignment,
  getProviders,
  getProjectDir,
  updateProjectDir,
  getSearchConfig,
  updateSearchConfig,
  type ModelEntry,
  type TaskType,
  type CreateModelRequest,
  type UpdateModelRequest,
  type ProviderInfo,
  type ProjectDirConfig,
  type SearchConfig,
} from '@/api'

// ====== 状态 ======
const loading = ref(false)
const saving = ref(false)
const models = ref<ModelEntry[]>([])
const providers = ref<ProviderInfo[]>([])
// 每行测试连接的 loading 状态
const testingMap = reactive<Record<string, boolean>>({})

// 任务分配映射（空字符串表示未分配）
const assignmentMap = reactive<Record<TaskType, string>>({
  text: '',
  structure: '',
  check: '',
})

// 任务类型列表
const taskTypes: TaskType[] = ['text', 'structure', 'check']

// ====== 项目目录状态 ======
const projectDir = ref<ProjectDirConfig>({
  project_dir: 'projects',
  absolute_path: '',
  exists: false,
})
const projectDirInput = ref('projects')
const savingProjectDir = ref(false)

// ====== 联网搜索配置状态 ======
const searchConfig = ref<SearchConfig>({
  tavily_api_key: '',
  tavily_configured: false,
  serper_api_key: '',
  serper_configured: false,
  providers: '',
})
const searchTavilyKey = ref('')
const searchSerperKey = ref('')
const searchProvidersInput = ref('')
const savingSearch = ref(false)

// ====== 对话框状态 ======
const dialogVisible = ref(false)
const dialogMode = ref<'add' | 'edit'>('add')
const editingId = ref<string | null>(null)
const currentMaskedKey = ref('')

// 编辑表单
const form = reactive({
  name: '',
  provider_id: 'custom',
  api_key: '',
  base_url: '',
  model: '',
  temperature: 0.7,
  max_tokens: 1024 as number | null,
  timeout: 60,
  max_retries: 3,
})

// ====== 服务商相关计算属性 ======
const currentProvider = computed(() =>
  providers.value.find(p => p.id === form.provider_id)
)
const isCustomProvider = computed(() => form.provider_id === 'custom')
const currentProviderModels = computed(() => currentProvider.value?.models || [])
const currentProviderWebsite = computed(() => currentProvider.value?.website || '')
const currentProviderName = computed(() => currentProvider.value?.name || '')

// ====== 工具函数 ======

// 任务类型 → 中文标签
const getTaskLabel = (task: TaskType): string => {
  const map: Record<TaskType, string> = {
    text: '文本生成',
    structure: '结构化输出',
    check: '检查校验',
  }
  return map[task]
}

// 任务类型 → 英文描述
const getTaskDesc = (task: TaskType): string => {
  const map: Record<TaskType, string> = {
    text: 'Text Generation',
    structure: 'Structured Output',
    check: 'Validation Check',
  }
  return map[task]
}

// 任务类型 → 详细描述
const getTaskDescription = (task: TaskType): string => {
  const map: Record<TaskType, string> = {
    text: '用于生成小说正文、章节内容等自然语言文本',
    structure: '用于生成大纲、角色卡、章节卡等结构化数据',
    check: '用于检查文本一致性、逻辑合理性等校验任务',
  }
  return map[task]
}

// 服务商 ID → 中文名
const getProviderName = (providerId: string): string => {
  const provider = providers.value.find(p => p.id === providerId)
  return provider?.name || '自定义'
}

// 模型状态 → el-tag 类型
const getStatusType = (status: ModelEntry['status']): 'info' | 'success' | 'danger' => {
  const map: Record<ModelEntry['status'], 'info' | 'success' | 'danger'> = {
    untested: 'info',
    ok: 'success',
    failed: 'danger',
  }
  return map[status]
}

// 模型状态 → 中文标签
const getStatusLabel = (status: ModelEntry['status']): string => {
  const map: Record<ModelEntry['status'], string> = {
    untested: '未测试',
    ok: '正常',
    failed: '失败',
  }
  return map[status]
}

// 格式化时间戳
const formatTime = (iso: string | null): string => {
  if (!iso) return '—'
  const d = new Date(iso)
  if (isNaN(d.getTime())) return iso
  return d.toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

// ====== 数据加载 ======

// 加载模型列表
const loadModels = async () => {
  loading.value = true
  try {
    const { data } = await getModels()
    models.value = data
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : '未知错误'
    ElMessage.error('加载模型列表失败：' + msg)
  } finally {
    loading.value = false
  }
}

// 加载服务商列表
const loadProviders = async () => {
  try {
    const { data } = await getProviders()
    providers.value = data
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : '未知错误'
    ElMessage.error('加载服务商列表失败：' + msg)
  }
}

// 加载任务分配
const loadAssignments = async () => {
  try {
    const { data } = await getAssignments()
    for (const a of data) {
      assignmentMap[a.task] = a.model_id || ''
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : '未知错误'
    ElMessage.error('加载任务分配失败：' + msg)
  }
}

// 加载所有数据
const loadAll = async () => {
  await Promise.all([
    loadProviders(),
    loadModels(),
    loadAssignments(),
    loadProjectDir(),
    loadSearchConfig(),
  ])
}

// ====== 项目目录操作 ======

const loadProjectDir = async () => {
  try {
    const { data } = await getProjectDir()
    projectDir.value = data
    projectDirInput.value = data.project_dir
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : '未知错误'
    ElMessage.error('加载项目目录配置失败: ' + msg)
  }
}

const handleSaveProjectDir = async () => {
  const value = projectDirInput.value.trim()
  if (!value) {
    ElMessage.warning('请输入项目目录路径')
    return
  }
  savingProjectDir.value = true
  try {
    const { data } = await updateProjectDir(value)
    projectDir.value = data
    ElMessage.success('项目目录已保存')
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : '未知错误'
    ElMessage.error('保存失败: ' + msg)
  } finally {
    savingProjectDir.value = false
  }
}

const handleResetProjectDir = () => {
  projectDirInput.value = projectDir.value.project_dir
}

// ====== 联网搜索配置操作 ======

const loadSearchConfig = async () => {
  try {
    const { data } = await getSearchConfig()
    searchConfig.value = data
    searchProvidersInput.value = data.providers
    searchTavilyKey.value = ''
    searchSerperKey.value = ''
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : '未知错误'
    ElMessage.error('加载搜索配置失败: ' + msg)
  }
}

const handleSaveSearchConfig = async () => {
  savingSearch.value = true
  try {
    const { data } = await updateSearchConfig({
      tavily_api_key: searchTavilyKey.value.trim() || undefined,
      serper_api_key: searchSerperKey.value.trim() || undefined,
      providers: searchProvidersInput.value.trim() || undefined,
    })
    searchConfig.value = data
    searchTavilyKey.value = ''
    searchSerperKey.value = ''
    ElMessage.success('搜索配置已保存')
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : '未知错误'
    ElMessage.error('保存失败: ' + msg)
  } finally {
    savingSearch.value = false
  }
}

// ====== 模型操作 ======

// 测试模型连接
const handleTest = async (row: ModelEntry) => {
  testingMap[row.id] = true
  try {
    const { data } = await testModel(row.id)
    if (data.success) {
      ElMessage.success(`连接成功（${data.elapsed_ms}ms）`)
      row.status = 'ok'
    } else {
      ElMessage.error(`连接失败：${data.message}`)
      row.status = 'failed'
    }
    row.last_tested = new Date().toISOString()
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : '未知错误'
    ElMessage.error('测试失败：' + msg)
    row.status = 'failed'
    row.last_tested = new Date().toISOString()
  } finally {
    testingMap[row.id] = false
  }
}

// 删除模型
const handleDelete = async (row: ModelEntry) => {
  try {
    await deleteModel(row.id)
    ElMessage.success('模型已删除')
    await loadModels()
    await loadAssignments()
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : '未知错误'
    ElMessage.error('删除失败：' + msg)
  }
}

// ====== 对话框操作 ======

// 打开添加对话框
const openAddDialog = () => {
  dialogMode.value = 'add'
  editingId.value = null
  currentMaskedKey.value = ''
  Object.assign(form, {
    name: '',
    provider_id: 'custom',
    api_key: '',
    base_url: '',
    model: '',
    temperature: 0.7,
    max_tokens: 1024,
    timeout: 60,
    max_retries: 3,
  })
  dialogVisible.value = true
}

// 打开编辑对话框
const openEditDialog = (row: ModelEntry) => {
  dialogMode.value = 'edit'
  editingId.value = row.id
  currentMaskedKey.value = row.api_key
  Object.assign(form, {
    name: row.name,
    provider_id: row.provider_id,
    api_key: '',
    base_url: row.base_url,
    model: row.model,
    temperature: row.temperature,
    max_tokens: row.max_tokens,
    timeout: row.timeout,
    max_retries: row.max_retries,
  })
  dialogVisible.value = true
}

// 服务商切换处理：自动填充 base_url 和推荐模型
const onProviderChange = (providerId: string) => {
  const provider = providers.value.find(p => p.id === providerId)
  if (!provider || provider.id === 'custom') return

  // 自动填充 Base URL
  form.base_url = provider.base_url

  // 自动选择第一个模型
  if (provider.models.length > 0) {
    form.model = provider.models[0].name
  }
}

// 保存模型（添加或更新）
const saveModel = async () => {
  // 基本校验
  if (!form.name.trim()) {
    ElMessage.warning('请输入模型名称')
    return
  }
  if (!form.base_url.trim()) {
    ElMessage.warning('请输入 Base URL')
    return
  }
  if (!form.model.trim()) {
    ElMessage.warning('请输入或选择模型')
    return
  }
  if (dialogMode.value === 'add' && !form.api_key.trim()) {
    ElMessage.warning('请输入 API Key')
    return
  }

  saving.value = true
  try {
    if (dialogMode.value === 'add') {
      const payload: CreateModelRequest = {
        name: form.name.trim(),
        provider_id: form.provider_id,
        api_key: form.api_key.trim(),
        base_url: form.base_url.trim(),
        model: form.model.trim(),
        temperature: form.temperature,
        max_tokens: form.max_tokens,
        timeout: form.timeout,
        max_retries: form.max_retries,
      }
      await createModel(payload)
      ElMessage.success('模型添加成功')
    } else {
      const payload: UpdateModelRequest = {
        name: form.name.trim(),
        provider_id: form.provider_id,
        base_url: form.base_url.trim(),
        model: form.model.trim(),
        temperature: form.temperature,
        max_tokens: form.max_tokens,
        timeout: form.timeout,
        max_retries: form.max_retries,
      }
      // 仅当用户输入了新的 API Key 时才发送
      if (form.api_key && form.api_key.trim()) {
        payload.api_key = form.api_key.trim()
      }
      await updateModel(editingId.value!, payload)
      ElMessage.success('模型更新成功')
    }
    dialogVisible.value = false
    await loadModels()
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : '未知错误'
    ElMessage.error('保存失败：' + msg)
  } finally {
    saving.value = false
  }
}

// ====== 任务分配操作 ======

// 任务分配变更
const onAssignmentChange = async (task: TaskType) => {
  const value = assignmentMap[task]
  const modelId = value || null
  try {
    await updateAssignment(task, modelId)
    ElMessage.success(`${getTaskLabel(task)} 分配已更新`)
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : '未知错误'
    ElMessage.error('分配失败：' + msg)
    // 失败后重新加载分配状态
    await loadAssignments()
  }
}

// ====== 初始化 ======
onMounted(() => {
  loadAll()
})
</script>

<style scoped>
.config-view {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

/* ====== 页头 ====== */
.page-header :deep(.el-card__body) {
  padding: 20px 24px;
  background: linear-gradient(135deg, #f5f9ff 0%, #ffffff 60%);
}

.header-content {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 16px;
}

.header-title-group h2 {
  margin: 0 0 6px 0;
  font-size: 20px;
  font-weight: 600;
  color: var(--text-primary);
}

.header-title-group p {
  margin: 0;
  font-size: 13px;
  color: var(--text-secondary);
}

.header-actions {
  display: flex;
  gap: 8px;
  flex-shrink: 0;
}

/* ====== 项目目录卡片 ====== */
.project-dir-card {
  border-left: 4px solid var(--el-color-success) !important;
}

.project-dir-card :deep(.el-card__header) {
  padding: 16px 20px;
}

.project-dir-card :deep(.el-card__body) {
  padding: 18px 20px;
}

.project-dir-body {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.dir-input-row {
  display: flex;
  gap: 8px;
  align-items: center;
}

.dir-input {
  flex: 1;
}

.dir-info {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  color: var(--text-secondary);
  flex-wrap: wrap;
}

.dir-info-icon {
  color: var(--el-color-info);
  flex-shrink: 0;
}

.dir-info-text {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}

.dir-path-code {
  font-family: 'Consolas', 'Monaco', 'Courier New', monospace;
  font-size: 12px;
  background: var(--el-fill-color-light);
  padding: 2px 8px;
  border-radius: 4px;
  color: var(--text-regular);
}

.dir-info-hint {
  color: var(--text-placeholder);
  font-size: 12px;
}

/* ====== 联网搜索配置卡片 ====== */
.search-config-form {
  max-width: 960px;
}

.search-config-row {
  display: flex;
  gap: 16px;
  flex-wrap: wrap;
}

.search-config-row .el-form-item {
  flex: 1;
  min-width: 300px;
}

.search-providers-hint {
  font-size: 12px;
  color: var(--text-placeholder);
  margin-top: 4px;
  line-height: 1.6;
}

.search-config-actions {
  margin-top: 8px;
}

/* ====== 模型池卡片 ====== */
.pool-card :deep(.el-card__header) {
  padding: 16px 20px;
}

.card-header-title {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 15px;
  font-weight: 600;
  color: var(--text-primary);
}

.header-icon {
  color: var(--app-primary);
}

.pool-card :deep(.el-card__body) {
  padding: 0;
}

.pool-card :deep(.el-table) {
  border-radius: 0 0 8px 8px;
}

/* ====== 区块标题 ====== */
.section-title {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 15px;
  font-weight: 600;
  color: var(--text-primary);
  padding: 4px 0;
}

.section-icon {
  color: var(--app-primary);
}

/* ====== 任务分配卡片网格 ====== */
.assignment-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 16px;
}

@media (max-width: 1200px) {
  .assignment-grid {
    grid-template-columns: repeat(2, 1fr);
  }
}

@media (max-width: 768px) {
  .assignment-grid {
    grid-template-columns: 1fr;
  }
}

/* ====== 分配卡片 ====== */
.assignment-card {
  position: relative;
  overflow: hidden;
  transition: transform 0.25s cubic-bezier(0.4, 0, 0.2, 1),
    box-shadow 0.25s cubic-bezier(0.4, 0, 0.2, 1);
}

.assignment-card:hover {
  transform: translateY(-2px);
}

.assignment-card :deep(.el-card__body) {
  padding: 0;
}

.card-stripe {
  height: 4px;
  width: 100%;
}

.stripe-text {
  background: linear-gradient(90deg, #409eff 0%, #6f8cff 100%);
}

.stripe-structure {
  background: linear-gradient(90deg, #67c23a 0%, #85d667 100%);
}

.stripe-check {
  background: linear-gradient(90deg, #e6a23c 0%, #f0b860 100%);
}

.card-top {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 18px 20px 12px;
  gap: 12px;
}

.task-info {
  display: flex;
  align-items: center;
  gap: 12px;
  min-width: 0;
}

.task-icon {
  width: 40px;
  height: 40px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 10px;
  color: #ffffff;
  flex-shrink: 0;
}

.icon-text {
  background: linear-gradient(135deg, #409eff 0%, #6f8cff 100%);
  box-shadow: 0 4px 10px rgba(64, 158, 255, 0.3);
}

.icon-structure {
  background: linear-gradient(135deg, #67c23a 0%, #85d667 100%);
  box-shadow: 0 4px 10px rgba(103, 194, 58, 0.3);
}

.icon-check {
  background: linear-gradient(135deg, #e6a23c 0%, #f0b860 100%);
  box-shadow: 0 4px 10px rgba(230, 162, 60, 0.3);
}

.task-meta {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.task-name {
  font-size: 15px;
  font-weight: 600;
  color: var(--text-primary);
}

.task-desc {
  font-size: 11px;
  color: var(--text-secondary);
  letter-spacing: 0.3px;
}

/* ====== 分配卡片内容区 ====== */
.assignment-body {
  padding: 0 20px 18px;
}

.assignment-desc {
  margin: 0 0 14px 0;
  font-size: 13px;
  color: var(--text-regular);
  line-height: 1.6;
}

/* ====== 编辑对话框 ====== */
.dialog-header {
  display: flex;
  align-items: center;
  gap: 12px;
}

.dialog-icon {
  color: var(--app-primary);
}

.dialog-title {
  font-size: 16px;
  font-weight: 600;
  color: var(--text-primary);
}

.form-section {
  margin-bottom: 20px;
}

.form-section:last-child {
  margin-bottom: 0;
}

.form-section-title {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  font-weight: 600;
  color: var(--text-regular);
  margin-bottom: 14px;
  padding-bottom: 8px;
  border-bottom: 1px solid var(--border-color-light);
}

.form-section-title .el-icon {
  color: var(--app-primary);
}

.slider-row {
  display: flex;
  align-items: center;
  gap: 16px;
  width: 100%;
}

.slider {
  flex: 1;
}

.mono {
  font-family: 'Consolas', 'Monaco', 'Courier New', monospace;
  font-size: 13px;
  word-break: break-all;
}
</style>
