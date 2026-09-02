/** 人物状态维度模板（资产库）。
 * 人物动态状态的维度随题材变化：都市关注身份/资产/关系，玄幻关注境界/战力/伤势。
 * 每个模板提供一组「建议维度」，用于 ① 正文章末回写的提示词引导 ② 前端动态设定的人物状态列展示与排序。
 * 模板维度不是硬约束——Agent 仍可自由写入额外字段，前端会动态追加展示。
 * 通用必填字段（所有题材统一）：id（人物标识）、name（姓名）、status（当前状态一句话概览）。
 */
export interface CharacterDimension {
  key: string;
  label: string;
  hint: string;
  core?: boolean;
}

export interface CharacterStateTemplate {
  id: string;
  label: string;
  description: string;
  dimensions: CharacterDimension[];
}

export const CHARACTER_STATE_TEMPLATES: CharacterStateTemplate[] = [
  {
    id: "urban",
    label: "都市",
    description: "都市异能 / 重生都市 / 职场商战：身份变化、资源积累、人际博弈",
    dimensions: [
      { key: "identity", label: "身份", hint: "公开身份与隐藏身份（如隐世大佬/马甲）", core: true },
      { key: "career", label: "职业", hint: "当前职业、岗位、事业阶段", core: true },
      { key: "situation", label: "处境", hint: "当前面临局面：危机、机会、压力", core: true },
      { key: "assets", label: "资产", hint: "可动用的金钱、公司、股权、资源" },
      { key: "relations", label: "关系", hint: "与关键人物的当前关系与态度" },
      { key: "mood", label: "情绪", hint: "当前情绪与心态" },
      { key: "goal", label: "目标", hint: "当前阶段性目标" },
      { key: "secret", label: "秘密", hint: "掌握的秘密、把柄、软肋" },
    ],
  },
  {
    id: "xuanhuan",
    label: "玄幻仙侠",
    description: "玄幻 / 仙侠 / 修真：修炼进度、实力、资源",
    dimensions: [
      { key: "realm", label: "境界", hint: "修炼境界（练气/筑基/金丹…）", core: true },
      { key: "level", label: "等级", hint: "境界内细分等级", core: true },
      { key: "combat_power", label: "战力", hint: "综合实力定位与对手层级", core: true },
      { key: "cultivation", label: "修为", hint: "当前修为积累与突破进度" },
      { key: "injury", label: "伤势", hint: "伤势、暗伤、战斗状态" },
      { key: "artifact", label: "法宝", hint: "持有法宝与灵器" },
      { key: "technique", label: "功法", hint: "主修功法与绝学" },
      { key: "faction", label: "势力", hint: "所属势力、宗门、地位" },
      { key: "resources", label: "资源", hint: "灵石、丹药、材料等修炼资源" },
      { key: "enemy", label: "仇敌", hint: "结仇对象与仇恨程度" },
    ],
  },
  {
    id: "scifi",
    label: "科幻未来",
    description: "星际 / 机甲 / 末世科幻 / AI：能力、装备、阵营",
    dimensions: [
      { key: "ability", label: "能力", hint: "异能、强化、改造、机师能力", core: true },
      { key: "faction", label: "阵营", hint: "所属阵营、立场、忠诚度", core: true },
      { key: "body", label: "机体健康", hint: "身体或机械体状态、能量" },
      { key: "equipment", label: "科技装备", hint: "持有装备、机甲、义体" },
      { key: "clearance", label: "权限", hint: "权限等级、访问范围" },
      { key: "location", label: "位置", hint: "当前坐标、地点" },
      { key: "resources", label: "资源", hint: "能源、物资、信用点" },
      { key: "secret", label: "秘密", hint: "掌握的机密与真相" },
    ],
  },
  {
    id: "history",
    label: "历史权谋",
    description: "宫廷 / 官场 / 架空历史：地位、立场、博弈",
    dimensions: [
      { key: "identity", label: "身份", hint: "公开身份与隐藏身份", core: true },
      { key: "stance", label: "立场", hint: "政治立场、阵营、站队", core: true },
      { key: "situation", label: "处境", hint: "当前局面与风险", core: true },
      { key: "office", label: "职位爵位", hint: "官职、爵位、封地" },
      { key: "family", label: "家世", hint: "家族背景、门第" },
      { key: "relations", label: "关系", hint: "君臣、家族、姻亲关系" },
      { key: "reputation", label: "声望", hint: "名声、风评、威望" },
      { key: "leverage", label: "把柄", hint: "被拿捏的把柄与软肋" },
    ],
  },
  {
    id: "mystery",
    label: "悬疑推理",
    description: "刑侦 / 都市悬疑 / 无限流解密：信息、立场、嫌疑",
    dimensions: [
      { key: "clues", label: "掌握线索", hint: "已掌握的线索与证据", core: true },
      { key: "stance", label: "立场", hint: "敌我、中立、黑白", core: true },
      { key: "suspicion", label: "嫌疑", hint: "涉案嫌疑程度", core: true },
      { key: "secret", label: "秘密", hint: "隐藏的秘密与身份" },
      { key: "motive", label: "动机", hint: "行为动机与目的" },
      { key: "whereabouts", label: "去向", hint: "当前行踪与下落" },
      { key: "relations", label: "关系", hint: "与案发关键人物的关系" },
      { key: "alive", label: "存活", hint: "生死状态" },
    ],
  },
  {
    id: "game",
    label: "游戏异界",
    description: "无限流 / 游戏 / 奇幻 / 异世界：数值成长、装备、任务",
    dimensions: [
      { key: "level", label: "等级", hint: "人物等级与经验", core: true },
      { key: "job", label: "职业", hint: "职业、转职、专精", core: true },
      { key: "skills", label: "技能", hint: "习得技能与被动", core: true },
      { key: "equipment", label: "装备", hint: "穿戴装备与词条" },
      { key: "inventory", label: "背包", hint: "持有物品与道具" },
      { key: "hp_mp", label: "生命法力", hint: "生命值、法力值、状态值" },
      { key: "quest", label: "任务", hint: "当前主线/支线任务" },
      { key: "faction", label: "势力队伍", hint: "阵营、公会、队伍" },
    ],
  },
  {
    id: "romance",
    label: "言情",
    description: "古言 / 现言 / 甜宠 / 霸总：感情线、误会、关系",
    dimensions: [
      { key: "relations", label: "关系", hint: "与主 CP 的当前关系与好感度", core: true },
      { key: "misunderstanding", label: "误会隔阂", hint: "当前误会、隔阂、心结", core: true },
      { key: "mood", label: "情绪", hint: "情绪状态与心理活动", core: true },
      { key: "identity", label: "身份", hint: "身份与设定" },
      { key: "family", label: "家世", hint: "家世背景与门第" },
      { key: "engagement", label: "婚约", hint: "婚约、约定、承诺状态" },
      { key: "situation", label: "处境", hint: "当前局面" },
    ],
  },
  {
    id: "apocalypse",
    label: "末世生存",
    description: "末世 / 废土：生存、物资、异能",
    dimensions: [
      { key: "survival", label: "生存状态", hint: "健康、饥饿、疲劳、中毒", core: true },
      { key: "supplies", label: "物资", hint: "食物、水源、弹药、燃料", core: true },
      { key: "ability", label: "异能进化", hint: "异能等级与进化方向", core: true },
      { key: "injury", label: "伤病", hint: "伤病情与恢复" },
      { key: "team", label: "队伍", hint: "队伍、组织、分工" },
      { key: "base", label: "据点", hint: "据点位置与安全度" },
      { key: "threat", label: "威胁", hint: "当前面临的威胁与敌意" },
    ],
  },
  {
    id: "sports",
    label: "军事竞技",
    description: "军事 / 体育 / 电竞：战绩、状态、团队",
    dimensions: [
      { key: "ability", label: "技能数值", hint: "实力数值、段位、评分", core: true },
      { key: "form", label: "状态", hint: "体力、士气、手感、专注度", core: true },
      { key: "record", label: "战绩", hint: "胜负、积分、排名", core: true },
      { key: "role", label: "身份职务", hint: "身份与团队职务" },
      { key: "team", label: "队伍", hint: "所属队伍与配合" },
      { key: "opponent", label: "对手", hint: "当前对手与宿敌" },
      { key: "injury", label: "伤病", hint: "伤病情与恢复" },
    ],
  },
  {
    id: "generic",
    label: "通用",
    description: "题材未定或兜底：身份、处境、能力等通用动态维度",
    dimensions: [
      { key: "identity", label: "身份", hint: "身份与处境", core: true },
      { key: "situation", label: "处境", hint: "当前面临局面", core: true },
      { key: "ability", label: "能力", hint: "当前能力与技艺", core: true },
      { key: "relations", label: "关系", hint: "与关键人物的关系" },
      { key: "mood", label: "情绪", hint: "当前情绪与心态" },
      { key: "goal", label: "目标", hint: "当前阶段性目标" },
      { key: "secret", label: "秘密", hint: "掌握的秘密与软肋" },
    ],
  },
];

/** 按题材名（label 或 id）查找模板，未命中返回通用模板。 */
export function findCharacterStateTemplate(genre: string): CharacterStateTemplate {
  const key = String(genre ?? "").trim();
  if (!key) return CHARACTER_STATE_TEMPLATES[CHARACTER_STATE_TEMPLATES.length - 1];
  return (
    CHARACTER_STATE_TEMPLATES.find((t) => t.label === key || t.id === key || t.label.includes(key) || key.includes(t.label)) ??
    CHARACTER_STATE_TEMPLATES[CHARACTER_STATE_TEMPLATES.length - 1]
  );
}

/** 解析最终人物维度：项目自定义覆盖优先，否则用题材模板建议维度。 */
export function resolveCharacterDimensions(
  genre: string,
  custom?: CharacterDimension[]
): CharacterDimension[] {
  if (custom && custom.length > 0) return custom;
  return findCharacterStateTemplate(genre).dimensions;
}

