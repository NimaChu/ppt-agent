import { randomUUID, scrypt as scryptCallback, randomBytes } from "node:crypto";
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

function argValue(name) {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : "";
}

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

const username = argValue("username").trim();
const password = argValue("password");
const name = argValue("name").trim() || username;
const role = argValue("role").trim() || (username.toLowerCase() === "admin" ? "admin" : "user");

if (!username || !password) {
  console.error("Usage: npm run user:add -- --username alice --password secret --name Alice");
  process.exit(1);
}

await fs.mkdir(authDir, { recursive: true });
await withLock(async () => {
  const store = await readUsers();
  const existing = store.users.find((user) => user.username.toLowerCase() === username.toLowerCase());
  if (existing) {
    existing.name = name;
    existing.role = role === "admin" ? "admin" : "user";
    existing.passwordHash = await hashPassword(password);
    console.log(`Updated user ${username}`);
  } else {
    store.users.push({
      id: randomUUID(),
      username,
      name,
      role: role === "admin" ? "admin" : "user",
      passwordHash: await hashPassword(password),
      createdAt: new Date().toISOString(),
    });
    console.log(`Created user ${username}`);
  }
  await writeUsersAtomic(store);
});
