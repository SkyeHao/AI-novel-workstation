<template>
  <div class="worldview-tab">
    <div v-if="loading" class="app-empty">
      <el-icon class="is-loading" :size="26"><Loading /></el-icon>
      <span>加载中...</span>
    </div>
    <el-alert v-else-if="error" :title="error" type="error" :closable="false" show-icon class="mv-16" />

    <template v-else>
      <!-- 模板驱动的结构化展示 -->
      <template v-if="hasTemplateData">
        <div class="wv-template-info">
          <el-tag type="primary" effect="plain">
            模板: {{ template?.label || worldviewData?.template_id }}
          </el-tag>
          <span class="wv-template-desc">{{ template?.description }}</span>
        </div>

        <div class="wv-dimensions-grid">
          <el-card
            v-for="dim in templateDimensions"
            :key="dim.key"
            class="wv-dimension-card"
            :class="{ 'is-empty': !getDimensionValue(dim.key) }"
            shadow="hover"
          >
            <template #header>
              <div class="wv-dim-header">
                <div class="wv-dim-title">
                  <span class="wv-dim-label">{{ dim.label }}</span>
                  <el-tag v-if="dim.required" type="danger" size="small" effect="plain">必填</el-tag>
                </div>
                <el-button
                  v-if="editingKey === dim.key"
                  type="primary"
                  size="small"
                  @click="saveDimension(dim.key)"
                  :loading="saving"
                >
                  保存
                </el-button>
                <el-button
                  v-else
                  type="primary"
                  size="small"
                  text
                  @click="startEdit(dim.key)"
                >
                  <el-icon><Edit /></el-icon>
                  编辑
                </el-button>
              </div>
            </template>

            <div class="wv-dim-hint">{{ dim.hint }}</div>

            <!-- 编辑模式 -->
            <template v-if="editingKey === dim.key">
              <el-input
                v-if="dim.type === 'text'"
                v-model="editValue"
                :placeholder="dim.placeholder"
                class="wv-dim-input"
              />
              <el-input
                v-else-if="dim.type === 'textarea'"
                v-model="editValue"
                type="textarea"
                :rows="4"
                :placeholder="dim.placeholder"
                class="wv-dim-input"
              />
              <el-select
                v-else-if="dim.type === 'select'"
                v-model="editValue"
                :placeholder="dim.placeholder"
                class="wv-dim-input"
              >
                <el-option
                  v-for="opt in dim.options"
                  :key="opt"
                  :label="opt"
                  :value="opt"
                />
              </el-select>
            </template>

            <!-- 展示模式 -->
            <template v-else>
              <div v-if="dim.type === 'tags'" class="wv-dim-tags">
                <el-tag
                  v-for="tag in getDimensionTags(dim.key)"
                  :key="tag"
                  class="wv-tag"
                  effect="plain"
                >
                  {{ tag }}
                </el-tag>
                <span v-if="!getDimensionValue(dim.key)" class="wv-dim-empty">未设置</span>
              </div>
              <div v-else-if="getDimensionValue(dim.key)" class="wv-dim-content">
                {{ getDimensionValue(dim.key) }}
              </div>
              <div v-else class="wv-dim-empty">未设置</div>
            </template>
          </el-card>
        </div>
      </template>

      <!-- 旧格式兼容：Markdown 文档展示 -->
      <div v-if="docContent && !hasTemplateData" class="wv-panel lift-card">
        <div class="wv-panel-head">
          <span class="wv-panel-title">
            <el-icon><Document /></el-icon>
            世界观设定文档
          </span>
          <span class="wv-panel-sub">{{ docName }}</span>
        </div>
        <div class="wv-panel-body">
          <MarkdownView :content="docContent" />
        </div>
      </div>

      <!-- 旧格式兼容：结构化数据展示 -->
      <div v-if="hasLegacyStructured && !hasTemplateData" class="wv-panel lift-card">
        <div class="wv-panel-head">
          <span class="wv-panel-title">
            <el-icon><DataAnalysis /></el-icon>
            结构化设定
          </span>
          <span class="wv-panel-sub">settings/worldview.json</span>
        </div>
        <div class="wv-panel-body">
          <DataExplorer :data="structured" />
        </div>
      </div>

      <!-- 空状态 -->
      <div v-if="!hasTemplateData && !docContent && !hasLegacyStructured" class="app-empty">
        <el-icon :size="44" color="#c0c4cc"><DocumentRemove /></el-icon>
        <span class="settings-empty-title">暂无世界观设定</span>
        <span class="settings-empty-hint">可前往「创作引擎」与 Agent 对话，引导生成对应内容</span>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRoute } from 'vue-router'
