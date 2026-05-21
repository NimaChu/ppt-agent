import { promises as fs } from "node:fs";
import path from "node:path";

const root = process.cwd();
const outRoot = path.join(root, "dist", "windows", "ppt-agent");
const appDir = path.join(outRoot, "app");

async function copyDir(from, to) {
  await fs.rm(to, { recursive: true, force: true });
  await fs.mkdir(path.dirname(to), { recursive: true });
  await fs.cp(from, to, { recursive: true });
}

async function copyFile(from, to) {
  await fs.mkdir(path.dirname(to), { recursive: true });
  await fs.copyFile(from, to);
}

async function exists(file) {
  try {
    await fs.access(file);
    return true;
  } catch {
    return false;
  }
}

if (!(await exists(path.join(root, ".next", "standalone", "server.js")))) {
  throw new Error("Missing .next/standalone/server.js. Run npm run build first.");
}

await fs.rm(outRoot, { recursive: true, force: true });
await copyDir(path.join(root, ".next", "standalone"), appDir);
await fs.rm(path.join(appDir, "data"), { recursive: true, force: true });
await copyDir(path.join(root, ".next", "static"), path.join(appDir, ".next", "static"));
await copyDir(path.join(root, "data", "templates"), path.join(appDir, "seed-data", "templates"));
await copyDir(path.join(root, "src", "server"), path.join(appDir, "src", "server"));
await copyFile(path.join(root, "scripts", "bootstrap-admin.mjs"), path.join(appDir, "scripts", "bootstrap-admin.mjs"));
await copyFile(path.join(root, "package.json"), path.join(appDir, "package.json"));
await copyFile(path.join(root, "packaging", "windows", "start-ppt-agent.cmd"), path.join(outRoot, "start-ppt-agent.cmd"));
await copyFile(path.join(root, "packaging", "windows", "stop-ppt-agent.cmd"), path.join(outRoot, "stop-ppt-agent.cmd"));
await copyFile(path.join(root, "packaging", "windows", "ppt-agent-tray.ps1"), path.join(outRoot, "ppt-agent-tray.ps1"));
await fs.mkdir(path.join(outRoot, "runtime", "node"), { recursive: true });
await fs.mkdir(path.join(outRoot, "runtime", "python"), { recursive: true });
console.log(`Windows package staging directory ready: ${outRoot}`);
