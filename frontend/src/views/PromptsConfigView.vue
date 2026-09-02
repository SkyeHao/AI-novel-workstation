<template>
  <div class="prompts-config-view">
    <PageHeader title="提示词管理" :subtitle="headerSubtitle" icon="Document">
      <template #actions>
        <el-button v-if="activeTab === 'nodes'" plain :loading="loading" @click="loadNodePrompts">
          <el-icon style="margin-right: 6px"><Refresh /></el-icon>
          刷新
        </el-button>
      </template>
    </PageHeader>

    <div class="pc-tabs">
      <button
        class="prompts-chip pc-tab-chip"
        :class="{ active: activeTab === 'nodes' }"
        @click="activeTab = 'nodes'"
      >
        <span class="chip-label">创作引擎节点</span>
        <span class="chip-count">{{ nodePrompts.length }}</span>
      </button>
      <button
        class="prompts-chip pc-tab-chip"
        :class="{ active: activeTab === 'roundtable' }"
        @click="activeTab = 'roundtable'"
      >
        <span class="chip-label">圆桌会议</span>
        <span class="chip-count">{{ roleCount }}</span>
      </button>
    </div>

    <template v-if="activeTab === 'nodes'">
      <div class="prompts-node-stats">
      <button
        v-for="n in nodePrompts"
        :key="n.key"
          class="prompts-chip node-chip"
          :class="{ active: activeNodeKey===n.key }"
          @click="switchNode(n.key)"
        >
          <span class="chip-dot" :style="{ background: NODE_COLORS[n.key] }"></span>
          <span class="chip-label">{{ n.label }}</span>
          <span v-if="n.isCustom" class="chip-badge">已改</span>
        </button>
      </div>

      <div class="panel" v-if="currentNode">
        <div class="panel-head">
          <div class="panel-title-group">
            <span class="chip-dot" :style="{ background: NODE_COLORS[currentNode.key], width:'10px', height:'10px' }"></span>
            <span class="panel-title">{{ currentNode.label }}</span>
            <el-tag size="small" type="info" effect="plain" round>{{ currentNode.key }}</el-tag>
            <el-tag v-if="currentNode.isCustom" size="small" type="warning" effect="plain" round>已自定义</el-tag>
            <span class="panel-subtitle">{{ currentNode.isCustom && currentNode.updatedAt ? formatTime(currentNode.updatedAt) : '未自定义则使用默认' }}</span>
          </div>
          <div class="panel-actions">
            <span class="muted mono" style="font-size:12px; margin-right:8px">{{ (isEditing? currentPromptDraft : (currentNode?.prompt||'')).length }} 字</span>
            <el-button size="small" plain @click="showDefaultDialog=true">查看默认</el-button>
            <el-button size="small" plain :disabled="!currentNode.isCustom" @click="handleReset">重置为默认</el-button>
            <el-button v-if="!isEditing" size="small" type="primary" plain @click="startEdit"><el-icon style="margin-right:4px"><Edit /></el-icon>编辑</el-button>
            <template v-else>
              <el-button size="small" @click="cancelEdit">取消</el-button>
              <el-button size="small" type="primary" :loading="saving" @click="saveNodePrompt">保存</el-button>
            </template>
          </div>
        </div>
        <div class="panel-body" :class="{ 'is-editing': isEditing }" style="padding:0">
          <!-- 只读预览：更易读的排版字体 + 防误触 -->
          <div v-if="!isEditing" class="prompt-readonly" @dblclick="startEdit">
            <pre class="prompt-pre">{{ currentNode.prompt }}</pre>
            <div class="readonly-hint"><el-icon><View /></el-icon> 双击或点击右上角「编辑」进入编辑模式</div>
          </div>
          <el-input
            v-else
            v-model="currentPromptDraft"
            type="textarea"
            :rows="18"
            :placeholder="'请输入 '+currentNode.label+' 的系统提示词'"
            class="prompt-editor"
          />
        </div>
        <div class="panel-foot">
          <span class="muted" style="font-size:12px">保存后新开的 Agent 对话即生效，历史会话不受影响</span>
          <span v-if="saveTip" class="save-tip">{{ saveTip }}</span>
        </div>
      </div>
      <el-empty v-else description="暂无节点" />

      <el-dialog v-model="showDefaultDialog" title="默认提示词" width="720px">
      <div class="default-pre"><pre>{{ currentNode?.defaultPrompt || "" }}</pre></div>
      <template #footer>
        <el-button @click="showDefaultDialog=false">关闭</el-button>
        <el-button type="primary" @click="useDefaultAndEdit">覆为当前编辑并进入编辑</el-button>
      </template>
    </el-dialog>
    </template>

    <div v-show="activeTab === 'roundtable'" class="pc-roundtable">
      <RoundtableAgentsTab @count="roleCount = $event" />
    </div>

  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import PageHeader from '@/components/PageHeader.vue'
