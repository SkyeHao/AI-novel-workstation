<#
============================================================================
 start-frontend.ps1 — 非阻塞启动前端 Vite dev server（真正脱离进程树）

 用法：
     .\scripts\start-frontend.ps1

 行为：
   1. 通过端口监听查找到旧前端进程并强制结束（Get-NetTCPConnection）
   2. 用 WScript.Shell.Run 以「独立进程 + 隐藏窗口」启动 npm run dev
   3. 日志写到 %TEMP%\frontend_<时间戳>.log
============================================================================
#>

$ErrorActionPreference = "SilentlyContinue"

$root = Split-Path -Parent $PSScriptRoot
$front = Join-Path $root "frontend"

# ---------- 1. 结束占用 5173 端口的旧进程 ----------
$conns = @()
try {
    $conns = Get-NetTCPConnection -LocalPort 5173 -State Listen -ErrorAction Stop
} catch {
    # 端口无监听（可能已停止），无需处理
}
foreach ($c in $conns) {
    Stop-Process -Id $c.OwningProcess -Force
    Write-Output "已结束旧进程: PID $($c.OwningProcess)"
}

# ---------- 2. 独立进程后台启动（不阻塞、不等待） ----------
$ts = Get-Date -Format "yyyyMMdd-HHmmss"
$outLog = Join-Path $env:TEMP "frontend_$ts.log"

$cmd = "cmd /c `"cd /d `"$front`" && npm run dev > `"$outLog`" 2>&1`""

$ws = New-Object -ComObject WScript.Shell
$null = $ws.Run($cmd, 0, $false)

Write-Output "前端 Vite 已独立后台启动"
Write-Output "日志: $outLog"
