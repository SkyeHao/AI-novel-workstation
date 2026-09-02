<template>
  <div class="characters-tab">
    <div v-if="loading" class="app-empty">
      <el-icon class="is-loading" :size="26"><Loading /></el-icon>
      <span>加载中...</span>
    </div>
    <el-alert v-else-if="error" :title="error" type="error" :closable="false" show-icon class="mv-16" />

    <template v-else>
      <!-- 模板驱动的结构化展示 -->
      <template v-if="hasTemplateData">
        <div class="ch-template-info">
          <el-tag type="success" effect="plain">
            模板: {{ template?.label || charactersData?.template_id }}
          </el-tag>
          <span class="ch-template-desc">{{ template?.description }}</span>
        </div>

        <div class="ch-characters-grid">
          <el-card
            v-for="character in charactersData?.characters"
            :key="character.id"
            class="ch-character-card"
            shadow="hover"
          >
            <template #header>
              <div class="ch-char-header">
                <div class="ch-char-info">
                  <div class="ch-char-avatar">
                    {{ character.name?.charAt(0) || '?' }}
                  </div>
                  <div class="ch-char-meta">
                    <span class="ch-char-name">{{ character.name || '未命名' }}</span>
                    <div class="ch-char-role">
                      <el-tag :type="getRoleTagType(character.role)" size="small">
                        {{ getRoleLabel(character.role) }}
                      </el-tag>
                    </div>
                  </div>
                </div>
              </div>
            </template>

            <div class="ch-char-dimensions">
              <div
                v-for="dim in templateDimensions"
                :key="dim.key"
                class="ch-dim-row"
              >
                <div class="ch-dim-label">
                  {{ dim.label }}
                  <el-tag v-if="dim.required" type="danger" size="small" effect="plain">必填</el-tag>
                </div>
                <div class="ch-dim-value">
                  <!-- 编辑模式 -->
                  <template v-if="editingCharacterId === character.id && editingDimKey === dim.key">
                    <el-input
                      v-if="dim.type === 'text'"
                      v-model="editValue"
                      :placeholder="dim.placeholder"
                      class="ch-dim-input"
                      @keyup.enter="saveDimension"
                    />
                    <el-input
                      v-else-if="dim.type === 'textarea'"
                      v-model="editValue"
                      type="textarea"
                      :rows="3"
                      :placeholder="dim.placeholder"
                      class="ch-dim-input"
                    />
                    <el-select
                      v-else-if="dim.type === 'select'"
                      v-model="editValue"
                      :placeholder="dim.placeholder"
                      class="ch-dim-input"
                    >
                      <el-option
                        v-for="opt in dim.options"
                        :key="opt"
                        :label="opt"
                        :value="opt"
                      />
                    </el-select>
                    <div class="ch-dim-actions">
                      <el-button type="primary" size="small" @click="saveDimension" :loading="saving">保存</el-button>
                      <el-button size="small" @click="editingCharacterId = null; editingDimKey = null">取消</el-button>
                    </div>
                  </template>

                  <!-- 展示模式 -->
                  <template v-else>
                    <div v-if="dim.type === 'tags'" class="ch-dim-tags">
                      <el-tag
                        v-for="tag in getDimensionTags(character, dim.key)"
                        :key="tag"
                        size="small"
                        effect="plain"
                      >
                        {{ tag }}
                      </el-tag>
                      <span v-if="!getDimensionValue(character, dim.key)" class="ch-dim-empty">未设置</span>
                    </div>
                    <div v-else-if="getDimensionValue(character, dim.key)" class="ch-dim-content">
                      {{ getDimensionValue(character, dim.key) }}
                    </div>
                    <div v-else class="ch-dim-empty">未设置</div>
                    <el-button
                      type="primary"
                      size="small"
                      text
                      @click="startEdit(character.id, dim.key)"
                    >
                      <el-icon><Edit /></el-icon>
                    </el-button>
                  </template>
                </div>
              </div>
            </div>

            <!-- 人物关系 -->
            <div v-if="character.relations && character.relations.length > 0" class="ch-relations">
              <div class="ch-relations-title">人物关系</div>
              <div class="ch-relations-list">
                <el-tag
                  v-for="rel in character.relations"
                  :key="rel.target_id"
                  size="small"
                  effect="plain"
                >
                  {{ rel.target_name }}: {{ rel.type }}
                </el-tag>
              </div>
            </div>
          </el-card>
        </div>
      </template>

      <!-- 旧格式兼容 -->
      <div v-if="hasLegacyData && !hasTemplateData" class="ch-panel lift-card">
        <div class="ch-panel-head">
          <span class="ch-panel-title">
            <el-icon><DataAnalysis /></el-icon>
            人物设定
          </span>
        </div>
        <div class="ch-panel-body">
          <DataExplorer :data="legacyData" />
        </div>
      </div>

      <!-- 空状态 -->
      <div v-if="!hasTemplateData && !hasLegacyData" class="app-empty">
        <el-icon :size="44" color="#c0c4cc"><UserFilled /></el-icon>
        <span class="settings-empty-title">暂无人物设定</span>
        <span class="settings-empty-hint">可前往「创作引擎」与 Agent 对话，引导生成对应内容</span>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRoute } from 'vue-router'
