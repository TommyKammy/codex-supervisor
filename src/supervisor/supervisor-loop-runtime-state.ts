import path from "node:path";
import { acquireFileLock, inspectFileLock, type ExistingLockState, type LockHandle } from "../core/lock";

export interface SupervisorLoopRuntimeDto {
  state: "running" | "off" | "unknown";
  pid: number | null;
  startedAt: string | null;
  detail: string | null;
}

const LOOP_RUNTIME_LOCK_LABEL = "supervisor-loop-runtime";

export function supervisorLoopRuntimeLockPath(stateFile: string): string {
  return path.resolve(path.dirname(stateFile), "locks", "supervisor", "loop-runtime.lock");
}

export async function acquireSupervisorLoopRuntimeLock(stateFile: string): Promise<LockHandle> {
  return acquireFileLock(supervisorLoopRuntimeLockPath(stateFile), LOOP_RUNTIME_LOCK_LABEL, {
    allowAmbiguousOwnerCleanup: true,
  });
}

export async function inspectSupervisorLoopRuntimeLock(stateFile: string): Promise<ExistingLockState> {
  return inspectFileLock(supervisorLoopRuntimeLockPath(stateFile));
}

export async function readSupervisorLoopRuntime(stateFile: string): Promise<SupervisorLoopRuntimeDto> {
  const runtimeLock = await inspectSupervisorLoopRuntimeLock(stateFile);
  if (runtimeLock.status === "live") {
    return {
      state: "running",
      pid: runtimeLock.payload?.pid ?? null,
      startedAt: runtimeLock.payload?.acquired_at ?? null,
      detail: runtimeLock.payload?.label ?? LOOP_RUNTIME_LOCK_LABEL,
    };
  }

  if (runtimeLock.status === "ambiguous_owner") {
    return {
      state: "unknown",
      pid: runtimeLock.payload?.pid ?? null,
      startedAt: runtimeLock.payload?.acquired_at ?? null,
      detail: runtimeLock.payload?.label ?? LOOP_RUNTIME_LOCK_LABEL,
    };
  }

  return {
    state: "off",
    pid: null,
    startedAt: null,
    detail: null,
  };
}
