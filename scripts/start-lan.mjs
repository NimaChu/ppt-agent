import { spawn } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import { readdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const isWindows = process.platform === "win32";
const npmCmd = isWindows ? "npm.cmd" : "npm";
const nodeCmd = isWindows ? "node.exe" : "node";

const args = new Set(process.argv.slice(2));
const devMode = args.has("--dev");
const noBuild = args.has("--no-build");
const port = readArg("--port") || process.env.PORT || "3007";
const host = readArg("--host") || process.env.HOSTNAME || "0.0.0.0";

function readArg(name) {
  const prefix = `${name}=`;
  const found = process.argv.slice(2).find((arg) => arg.startsWith(prefix));
  return found ? found.slice(prefix.length) : null;
}

function run(command, commandArgs, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, commandArgs, {
      cwd: rootDir,
      env: options.env || process.env,
      stdio: options.stdio || "inherit",
      shell: false,
    });

    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`${command} ${commandArgs.join(" ")} exited with ${code}`));
      }
    });
  });
}

async function newestMtime(dir, extensions) {
  let newest = 0;
  if (!existsSync(dir)) return newest;

  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (["node_modules", ".next", "dist", ".git", "data/jobs", "data/auth"].includes(entry.name)) {
        continue;
      }
      newest = Math.max(newest, await newestMtime(fullPath, extensions));
    } else if (extensions.some((ext) => entry.name.endsWith(ext))) {
      newest = Math.max(newest, statSync(fullPath).mtimeMs);
    }
  }
  return newest;
}

async function buildIsStale() {
  const buildIdPath = path.join(rootDir, ".next", "BUILD_ID");
  if (!existsSync(buildIdPath)) return true;

  const buildTime = statSync(buildIdPath).mtimeMs;
  const sourceTime = Math.max(
    statSync(path.join(rootDir, "package-lock.json")).mtimeMs,
    statSync(path.join(rootDir, "next.config.ts")).mtimeMs,
    await newestMtime(path.join(rootDir, "src"), [".ts", ".tsx", ".js", ".jsx", ".css", ".json"]),
    await newestMtime(path.join(rootDir, "app"), [".ts", ".tsx", ".js", ".jsx", ".css", ".json"]),
  );
  return sourceTime > buildTime;
}

function localIps() {
  return Object.values(os.networkInterfaces())
    .flat()
    .filter(Boolean)
    .filter((item) => item.family === "IPv4" && !item.internal)
    .map((item) => item.address);
}

function printUrls() {
  console.log("");
  console.log("ppt agent is starting.");
  console.log(`Local: http://localhost:${port}`);
  for (const ip of localIps()) {
    console.log(`LAN:   http://${ip}:${port}`);
  }
  console.log("");
  console.log("Default admin is created only when no users exist:");
  console.log(`  username: ${process.env.PPT_AGENT_ADMIN_USERNAME || "admin"}`);
  console.log(`  password: ${process.env.PPT_AGENT_ADMIN_PASSWORD || "ppt-agent-admin"}`);
  console.log("");
  console.log("Keep this window open while the service is running.");
  console.log("");
}

async function main() {
  if (!existsSync(path.join(rootDir, "node_modules", "next", "package.json"))) {
    console.log("Installing npm dependencies...");
    await run(npmCmd, ["install"]);
  }

  if (!devMode && !noBuild && (await buildIsStale())) {
    console.log("Building production app...");
    await run(npmCmd, ["run", "build"]);
  }

  console.log("Bootstrapping initial admin user if needed...");
  await run(nodeCmd, ["scripts/bootstrap-admin.mjs"]);

  printUrls();

  if (devMode) {
    await run(npmCmd, ["run", "dev", "--", "--hostname", host, "--port", port]);
    return;
  }

  const standaloneServer = path.join(rootDir, ".next", "standalone", "server.js");
  if (existsSync(standaloneServer)) {
    await run(nodeCmd, [standaloneServer], {
      env: {
        ...process.env,
        HOSTNAME: host,
        PORT: port,
      },
    });
  } else {
    await run(npmCmd, ["run", "start", "--", "--hostname", host, "--port", port]);
  }
}

main().catch((error) => {
  console.error("");
  console.error("Failed to start ppt agent:");
  console.error(error.message || error);
  process.exit(1);
});
