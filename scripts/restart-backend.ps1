<#
============================================================================
 restart-backend.ps1 — 非阻塞重启后端（真正脱离进程树）

 用法：
     .\scripts\restart-backend.ps1            # 默认端口 8000
     .\scripts\restart-backend.ps1 -Port 8000

 行为：
   1. 通过端口监听查找到旧后端进程并强制结束（Get-NetTCPConnection，快速）
   2. 用 WScript.Shell.Run 以「独立进程 + 隐藏窗口」启动新后端，
      与当前调用进程树完全脱离 → 命令立即返回，不会被长驻进程拖住
   3. 日志写到 %TEMP%\backend_<时间戳>.log

 说明：
   - 之前用 Start-Process 启动的进程仍是本命令的子进程，调用方若等待
     整棵进程树结束就会卡住；这里改用 Shell.Run 让后端成为独立进程。
============================================================================
#>

param(
    [int]$Port = 8000
)

$ErrorActionPreference = "SilentlyContinue"

$root = Split-Path -Parent $PSScriptRoot
$py = Join-Path $root ".venv\Scripts\python.exe"

if (-not (Test-Path -LiteralPath $py)) {
    Write-Error "未找到 Python：$py"
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

# Shell.Run 不走 cmd，重定向符需通过 cmd /c 解释；/c 使 cmd 在执行完子进程后退出
# 默认只监听本机回环地址（127.0.0.1），避免局域网暴露（API 无鉴权）
$inner = "`"$py`" -m uvicorn ai_novel_workstation.api.app:app --host 127.0.0.1 --port $Port > `"$outLog`" 2>&1"
$cmd = "cmd /c `"$inner`""

# Shell.Run(command, windowStyle=0 隐藏窗口, waitOnReturn=$false 立即返回)
$ws = New-Object -ComObject WScript.Shell
$null = $ws.Run($cmd, 0, $false)

Write-Output "后端已独立后台启动 (port=$Port)"
Write-Output "日志: $outLog"
