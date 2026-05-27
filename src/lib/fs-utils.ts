import { promises as fs } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";

export async function ensureDir(dir: string) {
  await fs.mkdir(dir, { recursive: true });
}

export function safeSegment(input: string, fallback = "file") {
  const base = path.basename(input || fallback);
  const cleaned = base
    .normalize("NFKD")
    .replace(/[^\w.\-一-龥]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[-.]+|[-.]+$/g, "");
  return cleaned || fallback;
}

export function isInside(parent: string, child: string) {
  const relative = path.relative(parent, child);
  return Boolean(relative) && !relative.startsWith("..") && !path.isAbsolute(relative);
}

export async function pathExists(file: string) {
  try {
    await fs.access(file);
    return true;
  } catch {
    return false;
  }
}

export async function writeTextAtomic(file: string, content: string) {
  await ensureDir(path.dirname(file));
  const temporary = `${file}.${process.pid}.${randomUUID()}.tmp`;
  try {
    await fs.writeFile(temporary, content, "utf8");
    await fs.rename(temporary, file);
  } finally {
    await fs.rm(temporary, { force: true }).catch(() => undefined);
  }
}

export async function withFileLock<T>(lockFile: string, action: () => Promise<T>, timeoutMs = 8000) {
  await ensureDir(path.dirname(lockFile));
  const startedAt = Date.now();
  let handle: Awaited<ReturnType<typeof fs.open>> | undefined;
  while (!handle) {
    try {
      handle = await fs.open(lockFile, "wx");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      const stale = await fs
        .stat(lockFile)
        .then((stat) => Date.now() - stat.mtimeMs > timeoutMs * 3)
        .catch(() => false);
      if (stale) {
        await fs.rm(lockFile, { force: true });
        continue;
      }
      if (Date.now() - startedAt >= timeoutMs) throw new Error(`Timed out waiting for file lock: ${path.basename(lockFile)}`);
      await new Promise((resolve) => setTimeout(resolve, 30));
    }
  }
  try {
    return await action();
  } finally {
    await handle.close().catch(() => undefined);
    await fs.rm(lockFile, { force: true }).catch(() => undefined);
  }
}
