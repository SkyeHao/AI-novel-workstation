<template>
  <div class="dex-wrap">
    <!-- 对象：字段全为标量/数组 -> 键值网格 -->
    <template v-if="isObject(data) && isRecord(data)">
      <div class="dex-kv-grid">
        <div
          v-for="(val, key) in data"
          :key="key"
          class="dex-kv"
          :class="{ 'dex-kv-wide': Array.isArray(val) }"
        >
          <span class="dex-kv-key">{{ fieldLabel(key) }}</span>
          <template v-if="Array.isArray(val)">
            <DataExplorer
              v-if="arrayOfObjects(val)"
              :data="val"
              :depth="(depth || 0) + 1"
            />
            <div v-else class="dex-list">
              <span
                v-for="(item, i) in val"
                :key="i"
                class="dex-tag"
              >{{ stringify(item) }}</span>
              <span v-if="val.length === 0" class="dex-muted">无</span>
            </div>
          </template>
          <span
            v-else
            class="dex-kv-value"
            :class="{ mono: isMonoKey(key) }"
          >{{ stringify(val) }}</span>
        </div>
      </div>
    </template>

    <!-- 对象：含嵌套对象 -> 分节展示 -->
    <template v-else-if="isObject(data)">
      <div
        v-for="(val, key) in data"
        :key="key"
        class="dex-section"
      >
        <div class="dex-section-head">
          <span>{{ fieldLabel(key) }}</span>
          <span v-if="countOf(val) > 0" class="dex-count">{{ countOf(val) }}</span>
        </div>
        <div v-if="isEmpty(val)" class="dex-section-body empty">暂无内容</div>
        <div v-else class="dex-section-body">
          <DataExplorer :data="val" :depth="(depth || 0) + 1" />
        </div>
      </div>
    </template>

    <!-- 数组：标量 -> 标签列表；对象 -> 卡片网格 -->
    <template v-else-if="Array.isArray(data)">
      <div v-if="data.length === 0" class="dex-muted">无</div>
      <div v-else-if="arrayOfObjects(data)" class="dex-card-grid">
        <div v-for="(item, idx) in data" :key="idx" class="dex-card">
          <div class="dex-card-head">
            <span>{{ cardTitle(item, idx) }}</span>
            <span v-if="countOf(item) > 0" class="dex-count">{{ countOf(item) }}</span>
          </div>
          <div class="dex-card-body">
            <DataExplorer :data="item" :depth="(depth || 0) + 1" />
          </div>
        </div>
      </div>
      <div v-else class="dex-list">
        <span v-for="(item, i) in data" :key="i" class="dex-tag">{{ stringify(item) }}</span>
      </div>
    </template>

    <!-- 标量 -->
    <template v-else>
      <span class="dex-text">{{ stringify(data) }}</span>
    </template>
  </div>
</template>

<script setup lang="ts">
defineProps<{ data: unknown; depth?: number }>()

const FIELD_LABELS: Record<string, string> = {
  id: 'ID', no: '编号', name: '名称', title: '标题', type: '类型', role: '角色定位',
  personality: '性格', goal: '目标', flaw: '缺陷', golden_finger: '金手指',
  relations: '关系网络', target: '关联对象', status: '状态', content: '内容',
  desc: '描述', style: '文风', era: '时代背景', rules: '世界规则',
  geography: '地理风貌', factions: '势力组织', history: '历史沿革', sections: '设定分项',
  characters: '角色列表', root: '大纲总纲', summary_short: '一句话简介', summary_long: '详细梗概',
  children: '下级节点', task: '任务', event: '事件', function: '作用', cast: '出场人物',
  foreshadow_plant: '埋设伏笔', foreshadow_reap: '回收伏笔', target_words: '目标字数',
  created_at: '创建时间', updated_at: '更新时间', location: '地点', importance: '重要度',
  category: '分类', tags: '标签', note: '备注', plan: '计划', result: '结果',
  owner: '归属', current_owner: '当前持有者', previous_owner: '前任持有者',
  effects: '效果', attributes: '属性', skills: '技能', level: '等级', items: '物品',
  organization: '所属组织', affiliation: '阵营', species: '种族', age: '年龄',
  appearance: '外貌', background: '背景', motivation: '动机', conflict: '冲突',
  strengths: '优势', weaknesses: '弱点', habits: '习惯', speech: '说话风格',
  relationships: '人际关系', faction: '势力', region: '区域', capital: '都城',
  politics: '政治', economy: '经济', military: '军事', culture: '文化',
  magic: '魔法体系', technology: '科技水平', religion: '宗教', timeline: '时间线',
  events: '事件', foreshadow: '伏笔', chapter: '章节', chapters: '章节列表',
  summary: '摘要', word_count: '字数', words: '字数', hook: '章尾钩子',
  prev_summary: '上一章摘要', state: '状态', progress: '进度', version: '版本',
  info: '说明', detail: '详情', message: '信息', error: '错误', settings: '设置',
  vision: '故事愿景', theme: '主题', tone: '基调', premise: '核心设定',
  tool_name: '工具名称', tool_args: '调用参数', tool_result: '执行结果',
  observation: '观察结果', thought: '思考', session_id: '会话 ID', turn_id: '轮次 ID',
  model: '模型', base_url: '接口地址', provider: '服务商', temperature: '温度',
  max_tokens: '最大 Token', question: '问题', options: '选项', multiple: '可多选',
}

const MONO_KEYS = new Set([
  'id', 'no', 'model', 'base_url', 'api_key', 'session_id', 'turn_id',
  'timestamp', 'created_at', 'updated_at', 'path',
])

const isObject = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === 'object' && !Array.isArray(v)

/** 记录：所有字段值都不是嵌套对象（数组允许） */
const isRecord = (obj: Record<string, unknown>): boolean =>
  Object.values(obj).every((v) => !isObject(v))

const isEmpty = (v: unknown): boolean => {
  if (v === null || v === undefined || v === '') return true
  if (Array.isArray(v)) return v.length === 0
  if (isObject(v)) return Object.keys(v).length === 0
  return false
}

const countOf = (v: unknown): number => {
  if (Array.isArray(v)) return v.length
  if (isObject(v)) return Object.keys(v).length
  return 0
}

const arrayOfObjects = (arr: unknown[]): boolean => arr.length > 0 && arr.every((v) => isObject(v))

const stringify = (v: unknown): string => {
  if (v === null || v === undefined) return ''
  if (typeof v === 'object') return JSON.stringify(v)
  return String(v)
}

const fieldLabel = (key: string): string => FIELD_LABELS[key] || key

const isMonoKey = (key: string): boolean => MONO_KEYS.has(key)

const cardTitle = (item: Record<string, unknown>, idx: number): string => {
  const name = item?.name ?? item?.title ?? item?.label ?? item?.id
  return name !== undefined && name !== '' ? String(name) : '条目 ' + (idx + 1)
}
</script>
