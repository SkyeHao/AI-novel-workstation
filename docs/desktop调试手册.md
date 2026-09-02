# 桌面版调试手册

> 适用：Windows 桌面壳（Electron）+ 内嵌后端 + 内置前端。日常功能开发与桌面壳验证分流，互不阻塞。

## 三种启动方式

### 1. 浏览器开发模式（日常功能，热重载最快）

用于改 Agent、workflow、前端页面逻辑。

```bash
# 终端 A：后端
cd backend && npm run dev            # 监听 127.0.0.1:8000，tsx watch，改 TS 自动重启

# 终端 B：前端
cd frontend && npm run dev           # 监听 http://localhost:5174，Vite HMR
```

- 浏览器访问 `http://localhost:5174`，API 直连 8000。
- 不经过 Electron，不读桌面数据目录，改动秒级生效。
- 调后端断点：在 VS Code 用 `Attach to Node` 或 `node --inspect backend/src/server.ts`。

### 2. 桌面壳开发模式（验证 Electron + 真实打包路径）

用于验证窗口、随机端口、静态托管、Qdrant/模型注入、首次启动数据落地。

```bash
npm run build:all          # 必做：backend tsc → backend/dist，frontend vite → frontend/dist
npm run desktop:dev        # Electron 弹独立窗口，自动起后端子进程
```

- 窗口标题：`AI 小说工作站`，尺寸 1440×900，独立于系统浏览器。
- 后端以子进程运行：`NOVEL_DESKTOP=1 PORT=0 NOVEL_STATIC_DIR=frontend/dist AI_NOVEL_DATA_DIR=%APPDATA%\\AI-Novel-Workstation\\data`，从 stdout 解析 `NOVEL_PORT=xxxx`，等待 `/api/health` 就绪后加载 `http://127.0.0.1:xxxx`。
- 日志直接打到启动终端：
  - `[desktop] 未找到内置 Qdrant...` → 正常，讨论向量能力降级为关键词
  - `[desktop] 后端就绪 http://127.0.0.1:xxxx` → 成功
  - `[ts-backend] listening on ...` + `NOVEL_PORT=...`
- 关窗即 `taskkill /T /F` 回收后端与 Qdrant，不留残留。崩溃时看 `.scratch/desktop_smoke2.log`。

**热更前端**：改完前端只需 `npm --prefix frontend run build` 再重开 `desktop:dev`（壳加载的是已构建产物，不走 Vite dev server）。

**调后端断点**：在 `desktop/main.js` 的 `spawn(process.execPath, [BACKEND_ENTRY])` 中临时加 `--inspect=9230`，再用 VS Code Attach。

### 3. 打包验证（发版前一次）

```bash
# 先放资源（见下节）
npm run desktop:build          # nsis 安装包 + portable，产物在 dist/
npm run desktop:build:portable # 仅便携版
```

- `desktop/package.json` 的 `build.extraResources` 会把 `backend/dist`、`frontend/dist`、`resources/qdrant`、`resources/models`、`resources/initial-data` 一并打入。
- 安装到只读目录亦可运行，数据始终写 `%APPDATA%\\AI-Novel-Workstation\\data`。

## 数据目录

| 场景 | 路径 | 说明 |
|------|------|------|
| 浏览器模式 | `D:\\Code\\AI-workplace\\AI-novel-workstation\\data` 或 `AI_NOVEL_DATA_DIR` 覆盖 | 仓库内 data，gitignore |
| 桌面模式 | `%APPDATA%\\AI-Novel-Workstation\\data` | 升级不丢，用户可写 |
| 首次启动 | `resources/initial-data` → 自动拷贝到桌面数据目录 | 有 `.initialized` 标记，已有内容则跳过覆盖 |

## 离线资源

- `resources/qdrant/qdrant.exe`：从 https://github.com/qdrant/qdrant/releases 下载 Windows 版，运行时数据落 `data/qdrant_storage`
- `resources/models/`：`Xenova/paraphrase-multilingual-MiniLM-L12-v2` 权重，保持 HuggingFace 缓存结构
- `desktop/build/icon.ico`：256×256，electron-builder 读取
- 缺失时均优雅降级并给出可读日志，不白屏。

## 常见问题

- **Electron failed to install correctly**：`desktop/node_modules/electron/dist` 为空。联网后 `npm --prefix desktop install`，若内网受限设 `ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/`；本仓库已验证可从 `AppData/Local/electron/Cache` 解压。
- **端口冲突**：桌面模式用随机端口，无需固定 8000。
- **前端 404 刷新白屏**：已做 SPA 回退，`/api` 404 返回 JSON，其他路由回 `index.html`。
- **`scandir ENOENT data`**：已修复，首次启动会自动 `mkdir -p`。

## 推荐工作流

- 日常写功能：用方式 1，浏览器验证。
- 改了 Electron/静态托管/环境变量注入：切方式 2 跑一次冒烟（健康检查 200 即通过）。
- 发版前：方式 3 打包，在干净 Windows 虚拟机装一次，确认快捷方式、数据持久化、卸载重装不丢。

> 冒烟脚本：`node scripts/smoke_node.js`（20s 内检测 NOVEL_PORT、/api/health、/，自动清理进程，日志在 `.scratch/desktop_smoke2.log`）
