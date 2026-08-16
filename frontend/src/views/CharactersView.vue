<template>
  <div class="panel-page">
    <div class="page-head">
      <div>
        <h2 class="page-title">人物卡片</h2>
        <p class="page-subtitle">主角 / 配角 / 反派的角色档案（状态：characters）</p>
      </div>
      <div class="head-actions">
        <el-button :loading="saving" @click="save">保存</el-button>
        <el-button type="primary" :loading="generating" @click="generate">基于核心要素生成</el-button>
      </div>
    </div>

    <el-skeleton :rows="6" animated v-if="loading" />

    <template v-else>
      <el-collapse v-model="openChars" class="group-collapse">
        <el-collapse-item v-for="(c, idx) in data.characters" :key="c.id || idx" :name="c.id || idx">
          <template #title>
            <div class="collapse-title">
              <el-icon><User /></el-icon>
              <span>{{ c.name || '（未命名人物）' }}</span>
              <el-tag :type="roleTag(c.role)" size="small">{{ roleLabel(c.role) }}</el-tag>
              <span class="collapse-count">{{ c.personality || '暂无性格' }}</span>
            </div>
          </template>
          <div class="char-body">
            <el-input v-model="c.name" placeholder="姓名" style="width: 200px; margin-bottom: 10px" />
            <el-row :gutter="12">
              <el-col :span="12"><el-input v-model="c.personality" placeholder="性格" /></el-col>
              <el-col :span="12"><el-input v-model="c.goal" placeholder="目标（明确具体）" /></el-col>
              <el-col :span="12"><el-input v-model="c.flaw" placeholder="缺陷" /></el-col>
              <el-col :span="12"><el-input v-model="c.golden_finger" placeholder="金手指（必有限制）" /></el-col>
              <el-col :span="24">
                <el-select v-model="c.role" placeholder="角色定位" style="width: 100%">
                  <el-option label="主角" value="protagonist" />
                  <el-option label="重要配角" value="supporter" />
                  <el-option label="反派" value="antagonist" />
                </el-select>
              </el-col>
            </el-row>
            <el-divider style="margin: 10px 0" />
            <div class="rel-row">
              <span class="rel-label">关系：</span>
              <el-tag v-for="(r, ri) in c.relations || []" :key="ri" closable size="small" @close="removeRelation(idx, ri)">
                {{ r.type }} → {{ targetName(r.target) }}
              </el-tag>
              <el-button link size="small" type="primary" @click="addRelation(idx)">+ 关系</el-button>
            </div>
            <div style="margin-top: 12px; text-align: right">
              <RowActions :items="[{ command: 'delete', label: '删除人物', icon: 'Delete', type: 'danger' }]" @command="() => removeChar(idx)" />
            </div>
          </div>
        </el-collapse-item>
      </el-collapse>

      <el-button class="add-btn" type="primary" plain @click="addChar">+ 新增人物</el-button>
    </template>
  </div>
</template>

<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue'
import { useRoute } from 'vue-router'
import { ElMessage } from 'element-plus'
import { getSetting, saveSetting, generateSettings, type Character } from '@/api'
import RowActions from '@/components/RowActions.vue'

const route = useRoute()
const projectId = route.params.id as string

const data = reactive<{ characters: Character[] }>({ characters: [] })
const loading = ref(false)
const saving = ref(false)
const generating = ref(false)
const openChars = ref<Array<string | number>>([])

async function load() {
  loading.value = true
  try {
    const res = await getSetting(projectId, 'characters')
    data.characters = ((res.data as any).characters ?? []) as Character[]
  } catch (err: any) {
    ElMessage.error(err?.response?.data?.error || '加载失败')
  } finally {
    loading.value = false
  }
}

function roleLabel(r: string): string {
  return { protagonist: '主角', supporter: '重要配角', antagonist: '反派' }[r] || r || '角色'
}
function roleTag(r: string): 'success' | 'primary' | 'danger' | 'info' {
  const map = { protagonist: 'success' as const, supporter: 'primary' as const, antagonist: 'danger' as const }
  return map[r as keyof typeof map] || 'info'
}
function targetName(id: string): string {
  return data.characters.find((c) => c.id === id)?.name || id
}

async function save() {
  saving.value = true
  try {
    await saveSetting(projectId, 'characters', { characters: data.characters })
    ElMessage.success('已保存')
  } catch (err: any) {
    ElMessage.error(err?.response?.data?.error || '保存失败')
  } finally {
    saving.value = false
  }
}

function addChar() {
  data.characters.push({
    id: `c${Date.now()}`,
    name: '', role: 'supporter', personality: '', goal: '', flaw: '', golden_finger: '',
    relations: [],
  })
}
function removeChar(idx: number) {
  data.characters.splice(idx, 1)
}
function addRelation(idx: number) {
  data.characters[idx].relations.push({ target: '', type: '认识' })
}
function removeRelation(idx: number, ri: number) {
  data.characters[idx].relations.splice(ri, 1)
}

async function generate() {
  generating.value = true
  try {
    const res = await generateSettings(projectId, 'characters')
    const chars = (res.data.settings as any).characters
    if (chars?.characters) {
      data.characters = chars.characters as Character[]
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
.char-card { border: 1px solid var(--border-color-light); border-radius: 10px; padding: 14px; margin-bottom: 12px; background: #fff; }
.char-head { display: flex; align-items: center; gap: 10px; margin-bottom: 12px; }
.char-actions { margin-left: auto; }
.add-btn { width: 100%; }
.rel-row { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; font-size: 13px; }
.rel-label { color: var(--text-secondary); }
</style>

