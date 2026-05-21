@echo off
setlocal
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is required. Install Node.js 22 LTS or newer, then run this script again.
  pause
  exit /b 1
)

node scripts\start-lan.mjs %*
pause
