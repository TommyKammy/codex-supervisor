import type { RestartRunOnce } from "../run-once-issue-preparation";
import type { RecoveryEvent } from "../run-once-cycle-prelude";
import { prependRecoveryLog } from "../recovery-reconciliation";
import type { CliOptions, GitHubIssue, IssueRunRecord, SupervisorStateFile } from "../core/types";

export interface RunOnceCycleContext {
  state: SupervisorStateFile;
  recoveryEvents: RecoveryEvent[];
  recoveryLog: string | null;
}

export interface RunOnceIssuePhaseContext extends RunOnceCycleContext {
  record: IssueRunRecord | null;
  options: Pick<CliOptions, "dryRun">;
}

export interface RunOnceContinue {
  kind: "restart";
  carryoverRecoveryEvents: RecoveryEvent[];
}

export interface RunOnceReturn {
  kind: "return";
  message: string;
}

interface RunSupervisorRunOnceArgs {
  options: Pick<CliOptions, "dryRun">;
  loadState: () => Promise<SupervisorStateFile>;
  readJsonParseErrorQuarantine: (state: SupervisorStateFile) => unknown;
  buildCorruptJsonFailClosedMessage: (quarantine: unknown) => string;
  startRunOnceCycle: (carryoverRecoveryEvents: RecoveryEvent[]) => Promise<RunOnceCycleContext | string>;
  normalizeActiveIssueRecordForExecution: (state: SupervisorStateFile) => Promise<IssueRunRecord | null>;
  runOnceIssuePhase: (context: RunOnceIssuePhaseContext) => Promise<RunOnceContinue | RunOnceReturn>;
}

interface RunSupervisorRunOnceIssuePhaseArgs<
  TReadyIssue extends {
    kind: "ready";
    record: IssueRunRecord;
    issue: GitHubIssue;
    issueLock: { release: () => Promise<void> };
  },
  TPreparedIssue,
> extends RunOnceIssuePhaseContext {
  resolveRunnableIssueContext: (
    state: SupervisorStateFile,
    record: IssueRunRecord | null,
  ) => Promise<TReadyIssue | RestartRunOnce | string>;
  prepareIssueExecutionContext: (
    readyIssue: TReadyIssue,
    state: SupervisorStateFile,
    options: Pick<CliOptions, "dryRun">,
  ) => Promise<TPreparedIssue | RestartRunOnce | string>;
  isRestartRunOnce: (preparedIssue: TPreparedIssue | RestartRunOnce | string) => preparedIssue is RestartRunOnce;
  runPreparedIssue: (
    preparedIssue: TPreparedIssue,
    context: RunOnceCycleContext & {
      state: SupervisorStateFile;
      options: Pick<CliOptions, "dryRun">;
    },
  ) => Promise<string>;
}

export async function runSupervisorRunOnce(args: RunSupervisorRunOnceArgs): Promise<string> {
  const state = await args.loadState();
  const quarantine = args.readJsonParseErrorQuarantine(state);
  if (quarantine) {
    return args.buildCorruptJsonFailClosedMessage(quarantine);
  }

  let carryoverRecoveryEvents: RecoveryEvent[] = [];
  for (;;) {
    const cycle = await args.startRunOnceCycle(carryoverRecoveryEvents);
    if (typeof cycle === "string") {
      return cycle;
    }
    carryoverRecoveryEvents = [];

    const record = await args.normalizeActiveIssueRecordForExecution(cycle.state);
    const result = await args.runOnceIssuePhase({
      ...cycle,
      record,
      options: args.options,
    });
    if (result.kind === "restart") {
      carryoverRecoveryEvents = result.carryoverRecoveryEvents;
      continue;
    }

    return result.message;
  }
}

export async function runSupervisorRunOnceIssuePhase<
  TReadyIssue extends {
    kind: "ready";
    record: IssueRunRecord;
    issue: GitHubIssue;
    issueLock: { release: () => Promise<void> };
  },
  TPreparedIssue,
>(
  args: RunSupervisorRunOnceIssuePhaseArgs<TReadyIssue, TPreparedIssue>,
): Promise<RunOnceContinue | RunOnceReturn> {
  const { state, record, options, recoveryEvents, recoveryLog } = args;
  const runnableIssue = await args.resolveRunnableIssueContext(state, record);
  if (typeof runnableIssue === "string") {
    return {
      kind: "return",
      message: prependRecoveryLog(runnableIssue, recoveryLog),
    };
  }
  if (runnableIssue.kind === "restart") {
    return {
      kind: "restart",
      carryoverRecoveryEvents: recoveryEvents,
    };
  }

  try {
    const preparedIssue = await args.prepareIssueExecutionContext(runnableIssue, state, options);
    if (typeof preparedIssue === "string") {
      return {
        kind: "return",
        message: prependRecoveryLog(preparedIssue, recoveryLog),
      };
    }
    if (args.isRestartRunOnce(preparedIssue)) {
      return {
        kind: "restart",
        carryoverRecoveryEvents: [...recoveryEvents, ...(preparedIssue.recoveryEvents ?? [])],
      };
    }

    return {
      kind: "return",
      message: await args.runPreparedIssue(preparedIssue, {
        state,
        options,
        recoveryEvents,
        recoveryLog,
      }),
    };
  } finally {
    await runnableIssue.issueLock.release();
  }
}

export type { RecoveryEvent };
