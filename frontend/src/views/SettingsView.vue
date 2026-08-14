<template>
  <div class="settings-page">
    <div class="page-head">
      <div>
        <h2 class="page-title">设定中心</h2>
        <p class="page-subtitle">{{ projectName }} · 世界观 / 人物卡片 / 大纲 / 风格</p>
      </div>
      <div class="head-actions">
        <el-button v-if="hasEmptySetting" type="primary" :loading="generating" @click="handleGenerateMissing">
          <el-icon style="margin-right: 4px"><MagicStick /></el-icon>
          生成缺失设定
        </el-button>
        <el-button :loading="saving" type="success" plain @click="handleSave">
          <el-icon style="margin-right: 4px"><Check /></el-icon>
          保存修改
        </el-button>
      </div>
    </div>

    <el-tabs v-model="activeTab" class="settings-tabs">
      <!-- 项目文档 -->
      <el-tab-pane label="项目文档" name="vision">
        <el-card shadow="never">
          <div v-if="visionLoading" v-loading="true" class="loading-block" />
          <div v-else-if="documents.length === 0" class="vision-empty">
            <el-empty description="项目下暂无 Markdown 文档">
              <el-button type="primary" @click="goIdeation">去创意共创生成愿景文档</el-button>
            </el-empty>
          </div>
          <div v-else class="doc-browser">
            <div class="doc-list">
              <div
                v-for="doc in documents"
                :key="doc.path"
                class="doc-item"
                :class="{ active: activeDocPath === doc.path }"
                @click="selectDoc(doc)"
              >
                <el-icon class="doc-icon"><Document /></el-icon>
                <div class="doc-info">
                  <span class="doc-name">{{ doc.name }}</span>
                  <span class="doc-path">{{ doc.path }}</span>
                </div>
              </div>
            </div>
            <div class="doc-preview">
              <MarkdownView :content="docContent" :loading="docContentLoading" />
            </div>
          </div>
        </el-card>
      </el-tab-pane>

      <!-- 世界观 -->
      <el-tab-pane label="世界观" name="worldview">
        <el-card shadow="never">
          <div v-if="worldviewLoading" v-loading="true" class="loading-block" />
          <div v-else class="worldview-grid">
            <div class="wv-item">
              <div class="wv-label">时代背景</div>
              <el-input v-model="worldview.sections.era" type="textarea" :rows="2" placeholder="一句话描述时代背景" />
            </div>
            <div class="wv-item">
              <div class="wv-label">世界规则</div>
              <el-input v-model="worldview.sections.rules" type="textarea" :rows="4" placeholder="力量体系 / 社会结构 / 规则" />
            </div>
            <div class="wv-item">
              <div class="wv-label">地理地图</div>
              <el-input v-model="worldview.sections.geography" type="textarea" :rows="3" placeholder="主要场景与地图" />
            </div>
            <div class="wv-item">
              <div class="wv-label">阵营关系</div>
              <el-input v-model="worldview.sections.factions" type="textarea" :rows="3" placeholder="主要势力与相互关系" />
            </div>
            <div class="wv-item full">
              <div class="wv-label">重要历史事件</div>
              <el-input v-model="worldview.sections.history" type="textarea" :rows="3" placeholder="影响世界格局的历史事件" />
            </div>
          </div>
        </el-card>
      </el-tab-pane>

      <!-- 人物卡片（卡片墙） -->
      <el-tab-pane label="人物卡片" name="characters">
        <el-card shadow="never">
          <div class="char-toolbar">
            <div class="char-toolbar-left">
              <span class="char-count">共 {{ characters.length }} 位角色</span>
            </div>
            <el-button type="primary" plain size="small" @click="addCharacter">
              <el-icon style="margin-right: 4px"><Plus /></el-icon>
              新增人物卡片
            </el-button>
          </div>

          <div v-if="characterLoading" v-loading="true" class="loading-block" />

          <div v-else-if="characters.length === 0" class="char-empty">
            <el-empty description="还没有人物卡片，点击上方按钮或先生成设定">
              <el-button type="primary" :loading="generating" @click="handleGenerate('characters')">
                生成人物卡片
              </el-button>
            </el-empty>
          </div>

          <!-- 卡片墙 -->
          <div v-else class="card-wall">
            <div
              v-for="c in characters"
              :key="c.id"
              class="char-card"
              :class="{ expanded: expandedCard === c.id }"
              @click="toggleCard(c)"
            >
              <!-- 卡片正面 -->
              <div class="card-front">
                <div class="card-head">
                  <span class="card-avatar" :class="'role-' + c.role">
                    {{ (c.name || '?').slice(0, 1) }}
                  </span>
                  <div class="card-title-group">
                    <span class="card-name">{{ c.name || '未命名' }}</span>
                    <el-tag size="small" :type="roleTag(c.role)" effect="plain">{{ roleLabel(c.role) }}</el-tag>
                  </div>
                  <el-icon class="card-toggle"><ArrowDown v-if="expandedCard !== c.id" /><ArrowUp v-else /></el-icon>
                </div>
                <div class="card-personality">
                  {{ c.personality || '暂无性格描述' }}
                </div>
              </div>

              <!-- 卡片展开：字段编辑 -->
              <div v-if="expandedCard === c.id" class="card-detail" @click.stop>
                <div class="detail-field">
                  <div class="field-label">性格</div>
                  <el-input v-model="c.personality" type="textarea" :rows="2" />
                </div>
                <div class="detail-field">
                  <div class="field-label">目标</div>
                  <el-input v-model="c.goal" type="textarea" :rows="2" />
                </div>
                <div class="detail-field">
                  <div class="field-label">缺陷</div>
                  <el-input v-model="c.flaw" type="textarea" :rows="2" />
                </div>
                <div class="detail-field">
                  <div class="field-label">金手指</div>
                  <el-input v-model="c.golden_finger" type="textarea" :rows="2" />
                </div>
                <div class="detail-field">
                  <div class="field-label">关联人物</div>
                  <div class="relation-list">
                    <el-tag
                      v-for="(rel, ri) in c.relations"
                      :key="ri"
                      closable
                      size="small"
                      @close="removeRelation(c, ri)"
                    >
                      {{ rel.target }}（{{ rel.type }}）
                    </el-tag>
                    <el-select
                      v-model="relationTarget[c.id]"
                      size="small"
                      placeholder="选择关联人物"
                      style="width: 150px"
                      @change="(v: string) => addRelation(c, v)"
                    >
                      <el-option
                        v-for="other in characters.filter(x => x.id !== c.id)"
                        :key="other.id"
                        :label="other.name"
                        :value="other.name"
                      />
                    </el-select>
                  </div>
                </div>
                <div class="detail-actions">
                  <el-button size="small" type="danger" plain @click="removeCharacter(c)">删除卡片</el-button>
                </div>
              </div>
            </div>
          </div>
        </el-card>
      </el-tab-pane>

      <!-- 大纲 -->
      <el-tab-pane label="大纲" name="outline">
        <el-card shadow="never">
          <div v-if="outlineLoading" v-loading="true" class="loading-block" />
          <div v-else-if="!hasOutline" class="char-empty">
            <el-empty description="还没有大纲，先生成或自行创建">
              <el-button type="primary" :loading="generating" @click="handleGenerate('outline')">
                生成大纲
              </el-button>
            </el-empty>
          </div>
          <div v-else class="outline-view">
            <div class="outline-summary">
              <div class="outline-section">
                <div class="wv-label">简纲</div>
                <el-input v-model="outline.root.summary_short" type="textarea" :rows="3" />
              </div>
              <div class="outline-section">
                <div class="wv-label">粗纲</div>
                <el-input v-model="outline.root.summary_long" type="textarea" :rows="5" />
              </div>
            </div>
            <el-tree
              :data="outlineTreeData"
              :props="{ label: 'name', children: 'children' }"
              default-expand-all
              class="outline-tree"
            >
              <template #default="{ data }">
                <div class="tree-node">
                  <span class="tree-label">
                    <el-tag size="small" :type="treeTag(data.type)" effect="plain">{{ typeLabel(data.type) }}</el-tag>
                    <span class="tree-name">{{ data.name || data.event || '未命名' }}</span>
                  </span>
                  <el-button
                    v-if="data.type === 'chapter'"
                    link type="primary" size="small"
                    @click="editOutlineNode(data)"
                  >
                    编辑
                  </el-button>
                </div>
              </template>
            </el-tree>
            <div class="outline-hint">提示：大纲为只读展示，结构化编辑将在后续版本完善；字段可在生成后手动调整。</div>
          </div>
        </el-card>
      </el-tab-pane>

      <!-- 风格 -->
      <el-tab-pane label="风格" name="style">
        <el-card shadow="never">
          <div v-if="styleLoading" v-loading="true" class="loading-block" />
          <div v-else class="style-view">
            <div class="wv-label">文风描述</div>
            <el-input v-model="styleData.style" type="textarea" :rows="10" placeholder="叙事口吻、语言节奏、对话习惯..." />
          </div>
        </el-card>
      </el-tab-pane>
    </el-tabs>

    <!-- 大纲节点编辑弹窗 -->
    <el-dialog v-model="outlineDialogVisible" title="编辑大纲节点" width="560px">
      <el-form label-width="80px">
        <el-form-item label="名称/事件">
          <el-input v-model="editingNode.event" placeholder="本章核心事件" />
        </el-form-item>
        <el-form-item label="功能定位">
          <el-select v-model="editingNode.function" placeholder="选择功能定位" style="width: 100%">
            <el-option label="铺垫" value="铺垫" />
            <el-option label="冲突" value="冲突" />
            <el-option label="爽点" value="爽点" />
            <el-option label="过渡" value="过渡" />
            <el-option label="钩子" value="钩子" />
          </el-select>
        </el-form-item>
        <el-form-item label="出场角色">
          <el-select
            v-model="editingNode.cast"
            multiple
            filterable
            allow-create
            placeholder="选择或输入角色"
            style="width: 100%"
          >
            <el-option v-for="c in characters" :key="c.name" :label="c.name" :value="c.name" />
          </el-select>
        </el-form-item>
        <el-form-item label="埋设伏笔">
          <el-select
            v-model="editingNode.foreshadow_plant"
            multiple
            filterable
            allow-create
            placeholder="本章埋下的伏笔"
            style="width: 100%"
          >
            <el-option v-for="f in allForeshadows" :key="f" :label="f" :value="f" />
          </el-select>
        </el-form-item>
        <el-form-item label="回收伏笔">
          <el-select
            v-model="editingNode.foreshadow_reap"
            multiple
            filterable
            allow-create
            placeholder="本章回收的伏笔"
            style="width: 100%"
          >
            <el-option v-for="f in allForeshadows" :key="f" :label="f" :value="f" />
          </el-select>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="outlineDialogVisible = false">取消</el-button>
        <el-button type="primary" @click="outlineDialogVisible = false">确定</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import MarkdownView from '@/components/MarkdownView.vue'
