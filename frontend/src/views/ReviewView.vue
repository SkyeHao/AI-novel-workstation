<template>
  <div class="panel-page review-page">
    <div class="page-head">
      <div>
        <h2 class="page-title">质量审查与去 AI 味</h2>
        <p class="page-subtitle">质量审查报告 → 去AI味建议 → 对比应用 → 标记 REVIEWED（状态：review）</p>
      </div>
    </div>

    <el-row :gutter="16">
      <el-col :span="6">
        <el-card shadow="never" class="chapter-panel">
          <template #header>
            <div class="card-head">
              <span>章节</span>
              <el-tag size="small" type="info" effect="plain">{{ chapters.length }} 章</el-tag>
            </div>
          </template>
          <div class="chapter-list">
            <div v-for="c in chapters" :key="c.no" class="chapter-item" :class="{ active: c.no === currentNo }" @click="selectChapter(c.no)">
              <span class="ch-name" :title="c.title">第 {{ c.no }} 章 · {{ c.title }}</span>
              <el-tag size="small" :type="statusTag(c.status)" class="ch-status">{{ statusLabel(c.status) }}</el-tag>
            </div>
            <el-empty v-if="chapters.length === 0" description="暂无已生成章节" :image-size="60" />
          </div>
        </el-card>
      </el-col>

      <el-col :span="18">
        <el-card shadow="never" v-if="currentNo">
          <template #header>
            <div class="card-head">
              <span>第 {{ currentNo }} 章</span>
              <el-button type="primary" size="small" :loading="reviewing" @click="doReview">
                {{ result.report ? '重新质量审查' : '开始质量审查' }}
              </el-button>
            </div>
          </template>

          <el-skeleton :rows="6" animated v-if="reviewing" />

          <div v-else-if="result.report">
            <el-collapse v-model="openPanels">
              <el-collapse-item name="report" title="📄 质量审查报告">
                <MarkdownView :content="result.report" />
              </el-collapse-item>
              <el-collapse-item name="suggestions" title="✂️ 去 AI 味建议（{{ result.suggestions.length }} 条）">
                <div v-for="s in result.suggestions" :key="s.id" class="sugg-item">
                  <div class="sugg-head">
                    <el-tag size="small" type="warning">{{ s.location || '未定位' }}</el-tag>
                    <span class="sugg-issue">{{ s.issue }}</span>
                  </div>
                  <div class="sugg-body" v-if="s.original || s.rewritten">
                    <div class="pair">
                      <span class="pair-label orig">原文</span>
                      <div class="pair-box orig">{{ s.original }}</div>
                    </div>
                    <div class="pair">
                      <span class="pair-label">改写</span>
                      <div class="pair-box">{{ s.rewritten }}</div>
                    </div>
                  </div>
                  <div class="sugg-actions">
                    <el-tag v-if="applied.has(s.id)" size="small" type="success" effect="light">已处理</el-tag>
                    <RowActions :items="suggActions(s)" @command="(cmd: string) => onSuggCommand(cmd, s)" />
                  </div>
                </div>
                <el-empty v-if="result.suggestions.length === 0" description="没有检测到明显 AI 味" :image-size="50" />
              </el-collapse-item>
            </el-collapse>

            <el-divider />
            <div class="approve-row">
              <el-button type="success" size="small" :loading="approving" :disabled="currentChapter?.status === 'REVIEWED'" @click="approve">
                标记本章为已质量审查（REVIEWED）
              </el-button>
              <el-tag v-if="currentChapter?.status === 'REVIEWED'" type="success">本章已完成质量审查</el-tag>
            </div>
          </div>

          <el-empty v-else description="选择章节后点击「开始质量审查」" :image-size="70" />
        </el-card>
        <el-empty v-else description="选择要质量审查的章节" :image-size="80" />
      </el-col>
    </el-row>
  </div>
</template>

<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue'
import { useRoute } from 'vue-router'
import { ElMessage } from 'element-plus'
import MarkdownView from '@/components/MarkdownView.vue'
import RowActions, { type RowActionItem } from '@/components/RowActions.vue'
import { getChapters, getChapter, reviewChapter, applyReviewSuggestionApi, approveReview, type ChapterRecord, type ReviewSuggestion } from '@/api'

const route = useRoute()
const projectId = route.params.id as string

const chapters = ref<ChapterRecord[]>([])
const currentNo = ref(0)
const currentChapter = ref<ChapterRecord | null>(null)
const reviewing = ref(false)
const approving = ref(false)
const applyingId = ref('')
const openPanels = ref(['report', 'suggestions'])
const result = reactive<{ report: string; suggestions: ReviewSuggestion[] }>({ report: '', suggestions: [] })
const applied = reactive<Set<string>>(new Set())

