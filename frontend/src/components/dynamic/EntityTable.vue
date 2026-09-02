<template>
  <div class="entity-table">
    <div class="et-toolbar">
      <el-input v-model="keyword" clearable placeholder="搜索名称 / 状态 / 持有者..." class="et-search">
        <template #prefix><el-icon><Search /></el-icon></template>
      </el-input>
      <el-select v-if="statusValues.length > 0" v-model="statusFilter" clearable placeholder="状态筛选" class="et-filter">
        <el-option v-for="status in statusValues" :key="status" :label="status" :value="status" />
      </el-select>
      <span class="et-count">共 {{ filtered.length }} 条</span>
    </div>

    <el-table :data="filtered" class="et-table" empty-text="暂无记录" @row-click="openDetail">
      <el-table-column label="名称" min-width="170">
        <template #default="{ row }">
          <span class="et-name">{{ row.name || row.id || '未命名' }}</span>
        </template>
      </el-table-column>
      <el-table-column v-for="field in tableFields" :key="field.key" :prop="field.key" :label="field.label" min-width="150" show-overflow-tooltip />
      <el-table-column width="48" align="center">
        <template #default="{ row }">
          <el-button link type="primary" @click.stop="openDetail(row)">
            <el-icon><View /></el-icon>
          </el-button>
        </template>
      </el-table-column>
    </el-table>

    <el-dialog v-model="detailOpen" :title="selectedName" width="480px" align-center append-to-body destroy-on-close>
      <div v-if="selected" class="et-detail">
        <div v-for="(value, key) in selected" :key="key" class="et-detail-row">
          <span class="et-detail-key">{{ fieldLabel(key) }}</span>
          <span class="et-detail-value">{{ stringifyValue(value) }}</span>
        </div>
      </div>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { Search, View } from '@element-plus/icons-vue'
import { fieldLabel, stringifyValue } from './dynamicFieldLabels'
import { getCharacterStateTemplates, type CharacterStateTemplate } from '@/api'

const props = defineProps<{
  account: string
  entries: Array<Record<string, any>>
  genre?: string
  dims?: Array<{ key: string; label: string; hint?: string; core?: boolean }>
}>()

const TABLE_FIELDS: Record<string, Array<{ key: string; label: string }>> = {
  locations: [{ key: 'status', label: '当前状态' }],
  items: [
    { key: 'owner', label: '持有者' },
    { key: 'status', label: '当前状态' },
  ],
}

const keyword = ref('')
const statusFilter = ref('')
const detailOpen = ref(false)
const selected = ref<Record<string, any> | null>(null)

// 题材模板维度缓存（模块级单例，按题材 id 索引）
let characterTemplatesPromise: Promise<Record<string, CharacterStateTemplate>> | null = null
function loadCharacterStateTemplates(): Promise<Record<string, CharacterStateTemplate>> {
  if (!characterTemplatesPromise) {
    characterTemplatesPromise = getCharacterStateTemplates()
      .then((res) => Object.fromEntries((res.data || []).map((t) => [t.id, t])))
      .catch(() => ({}))
  }
  return characterTemplatesPromise
}

const characterTemplates = ref<Record<string, CharacterStateTemplate>>({})
onMounted(async () => {
  characterTemplates.value = await loadCharacterStateTemplates()
})

function hasAnyValue(entries: Array<Record<string, any>>, key: string): boolean {
  return entries.some((item) => {
    const v = item[key]
    return v !== null && v !== undefined && v !== ''
  })
}

const tableFields = computed(() => {
  if (props.account !== 'characters') return TABLE_FIELDS[props.account] || [{ key: 'status', label: '状态' }]
  // 人物：题材模板维度（按顺序，仅显示已有数据的维度）+ 数据实际字段兜底
  const ordered: Array<{ key: string; label: string }> = [{ key: 'status', label: '当前状态' }]
  const seen = new Set<string>(['status'])
  const template = props.genre ? characterTemplates.value[props.genre] : null
  const dims = props.dims && props.dims.length ? props.dims : (template?.dimensions || [])
  for (const dim of dims) {
    if (seen.has(dim.key)) continue
    seen.add(dim.key)
    if (hasAnyValue(props.entries, dim.key)) ordered.push({ key: dim.key, label: dim.label })
  }
  const extras = new Set<string>()
  for (const item of props.entries) for (const k of Object.keys(item)) extras.add(k)
  for (const k of extras) {
    if (k === 'id' || k === 'name' || k === 'status') continue
    if (seen.has(k)) continue
    seen.add(k)
    ordered.push({ key: k, label: fieldLabel(k) })
  }
  return ordered
})

const statusValues = computed(() => {
  const set = new Set<string>()
  for (const item of props.entries) {
    const status = item.status
    if (status !== null && status !== undefined && status !== '') set.add(String(status))
  }
  const values = [...set].slice(0, 12)
  return values.every((value) => value.length <= 24) ? values : []
})

const filtered = computed(() => {
  const kw = keyword.value.trim().toLowerCase()
  const sf = statusFilter.value
  return props.entries.filter((item) => {
    if (sf && String(item.status ?? '') !== sf) return false
    if (!kw) return true
    const haystack = [item.name, item.id, item.status, item.owner, item.current_owner]
      .filter((value): value is string => value !== null && value !== undefined)
      .map((value) => String(value).toLowerCase())
      .join(' ')
    return haystack.includes(kw)
  })
})

const selectedName = computed(() => String(selected.value?.name || selected.value?.id || '详情'))

function openDetail(row: Record<string, any>) {
  selected.value = row
  detailOpen.value = true
}
</script>

<style scoped>
.entity-table {
  display: flex;
  flex-direction: column;
  gap: 12px;
  height: 100%;
}
.et-toolbar {
  display: flex;
  align-items: center;
  gap: 12px;
}
.et-search { width: 280px; }
.et-filter { width: 220px; }
.et-count {
  margin-left: auto;
  font-size: 12px;
  color: var(--text-secondary);
}
.et-table { flex: 1; min-height: 0; }
.et-table :deep(.el-table__row) { cursor: pointer; }
.et-table :deep(.el-table__row:hover td) { background: #f6f7fb; }
.et-name { font-weight: 600; color: var(--text-title); }
.et-detail {
  display: flex;
  flex-direction: column;
  gap: 10px;
  max-height: 60vh;
  overflow: auto;
  padding-right: 2px;
}
.et-detail-row {
  display: flex;
  gap: 10px;
  padding: 10px 12px;
  border: 1px solid var(--border-color-light);
  border-radius: 8px;
  background: #fafafa;
}
.et-detail-key {
  flex: 0 0 96px;
  font-size: 12px;
  color: var(--text-secondary);
  padding-top: 1px;
}
.et-detail-value {
  flex: 1;
  font-size: 13px;
  color: var(--text-primary);
  word-break: break-word;
  white-space: pre-wrap;
}
</style>


