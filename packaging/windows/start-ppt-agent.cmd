@echo off
setlocal

set "ROOT=%~dp0"
set "APP_DIR=%ROOT%app"
set "NODE_EXE=%ROOT%runtime\node\node.exe"
set "PYTHON_EXE=%ROOT%runtime\python\python.exe"
set "DATA_DIR=%ProgramData%\ppt-agent\data"
set "PORT=3007"
set "HOSTNAME=0.0.0.0"

if not exist "%NODE_EXE%" (
  echo Missing bundled Node runtime: %NODE_EXE%
  pause
  exit /b 1
)

if not exist "%PYTHON_EXE%" (
  echo Missing bundled Python runtime: %PYTHON_EXE%
  pause
  exit /b 1
)

mkdir "%DATA_DIR%" >nul 2>nul
mkdir "%DATA_DIR%\templates" >nul 2>nul
mkdir "%DATA_DIR%\jobs" >nul 2>nul
mkdir "%DATA_DIR%\auth" >nul 2>nul

if not exist "%DATA_DIR%\templates\*" (
  robocopy "%APP_DIR%\seed-data\templates" "%DATA_DIR%\templates" /E >nul
) else (
  robocopy "%APP_DIR%\seed-data\templates" "%DATA_DIR%\templates" /E /XC /XN /XO >nul
)

set "PATH=%ROOT%runtime\node;%ROOT%runtime\python;%PATH%"
set "PPT_AGENT_DATA_DIR=%DATA_DIR%"
set "PPT_AGENT_PYTHON=%PYTHON_EXE%"
set "NO_COLOR=1"

pushd "%APP_DIR%"
"%NODE_EXE%" "%APP_DIR%\scripts\bootstrap-admin.mjs"
start "" "http://localhost:%PORT%"
echo ppt agent is starting on http://localhost:%PORT%
echo LAN users can open http://THIS-COMPUTER-IP:%PORT%
"%NODE_EXE%" "%APP_DIR%\server.js"
popd

pause
