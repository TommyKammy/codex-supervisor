import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";
import { loadConfigSummary, resolveConfigPath } from "../core/config";
import { acquireFileLock, inspectFileLock, type ExistingLockState, type LockHandle } from "../core/lock";
import type { RunState } from "../core/types";
import { isLoopAdvanceableState } from "../core/utils";

export type SupervisorLoopHostMode = "tmux" | "direct" | "unknown";

export interface SupervisorDuplicateLoopDiagnostic {
  kind: "duplicate_loop_processes";
  status: "duplicate";
  matchingProcessCount: number;
  matchingPids: number[];
  configPath: string;
  stateFile: string;
}

export interface SupervisorLoopRuntimeDto {
  state: "running" | "off" | "unknown";
  hostMode: SupervisorLoopHostMode;
  pid: number | null;
  startedAt: string | null;
  detail: string | null;
  duplicateLoopDiagnostic?: SupervisorDuplicateLoopDiagnostic;
}

export interface LoopOffTrackedWorkLike {
  issueNumber: number;
  state: RunState;
  prNumber: number | null;
}

export interface SupervisorLoopProcessSnapshot {
  pid: number;
  command: string;
}

export interface ReadSupervisorLoopRuntimeOptions {
  configPath?: string;
  listProcesses?: () => Promise<SupervisorLoopProcessSnapshot[]>;
}

const LOOP_RUNTIME_LOCK_LABEL = "supervisor-loop-runtime";
const execFileAsync = promisify(execFile);

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

export function buildLoopOffTrackedWorkBlocker(args: {
  loopRuntime: Pick<SupervisorLoopRuntimeDto, "state">;
  trackedIssues: LoopOffTrackedWorkLike[];
}): {
  summaryLine: string;
  warningMessage: string;
} | null {
  if (args.loopRuntime.state !== "off") {
    return null;
  }

  const activeTrackedIssues = args.trackedIssues.filter((issue) => isLoopAdvanceableState(issue.state));
  if (activeTrackedIssues.length === 0) {
    return null;
  }

  const firstTrackedIssue = [...activeTrackedIssues].sort((left, right) => left.issueNumber - right.issueNumber)[0];
  const trackedPr = firstTrackedIssue.prNumber === null ? "none" : `#${firstTrackedIssue.prNumber}`;
  const warningMessage =
    activeTrackedIssues.length === 1
      ? `Tracked work is active for issue #${firstTrackedIssue.issueNumber}, but the supervisor loop is off. Restart the loop to resume background execution.`
      : `Tracked work is active for ${activeTrackedIssues.length} issues, but the supervisor loop is off. Restart the loop to resume background execution beginning with issue #${firstTrackedIssue.issueNumber}.`;

  return {
    summaryLine: [
      "loop_runtime_blocker",
      "state=off",
      `active_tracked_issues=${activeTrackedIssues.length}`,
      `first_issue=#${firstTrackedIssue.issueNumber}`,
      `first_state=${firstTrackedIssue.state}`,
      `first_pr=${trackedPr}`,
      "action=restart_loop",
    ].join(" "),
    warningMessage,
  };
}

function tokenizeCommand(command: string): string[] {
  const tokens: string[] = [];
  let current = "";
  let quote: "'" | "\"" | null = null;
  let escaping = false;

  for (const character of command) {
    if (escaping) {
      current += character;
      escaping = false;
      continue;
    }

    if (character === "\\") {
      escaping = true;
      continue;
    }

    if (quote !== null) {
      if (character === quote) {
        quote = null;
      } else {
        current += character;
      }
      continue;
    }

    if (character === "'" || character === "\"") {
      quote = character;
      continue;
    }

    if (/\s/u.test(character)) {
      if (current) {
        tokens.push(current);
        current = "";
      }
      continue;
    }

    current += character;
  }

  if (escaping) {
    current += "\\";
  }
  if (current) {
    tokens.push(current);
  }
  return tokens;
}

function isSupervisorLoopEntrypointToken(token: string): boolean {
  const normalized = token.replace(/\\/g, "/");
  return normalized === "dist/index.js" ||
    normalized.endsWith("/dist/index.js") ||
    normalized === "src/index.ts" ||
    normalized.endsWith("/src/index.ts");
}

function parseLoopConfigPath(command: string): string | null {
  const tokens = tokenizeCommand(command);
  const loopIndex = tokens.indexOf("loop");
  if (loopIndex === -1 || !tokens.some(isSupervisorLoopEntrypointToken)) {
    return null;
  }

  for (let index = loopIndex + 1; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (token === "--config") {
      return tokens[index + 1] ?? null;
    }
    if (token.startsWith("--config=")) {
      return token.slice("--config=".length) || null;
    }
  }

  return null;
}

