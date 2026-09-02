<template>
  <div class="outline-tab">
    <div v-if="loading" class="app-empty">
      <el-icon class="is-loading" :size="26"><Loading /></el-icon>
      <span>加载中...</span>
    </div>
    <el-alert v-else-if="error" :title="error" type="error" :closable="false" show-icon class="mv-16" />

    <template v-else>
      <!-- 模板驱动的结构化展示 -->
      <template v-if="hasTemplateData">
        <div class="ol-template-info">
          <el-tag type="warning" effect="plain">
            模板: {{ template?.label || outlineData?.template_id }}
          </el-tag>
          <span class="ol-template-desc">{{ template?.description }}</span>
        </div>

        <div class="ol-tree-container">
          <el-tree
            :data="treeData"
            :props="treeProps"
            node-key="id"
            default-expand-all
            :expand-on-click-node="false"
          >
            <template #default="{ data }">
              <div class="ol-tree-node">
                <div class="ol-node-header">
                  <el-tag :type="getNodeTypeTag(data.type)" size="small">
                    {{ getNodeTypeLabel(data.type) }}
                  </el-tag>
                  <span class="ol-node-title">{{ getNodeTitle(data) }}</span>
                </div>
                <div class="ol-node-props">
                  <div
                    v-for="prop in getNodeProperties(data.type)"
                    :key="prop.key"
                    class="ol-prop-row"
                  >
                    <span class="ol-prop-label">{{ prop.label }}:</span>
                    <span class="ol-prop-value">{{ formatPropValue(data[prop.key], prop.type) }}</span>
                  </div>
                </div>
              </div>
            </template>
          </el-tree>
        </div>
      </template>

      <!-- 旧格式兼容 -->
      <div v-if="hasLegacyData && !hasTemplateData" class="ol-panel lift-card">
        <div class="ol-panel-head">
          <span class="ol-panel-title">
            <el-icon><DataAnalysis /></el-icon>
            大纲设定
          </span>
        </div>
        <div class="ol-panel-body">
          <DataExplorer :data="legacyData" />
        </div>
      </div>

      <!-- 空状态 -->
      <div v-if="!hasTemplateData && !hasLegacyData" class="app-empty">
        <el-icon :size="44" color="#c0c4cc"><DocumentRemove /></el-icon>
        <span class="settings-empty-title">暂无大纲设定</span>
        <span class="settings-empty-hint">可前往「创作引擎」与 Agent 对话，引导生成对应内容</span>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRoute } from 'vue-router'
import { DocumentRemove, Loading, DataAnalysis } from '@element-plus/icons-vue'
import {
  getSetting,
  getOutlineTemplates,
  type OutlineTemplate,
  type OutlineData,
    type OutlineNodeProperty,
} from '@/api'
import DataExplorer from '@/components/DataExplorer.vue'

const route = useRoute()
const projectId = route.params.id as string

const loading = ref(false)
const error = ref('')

// 模板相关
const templates = ref<OutlineTemplate[]>([])
const template = computed(() => {
  if (!outlineData.value) return null
  return templates.value.find(t => t.id === outlineData.value!.template_id) || null
})

// 数据相关
const outlineData = ref<OutlineData | null>(null)
const legacyData = ref<any>(null)

// 树形数据
const treeData = computed(() => {
  if (!outlineData.value?.root) return []
  return [outlineData.value.root]
})

const treeProps = {
  children: 'children',
  label: 'title',
}

// 判断是否有模板驱动的数据
const hasTemplateData = computed(() => {
  return outlineData.value &&
    outlineData.value?.template_id &&
    outlineData.value.root
})

// 判断是否有旧格式数据
const hasLegacyData = computed(() => {
  if (!legacyData.value) return false
  if (hasTemplateData.value) return false
  return legacyData.value.root
})

function getNodeTypeLabel(type: string): string {
  const labels: Record<string, string> = {
    story: '故事',
    volume: '卷',
    arc: '篇章',
    chapter: '章节',
  }
  return labels[type] || type
}

function getNodeTypeTag(type: string): string {
  const types: Record<string, string> = {
    story: 'danger',
    volume: 'warning',
    arc: 'primary',
    chapter: 'success',
  }
  return types[type] || 'info'
}

function getNodeTitle(node: any): string {
  return node.title || node.name || '章节' || '未命名'
}

function getNodeProperties(type: string): OutlineNodeProperty[] {
  if (!template.value) return []
  return template.value.nodeProperties[type as keyof typeof template.value.nodeProperties] || []
}

function formatPropValue(value: any, type: string): string {
  if (value === null || value === undefined) return '未设置'
  if (type === 'tags' && Array.isArray(value)) {
    return value.join(', ')
  }
  if (type === 'number') {
    return String(value)
  }
  return String(value)
}

onMounted(async () => {
  loading.value = true
  try {
    const [templatesResp, settingResp] = await Promise.allSettled([
      getOutlineTemplates(),
      getSetting(projectId, 'outline'),
    ])

    if (templatesResp.status === 'fulfilled') {
      templates.value = templatesResp.value.data
    }

    if (settingResp.status === 'fulfilled') {
      const data = settingResp.value.data as any
      legacyData.value = data

      if (data.template_id && data.root) {
        outlineData.value = data as OutlineData
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
.outline-tab {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.ol-template-info {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 16px;
  background: linear-gradient(90deg, #fffbeb 0%, #fef3c7 100%);
  border-radius: 8px;
  border: 1px solid #fbbf24;
}

.ol-template-desc {
  font-size: 13px;
  color: #92400e;
}

.ol-tree-container {
  background: #fff;
  border: 1px solid var(--border-color-light);
  border-radius: 12px;
  padding: 16px;
  box-shadow: var(--card-shadow);
}

.ol-tree-node {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 8px 0;
}

.ol-node-header {
  display: flex;
  align-items: center;
  gap: 8px;
}

.ol-node-title {
  font-size: 14px;
  font-weight: 600;
  color: var(--text-primary);
}

.ol-node-props {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding-left: 12px;
  border-left: 2px solid var(--border-color-lighter);
}

.ol-prop-row {
  display: flex;
  gap: 8px;
  font-size: 12px;
}

.ol-prop-label {
  color: var(--text-secondary);
  font-weight: 500;
  min-width: 80px;
}

.ol-prop-value {
  color: var(--text-regular);
  flex: 1;
}

.ol-panel {
  background: #fff;
  border: 1px solid var(--border-color-light);
  border-radius: 12px;
  overflow: hidden;
  box-shadow: var(--card-shadow);
}

.ol-panel-head {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 16px;
  border-bottom: 1px solid var(--border-color-light);
  background: linear-gradient(90deg, #fafafa 0%, #ffffff 100%);
}

.ol-panel-title {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  font-size: 14px;
  font-weight: 600;
  color: var(--text-primary);
}

.ol-panel-title .el-icon { color: #6366f1; }

.ol-panel-body {
  padding: 14px 18px;
}

.settings-empty-title { font-size: 15px; font-weight: 500; color: var(--text-regular); }
.settings-empty-hint { font-size: 12px; color: var(--text-placeholder); }
</style>









