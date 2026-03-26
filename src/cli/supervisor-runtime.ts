import type { CliOptions, SupervisorConfig } from "../core/types";
import { createRestartableWebUiShellService } from "../backend/restartable-webui-shell-service";
import { createSupervisorHttpServer } from "../backend/supervisor-http-server";
import { sleep as defaultSleep } from "../core/utils";
import { ensureGsdInstalled as defaultEnsureGsdInstalled } from "../gsd";
import { readManagedRestartCapabilityFromEnv, type ManagedRestartController } from "../managed-restart";
import { renderDoctorReport } from "../doctor";
import { renderJsonCorruptStateResetResultDto } from "../supervisor/supervisor-mutation-report";
import { renderSupervisorExecutionMetricsRollupResultDto } from "../supervisor/supervisor-mutation-report";
import { renderSupervisorMutationResultDto } from "../supervisor/supervisor-mutation-report";
import { renderSupervisorOrphanPruneResultDto } from "../supervisor/supervisor-mutation-report";
import { renderPostMergeAuditPatternSummaryDto } from "../supervisor/post-merge-audit-summary";
import { renderIssueExplainDto } from "../supervisor/supervisor-selection-status";
import { renderIssueLintDto } from "../supervisor/supervisor-selection-issue-lint";
import { isCorruptJsonFailClosedMessage } from "../supervisor/supervisor";
import type { SupervisorLoopController } from "../supervisor/supervisor-loop-controller";
import type { SupervisorService } from "../supervisor/supervisor-service";
import { renderSupervisorStatusDto } from "../supervisor/supervisor-status-report";

type SupervisorRuntimeCommand = Extract<
  CliOptions["command"],
  | "run-once"
  | "loop"
  | "status"
  | "requeue"
  | "rollup-execution-metrics"
  | "summarize-post-merge-audits"
  | "prune-orphaned-workspaces"
  | "reset-corrupt-json-state"
  | "explain"
  | "issue-lint"
  | "doctor"
  | "web"
>;

interface SupervisorRuntimeDependencies {
  service: SupervisorService;
  loopController?: SupervisorLoopController;
  createWebUiService?: () => SupervisorService | Promise<SupervisorService>;
  ensureGsdInstalled?: (config: SupervisorConfig) => Promise<string | null>;
  sleep?: (ms: number, signal: AbortSignal) => Promise<void>;
  writeStdout?: (line: string) => void;
  writeStderr?: (line: string) => void;
  registerStopSignals?: (handler: (signal: NodeJS.Signals) => void) => void;
  createHttpServer?: (service: SupervisorService, options?: { managedRestart?: ManagedRestartController | null }) => {
    listen: (port: number, host: string, listeningListener?: () => void) => void;
    once: (event: "error", listener: (error: Error) => void) => void;
    close: (callback: (error?: Error) => void) => void;
    closeAllConnections?: () => void;
    address: () => string | { address: string; family: string; port: number } | null;
  };
}

export function isSupervisorRuntimeCommand(command: CliOptions["command"]): command is SupervisorRuntimeCommand {
  return (
    command === "run-once" ||
    command === "loop" ||
    command === "status" ||
    command === "requeue" ||
    command === "rollup-execution-metrics" ||
    command === "summarize-post-merge-audits" ||
    command === "prune-orphaned-workspaces" ||
    command === "reset-corrupt-json-state" ||
    command === "explain" ||
    command === "issue-lint" ||
    command === "doctor" ||
    command === "web"
  );
}

function requiresGsdInstall(command: SupervisorRuntimeCommand): boolean {
  return (
    command !== "status" &&
    command !== "requeue" &&
    command !== "rollup-execution-metrics" &&
    command !== "summarize-post-merge-audits" &&
    command !== "prune-orphaned-workspaces" &&
    command !== "reset-corrupt-json-state" &&
    command !== "explain" &&
    command !== "issue-lint" &&
    command !== "doctor" &&
    command !== "web"
  );
}

function registerProcessStopSignals(handler: (signal: NodeJS.Signals) => void): void {
  process.once("SIGINT", () => handler("SIGINT"));
  process.once("SIGTERM", () => handler("SIGTERM"));
}

function requireLoopController(
  command: "loop" | "run-once",
  loopController?: SupervisorLoopController,
): SupervisorLoopController {
  if (!loopController) {
    throw new Error(`Missing supervisor loop controller for ${command} command`);
  }

  return loopController;
}

