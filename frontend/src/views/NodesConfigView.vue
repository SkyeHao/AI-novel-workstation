<template>
  <div class="nodes-config-view">
    <PageHeader title="节点配置" subtitle="为每个流程节点分配使用的大模型" icon="Operation">
      <template #actions>
        <el-button type="primary" plain :loading="loading" @click="loadData">
          <el-icon style="margin-right: 6px"><Refresh /></el-icon>
          刷新
        </el-button>
      </template>
    </PageHeader>

    <div class="panel">
      <div class="panel-head">
        <div class="panel-title-group">
          <el-icon class="panel-title-icon"><Switch /></el-icon>
          <span class="panel-title">节点模型分配</span>
          <span class="panel-subtitle">未分配时使用默认模型</span>
        </div>
        <div class="panel-actions">
          <el-tag size="small" type="warning" effect="plain" round>{{ assignedCount }} / {{ nodeAssignments.length }} 已分配</el-tag>
        </div>
      </div>
      <div class="panel-body panel-body-flat">
        <el-table :data="nodeAssignments" style="width: 100%">
          <el-table-column prop="nodeKey" label="流程节点" width="200">
            <template #default="{ row }">
              <div class="node-info">
                <div class="node-dot" :style="{ background: getNodeColor(row.nodeKey) }"></div>
                <span class="node-label">{{ getNodeLabel(row.nodeKey) }}</span>
              </div>
            </template>
          </el-table-column>
          <el-table-column label="当前模型" min-width="260">
            <template #default="{ row }">
              <span v-if="row.modelId" class="model-name">
                <el-icon class="model-check"><CircleCheckFilled /></el-icon>
                {{ getModelName(row.modelId) }}
              </span>
              <span v-else class="muted">
                <el-icon class="model-empty"><Warning /></el-icon>
                未分配（使用默认）
              </span>
            </template>
          </el-table-column>
          <el-table-column label="操作" width="280" align="center">
            <template #default="{ row }">
              <el-select
                v-model="row.modelId"
                placeholder="选择模型"
                clearable
                style="width: 100%"
                @change="(val: string) => handleAssignmentChange(row.nodeKey, val)"
              >
                <el-option v-for="m in models" :key="m.id" :label="m.name + ' (' + m.model + ')'" :value="m.id" />
              </el-select>
            </template>
          </el-table-column>
        </el-table>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, onMounted } from 'vue'
import { ElMessage } from 'element-plus'
import { getModels, getAssignments, updateAssignment } from '@/api'
import PageHeader from '@/components/PageHeader.vue'

const loading = ref(false)
const models = ref<any[]>([])
const nodeAssignments = ref<any[]>([])

const NODE_LABELS: Record<string, string> = {
  ideation: '灵感捕捉',
  worldview: '世界观构建',
  characters: '人物塑造',
  outline: '大纲生成',
  writing: '正文生成',
  review: '质量审查',
  style: '文风优化',
}

const NODE_COLORS: Record<string, string> = {
  ideation: '#6366f1',
  worldview: '#4f46e5',
  characters: '#00b578',
  outline: '#ff9f43',
  writing: '#eb5757',
  review: '#ef4444',
  style: '#8b5cf6',
}

const assignedCount = computed(() => nodeAssignments.value.filter((a) => !!a.modelId).length)

function getNodeLabel(key: string): string {
  return NODE_LABELS[key] || key
}

function getNodeColor(key: string): string {
  return NODE_COLORS[key] || '#999'
}

function getModelName(modelId: string): string {
  const m = models.value.find((x) => x.id === modelId)
  return m ? m.name + ' (' + m.model + ')' : modelId
}

async function loadModels() {
  try {
    const res = await getModels()
    models.value = res.data
  } catch (err) {
    ElMessage.error('加载模型列表失败')
  }
}

async function loadAssignments() {
  try {
    const res = await getAssignments()
    const assignmentMap = new Map(res.data.map((a: any) => [a.state, a.model_id]))
    nodeAssignments.value = Object.keys(NODE_LABELS).map((key) => ({
      nodeKey: key,
      modelId: assignmentMap.get(key) || '',
    }))
  } catch (err) {
    ElMessage.error('加载分配配置失败')
  }
}

async function handleAssignmentChange(nodeKey: string, modelId: string) {
  try {
    await updateAssignment(nodeKey, modelId || null)
    ElMessage.success('更新成功')
  } catch (err) {
    ElMessage.error('更新失败')
    await loadData()
  }
}

async function loadData() {
  loading.value = true
  try {
    await Promise.all([loadModels(), loadAssignments()])
  } finally {
    loading.value = false
  }
}

onMounted(() => {
  loadData()
})
</script>

<style scoped>
.nodes-config-view {
  max-width: 1400px;
  margin: 0 auto;
}
.panel-body-flat { padding: 0; }
.node-info { display: flex; align-items: center; gap: 10px; }
.node-dot { width: 10px; height: 10px; border-radius: 50%; box-shadow: 0 0 0 3px rgba(99,102,241,.1); }
.node-label { font-weight: 600; color: var(--text-primary); }
.model-name {
  display: inline-flex; align-items: center; gap: 6px;
  color: var(--text-primary); font-weight: 500;
}
.model-check { color: #00b578; }
.model-empty { color: var(--text-placeholder); }
.muted { color: var(--text-secondary); display: inline-flex; align-items: center; gap: 6px; }
</style>