<template>
  <div class="panel-page">
    <div class="page-head">
      <div>
        <h2 class="page-title">大纲生成规划</h2>
        <p class="page-subtitle">分卷 / 篇章 / 章节 三级结构（状态：outline）</p>
      </div>
      <div class="head-actions">
        <el-button :loading="saving" @click="save">保存</el-button>
        <el-button type="primary" :loading="generating" @click="generate">基于核心要素生成</el-button>
      </div>
    </div>

    <el-skeleton :rows="6" animated v-if="loading" />

    <el-row v-else :gutter="16">
      <el-col :span="14">
        <el-card shadow="never">
          <template #header><span>简纲</span></template>
          <el-input v-model="root.summary_short" type="textarea" :rows="5" placeholder="300~500字简纲" />
        </el-card>
        <el-card shadow="never" style="margin-top: 12px">
          <template #header><span>粗纲</span></template>
          <el-input v-model="root.summary_long" type="textarea" :rows="8" placeholder="1000~5000字粗纲" />
        </el-card>
      </el-col>
      <el-col :span="10">
        <el-card shadow="never">
          <template #header><span>卷 / 篇 / 章结构</span></template>
          <el-tree
            :data="treeData"
            node-key="id"
            default-expand-all
            :expand-on-click-node="false"
            :props="{ label: 'name', children: 'children' }"
          >
            <template #default="{ data }">
              <div class="tree-node">
                <span class="node-name">{{ data.name || data.type }}</span>
                <el-tag size="small" :type="nodeTag(data.type)">{{ nodeLabel(data.type) }}</el-tag>
                <span v-if="data.no" class="node-no">第{{ data.no }}章</span>
                <RowActions
                  class="row-actions"
                  :items="[
                    { command: 'edit', label: '编辑', icon: 'Edit' },
                    { command: 'delete', label: '删除', icon: 'Delete', type: 'danger', divided: true },
                  ]"
                  @command="(cmd: string) => onNodeCommand(cmd, data)"
                />
              </div>
            </template>
          </el-tree>
          <el-button class="add-btn" link type="primary" @click="addVolume">+ 分卷</el-button>
        </el-card>
      </el-col>
    </el-row>

    <!-- 节点编辑 -->
    <el-dialog v-model="nodeVisible" :title="`编辑${nodeLabel(editing?.type)}`" width="560px">
      <el-form label-width="90px" size="small">
        <el-form-item label="名称"><el-input v-model="editing.name" /></el-form-item>
        <el-form-item v-if="editing?.type === 'volume'" label="本卷任务"><el-input v-model="editing.task" type="textarea" :rows="2" /></el-form-item>
        <el-form-item v-if="editing?.type === 'chapter'" label="核心事件"><el-input v-model="editing.event" type="textarea" :rows="2" /></el-form-item>
        <el-form-item v-if="editing?.type === 'chapter'" label="功能">
          <el-select v-model="editing.function" style="width: 100%">
            <el-option v-for="f in ['铺垫','冲突','爽点','过渡','钩子']" :key="f" :label="f" :value="f" />
          </el-select>
        </el-form-item>
        <el-form-item v-if="editing?.type === 'chapter'" label="伏笔埋设">
          <el-input v-model="editing.foreshadow_plantText" type="textarea" :rows="2" placeholder="逗号分隔" />
        </el-form-item>
        <el-form-item v-if="editing?.type === 'chapter'" label="伏笔回收">
          <el-input v-model="editing.foreshadow_reapText" type="textarea" :rows="2" placeholder="逗号分隔" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="nodeVisible = false">取消</el-button>
        <el-button type="primary" @click="nodeVisible = false">完成</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { useRoute } from 'vue-router'
import { ElMessage } from 'element-plus'
import { getSetting, saveSetting, generateSettings, type OutlineNode } from '@/api'
import RowActions from '@/components/RowActions.vue'

const route = useRoute()
const projectId = route.params.id as string