export async function runSupervisorCycle(
  loopController: Pick<SupervisorLoopController, "runCycle">,
  command: "loop" | "run-once",
  options: Pick<CliOptions, "dryRun">,
): Promise<string> {
  return loopController.runCycle(command, options);
}

export async function runSupervisorCommand(
  options: Pick<CliOptions, "dryRun" | "why" | "issueNumber"> & { command: SupervisorRuntimeCommand },
  dependencies: SupervisorRuntimeDependencies,
): Promise<void> {
  const {
    service,
    loopController,
    ensureGsdInstalled = defaultEnsureGsdInstalled,
    sleep = defaultSleep,
    writeStdout = (line) => console.log(line),
    writeStderr = (line) => console.error(line),
    registerStopSignals = registerProcessStopSignals,
    createHttpServer = (createdService, serverOptions) => createSupervisorHttpServer({ service: createdService, managedRestart: serverOptions?.managedRestart }),
  } = dependencies;
  const cycleController =
    options.command === "run-once" || options.command === "loop"
      ? requireLoopController(options.command, loopController)
      : null;

  let shouldStop = false;
  let sleepController: AbortController | null = null;
  let stopWebServer: (() => void) | null = null;
  let lastStopSignal: NodeJS.Signals | null = null;

  registerStopSignals((signal) => {
    shouldStop = true;
    lastStopSignal = signal;
    sleepController?.abort();
    if (stopWebServer) {
      writeStdout(`${new Date().toISOString()} received ${signal}, shutting down WebUI`);
      stopWebServer();
      return;
    }
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

  if (options.command === "rollup-execution-metrics") {
    if (!service.rollupExecutionMetrics) {
      throw new Error("Missing supervisor execution metrics rollup support.");
    }
    writeStdout(renderSupervisorExecutionMetricsRollupResultDto(await service.rollupExecutionMetrics()));
    return;
  }

  if (options.command === "summarize-post-merge-audits") {
    if (!service.queryPostMergeAuditSummary) {
      throw new Error("Missing post-merge audit summary support.");
    }
    writeStdout(renderPostMergeAuditPatternSummaryDto(await service.queryPostMergeAuditSummary()));
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
    writeStdout(renderIssueLintDto(await service.queryIssueLint(options.issueNumber!)));
    return;
  }

  if (options.command === "doctor") {
    writeStdout(renderDoctorReport(await service.queryDoctor()));
    return;
  }

  if (options.command === "web") {
    const managedRestartCapability = readManagedRestartCapabilityFromEnv(process.env);
    const shellService = managedRestartCapability && dependencies.createWebUiService
      ? createRestartableWebUiShellService({
        service,
        recreateService: dependencies.createWebUiService,
        capability: managedRestartCapability,
        writeStdout,
      })
      : null;
    const server = createHttpServer(shellService?.service ?? service, { managedRestart: shellService?.managedRestart ?? null });
    await new Promise<void>((resolve, reject) => {
      let settled = false;
      const complete = (error?: Error) => {
        if (settled) {
          return;
        }
        settled = true;
        if (error) {
          reject(error);
          return;
        }
        resolve();
      };

      server.once("error", (error) => complete(error));
      server.listen(4310, "127.0.0.1", () => {
        const address = server.address();
        if (!address || typeof address === "string") {
          complete(new Error("Supervisor WebUI server did not report a listen address."));
          return;
        }

        writeStdout(`WebUI listening on http://127.0.0.1:${address.port}`);
      });
      stopWebServer = () => {
        server.closeAllConnections?.();
        server.close((error) => complete(error ?? undefined));
      };
      if (shouldStop) {
        writeStdout(`${new Date().toISOString()} received ${lastStopSignal ?? "SIGTERM"}, shutting down WebUI`);
        stopWebServer();
      }
    });
    return;
  }

  if (options.command === "run-once") {
    writeStdout(await runSupervisorCycle(cycleController!, "run-once", { dryRun: options.dryRun }));
    return;
  }

  const loopRuntimeLock = await cycleController!.acquireLoopRuntimeLock();
  if (!loopRuntimeLock.acquired) {
    throw new Error(`Cannot start supervisor loop: ${loopRuntimeLock.reason ?? "loop runtime unavailable"}`);
  }

  try {
    while (!shouldStop) {
      try {
        const message = await runSupervisorCycle(cycleController!, "loop", { dryRun: options.dryRun });
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
  } finally {
    await loopRuntimeLock.release();
  }
}
