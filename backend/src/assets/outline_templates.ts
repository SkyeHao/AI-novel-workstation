/**
 * 大纲结构模板（资产库）。
 * 不同结构类型的大纲有不同的组织方式：三幕式、英雄之旅、起承转合等。
 * 每个模板定义了大纲的结构层级和节点属性。
 */

export type OutlineNodeType = "story" | "volume" | "arc" | "chapter";

export interface OutlineNodeProperty {
  key: string;
  label: string;
  hint: string;
  type: "text" | "textarea" | "number" | "tags";
  required: boolean;
  placeholder?: string;
}

export interface OutlineTemplate {
  id: string;
  label: string;
  description: string;
  structure: OutlineNodeType[];  // 层级结构
  nodeProperties: Record<OutlineNodeType, OutlineNodeProperty[]>;
}

export const OUTLINE_TEMPLATES: OutlineTemplate[] = [
  {
    id: "three_act",
    label: "三幕式结构",
    description: "经典三幕式：铺垫 → 冲突 → 结局",
    structure: ["story", "volume", "arc", "chapter"],
    nodeProperties: {
      story: [
        { key: "title", label: "书名", hint: "故事标题", type: "text", required: true },
        { key: "summary_short", label: "一句话概括", hint: "300字以内的故事梗概", type: "textarea", required: true },
        { key: "summary_long", label: "详细梗概", hint: "1000-5000字的完整梗概", type: "textarea", required: true },
        { key: "theme", label: "主题", hint: "故事核心主题", type: "text", required: false },
      ],
      volume: [
        { key: "name", label: "卷名", hint: "本卷名称", type: "text", required: true },
        { key: "task", label: "核心任务", hint: "本卷要完成的核心任务", type: "textarea", required: true },
        { key: "target_words", label: "目标字数", hint: "本卷目标字数", type: "number", required: false },
        { key: "conflict", label: "核心冲突", hint: "本卷的主要冲突", type: "textarea", required: false },
      ],
      arc: [
        { key: "name", label: "篇章名", hint: "篇章名称", type: "text", required: true },
        { key: "goal", label: "篇章目标", hint: "本篇章要达成的目标", type: "textarea", required: true },
        { key: "tension", label: "张力曲线", hint: "本篇章的张力变化", type: "textarea", required: false },
      ],
      chapter: [
        { key: "title", label: "章节标题", hint: "章节标题", type: "text", required: true },
        { key: "event", label: "核心事件", hint: "本章核心事件", type: "textarea", required: true },
        { key: "function", label: "剧情功能", hint: "本章在剧情中的作用", type: "text", required: false, placeholder: "铺垫/冲突/爽点/过渡/钩子" },
        { key: "cast", label: "出场人物", hint: "本章出场人物", type: "tags", required: false },
        { key: "foreshadow_plant", label: "埋下伏笔", hint: "本章埋下的伏笔", type: "tags", required: false },
        { key: "foreshadow_reap", label: "回收伏笔", hint: "本章回收的伏笔", type: "tags", required: false },
        { key: "target_words", label: "目标字数", hint: "本章目标字数", type: "number", required: false },
      ],
    },
  },
  {
    id: "hero_journey",
    label: "英雄之旅",
    description: "约瑟夫·坎贝尔的英雄之旅模型：启程 → 启蒙 → 归来",
    structure: ["story", "volume", "arc", "chapter"],
    nodeProperties: {
      story: [
        { key: "title", label: "书名", hint: "故事标题", type: "text", required: true },
        { key: "hero", label: "主角", hint: "英雄角色简介", type: "textarea", required: true },
        { key: "ordinary_world", label: "平凡世界", hint: "英雄的日常生活", type: "textarea", required: true },
        { key: "transformation", label: "转变", hint: "英雄的成长与转变", type: "textarea", required: true },
      ],
      volume: [
        { key: "name", label: "阶段名", hint: "英雄之旅阶段名称", type: "text", required: true },
        { key: "stage", label: "旅程阶段", hint: "启程/启蒙/归来", type: "text", required: true },
        { key: "challenge", label: "核心挑战", hint: "本阶段英雄面临的挑战", type: "textarea", required: true },
        { key: "growth", label: "成长点", hint: "英雄在本阶段的成长", type: "textarea", required: false },
      ],
      arc: [
        { key: "name", label: "篇章名", hint: "篇章名称", type: "text", required: true },
        { key: "threshold", label: "门槛", hint: "跨越的门槛", type: "textarea", required: true },
        { key: "mentor", label: "导师", hint: "本篇章的导师角色", type: "text", required: false },
        { key: "allies", label: "盟友", hint: "本篇章的盟友", type: "tags", required: false },
      ],
      chapter: [
        { key: "title", label: "章节标题", hint: "章节标题", type: "text", required: true },
        { key: "call", label: "召唤/考验", hint: "本章的召唤或考验", type: "textarea", required: true },
        { key: "reward", label: "奖赏", hint: "本章获得的奖赏", type: "textarea", required: false },
        { key: "lesson", label: "教训", hint: "本章学到的教训", type: "textarea", required: false },
        { key: "cast", label: "出场人物", hint: "本章出场人物", type: "tags", required: false },
        { key: "target_words", label: "目标字数", hint: "本章目标字数", type: "number", required: false },
      ],
    },
  },
  {
    id: "qichengzhuanhe",
    label: "起承转合",
    description: "中国传统叙事结构：起 → 承 → 转 → 合",
    structure: ["story", "volume", "arc", "chapter"],
    nodeProperties: {
      story: [
        { key: "title", label: "书名", hint: "故事标题", type: "text", required: true },
        { key: "summary_short", label: "一句话概括", hint: "故事核心梗概", type: "textarea", required: true },
        { key: "qi", label: "起", hint: "故事开端，引入人物和背景", type: "textarea", required: true },
        { key: "he", label: "合", hint: "故事结局，收束所有线索", type: "textarea", required: true },
      ],
      volume: [
        { key: "name", label: "卷名", hint: "本卷名称", type: "text", required: true },
        { key: "phase", label: "阶段", hint: "起/承/转/合", type: "text", required: true },
        { key: "task", label: "核心任务", hint: "本卷要完成的任务", type: "textarea", required: true },
        { key: "climax", label: "高潮点", hint: "本卷的高潮或转折点", type: "textarea", required: false },
      ],
      arc: [
        { key: "name", label: "篇章名", hint: "篇章名称", type: "text", required: true },
        { key: "setup", label: "铺垫", hint: "本篇章的铺垫内容", type: "textarea", required: true },
        { key: "payoff", label: "回报", hint: "本篇章的回报或揭示", type: "textarea", required: true },
      ],
      chapter: [
        { key: "title", label: "章节标题", hint: "章节标题", type: "text", required: true },
        { key: "event", label: "核心事件", hint: "本章核心事件", type: "textarea", required: true },
        { key: "hook", label: "钩子", hint: "本章的钩子或悬念", type: "textarea", required: false },
        { key: "cast", label: "出场人物", hint: "本章出场人物", type: "tags", required: false },
        { key: "foreshadow_plant", label: "埋下伏笔", hint: "本章埋下的伏笔", type: "tags", required: false },
        { key: "foreshadow_reap", label: "回收伏笔", hint: "本章回收的伏笔", type: "tags", required: false },
        { key: "target_words", label: "目标字数", hint: "本章目标字数", type: "number", required: false },
      ],
    },
  },
  {
    id: "multithread",
    label: "多线叙事",
    description: "多条故事线并行或交织的叙事结构",
    structure: ["story", "volume", "arc", "chapter"],
    nodeProperties: {
      story: [
        { key: "title", label: "书名", hint: "故事标题", type: "text", required: true },
        { key: "threads", label: "故事线", hint: "主要故事线列表", type: "tags", required: true },
        { key: "convergence", label: "交汇点", hint: "各故事线的交汇点", type: "textarea", required: true },
      ],
      volume: [
        { key: "name", label: "卷名", hint: "本卷名称", type: "text", required: true },
        { key: "focus_threads", label: "聚焦故事线", hint: "本卷聚焦的故事线", type: "tags", required: true },
        { key: "progression", label: "推进", hint: "本卷各故事线的推进", type: "textarea", required: true },
      ],
      arc: [
        { key: "name", label: "篇章名", hint: "篇章名称", type: "text", required: true },
        { key: "thread", label: "所属故事线", hint: "本篇章属于哪条故事线", type: "text", required: true },
        { key: "connection", label: "与其他线的关联", hint: "与其他故事线的关联", type: "textarea", required: false },
      ],
      chapter: [
        { key: "title", label: "章节标题", hint: "章节标题", type: "text", required: true },
        { key: "thread", label: "所属故事线", hint: "本章属于哪条故事线", type: "text", required: true },
        { key: "event", label: "核心事件", hint: "本章核心事件", type: "textarea", required: true },
        { key: "cast", label: "出场人物", hint: "本章出场人物", type: "tags", required: false },
        { key: "target_words", label: "目标字数", hint: "本章目标字数", type: "number", required: false },
      ],
    },
  },
  {
    id: "generic",
    label: "通用",
    description: "灵活的大纲结构，适用于各种叙事方式",
    structure: ["story", "volume", "arc", "chapter"],
    nodeProperties: {
      story: [
        { key: "title", label: "书名", hint: "故事标题", type: "text", required: true },
        { key: "summary_short", label: "一句话概括", hint: "故事梗概", type: "textarea", required: true },
        { key: "summary_long", label: "详细梗概", hint: "完整梗概", type: "textarea", required: true },
      ],
      volume: [
        { key: "name", label: "卷名", hint: "本卷名称", type: "text", required: true },
        { key: "task", label: "核心任务", hint: "本卷核心任务", type: "textarea", required: true },
        { key: "target_words", label: "目标字数", hint: "本卷目标字数", type: "number", required: false },
      ],
      arc: [
        { key: "name", label: "篇章名", hint: "篇章名称", type: "text", required: true },
        { key: "goal", label: "篇章目标", hint: "本篇章目标", type: "textarea", required: true },
      ],
      chapter: [
        { key: "title", label: "章节标题", hint: "章节标题", type: "text", required: true },
        { key: "event", label: "核心事件", hint: "本章核心事件", type: "textarea", required: true },
        { key: "function", label: "剧情功能", hint: "本章在剧情中的作用", type: "text", required: false },
        { key: "cast", label: "出场人物", hint: "本章出场人物", type: "tags", required: false },
        { key: "target_words", label: "目标字数", hint: "本章目标字数", type: "number", required: false },
      ],
    },
  },
];

