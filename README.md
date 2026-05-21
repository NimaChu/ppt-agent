# ppt agent

Local LAN web app for generating editable PowerPoint decks through a logged-in coding-agent CLI such as Claude Code, Cursor Agent, Codex CLI, or Gemini CLI.

## What Is Bundled

- Next.js web app
- Local user accounts and job history
- PPT template picker and template upload/import
- Project-bundled ppt-agent pipeline and validator
- Project-bundled PPTX template analyzer
- GitHub Actions workflow for optional Windows installer builds

## One-Command LAN Start

Prerequisites:

- Node.js 22 LTS or newer
- At least one supported agent CLI installed and logged in: Claude Code, Cursor, Codex CLI, or Gemini CLI
- Python 3 is recommended for PPTX validation and template import helpers

Clone and start:

```bash
git clone https://github.com/NimaChu/ppt-agent.git
cd ppt-agent
npm run start:lan
```

Or double-click/run one of the root scripts:

- macOS: `start-lan.command`
- Linux/macOS terminal: `./start-lan.sh`
- Windows: `start-lan.bat`

The launcher will install npm dependencies when needed, build the production app when the build is missing or stale, create the initial admin user if no users exist, and bind the service to all network interfaces.

Default first-run admin:

```text
username: admin
password: ppt-agent-admin
```

You can override it before the first run:

```bash
PPT_AGENT_ADMIN_USERNAME=admin PPT_AGENT_ADMIN_PASSWORD=change-me npm run start:lan
```

After startup, open the printed LAN address from another computer on the same network, for example:

```text
http://192.168.1.20:3007
```

LAN access requires the host firewall/router to allow inbound TCP port `3007`.

## Local Development

```bash
npm install
npm run dev:lan
```

Open:

```text
http://localhost:3007
```

Create or reset an admin user:

```bash
npm run user:add -- --username admin --password ppt-agent-admin --name Admin --role admin
```

## Optional Windows Installer

The Windows installer is built by GitHub Actions on `windows-latest`.

To build manually on Windows:

```powershell
npm ci
npm run build
npm run package:win
```

Then compile:

```powershell
& "C:\Program Files (x86)\Inno Setup 6\ISCC.exe" packaging\windows\ppt-agent.iss
```

See [docs/windows-install.md](docs/windows-install.md).

## Runtime Data

Development data lives in:

```text
data/
```

Windows installer data lives in:

```text
%ProgramData%\ppt-agent\data
```
