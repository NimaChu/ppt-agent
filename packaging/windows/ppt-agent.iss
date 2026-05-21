#define MyAppName "ppt agent"
#define MyAppVersion "0.1.0"
#define MyAppPublisher "ppt agent"
#define MyAppExeName "ppt-agent-tray.ps1"

[Setup]
AppId={{8A2E78C5-68D6-4C91-A3C4-F0A02E315E86}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
AppPublisher={#MyAppPublisher}
DefaultDirName={autopf}\ppt-agent
DefaultGroupName=ppt agent
DisableProgramGroupPage=yes
OutputDir=..\..\dist\windows-installer
OutputBaseFilename=ppt-agent-setup
Compression=lzma2
SolidCompression=yes
WizardStyle=modern
PrivilegesRequired=admin
ArchitecturesAllowed=x64
ArchitecturesInstallIn64BitMode=x64

[Files]
Source: "..\..\dist\windows\ppt-agent\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{autoprograms}\ppt agent"; Filename: "{sys}\WindowsPowerShell\v1.0\powershell.exe"; Parameters: "-STA -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File ""{app}\ppt-agent-tray.ps1"""; WorkingDir: "{app}"
Name: "{autodesktop}\ppt agent"; Filename: "{sys}\WindowsPowerShell\v1.0\powershell.exe"; Parameters: "-STA -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File ""{app}\ppt-agent-tray.ps1"""; WorkingDir: "{app}"; Tasks: desktopicon
Name: "{autoprograms}\Stop ppt agent"; Filename: "{app}\stop-ppt-agent.cmd"; WorkingDir: "{app}"

[Tasks]
Name: "desktopicon"; Description: "Create a desktop shortcut"; GroupDescription: "Additional shortcuts:"; Flags: unchecked
Name: "firewall"; Description: "Allow LAN access on TCP port 3007"; GroupDescription: "Network access:"; Flags: checkedonce

[Run]
Filename: "{sys}\netsh.exe"; Parameters: "advfirewall firewall add rule name=""ppt agent 3007"" dir=in action=allow protocol=TCP localport=3007"; Flags: runhidden; Tasks: firewall
Filename: "{sys}\WindowsPowerShell\v1.0\powershell.exe"; Parameters: "-STA -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File ""{app}\ppt-agent-tray.ps1"""; Description: "Start ppt agent"; Flags: nowait postinstall skipifsilent

[UninstallRun]
Filename: "{sys}\netsh.exe"; Parameters: "advfirewall firewall delete rule name=""ppt agent 3007"""; Flags: runhidden
