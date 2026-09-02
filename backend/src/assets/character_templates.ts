/**
 * 人物维度模板（资产库）。
 * 不同题材的人物关注不同维度：都市关注身份/职业/关系，玄幻关注境界/功法/法宝。
 * 每个模板提供一组「标准维度」，Agent 按模板生成结构化 JSON，前端按维度动态展示。
 */

export type CharacterDimensionType = "text" | "textarea" | "tags" | "select";

export interface CharacterTemplateDimension {
  key: string;
  label: string;
  hint: string;
  type: CharacterDimensionType;
  required: boolean;
  placeholder?: string;
  options?: string[];
}

export interface CharacterTemplate {
  id: string;
  label: string;
  description: string;
  dimensions: CharacterTemplateDimension[];
}

export const CHARACTER_TEMPLATES: CharacterTemplate[] = [
  {
    id: "urban",
    label: "都市",
    description: "都市异能 / 重生都市 / 职场商战 / 校园青春",
    dimensions: [
      { key: "identity", label: "身份", hint: "公开身份与隐藏身份", type: "text", required: true, placeholder: "如：大学生 / 隐藏身份：修行者" },
      { key: "personality", label: "性格", hint: "核心性格特征", type: "textarea", required: true, placeholder: "如：表面躺平，内心精明" },
      { key: "goal", label: "目标", hint: "当前阶段目标", type: "text", required: true },
      { key: "flaw", label: "缺陷", hint: "性格弱点或限制", type: "text", required: true },
      { key: "golden_finger", label: "金手指", hint: "特殊能力或优势", type: "textarea", required: false, placeholder: "如：前世记忆 + 编程技能" },
      { key: "background", label: "背景", hint: "人物背景故事", type: "textarea", required: false },
      { key: "skills", label: "技能", hint: "掌握的技能", type: "tags", required: false },
      { key: "relations", label: "关系", hint: "与其他人物的关系", type: "textarea", required: false },
      { key: "secret", label: "秘密", hint: "隐藏的秘密", type: "text", required: false },
    ],
  },
  {
    id: "xuanhuan",
    label: "玄幻仙侠",
    description: "玄幻 / 仙侠 / 修真 / 武侠",
    dimensions: [
      { key: "realm", label: "境界", hint: "当前修炼境界", type: "text", required: true, placeholder: "如：筑基初期" },
      { key: "personality", label: "性格", hint: "核心性格特征", type: "textarea", required: true },
      { key: "goal", label: "目标", hint: "修炼目标或人生追求", type: "text", required: true },
      { key: "flaw", label: "缺陷", hint: "性格弱点或修炼障碍", type: "text", required: true },
      { key: "technique", label: "功法", hint: "主修功法", type: "text", required: false },
      { key: "artifact", label: "法宝", hint: "持有法宝", type: "tags", required: false },
      { key: "faction", label: "势力", hint: "所属宗门或家族", type: "text", required: false },
      { key: "golden_finger", label: "金手指", hint: "特殊机缘或天赋", type: "textarea", required: false },
      { key: "enemy", label: "仇敌", hint: "结仇对象", type: "text", required: false },
    ],
  },
  {
    id: "scifi",
    label: "科幻未来",
    description: "星际 / 机甲 / 赛博朋克 / AI",
    dimensions: [
      { key: "identity", label: "身份", hint: "职业或角色定位", type: "text", required: true },
      { key: "ability", label: "能力", hint: "特殊能力或改造", type: "textarea", required: true },
      { key: "faction", label: "阵营", hint: "所属势力", type: "text", required: true },
      { key: "personality", label: "性格", hint: "核心性格特征", type: "textarea", required: true },
      { key: "goal", label: "目标", hint: "当前目标", type: "text", required: true },
      { key: "equipment", label: "装备", hint: "持有装备或机甲", type: "tags", required: false },
      { key: "background", label: "背景", hint: "人物背景", type: "textarea", required: false },
      { key: "secret", label: "秘密", hint: "隐藏的秘密", type: "text", required: false },
    ],
  },
  {
    id: "history",
    label: "历史权谋",
    description: "宫廷 / 官场 / 架空历史 / 权谋",
    dimensions: [
      { key: "identity", label: "身份", hint: "公开身份与隐藏身份", type: "text", required: true },
      { key: "office", label: "职位", hint: "官职或爵位", type: "text", required: true },
      { key: "personality", label: "性格", hint: "核心性格特征", type: "textarea", required: true },
      { key: "goal", label: "目标", hint: "政治目标", type: "text", required: true },
      { key: "flaw", label: "缺陷", hint: "性格弱点", type: "text", required: true },
      { key: "family", label: "家世", hint: "家族背景", type: "text", required: false },
      { key: "stance", label: "立场", hint: "政治立场", type: "select", required: false, options: ["保守派", "改革派", "中立", "观望"] },
      { key: "relations", label: "关系", hint: "君臣、家族、姻亲关系", type: "textarea", required: false },
      { key: "leverage", label: "把柄", hint: "被拿捏的把柄", type: "text", required: false },
    ],
  },
  {
    id: "mystery",
    label: "悬疑推理",
    description: "刑侦 / 都市悬疑 / 无限流解密",
    dimensions: [
      { key: "identity", label: "身份", hint: "职业或角色", type: "text", required: true },
      { key: "personality", label: "性格", hint: "核心性格特征", type: "textarea", required: true },
      { key: "goal", label: "目标", hint: "当前目标", type: "text", required: true },
      { key: "clues", label: "掌握线索", hint: "已知线索", type: "textarea", required: false },
      { key: "secret", label: "秘密", hint: "隐藏的秘密", type: "text", required: false },
      { key: "motive", label: "动机", hint: "行为动机", type: "textarea", required: false },
      { key: "suspicion", label: "嫌疑", hint: "涉案嫌疑程度", type: "select", required: false, options: ["无嫌疑", "轻微嫌疑", "重大嫌疑", "真凶"] },
      { key: "alive", label: "存活", hint: "生死状态", type: "select", required: false, options: ["存活", "死亡", "失踪"] },
    ],
  },
  {
    id: "game",
    label: "游戏异界",
    description: "无限流 / 网游 / 系统流 / 异世界",
    dimensions: [
      { key: "level", label: "等级", hint: "当前等级", type: "text", required: true },
      { key: "job", label: "职业", hint: "职业或专精", type: "text", required: true },
      { key: "personality", label: "性格", hint: "核心性格特征", type: "textarea", required: true },
      { key: "goal", label: "目标", hint: "当前目标", type: "text", required: true },
      { key: "skills", label: "技能", hint: "掌握技能", type: "tags", required: false },
      { key: "equipment", label: "装备", hint: "持有装备", type: "tags", required: false },
      { key: "golden_finger", label: "金手指", hint: "特殊能力或系统", type: "textarea", required: false },
      { key: "faction", label: "势力", hint: "所属公会或队伍", type: "text", required: false },
    ],
  },
  {
    id: "romance",
    label: "言情",
    description: "古言 / 现言 / 甜宠 / 霸总",
    dimensions: [
      { key: "identity", label: "身份", hint: "身份与设定", type: "text", required: true },
      { key: "personality", label: "性格", hint: "核心性格特征", type: "textarea", required: true },
      { key: "goal", label: "目标", hint: "当前目标", type: "text", required: true },
      { key: "family", label: "家世", hint: "家世背景", type: "text", required: false },
      { key: "relations", label: "关系", hint: "与主角的关系", type: "textarea", required: true },
      { key: "misunderstanding", label: "误会", hint: "当前误会或隔阂", type: "text", required: false },
      { key: "mood", label: "情绪", hint: "情绪状态", type: "text", required: false },
    ],
  },
  {
    id: "apocalypse",
    label: "末世生存",
    description: "末世 / 废土 / 丧尸 / 灾变",
    dimensions: [
      { key: "identity", label: "身份", hint: "末世前的身份", type: "text", required: true },
      { key: "ability", label: "异能", hint: "异能或特殊能力", type: "textarea", required: true },
      { key: "personality", label: "性格", hint: "核心性格特征", type: "textarea", required: true },
      { key: "goal", label: "目标", hint: "生存目标", type: "text", required: true },
      { key: "survival", label: "生存状态", hint: "健康、饥饿、疲劳", type: "text", required: false },
      { key: "team", label: "队伍", hint: "所属队伍", type: "text", required: false },
      { key: "supplies", label: "物资", hint: "持有物资", type: "tags", required: false },
    ],
  },
  {
    id: "sports",
    label: "军事竞技",
    description: "军事 / 体育 / 电竞 / 职场",
    dimensions: [
      { key: "identity", label: "身份", hint: "职业或角色", type: "text", required: true },
      { key: "ability", label: "能力", hint: "技能数值或段位", type: "text", required: true },
      { key: "personality", label: "性格", hint: "核心性格特征", type: "textarea", required: true },
      { key: "goal", label: "目标", hint: "竞技目标", type: "text", required: true },
      { key: "team", label: "队伍", hint: "所属队伍", type: "text", required: false },
      { key: "record", label: "战绩", hint: "胜负记录", type: "text", required: false },
      { key: "opponent", label: "对手", hint: "宿敌或竞争对手", type: "text", required: false },
    ],
  },
  {
    id: "generic",
    label: "通用",
    description: "题材未定或混合题材的兜底模板",
    dimensions: [
      { key: "identity", label: "身份", hint: "身份与处境", type: "text", required: true },
      { key: "personality", label: "性格", hint: "核心性格特征", type: "textarea", required: true },
      { key: "goal", label: "目标", hint: "当前目标", type: "text", required: true },
      { key: "flaw", label: "缺陷", hint: "性格弱点", type: "text", required: true },
      { key: "background", label: "背景", hint: "人物背景", type: "textarea", required: false },
      { key: "relations", label: "关系", hint: "与其他人物的关系", type: "textarea", required: false },
      { key: "secret", label: "秘密", hint: "隐藏的秘密", type: "text", required: false },
    ],
  },
];