import {
  getProject,
  getSetting,
  saveSetting,
  generateSettings,
  getPrereqCheck,
  getProjectDocuments,
  readProjectDocument,
  type Worldview,
  type Characters,
  type Character,
  type Outline,
  type OutlineNode,
  type Style,
  type ProjectDocument,
} from '@/api'

defineOptions({ name: 'SettingsView' })

const route = useRoute()
const router = useRouter()
const projectId = computed(() => (route.params.id as string) || '')
const projectName = ref((route.query.name as string) || '')

const activeTab = ref('vision')

// ====== 加载状态 ======
const visionLoading = ref(false)
const worldviewLoading = ref(false)
const characterLoading = ref(false)
const outlineLoading = ref(false)
const styleLoading = ref(false)
const saving = ref(false)
const generating = ref(false)

// ====== 数据 ======
const documents = ref<ProjectDocument[]>([])
const activeDocPath = ref('')
const docContent = ref('')
const docContentLoading = ref(false)
const worldview = reactive<Worldview>({ sections: { era: '', rules: '', geography: '', factions: '', history: '' } })
const characters = ref<Character[]>([])
const outline = reactive<Outline>({ root: { type: 'total', summary_short: '', summary_long: '', children: [] } })
const styleData = reactive<Style>({ style: '' })