import RoundtableAgentsTab from '@/components/RoundtableAgentsTab.vue'
import { getNodePrompts, updateNodePrompt, resetNodePrompt, type NodePromptDetail } from '@/api'

const loading = ref(false)
const saving = ref(false)
const nodePrompts = ref<NodePromptDetail[]>([])
const activeTab = ref<'nodes' | 'roundtable'>('nodes')
const roleCount = ref(0)
const activeNodeKey = ref('ideation')
const currentPromptDraft = ref('')
const isEditing = ref(false)
const showDefaultDialog = ref(false)
const saveTip = ref('')

const NODE_COLORS: Record<string,string> = { ideation:'#6366f1', worldview:'#4f46e5', characters:'#00b578', outline:'#ff9f43', writing:'#eb5757', review:'#ef4444', style:'#8b5cf6' }
const customCount = computed(()=> nodePrompts.value.filter(n=>n.isCustom).length)
const currentNode = computed(()=> nodePrompts.value.find(n=>n.key===activeNodeKey.value) || null)
const headerSubtitle = computed(() =>
  activeTab.value === 'nodes'
    ? '创作引擎各流程节点的系统提示词 · ' + customCount.value + ' 已自定义'
    : '圆桌会议 Agent 角色的系统提示词与模型配置 · ' + roleCount.value + ' 个角色'
)

watch(activeNodeKey, ()=>{ isEditing.value=false })
watch(currentNode, (n)=>{ if(n) currentPromptDraft.value = n.prompt }, { immediate:true })

function switchNode(key:string){
  if(isEditing.value && currentNode.value && currentPromptDraft.value !== currentNode.value.prompt){
    ElMessageBox.confirm('当前编辑未保存，切换将丢失改动，是否继续？','未保存', { type:'warning', confirmButtonText:'继续切换', cancelButtonText:'留在当前' }).then(()=>{ isEditing.value=false; activeNodeKey.value=key }).catch(()=>{})
  } else { isEditing.value=false; activeNodeKey.value=key }
}
function startEdit(){ if(!currentNode.value) return; currentPromptDraft.value = currentNode.value.prompt; isEditing.value=true }
function cancelEdit(){ isEditing.value=false; if(currentNode.value) currentPromptDraft.value=currentNode.value.prompt }

