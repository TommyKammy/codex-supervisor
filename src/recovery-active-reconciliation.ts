import { inspectFileLock } from "./core/lock";
import { resolveTrackedIssueHostPaths } from "./core/journal";
import { type GitHubPullRequest, type IssueRunRecord, type SupervisorConfig, type SupervisorStateFile } from "./core/types";
import { type StateStore } from "./core/state-store";
import { nowIso, truncate } from "./core/utils";
import {
  captureIssueJournalFingerprint,
  clearInterruptedTurnMarker,
  readInterruptedTurnMarker,
  sameIssueJournalFingerprint,
} from "./interrupted-turn-marker";
import {
  getStaleStabilizingNoPrRecoveryCount,
  STALE_STABILIZING_NO_PR_RECOVERY_SIGNATURE,
} from "./no-pull-request-state";
import { buildUnsafeNoPrFailureContext } from "./recovery-support";
import { type RecoveryEvent } from "./run-once-cycle-prelude";
import { applyFailureSignature } from "./supervisor/supervisor-failure-helpers";

type StateStoreLike = Pick<StateStore, "touch" | "save">;
type StaleStabilizingNoPrBranchState = "recoverable" | "already_satisfied_on_main";
type BuildRecoveryEvent = (issueNumber: number, reason: string) => RecoveryEvent;
type ApplyRecoveryEvent = (
  patch: Partial<IssueRunRecord>,
  recoveryEvent: RecoveryEvent,
) => Partial<IssueRunRecord>;

const OWNER_GUARDED_ACTIVE_STATES = new Set<IssueRunRecord["state"]>([
  "planning",
  "reproducing",
  "implementing",
  "local_review_fix",
  "stabilizing",
  "repairing_ci",
  "resolving_conflict",
  "addressing_review",
]);

type DurableTurnUpdateEvidence =
  | "journal_changed"
  | "journal_mtime_advanced"
  | "record_updated_at_advanced"
  | "journal_unchanged"
  | "journal_missing"
  | "record_updated_at_stale"
  | "progress_unverifiable";

async function detectDurableTurnUpdateSince(
  config: Pick<SupervisorConfig, "issueJournalRelativePath" | "workspaceRoot"> | null,
  record: Pick<IssueRunRecord, "issue_number" | "workspace" | "journal_path" | "updated_at">,
  marker: {
    startedAt: string;
    journalFingerprint: import("./interrupted-turn-marker").InterruptedTurnMarker["journalFingerprint"];
  },
): Promise<{ hasDurableUpdate: boolean; evidence: DurableTurnUpdateEvidence }> {
  const journalPath = config
    ? (() => {
      const resolvedPaths = resolveTrackedIssueHostPaths(config, record);
      return record.journal_path || resolvedPaths.usingCanonicalWorkspace
        ? resolvedPaths.journal_path
        : null;
    })()
    : record.journal_path;

  if (journalPath && marker.journalFingerprint) {
    const currentJournalFingerprint = await captureIssueJournalFingerprint(journalPath);
    if (!currentJournalFingerprint.exists) {
      return { hasDurableUpdate: false, evidence: "journal_missing" };
    }

    return sameIssueJournalFingerprint(currentJournalFingerprint, marker.journalFingerprint)
      ? { hasDurableUpdate: false, evidence: "journal_unchanged" }
      : { hasDurableUpdate: true, evidence: "journal_changed" };
  }

  const startedAtMs = Date.parse(marker.startedAt);
  if (journalPath && Number.isFinite(startedAtMs)) {
    try {
      const journalStats = await import("node:fs").then((fs) => fs.promises.stat(journalPath));
      if (journalStats.mtimeMs > startedAtMs) {
        return { hasDurableUpdate: true, evidence: "journal_mtime_advanced" };
      }
      return { hasDurableUpdate: false, evidence: "journal_unchanged" };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return { hasDurableUpdate: false, evidence: "journal_missing" };
      }
      throw error;
    }
  }

  const updatedAtMs = Date.parse(record.updated_at);
  if (!Number.isFinite(updatedAtMs) || !Number.isFinite(startedAtMs)) {
    return { hasDurableUpdate: false, evidence: "progress_unverifiable" };
  }

  return updatedAtMs > startedAtMs
    ? { hasDurableUpdate: true, evidence: "record_updated_at_advanced" }
    : { hasDurableUpdate: false, evidence: "record_updated_at_stale" };
}

