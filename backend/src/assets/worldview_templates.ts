/**
 * 世界观维度模板（资产库）。
 * 不同题材的世界观关注不同维度：都市关注时代/社会规则/地理，玄幻关注力量体系/修炼等级。
 * 每个模板提供一组「标准维度」，Agent 按模板生成结构化 JSON，前端按维度动态展示。
 */

export type DimensionType = "text" | "textarea" | "tags" | "list" | "select";

export interface WorldviewDimension {
  key: string;
  label: string;
  hint: string;
  type: DimensionType;
  required: boolean;
  placeholder?: string;
  options?: string[];  // for select type
}

export interface WorldviewTemplate {
  id: string;
  label: string;
  description: string;
  dimensions: WorldviewDimension[];
}

export const WORLDVIEW_TEMPLATES: WorldviewTemplate[] = [
  {
    id: "urban",
    label: "都市",
    description: "都市异能 / 重生都市 / 职场商战 / 校园青春",
    dimensions: [
      { key: "era", label: "时代背景", hint: "故事发生的具体年代与社会特征", type: "textarea", required: true, placeholder: "如：2010年，移动互联网爆发前夜，PC端为主，智能手机方兴未艾" },
      { key: "social_rules", label: "社会规则", hint: "世界运行的基本规则，现实逻辑或隐藏规则", type: "textarea", required: true, placeholder: "如：现实逻辑，无超自然力量；或：修行者隐于市井，不得干涉普通人" },
      { key: "geography", label: "地理设定", hint: "主要场景、城市、关键地点", type: "textarea", required: true, placeholder: "如：深城（原型深圳），大学城、高新科技园、华强电子街" },
      { key: "factions", label: "势力阵营", hint: "主要势力、阵营关系", type: "tags", required: false, placeholder: "如：普通人社会、修行界、天道盟" },
      { key: "power_system", label: "力量体系", hint: "如有超自然力量，描述等级划分", type: "textarea", required: false, placeholder: "如：内劲→宗师→大宗师→先天→金丹→元婴" },
      { key: "tech_level", label: "科技水平", hint: "当前科技发展阶段与关键特征", type: "text", required: false, placeholder: "如：3G网络刚普及，Wi-Fi覆盖有限" },
      { key: "economy", label: "经济环境", hint: "经济特征、创业机会、行业风口", type: "textarea", required: false, placeholder: "如：团购大战正酣，电商高速增长" },
      { key: "culture", label: "文化氛围", hint: "社会风气、流行文化、价值观", type: "text", required: false },
      { key: "hidden_rules", label: "隐藏规则", hint: "不为人知的世界真相或暗线", type: "textarea", required: false },
    ],
  },
  {
    id: "xuanhuan",
    label: "玄幻仙侠",
    description: "玄幻 / 仙侠 / 修真 / 武侠",
    dimensions: [
      { key: "era", label: "时代背景", hint: "古代/架空/现代修真等", type: "text", required: true },
      { key: "world_structure", label: "世界结构", hint: "天地结构、位面划分", type: "textarea", required: true, placeholder: "如：凡界→灵界→仙界→神界" },
      { key: "power_system", label: "修炼体系", hint: "境界划分、修炼方式", type: "textarea", required: true, placeholder: "如：练气→筑基→金丹→元婴→化神→大乘→渡劫" },
      { key: "factions", label: "宗门势力", hint: "主要宗门、家族、势力", type: "tags", required: true },
      { key: "resources", label: "修炼资源", hint: "灵石、丹药、法宝等", type: "textarea", required: false },
      { key: "rules", label: "世界规则", hint: "天道法则、因果报应等", type: "textarea", required: true },
      { key: "geography", label: "地理版图", hint: "大陆、秘境、禁地", type: "textarea", required: false },
      { key: "races", label: "种族设定", hint: "人族、妖族、魔族等", type: "tags", required: false },
      { key: "history", label: "上古历史", hint: "远古大战、神话传说", type: "textarea", required: false },
    ],
  },
  {
    id: "scifi",
    label: "科幻未来",
    description: "星际 / 机甲 / 赛博朋克 / AI / 末世科幻",
    dimensions: [
      { key: "era", label: "时代背景", hint: "近未来/远未来/星际时代", type: "text", required: true },
      { key: "tech_level", label: "科技水平", hint: "核心科技特征", type: "textarea", required: true, placeholder: "如：曲率引擎、意识上传、纳米机器人" },
      { key: "social_structure", label: "社会结构", hint: "政治体制、阶级划分", type: "textarea", required: true },
      { key: "factions", label: "势力阵营", hint: "国家、公司、联盟", type: "tags", required: true },
      { key: "space", label: "空间设定", hint: "星球、空间站、殖民地", type: "textarea", required: false },
      { key: "ai_status", label: "AI 地位", hint: "人工智能的角色与权利", type: "text", required: false },
      { key: "economy", label: "经济体系", hint: "信用点、资源交易", type: "text", required: false },
      { key: "conflict", label: "核心矛盾", hint: "人与AI、阶级对立、星际战争", type: "textarea", required: false },
    ],
  },
  {
    id: "history",
    label: "历史权谋",
    description: "宫廷 / 官场 / 架空历史 / 权谋",
    dimensions: [
      { key: "era", label: "朝代背景", hint: "具体朝代或架空设定", type: "text", required: true },
      { key: "political_system", label: "政治体制", hint: "皇权、官僚体系、科举", type: "textarea", required: true },
      { key: "social_structure", label: "社会阶层", hint: "士农工商、门阀士族", type: "textarea", required: true },
      { key: "factions", label: "势力阵营", hint: "党派、家族、藩王", type: "tags", required: true },
      { key: "geography", label: "疆域版图", hint: "都城、边关、封地", type: "textarea", required: false },
      { key: "military", label: "军事力量", hint: "军制、兵种、边防", type: "textarea", required: false },
      { key: "economy", label: "经济状况", hint: "赋税、商贸、货币", type: "text", required: false },
      { key: "culture", label: "文化风气", hint: "儒学、科举、文风", type: "text", required: false },
      { key: "foreign_relations", label: "外交关系", hint: "邻国、藩属、外敌", type: "textarea", required: false },
    ],
  },
  {
    id: "mystery",
    label: "悬疑推理",
    description: "刑侦 / 都市悬疑 / 无限流解密 / 恐怖",
    dimensions: [
      { key: "era", label: "时代背景", hint: "现代/民国/古代", type: "text", required: true },
      { key: "setting", label: "故事舞台", hint: "城市、封闭空间、异世界", type: "textarea", required: true },
      { key: "rules", label: "世界规则", hint: "现实逻辑或超自然规则", type: "textarea", required: true },
      { key: "power_balance", label: "力量平衡", hint: "正邪力量对比", type: "text", required: false },
      { key: "factions", label: "势力阵营", hint: "警方、黑道、神秘组织", type: "tags", required: false },
      { key: "case_type", label: "案件类型", hint: "连环杀人、密室、心理博弈", type: "text", required: false },
      { key: "information_rules", label: "信息规则", hint: "谁知道什么、信息差如何形成", type: "textarea", required: false },
      { key: "atmosphere", label: "氛围基调", hint: "压抑、诡异、紧张", type: "text", required: false },
    ],
  },
  {
    id: "game",
    label: "游戏异界",
    description: "无限流 / 网游 / 系统流 / 异世界",
    dimensions: [
      { key: "world_type", label: "世界类型", hint: "游戏世界/异世界/无限空间", type: "text", required: true },
      { key: "system_rules", label: "系统规则", hint: "等级、技能、任务机制", type: "textarea", required: true },
      { key: "power_system", label: "力量体系", hint: "职业、技能树、天赋", type: "textarea", required: true },
      { key: "geography", label: "地图设定", hint: "副本、主城、野外", type: "textarea", required: false },
      { key: "factions", label: "势力阵营", hint: "公会、阵营、NPC势力", type: "tags", required: false },
      { key: "economy", label: "经济系统", hint: "金币、装备交易、拍卖", type: "text", required: false },
      { key: "death_rules", label: "死亡规则", hint: "死亡惩罚、复活机制", type: "text", required: false },
      { key: "unique_mechanics", label: "独特机制", hint: "本书特有的系统设定", type: "textarea", required: false },
    ],
  },
  {
    id: "romance",
    label: "言情",
    description: "古言 / 现言 / 甜宠 / 霸总 / 宫斗",
    dimensions: [
      { key: "era", label: "时代背景", hint: "现代/古代/民国/架空", type: "text", required: true },
      { key: "social_rules", label: "社会规则", hint: "门第观念、婚姻制度", type: "textarea", required: true },
      { key: "factions", label: "家族势力", hint: "豪门、世家、皇室", type: "tags", required: false },
      { key: "geography", label: "故事场景", hint: "城市、庄园、宫廷", type: "text", required: false },
      { key: "relationship_rules", label: "感情规则", hint: "CP模式、误会机制、甜蜜节奏", type: "textarea", required: false },
      { key: "conflict_source", label: "冲突来源", hint: "门第之差、误会、第三者", type: "textarea", required: false },
      { key: "tone", label: "基调风格", hint: "甜宠、虐恋、轻松、暗黑", type: "select", required: false, options: ["甜宠", "虐恋", "轻松", "暗黑", "搞笑"] },
    ],
  },
  {
    id: "apocalypse",
    label: "末世生存",
    description: "末世 / 废土 / 丧尸 / 灾变",
    dimensions: [
      { key: "catastrophe", label: "灾变类型", hint: "丧尸、核战、异兽、病毒", type: "text", required: true },
      { key: "era", label: "时间节点", hint: "灾变初期/中期/后期", type: "text", required: true },
      { key: "world_rules", label: "世界规则", hint: "变异规则、异能觉醒", type: "textarea", required: true },
      { key: "power_system", label: "力量体系", hint: "异能等级、进化方向", type: "textarea", required: false },
      { key: "factions", label: "幸存者势力", hint: "基地、流民、军阀", type: "tags", required: false },
      { key: "resources", label: "稀缺资源", hint: "食物、水、弹药、药品", type: "tags", required: false },
      { key: "threats", label: "威胁等级", hint: "丧尸等级、变异兽", type: "textarea", required: false },
      { key: "safe_zones", label: "安全区域", hint: "基地、据点、避难所", type: "textarea", required: false },
    ],
  },
  {
    id: "sports",
    label: "军事竞技",
    description: "军事 / 体育 / 电竞 / 职场",
    dimensions: [
      { key: "era", label: "时代背景", hint: "现代/近未来", type: "text", required: true },
      { key: "field", label: "竞技领域", hint: "电竞、足球、军事、职场", type: "text", required: true },
      { key: "rules", label: "规则体系", hint: "比赛规则、评分标准", type: "textarea", required: true },
      { key: "factions", label: "队伍阵营", hint: "战队、俱乐部、军团", type: "tags", required: true },
      { key: "ranking", label: "等级体系", hint: "段位、排名、荣誉", type: "text", required: false },
      { key: "economy", label: "商业体系", hint: "赞助、转会、奖金", type: "text", required: false },
      { key: "culture", label: "圈子文化", hint: "粉丝文化、行业规则", type: "textarea", required: false },
    ],
  },
  {
    id: "generic",
    label: "通用",
    description: "题材未定或混合题材的兜底模板",
    dimensions: [
      { key: "era", label: "时代背景", hint: "故事发生的时间与时代特征", type: "text", required: true },
      { key: "world_rules", label: "世界规则", hint: "世界运行的基本规则", type: "textarea", required: true },
      { key: "geography", label: "地理设定", hint: "主要场景与地点", type: "textarea", required: false },
      { key: "factions", label: "势力阵营", hint: "主要势力与关系", type: "tags", required: false },
      { key: "power_system", label: "力量体系", hint: "如有特殊力量，描述等级", type: "textarea", required: false },
      { key: "social_structure", label: "社会结构", hint: "社会阶层与组织方式", type: "textarea", required: false },
      { key: "economy", label: "经济环境", hint: "经济特征与资源", type: "text", required: false },
      { key: "culture", label: "文化氛围", hint: "社会风气与价值观", type: "text", required: false },
    ],
  },
];

/** 按题材名查找世界观模板，未命中返回通用模板 */
export function findWorldviewTemplate(genre: string): WorldviewTemplate {
  const key = String(genre ?? "").trim();
  if (!key) return WORLDVIEW_TEMPLATES[WORLDVIEW_TEMPLATES.length - 1];
  return (
    WORLDVIEW_TEMPLATES.find((t) => t.label === key || t.id === key || t.label.includes(key) || key.includes(t.label)) ??
    WORLDVIEW_TEMPLATES[WORLDVIEW_TEMPLATES.length - 1]
  );
}

/** 生成世界观的结构化 JSON Schema（用于 Agent 提示词） */
export function buildWorldviewSchema(template: WorldviewTemplate): string {
  const dims = template.dimensions.map((d) => {
    const desc = d.required ? "（必填）" : "（可选）";
    return `    "${d.key}": "${d.label}${desc} - ${d.hint}"`;
  });
  return `{
  "template_id": "${template.id}",
  "dimensions": {
${dims.join(",\n")}
  }
}`;
}