async function listProcessSnapshots(): Promise<SupervisorLoopProcessSnapshot[]> {
  const { stdout } = await execFileAsync("ps", ["-axo", "pid=,command="], { maxBuffer: 1024 * 1024 });
  return stdout
    .split(/\r?\n/u)
    .map((line) => {
      const match = line.match(/^\s*(\d+)\s+([\s\S]+)$/u);
      if (!match) {
        return null;
      }
      return {
        pid: Number(match[1]),
        command: match[2],
      };
    })
    .filter((entry): entry is SupervisorLoopProcessSnapshot => entry !== null && Number.isInteger(entry.pid));
}

async function resolveLoopProcessStateFile(configPath: string): Promise<string | null> {
  try {
    const summary = loadConfigSummary(configPath);
    return summary.config === null ? null : path.resolve(summary.config.stateFile);
  } catch {
    return null;
  }
}

async function detectDuplicateLoopProcesses(
  stateFile: string,
  options: ReadSupervisorLoopRuntimeOptions,
): Promise<SupervisorDuplicateLoopDiagnostic | null> {
  const currentConfigPath = path.resolve(options.configPath ?? resolveConfigPath(undefined));
  const currentStateFile = path.resolve(stateFile);
  const listProcesses = options.listProcesses ?? listProcessSnapshots;
  let snapshots: SupervisorLoopProcessSnapshot[];
  try {
    snapshots = await listProcesses();
  } catch {
    return null;
  }

  const matchingPids: number[] = [];
  for (const snapshot of snapshots) {
    const candidateConfigPath = parseLoopConfigPath(snapshot.command);
    if (candidateConfigPath === null) {
      continue;
    }

    const resolvedCandidateConfigPath = path.resolve(candidateConfigPath);
    if (resolvedCandidateConfigPath !== currentConfigPath) {
      continue;
    }

    const candidateStateFile = await resolveLoopProcessStateFile(resolvedCandidateConfigPath);
    if (candidateStateFile !== currentStateFile) {
      continue;
    }

    matchingPids.push(snapshot.pid);
  }

  const uniquePids = [...new Set(matchingPids)].sort((left, right) => left - right);
  if (uniquePids.length <= 1) {
    return null;
  }

  return {
    kind: "duplicate_loop_processes",
    status: "duplicate",
    matchingProcessCount: uniquePids.length,
    matchingPids: uniquePids,
    configPath: currentConfigPath,
    stateFile: currentStateFile,
  };
}

function withDuplicateLoopDiagnostic(
  runtime: SupervisorLoopRuntimeDto,
  diagnostic: SupervisorDuplicateLoopDiagnostic | null,
): SupervisorLoopRuntimeDto {
  return diagnostic === null
    ? runtime
    : {
      ...runtime,
      duplicateLoopDiagnostic: diagnostic,
    };
}

export async function readSupervisorLoopRuntime(
  stateFile: string,
  options: ReadSupervisorLoopRuntimeOptions = {},
): Promise<SupervisorLoopRuntimeDto> {
  const runtimeLock = await inspectSupervisorLoopRuntimeLock(stateFile);
  const duplicateLoopDiagnostic = await detectDuplicateLoopProcesses(stateFile, options);
  if (runtimeLock.status === "live") {
    return withDuplicateLoopDiagnostic({
      state: "running",
      hostMode: inferLoopHostMode(runtimeLock),
      pid: runtimeLock.payload?.pid ?? null,
      startedAt: runtimeLock.payload?.acquired_at ?? null,
      detail: runtimeLock.payload?.label ?? LOOP_RUNTIME_LOCK_LABEL,
    }, duplicateLoopDiagnostic);
  }

  if (runtimeLock.status === "ambiguous_owner") {
    return withDuplicateLoopDiagnostic({
      state: "unknown",
      hostMode: inferLoopHostMode(runtimeLock),
      pid: runtimeLock.payload?.pid ?? null,
      startedAt: runtimeLock.payload?.acquired_at ?? null,
      detail: runtimeLock.payload?.label ?? LOOP_RUNTIME_LOCK_LABEL,
    }, duplicateLoopDiagnostic);
  }

  return withDuplicateLoopDiagnostic({
    state: "off",
    hostMode: "unknown",
    pid: null,
    startedAt: null,
    detail: null,
  }, duplicateLoopDiagnostic);
}
