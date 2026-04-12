import path from "node:path";
import { acquireFileLock, inspectFileLock, type ExistingLockState, type LockHandle } from "../core/lock";

export type SupervisorLoopHostMode = "tmux" | "direct" | "unknown";

export interface SupervisorLoopRuntimeDto {
  state: "running" | "off" | "unknown";
  hostMode: SupervisorLoopHostMode;
  pid: number | null;
  startedAt: string | null;
  detail: string | null;
}

const LOOP_RUNTIME_LOCK_LABEL = "supervisor-loop-runtime";

export function supervisorLoopRuntimeLockPath(stateFile: string): string {
  return path.resolve(path.dirname(stateFile), "locks", "supervisor", "loop-runtime.lock");
}

export async function acquireSupervisorLoopRuntimeLock(stateFile: string): Promise<LockHandle> {
  return acquireFileLock(supervisorLoopRuntimeLockPath(stateFile), LOOP_RUNTIME_LOCK_LABEL);
}

export async function inspectSupervisorLoopRuntimeLock(stateFile: string): Promise<ExistingLockState> {
  return inspectFileLock(supervisorLoopRuntimeLockPath(stateFile));
}

function normalizeLoopHostModeFromLauncher(
  launcher: string | null | undefined,
  fallback: SupervisorLoopHostMode,
): SupervisorLoopHostMode {
  const normalized = launcher?.trim().toLowerCase();
  if (!normalized) {
    return fallback;
  }
  if (normalized === "tmux") {
    return "tmux";
  }
  return "direct";
}

function inferLoopHostMode(runtimeLock: ExistingLockState): SupervisorLoopHostMode {
  if (runtimeLock.status === "live") {
    return normalizeLoopHostModeFromLauncher(runtimeLock.payload?.launcher, "unknown");
  }
  if (runtimeLock.status === "ambiguous_owner") {
    return normalizeLoopHostModeFromLauncher(runtimeLock.payload?.launcher, "unknown");
  }
  return "unknown";
}

export function buildMacOsLoopHostWarning(
  loopRuntime: Pick<SupervisorLoopRuntimeDto, "state" | "hostMode">,
  platform: NodeJS.Platform = process.platform,
): string | null {
  if (platform !== "darwin" || loopRuntime.state !== "running" || loopRuntime.hostMode !== "direct") {
    return null;
  }

  return "macOS loop runtime is active outside tmux. Restart it with ./scripts/start-loop-tmux.sh and stop unsupported direct hosts before relying on steady-state automation.";
}

export async function readSupervisorLoopRuntime(stateFile: string): Promise<SupervisorLoopRuntimeDto> {
  const runtimeLock = await inspectSupervisorLoopRuntimeLock(stateFile);
  if (runtimeLock.status === "live") {
    return {
      state: "running",
      hostMode: inferLoopHostMode(runtimeLock),
      pid: runtimeLock.payload?.pid ?? null,
      startedAt: runtimeLock.payload?.acquired_at ?? null,
      detail: runtimeLock.payload?.label ?? LOOP_RUNTIME_LOCK_LABEL,
    };
  }

  if (runtimeLock.status === "ambiguous_owner") {
    return {
      state: "unknown",
      hostMode: inferLoopHostMode(runtimeLock),
      pid: runtimeLock.payload?.pid ?? null,
      startedAt: runtimeLock.payload?.acquired_at ?? null,
      detail: runtimeLock.payload?.label ?? LOOP_RUNTIME_LOCK_LABEL,
    };
  }

  return {
    state: "off",
    hostMode: "unknown",
    pid: null,
    startedAt: null,
    detail: null,
  };
}