const root = reactive({ type: 'total', summary_short: '', summary_long: '', children: [] as OutlineNode[] })
const loading = ref(false)
const saving = ref(false)
const generating = ref(false)
const nodeVisible = ref(false)
const editing = ref<any>(null)

interface TreeNode extends OutlineNode {
  id: string
  name: string
  textField?: string
}


function toTree(nodes: OutlineNode[], prefix: string): TreeNode[] {
  return (nodes ?? []).map((n, i) => ({
    ...n,
    id: `${prefix}-${i}`,
    name: n.name || n.type,
    children: n.children ? toTree(n.children, `${prefix}-${i}`) : [],
  }))
}

const treeData = computed(() => toTree(root.children, 'v'))

function nodeLabel(t: string): string {
  return { volume: '卷', arc: '篇', chapter: '章', total: '全书' }[t] || t
}
function nodeTag(t: string): 'primary' | 'success' | 'warning' | 'info' {
  const map = { volume: 'primary' as const, arc: 'success' as const, chapter: 'warning' as const }
  return map[t as keyof typeof map] || 'info'
}

function openNode(data: any) {
  editing.value = { ...data, foreshadow_plantText: (data.foreshadow_plant || []).join('，'), foreshadow_reapText: (data.foreshadow_reap || []).join('，') }
  nodeVisible.value = true
}

function onNodeCommand(cmd: string, data: any) {
  if (cmd === 'edit') openNode(data)
  else if (cmd === 'delete') removeNode(data)
}

function parseNodePath(id: string): number[] {
  return id.split('-').slice(1).map(Number)
}

function removeNode(data: any) {
  const path = parseNodePath(data.id)
  if (path.length === 0) return
  let arr: any[] = root.children
  for (let i = 0; i < path.length - 1; i++) {
    const parent = arr[path[i]]
    if (!parent || !Array.isArray(parent.children)) return
    arr = parent.children
  }
  arr.splice(path[path.length - 1], 1)
}

function addVolume() {
  root.children.push({ type: 'volume', name: `第${root.children.length + 1}卷`, task: '', children: [] })
}

async function load() {
  loading.value = true
  try {
    const res = await getSetting(projectId, 'outline')
    const r = (res.data as any).root ?? {}
    root.summary_short = r.summary_short ?? ''
    root.summary_long = r.summary_long ?? ''
    root.children = r.children ?? []
  } catch (err: any) {
    ElMessage.error(err?.response?.data?.error || '加载失败')
  } finally {
    loading.value = false
  }
}

async function save() {
  saving.value = true
  try {
    await saveSetting(projectId, 'outline', { root: { type: 'total', summary_short: root.summary_short, summary_long: root.summary_long, children: root.children } })
    ElMessage.success('已保存')
  } catch (err: any) {
    ElMessage.error(err?.response?.data?.error || '保存失败')
  } finally {
    saving.value = false
  }
}

async function generate() {
  generating.value = true
  try {
    const res = await generateSettings(projectId, 'outline')
    const o = (res.data.settings as any).outline
    if (o?.root) {
      root.summary_short = o.root.summary_short ?? ''
      root.summary_long = o.root.summary_long ?? ''
      root.children = o.root.children ?? []
      ElMessage.success('生成完成，请检查后保存')
    }
  } catch (err: any) {
    ElMessage.error(err?.response?.data?.error || '生成失败')
  } finally {
    generating.value = false
  }
}

onMounted(load)
</script>

<style scoped>
.page-head { display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px; }
.page-title { font-size: 20px; font-weight: 600; margin: 0 0 4px; }
.page-subtitle { font-size: 13px; color: var(--text-secondary); margin: 0; }
.head-actions { display: flex; gap: 8px; }
.tree-node { display: flex; align-items: center; gap: 6px; flex: 1; }
.node-name { font-size: 13px; font-weight: 500; }
.node-no { font-size: 11px; color: var(--text-placeholder); }
.add-btn { margin-top: 8px; }
</style>

