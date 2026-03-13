import fs from "node:fs/promises";
import path from "node:path";
import { ensureDir, nowIso, readJsonIfExists } from "./utils";

interface LockPayload {
  pid: number;
  label: string;
  acquired_at: string;
}

export interface ExistingLockState {
  status: "missing" | "live";
  payload: LockPayload | null;
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
  let payload: LockPayload | null = null;
  try {
    payload = await readJsonIfExists<LockPayload>(lockPath);
  } catch {
    await fs.rm(lockPath, { force: true });
    return null;
  }

  if (!payload || isPidAlive(payload.pid)) {
    return payload;
  }

  await fs.rm(lockPath, { force: true });
  return null;
}

export async function inspectFileLock(lockPath: string): Promise<ExistingLockState> {
  const payload = await removeIfStale(lockPath);
  if (!payload) {
    return {
      status: "missing",
      payload: null,
    };
  }

  return {
    status: "live",
    payload,
  };
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

      const existing = await inspectFileLock(lockPath);
      if (existing.status !== "live" || !existing.payload) {
        continue;
      }

      return {
        acquired: false,
        reason: `lock held by pid ${existing.payload.pid} for ${existing.payload.label}`,
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