import { ElMessage } from 'element-plus'
import { Document, DataAnalysis, DocumentRemove, Loading, Edit } from '@element-plus/icons-vue'
import {
  getSetting,
  saveSetting,
  getProjectDocumentsByKind,
  readProjectDocument,
  getWorldviewTemplates,
  type WorldviewTemplate,
  type WorldviewData,
} from '@/api'
import DataExplorer from '@/components/DataExplorer.vue'
import MarkdownView from '@/components/MarkdownView.vue'

const route = useRoute()
const projectId = route.params.id as string

const loading = ref(false)
const saving = ref(false)
const error = ref('')

// 模板相关
const templates = ref<WorldviewTemplate[]>([])
const template = computed(() => {
  if (!worldviewData.value) return null
  return templates.value.find(t => t.id === worldviewData.value!.template_id) || null
})
const templateDimensions = computed(() => template.value?.dimensions || [])

// 数据相关
const worldviewData = ref<WorldviewData | null>(null)
const structured = ref<any>(null)
const docContent = ref('')
const docName = ref('世界观设定文档')

// 编辑相关
const editingKey = ref<string | null>(null)
const editValue = ref('')

// 判断是否有模板驱动的数据
const hasTemplateData = computed(() => {
  return worldviewData.value &&
    worldviewData.value.template_id &&
    worldviewData.value.dimensions &&
    Object.keys(worldviewData.value.dimensions).length > 0
})

// 判断是否有旧格式的结构化数据
const hasLegacyStructured = computed(() => {
  if (!structured.value) return false
  if (hasTemplateData.value) return false
  return !isStructuredEmpty(structured.value)
})

function getDimensionValue(key: string): any {
  if (!worldviewData.value?.dimensions) return null
  return worldviewData.value.dimensions[key]
}

function getDimensionTags(key: string): string[] {
  const value = getDimensionValue(key)
  if (!value) return []
  if (Array.isArray(value)) return value
  if (typeof value === 'string') {
    return value.split(/[,，、]/).map((s: string) => s.trim()).filter(Boolean)
  }
  return []
}

function startEdit(key: string) {
  editingKey.value = key
  const value = getDimensionValue(key)
  if (Array.isArray(value)) {
    editValue.value = value.join(', ')
  } else {
    editValue.value = value || ''
  }
}

async function saveDimension(key: string) {
  if (!worldviewData.value) return

  saving.value = true
  try {
    // 获取维度类型
    const dim = templateDimensions.value.find(d => d.key === key)
    let newValue: any = editValue.value

    // 如果是 tags 类型，转换为数组
    if (dim?.type === 'tags') {
      newValue = editValue.value.split(/[,，、]/).map((s: string) => s.trim()).filter(Boolean)
    }

    // 更新数据
    worldviewData.value.dimensions[key] = newValue

    // 保存到后端
    await saveSetting(projectId, 'worldview', worldviewData.value as any)

    editingKey.value = null
    ElMessage.success('保存成功')
  } catch (err) {
    ElMessage.error('保存失败')
  } finally {
    saving.value = false
  }
}

/** 判定结构化设定是否为空 */
function isStructuredEmpty(d: unknown): boolean {
  if (!d || typeof d !== 'object') return true
  const obj = d as Record<string, unknown>
  const vals = Object.values(obj)
  if (vals.length === 0) return true
  const sections = obj.sections as Record<string, unknown> | undefined
  if (sections) return !Object.values(sections).some((v) => typeof v === 'string' && v.trim() !== '')
  return vals.every((v) => {
    if (typeof v === 'string') return v.trim() === ''
    if (Array.isArray(v)) return v.length === 0
    if (v && typeof v === 'object') return isStructuredEmpty(v)
    return false
  })
}

