/**
 * 风格模板资产
 * 定义不同平台/题材的写作风格规范
 */

export interface StyleDimension {
  key: string;
  label: string;
  hint: string;
  type: "text" | "textarea" | "select" | "tags";
  required: boolean;
  options?: string[];
}

export interface StyleTemplate {
  id: string;
  label: string;
  description: string;
  dimensions: StyleDimension[];
}

export const STYLE_TEMPLATES: StyleTemplate[] = [
  {
    id: "fanqie_urban",
    label: "番茄都市",
    description: "番茄小说平台都市题材风格",
    dimensions: [
      {
        key: "narrative_perspective",
        label: "叙事视角",
        hint: "故事的叙述视角",
        type: "select",
        required: true,
        options: ["第一人称", "第三人称限制", "第三人称全知"],
      },
      {
        key: "language_style",
        label: "语言风格",
        hint: "整体语言风格特征",
        type: "textarea",
        required: true,
      },
      {
        key: "pacing",
        label: "节奏控制",
        hint: "故事节奏的快慢安排",
        type: "textarea",
        required: true,
      },
      {
        key: "dialogue_style",
        label: "对话风格",
        hint: "人物对话的特征",
        type: "textarea",
        required: false,
      },
      {
        key: "chapter_structure",
        label: "章节结构",
        hint: "单章的结构特征",
        type: "textarea",
        required: false,
      },
      {
        key: "hook_techniques",
        label: "钩子技巧",
        hint: "章末钩子的常用手法",
        type: "tags",
        required: false,
      },
      {
        key: "taboos",
        label: "禁忌事项",
        hint: "需要避免的内容或写法",
        type: "tags",
        required: false,
      },
    ],
  },
  {
    id: "fanqie_xuanhuan",
    label: "番茄玄幻",
    description: "番茄小说平台玄幻题材风格",
    dimensions: [
      {
        key: "narrative_perspective",
        label: "叙事视角",
        hint: "故事的叙述视角",
        type: "select",
        required: true,
        options: ["第一人称", "第三人称限制", "第三人称全知"],
      },
      {
        key: "language_style",
        label: "语言风格",
        hint: "整体语言风格特征",
        type: "textarea",
        required: true,
      },
      {
        key: "power_description",
        label: "力量描写",
        hint: "战斗和力量体系的描写风格",
        type: "textarea",
        required: true,
      },
      {
        key: "pacing",
        label: "节奏控制",
        hint: "故事节奏的快慢安排",
        type: "textarea",
        required: true,
      },
      {
        key: "level_up_style",
        label: "升级描写",
        hint: "境界提升的描写方式",
        type: "textarea",
        required: false,
      },
      {
        key: "hook_techniques",
        label: "钩子技巧",
        hint: "章末钩子的常用手法",
        type: "tags",
        required: false,
      },
    ],
  },
  {
    id: "qidian_urban",
    label: "起点都市",
    description: "起点中文网都市题材风格",
    dimensions: [
      {
        key: "narrative_perspective",
        label: "叙事视角",
        hint: "故事的叙述视角",
        type: "select",
        required: true,
        options: ["第一人称", "第三人称限制", "第三人称全知"],
      },
      {
        key: "language_style",
        label: "语言风格",
        hint: "整体语言风格特征",
        type: "textarea",
        required: true,
      },
      {
        key: "pacing",
        label: "节奏控制",
        hint: "故事节奏的快慢安排",
        type: "textarea",
        required: true,
      },
      {
        key: "character_depth",
        label: "人物深度",
        hint: "人物塑造的深度要求",
        type: "textarea",
        required: false,
      },
      {
        key: "world_building",
        label: "世界观构建",
        hint: "世界观展示的方式",
        type: "textarea",
        required: false,
      },
    ],
  },
  {
    id: "generic",
    label: "通用",
    description: "通用写作风格模板",
    dimensions: [
      {
        key: "narrative_perspective",
        label: "叙事视角",
        hint: "故事的叙述视角",
        type: "select",
        required: true,
        options: ["第一人称", "第三人称限制", "第三人称全知"],
      },
      {
        key: "language_style",
        label: "语言风格",
        hint: "整体语言风格特征",
        type: "textarea",
        required: true,
      },
      {
        key: "pacing",
        label: "节奏控制",
        hint: "故事节奏的快慢安排",
        type: "textarea",
        required: true,
      },
      {
        key: "tone",
        label: "基调",
        hint: "故事的整体基调",
        type: "select",
        required: false,
        options: ["轻松", "严肃", "幽默", "沉重", "温馨"],
      },
      {
        key: "taboos",
        label: "禁忌事项",
        hint: "需要避免的内容",
        type: "tags",
        required: false,
      },
    ],
  },
];

export function findStyleTemplate(templateId?: string): StyleTemplate {
  if (!templateId) return STYLE_TEMPLATES[STYLE_TEMPLATES.length - 1];
  return (
    STYLE_TEMPLATES.find((t) => t.id === templateId) ??
    STYLE_TEMPLATES[STYLE_TEMPLATES.length - 1]
  );
}

export function buildStyleSchema(template: StyleTemplate): string {
  const dims = template.dimensions
    .map((d) => {
      const desc = d.required ? "（必填）" : "（可选）";
      return `    "${d.key}": "${d.label}${desc} - ${d.hint}"`;
    })
    .join(",\n");

  return `{
  "template_id": "${template.id}",
  "dimensions": {
${dims}
  }
}`;
}