function goIdeation() {
  router.push({ path: `/projects/${projectId.value}/ideation`, query: { name: projectName.value } })
}

/** 加载项目文档列表，并自动选中第一个（愿景文档优先） */
async function loadVisionDoc() {
  visionLoading.value = true
  try {
    const { data } = await getProjectDocuments(projectId.value)
    documents.value = data.documents || []
    if (documents.value.length > 0) {
      // 愿景文档优先，否则第一个
      const vision = documents.value.find((d) => d.name.includes('故事愿景'))
      const target = vision || documents.value[0]
      await selectDoc(target)
    } else {
      activeDocPath.value = ''
      docContent.value = ''
    }
  } catch (e: any) {
    ElMessage.warning(`加载文档列表失败: ${e?.message || e}`)
  } finally {
    visionLoading.value = false
  }
}

/** 选择并渲染某个文档 */
async function selectDoc(doc: ProjectDocument) {
  activeDocPath.value = doc.path
  docContentLoading.value = true
  docContent.value = ''
  try {
    const { data } = await readProjectDocument(projectId.value, doc.path)
    if (data.success) {
      docContent.value = data.content
    } else {
      ElMessage.error(`读取失败: ${data.error}`)
    }
  } catch (e: any) {
    ElMessage.error(`读取失败: ${e?.message || e}`)
  } finally {
    docContentLoading.value = false
  }
}