onMounted(async () => {
  loading.value = true
  try {
    // 并行加载模板列表和设定数据
    const [templatesResp, docResp, settingResp] = await Promise.allSettled([
      getWorldviewTemplates(),
      getProjectDocumentsByKind(projectId, 'worldview'),
      getSetting(projectId, 'worldview'),
    ])

    // 加载模板列表
    if (templatesResp.status === 'fulfilled') {
      templates.value = templatesResp.value.data
    }

    // 加载 Markdown 文档
    if (docResp.status === 'fulfilled') {
      const docs = docResp.value.data.documents
      const first = docs && docs.length > 0 ? docs[0] : null
      if (first) {
        docName.value = first.title || first.name || '世界观设定文档'
        const rd = await readProjectDocument(projectId, first.path)
        if (rd.data.success && rd.data.content && rd.data.content.trim()) {
          docContent.value = rd.data.content
        }
      }
    }

    // 加载结构化数据
    if (settingResp.status === 'fulfilled') {
      const data = settingResp.value.data as any
      structured.value = data

      // 判断是否是新格式（有 template_id 和 dimensions）
      if (data.template_id && data.dimensions) {
        worldviewData.value = data as WorldviewData
      }
    }
  } catch (err: unknown) {
    const e = err as { message?: string }
    error.value = e?.message || '加载失败'
  } finally {
    loading.value = false
  }
})
</script>

<style scoped>
.worldview-tab {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.mv-16 { margin-bottom: 16px; }

/* 模板信息 */
.wv-template-info {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 16px;
  background: linear-gradient(90deg, #f0f9ff 0%, #e0f2fe 100%);
  border-radius: 8px;
  border: 1px solid #bae6fd;
}

.wv-template-desc {
  font-size: 13px;
  color: #0369a1;
}

/* 维度卡片网格 */
.wv-dimensions-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(380px, 1fr));
  gap: 16px;
}

.wv-dimension-card {
  transition: all 0.2s ease;
}

.wv-dimension-card:hover {
  transform: translateY(-2px);
}

.wv-dimension-card.is-empty {
  opacity: 0.7;
}

.wv-dim-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.wv-dim-title {
  display: flex;
  align-items: center;
  gap: 8px;
}

.wv-dim-label {
  font-size: 15px;
  font-weight: 600;
  color: var(--text-primary);
}

.wv-dim-hint {
  font-size: 12px;
  color: var(--text-secondary);
  margin-bottom: 12px;
  padding: 6px 10px;
  background: #f8fafc;
  border-radius: 6px;
  border-left: 3px solid #6366f1;
}

.wv-dim-input {
  margin-top: 8px;
}

.wv-dim-content {
  font-size: 14px;
  line-height: 1.7;
  color: var(--text-regular);
  white-space: pre-wrap;
  word-break: break-word;
}

.wv-dim-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.wv-tag {
  max-width: 200px;
  overflow: hidden;
  text-overflow: ellipsis;
}

.wv-dim-empty {
  font-size: 13px;
  color: var(--text-placeholder);
  font-style: italic;
}

/* 旧格式兼容样式 */
.wv-panel {
  background: #fff;
  border: 1px solid var(--border-color-light);
  border-radius: 12px;
  overflow: hidden;
  box-shadow: var(--card-shadow);
}

.wv-panel-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 12px 16px;
  border-bottom: 1px solid var(--border-color-light);
  background: linear-gradient(90deg, #fafafa 0%, #ffffff 100%);
}

.wv-panel-title {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  font-size: 14px;
  font-weight: 600;
  color: var(--text-primary);
}

.wv-panel-title .el-icon { color: #6366f1; }

.wv-panel-sub {
  font-size: 12px;
  color: var(--text-secondary);
}

.wv-panel-body {
  padding: 14px 18px;
}

.settings-empty-title { font-size: 15px; font-weight: 500; color: var(--text-regular); }
.settings-empty-hint { font-size: 12px; color: var(--text-placeholder); }
</style>