function appendInterruptedTurnEvidence(
  reason: string,
  interruptedTurnUpdate: { evidence: DurableTurnUpdateEvidence } | null,
): string {
  return interruptedTurnUpdate
    ? `${reason}; durable_progress_evidence=${interruptedTurnUpdate.evidence}`
    : reason;
}

export async function reconcileStaleActiveIssueReservationInModule(args: {
  config?: Pick<SupervisorConfig, "issueJournalRelativePath" | "workspaceRoot">;
  stateStore: StateStoreLike;
  state: SupervisorStateFile;
  issueLockPath: (issueNumber: number) => string;
  sessionLockPath: (sessionId: string) => string;
  sameFailureSignatureRepeatLimit?: number;
  resolvePullRequestForBranch?: (branch: string, trackedPrNumber: number | null) => Promise<GitHubPullRequest | null>;
  classifyStaleStabilizingNoPrBranchState?: (
    record: IssueRunRecord,
  ) => Promise<StaleStabilizingNoPrBranchState>;
  buildRecoveryEvent: BuildRecoveryEvent;
  applyRecoveryEvent: ApplyRecoveryEvent;
}): Promise<RecoveryEvent[]> {
  const recoveryEvents: RecoveryEvent[] = [];
  if (args.state.activeIssueNumber === null) {
    return recoveryEvents;
  }

  const record = args.state.issues[String(args.state.activeIssueNumber)] ?? null;
  if (!record) {
    args.state.activeIssueNumber = null;
    await args.stateStore.save(args.state);
    return recoveryEvents;
  }

  if (!OWNER_GUARDED_ACTIVE_STATES.has(record.state)) {
    args.state.activeIssueNumber = null;
    await args.stateStore.save(args.state);
    return recoveryEvents;
  }

  const issueLock = await inspectFileLock(args.issueLockPath(record.issue_number));
  if (issueLock.status === "live" || issueLock.status === "ambiguous_owner") {
    return recoveryEvents;
  }

  let missingLockReason = issueLock.status === "stale" ? "issue lock was stale" : "issue lock was missing";
  if (record.codex_session_id) {
    const sessionLock = await inspectFileLock(args.sessionLockPath(record.codex_session_id));
    if (sessionLock.status === "live" || sessionLock.status === "ambiguous_owner") {
      return recoveryEvents;
    }
    missingLockReason =
      issueLock.status === "stale" && sessionLock.status === "stale"
        ? "issue lock and session lock were stale"
        : issueLock.status === "stale" && sessionLock.status === "missing"
          ? "issue lock was stale and session lock was missing"
          : issueLock.status === "missing" && sessionLock.status === "stale"
            ? "issue lock was missing and session lock was stale"
            : "issue lock and session lock were missing";
  }

  const interruptedTurnMarker = await readInterruptedTurnMarker(record.workspace);
  const interruptedTurnUpdate =
    interruptedTurnMarker && interruptedTurnMarker.issueNumber === record.issue_number
      ? await detectDurableTurnUpdateSince(args.config ?? null, record, interruptedTurnMarker)
      : null;
  if (
    interruptedTurnMarker &&
    interruptedTurnMarker.issueNumber === record.issue_number &&
    !interruptedTurnUpdate?.hasDurableUpdate
  ) {
    const failureContext = {
      category: "blocked" as const,
      summary: `Codex started a turn for issue #${record.issue_number} but no durable handoff was recorded before the process exited.`,
      signature: "handoff-missing",
      command: null,
      details: [
        `started_at=${interruptedTurnMarker.startedAt}`,
        `durable_progress_evidence=${interruptedTurnUpdate?.evidence ?? "progress_unverifiable"}`,
        "Update the Codex Working Notes section before ending the turn.",
      ],
      url: null,
      updated_at: nowIso(),
    };
    const recoveryEvent = args.buildRecoveryEvent(
      record.issue_number,
      appendInterruptedTurnEvidence(
        `interrupted_turn_recovery: blocked issue #${record.issue_number} after an in-progress Codex turn ended without a durable handoff`,
        interruptedTurnUpdate,
      ),
    );
    const patch: Partial<IssueRunRecord> = {
      state: "blocked",
      codex_session_id: null,
      last_error: truncate(failureContext.summary, 1000),
      last_failure_kind: null,
      last_failure_context: failureContext,
      ...applyFailureSignature(record, failureContext),
      blocked_reason: "handoff_missing",
      last_blocker_signature: null,
      repeated_blocker_count: 0,
      stale_stabilizing_no_pr_recovery_count: 0,
    };
    args.state.issues[String(record.issue_number)] = args.stateStore.touch(
      record,
      args.applyRecoveryEvent(patch, recoveryEvent),
    );
    args.state.activeIssueNumber = null;
    await args.stateStore.save(args.state);
    await clearInterruptedTurnMarker(record.workspace);
    recoveryEvents.push(recoveryEvent);
    return recoveryEvents;
  }

  const matchedPullRequest =
    record.state === "stabilizing" && args.resolvePullRequestForBranch
      ? await args.resolvePullRequestForBranch(record.branch, record.pr_number)
      : null;
  const staleNoPrBranchState =
    record.state === "stabilizing" && matchedPullRequest === null && args.classifyStaleStabilizingNoPrBranchState
      ? await args.classifyStaleStabilizingNoPrBranchState(record)
      : "recoverable";
  const shouldRequeueStabilizing = false;
  const staleNoPrRepeatLimit = Math.max(args.sameFailureSignatureRepeatLimit ?? Number.POSITIVE_INFINITY, 1);
  const shouldMarkAlreadySatisfiedOnMain =
    shouldRequeueStabilizing && staleNoPrBranchState === "already_satisfied_on_main";
  const previousStaleNoPrRecoveryCount = getStaleStabilizingNoPrRecoveryCount(record);
  const staleNoPrRepeatedCount = shouldRequeueStabilizing
    ? shouldMarkAlreadySatisfiedOnMain
      ? previousStaleNoPrRecoveryCount
      : previousStaleNoPrRecoveryCount + 1
    : previousStaleNoPrRecoveryCount;
  const shouldClearStaleNoPrFailureTracking =
    record.state === "stabilizing" &&
    matchedPullRequest !== null &&
    (record.last_failure_signature === STALE_STABILIZING_NO_PR_RECOVERY_SIGNATURE || previousStaleNoPrRecoveryCount > 0);
  const shouldStopRepeatedStaleNoPrLoop =
    shouldRequeueStabilizing && !shouldMarkAlreadySatisfiedOnMain && staleNoPrRepeatedCount >= staleNoPrRepeatLimit;

  const staleNoPrFailureContext = shouldRequeueStabilizing && !shouldMarkAlreadySatisfiedOnMain
    ? {
        category: "blocked" as const,
        summary: shouldStopRepeatedStaleNoPrLoop
          ? `Issue #${record.issue_number} re-entered stale stabilizing recovery without a tracked PR ${staleNoPrRepeatedCount} times; manual intervention is required.`
          : `Issue #${record.issue_number} re-entered stale stabilizing recovery without a tracked PR; the supervisor will retry while the repeat count remains below ${staleNoPrRepeatLimit}.`,
        signature: STALE_STABILIZING_NO_PR_RECOVERY_SIGNATURE,
        command: null,
        details: [
          "state=stabilizing",
          "tracked_pr=none",
          `branch_state=${staleNoPrBranchState}`,
          `repeat_count=${staleNoPrRepeatedCount}/${staleNoPrRepeatLimit}`,
          "operator_action=confirm whether the implementation already landed elsewhere or retarget the tracked issue manually",
        ],
        url: null,
        updated_at: nowIso(),
      }
    : null;

  const staleNoPrManualReviewContext = shouldMarkAlreadySatisfiedOnMain
    ? buildUnsafeNoPrFailureContext({
        issueNumber: record.issue_number,
        localState: "stabilizing",
        githubIssueState: "OPEN",
        detail: "Stale stabilizing recovery found no meaningful branch changes, so the supervisor cannot treat the open issue as complete without authoritative completion evidence.",
      })
    : null;

  const recoveryEvent = args.buildRecoveryEvent(
    record.issue_number,
    appendInterruptedTurnEvidence(
      shouldMarkAlreadySatisfiedOnMain
        ? `stale_stabilizing_no_pr_manual_review: blocked issue #${record.issue_number} after stale stabilizing recovery found an open issue with no authoritative completion signal`
        : shouldStopRepeatedStaleNoPrLoop
        ? `stale_state_manual_stop: blocked issue #${record.issue_number} after repeated stale stabilizing recovery without a tracked PR`
        : shouldRequeueStabilizing
        ? `stale_state_cleanup: requeued stabilizing issue #${record.issue_number} after ${missingLockReason}`
        : `stale_state_cleanup: cleared stale active reservation after ${missingLockReason}`,
      interruptedTurnUpdate,
    ),
  );
  const patch: Partial<IssueRunRecord> = shouldMarkAlreadySatisfiedOnMain
    ? {
        state: "blocked",
        pr_number: null,
        codex_session_id: null,
        blocked_reason: "manual_review",
        last_error: truncate(staleNoPrManualReviewContext?.summary ?? "", 1000),
        last_failure_kind: null,
        last_failure_context: staleNoPrManualReviewContext,
        last_blocker_signature: null,
        last_failure_signature: null,
        repeated_failure_signature_count: 0,
        stale_stabilizing_no_pr_recovery_count: 0,
      }
    : {
        state: shouldStopRepeatedStaleNoPrLoop ? "blocked" : shouldRequeueStabilizing ? "queued" : record.state,
        pr_number: shouldRequeueStabilizing ? null : record.pr_number,
        codex_session_id: null,
        last_error: staleNoPrFailureContext?.summary ?? (shouldClearStaleNoPrFailureTracking ? null : record.last_error),
        last_failure_kind: shouldRequeueStabilizing ? null : record.last_failure_kind,
        last_failure_context:
          staleNoPrFailureContext ??
          (shouldClearStaleNoPrFailureTracking ? null : record.last_failure_context),
        last_failure_signature:
          staleNoPrFailureContext?.signature ??
          (shouldClearStaleNoPrFailureTracking ? null : record.last_failure_signature),
        repeated_failure_signature_count: shouldRequeueStabilizing
          ? 0
          : shouldClearStaleNoPrFailureTracking
            ? 0
            : record.repeated_failure_signature_count,
        stale_stabilizing_no_pr_recovery_count: shouldRequeueStabilizing
          ? staleNoPrRepeatedCount
          : shouldClearStaleNoPrFailureTracking
            ? 0
            : previousStaleNoPrRecoveryCount,
        blocked_reason: shouldStopRepeatedStaleNoPrLoop ? "manual_review" : null,
      };
  args.state.issues[String(record.issue_number)] = args.stateStore.touch(
    record,
    args.applyRecoveryEvent(patch, recoveryEvent),
  );
  args.state.activeIssueNumber = null;
  await args.stateStore.save(args.state);
  if (interruptedTurnMarker) {
    await clearInterruptedTurnMarker(record.workspace);
  }
  recoveryEvents.push(recoveryEvent);
  return recoveryEvents;
}
