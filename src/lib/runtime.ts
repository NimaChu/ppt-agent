import fs from "node:fs";
import path from "node:path";

export function pythonCommand() {
  const configured = process.env.PPT_AGENT_PYTHON?.trim();
  if (configured) return configured;

  const bundled = process.platform === "win32"
    ? path.join(process.cwd(), "runtime", "python", "python.exe")
    : path.join(process.cwd(), "runtime", "python", "bin", "python3");
  if (fs.existsSync(bundled)) return bundled;

  return process.platform === "win32" ? "python" : "python3";
}
