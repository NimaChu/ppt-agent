@echo off
powershell -NoProfile -ExecutionPolicy Bypass -Command "$me=$PID; Get-CimInstance Win32_Process | Where-Object { $_.ProcessId -ne $me -and $_.CommandLine -like '*ppt-agent-tray.ps1*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }; Get-NetTCPConnection -LocalPort 3007 -State Listen -ErrorAction SilentlyContinue | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force }"
echo ppt agent stop command sent.
pause
