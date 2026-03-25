import { StateStore } from "./core/state-store";
import { CodexTurnResult, FailureContext, GitHubIssue, IssueRunRecord, SupervisorStateFile } from "./core/types";
import { truncate, truncatePreservingStartAndEnd } from "./core/utils";
import { syncExecutionMetricsRunSummarySafely } from "./supervisor/execution-metrics-run-summary";

type TurnExecutionFailureStateStore = Pick<StateStore, "save" | "touch">;

interface PersistTurnExecutionFailureArgs {
  stateStore: TurnExecutionFailureStateStore;
  state: SupervisorStateFile;
  record: IssueRunRecord;
  issue: Pick<GitHubIssue, "createdAt">;
  syncJournal: (record: IssueRunRecord) => Promise<void>;
  issueNumber: number;
  error: unknown;
  classifyFailure: (message: string | null | undefined) => "timeout" | "command_error";
  buildCodexFailureContext: (
    category: FailureContext["category"],
    summary: string,
    details: string[],
  ) => FailureContext;
  applyFailureSignature: (
    record: IssueRunRecord,
    failureContext: FailureContext | null,
  ) => Pick<IssueRunRecord, "last_failure_signature" | "repeated_failure_signature_count">;
  retentionRootPath?: string;
}

interface PersistCodexExitFailureArgs {
  stateStore: TurnExecutionFailureStateStore;
  state: SupervisorStateFile;
  record: IssueRunRecord;
  issue: Pick<GitHubIssue, "createdAt">;
  syncJournal: (record: IssueRunRecord) => Promise<void>;
  issueNumber: number;
  codexResult: Pick<CodexTurnResult, "lastMessage" | "stderr" | "stdout">;
  classifyFailure: (message: string | null | undefined) => "timeout" | "command_error";
  buildCodexFailureContext: (
    category: FailureContext["category"],
    summary: string,
    details: string[],
  ) => FailureContext;
  applyFailureSignature: (
    record: IssueRunRecord,
    failureContext: FailureContext | null,
  ) => Pick<IssueRunRecord, "last_failure_signature" | "repeated_failure_signature_count">;
  retentionRootPath?: string;
}

interface PersistMissingJournalHandoffArgs {
  stateStore: TurnExecutionFailureStateStore;
  state: SupervisorStateFile;
  record: IssueRunRecord;
  issue: Pick<GitHubIssue, "createdAt">;
  syncJournal: (record: IssueRunRecord) => Promise<void>;
  issueNumber: number;
  buildCodexFailureContext: (
    category: FailureContext["category"],
    summary: string,
    details: string[],
  ) => FailureContext;
  applyFailureSignature: (
    record: IssueRunRecord,
    failureContext: FailureContext | null,
  ) => Pick<IssueRunRecord, "last_failure_signature" | "repeated_failure_signature_count">;
  retentionRootPath?: string;
}

interface PersistHintedCodexTurnStateArgs {
  stateStore: TurnExecutionFailureStateStore;
  state: SupervisorStateFile;
  record: IssueRunRecord;
  issue: Pick<GitHubIssue, "createdAt">;
  syncJournal: (record: IssueRunRecord) => Promise<void>;
  issueNumber: number;
  lastMessage: string;
  hintedState: "blocked" | "failed";
  hintedBlockedReason: IssueRunRecord["blocked_reason"];
  hintedFailureSignature: string | null;
  buildCodexFailureContext: (
    category: FailureContext["category"],
    summary: string,
    details: string[],
  ) => FailureContext;
  applyFailureSignature: (
    record: IssueRunRecord,
    failureContext: FailureContext | null,
  ) => Pick<IssueRunRecord, "last_failure_signature" | "repeated_failure_signature_count">;
  normalizeBlockerSignature: (message: string | null | undefined) => string | null;
  isVerificationBlockedMessage: (message: string | null | undefined) => boolean;
  retentionRootPath?: string;
}

function timeoutRetryPatch(
  record: IssueRunRecord,
  failureKind: "timeout" | "command_error" | "codex_exit",
): Pick<IssueRunRecord, "timeout_retry_count"> {
  return {
    timeout_retry_count: failureKind === "timeout" ? record.timeout_retry_count + 1 : record.timeout_retry_count,
  };
}

function nextBlockerTracking(
  record: IssueRunRecord,
  hintedState: "blocked" | "failed",
  lastMessage: string,
  normalizeBlockerSignature: (message: string | null | undefined) => string | null,
): Pick<IssueRunRecord, "repeated_blocker_count" | "last_blocker_signature"> {
  const blockerSignature = hintedState === "blocked" ? normalizeBlockerSignature(lastMessage) : null;
  const repeatedBlockerCount =
    hintedState === "blocked" && blockerSignature && blockerSignature === record.last_blocker_signature
      ? record.repeated_blocker_count + 1
      : hintedState === "blocked"
        ? 1
        : 0;
  return {
    repeated_blocker_count: repeatedBlockerCount,
    last_blocker_signature: blockerSignature,
  };
}

