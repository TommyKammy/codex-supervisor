import fs from "node:fs";
import { runCommand } from "./core/command";
import {
  inferGitHubWaitStep,
  inferStateFromPullRequest,
} from "./pull-request-state";
import {
  syncCopilotReviewRequestObservation,
  syncCopilotReviewTimeoutState,
  syncReviewWaitWindow,
} from "./pull-request-state-sync";
import {
  blockedReasonForLifecycleState,
  isOpenPullRequest,
} from "./supervisor/supervisor-lifecycle";
import { inferFailureContext } from "./supervisor/supervisor-failure-context";
import { shouldReconcileTrackedPrStaleReviewBot } from "./supervisor/supervisor-execution-policy";
import {
  findHighRiskBlockingAmbiguity,
  findParentIssuesReadyToClose,
  hasAvailableIssueLabels,
  lintExecutionReadyIssueBody,
} from "./issue-metadata";
import { buildIssueDefinitionFingerprint, issueDefinitionFreshnessPatch } from "./issue-definition-freshness";
import { inspectFileLock } from "./core/lock";
import { RecoveryEvent } from "./run-once-cycle-prelude";
import { StateStore } from "./core/state-store";
import { GitHubIssue, IssueRunRecord, PullRequestCheck, ReviewThread, RunState, SupervisorConfig, SupervisorStateFile } from "./core/types";
import { nowIso, truncate } from "./core/utils";
import {
  executionMetricsRetentionRootPath,
  syncExecutionMetricsRunSummarySafely,
} from "./supervisor/execution-metrics-run-summary";
import { syncPostMergeAuditArtifactSafely } from "./supervisor/post-merge-audit-artifact";
import { resetTrackedPrHeadScopedStateOnAdvance } from "./tracked-pr-lifecycle-projection";
import {
  buildSupervisorMutationRecordSnapshot,
  type SupervisorMutationRecordSnapshotDto,
  type SupervisorMutationResultDto,
} from "./supervisor/supervisor-mutation-report";
import {
  getStaleStabilizingNoPrRecoveryCount,
  STALE_STABILIZING_NO_PR_RECOVERY_SIGNATURE,
} from "./no-pull-request-state";
import { applyFailureSignature } from "./supervisor/supervisor-failure-helpers";
import {
  buildUnsafeNoPrFailureContext,
  doneResetPatch,
  shouldReconsiderNoPrDoneRecord,
  sanitizeRecoveryReason,
} from "./recovery-support";
import { reconcileStaleFailedNoPrRecord } from "./recovery-no-pr-reconciliation";
import {
  buildTrackedPrResumeRecoveryEvent,
  reconcileStaleFailedTrackedPrRecord,
  reconcileTrackedMergedButOpenIssuesInModule,
} from "./recovery-tracked-pr-reconciliation";
export {
  inspectOrphanedWorkspacePruneCandidates,
  pruneOrphanedWorkspacesForOperator,
  type OrphanedWorkspacePruneCandidate,
  type OrphanedWorkspacePruneEligibility,
} from "./recovery-workspace-reconciliation";
import { cleanupExpiredDoneWorkspaces as cleanupExpiredDoneWorkspacesInModule } from "./recovery-workspace-reconciliation";
import { buildTrackedPrStaleFailureConvergencePatch } from "./recovery-tracked-pr-support";
import {
  captureIssueJournalFingerprint,
  clearInterruptedTurnMarker,
  readInterruptedTurnMarker,
  sameIssueJournalFingerprint,
} from "./interrupted-turn-marker";
import { mergeConflictDetected } from "./supervisor/supervisor-status-rendering";
import { projectTrackedPrLifecycle } from "./tracked-pr-lifecycle-projection";
import { hasFreshTrackedPrReadyPromotionBlockerEvidence } from "./tracked-pr-ready-promotion-blocker";
import { clearRequirementsBlockerIssueComment } from "./requirements-blocker-issue-comment";

const OWNER_GUARDED_ACTIVE_STATES = new Set<RunState>([
  "planning",
  "reproducing",
  "implementing",
  "local_review_fix",
  "stabilizing",
  "repairing_ci",
  "resolving_conflict",
  "addressing_review",
]);
const OPERATOR_REQUEUEABLE_STATES = new Set<RunState>(["blocked", "failed"]);
type StaleStabilizingNoPrBranchState = "recoverable" | "already_satisfied_on_main";

type StateStoreLike = Pick<StateStore, "touch" | "save">;

type RecoveryGitHubLike = Pick<
  import("./github").GitHubClient,
  | "closeIssue"
  | "closePullRequest"
  | "getChecks"
  | "getIssue"
  | "getMergedPullRequestsClosingIssue"
  | "getPullRequestIfExists"
  | "getUnresolvedReviewThreads"
> & Partial<Pick<import("./github").GitHubClient, "getIssueComments" | "updateIssueComment">>;

async function fetchOriginDefaultBranch(
  config: Pick<SupervisorConfig, "repoPath" | "defaultBranch" | "codexExecTimeoutMinutes">,
): Promise<void> {
  await runCommand("git", ["-C", config.repoPath, "fetch", "origin", config.defaultBranch], {
    timeoutMs: config.codexExecTimeoutMinutes * 60_000,
  });
}

function matchesTrackedBranch(
  record: Pick<IssueRunRecord, "branch">,
  pr: Pick<import("./core/types").GitHubPullRequest, "headRefName">,
): boolean {
  return pr.headRefName === record.branch;
}

function needsRecordUpdate(record: IssueRunRecord, patch: Partial<IssueRunRecord>): boolean {
  for (const [key, value] of Object.entries(patch)) {
    const recordValue = record[key as keyof IssueRunRecord];
    if (JSON.stringify(recordValue) !== JSON.stringify(value)) {
      return true;
    }
  }

  return false;
}

type DurableTurnUpdateEvidence =
  | "journal_changed"
  | "journal_mtime_advanced"
  | "record_updated_at_advanced"
  | "journal_unchanged"
  | "journal_missing"
  | "record_updated_at_stale"
  | "progress_unverifiable";