const statusLabel = (s: string) => ({ PENDING: '待生成', GENERATED: '已生成', REVIEWED: '已质量审查', FINALIZED: '已定稿' }[s] || s)
function statusTag(s: string): 'info' | 'success' | 'warning' | 'primary' {
  const map = { PENDING: 'info' as const, GENERATED: 'success' as const, REVIEWED: 'warning' as const, FINALIZED: 'primary' as const }
  return map[s as keyof typeof map] || 'info'
}

async function load() {
  const res = await getChapters(projectId)
  chapters.value = res.data.chapters
}

async function selectChapter(no: number) {
  currentNo.value = no
  result.report = ''
  result.suggestions = []
  applied.clear()
  const res = await getChapter(projectId, no)
  currentChapter.value = res.data.record
}

async function doReview() {
  reviewing.value = true
  try {
    const res = await reviewChapter(projectId, currentNo.value)
    if (!res.data.success) {
      ElMessage.error(res.data.error)
      return
    }
    result.report = res.data.report
    result.suggestions = res.data.suggestions
    ElMessage.success('质量审查完成')
  } catch (err: any) {
    ElMessage.error(err?.response?.data?.error || '质量审查失败')
  } finally {
    reviewing.value = false
  }
}

async function applySuggestion(s: ReviewSuggestion) {
  if (applied.has(s.id)) return
  applyingId.value = s.id
  try {
    await applyReviewSuggestionApi(projectId, currentNo.value, { original: s.original, rewritten: s.rewritten })
    applied.add(s.id)
    ElMessage.success('已应用该建议')
  } catch (err: any) {
    ElMessage.error(err?.response?.data?.error || '应用失败')
  } finally {
    applyingId.value = ''
  }
}

function rejectSuggestion(s: ReviewSuggestion) {
  applied.add(s.id)
}

function suggActions(s: ReviewSuggestion): RowActionItem[] {
  return [
    { command: 'apply', label: '应用改写', icon: 'Check', type: 'success', disabled: applied.has(s.id) || applyingId.value === s.id },
    { command: 'reject', label: '忽略建议', icon: 'Close', type: 'danger' },
  ]
}

function onSuggCommand(cmd: string, s: ReviewSuggestion) {
  if (cmd === 'apply') applySuggestion(s)
  else if (cmd === 'reject') rejectSuggestion(s)
}

async function approve() {
  approving.value = true
  try {
    await approveReview(projectId, currentNo.value)
    ElMessage.success('已标记为 REVIEWED')
    const res = await getChapter(projectId, currentNo.value)
    currentChapter.value = res.data.record
    await load()
  } catch (err: any) {
    ElMessage.error(err?.response?.data?.error || '操作失败')
  } finally {
    approving.value = false
  }
}

onMounted(() => {
  load().catch((err: any) => ElMessage.error(err?.response?.data?.error || '加载失败'))
})
</script>

<style scoped>
.page-head { display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px; }
.page-title { font-size: 20px; font-weight: 600; margin: 0 0 4px; }
.page-subtitle { font-size: 13px; color: var(--text-secondary); margin: 0; }
.chapter-panel :deep(.el-card__body) { padding: 8px 12px 12px; }
.chapter-list { max-height: calc(100vh - 260px); overflow-y: auto; margin: 0 -6px; padding: 0 6px; }
.chapter-item { padding: 9px 12px; border-radius: 8px; cursor: pointer; border: 1px solid transparent; margin-bottom: 6px; display: flex; align-items: center; justify-content: space-between; gap: 8px; font-size: 13px; }
.chapter-item:hover { background: #f5f5f7; }
.chapter-item.active { background: #eef2ff; border-color: #6366f1; }
.ch-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ch-status { flex-shrink: 0; }
.card-head { display: flex; justify-content: space-between; align-items: center; }
.sugg-item { border: 1px solid var(--border-color-light); border-radius: 10px; padding: 12px; margin-bottom: 12px; }
.sugg-head { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; }
.sugg-issue { font-size: 13px; font-weight: 600; }
.sugg-body { display: flex; gap: 12px; margin-bottom: 8px; }
.pair { flex: 1; }
.pair-label { font-size: 12px; color: var(--text-secondary); display: block; margin-bottom: 4px; }
.pair-label.orig { color: #e6a23c; }
.pair-box { background: #f7f8fa; border-radius: 8px; padding: 10px; font-size: 12px; line-height: 1.7; max-height: 160px; overflow: auto; white-space: pre-wrap; }
.pair-box.orig { background: #fff7e6; }
.sugg-actions { display: flex; align-items: center; justify-content: flex-end; gap: 8px; }
.approve-row { display: flex; align-items: center; gap: 12px; }
</style>

