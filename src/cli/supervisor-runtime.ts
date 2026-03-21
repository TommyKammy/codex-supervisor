import type { CliOptions, SupervisorConfig } from "../core/types";
import { sleep as defaultSleep } from "../core/utils";
import { ensureGsdInstalled as defaultEnsureGsdInstalled } from "../gsd";
import { renderDoctorReport } from "../doctor";
import { renderJsonCorruptStateResetResultDto } from "../supervisor/supervisor-mutation-report";
import { renderSupervisorMutationResultDto } from "../supervisor/supervisor-mutation-report";
import { renderSupervisorOrphanPruneResultDto } from "../supervisor/supervisor-mutation-report";
import { renderIssueExplainDto } from "../supervisor/supervisor-selection-status";
import { isCorruptJsonFailClosedMessage } from "../supervisor/supervisor";
import { type SupervisorLock, type SupervisorService } from "../supervisor/supervisor-service";
import { renderSupervisorStatusDto } from "../supervisor/supervisor-status-report";

type SupervisorRuntimeCommand = Extract<
  CliOptions["command"],
  | "run-once"
  | "loop"
  | "status"
  | "requeue"
  | "prune-orphaned-workspaces"
  | "reset-corrupt-json-state"
  | "explain"
  | "issue-lint"
  | "doctor"
>;

interface SupervisorRuntimeDependencies {
  service: SupervisorService;
  ensureGsdInstalled?: (config: SupervisorConfig) => Promise<string | null>;
  sleep?: (ms: number, signal: AbortSignal) => Promise<void>;
  writeStdout?: (line: string) => void;
  writeStderr?: (line: string) => void;
  registerStopSignals?: (handler: (signal: NodeJS.Signals) => void) => void;
}

export function isSupervisorRuntimeCommand(command: CliOptions["command"]): command is SupervisorRuntimeCommand {
  return (
    command === "run-once" ||
    command === "loop" ||
    command === "status" ||
    command === "requeue" ||
    command === "prune-orphaned-workspaces" ||
    command === "reset-corrupt-json-state" ||
    command === "explain" ||
    command === "issue-lint" ||
    command === "doctor"
  );
}

function requiresGsdInstall(command: SupervisorRuntimeCommand): boolean {
  return (
    command !== "status" &&
    command !== "requeue" &&
    command !== "prune-orphaned-workspaces" &&
    command !== "reset-corrupt-json-state" &&
    command !== "explain" &&
    command !== "issue-lint" &&
    command !== "doctor"
  );
}

function registerProcessStopSignals(handler: (signal: NodeJS.Signals) => void): void {
  process.once("SIGINT", () => handler("SIGINT"));
  process.once("SIGTERM", () => handler("SIGTERM"));
}

export async function runOnceWithSupervisorLock(
  supervisor: Pick<SupervisorService, "acquireSupervisorLock" | "runOnce">,
  command: "loop" | "run-once",
  options: Pick<CliOptions, "dryRun">,
): Promise<string> {
  const lock = await supervisor.acquireSupervisorLock(command);
  if (!lock.acquired) {
    return `Skipped supervisor cycle: ${lock.reason}.`;
  }

  try {
    return await supervisor.runOnce(options);
  } finally {
    await lock.release();
  }
}

export async function runSupervisorCommand(
  options: Pick<CliOptions, "dryRun" | "why" | "issueNumber"> & { command: SupervisorRuntimeCommand },
  dependencies: SupervisorRuntimeDependencies,
): Promise<void> {
  const {
    service,
    ensureGsdInstalled = defaultEnsureGsdInstalled,
    sleep = defaultSleep,
    writeStdout = (line) => console.log(line),
    writeStderr = (line) => console.error(line),
    registerStopSignals = registerProcessStopSignals,
  } = dependencies;

  let shouldStop = false;
  let sleepController: AbortController | null = null;

  registerStopSignals((signal) => {
    shouldStop = true;
    sleepController?.abort();
    writeStdout(`${new Date().toISOString()} received ${signal}, stopping after current cycle`);
  });

  if (requiresGsdInstall(options.command)) {
    const installMessage = await ensureGsdInstalled(service.config);
    if (installMessage) {
      writeStdout(installMessage);
    }
  }

  if (options.command === "status") {
    writeStdout(renderSupervisorStatusDto(await service.queryStatus({ why: options.why })));
    return;
  }

  if (options.command === "requeue") {
    writeStdout(renderSupervisorMutationResultDto(await service.runRecoveryAction("requeue", options.issueNumber!)));
    return;
  }

  if (options.command === "prune-orphaned-workspaces") {
    writeStdout(renderSupervisorOrphanPruneResultDto(await service.pruneOrphanedWorkspaces()));
    return;
  }

  if (options.command === "reset-corrupt-json-state") {
    writeStdout(renderJsonCorruptStateResetResultDto(await service.resetCorruptJsonState()));
    return;
  }

  if (options.command === "explain") {
    writeStdout(renderIssueExplainDto(await service.queryExplain(options.issueNumber!)));
    return;
  }

  if (options.command === "issue-lint") {
    writeStdout((await service.queryIssueLint(options.issueNumber!)).join("\n"));
    return;
  }

  if (options.command === "doctor") {
    writeStdout(renderDoctorReport(await service.queryDoctor()));
    return;
  }

  if (options.command === "run-once") {
    writeStdout(await runOnceWithSupervisorLock(service, "run-once", { dryRun: options.dryRun }));
    return;
  }

  while (!shouldStop) {
    try {
      const message = await runOnceWithSupervisorLock(service, "loop", { dryRun: options.dryRun });
      writeStdout(`${new Date().toISOString()} ${message}`);
      if (isCorruptJsonFailClosedMessage(message)) {
        shouldStop = true;
      }
    } catch (error) {
      const message = error instanceof Error ? error.stack ?? error.message : String(error);
      writeStderr(`${new Date().toISOString()} loop-error ${message}`);
    }

    if (!shouldStop) {
      const pollIntervalMs = await service.pollIntervalMs();
      if (shouldStop) {
        break;
      }
      sleepController = new AbortController();
      try {
        await sleep(pollIntervalMs, sleepController.signal);
      } finally {
        sleepController = null;
      }
    }
  }
}
