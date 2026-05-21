# ppt agent

Local LAN web app for generating editable PowerPoint decks through a logged-in coding-agent CLI such as Claude Code, Cursor Agent, Codex CLI, or Gemini CLI.

## What Is Bundled

- Next.js web app
- Local user accounts and job history
- PPT template picker and template upload/import
- Project-bundled ppt-agent pipeline and validator
- Project-bundled PPTX template analyzer
- GitHub Actions workflow for building a Windows installer

The installed app bundles Node.js and Python on Windows. The target computer still needs at least one supported, logged-in agent CLI.

## Local Development

```bash
npm install
npm run dev -- --port 3007
```

Open:

```text
http://localhost:3007
```

Create or reset an admin user:

```bash
npm run user:add -- --username admin --password ppt-agent-admin --name Admin --role admin
```

## Windows Installer

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
