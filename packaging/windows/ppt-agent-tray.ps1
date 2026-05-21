param(
  [int]$Port = 3007
)

$ErrorActionPreference = "Stop"

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
$AppDir = Join-Path $Root "app"
$NodeExe = Join-Path $Root "runtime\node\node.exe"
$PythonExe = Join-Path $Root "runtime\python\python.exe"
$DataDir = Join-Path $env:ProgramData "ppt-agent\data"
$LogDir = Join-Path $DataDir "logs"
$Url = "http://localhost:$Port"

$script:ServerProcess = $null
$script:StartedByTray = $false

function Ensure-Directory($Path) {
  if (!(Test-Path $Path)) {
    New-Item -ItemType Directory -Force -Path $Path | Out-Null
  }
}

function Ensure-Runtime {
  if (!(Test-Path $NodeExe)) {
    throw "Missing bundled Node runtime: $NodeExe"
  }
  if (!(Test-Path $PythonExe)) {
    throw "Missing bundled Python runtime: $PythonExe"
  }
}

function Ensure-Data {
  Ensure-Directory $DataDir
  Ensure-Directory (Join-Path $DataDir "templates")
  Ensure-Directory (Join-Path $DataDir "jobs")
  Ensure-Directory (Join-Path $DataDir "auth")
  Ensure-Directory $LogDir

  $SeedTemplates = Join-Path $AppDir "seed-data\templates"
  $Templates = Join-Path $DataDir "templates"
  if (Test-Path $SeedTemplates) {
    robocopy $SeedTemplates $Templates /E /XC /XN /XO | Out-Null
  }
}

function Test-PortListening {
  try {
    $client = New-Object Net.Sockets.TcpClient
    $async = $client.BeginConnect("127.0.0.1", $Port, $null, $null)
    $connected = $async.AsyncWaitHandle.WaitOne(500, $false)
    if ($connected) {
      $client.EndConnect($async)
      $client.Close()
      return $true
    }
    $client.Close()
    return $false
  } catch {
    return $false
  }
}

function Open-Url {
  Start-Process $Url
}

function Open-DataFolder {
  Ensure-Directory $DataDir
  Start-Process explorer.exe $DataDir
}

function Start-PptAgent {
  Ensure-Runtime
  Ensure-Data

  if (Test-PortListening) {
    $script:StartedByTray = $false
    return
  }

  $NodeRuntimeDir = Join-Path $Root "runtime\node"
  $PythonRuntimeDir = Join-Path $Root "runtime\python"
  $env:PATH = "$NodeRuntimeDir;$PythonRuntimeDir;$env:PATH"
  $env:PPT_AGENT_DATA_DIR = $DataDir
  $env:PPT_AGENT_PYTHON = $PythonExe
  $env:NO_COLOR = "1"
  $env:HOSTNAME = "0.0.0.0"
  $env:PORT = "$Port"

  $Bootstrap = Join-Path $AppDir "scripts\bootstrap-admin.mjs"
  $BootstrapOut = Join-Path $LogDir "bootstrap.log"
  $BootstrapErr = Join-Path $LogDir "bootstrap.err.log"
  $bootstrapProcess = Start-Process -FilePath $NodeExe `
    -ArgumentList "`"$Bootstrap`"" `
    -WorkingDirectory $AppDir `
    -WindowStyle Hidden `
    -RedirectStandardOutput $BootstrapOut `
    -RedirectStandardError $BootstrapErr `
    -PassThru
  $bootstrapProcess.WaitForExit()

  $Server = Join-Path $AppDir "server.js"
  $ServerOut = Join-Path $LogDir "server.log"
  $ServerErr = Join-Path $LogDir "server.err.log"
  $script:ServerProcess = Start-Process -FilePath $NodeExe `
    -ArgumentList "`"$Server`"" `
    -WorkingDirectory $AppDir `
    -WindowStyle Hidden `
    -RedirectStandardOutput $ServerOut `
    -RedirectStandardError $ServerErr `
    -PassThru
  $script:StartedByTray = $true
}

function Stop-PptAgent {
  if ($script:ServerProcess -and !$script:ServerProcess.HasExited) {
    try {
      $script:ServerProcess.Kill()
      $script:ServerProcess.WaitForExit(3000) | Out-Null
    } catch {
      # Ignore shutdown races.
    }
  }
}

function Restart-PptAgent {
  Stop-PptAgent
  Start-Sleep -Milliseconds 500
  Start-PptAgent
}

function Show-StartupError($Message) {
  [System.Windows.Forms.MessageBox]::Show(
    $Message,
    "ppt agent",
    [System.Windows.Forms.MessageBoxButtons]::OK,
    [System.Windows.Forms.MessageBoxIcon]::Error
  ) | Out-Null
}

try {
  Start-PptAgent
} catch {
  Show-StartupError $_.Exception.Message
}

$icon = New-Object System.Windows.Forms.NotifyIcon
$icon.Text = "ppt agent"
$icon.Icon = [System.Drawing.SystemIcons]::Application
$icon.Visible = $true

$menu = New-Object System.Windows.Forms.ContextMenuStrip

$openItem = $menu.Items.Add("Open ppt agent")
$openItem.add_Click({ Open-Url })

$dataItem = $menu.Items.Add("Open data folder")
$dataItem.add_Click({ Open-DataFolder })

$restartItem = $menu.Items.Add("Restart service")
$restartItem.add_Click({
  try {
    Restart-PptAgent
    $icon.ShowBalloonTip(2000, "ppt agent", "Service restarted.", [System.Windows.Forms.ToolTipIcon]::Info)
  } catch {
    Show-StartupError $_.Exception.Message
  }
})

$menu.Items.Add("-") | Out-Null

$exitItem = $menu.Items.Add("Exit and stop service")
$exitItem.add_Click({
  Stop-PptAgent
  $icon.Visible = $false
  [System.Windows.Forms.Application]::Exit()
})

$icon.ContextMenuStrip = $menu
$icon.add_DoubleClick({ Open-Url })
$icon.ShowBalloonTip(2500, "ppt agent", "Service started: $Url", [System.Windows.Forms.ToolTipIcon]::Info)

[System.Windows.Forms.Application]::Run()