function formatTime(s:string){ try{ return new Date(s).toLocaleString() }catch{ return s } }
async function loadNodePrompts(){
  loading.value=true
  try{
    const res = await getNodePrompts()
    nodePrompts.value = res.data.prompts || []
    if(nodePrompts.value.length && !nodePrompts.value.find(n=>n.key===activeNodeKey.value)) activeNodeKey.value=nodePrompts.value[0]!.key
    if(currentNode.value) currentPromptDraft.value=currentNode.value.prompt
  }catch{ ElMessage.error('加载创作引擎提示词失败') }finally{ loading.value=false }
}
async function saveNodePrompt(){
  if(!currentNode.value) return
  if(!currentPromptDraft.value.trim()){ ElMessage.warning('提示词不能为空'); return }
  saving.value=true
  try{
    const res = await updateNodePrompt(currentNode.value.key, currentPromptDraft.value)
    const idx = nodePrompts.value.findIndex(n=>n.key===currentNode.value!.key)
    if(idx>=0) nodePrompts.value[idx]=res.data
    isEditing.value=false
    saveTip.value='已保存'
    ElMessage.success('保存成功')
    setTimeout(()=> saveTip.value='', 2000)
  }catch(e:any){ ElMessage.error(e?.response?.data?.error || '保存失败') }finally{ saving.value=false }
}
async function handleReset(){
  if(!currentNode.value) return
  try{
    await ElMessageBox.confirm('确定重置为默认提示词？自定义内容将被覆盖。','确认重置',{ type:'warning' })
    const res = await resetNodePrompt(currentNode.value.key)
    const idx = nodePrompts.value.findIndex(n=>n.key===currentNode.value!.key)
    if(idx>=0) nodePrompts.value[idx]=res.data
    currentPromptDraft.value=res.data.prompt
    isEditing.value=false
    ElMessage.success('已重置为默认')
  }catch(e:any){ if(e!=='cancel') ElMessage.error('重置失败') }
}
function useDefaultAndEdit(){
  if(currentNode.value) currentPromptDraft.value=currentNode.value.defaultPrompt
  showDefaultDialog.value=false
  isEditing.value=true
}

onMounted(loadNodePrompts)
</script>

