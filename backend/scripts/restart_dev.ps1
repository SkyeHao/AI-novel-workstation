 # Restart dev servers for AI-novel-workstation (backend + frontend), detached with logs.
 $ErrorActionPreference = "Continue"
 
 Start-Process -WindowStyle Hidden -FilePath "cmd.exe" -ArgumentList "/c", "npm run dev > D:\Code\AI-workplace\AI-novel-workstation\backend\dev-server.log 2>&1" -WorkingDirectory "D:\Code\AI-workplace\AI-novel-workstation\backend"
 
 Start-Process -WindowStyle Hidden -FilePath "cmd.exe" -ArgumentList "/c", "npm run dev -- --port 5174 --strictPort > D:\Code\AI-workplace\AI-novel-workstation\frontend\dev-server.log 2>&1" -WorkingDirectory "D:\Code\AI-workplace\AI-novel-workstation\frontend"
 
 Write-Output "launched backend and frontend"