async function detectDurableTurnUpdateSince(
  record: Pick<IssueRunRecord, "journal_path" | "updated_at">,
  marker: {
    startedAt: string;
    journalFingerprint: import("./interrupted-turn-marker").InterruptedTurnMarker["journalFingerprint"];
  },
): Promise<{ hasDurableUpdate: boolean; evidence: DurableTurnUpdateEvidence }> {
  if (record.journal_path && marker.journalFingerprint) {
    const currentJournalFingerprint = await captureIssueJournalFingerprint(record.journal_path);
    if (!currentJournalFingerprint.exists) {
      return { hasDurableUpdate: false, evidence: "journal_missing" };
    }

    return sameIssueJournalFingerprint(currentJournalFingerprint, marker.journalFingerprint)
      ? { hasDurableUpdate: false, evidence: "journal_unchanged" }
      : { hasDurableUpdate: true, evidence: "journal_changed" };
  }

  const startedAtMs = Date.parse(marker.startedAt);
  if (record.journal_path && Number.isFinite(startedAtMs)) {
    try {
      const journalStats = await fs.promises.stat(record.journal_path);
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

function trackedMergedButOpenLastProcessedIssueNumber(state: SupervisorStateFile): number | null {
  return state.reconciliation_state?.tracked_merged_but_open_last_processed_issue_number ?? null;
}

function setTrackedMergedButOpenLastProcessedIssueNumber(
  state: SupervisorStateFile,
  issueNumber: number | null,
): boolean {
  const currentIssueNumber = trackedMergedButOpenLastProcessedIssueNumber(state);
  if (currentIssueNumber === issueNumber) {
    return false;
  }

  state.reconciliation_state = {
    ...(state.reconciliation_state ?? {}),
    tracked_merged_but_open_last_processed_issue_number: issueNumber,
  };
  return true;
}

function orderTrackedMergedButOpenRecordsForResume(
  records: IssueRunRecord[],
  lastProcessedIssueNumber: number | null,
): IssueRunRecord[] {
  if (records.length <= 1 || lastProcessedIssueNumber === null) {
    return records;
  }

  const resumeIndex = records.findIndex((record) => record.issue_number === lastProcessedIssueNumber);
  const nextIndex = resumeIndex !== -1
    ? resumeIndex + 1
    : records.findIndex((record) => record.issue_number > lastProcessedIssueNumber);
  if (nextIndex === -1 || nextIndex >= records.length) {
    return records;
  }

  return [
    ...records.slice(nextIndex),
    ...records.slice(0, nextIndex),
  ];
}

export function buildRecoveryEvent(issueNumber: number, reason: string): RecoveryEvent {
  return {
    issueNumber,
    reason,
    at: nowIso(),
  };
}

function createUntrackedRecoveredDoneRecord(issueNumber: number): IssueRunRecord {
  const updatedAt = nowIso();
  return {
    issue_number: issueNumber,
    state: "done",
    branch: "",
    pr_number: null,
    workspace: "",
    journal_path: null,
    review_wait_started_at: null,
    review_wait_head_sha: null,
    provider_success_observed_at: null,
    provider_success_head_sha: null,
    merge_readiness_last_evaluated_at: null,
    copilot_review_requested_observed_at: null,
    copilot_review_requested_head_sha: null,
    copilot_review_timed_out_at: null,
    copilot_review_timeout_action: null,
    copilot_review_timeout_reason: null,
    codex_session_id: null,
    local_review_head_sha: null,
    local_review_blocker_summary: null,
    local_review_summary_path: null,
    local_review_run_at: null,
    local_review_max_severity: null,
    local_review_findings_count: 0,
    local_review_root_cause_count: 0,
    local_review_verified_max_severity: null,
    local_review_verified_findings_count: 0,
    local_review_recommendation: null,
    local_review_degraded: false,
    pre_merge_evaluation_outcome: null,
    pre_merge_must_fix_count: 0,
    pre_merge_manual_review_count: 0,
    pre_merge_follow_up_count: 0,
    last_local_review_signature: null,
    repeated_local_review_signature_count: 0,
    latest_local_ci_result: null,
    external_review_head_sha: null,
    external_review_misses_path: null,
    external_review_matched_findings_count: 0,
    external_review_near_match_findings_count: 0,
    external_review_missed_findings_count: 0,
    attempt_count: 0,
    implementation_attempt_count: 0,
    repair_attempt_count: 0,
    timeout_retry_count: 0,
    blocked_verification_retry_count: 0,
    repeated_blocker_count: 0,
    repeated_failure_signature_count: 0,
    stale_stabilizing_no_pr_recovery_count: 0,
    last_head_sha: null,
    review_follow_up_head_sha: null,
    review_follow_up_remaining: 0,
    workspace_restore_source: null,
    workspace_restore_ref: null,
    last_codex_summary: null,
    last_recovery_reason: null,
    last_recovery_at: null,
    issue_definition_fingerprint: null,
    issue_definition_updated_at: null,
    last_error: null,
    last_failure_kind: null,
    last_failure_context: null,
    last_runtime_error: null,
    last_runtime_failure_kind: null,
    last_runtime_failure_context: null,
    last_blocker_signature: null,
    last_failure_signature: null,
    last_tracked_pr_progress_snapshot: null,
    last_tracked_pr_progress_summary: null,
    last_tracked_pr_repeat_failure_decision: null,
    last_observed_host_local_pr_blocker_signature: null,
    last_observed_host_local_pr_blocker_head_sha: null,
    last_host_local_pr_blocker_comment_signature: null,
    last_host_local_pr_blocker_comment_head_sha: null,
    last_stale_review_bot_reply_signature: null,
    last_stale_review_bot_reply_head_sha: null,
    stale_review_bot_reply_progress_keys: [],
    stale_review_bot_resolve_progress_keys: [],
    blocked_reason: null,
    processed_review_thread_ids: [],
    processed_review_thread_fingerprints: [],
    updated_at: updatedAt,
  };
}

function latestFiniteTimestamp(...values: Array<string | null | undefined>): number | null {
  let latest: number | null = null;
  for (const value of values) {
    const parsed = Date.parse(value ?? "");
    if (!Number.isFinite(parsed)) {
      continue;
    }
    latest = latest === null ? parsed : Math.max(latest, parsed);
  }
  return latest;
}

function shouldReconsiderBlockedNoPrStaleManualStop(
  record: Pick<
    IssueRunRecord,
    | "state"
    | "blocked_reason"
    | "pr_number"
    | "last_failure_signature"
    | "last_failure_context"
    | "last_recovery_at"
    | "updated_at"
  >,
  issue: Pick<GitHubIssue, "updatedAt">,
): boolean {
  if (
    record.state !== "blocked" ||
    record.blocked_reason !== "manual_review" ||
    record.pr_number !== null ||
    record.last_failure_signature !== STALE_STABILIZING_NO_PR_RECOVERY_SIGNATURE
  ) {
    return false;
  }

  const issueUpdatedAtMs = Date.parse(issue.updatedAt);
  const localStopObservedAtMs = latestFiniteTimestamp(
    record.last_failure_context?.updated_at,
    record.last_recovery_at,
    record.updated_at,
  );

  return (
    Number.isFinite(issueUpdatedAtMs) &&
    localStopObservedAtMs !== null &&
    issueUpdatedAtMs > localStopObservedAtMs
  );
}

function shouldReconsiderGenericNoPrIssueDefinitionChange(
  record: Pick<
    IssueRunRecord,
    | "state"
    | "blocked_reason"
    | "pr_number"
    | "issue_definition_fingerprint"
    | "last_failure_context"
    | "last_recovery_at"
    | "updated_at"
  >,
  issue: Pick<GitHubIssue, "title" | "body" | "labels" | "updatedAt">,
): boolean {
  if (record.pr_number !== null) {
    return false;
  }

  if (record.state !== "blocked" && record.state !== "failed") {
    return false;
  }

  if (record.state === "blocked" && (
    record.blocked_reason === "requirements"
    || record.blocked_reason === "clarification"
    || record.blocked_reason === "permissions"
    || record.blocked_reason === "secrets"
  )) {
    return false;
  }

  if (!record.issue_definition_fingerprint) {
    return false;
  }

  const issueUpdatedAtMs = Date.parse(issue.updatedAt);
  const localStopObservedAtMs = latestFiniteTimestamp(
    record.last_failure_context?.updated_at,
    record.last_recovery_at,
    record.updated_at,
  );
  if (!Number.isFinite(issueUpdatedAtMs) || localStopObservedAtMs === null || issueUpdatedAtMs <= localStopObservedAtMs) {
    return false;
  }

  return buildIssueDefinitionFingerprint(issue) !== record.issue_definition_fingerprint;
}

export function applyRecoveryEvent(
  patch: Partial<IssueRunRecord>,
  recoveryEvent: RecoveryEvent,
): Partial<IssueRunRecord> {
  return {
    ...patch,
    last_recovery_reason: recoveryEvent.reason,
    last_recovery_at: recoveryEvent.at,
  };
}

export function formatRecoveryLog(events: RecoveryEvent[]): string | null {
  if (events.length === 0) {
    return null;
  }

  return [...events]
    .sort((left, right) => left.issueNumber - right.issueNumber || left.reason.localeCompare(right.reason))
    .map((event) => `recovery issue=#${event.issueNumber} reason=${sanitizeRecoveryReason(event.reason)}`)
    .join("; ");
}

export function prependRecoveryLog(message: string, recoveryLog: string | null): string {
  return recoveryLog ? `${recoveryLog}; ${message}` : message;
}

function buildRejectedMutationResult(
  issueNumber: number,
  previousState: RunState | null,
  previousRecordSnapshot: SupervisorMutationRecordSnapshotDto | null,
  summary: string,
): SupervisorMutationResultDto {
  return {
    action: "requeue",
    issueNumber,
    outcome: "rejected",
    summary,
    previousState,
    previousRecordSnapshot,
    nextState: previousState,
    recoveryReason: null,
  };
}

export async function requeueIssueForOperator(
  stateStore: StateStoreLike,
  state: SupervisorStateFile,
  issueNumber: number,
): Promise<SupervisorMutationResultDto> {
  const record = state.issues[String(issueNumber)];
  if (!record) {
    return buildRejectedMutationResult(
      issueNumber,
      null,
      null,
      `Rejected requeue for issue #${issueNumber}: the issue is not tracked in supervisor state.`,
    );
  }

  const previousRecordSnapshot = buildSupervisorMutationRecordSnapshot(record);
  const previousState = previousRecordSnapshot.state;

  if (state.activeIssueNumber === issueNumber) {
    return buildRejectedMutationResult(
      issueNumber,
      previousState,
      previousRecordSnapshot,
      `Rejected requeue for issue #${issueNumber}: active issue reservations cannot be mutated.`,
    );
  }

  if (record.pr_number !== null) {
    return buildRejectedMutationResult(
      issueNumber,
      previousState,
      previousRecordSnapshot,
      `Rejected requeue for issue #${issueNumber}: tracked PR work cannot be requeued explicitly.`,
    );
  }

  if (!OPERATOR_REQUEUEABLE_STATES.has(record.state)) {
    return buildRejectedMutationResult(
      issueNumber,
      previousState,
      previousRecordSnapshot,
      `Rejected requeue for issue #${issueNumber}: only blocked or failed issues can be requeued safely.`,
    );
  }

  const recoveryEvent = buildRecoveryEvent(
    issueNumber,
    `operator_requeue: requeued issue #${issueNumber} from ${previousState} to queued`,
  );
  const updated = stateStore.touch(record, applyRecoveryEvent({
    state: "queued",
    codex_session_id: null,
    blocked_reason: null,
    review_wait_started_at: null,
    review_wait_head_sha: null,
    provider_success_observed_at: null,
    provider_success_head_sha: null,
    merge_readiness_last_evaluated_at: null,
    copilot_review_requested_observed_at: null,
    copilot_review_requested_head_sha: null,
    copilot_review_timed_out_at: null,
    copilot_review_timeout_action: null,
    copilot_review_timeout_reason: null,
    local_review_blocker_summary: null,
  }, recoveryEvent));
  state.issues[String(issueNumber)] = updated;
  await stateStore.save(state);

  return {
    action: "requeue",
    issueNumber,
    outcome: "mutated",
    summary: `Requeued issue #${issueNumber} from ${previousState} to queued.`,
    previousState,
    previousRecordSnapshot,
    nextState: updated.state,
    recoveryReason: recoveryEvent.reason,
  };
}

export { buildTrackedPrStaleFailureConvergencePatch } from "./recovery-tracked-pr-support";

export async function cleanupExpiredDoneWorkspaces(
  config: SupervisorConfig,
  state: SupervisorStateFile,
): Promise<RecoveryEvent[]> {
  return cleanupExpiredDoneWorkspacesInModule(config, state, buildRecoveryEvent);
}

export async function reconcileMergedIssueClosures(
  github: RecoveryGitHubLike,
  stateStore: StateStoreLike,
  state: SupervisorStateFile,
  config: SupervisorConfig,
  issues: GitHubIssue[],
): Promise<RecoveryEvent[]> {
  let changed = false;
  const recoveryEvents: RecoveryEvent[] = [];
  const issueByNumber = new Map(issues.map((issue) => [issue.number, issue]));
  const issueStateByNumber = new Map(issues.map((issue) => [issue.number, issue.state ?? null]));

  for (const record of Object.values(state.issues)) {
    if (issueStateByNumber.get(record.issue_number) !== "CLOSED") {
      continue;
    }

    const satisfyingPullRequests = await github.getMergedPullRequestsClosingIssue(record.issue_number);
    const satisfyingPullRequest = satisfyingPullRequests[0] ?? null;

    if (!satisfyingPullRequest) {
      const patch = doneResetPatch();
      if (needsRecordUpdate(record, patch)) {
        const updated = stateStore.touch(record, patch);
        state.issues[String(record.issue_number)] = updated;
        changed = true;
      }
      if (state.activeIssueNumber === record.issue_number) {
        state.activeIssueNumber = null;
        changed = true;
      }
      continue;
    }

    if (
      record.pr_number !== null &&
      record.pr_number !== satisfyingPullRequest.number
    ) {
      const trackedPullRequest = await github.getPullRequestIfExists(record.pr_number);
      if (trackedPullRequest && trackedPullRequest.state === "OPEN" && !trackedPullRequest.mergedAt) {
        await github.closePullRequest(
          trackedPullRequest.number,
          `Closing as superseded because issue #${record.issue_number} was satisfied by merged PR #${satisfyingPullRequest.number}.`,
        );
      }
    }

    const patch = doneResetPatch({
      pr_number: satisfyingPullRequest.number,
      last_head_sha: satisfyingPullRequest.headRefOid,
    });
    if (needsRecordUpdate(record, patch)) {
      const recoveryEvent = buildRecoveryEvent(
        record.issue_number,
        `merged_pr_convergence: merged PR #${satisfyingPullRequest.number} satisfied issue #${record.issue_number}; marked issue #${record.issue_number} done`,
      );
      const updated = stateStore.touch(record, applyRecoveryEvent(patch, recoveryEvent));
      state.issues[String(record.issue_number)] = updated;
      changed = true;
      recoveryEvents.push(recoveryEvent);
      await syncExecutionMetricsRunSummarySafely({
        previousRecord: record,
        nextRecord: updated,
        issue: issueByNumber.get(record.issue_number) ?? null,
        pullRequest: satisfyingPullRequest,
        recoveryEvents: [recoveryEvent],
        retentionRootPath: executionMetricsRetentionRootPath(config.stateFile),
        warningContext: "reconciling",
      });
      await syncPostMergeAuditArtifactSafely({
        config,
        previousRecord: record,
        nextRecord: updated,
        issue: issueByNumber.get(record.issue_number) ?? {
          number: record.issue_number,
          title: `Issue #${record.issue_number}`,
          url: "",
          createdAt: updated.updated_at,
          updatedAt: updated.updated_at,
        },
        pullRequest: satisfyingPullRequest,
        warningContext: "reconciling",
      });
    }
    if (state.activeIssueNumber === record.issue_number) {
      state.activeIssueNumber = null;
      changed = true;
    }
  }

  if (changed) {
    await stateStore.save(state);
  }

  return recoveryEvents;
}

export async function reconcileTrackedMergedButOpenIssues(
  github: RecoveryGitHubLike,
  stateStore: StateStoreLike,
  state: SupervisorStateFile,
  config: SupervisorConfig,
  issues: GitHubIssue[],
  updateReconciliationProgress: ((patch: {
    targetIssueNumber?: number | null;
    targetPrNumber?: number | null;
    waitStep?: string | null;
  }) => Promise<void>) | null = null,
  options: {
    onlyIssueNumber?: number | null;
    maxRecords?: number | null;
  } = {},
): Promise<RecoveryEvent[]> {
  return reconcileTrackedMergedButOpenIssuesInModule(
    github,
    stateStore,
    state,
    config,
    issues,
    {
      buildRecoveryEvent,
      applyRecoveryEvent,
      doneResetPatch,
      inferGitHubWaitStep,
    },
    updateReconciliationProgress,
    options,
  );
}

export async function reconcileStaleFailedIssueStates(
  github: RecoveryGitHubLike,
  stateStore: StateStoreLike,
  state: SupervisorStateFile,
  config: SupervisorConfig,
  issues: GitHubIssue[],
  deps: {
    inferStateFromPullRequest: (
      config: SupervisorConfig,
      record: IssueRunRecord,
      pr: GitHubIssue extends never ? never : NonNullable<Awaited<ReturnType<RecoveryGitHubLike["getPullRequestIfExists"]>>>,
      checks: PullRequestCheck[],
      reviewThreads: ReviewThread[],
    ) => IssueRunRecord["state"];
    inferFailureContext: (
      config: SupervisorConfig,
      record: IssueRunRecord,
      pr: GitHubIssue extends never ? never : NonNullable<Awaited<ReturnType<RecoveryGitHubLike["getPullRequestIfExists"]>>>,
      checks: PullRequestCheck[],
      reviewThreads: ReviewThread[],
    ) => IssueRunRecord["last_failure_context"];
    blockedReasonForLifecycleState: (
      config: SupervisorConfig,
      record: IssueRunRecord,
      pr: GitHubIssue extends never ? never : NonNullable<Awaited<ReturnType<RecoveryGitHubLike["getPullRequestIfExists"]>>>,
      checks: PullRequestCheck[],
      reviewThreads: ReviewThread[],
    ) => IssueRunRecord["blocked_reason"];
    isOpenPullRequest: (
      pr: NonNullable<Awaited<ReturnType<RecoveryGitHubLike["getPullRequestIfExists"]>>>,
    ) => boolean;
    syncReviewWaitWindow: (
      record: IssueRunRecord,
      pr: NonNullable<Awaited<ReturnType<RecoveryGitHubLike["getPullRequestIfExists"]>>>,
    ) => Partial<IssueRunRecord>;
    syncCopilotReviewRequestObservation: (
      config: SupervisorConfig,
      record: IssueRunRecord,
      pr: NonNullable<Awaited<ReturnType<RecoveryGitHubLike["getPullRequestIfExists"]>>>,
    ) => Partial<IssueRunRecord>;
    syncCopilotReviewTimeoutState: typeof syncCopilotReviewTimeoutState;
    fetchOriginDefaultBranch?: (
      config: Pick<SupervisorConfig, "repoPath" | "defaultBranch" | "codexExecTimeoutMinutes">
    ) => Promise<void>;
    inferGitHubWaitStep?: (
      config: SupervisorConfig,
      record: IssueRunRecord,
      pr: NonNullable<Awaited<ReturnType<RecoveryGitHubLike["getPullRequestIfExists"]>>>,
      checks: PullRequestCheck[],
    ) => string | null;
  },
  updateReconciliationProgress: ((patch: {
    targetIssueNumber?: number | null;
    targetPrNumber?: number | null;
    waitStep?: string | null;
  }) => Promise<void>) | null = null,
): Promise<void> {
  let changed = false;
  const issuesByNumber = new Map(issues.map((issue) => [issue.number, issue]));
  const issueStateByNumber = new Map(issues.map((issue) => [issue.number, issue.state ?? null]));
  let failedNoPrFetchPromise: Promise<void> | null = null;
  const ensureOriginDefaultBranchFetched = (): Promise<void> => {
    failedNoPrFetchPromise ??= (deps.fetchOriginDefaultBranch ?? fetchOriginDefaultBranch)(config);
    return failedNoPrFetchPromise;
  };

  for (const record of Object.values(state.issues)) {
    if (record.state !== "failed") {
      continue;
    }

    await updateReconciliationProgress?.({
      targetIssueNumber: record.issue_number,
      targetPrNumber: record.pr_number,
      waitStep: null,
    });

    let issue = issuesByNumber.get(record.issue_number);
    if (!issue) {
      try {
        issue = await github.getIssue(record.issue_number);
      } catch {
        issue = undefined;
      }
      if (issue) {
        issuesByNumber.set(record.issue_number, issue);
      }
    }
    const issueState = issue?.state ?? null;
    issueStateByNumber.set(record.issue_number, issueState);

    if (issueState !== "OPEN") {
      continue;
    }

    if (record.pr_number === null) {
      if (issue && shouldReconsiderGenericNoPrIssueDefinitionChange(record, issue)) {
        const recoveryEvent = buildRecoveryEvent(
          record.issue_number,
          `github_issue_definition_changed: requeued issue #${record.issue_number} after a material GitHub issue definition change invalidated the stale no-PR ${record.state} state`,
        );
        const updated = stateStore.touch(record, {
          state: "queued",
          blocked_reason: null,
          last_error: null,
          last_failure_kind: null,
          last_failure_context: null,
          last_blocker_signature: null,
          last_failure_signature: null,
          repeated_failure_signature_count: 0,
          stale_stabilizing_no_pr_recovery_count: 0,
          codex_session_id: null,
          ...issueDefinitionFreshnessPatch(issue),
          ...applyRecoveryEvent({}, recoveryEvent),
        });
        state.issues[String(record.issue_number)] = updated;
        changed = true;
        continue;
      }

      if (await reconcileStaleFailedNoPrRecord({
        github,
        stateStore,
        state,
        config,
        record,
        issueStateByNumber,
        ensureOriginDefaultBranchFetched,
        buildRecoveryEvent,
        applyRecoveryEvent,
      })) {
        changed = true;
      }
      continue;
    }

    if (await reconcileStaleFailedTrackedPrRecord(
      github,
      stateStore,
      state,
      config,
      record,
      deps,
      {
        buildRecoveryEvent,
        applyRecoveryEvent,
      },
      updateReconciliationProgress,
    )) {
      changed = true;
    }
  }

  if (changed) {
    await stateStore.save(state);
  }
}

export async function reconcileStaleDoneIssueStates(
  github: Pick<RecoveryGitHubLike, "getIssue">,
  stateStore: StateStoreLike,
  state: SupervisorStateFile,
  issues: GitHubIssue[],
): Promise<RecoveryEvent[]> {
  let changed = false;
  const recoveryEvents: RecoveryEvent[] = [];
  const issueStateByNumber = new Map(issues.map((issue) => [issue.number, issue.state ?? null]));

  const downgradeToManualReview = (
    record: IssueRunRecord,
    failureContext: NonNullable<IssueRunRecord["last_failure_context"]>,
    reason: string,
  ): void => {
    const recoveryEvent = buildRecoveryEvent(record.issue_number, reason);
    const updated = stateStore.touch(
      record,
      applyRecoveryEvent({
        state: "blocked",
        blocked_reason: "manual_review",
        codex_session_id: null,
        last_error: truncate(failureContext.summary, 1000),
        last_failure_kind: null,
        last_failure_context: failureContext,
        last_blocker_signature: null,
        last_failure_signature: null,
        repeated_failure_signature_count: 0,
        stale_stabilizing_no_pr_recovery_count: 0,
      }, recoveryEvent),
    );
    state.issues[String(record.issue_number)] = updated;
    if (state.activeIssueNumber === record.issue_number) {
      state.activeIssueNumber = null;
    }
    changed = true;
    recoveryEvents.push(recoveryEvent);
  };

  for (const record of Object.values(state.issues)) {
    if (record.state !== "done" || !shouldReconsiderNoPrDoneRecord(record)) {
      continue;
    }

    let issueState = issueStateByNumber.get(record.issue_number) ?? null;
    if (!issueStateByNumber.has(record.issue_number)) {
      try {
        issueState = (await github.getIssue(record.issue_number)).state ?? null;
      } catch {
        const failureContext = buildUnsafeNoPrFailureContext({
          issueNumber: record.issue_number,
          localState: "done",
          githubIssueState: "UNKNOWN",
          detail: "The stale no-PR done record was downgraded to manual review because GitHub revalidation failed and the supervisor cannot safely preserve a terminal local state.",
        });
        downgradeToManualReview(
          record,
          failureContext,
          `stale_done_revalidation_failed_manual_review: blocked issue #${record.issue_number} after GitHub revalidation failed for a no-PR done record with no authoritative completion signal`,
        );
        continue;
      }
      issueStateByNumber.set(record.issue_number, issueState);
    }

    if (issueState !== "OPEN") {
      continue;
    }

    const failureContext = buildUnsafeNoPrFailureContext({
      issueNumber: record.issue_number,
      localState: "done",
      githubIssueState: "OPEN",
      detail: "The stale no-PR done record was downgraded to manual review so the supervisor does not treat the issue as complete.",
    });
    downgradeToManualReview(
      record,
      failureContext,
      `stale_done_manual_review: blocked issue #${record.issue_number} after reconsidering an open no-PR done record with no authoritative completion signal`,
    );
  }

  if (changed) {
    await stateStore.save(state);
  }

  return recoveryEvents;
}

export async function reconcileRecoverableBlockedIssueStates(
  github: Pick<RecoveryGitHubLike, "getPullRequestIfExists" | "getIssue" | "getChecks" | "getUnresolvedReviewThreads">
    & Partial<Pick<RecoveryGitHubLike, "getIssueComments" | "updateIssueComment">>,
  stateStore: StateStoreLike,
  state: SupervisorStateFile,
  config: SupervisorConfig,
  issues: GitHubIssue[],
  deps: {
    shouldAutoRetryHandoffMissing: (record: IssueRunRecord, config: SupervisorConfig) => boolean;
    inferStateFromPullRequest?: typeof inferStateFromPullRequest;
    inferFailureContext?: typeof inferFailureContext;
    blockedReasonForLifecycleState?: typeof blockedReasonForLifecycleState;
    isOpenPullRequest?: typeof isOpenPullRequest;
    syncReviewWaitWindow?: typeof syncReviewWaitWindow;
    syncCopilotReviewRequestObservation?: typeof syncCopilotReviewRequestObservation;
    syncCopilotReviewTimeoutState?: typeof syncCopilotReviewTimeoutState;
  },
  options: {
    onlyTrackedPrStates?: boolean;
  } = {},
): Promise<RecoveryEvent[]> {
  let changed = false;
  const recoveryEvents: RecoveryEvent[] = [];
  const issuesByNumber = new Map(issues.map((issue) => [issue.number, issue]));
  const inferStateFromPullRequestImpl = deps.inferStateFromPullRequest ?? inferStateFromPullRequest;
  const inferFailureContextImpl = deps.inferFailureContext ?? inferFailureContext;
  const blockedReasonForLifecycleStateImpl =
    deps.blockedReasonForLifecycleState ?? blockedReasonForLifecycleState;
  const isOpenPullRequestImpl = deps.isOpenPullRequest ?? isOpenPullRequest;
  const syncReviewWaitWindowImpl = deps.syncReviewWaitWindow ?? syncReviewWaitWindow;
  const syncCopilotReviewRequestObservationImpl =
    deps.syncCopilotReviewRequestObservation ?? syncCopilotReviewRequestObservation;
  const syncCopilotReviewTimeoutStateImpl =
    deps.syncCopilotReviewTimeoutState ?? syncCopilotReviewTimeoutState;

  for (const record of Object.values(state.issues)) {
    if (record.state !== "blocked") {
      continue;
    }
    if (options.onlyTrackedPrStates && record.pr_number === null) {
      continue;
    }

    let issue = issuesByNumber.get(record.issue_number);
    if (!issue && record.pr_number !== null) {
      try {
        issue = await github.getIssue(record.issue_number);
      } catch {
        issue = undefined;
      }
    }

    if (!issue || issue.state !== "OPEN") {
      continue;
    }

    if (deps.shouldAutoRetryHandoffMissing(record, config)) {
      const recoveryEvent = buildRecoveryEvent(
        record.issue_number,
        `stale_state_cleanup: requeued issue #${record.issue_number} after recovering a missing handoff`,
      );
      const updated = stateStore.touch(record, {
        state: "queued",
        blocked_reason: null,
        last_error: null,
        last_failure_kind: null,
        last_blocker_signature: null,
        codex_session_id: null,
        review_wait_started_at: null,
        review_wait_head_sha: null,
        copilot_review_requested_observed_at: null,
        copilot_review_requested_head_sha: null,
        copilot_review_timed_out_at: null,
        copilot_review_timeout_action: null,
        copilot_review_timeout_reason: null,
        ...applyRecoveryEvent({}, recoveryEvent),
      });
      state.issues[String(record.issue_number)] = updated;
      changed = true;
      recoveryEvents.push(recoveryEvent);
      continue;
    }

    if (shouldReconsiderBlockedNoPrStaleManualStop(record, issue)) {
      const recoveryEvent = buildRecoveryEvent(
        record.issue_number,
        `github_issue_reconsidered: requeued issue #${record.issue_number} after GitHub issue updates arrived following a stale no-PR manual stop`,
      );
      const updated = stateStore.touch(record, {
        state: "queued",
        blocked_reason: null,
        last_error: null,
        last_failure_kind: null,
        last_failure_context: null,
        last_blocker_signature: null,
        last_failure_signature: null,
        repeated_failure_signature_count: 0,
        stale_stabilizing_no_pr_recovery_count: 0,
        codex_session_id: null,
        ...applyRecoveryEvent({}, recoveryEvent),
      });
      state.issues[String(record.issue_number)] = updated;
      changed = true;
      recoveryEvents.push(recoveryEvent);
      continue;
    }

    if (shouldReconsiderGenericNoPrIssueDefinitionChange(record, issue)) {
      const recoveryEvent = buildRecoveryEvent(
        record.issue_number,
        `github_issue_definition_changed: requeued issue #${record.issue_number} after a material GitHub issue definition change invalidated the stale no-PR ${record.state} state`,
      );
      const updated = stateStore.touch(record, {
        state: "queued",
        blocked_reason: null,
        last_error: null,
        last_failure_kind: null,
        last_failure_context: null,
        last_blocker_signature: null,
        last_failure_signature: null,
        repeated_failure_signature_count: 0,
        stale_stabilizing_no_pr_recovery_count: 0,
        codex_session_id: null,
        ...issueDefinitionFreshnessPatch(issue),
        ...applyRecoveryEvent({}, recoveryEvent),
      });
      state.issues[String(record.issue_number)] = updated;
      changed = true;
      recoveryEvents.push(recoveryEvent);
      continue;
    }

    if (
      record.state === "blocked" &&
      record.blocked_reason === "handoff_missing" &&
      record.pr_number !== null
    ) {
      const trackedPullRequest = await github.getPullRequestIfExists(record.pr_number);
      if (!trackedPullRequest || trackedPullRequest.state !== "OPEN" || trackedPullRequest.mergedAt || !mergeConflictDetected(trackedPullRequest)) {
        continue;
      }

      const recoveryEvent = buildTrackedPrResumeRecoveryEvent(
        record,
        trackedPullRequest,
        "resolving_conflict",
        buildRecoveryEvent,
      );
      const headAdvanceResetPatch = resetTrackedPrHeadScopedStateOnAdvance(record, trackedPullRequest.headRefOid);
      const headAdvanced = Object.keys(headAdvanceResetPatch).length > 0;
      const failureSignatureBaseRecord = headAdvanced
        ? {
          ...record,
          last_failure_signature: null,
          repeated_failure_signature_count: 0,
        }
        : record;
      const updated = stateStore.touch(record, applyRecoveryEvent({
        state: "resolving_conflict",
        blocked_reason: null,
        last_error: null,
        last_failure_kind: null,
        last_failure_context: null,
        last_blocker_signature: null,
        ...applyFailureSignature(failureSignatureBaseRecord, null),
        repeated_blocker_count: 0,
        repair_attempt_count: 0,
        timeout_retry_count: 0,
        blocked_verification_retry_count: 0,
        codex_session_id: null,
        pr_number: trackedPullRequest.number,
        last_head_sha: trackedPullRequest.headRefOid,
        ...headAdvanceResetPatch,
      }, recoveryEvent));
      state.issues[String(record.issue_number)] = updated;
      changed = true;
      recoveryEvents.push(recoveryEvent);
      continue;
    }

    if (
      record.pr_number !== null &&
      (
        record.blocked_reason === null ||
        record.blocked_reason === "manual_review" ||
        record.blocked_reason === "verification" ||
        shouldReconcileTrackedPrStaleReviewBot(record, config)
      )
    ) {
      const trackedPullRequest = await github.getPullRequestIfExists(record.pr_number);
      if (!trackedPullRequest || !isOpenPullRequestImpl(trackedPullRequest)) {
        continue;
      }

      const checks = await github.getChecks(trackedPullRequest.number);
      const reviewThreads = await github.getUnresolvedReviewThreads(trackedPullRequest.number);
      const projection = projectTrackedPrLifecycle({
        config,
        record,
        pr: trackedPullRequest,
        checks,
        reviewThreads,
        inferStateFromPullRequest: inferStateFromPullRequestImpl,
        blockedReasonForLifecycleState: blockedReasonForLifecycleStateImpl,
        syncReviewWaitWindow: syncReviewWaitWindowImpl,
        syncCopilotReviewRequestObservation: syncCopilotReviewRequestObservationImpl,
        syncCopilotReviewTimeoutState: syncCopilotReviewTimeoutStateImpl,
      });
      const nextState = projection.nextState;
      if (projection.shouldSuppressRecovery) {
        continue;
      }

      const inferredFailureContext =
        nextState === "blocked"
        || (
          nextState === "draft_pr"
          && record.blocked_reason === "verification"
          && trackedPullRequest.isDraft
        )
          ? inferFailureContextImpl(config, projection.recordForState, trackedPullRequest, checks, reviewThreads)
          : null;
      const preserveDraftReadyPromotionBlocker =
        nextState === "draft_pr"
        && record.blocked_reason === "verification"
        && trackedPullRequest.isDraft
        && (
          inferredFailureContext !== null ||
          hasFreshTrackedPrReadyPromotionBlockerEvidence(record, trackedPullRequest)
        );
      const failureContext =
        inferredFailureContext
        ?? (preserveDraftReadyPromotionBlocker ? record.last_failure_context : null);
      const nextBlockedReason = preserveDraftReadyPromotionBlocker
        ? "verification"
        : projection.nextBlockedReason;

      if (nextState === "blocked" || preserveDraftReadyPromotionBlocker) {
        const headAdvanceResetPatch = resetTrackedPrHeadScopedStateOnAdvance(record, trackedPullRequest.headRefOid);
        const headAdvanced = Object.keys(headAdvanceResetPatch).length > 0;
        const blockerSemanticsChanged =
          headAdvanced
          || nextBlockedReason !== record.blocked_reason
          || (failureContext?.signature ?? null) !== record.last_failure_signature;
        const failureSignatureBaseRecord = headAdvanced
          ? {
            ...record,
            last_failure_signature: null,
            repeated_failure_signature_count: 0,
          }
          : record;
        const failureSignaturePatch =
          preserveDraftReadyPromotionBlocker && !blockerSemanticsChanged
            ? {
              last_failure_signature: record.last_failure_signature,
              repeated_failure_signature_count: record.repeated_failure_signature_count,
            }
            : applyFailureSignature(failureSignatureBaseRecord, failureContext);
        const blockedPatch: Partial<IssueRunRecord> = {
          state: "blocked",
          last_error: failureContext ? truncate(failureContext.summary, 1000) : null,
          last_failure_kind: null,
          last_failure_context: failureContext,
          last_blocker_signature: null,
          ...failureSignaturePatch,
          blocked_reason: nextBlockedReason,
          pr_number: trackedPullRequest.number,
          last_head_sha: trackedPullRequest.headRefOid,
          ...headAdvanceResetPatch,
          ...projection.reviewWaitPatch,
          ...projection.copilotReviewRequestObservationPatch,
          ...projection.copilotReviewTimeoutPatch,
        };
        const nextPatch = blockerSemanticsChanged
          ? {
            ...blockedPatch,
            repeated_blocker_count: 0,
            repair_attempt_count: 0,
            timeout_retry_count: 0,
            blocked_verification_retry_count: 0,
          }
          : blockedPatch;

        if (needsRecordUpdate(record, nextPatch)) {
          const updated = stateStore.touch(record, nextPatch);
          state.issues[String(record.issue_number)] = updated;
          changed = true;
        }
        continue;
      }

      const patch = buildTrackedPrStaleFailureConvergencePatch({
        record,
        pr: trackedPullRequest,
        nextState,
        failureContext,
        blockedReason: nextBlockedReason,
        reviewWaitPatch: projection.reviewWaitPatch,
        copilotReviewRequestObservationPatch: projection.copilotReviewRequestObservationPatch,
        copilotReviewTimeoutPatch: projection.copilotReviewTimeoutPatch,
      });
      const recoveryEvent = buildTrackedPrResumeRecoveryEvent(
        record,
        trackedPullRequest,
        nextState,
        buildRecoveryEvent,
      );
      const updated = stateStore.touch(record, applyRecoveryEvent(patch, recoveryEvent));
      state.issues[String(record.issue_number)] = updated;
      changed = true;
      recoveryEvents.push(recoveryEvent);
      continue;
    }

    if (record.state === "blocked" && record.blocked_reason === "requirements") {
      if (!hasAvailableIssueLabels(issue)) {
        continue;
      }

      const readiness = lintExecutionReadyIssueBody(issue);
      if (!readiness.isExecutionReady) {
        continue;
      }

      const recoveryEvent = buildRecoveryEvent(
        record.issue_number,
        `requirements_recovered: requeued issue #${record.issue_number} after execution-ready metadata was added`,
      );
      const updated = stateStore.touch(record, {
        state: "queued",
        blocked_reason: null,
        last_error: null,
        last_failure_kind: null,
        last_failure_context: null,
        last_blocker_signature: null,
        last_failure_signature: null,
        repeated_failure_signature_count: 0,
        ...applyRecoveryEvent({}, recoveryEvent),
      });
      state.issues[String(record.issue_number)] = updated;
      changed = true;
      await clearRequirementsBlockerIssueComment(github, record.issue_number, issue.updatedAt);
      recoveryEvents.push(recoveryEvent);
      continue;
    }

    if (record.state === "blocked" && record.blocked_reason === "clarification") {
      if (findHighRiskBlockingAmbiguity(issue)) {
        continue;
      }

      const recoveryEvent = buildRecoveryEvent(
        record.issue_number,
        `clarification_recovered: requeued issue #${record.issue_number} after blocking ambiguity was resolved`,
      );
      const updated = stateStore.touch(record, {
        state: "queued",
        blocked_reason: null,
        last_error: null,
        last_failure_kind: null,
        last_failure_context: null,
        last_blocker_signature: null,
        last_failure_signature: null,
        repeated_failure_signature_count: 0,
        ...applyRecoveryEvent({}, recoveryEvent),
      });
      state.issues[String(record.issue_number)] = updated;
      changed = true;
      recoveryEvents.push(recoveryEvent);
    }
  }

  if (changed) {
    await stateStore.save(state);
  }

  return recoveryEvents;
}

export async function reconcileParentEpicClosures(
  github: RecoveryGitHubLike,
  stateStore: StateStoreLike,
  state: SupervisorStateFile,
  issues: GitHubIssue[],
): Promise<RecoveryEvent[]> {
  const parentIssuesReadyToClose = findParentIssuesReadyToClose(issues);
  if (parentIssuesReadyToClose.length === 0) {
    return [];
  }

  let changed = false;
  const recoveryEvents: RecoveryEvent[] = [];

  for (const { parentIssue, childIssues } of parentIssuesReadyToClose) {
    const childIssueNumbers = childIssues
      .map((childIssue) => `#${childIssue.number}`)
      .sort((left, right) => Number(left.slice(1)) - Number(right.slice(1)));
    const recoveryEvent = buildRecoveryEvent(
      parentIssue.number,
      `parent_epic_auto_closed: auto-closed parent epic #${parentIssue.number} because child issues ${childIssueNumbers.join(", ")} are closed`,
    );

    await github.closeIssue(
      parentIssue.number,
      `Closed automatically because all child issues are closed: ${childIssueNumbers.join(", ")}.`,
    );
    recoveryEvents.push(recoveryEvent);

    const existingRecord = state.issues[String(parentIssue.number)];
    if (existingRecord) {
      const patch = applyRecoveryEvent(doneResetPatch(), recoveryEvent);
      if (needsRecordUpdate(existingRecord, patch)) {
        const updated = stateStore.touch(existingRecord, patch);
        state.issues[String(parentIssue.number)] = updated;
        changed = true;
      }
      if (state.activeIssueNumber === parentIssue.number) {
        state.activeIssueNumber = null;
        changed = true;
      }
    } else {
      const created = stateStore.touch(
        createUntrackedRecoveredDoneRecord(parentIssue.number),
        applyRecoveryEvent(doneResetPatch(), recoveryEvent),
      );
      state.issues[String(parentIssue.number)] = created;
      changed = true;
    }
  }

  if (changed) {
    await stateStore.save(state);
  }

  return recoveryEvents;
}

export async function reconcileStaleActiveIssueReservation(args: {
  stateStore: StateStoreLike;
  state: SupervisorStateFile;
  issueLockPath: (issueNumber: number) => string;
  sessionLockPath: (sessionId: string) => string;
  sameFailureSignatureRepeatLimit?: number;
  resolvePullRequestForBranch?: (branch: string, trackedPrNumber: number | null) => Promise<import("./core/types").GitHubPullRequest | null>;
  classifyStaleStabilizingNoPrBranchState?: (
    record: IssueRunRecord,
  ) => Promise<StaleStabilizingNoPrBranchState>;
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
      ? await detectDurableTurnUpdateSince(record, interruptedTurnMarker)
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
    const recoveryEvent = buildRecoveryEvent(
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
      applyRecoveryEvent(patch, recoveryEvent),
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
  const shouldRequeueStabilizing = record.state === "stabilizing" && matchedPullRequest === null;
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

  const recoveryEvent = buildRecoveryEvent(
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
    applyRecoveryEvent(patch, recoveryEvent),
  );
  args.state.activeIssueNumber = null;
  await args.stateStore.save(args.state);
  if (interruptedTurnMarker) {
    await clearInterruptedTurnMarker(record.workspace);
  }
  recoveryEvents.push(recoveryEvent);
  return recoveryEvents;
}

export type { StateStoreLike };
