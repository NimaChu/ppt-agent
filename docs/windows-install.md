# Windows Installation

The Windows installer bundles the ppt-agent web app, Node.js, Python, templates, and the ppt-agent pipeline.

The target computer still needs one logged-in agent CLI:

- Claude Code
- Cursor Agent
- Codex CLI
- Gemini CLI

After installation, open **ppt agent** from the Start Menu or desktop shortcut. The launcher starts the local service and opens:

```text
http://localhost:3007
```

LAN users can open:

```text
http://<host-computer-ip>:3007
```

The first launch creates an admin user if no users exist:

```text
username: admin
password: ppt-agent-admin
```

Data is stored under:

```text
%ProgramData%\ppt-agent\data
```

This includes users, sessions, jobs, and imported templates. Reinstalling the app does not remove that data.
