import { randomBytes, randomUUID, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { cookies } from "next/headers";
import { ensureDir, pathExists, safeSegment } from "@/lib/fs-utils";
import { AUTH_DIR } from "@/lib/paths";
import type { AppUser, StoredUser, UserSession } from "@/lib/types";

export const SESSION_COOKIE = "ppt_agent_session";

const scrypt = promisify(scryptCallback);
const USERS_FILE = path.join(AUTH_DIR, "users.json");
const SESSIONS_FILE = path.join(AUTH_DIR, "sessions.json");
const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 14;

type UsersStore = { users: StoredUser[] };
type SessionsStore = { sessions: UserSession[] };

export function publicUser(user: StoredUser): AppUser {
  return {
    id: user.id,
    username: user.username,
    name: user.name,
    role: user.role ?? (user.username.toLowerCase() === "admin" ? "admin" : "user"),
    createdAt: user.createdAt,
  };
}

export async function hashPassword(password: string) {
  const salt = randomBytes(16).toString("hex");
  const derived = (await scrypt(password, salt, 64)) as Buffer;
  return `scrypt:${salt}:${derived.toString("hex")}`;
}

export async function verifyPassword(password: string, passwordHash: string) {
  const [scheme, salt, hash] = passwordHash.split(":");
  if (scheme !== "scrypt" || !salt || !hash) return false;
  const expected = Buffer.from(hash, "hex");
  const actual = (await scrypt(password, salt, expected.length)) as Buffer;
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

export async function readUsers(): Promise<UsersStore> {
  await ensureDir(AUTH_DIR);
  if (!(await pathExists(USERS_FILE))) return { users: [] };
  return JSON.parse(await fs.readFile(USERS_FILE, "utf8")) as UsersStore;
}

export async function writeUsers(store: UsersStore) {
  await ensureDir(AUTH_DIR);
  await fs.writeFile(USERS_FILE, `${JSON.stringify(store, null, 2)}\n`, "utf8");
}

async function readSessions(): Promise<SessionsStore> {
  await ensureDir(AUTH_DIR);
  if (!(await pathExists(SESSIONS_FILE))) return { sessions: [] };
  return JSON.parse(await fs.readFile(SESSIONS_FILE, "utf8")) as SessionsStore;
}

async function writeSessions(store: SessionsStore) {
  await ensureDir(AUTH_DIR);
  await fs.writeFile(SESSIONS_FILE, `${JSON.stringify(store, null, 2)}\n`, "utf8");
}

export async function authenticateUser(username: string, password: string) {
  const normalizedUsername = username.trim().toLowerCase();
  const store = await readUsers();
  const user = store.users.find((candidate) => candidate.username.toLowerCase() === normalizedUsername);
  if (!user) return null;
  return (await verifyPassword(password, user.passwordHash)) ? publicUser(user) : null;
}

export async function createSession(userId: string) {
  const now = Date.now();
  const session: UserSession = {
    id: randomUUID(),
    userId,
    createdAt: new Date(now).toISOString(),
    expiresAt: new Date(now + SESSION_TTL_MS).toISOString(),
  };
  const store = await readSessions();
  const active = store.sessions.filter((item) => new Date(item.expiresAt).getTime() > now);
  active.push(session);
  await writeSessions({ sessions: active });
  return session;
}

export async function deleteSession(sessionId: string) {
  const safeId = safeSegment(sessionId, "");
  if (!safeId) return;
  const store = await readSessions();
  await writeSessions({ sessions: store.sessions.filter((session) => session.id !== safeId) });
}

export async function getUserBySessionId(sessionId: string | undefined | null) {
  if (!sessionId) return null;
  const safeId = safeSegment(sessionId, "");
  if (!safeId) return null;
  const now = Date.now();
  const [usersStore, sessionsStore] = await Promise.all([readUsers(), readSessions()]);
  const session = sessionsStore.sessions.find((candidate) => candidate.id === safeId);
  if (!session || new Date(session.expiresAt).getTime() <= now) return null;
  const user = usersStore.users.find((candidate) => candidate.id === session.userId);
  return user ? publicUser(user) : null;
}

export async function getCurrentUser() {
  const cookieStore = await cookies();
  return getUserBySessionId(cookieStore.get(SESSION_COOKIE)?.value);
}

export async function requireCurrentUser() {
  const user = await getCurrentUser();
  if (!user) throw new Error("Unauthorized");
  return user;
}

export async function requireAdminUser() {
  const user = await requireCurrentUser();
  if (user.role !== "admin") throw new Error("Forbidden");
  return user;
}

export async function listPublicUsers() {
  const store = await readUsers();
  return store.users.map(publicUser).sort((a, b) => a.username.localeCompare(b.username));
}

export async function createOrUpdateUser(input: {
  username: string;
  password?: string;
  name?: string;
  role?: "admin" | "user";
}) {
  const username = input.username.trim();
  if (!username) throw new Error("Username is required");
  const store = await readUsers();
  const existing = store.users.find((user) => user.username.toLowerCase() === username.toLowerCase());
  if (existing) {
    existing.name = input.name?.trim() || existing.name || username;
    existing.role = input.role ?? existing.role ?? (existing.username.toLowerCase() === "admin" ? "admin" : "user");
    if (input.password) existing.passwordHash = await hashPassword(input.password);
    await writeUsers(store);
    return publicUser(existing);
  }
  if (!input.password) throw new Error("Password is required for new users");
  const user: StoredUser = {
    id: randomUUID(),
    username,
    name: input.name?.trim() || username,
    role: input.role ?? "user",
    passwordHash: await hashPassword(input.password),
    createdAt: new Date().toISOString(),
  };
  store.users.push(user);
  await writeUsers(store);
  return publicUser(user);
}

export async function changeOwnPassword(userId: string, currentPassword: string, nextPassword: string) {
  const store = await readUsers();
  const user = store.users.find((candidate) => candidate.id === userId);
  if (!user) throw new Error("User not found");
  if (!(await verifyPassword(currentPassword, user.passwordHash))) throw new Error("Invalid current password");
  user.passwordHash = await hashPassword(nextPassword);
  await writeUsers(store);
}
