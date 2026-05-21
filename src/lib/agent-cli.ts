import { spawn, spawnSync } from "node:child_process";
import type { ChildProcessByStdio } from "node:child_process";
import type { Readable } from "node:stream";
import type { AgentCliId, AgentCliStatus } from "@/lib/types";

type AgentDefinition = {
  id: AgentCliId;
  label: string;
  command: string;
  detectCommands: string[];
  args: (prompt: string) => string[];
};

const AGENTS: AgentDefinition[] = [
  {
    id: "claude",
    label: "Claude Code",
    command: "claude",
    detectCommands: ["claude"],
    args: (prompt) => [
      "-p",
      prompt,
      "--output-format",
      "stream-json",
      "--verbose",
      "--include-partial-messages",
      "--permission-mode",
      "bypassPermissions",
    ],
  },
  {
    id: "codex",
    label: "Codex CLI",
    command: "codex",
    detectCommands: ["codex"],
    args: (prompt) => ["exec", "--json", "--sandbox", "workspace-write", prompt],
  },
  {
    id: "gemini",
    label: "Gemini CLI",
    command: "gemini",
    detectCommands: ["gemini"],
    args: (prompt) => ["--prompt", prompt, "--output-format", "stream-json", "--approval-mode", "yolo"],
  },
  {
    id: "cursor",
    label: "Cursor Agent",
    command: "cursor-agent",
    detectCommands: ["cursor-agent", "cursor"],
    args: (prompt) => ["--print", prompt],
  },
];

export function detectAgentClis(): AgentCliStatus[] {
  const firstAvailable = AGENTS.find((agent) => resolveAgentPath(agent));
  return AGENTS.map((agent) => {
    const foundPath = resolveAgentPath(agent);
    return {
      id: agent.id,
      label: agent.label,
      command: foundPath?.command ?? agent.command,
      path: foundPath?.path ?? null,
      available: Boolean(foundPath),
      selected: firstAvailable?.id === agent.id,
    };
  });
}

export function selectAgentCli() {
  const statuses = detectAgentClis();
  const selected = statuses.find((agent) => agent.selected);
  if (!selected) return null;
  const definition = AGENTS.find((agent) => agent.id === selected.id);
  if (!definition) return null;
  return { ...selected, definition };
}

export function spawnAgentCli(prompt: string, cwd: string): ChildProcessByStdio<null, Readable, Readable> {
  const selected = selectAgentCli();
  if (!selected) {
    throw new Error("No supported coding-agent CLI found. Install or log in to Claude Code, Codex, Gemini, or Cursor Agent.");
  }
  return spawn(selected.path ?? selected.command, selected.definition.args(prompt), {
    cwd,
    env: { ...process.env, NO_COLOR: "1" },
    shell: process.platform === "win32",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function resolveAgentPath(agent: AgentDefinition) {
  for (const command of agent.detectCommands) {
    const result =
      process.platform === "win32"
        ? spawnSync("where.exe", [command], { encoding: "utf8" })
        : spawnSync("sh", ["-lc", `command -v ${shellQuote(command)}`], { encoding: "utf8" });
    const found = result.stdout
      .split(/\r?\n/g)
      .map((line) => line.trim())
      .find(Boolean);
    if (result.status === 0 && found) return { command, path: found };
  }
  return null;
}

function shellQuote(value: string) {
  return `'${value.replace(/'/g, "'\\''")}'`;
}