/** 按题材名查找人物模板，未命中返回通用模板 */
export function findCharacterTemplate(genre: string): CharacterTemplate {
  const key = String(genre ?? "").trim();
  if (!key) return CHARACTER_TEMPLATES[CHARACTER_TEMPLATES.length - 1];
  return (
    CHARACTER_TEMPLATES.find((t) => t.label === key || t.id === key || t.label.includes(key) || key.includes(t.label)) ??
    CHARACTER_TEMPLATES[CHARACTER_TEMPLATES.length - 1]
  );
}

/** 生成人物的结构化 JSON Schema（用于 Agent 提示词） */
export function buildCharacterSchema(template: CharacterTemplate): string {
  const dims = template.dimensions.map((d) => {
    const desc = d.required ? "（必填）" : "（可选）";
    return `    "${d.key}": "${d.label}${desc} - ${d.hint}"`;
  });
  return `{
  "template_id": "${template.id}",
  "characters": [
    {
      "id": "c1",
      "name": "人物姓名",
      "role": "protagonist|supporter|antagonist",
      "dimensions": {
${dims.join(",\n")}
      },
      "relations": [
        {
          "target_id": "c2",
          "target_name": "目标人物姓名",
          "type": "关系类型",
          "description": "关系描述"
        }
      ]
    }
  ]
}`;
}