const expandedCard = ref<string | null>(null)
const relationTarget = ref<Record<string, string>>({})
const outlineDialogVisible = ref(false)
const editingNode = ref<OutlineNode>({ type: '', name: '' })

const roleLabels: Record<string, string> = {
  protagonist: '主角',
  supporter: '配角',
  antagonist: '反派',
}

function roleLabel(role: string): string {
  return roleLabels[role] || role || '角色'
}

function roleTag(role: string) {
  switch (role) {
    case 'protagonist': return 'success'
    case 'antagonist': return 'danger'
    default: return 'info'
  }
}

const allForeshadows = computed(() => {
  const set = new Set<string>()
  const walk = (nodes: OutlineNode[]) => {
    for (const n of nodes) {
      ;(n.foreshadow_plant || []).forEach((f) => set.add(f))
      ;(n.foreshadow_reap || []).forEach((f) => set.add(f))
      if (n.children) walk(n.children)
    }
  }
  walk(outline.root.children || [])
  return [...set]
})

const hasOutline = computed(() => {
  return !!(outline.root.summary_short || outline.root.summary_long || (outline.root.children || []).length > 0)
})

const hasEmptySetting = computed(() => {
  return (
    !hasOutline ||
    characters.value.length === 0 ||
    !styleData.style ||
    !worldview.sections.era
  )
})

const outlineTreeData = computed(() => {
  return outline.root.children || []
})

const typeLabels: Record<string, string> = { total: '总纲', volume: '卷', arc: '篇章', chapter: '章' }

function typeLabel(t: string): string {
  return typeLabels[t] || t
}

function treeTag(t: string) {
  switch (t) {
    case 'total': return 'primary'
    case 'volume': return 'success'
    case 'arc': return 'warning'
    case 'chapter': return 'info'
    default: return 'info'
  }
}

// ====== 加载 ======
async function loadAll() {
  worldviewLoading.value = characterLoading.value = outlineLoading.value = styleLoading.value = true
  const pid = projectId.value
  if (!projectName.value) {
    try {
      const { data } = await getProject(pid)
      projectName.value = data.name
    } catch { /* 忽略 */ }
  }
  await Promise.all([
    loadVisionDoc(),
    loadSetting<Worldview>('worldview', worldview as Worldview, (d) => Object.assign(worldview.sections, d.sections)),
    loadSetting<Characters>('characters', { characters: characters.value } as Characters, (d) => {
      characters.value = d.characters || []
    }),
    loadSetting<Outline>('outline', outline as Outline, (d) => {
      Object.assign(outline.root, d.root)
    }),
    loadSetting<Style>('style', styleData as Style, (d) => {
      styleData.style = d.style || ''
    }),
  ])
  worldviewLoading.value = characterLoading.value = outlineLoading.value = styleLoading.value = false
}

async function loadSetting<T>(
  type: string,
  _default: T,
  apply: (data: T) => void
) {
  try {
    const { data } = await getSetting(projectId.value, type as any)
    apply(data as T)
  } catch (e: any) {
    if (e?.response?.status !== 404) {
      ElMessage.warning(`加载${type}失败: ${e?.message || e}`)
    }
  }
}

