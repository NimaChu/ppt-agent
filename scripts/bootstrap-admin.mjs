import { randomBytes, randomUUID, scrypt as scryptCallback } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";

const scrypt = promisify(scryptCallback);
const dataDir = process.env.PPT_AGENT_DATA_DIR
  ? path.resolve(process.env.PPT_AGENT_DATA_DIR)
  : path.join(process.cwd(), "data");
const authDir = path.join(dataDir, "auth");
const usersFile = path.join(authDir, "users.json");
const usersLock = `${usersFile}.lock`;

async function hashPassword(password) {
  const salt = randomBytes(16).toString("hex");
  const derived = await scrypt(password, salt, 64);
  return `scrypt:${salt}:${derived.toString("hex")}`;
}

async function readUsers() {
  try {
    return JSON.parse(await fs.readFile(usersFile, "utf8"));
  } catch {
    return { users: [] };
  }
}

async function withLock(action) {
  const startedAt = Date.now();
  let handle;
  while (!handle) {
    try {
      handle = await fs.open(usersLock, "wx");
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
      if (Date.now() - startedAt > 8000) throw new Error("Timed out waiting for users store lock");
      await new Promise((resolve) => setTimeout(resolve, 30));
    }
  }
  try {
    return await action();
  } finally {
    await handle.close();
    await fs.rm(usersLock, { force: true });
  }
}

async function writeUsersAtomic(store) {
  const temporary = `${usersFile}.${process.pid}.${randomUUID()}.tmp`;
  await fs.writeFile(temporary, `${JSON.stringify(store, null, 2)}\n`, "utf8");
  await fs.rename(temporary, usersFile);
}

const username = process.env.PPT_AGENT_ADMIN_USERNAME || "admin";
const password = process.env.PPT_AGENT_ADMIN_PASSWORD || "ppt-agent-admin";
const displayName = process.env.PPT_AGENT_ADMIN_NAME || "Admin";

await fs.mkdir(authDir, { recursive: true });
await withLock(async () => {
  const store = await readUsers();
  if (!Array.isArray(store.users)) store.users = [];
  if (!store.users.length) {
    store.users.push({
      id: randomUUID(),
      username,
      name: displayName,
      role: "admin",
      passwordHash: await hashPassword(password),
      createdAt: new Date().toISOString(),
    });
    await writeUsersAtomic(store);
    console.log(`Created initial admin user: ${username}`);
  } else {
    console.log("User store already exists; skipped initial admin bootstrap.");
  }
});
