import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { ensureDir, nowIso, readJsonIfExists } from "./utils";

interface LockPayload {
  pid: number;
  label: string;
  acquired_at: string;
  host?: string;
  owner?: string;
}

export interface ExistingLockState {
  status: "missing" | "live" | "stale" | "ambiguous_owner";
  payload: LockPayload | null;
}

export interface LockHandle {
  acquired: boolean;
  reason?: string;
  release: () => Promise<void>;
}

export interface AcquireFileLockOptions {
  allowAmbiguousOwnerCleanup?: boolean;
}

function currentLockOwner(): string {
  try {
    const { username } = os.userInfo();
    if (username) {
      return username;
    }
  } catch {
    // Fall through to environment-based owner detection.
  }

  return process.env.USER ?? process.env.USERNAME ?? "unknown";
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

function isClearlyStaleLocalLock(payload: LockPayload): boolean {
  return payload.host === os.hostname() && payload.owner === currentLockOwner();
}

async function inspectLockPayload(lockPath: string): Promise<ExistingLockState> {
  let payload: LockPayload | null = null;
  try {
    payload = await readJsonIfExists<LockPayload>(lockPath);
  } catch {
    await fs.rm(lockPath, { force: true });
    return {
      status: "missing",
      payload: null,
    };
  }

  if (!payload) {
    return {
      status: "missing",
      payload: null,
    };
  }

  if (isPidAlive(payload.pid)) {
    return {
      status: "live",
      payload,
    };
  }

  if (isClearlyStaleLocalLock(payload)) {
    await fs.rm(lockPath, { force: true });
    return {
      status: "stale",
      payload,
    };
  }

  return {
    status: "ambiguous_owner",
    payload,
  };
}

export async function inspectFileLock(lockPath: string): Promise<ExistingLockState> {
  return inspectLockPayload(lockPath);
}

export async function acquireFileLock(
  lockPath: string,
  label: string,
  options: AcquireFileLockOptions = {},
): Promise<LockHandle> {
  await ensureDir(path.dirname(lockPath));

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const handle = await fs.open(lockPath, "wx");
      const payload: LockPayload = {
        pid: process.pid,
        label,
        acquired_at: nowIso(),
        host: os.hostname(),
        owner: currentLockOwner(),
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
      if (existing.status === "missing" || existing.status === "stale") {
        continue;
      }

      if (existing.status === "ambiguous_owner" && existing.payload) {
        if (options.allowAmbiguousOwnerCleanup) {
          await fs.rm(lockPath, { force: true });
          continue;
        }

        return {
          acquired: false,
          reason: `lock held by non-live pid ${existing.payload.pid} for ${existing.payload.label} has ambiguous owner metadata`,
          release: async () => {},
        };
      }

      if (!existing.payload) {
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
