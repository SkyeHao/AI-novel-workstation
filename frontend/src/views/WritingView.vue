<template>
  <div class="panel-page writing-page">
    <div class="page-head">
      <div>
        <h2 class="page-title">正文生成创作</h2>
        <p class="page-subtitle">前置检测 → 上下文组装 → 写章落盘 → L1 摘要（状态：writing）</p>
      </div>
      <el-button
        type="primary"
        :disabled="!prereq.complete"
        @click="openWriteDialog"
        :title="prereq.complete ? '' : '缺少：' + prereq.missing.join('、')"
      >
        写新章节
      </el-button>
    </div>

    <el-alert v-if="!prereq.complete" type="warning" :closable="false" show-icon style="margin-bottom: 12px">
      <template #title>前置设定不完整：{{ prereq.missing.join('、') }}，请先在世界观构建/人物塑造/大纲生成/风格状态中补全</template>
    </el-alert>

    <el-row :gutter="16">
      <el-col :span="7">
        <el-card shadow="never" class="chapter-panel">
          <template #header>
            <div class="card-head">
              <span>章节列表</span>
              <el-tag size="small" type="info" effect="plain">{{ chapters.length }} 章</el-tag>
            </div>
          </template>
          <div class="chapter-list">
            <div v-for="c in chapters" :key="c.no" class="chapter-item" :class="{ active: c.no === currentNo }" @click="selectChapter(c.no)">
              <div class="ch-main">
                <div class="ch-no">第 {{ c.no }} 章</div>
                <div class="ch-title" :title="c.title">{{ c.title }}</div>
              </div>
              <el-tag size="small" :type="statusTag(c.status)" class="ch-status">{{ statusLabel(c.status) }}</el-tag>
              <div class="ch-words">{{ c.words }} 字</div>
            </div>
            <el-empty v-if="chapters.length === 0" description="还没有章节" :image-size="60" />
          </div>
        </el-card>
      </el-col>

      <el-col :span="17">
        <el-card shadow="never" v-if="currentNo">
          <template #header>
            <div class="card-head">
              <span>第 {{ currentNo }} 章 · {{ currentChapter?.title }}</span>
              <div>
                <el-button size="small" @click="openRewriteDialog">选段修改</el-button>
              </div>
            </div>
          </template>
          <textarea
            v-model="content"
            class="content-area"
            spellcheck="false"
            @mouseup="captureSelection"
          />
        </el-card>
        <el-empty v-else description="选择或创建章节后开始写作" :image-size="80" />
      </el-col>
    </el-row>

    <!-- 写章对话框 -->
    <el-dialog v-model="writeVisible" title="创作新章节" width="520px">
      <el-form label-width="90px">
        <el-form-item label="章节号">
          <el-input-number v-model="writeForm.no" :min="1" :max="9999" />
        </el-form-item>
        <el-form-item label="章名"><el-input v-model="writeForm.title" placeholder="如：初入宗门" /></el-form-item>
        <el-form-item label="写作说明">
          <el-input v-model="writeForm.note" type="textarea" :rows="3" placeholder="本节重点、节奏要求、特殊约束（可选）" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="writeVisible = false">取消</el-button>
        <el-button type="primary" :loading="writing" @click="doWrite">生成正文生成</el-button>
      </template>
    </el-dialog>

    <!-- 改写对话框（T9 原文/改写对比） -->
    <el-dialog v-model="rewriteVisible" title="选段修改" width="680px">
      <el-form label-width="90px">
        <el-form-item label="修改要求">
          <el-input v-model="rewriteInstruction" type="textarea" :rows="3" placeholder="如：加快节奏、去掉AI味、加强冲突…" />
        </el-form-item>
        <el-form-item label="原文选段">
          <div class="sel-box">{{ rewriteSelection || '（请在右侧正文生成中划选一段文字）' }}</div>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="rewriteVisible = false">取消</el-button>
        <el-button type="primary" :loading="rewriting" @click="doRewrite">生成改写</el-button>
      </template>
    </el-dialog>

    <!-- 改写对比对话框 -->
    <el-dialog v-model="compareVisible" title="改写对比" width="760px">
      <el-row :gutter="12">
        <el-col :span="12">
          <div class="cmp-title">原文</div>
          <div class="cmp-box orig">{{ rewriteResult.original }}</div>
        </el-col>
        <el-col :span="12">
          <div class="cmp-title">改写后</div>
          <div class="cmp-box">{{ rewriteResult.rewritten }}</div>
        </el-col>
      </el-row>
      <template #footer>
        <el-button @click="compareVisible = false">放弃</el-button>
        <el-button type="primary" :loading="applying" @click="doApplyRewrite">应用改写</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue'
import { useRoute } from 'vue-router'
import { ElMessage } from 'element-plus'
import {
  getChapters, getChapter, writeChapter, rewriteChapter, applyRewrite,
  type ChapterRecord, type PrereqCheckResult,
} from '@/api'

const route = useRoute()
const projectId = route.params.id as string

const chapters = ref<ChapterRecord[]>([])
const prereq = reactive<PrereqCheckResult>({ complete: true, missing: [], details: {} })
const currentNo = ref(0)
const currentChapter = ref<ChapterRecord | null>(null)
const content = ref('')

const writeVisible = ref(false)
const writeForm = reactive({ no: 1, title: '', note: '' })
const writing = ref(false)

const rewriteVisible = ref(false)
const rewriteSelection = ref('')
const rewriteInstruction = ref('')
const rewriting = ref(false)

const compareVisible = ref(false)
const rewriteResult = reactive({ original: '', rewritten: '' })
const applying = ref(false)

