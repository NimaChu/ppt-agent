# ppt agent

Local LAN web app for generating editable PowerPoint decks through a logged-in coding-agent CLI such as Claude Code, Cursor Agent, Codex CLI, Gemini CLI, Trae Agent, or OpenCode.

## What Is Bundled

- Next.js web app
- Local user accounts and job history
- PPT template picker and template upload/import
- Optional brand assets bundled with imported templates, plus image uploads in chat
- Targeted slide revisions after generation
- Persistent local task queue with two concurrent generation slots, cancellation, and restart recovery
- Project-bundled ppt-agent pipeline and validator
- Project-bundled PPTX template analyzer

## One-Command LAN Start

Prerequisites:

- Node.js 22 LTS or newer
- At least one supported agent CLI installed and logged in: Claude Code, Cursor, Codex CLI, Gemini CLI, Trae Agent, or OpenCode
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

Generation jobs are queued locally and at most two run at once. Running jobs time out after 20 minutes by default; customize this before startup with `PPT_AGENT_JOB_TIMEOUT_MINUTES=30 npm run start:lan`. Each new job receives its own template snapshot, so later template management does not alter work already in progress.

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

## Runtime Data

When started from a cloned repository, mutable runtime data lives in:

```text
.ppt-agent-data/
```

The tracked `data/templates/` directory contains starter templates copied into runtime data on first launch. Windows installer builds keep mutable data in `%ProgramData%\ppt-agent\data`.