import { ElMessage } from 'element-plus'
import { UserFilled, Edit, Loading } from '@element-plus/icons-vue'
import {
  getSetting,
  saveSetting,
  getCharacterTemplates,
  type CharacterTemplate,
  type CharactersData,
  type CharacterEntry,
} from '@/api'
import DataExplorer from '@/components/DataExplorer.vue'

const route = useRoute()
const projectId = route.params.id as string

const loading = ref(false)
const saving = ref(false)
const error = ref('')

// 模板相关
const templates = ref<CharacterTemplate[]>([])
const template = computed(() => {
  if (!charactersData.value) return null
  return templates.value.find(t => t.id === charactersData.value!.template_id) || null
})
const templateDimensions = computed(() => template.value?.dimensions || [])

// 数据相关
const charactersData = ref<CharactersData | null>(null)
const legacyData = ref<any>(null)

// 编辑相关
const editingCharacterId = ref<string | null>(null)
const editingDimKey = ref<string | null>(null)
const editValue = ref('')

// 判断是否有模板驱动的数据
const hasTemplateData = computed(() => {
  return charactersData.value &&
    charactersData.value?.template_id &&
    charactersData.value?.characters &&
    charactersData.value?.characters.length > 0
})

// 判断是否有旧格式数据
const hasLegacyData = computed(() => {
  if (!legacyData.value) return false
  if (hasTemplateData.value) return false
  return legacyData.value.characters && legacyData.value.characters.length > 0
})

function getRoleLabel(role: string): string {
  const labels: Record<string, string> = {
    protagonist: '主角',
    supporter: '配角',
    antagonist: '反派',
    neutral: '中立',
  }
  return labels[role] || role
}

function getRoleTagType(role: string): string {
  const types: Record<string, string> = {
    protagonist: 'primary',
    supporter: 'success',
    antagonist: 'danger',
    neutral: 'info',
  }
  return types[role] || 'info'
}

function getDimensionValue(character: CharacterEntry, key: string): any {
  if (!character.dimensions) return null
  return character.dimensions[key]
}

function getDimensionTags(character: CharacterEntry, key: string): string[] {
  const value = getDimensionValue(character, key)
  if (!value) return []
  if (Array.isArray(value)) return value
  if (typeof value === 'string') {
    return value.split(/[,，、]/).map((s: string) => s.trim()).filter(Boolean)
  }
  return []
}

function startEdit(characterId: string, key: string) {
  editingCharacterId.value = characterId
  editingDimKey.value = key
  const character = charactersData.value?.characters.find(c => c.id === characterId)
  if (!character) return
  const value = getDimensionValue(character, key)
  if (Array.isArray(value)) {
    editValue.value = value.join(', ')
  } else {
    editValue.value = value || ''
  }
}

