@echo off
setlocal
powershell.exe -STA -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "%~dp0ppt-agent-tray.ps1"
