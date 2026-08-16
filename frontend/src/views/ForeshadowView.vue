<template>
  <div class="panel-page">
    <div class="page-head">
      <div>
        <h2 class="page-title">伏笔管理</h2>
        <p class="page-subtitle">横切状态：埋 / 收 / 兑现台账（默认关闭，可在工作台启用）</p>
      </div>
      <el-button type="primary" @click="addVisible = true">登记伏笔</el-button>
    </div>

    <el-card shadow="never">
      <el-table :data="items" size="small">
        <el-table-column label="描述" min-width="220">
          <template #default="{ row }"><span class="desc">{{ row.desc }}</span></template>
        </el-table-column>
        <el-table-column label="埋设点" prop="planted_at" width="100" />
        <el-table-column label="计划回收" prop="planned_reap" width="100" />
        <el-table-column label="状态" width="100">
          <template #default="{ row }">
            <el-tag :type="statusTag(row.status)" size="small">{{ statusLabel(row.status) }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="70" align="center">
          <template #default="{ row }">
            <RowActions :items="rowActions(row)" @command="(cmd: string) => onRowCommand(cmd, row)" />
          </template>
        </el-table-column>
      </el-table>
      <el-empty v-if="items.length === 0" description="还没有伏笔记录" :image-size="70" />
    </el-card>

    <el-dialog v-model="addVisible" title="登记伏笔" width="480px">
      <el-form label-width="90px">
        <el-form-item label="伏笔描述" required>
          <el-input v-model="form.desc" type="textarea" :rows="3" placeholder="埋下什么？为什么重要？" />
        </el-form-item>
        <el-form-item label="埋设位置"><el-input v-model="form.planted_at" placeholder="如：第 5 章 主角见到信物" /></el-form-item>
        <el-form-item label="计划回收"><el-input v-model="form.planned_reap" placeholder="如：第 20 章 揭晓身份" /></el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="addVisible = false">取消</el-button>
        <el-button type="primary" :loading="adding" @click="submit">登记</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue'
import { useRoute } from 'vue-router'
import { ElMessage } from 'element-plus'
import { getForeshadow, addForeshadow, updateForeshadow } from '@/api'
import RowActions, { type RowActionItem } from '@/components/RowActions.vue'

const route = useRoute()
const projectId = route.params.id as string

const items = ref<Array<Record<string, any>>>([])
const addVisible = ref(false)
const adding = ref(false)
const form = reactive({ desc: '', planted_at: '', planned_reap: '' })

function rowActions(row: Record<string, any>): RowActionItem[] {
  const items: RowActionItem[] = []
  if (row.status !== 'reaped') items.push({ command: 'reaped', label: '兑现', icon: 'CircleCheck', type: 'success' })
  if (row.status !== 'dropped') items.push({ command: 'dropped', label: '放弃', icon: 'CircleClose', type: 'danger' })
  return items
}

function onRowCommand(cmd: string, row: Record<string, any>) {
  mark(row, cmd)
}

const statusLabel = (s: string) => ({ planted: '已埋', reaped: '已兑现', dropped: '已放弃' }[s] || s)
const statusTag = (s: string): 'primary' | 'success' | 'info' => (({ planted: 'primary', reaped: 'success', dropped: 'info' }) as Record<string, 'primary' | 'success' | 'info'>)[s] || 'info'

async function load() {
  const res = await getForeshadow(projectId)
  items.value = res.data.items
}

async function submit() {
  if (!form.desc.trim()) {
    ElMessage.warning('请填写伏笔描述')
    return
  }
  adding.value = true
  try {
    await addForeshadow(projectId, { desc: form.desc.trim(), planted_at: form.planted_at, planned_reap: form.planned_reap })
    ElMessage.success('已登记')
    addVisible.value = false
    form.desc = ''
    form.planted_at = ''
    form.planned_reap = ''
    await load()
  } catch (err: any) {
    ElMessage.error(err?.response?.data?.error || '登记失败')
  } finally {
    adding.value = false
  }
}

async function mark(row: Record<string, any>, status: string) {
  const reapInfo = status === 'reaped' ? `于对话中兑现` : ''
  await updateForeshadow(projectId, row.id, { status, reap_info: reapInfo })
  await load()
}

onMounted(() => {
  load().catch((err: any) => ElMessage.error(err?.response?.data?.error || '加载失败'))
})
</script>

<style scoped>
.page-head { display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px; }
.page-title { font-size: 20px; font-weight: 600; margin: 0 0 4px; }
.page-subtitle { font-size: 13px; color: var(--text-secondary); margin: 0; }
.desc { font-size: 13px; line-height: 1.6; }
</style>