async function saveDimension() {
  if (!charactersData.value || !editingCharacterId.value || !editingDimKey.value) return

  saving.value = true
  try {
    const character = charactersData.value?.characters.find(c => c.id === editingCharacterId.value)
    if (!character) return

    const dim = templateDimensions.value.find(d => d.key === editingDimKey.value)
    let newValue: any = editValue.value

    if (dim?.type === 'tags') {
      newValue = editValue.value.split(/[,，、]/).map((s: string) => s.trim()).filter(Boolean)
    }

    character.dimensions[editingDimKey.value] = newValue

    await saveSetting(projectId, 'characters', charactersData.value as any)

    editingCharacterId.value = null
    editingDimKey.value = null
    ElMessage.success('保存成功')
  } catch (err) {
    ElMessage.error('保存失败')
  } finally {
    saving.value = false
  }
}

onMounted(async () => {
  loading.value = true
  try {
    const [templatesResp, settingResp] = await Promise.allSettled([
      getCharacterTemplates(),
      getSetting(projectId, 'characters'),
    ])

    if (templatesResp.status === 'fulfilled') {
      templates.value = templatesResp.value.data
    }

    if (settingResp.status === 'fulfilled') {
      const data = settingResp.value.data as any
      legacyData.value = data

      if (data.template_id && data.characters) {
        charactersData.value = data as CharactersData
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
.characters-tab {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.ch-template-info {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 16px;
  background: linear-gradient(90deg, #f0fdf4 0%, #dcfce7 100%);
  border-radius: 8px;
  border: 1px solid #86efac;
}

.ch-template-desc {
  font-size: 13px;
  color: #166534;
}

.ch-characters-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(400px, 1fr));
  gap: 16px;
}

.ch-character-card {
  transition: all 0.2s ease;
}

.ch-character-card:hover {
  transform: translateY(-2px);
}

.ch-char-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.ch-char-info {
  display: flex;
  align-items: center;
  gap: 12px;
}

.ch-char-avatar {
  width: 48px;
  height: 48px;
  border-radius: 50%;
  background: linear-gradient(135deg, #6366f1, #8b5cf6);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 20px;
  font-weight: 700;
  color: #fff;
  flex-shrink: 0;
}

.ch-char-meta {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.ch-char-name {
  font-size: 16px;
  font-weight: 700;
  color: var(--text-primary);
}

.ch-char-role {
  display: flex;
  align-items: center;
  gap: 6px;
}

.ch-dim-row {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  padding: 10px 0;
  border-bottom: 1px solid var(--border-color-lighter);
}

.ch-dim-row:last-child {
  border-bottom: none;
}

.ch-dim-label {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-secondary);
  min-width: 80px;
  padding-top: 4px;
}

.ch-dim-value {
  flex: 1;
  font-size: 14px;
  color: var(--text-regular);
  line-height: 1.6;
}

.ch-dim-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.ch-dim-empty {
  font-size: 13px;
  color: var(--text-placeholder);
  font-style: italic;
}

.ch-dim-input {
  margin-top: 4px;
}

.ch-dim-actions {
  display: flex;
  gap: 8px;
  margin-top: 8px;
}

.ch-relations {
  margin-top: 12px;
  padding-top: 12px;
  border-top: 1px dashed var(--border-color-light);
}

.ch-relations-title {
  font-size: 12px;
  font-weight: 600;
  color: var(--text-secondary);
  margin-bottom: 8px;
}

.ch-relations-list {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.ch-panel {
  background: #fff;
  border: 1px solid var(--border-color-light);
  border-radius: 12px;
  overflow: hidden;
  box-shadow: var(--card-shadow);
}

.ch-panel-head {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 16px;
  border-bottom: 1px solid var(--border-color-light);
  background: linear-gradient(90deg, #fafafa 0%, #ffffff 100%);
}

.ch-panel-title {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  font-size: 14px;
  font-weight: 600;
  color: var(--text-primary);
}

.ch-panel-title .el-icon { color: #6366f1; }

.ch-panel-body {
  padding: 14px 18px;
}

.settings-empty-title { font-size: 15px; font-weight: 500; color: var(--text-regular); }
.settings-empty-hint { font-size: 12px; color: var(--text-placeholder); }
</style>







