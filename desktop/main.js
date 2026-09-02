/**
 * Electron main process (thin shell).
 */
const { app, BrowserWindow } = require("electron");
const { spawn, execFile } = require("node:child_process");
const path = require("node:path");
const fs = require("node:fs");
const os = require("node:os");
const http = require("node:http");
const ROOT = path.resolve(__dirname, "..");
const BACKEND_ENTRY = path.join(ROOT, "backend", "dist", "server.js");
const FRONTEND_DIST = path.join(ROOT, "frontend", "dist");
function seedInitialData(dataDir) {
  try {
    fs.mkdirSync(dataDir, { recursive: true });
    const candidates=[path.join(ROOT,"resources","initial-data"), path.join(process.resourcesPath||"","resources","initial-data"), path.join(ROOT,"data")];
    let src=null; for(const p of candidates) if(fs.existsSync(p)) {src=p; break;}
    if(!src) return;
    const marker=path.join(dataDir,".initialized");
    if(fs.existsSync(marker)) return;
    const entries=fs.readdirSync(dataDir);
    const hasContent=entries.filter(function(n){return n!==".initialized";}).length>0;
    if(hasContent) { fs.writeFileSync(marker,"seed-skipped-has-content","utf8"); return; }
    for(const e of fs.readdirSync(src)){ const s=path.join(src,e); const d=path.join(dataDir,e); if(fs.existsSync(d)) continue; fs.cpSync(s,d,{recursive:true}); }
    fs.writeFileSync(marker,"seeded-from:"+src,"utf8");
    console.log("[desktop] 首次启动已初始化数据: "+src+" -> "+dataDir);
  } catch(err){ console.warn("[desktop] 初始化数据失败:",err); }
}

