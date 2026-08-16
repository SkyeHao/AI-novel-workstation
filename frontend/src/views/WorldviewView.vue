<template>
  <div class="panel-page">
    <div class="page-head">
      <div>
        <h2 class="page-title">世界观设定</h2>
        <p class="page-subtitle">时代 / 规则 / 地理 / 阵营 / 历史（状态：worldview）</p>
      </div>
      <el-button type="primary" :loading="generating" @click="generate">基于核心要素生成</el-button>
    </div>

    <el-skeleton :rows="6" animated v-if="loading" />

    <div v-else>
      <el-collapse v-model="openSections" class="group-collapse">
        <el-collapse-item v-for="key in sectionKeys" :key="key" :name="key">
          <template #title>
            <div class="collapse-title">
              <el-icon><Compass /></el-icon>
              <span>{{ sectionLabels[key] }}</span>
              <span class="collapse-count">{{ sectionPlaceholders[key] }}</span>
            </div>
          </template>
          <el-input
            v-model="data.sections[key]"
            type="textarea"
            :rows="key === 'rules' ? 8 : 4"
            :placeholder="sectionPlaceholders[key]"
          />
        </el-collapse-item>
      </el-collapse>
      <el-button type="primary" plain :loading="saving" @click="save" style="margin-top: 12px">保存设定</el-button>
    </div>

    <el-dialog v-model="genVisible" title="生成结果预览" width="640px">
      <div class="preview">
        <div v-for="key in sectionKeys" :key="key" class="preview-sec">
          <div class="sec-title">{{ sectionLabels[key] }}</div>
          <div class="sec-body">{{ data.sections[key] || '（空）' }}</div>
        </div>
      </div>
      <template #footer>
        <el-button @click="genVisible = false">关闭</el-button>
        <el-button type="primary" @click="save">保存设定</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue'
import { useRoute } from 'vue-router'
import { ElMessage } from 'element-plus'
import { getSetting, saveSetting, generateSettings, type Worldview } from '@/api'

const route = useRoute()
const projectId = route.params.id as string

const sectionKeys = ['era', 'rules', 'geography', 'factions', 'history']
const sectionLabels: Record<string, string> = {
  era: '时代背景', rules: '世界规则', geography: '地理地图', factions: '阵营关系', history: '重要历史',
}
const sectionPlaceholders: Record<string, string> = {
  era: '故事发生的时代 / 世界基调（一句话）',
  rules: '力量体系、社会结构、规则边界（分段清晰）',
  geography: '主要场景与地图（可多条）',
  factions: '主要势力与相互关系',
  history: '影响现在的重要历史事件',
}

const data = reactive<{ sections: Record<string, string> }>({ sections: { era: '', rules: '', geography: '', factions: '', history: '' } })
const loading = ref(false)
const saving = ref(false)
const generating = ref(false)
const genVisible = ref(false)
const openSections = ref(['era'])

async function load() {
  loading.value = true
  try {
    const res = await getSetting(projectId, 'worldview')
    const sections = (res.data as any).sections ?? data.sections
    Object.assign(data.sections, sections)
  } catch (err: any) {
    ElMessage.error(err?.response?.data?.error || '加载失败')
  } finally {
    loading.value = false
  }
}

async function save() {
  saving.value = true
  try {
    await saveSetting(projectId, 'worldview', { sections: { ...data.sections } as Worldview['sections'] })
    ElMessage.success('已保存')
    genVisible.value = false
  } catch (err: any) {
    ElMessage.error(err?.response?.data?.error || '保存失败')
  } finally {
    saving.value = false
  }
}

async function generate() {
  generating.value = true
  try {
    const res = await generateSettings(projectId, 'worldview')
    const wv = (res.data.settings as any).worldview
    if (wv?.sections) {
      Object.assign(data.sections, wv.sections)
      genVisible.value = true
    }
  } catch (err: any) {
    ElMessage.error(err?.response?.data?.error || '生成失败，请检查模型配置')
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
.preview { max-height: 65vh; overflow: auto; }
.preview-sec { margin-bottom: 14px; }
.sec-title { font-weight: 600; margin-bottom: 4px; }
.sec-body { white-space: pre-wrap; font-size: 14px; line-height: 1.7; color: var(--text-primary); }
</style>