const statusLabel = (s: string) => ({ PENDING: '待生成', GENERATED: '已生成', REVIEWED: '已质量审查', FINALIZED: '已定稿' }[s] || s)
const statusTag = (s: string): 'info' | 'success' | 'warning' | 'primary' => (({ PENDING: 'info', GENERATED: 'success', REVIEWED: 'warning', FINALIZED: 'primary' }) as Record<string, 'info' | 'success' | 'warning' | 'primary'>)[s] || 'info'

async function load() {
  const res = await getChapters(projectId)
  chapters.value = res.data.chapters
  Object.assign(prereq, res.data.prereq)
  if (chapters.value.length && !currentNo.value) {
    selectChapter(chapters.value[chapters.value.length - 1]!.no)
  }
}

async function selectChapter(no: number) {
  currentNo.value = no
  const res = await getChapter(projectId, no)
  currentChapter.value = res.data.record
  content.value = res.data.content
}

function openWriteDialog() {
  writeForm.no = chapters.value.length + 1
  writeForm.title = ''
  writeForm.note = ''
  writeVisible.value = true
}

async function doWrite() {
  writing.value = true
  try {
    const res = await writeChapter(projectId, writeForm.no, {
      title: writeForm.title, note: writeForm.note, block_when_incomplete: true,
    })
    if (res.data.blocked) {
      ElMessage.warning(res.data.error)
    } else {
      ElMessage.success(`第 ${res.data.chapter_no} 章已生成（${res.data.words} 字）`)
      writeVisible.value = false
      await load()
      selectChapter(res.data.chapter_no)
    }
  } catch (err: any) {
    ElMessage.error(err?.response?.data?.error || '生成失败')
  } finally {
    writing.value = false
  }
}

function captureSelection(e: MouseEvent) {
  const ta = e.target as HTMLTextAreaElement
  const sel = window.getSelection()?.toString() ?? ''
  if (sel && ta.selectionStart !== ta.selectionEnd && ta.value) {
    rewriteSelection.value = sel.trim()
    if (rewriteSelection.value.length < 500) {
    }
  }
}

function openRewriteDialog() {
  const ta = document.querySelector('.content-area') as HTMLTextAreaElement | null
  const st = ta?.selectionStart ?? 0
  const en = ta?.selectionEnd ?? 0
  if (ta && en > st) {
    rewriteSelection.value = ta.value.slice(st, en).trim()
  }
  rewriteInstruction.value = ''
  rewriteVisible.value = true
}

async function doRewrite() {
  if (!rewriteSelection.value) {
    ElMessage.warning('请先在正文生成中划选一段文字')
    return
  }
  if (!rewriteInstruction.value.trim()) {
    ElMessage.warning('请填写修改要求')
    return
  }
  rewriting.value = true
  try {
    const res = await rewriteChapter(projectId, currentNo.value, {
      selection: rewriteSelection.value, instruction: rewriteInstruction.value,
    })
    if (!res.data.success) {
      ElMessage.error(res.data.error)
      return
    }
    rewriteResult.original = res.data.original
    rewriteResult.rewritten = res.data.rewritten
    rewriteVisible.value = false
    compareVisible.value = true
  } catch (err: any) {
    ElMessage.error(err?.response?.data?.error || '改写失败')
  } finally {
    rewriting.value = false
  }
}

async function doApplyRewrite() {
  applying.value = true
  try {
    await applyRewrite(projectId, currentNo.value, { selection: rewriteResult.original, rewritten: rewriteResult.rewritten })
    ElMessage.success('已应用改写')
    compareVisible.value = false
    selectChapter(currentNo.value)
  } catch (err: any) {
    ElMessage.error(err?.response?.data?.error || '应用失败')
  } finally {
    applying.value = false
  }
}

onMounted(() => {
  load().catch((err: any) => ElMessage.error(err?.response?.data?.error || '加载失败'))
})
</script>

<style scoped>
.writing-page :deep(.el-col) { margin-bottom: 0; }
.page-head { display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px; }
.page-title { font-size: 20px; font-weight: 600; margin: 0 0 4px; }
.page-subtitle { font-size: 13px; color: var(--text-secondary); margin: 0; }
.chapter-panel :deep(.el-card__body) { padding: 8px 12px 12px; }
.chapter-list { max-height: calc(100vh - 260px); overflow-y: auto; margin: 0 -6px; padding: 0 6px; }
.chapter-item {
  padding: 9px 12px; border-radius: 8px; cursor: pointer; border: 1px solid transparent; margin-bottom: 6px;
  display: flex; align-items: center; gap: 8px;
}
.chapter-item:hover { background: #f5f5f7; }
.chapter-item.active { background: #eef2ff; border-color: #6366f1; }
.ch-main { flex: 1; min-width: 0; }
.ch-no { font-weight: 700; font-size: 13px; }
.ch-title { font-size: 13px; color: var(--text-primary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ch-status { flex-shrink: 0; }
.ch-words { font-size: 11px; color: var(--text-placeholder); flex-shrink: 0; }
.card-head { display: flex; justify-content: space-between; align-items: center; }
.content-area {
  width: 100%; min-height: 66vh; border: none; outline: none; resize: vertical; font-size: 14px; line-height: 2;
  font-family: inherit; color: var(--text-primary);
}
.sel-box { background: #f5f5f7; border-radius: 8px; padding: 10px; max-height: 180px; overflow: auto; font-size: 13px; line-height: 1.8; white-space: pre-wrap; }
.cmp-title { font-weight: 600; margin-bottom: 6px; }
.cmp-box { border: 1px solid var(--border-color-light); border-radius: 8px; padding: 12px; max-height: 48vh; overflow: auto; font-size: 13px; line-height: 1.8; white-space: pre-wrap; }
.cmp-box.orig { background: #fff5f5; }
</style>

