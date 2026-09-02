<template>
  <div class="style-tab">
    <div v-if="loading" class="loading">加载中...</div>
    <div v-else-if="error" class="error">{{ error }}</div>
    <template v-else>
      <!-- 模板选择 -->
      <div class="template-selector">
        <el-select v-model="selectedTemplateId" placeholder="选择风格模板" @change="onTemplateChange">
          <el-option
            v-for="template in templates"
            :key="template.id"
            :label="template.label"
            :value="template.id"
          >
            <span>{{ template.label }}</span>
            <span style="color: #8492a6; font-size: 13px; margin-left: 8px">{{ template.description }}</span>
          </el-option>
        </el-select>
      </div>

      <!-- 维度编辑 -->
      <div v-if="currentTemplate" class="dimensions-grid">
        <el-card
          v-for="dim in currentTemplate.dimensions"
          :key="dim.key"
          class="dimension-card"
          :class="{ required: dim.required }"
        >
          <template #header>
            <div class="dimension-header">
              <span class="dimension-label">{{ dim.label }}</span>
              <el-tag v-if="dim.required" type="danger" size="small">必填</el-tag>
            </div>
          </template>
          <div class="dimension-hint">{{ dim.hint }}</div>
          <div class="dimension-input">
            <el-input
              v-if="dim.type === 'text'"
              v-model="dimensions[dim.key]"
              :placeholder="dim.placeholder || '请输入'"
            />
            <el-input
              v-else-if="dim.type === 'textarea'"
              v-model="dimensions[dim.key]"
              type="textarea"
              :rows="4"
              :placeholder="dim.placeholder || '请输入'"
            />
            <el-select
              v-else-if="dim.type === 'select'"
              v-model="dimensions[dim.key]"
              :placeholder="dim.placeholder || '请选择'"
            >
              <el-option
                v-for="option in dim.options"
                :key="option"
                :label="option"
                :value="option"
              />
            </el-select>
            <div v-else-if="dim.type === 'tags'" class="tags-input">
              <el-tag
                v-for="tag in getTags(dim.key)"
                :key="tag"
                closable
                @close="removeTag(dim.key, tag)"
                style="margin-right: 8px; margin-bottom: 8px;"
              >
                {{ tag }}
              </el-tag>
              <el-input
                v-if="tagInputs[dim.key] !== undefined"
                v-model="tagInputs[dim.key]"
                size="small"
                style="width: 150px;"
                @keyup.enter="addTag(dim.key)"
                @blur="addTag(dim.key)"
                placeholder="输入后回车"
              />
              <el-button
                v-else
                size="small"
                @click="tagInputs[dim.key] = ''"
              >
                + 添加标签
              </el-button>
            </div>
          </div>
        </el-card>
      </div>

      <!-- 保存按钮 -->
      <div class="actions">
        <el-button type="primary" @click="saveStyle" :loading="saving">保存风格设定</el-button>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, computed } from 'vue'
import { getStyleTemplates, getSetting, saveSetting } from '@/api'


interface StyleDimension {
  key: string
  label: string
  hint: string
  type: 'text' | 'textarea' | 'tags' | 'select'
  required: boolean
  options?: string[]
  placeholder?: string
}

interface StyleTemplate {
  id: string
  label: string
  description: string
  dimensions: StyleDimension[]
}

const props = defineProps<{
  projectId: string
}>()

const loading = ref(true)
const saving = ref(false)
const error = ref('')
const templates = ref<StyleTemplate[]>([])
const selectedTemplateId = ref('')
const dimensions = ref<Record<string, any>>({})
const tagInputs = ref<Record<string, string>>({})

const currentTemplate = computed(() => {
  return templates.value.find(t => t.id === selectedTemplateId.value)
})

onMounted(async () => {
  try {
    // 加载模板列表
    const templatesRes = await getStyleTemplates()
    templates.value = templatesRes.data

    // 加载现有设定
    const settingRes = await getSetting(props.projectId, 'style')
    const data = settingRes.data as any
    if (data && data.template_id) {
      selectedTemplateId.value = data.template_id
      dimensions.value = data.dimensions || {}
    } else if (templates.value.length > 0) {
      selectedTemplateId.value = templates.value[0].id
    }
  } catch (e) {
    error.value = e instanceof Error ? e.message : '加载失败'
  } finally {
    loading.value = false
  }
})

function onTemplateChange() {
  // 切换模板时保留已有的维度值
}

function getTags(key: string): string[] {
  const value = dimensions.value[key]
  if (Array.isArray(value)) return value
  if (typeof value === 'string' && value) return [value]
  return []
}

function addTag(key: string) {
  const input = tagInputs.value[key]
  if (!input || !input.trim()) return

  const tags = getTags(key)
  if (!tags.includes(input.trim())) {
    dimensions.value[key] = [...tags, input.trim()]
  }
  tagInputs.value[key] = ''
}

function removeTag(key: string, tag: string) {
  const tags = getTags(key).filter(t => t !== tag)
  dimensions.value[key] = tags.length > 0 ? tags : ''
}

async function saveStyle() {
  if (!currentTemplate.value) return

  // 验证必填字段
  const missing = currentTemplate.value.dimensions
    .filter(d => d.required && !dimensions.value[d.key])
    .map(d => d.label)
  
  if (missing.length > 0) {
    error.value = `请填写必填字段：${missing.join('、')}`
    return
  }

  saving.value = true
  error.value = ''

  try {
    const data = {
      template_id: selectedTemplateId.value,
      dimensions: dimensions.value,
    }
    await saveSetting(props.projectId, 'style', data as any)
    alert('保存成功')
  } catch (e) {
    error.value = e instanceof Error ? e.message : '保存失败'
  } finally {
    saving.value = false
  }
}
</script>

<style scoped>
.style-tab {
  padding: 20px;
}

.template-selector {
  margin-bottom: 24px;
}

.dimensions-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(400px, 1fr));
  gap: 20px;
  margin-bottom: 24px;
}

.dimension-card {
  border: 1px solid #e4e7ed;
}

.dimension-card.required {
  border-left: 3px solid #f56c6c;
}

.dimension-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.dimension-label {
  font-weight: 600;
  font-size: 15px;
}

.dimension-hint {
  color: #909399;
  font-size: 13px;
  margin-bottom: 12px;
}

.tags-input {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
}

.actions {
  display: flex;
  justify-content: flex-end;
}

.loading, .error {
  text-align: center;
  padding: 40px;
  color: #909399;
}

.error {
  color: #f56c6c;
}
</style>