/** 按名称查找大纲模板，未命中返回通用模板 */
export function findOutlineTemplate(templateId?: string): OutlineTemplate {
  if (!templateId) return OUTLINE_TEMPLATES[OUTLINE_TEMPLATES.length - 1];
  return (
    OUTLINE_TEMPLATES.find((t) => t.id === templateId || t.label === templateId) ??
    OUTLINE_TEMPLATES[OUTLINE_TEMPLATES.length - 1]
  );
}

/** 生成大纲的结构化 JSON Schema（用于 Agent 提示词） */
export function buildOutlineSchema(template: OutlineTemplate): string {
  const storyProps = template.nodeProperties.story.map(p => `    "${p.key}": "${p.label}"`).join(",\n");
  const volumeProps = template.nodeProperties.volume.map(p => `      "${p.key}": "${p.label}"`).join(",\n");
  const arcProps = template.nodeProperties.arc.map(p => `        "${p.key}": "${p.label}"`).join(",\n");
  const chapterProps = template.nodeProperties.chapter.map(p => `          "${p.key}": "${p.label}"`).join(",\n");

  return `{
  "template_id": "${template.id}",
  "root": {
    "type": "story",
${storyProps},
    "children": [
      {
        "type": "volume",
${volumeProps},
        "children": [
          {
            "type": "arc",
${arcProps},
            "children": [
              {
                "type": "chapter",
                "no": 1,
${chapterProps}
              }
            ]
          }
        ]
      }
    ]
  }
}`;
}