async function persistTurnFailurePatch(args: {
  stateStore: TurnExecutionFailureStateStore;
  state: SupervisorStateFile;
  record: IssueRunRecord;
  issue: Pick<GitHubIssue, "createdAt">;
  syncJournal: (record: IssueRunRecord) => Promise<void>;
  patch: Partial<IssueRunRecord>;
  retentionRootPath?: string;
}): Promise<IssueRunRecord> {
  const updated = args.stateStore.touch(args.record, args.patch);
  args.state.issues[String(args.record.issue_number)] = updated;
  await args.stateStore.save(args.state);
  await syncExecutionMetricsRunSummarySafely({
    previousRecord: args.record,
    nextRecord: updated,
    issue: args.issue,
    retentionRootPath: args.retentionRootPath,
    warningContext: "persisting",
  });
  await args.syncJournal(updated);
  return updated;
}

export async function persistCodexTurnExecutionFailure(args: PersistTurnExecutionFailureArgs): Promise<IssueRunRecord> {
  const message = args.error instanceof Error ? args.error.stack ?? args.error.message : String(args.error);
  const failureKind = args.classifyFailure(message);
  const failureContext = args.buildCodexFailureContext(
    "codex",
    `Codex turn execution failed for issue #${args.issueNumber}.`,
    [truncatePreservingStartAndEnd(message, 2000) ?? "Unknown failure"],
  );

  return persistTurnFailurePatch({
    stateStore: args.stateStore,
    state: args.state,
    record: args.record,
    issue: args.issue,
    syncJournal: args.syncJournal,
    retentionRootPath: args.retentionRootPath,
    patch: {
      state: "failed",
      last_error: truncatePreservingStartAndEnd(message),
      last_failure_kind: failureKind,
      last_failure_context: failureContext,
      ...args.applyFailureSignature(args.record, failureContext),
      blocked_reason: null,
      ...timeoutRetryPatch(args.record, failureKind),
    },
  });
}

export async function persistCodexTurnExitFailure(args: PersistCodexExitFailureArgs): Promise<IssueRunRecord> {
  const failureOutput = [args.codexResult.lastMessage, args.codexResult.stderr, args.codexResult.stdout]
    .filter(Boolean)
    .join("\n");
  const failureKind = args.classifyFailure(failureOutput) === "timeout" ? "timeout" : "codex_exit";
  const failureContext = args.buildCodexFailureContext(
    "codex",
    `Codex exited non-zero for issue #${args.issueNumber}.`,
    [truncatePreservingStartAndEnd(failureOutput, 2000) ?? "Unknown failure output"],
  );

  return persistTurnFailurePatch({
    stateStore: args.stateStore,
    state: args.state,
    record: args.record,
    issue: args.issue,
    syncJournal: args.syncJournal,
    retentionRootPath: args.retentionRootPath,
    patch: {
      state: "failed",
      last_error: truncatePreservingStartAndEnd(failureOutput),
      last_failure_kind: failureKind,
      last_failure_context: failureContext,
      ...args.applyFailureSignature(args.record, failureContext),
      blocked_reason: null,
      ...timeoutRetryPatch(args.record, failureKind),
    },
  });
}

export async function persistMissingCodexJournalHandoff(
  args: PersistMissingJournalHandoffArgs,
): Promise<IssueRunRecord> {
  const failureContext = args.buildCodexFailureContext(
    "blocked",
    `Codex completed without updating the issue journal for issue #${args.issueNumber}.`,
    ["Update the Codex Working Notes section before ending the turn."],
  );

  return persistTurnFailurePatch({
    stateStore: args.stateStore,
    state: args.state,
    record: args.record,
    issue: args.issue,
    syncJournal: args.syncJournal,
    retentionRootPath: args.retentionRootPath,
    patch: {
      state: "blocked",
      last_error: truncate(failureContext.summary),
      last_failure_kind: null,
      last_failure_context: failureContext,
      ...args.applyFailureSignature(args.record, failureContext),
      blocked_reason: "handoff_missing",
    },
  });
}

export async function persistHintedCodexTurnState(args: PersistHintedCodexTurnStateArgs): Promise<IssueRunRecord> {
  const failureContext = args.buildCodexFailureContext(
    args.hintedState === "failed" ? "codex" : "blocked",
    `Codex reported ${args.hintedState} for issue #${args.issueNumber}.`,
    [truncate(args.lastMessage, 2000) ?? "No additional summary."],
  );
  if (args.hintedFailureSignature) {
    failureContext.signature = args.hintedFailureSignature;
  }

  return persistTurnFailurePatch({
    stateStore: args.stateStore,
    state: args.state,
    record: args.record,
    issue: args.issue,
    syncJournal: args.syncJournal,
    retentionRootPath: args.retentionRootPath,
    patch: {
      state: args.hintedState,
      last_error: truncate(args.lastMessage),
      last_failure_kind: args.hintedState === "failed" ? "codex_failed" : null,
      last_failure_context: failureContext,
      ...args.applyFailureSignature(args.record, failureContext),
      ...nextBlockerTracking(args.record, args.hintedState, args.lastMessage, args.normalizeBlockerSignature),
      blocked_reason:
        args.hintedState === "blocked"
          ? args.hintedBlockedReason ??
            (args.isVerificationBlockedMessage(args.lastMessage) ? "verification" : "unknown")
          : null,
    },
  });
}