<style scoped>
.prompts-config-view{ max-width:1400px; margin:0 auto; display:flex; flex-direction:column; }
.pc-tabs{ display:flex; flex-wrap:wrap; gap:8px; margin-bottom:14px; }
.pc-tab-chip .chip-count{ font-size:11px; font-weight:600; padding:1px 8px; border-radius:999px; color:#4f46e5; background:rgba(79,70,229,.1); }
.pc-tab-chip.active .chip-count{ color:#fff; background:rgba(255,255,255,.25); }
.pc-roundtable{ padding:2px; }
.prompts-module-stats, .prompts-node-stats{ display:flex; flex-wrap:wrap; gap:8px; margin-bottom:14px; }
.prompts-chip{ display:inline-flex; align-items:center; gap:7px; padding:5px 14px; border:1px solid var(--border-color-light); border-radius:999px; background:#fff; cursor:pointer; transition:all var(--transition-fast); font-size:12.5px; }
.prompts-chip:hover{ border-color:#4f46e5; background:#f5f5ff; }
.prompts-chip.active{ border-color:#4f46e5; background:linear-gradient(135deg,#4f46e5,#2563eb); box-shadow:0 4px 12px rgba(79,70,229,.3); }
.prompts-chip .chip-label{ color:var(--text-regular); }
.prompts-chip.active .chip-label{ color:#fff; }
.chip-dot{ width:8px; height:8px; border-radius:50%; flex-shrink:0; }
.prompts-chip.active .chip-dot{ box-shadow:0 0 0 2px rgba(255,255,255,.4); }
.chip-count, .chip-badge{ font-size:11px; font-weight:600; padding:1px 8px; border-radius:999px; }
.chip-count{ color:#4f46e5; background:rgba(79,70,229,.1); }
.chip-count.empty{ color:#909399; background:rgba(144,147,153,.12); }
.prompts-chip.active .chip-count{ color:#fff; background:rgba(255,255,255,.25); }
.chip-badge{ color:#e6a23c; background:rgba(230,162,60,.14); border:1px solid rgba(230,162,60,.3); }
.prompts-chip.active .chip-badge{ color:#fff; background:rgba(255,255,255,.22); border-color:rgba(255,255,255,.3); }
.panel{ background:#fff; border:1px solid var(--border-color-light); border-radius:12px; overflow:hidden; }
.panel-head{ display:flex; align-items:center; justify-content:space-between; gap:12px; padding:12px 16px; border-bottom:1px solid var(--border-color-light); background:linear-gradient(135deg,#fafaff 0%,#f8fafc 100%); }
.panel-title-group{ display:flex; align-items:center; gap:10px; flex-wrap:wrap; }
.panel-title{ font-weight:700; font-size:14px; color:var(--text-primary); }
.panel-subtitle{ font-size:12px; color:var(--text-secondary); }
.panel-actions{ display:flex; align-items:center; gap:8px; flex-shrink:0; }
.panel-body{ padding:0; }
.panel-foot{ display:flex; align-items:center; gap:10px; padding:10px 16px; border-top:1px solid var(--border-color-light); background:#fafafa; font-size:12px; }
/* 只读预览：更舒适的中文阅读字体 */
.prompt-readonly{ padding:18px 20px; max-height:560px; overflow:auto; background:#fcfcff; }
.prompt-pre{ margin:0; white-space:pre-wrap; word-break:break-word; font-family:"PingFang SC","Microsoft YaHei","Noto Sans SC","HarmonyOS Sans SC","Source Han Sans SC","Helvetica Neue",Arial,sans-serif; font-size:14px; line-height:1.85; letter-spacing:0.02em; color:#1e2a3a; }
.readonly-hint{ margin-top:12px; display:inline-flex; align-items:center; gap:6px; font-size:12px; color:var(--text-secondary); background:#f5f5ff; border:1px dashed rgba(99,102,241,.25); padding:6px 10px; border-radius:999px; }
/* 编辑态：保留易读字体，但加编辑感 */
.prompt-editor :deep(textarea){ font-family:"PingFang SC","Microsoft YaHei","Noto Sans SC","HarmonyOS Sans SC","Source Han Sans SC","Helvetica Neue",Arial,sans-serif; font-size:14px; line-height:1.85; letter-spacing:0.02em; color:#1e2a3a; border:none; border-radius:0; box-shadow:none; padding:18px 20px; background:#fff; min-height:420px; }
.panel-body.is-editing{ background:#fff; border-top:1px solid rgba(99,102,241,.12); }
.default-pre{ background:#fcfcff; border:1px solid var(--border-color-light); border-radius:8px; padding:14px; max-height:520px; overflow:auto; }
.default-pre pre{ margin:0; white-space:pre-wrap; word-break:break-word; font-family:"PingFang SC","Microsoft YaHei","Noto Sans SC","HarmonyOS Sans SC","Source Han Sans SC",sans-serif; font-size:13.5px; line-height:1.8; color:#1e2a3a; }
.roundtable-intro{ font-size:13px; color:var(--text-secondary); line-height:1.7; padding:14px 16px; border-bottom:1px solid var(--border-color-light); background:linear-gradient(135deg,rgba(99,102,241,.06),rgba(37,99,235,.02)); }
.roles-grid{ display:grid; grid-template-columns:repeat(auto-fill,minmax(360px,1fr)); gap:14px; padding:16px; }
.role-card{ padding:16px; background:#fff; border:1px solid var(--border-color-light); border-radius:10px; transition:all .2s; }
.role-card:hover{ border-color:rgba(99,102,241,.25); box-shadow:0 6px 20px rgba(79,70,229,.08); transform:translateY(-1px); }
.role-card.role-builtin{ background:linear-gradient(135deg,#f8fafc 0%,#f1f5f9 100%); }
.role-card-header{ display:flex; justify-content:space-between; gap:10px; margin-bottom:8px; }
.role-title-row{ display:flex; align-items:center; gap:8px; }
.role-name{ font-weight:700; }
.role-actions{ display:flex; gap:4px; }
.role-desc{ font-size:12px; color:var(--text-secondary); margin:0 0 8px; }
.role-prompt-preview{ background:#fafafa; border:1px solid var(--border-color-light); border-radius:8px; padding:10px; margin-bottom:8px; }
.prompt-label{ font-size:11px; color:var(--text-muted); font-weight:600; margin-bottom:4px; }
.prompt-text{ font-size:12px; color:var(--text-secondary); line-height:1.65; font-family:"PingFang SC","Microsoft YaHei","Noto Sans SC",sans-serif; white-space:pre-wrap; word-break:break-word; }
.role-meta{ display:flex; gap:12px; font-size:11px; color:var(--text-muted); align-items:center; }
.builtin-tag{ display:inline-flex; align-items:center; gap:4px; color:#6366f1; }
.role-form{ max-height:60vh; overflow:auto; padding-right:8px; }
.save-tip{ color:#00b578; font-weight:600; }
.muted{ color:var(--text-secondary); }
.mono{ font-family:Consolas,monospace; }
</style>
