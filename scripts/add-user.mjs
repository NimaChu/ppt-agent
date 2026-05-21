import { randomUUID, scrypt as scryptCallback, randomBytes } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";

const scrypt = promisify(scryptCallback);
const root = process.cwd();
const authDir = path.join(root, "data", "auth");
const usersFile = path.join(authDir, "users.json");

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

const username = argValue("username").trim();
const password = argValue("password");
const name = argValue("name").trim() || username;
const role = argValue("role").trim() || (username.toLowerCase() === "admin" ? "admin" : "user");

if (!username || !password) {
  console.error("Usage: npm run user:add -- --username alice --password secret --name Alice");
  process.exit(1);
}

await fs.mkdir(authDir, { recursive: true });
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

await fs.writeFile(usersFile, `${JSON.stringify(store, null, 2)}\n`, "utf8");
