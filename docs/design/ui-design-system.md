# 浅色主题 UI 设计规范

> 面向「AI 小说创作工作台」的统一视觉语言（Design System v3 · Light）。
> 仅定义设计语言与设计令牌，不约束具体组件与布局；所有页面必须遵循本规范。

## 1. 设计理念

整体氛围为「明亮数字写作工坊」：白底衬托内容的清晰感，冷色点缀带来专注力，
界面干净利落，让用户放松地投入创作。信息密度中等偏低，呼吸感强。

## 2. 色彩系统

### 2.1 中性色（背景 / 表面 / 文字）

| 用途 | 色值 | 说明 |
| --- | --- | --- |
| 应用背景 | `#F5F5F7` | 极浅灰，页面整体底色 |
| 卡片 / 面板表面 | `#FFFFFF` | 柔和纯白，内容载体 |
| 表面悬停 | `#FAFAFA` | 轻微提升的表面色 |
| 边框 | `#E4E4E7`（zinc-200） | 卡片 / 分割线 |
| 边框悬停 | `#A1A1AA`（zinc-400） | 可交互卡片 hover 时加深 |
| 标题文字 | `#18181B`（zinc-900） | 一级：页面标题、卡片标题 |
| 副标题文字 | `#3F3F46`（zinc-700） | 二级：描述、正文 |
| 辅助文字 | `#71717A`（zinc-500） | 三级：说明、元信息 |
| 占位文字 | `#A1A1AA`（zinc-400） | 输入框 placeholder、弱化信息 |

### 2.2 强调色（冷色系）

| 用途 | 色值 | 说明 |
| --- | --- | --- |
| 主强调 Indigo-500 | `#6366F1` | 关键数据、主按钮、活跃状态、焦点 |
| 强调深 Indigo-600 | `#4F46E5` | 悬停 / 按下、渐变深端 |
| 强调浅 Indigo-50 | `#EEF2FF` | 选中底色、标签底、高亮区块 |
| 强调淡 Indigo-100 | `#E0E7FF` | 边框 / 细分隔 |
| 次强调 Cyan-500 | `#06B6D4` | 次级点缀、信息类标签 |
| 次强调浅 Cyan-50 | `#ECFEFF` | 次级标签底 |

强调色仅用于「关键数据、按钮、活跃状态」三类场景，避免大面积铺色。

### 2.3 语义色（状态）

| 含义 | 色值 |
| --- | --- |
| 成功 | `#10B981`（emerald-500） |
| 警告 | `#F59E0B`（amber-500） |
| 危险 | `#EF4444`（red-500） |
| 信息 | `#71717A`（zinc-500） |

流程节点状态色（灵感/世界观/人物/大纲/正文/审查/文风）保留各自语义色，
仅在节点徽标、进度点等小面积使用。

## 3. 材质与光影

- 所有容器（卡片、面板、对话框、折叠项）统一圆角 `rounded-xl`（12px）。
- 背景纯净无模糊、无渐变雾化；层级仅靠边框与克制的阴影区分。
- 默认阴影：`box-shadow: 0 1px 3px rgba(0, 0, 0, 0.06)`（shadow-sm）。
- 悬停阴影：`0 6px 18px rgba(0, 0, 0, 0.08)`。
- 面板头部可用极浅表面色（`#FAFAFA` → 白）做轻微过渡，不使用彩色渐变。

## 4. 排版与节奏

- 字体：无衬线体 `Inter` / `Geist`，回退到系统字体栈（含中文字体）。
- 字重分级明显：标题 600–700，正文 400–500，辅助 400。
- 字号节奏：页面标题 20px / 面板标题 15px / 正文 13–14px / 辅助 12px / 注释 11px。
- 间距采用 8 的倍数（8 / 16 / 24 / 32），页面留白充裕。
- 行高：正文 1.6–1.7，标题 1.3。

## 5. 图标与装饰

- 使用线性（outline）风格图标，线条粗细均匀。
- 图标默认颜色 `#71717A`（zinc-500），交互态与强调场景用 Indigo-500。
- 装饰克制：最多使用小圆点、轻描边标签、极浅色图标底块，不使用大面积渐变或插画。

## 6. 微交互反馈

- 可点击卡片：hover 时 `translateY(-2px)` 轻微上浮，边框加深至 `#A1A1AA`，
  阴影加深至 `0 6px 18px rgba(0,0,0,0.08)`；过渡 0.2s。
- 按钮：主按钮使用 Indigo-500 实心；次要操作使用浅色 subtle 样式
  （浅 Indigo-50 底 + Indigo-600 文字），hover 再加深一档。
- 列表行 / 菜单项：hover 浅色表面 `#FAFAFA`，活跃态浅 Indigo 底。
- 所有过渡统一 `0.2s ease`。

## 7. 实现令牌（CSS Variables）

落地于 `frontend/src/styles/global.css`：

```css
:root {
  --bg: #ffffff;
  --bg-soft: #f5f5f7;
  --surface: #ffffff;
  --surface-hover: #fafafa;
  --border: #e4e4e7;
  --border-soft: #f0f0f2;
  --border-hover: #a1a1aa;

  --accent: #6366f1;
  --accent-hover: #4f46e5;
  --accent-soft: #eef2ff;
  --accent-border: #e0e7ff;
  --cyan: #06b6d4;
  --cyan-soft: #ecfeff;

  --text-title: #18181b;
  --text-sub: #3f3f46;
  --text-aux: #71717a;
  --text-muted: #a1a1aa;

  --success: #10b981;
  --warning: #f59e0b;
  --danger: #ef4444;

  --radius-xl: 12px;
  --radius-lg: 10px;
  --radius-md: 8px;
  --shadow-sm: 0 1px 3px rgba(0, 0, 0, 0.06);
  --shadow-md: 0 4px 12px rgba(0, 0, 0, 0.06);
  --shadow-hover: 0 6px 18px rgba(0, 0, 0, 0.08);
  --font-sans: 'Inter', 'Geist', -apple-system, 'Segoe UI', Roboto, 'PingFang SC', 'Microsoft YaHei', sans-serif;
}
```

## 8. 使用约定

- 页面底色使用 `--bg-soft`，内容载体使用 `--surface` + `--border` + `--shadow-sm`。
- 强调色统一引用 `--accent` 系列，禁止再出现旧的 `#409eff / #4f8cff / #6f5cff` 等蓝色系字面量。
- 文字三级分别映射 `--text-title / --text-sub / --text-aux`。
- 可点击容器统一加 hover 上浮微交互（可复用 `.lift-card` 工具类）。