const QDRANT_BIN_CANDIDATES = [
  path.join(ROOT, "resources", "qdrant", "qdrant.exe"),
  path.join(process.resourcesPath || "", "qdrant", "qdrant.exe"),
];
function resolveDataDir() {
  if (process.env.AI_NOVEL_DATA_DIR) return path.resolve(process.env.AI_NOVEL_DATA_DIR);
  if (process.platform === "win32" && process.env.APPDATA) return path.join(process.env.APPDATA, "AI-Novel-Workstation", "data");
  return path.join(os.homedir(), ".config", "AI-Novel-Workstation", "data");
}
function assertAssets() {
  const missing = [];
  if (!fs.existsSync(BACKEND_ENTRY)) missing.push(BACKEND_ENTRY);
  if (!fs.existsSync(path.join(FRONTEND_DIST, "index.html"))) missing.push(path.join(FRONTEND_DIST, "index.html"));
  return missing;
}
let backendProc = null; let qdrantProc = null; let backendPort = null; let qdrantPort = null; let mainWindow = null; let quitting = false;
function log(msg) { console.log("[desktop] " + msg); }
function waitForHealth(url, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const tryOnce = () => {
      const req = http.get(url, (res) => { res.resume(); if (res.statusCode === 200) resolve(true); else retry(); });
      req.on("error", retry); req.setTimeout(2000, () => { req.destroy(); retry(); });
    };
    const retry = () => { if (Date.now() > deadline) return reject(new Error("health timeout " + url)); setTimeout(tryOnce, 300); };
    tryOnce();
  });
}
function findQdrantBin() { for (const p of QDRANT_BIN_CANDIDATES) if (fs.existsSync(p)) return p; return null; }
async function startQdrant(dataDir) {
  seedInitialData(dataDir);
  const bin = findQdrantBin();
  if (!bin) { log("未找到内置 Qdrant，可执行文件不存在，讨论向量能力将降级为关键词模式"); return null; }
  const qdrantData = path.join(dataDir, "qdrant_storage");
  fs.mkdirSync(qdrantData, { recursive: true });
  const port = 6333 + Math.floor(Math.random()*1000);
  log("启动内置 Qdrant: " + bin + " 端口 " + port);
  qdrantProc = spawn(bin, ["--storage-path", qdrantData, "--rest-port", String(port)], { stdio: ["ignore","pipe","pipe"], windowsHide: true });
  qdrantProc.stdout.setEncoding("utf8"); qdrantProc.stderr.setEncoding("utf8");
  qdrantProc.stdout.on("data", c=>process.stdout.write(c)); qdrantProc.stderr.on("data", c=>process.stderr.write(c));
  qdrantProc.on("exit", (code)=>{ if(!quitting) log("Qdrant 退出 code="+code); });
  await waitForHealth("http://127.0.0.1:"+port+"/", 15000);
  qdrantPort = port; log("Qdrant 就绪 http://127.0.0.1:"+port);
  return port;
}
async function startBackend(dataDir, qdrantUrl) {
  seedInitialData(dataDir);
  const missing = assertAssets();
  if (missing.length>0) throw new Error("缺少构建产物："+missing.join(" ; ")+" 请先执行 npm run build:all");
  fs.mkdirSync(dataDir, {recursive:true});
  const env = { ...process.env, NOVEL_DESKTOP:"1", PORT:"0", NOVEL_STATIC_DIR: FRONTEND_DIST, AI_NOVEL_DATA_DIR: dataDir, ...(qdrantUrl?{QDRANT_URL:qdrantUrl}:{}), ...(process.env.AI_NOVEL_EMBEDDING_DIR?{AI_NOVEL_EMBEDDING_DIR:process.env.AI_NOVEL_EMBEDDING_DIR}:{}), ...(process.env.QDRANT_URL&&!qdrantUrl?{QDRANT_URL:process.env.QDRANT_URL}:{}) };
  log("启动后端子进程: node "+BACKEND_ENTRY); log("数据目录: "+dataDir);
  backendProc = spawn(process.execPath, [BACKEND_ENTRY], { cwd: ROOT, env, stdio:["ignore","pipe","pipe"], windowsHide:true });
  backendProc.stdout.setEncoding("utf8"); backendProc.stderr.setEncoding("utf8");
  backendProc.stdout.on("data", (chunk)=>{ process.stdout.write(chunk); const m=/NOVEL_PORT=(\d+)/.exec(chunk); if(m&&backendPort===null) backendPort=Number(m[1]); });
  backendProc.stderr.on("data", c=>process.stderr.write(c));
  await new Promise((resolve,reject)=>{ backendProc.on("error",reject); backendProc.on("exit",(code)=>{ if(!quitting) reject(new Error("后端进程提前退出 code="+code)); }); const deadline=Date.now()+30000; const poll=()=>{ if(backendPort!==null) return resolve(); if(Date.now()>deadline) return reject(new Error("等待后端端口超时")); setTimeout(poll,100); }; poll(); });
  await waitForHealth("http://127.0.0.1:"+backendPort+"/api/health",15000); log("后端就绪 http://127.0.0.1:"+backendPort); return backendPort;
}
function createWindow(url){ mainWindow=new BrowserWindow({width:1440,height:900,minWidth:1024,minHeight:700,title:"AI 小说工作站",backgroundColor:"#f8fafc",webPreferences:{nodeIntegration:false,contextIsolation:true}}); mainWindow.loadURL(url); mainWindow.on("closed",()=>{mainWindow=null;}); }
function killProcessTree(proc){ if(!proc||proc.killed) return; if(process.platform==="win32"){ try{execFile("taskkill",["/pid",String(proc.pid),"/T","/F"],{windowsHide:true});}catch{}} else { try{proc.kill();}catch{}} }
function shutdown(){ if(quitting) return; quitting=true; killProcessTree(backendProc); killProcessTree(qdrantProc); backendProc=null; qdrantProc=null; }
app.whenReady().then(async()=>{ try{ const dataDir=resolveDataDir(); const qp=await startQdrant(dataDir); const qurl=qp?"http://127.0.0.1:"+qp:null; const port=await startBackend(dataDir,qurl); createWindow("http://127.0.0.1:"+port); }catch(err){ log("启动失败："+(err instanceof Error?err.message:String(err))); shutdown(); app.exit(1); } });
app.on("window-all-closed",()=>{ shutdown(); app.quit(); });
app.on("before-quit",()=>{ shutdown(); });
process.on("exit",()=>{ killProcessTree(backendProc); killProcessTree(qdrantProc); });