// ====== 保存 ======
async function handleSave() {
  saving.value = true
  try {
    await Promise.all([
      saveSetting(projectId.value, 'worldview', { ...worldview }),
      saveSetting(projectId.value, 'characters', { characters: characters.value }),
      saveSetting(projectId.value, 'outline', { root: outline.root }),
      saveSetting(projectId.value, 'style', { ...styleData }),
    ])
    ElMessage.success('设定已保存')
  } catch (e: any) {
    ElMessage.error(`保存失败: ${e?.response?.data?.detail || e?.message || e}`)
  } finally {
    saving.value = false
  }
}

// ====== 人物卡片 ======
function toggleCard(c: Character) {
  expandedCard.value = expandedCard.value === c.id ? null : c.id
}

function addCharacter() {
  const id = `c${Date.now()}`
  characters.value.push({
    id,
    name: '',
    role: 'supporter',
    personality: '',
    goal: '',
    flaw: '',
    golden_finger: '',
    relations: [],
  })
  expandedCard.value = id
}

function removeCharacter(c: Character) {
  characters.value = characters.value.filter((x) => x.id !== c.id)
  characters.value.forEach((other) => {
    other.relations = other.relations.filter((r) => r.target !== c.name)
  })
  if (expandedCard.value === c.id) expandedCard.value = null
}

function addRelation(c: Character, target: string) {
  if (!target || target === c.name) {
    relationTarget.value[c.id] = ''
    return
  }
  if (!c.relations.some((r) => r.target === target)) {
    c.relations.push({ target, type: '认识' })
  }
  relationTarget.value[c.id] = ''
}

function removeRelation(c: Character, idx: number) {
  c.relations.splice(idx, 1)
}

// ====== 大纲节点编辑 ======
function editOutlineNode(data: OutlineNode) {
  editingNode.value = {
    ...data,
    cast: [...(data.cast || [])],
    foreshadow_plant: [...(data.foreshadow_plant || [])],
    foreshadow_reap: [...(data.foreshadow_reap || [])],
  }
  outlineDialogVisible.value = true
}

// ====== 生成 ======
async function handleGenerate(settingType: string) {
  generating.value = true
  try {
    const { data } = await generateSettings(projectId.value, settingType as any)
    const generated = data.settings?.[settingType]
    if (generated) {
      if (settingType === 'characters') characters.value = generated.characters || []
      else if (settingType === 'outline') Object.assign(outline.root, generated.root || {})
      else if (settingType === 'style') styleData.style = generated.style || ''
      else if (settingType === 'worldview') Object.assign(worldview.sections, generated.sections || {})
    }
    ElMessage.success('生成完成')
  } catch (e: any) {
    ElMessage.error(`生成失败: ${e?.response?.data?.detail || e?.message || e}`)
  } finally {
    generating.value = false
  }
}

async function handleGenerateMissing() {
  generating.value = true
  try {
    const { data: check } = await getPrereqCheck(projectId.value)
    const missing = Object.entries(check.details).filter(([, ok]) => !ok).map(([k]) => k)
    for (const type of missing) {
      const { data } = await generateSettings(projectId.value, type as any)
      const generated = data.settings?.[type]
      if (generated) {
        if (type === 'characters') characters.value = generated.characters || []
        else if (type === 'outline') Object.assign(outline.root, generated.root || {})
        else if (type === 'style') styleData.style = generated.style || ''
        else if (type === 'worldview') Object.assign(worldview.sections, generated.sections || {})
      }
    }
    ElMessage.success(`已生成缺失设定（${missing.length} 类）`)
  } catch (e: any) {
    ElMessage.error(`生成失败: ${e?.response?.data?.detail || e?.message || e}`)
  } finally {
    generating.value = false
  }
}

onMounted(loadAll)
</script>

<style scoped>
.settings-page {
  max-width: 1100px;
  margin: 0 auto;
}

.page-head {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  margin-bottom: 20px;
}

.page-title {
  margin: 0;
  font-size: 24px;
  font-weight: 600;
  color: var(--text-primary);
}

.page-subtitle {
  margin: 6px 0 0;
  color: var(--text-secondary);
  font-size: 14px;
}

.head-actions {
  display: flex;
  gap: 10px;
}

.settings-tabs {
  background: transparent;
}

.loading-block {
  min-height: 200px;
}

