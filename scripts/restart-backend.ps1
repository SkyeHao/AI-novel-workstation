<#
============================================================================
 restart-backend.ps1 — 非阻塞重启 TS 后端（真正脱离进程树）

 用法：
     .\scripts\restart-backend.ps1            # 默认端口 8000
     .\scripts\restart-backend.ps1 -Port 8000

 行为：
   1. 通过端口监听查找到旧后端进程并强制结束（Get-NetTCPConnection）
   2. 用 WScript.Shell.Run 以「独立进程 + 隐藏窗口」启动新后端（node dist/server.js）
   3. 日志写到 %TEMP%\backend_<时间戳>.log
============================================================================
#>

param(
    [int]$Port = 8000
)

$ErrorActionPreference = "SilentlyContinue"

$root = Split-Path -Parent $PSScriptRoot
$node = "node"
$script = Join-Path $root "backend\dist\server.js"

if (-not (Test-Path -LiteralPath $script)) {
    Write-Error "未找到 TS 后端产物：$script（请先在 backend 目录执行 npm run build）"
    exit 1
}

# ---------- 1. 结束占用端口的旧进程 ----------
$conns = @()
try {
    $conns = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction Stop
} catch {
    # 端口无监听（可能已停止），无需处理
}
foreach ($c in $conns) {
    Stop-Process -Id $c.OwningProcess -Force
    Write-Output "已结束旧进程: PID $($c.OwningProcess)"
}

# ---------- 2. 独立进程后台启动（不阻塞、不等待） ----------
$ts = Get-Date -Format "yyyyMMdd-HHmmss"
$outLog = Join-Path $env:TEMP "backend_$ts.log"

# 默认只监听本机回环地址（127.0.0.1），避免局域网暴露（API 无鉴权）
$inner = "`"$node`" `"$script`" --host 127.0.0.1 --port $Port > `"$outLog`" 2>&1"
$cmd = "cmd /c `"$inner`""

# Shell.Run(command, windowStyle=0 隐藏窗口, waitOnReturn=$false 立即返回)
$ws = New-Object -ComObject WScript.Shell
$null = $ws.Run($cmd, 0, $false)

Write-Output "TS 后端已独立后台启动 (port=$Port)"
Write-Output "日志: $outLog"
