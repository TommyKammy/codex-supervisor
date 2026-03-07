import fs from "node:fs/promises";
import path from "node:path";
import { ensureDir, nowIso, readJsonIfExists } from "./utils";

interface LockPayload {
  pid: number;
  label: string;
  acquired_at: string;
}

export interface LockHandle {
  acquired: boolean;
  reason?: string;
  release: () => Promise<void>;
}

function isPidAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) {
    return false;
  }

  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function removeIfStale(lockPath: string): Promise<LockPayload | null> {
  const payload = await readJsonIfExists<LockPayload>(lockPath);
  if (!payload || isPidAlive(payload.pid)) {
    return payload;
  }

  await fs.rm(lockPath, { force: true });
  return null;
}

export async function acquireFileLock(lockPath: string, label: string): Promise<LockHandle> {
  await ensureDir(path.dirname(lockPath));

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const handle = await fs.open(lockPath, "wx");
      const payload: LockPayload = {
        pid: process.pid,
        label,
        acquired_at: nowIso(),
      };
      await handle.writeFile(`${JSON.stringify(payload, null, 2)}\n`, "utf8");
      await handle.close();

      return {
        acquired: true,
        release: async () => {
          const existing = await readJsonIfExists<LockPayload>(lockPath);
          if (existing?.pid === process.pid) {
            await fs.rm(lockPath, { force: true });
          }
        },
      };
    } catch (error) {
      const maybeErr = error as NodeJS.ErrnoException;
      if (maybeErr.code !== "EEXIST") {
        throw error;
      }

      const existing = await removeIfStale(lockPath);
      if (!existing) {
        continue;
      }

      return {
        acquired: false,
        reason: `lock held by pid ${existing.pid} for ${existing.label}`,
        release: async () => {},
      };
    }
  }

  return {
    acquired: false,
    reason: "failed to acquire lock after stale lock cleanup",
    release: async () => {},
  };
}