/* ====== 项目文档浏览器 ====== */
.vision-empty {
  padding: 30px 0;
}

.doc-browser {
  display: flex;
  gap: 20px;
  align-items: stretch;
}

.doc-list {
  width: 240px;
  flex-shrink: 0;
  border-right: 1px solid var(--border-color-light);
  padding-right: 16px;
  display: flex;
  flex-direction: column;
  gap: 6px;
  max-height: 70vh;
  overflow-y: auto;
}

.doc-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 12px;
  border-radius: 8px;
  cursor: pointer;
  transition: all var(--transition-base);
  border: 1px solid transparent;
}

.doc-item:hover {
  background: var(--content-bg);
}

.doc-item.active {
  background: rgba(79, 140, 255, 0.08);
  border-color: rgba(79, 140, 255, 0.3);
}

.doc-icon {
  color: var(--app-primary);
  flex-shrink: 0;
}

.doc-info {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.doc-name {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.doc-path {
  font-size: 11px;
  color: var(--text-placeholder);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.doc-preview {
  flex: 1;
  min-width: 0;
  padding: 4px 4px 4px 20px;
  border-left: 1px solid var(--border-color-light);
  max-height: 70vh;
  overflow-y: auto;
}

/* ====== 世界观 ====== */
.worldview-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 16px;
}

.wv-item.full {
  grid-column: 1 / -1;
}

.wv-label {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-regular);
  margin-bottom: 8px;
}

/* ====== 人物卡片墙 ====== */
.char-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 16px;
}

.char-count {
  font-size: 13px;
  color: var(--text-secondary);
}

.card-wall {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
  gap: 16px;
}

.char-card {
  background: var(--card-bg);
  border: 1px solid var(--border-color-light);
  border-radius: 12px;
  overflow: hidden;
  cursor: pointer;
  transition: all var(--transition-base);
  box-shadow: var(--card-shadow);
}

.char-card:hover {
  transform: translateY(-2px);
  box-shadow: var(--card-shadow-hover);
}

.char-card.expanded {
  grid-column: span 2;
  border-color: rgba(79, 140, 255, 0.5);
}

.card-front {
  padding: 16px;
}

.card-head {
  display: flex;
  align-items: center;
  gap: 10px;
}

.card-avatar {
  width: 40px;
  height: 40px;
  border-radius: 10px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #fff;
  font-size: 18px;
  font-weight: 600;
  flex-shrink: 0;
}

.card-avatar.role-protagonist { background: linear-gradient(135deg, #4f8cff, #6f5cff); }
.card-avatar.role-antagonist { background: linear-gradient(135deg, #f56c6c, #c0392b); }
.card-avatar.role-supporter { background: linear-gradient(135deg, #67c23a, #43a047); }

.card-title-group {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.card-name {
  font-size: 15px;
  font-weight: 600;
  color: var(--text-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.card-toggle {
  color: var(--text-secondary);
}

.card-personality {
  margin-top: 10px;
  font-size: 12px;
  color: var(--text-secondary);
  line-height: 1.5;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.char-card.expanded .card-personality {
  -webkit-line-clamp: unset;
}

.card-detail {
  border-top: 1px solid var(--border-color-light);
  padding: 14px 16px;
  display: flex;
  flex-direction: column;
  gap: 12px;
  cursor: default;
}

.detail-field {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.field-label {
  font-size: 12px;
  font-weight: 600;
  color: var(--text-secondary);
}

.relation-list {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
  align-items: center;
}

.detail-actions {
  display: flex;
  justify-content: flex-end;
}

.char-empty {
  padding: 30px 0;
}

/* ====== 大纲 ====== */
.outline-view {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.outline-summary {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 16px;
}

.outline-tree {
  background: transparent;
}

.tree-node {
  display: flex;
  align-items: center;
  gap: 8px;
  padding-right: 12px;
  width: 100%;
}

.tree-label {
  display: flex;
  align-items: center;
  gap: 6px;
  flex: 1;
  min-width: 0;
}

.tree-name {
  font-size: 13px;
  color: var(--text-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.outline-hint {
  font-size: 12px;
  color: var(--text-placeholder);
}

/* ====== 风格 ====== */
.style-view {
  display: flex;
  flex-direction: column;
}
</style>
