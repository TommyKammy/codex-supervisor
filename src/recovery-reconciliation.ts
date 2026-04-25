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
  hasAvailableIssueLabels,
  lintExecutionReadyIssueBody,
} from "./issue-metadata";
import { buildIssueDefinitionFingerprint, issueDefinitionFreshnessPatch } from "./issue-definition-freshness";
import { RecoveryEvent } from "./run-once-cycle-prelude";
import { StateStore } from "./core/state-store";
import { GitHubIssue, IssueRunRecord, PullRequestCheck, ReviewThread, RunState, SupervisorConfig, SupervisorStateFile } from "./core/types";
import { nowIso, truncate } from "./core/utils";
import { resetTrackedPrHeadScopedStateOnAdvance } from "./tracked-pr-lifecycle-projection";
import {
  buildSupervisorMutationRecordSnapshot,
  type SupervisorMutationRecordSnapshotDto,
  type SupervisorMutationResultDto,
} from "./supervisor/supervisor-mutation-report";
import { STALE_STABILIZING_NO_PR_RECOVERY_SIGNATURE } from "./no-pull-request-state";
import { applyFailureSignature } from "./supervisor/supervisor-failure-helpers";
import {
  doneResetPatch,
  sanitizeRecoveryReason,
} from "./recovery-support";
import { reconcileStaleFailedNoPrRecord } from "./recovery-no-pr-reconciliation";
import { reconcileStaleActiveIssueReservationInModule } from "./recovery-active-reconciliation";
import {
  reconcileMergedIssueClosuresInModule,
  reconcileStaleDoneIssueStatesInModule,
} from "./recovery-historical-reconciliation";
import { reconcileParentEpicClosuresInModule } from "./recovery-parent-epic-reconciliation";
import {
  buildTrackedPrResumeRecoveryEvent,
  reconcileStaleFailedTrackedPrRecord,
  reconcileTrackedMergedButOpenIssuesInModule,
  suppressSameHeadNoProgressReviewThreadRecovery,
} from "./recovery-tracked-pr-reconciliation";
export {
  inspectOrphanedWorkspacePruneCandidates,
  pruneOrphanedWorkspacesForOperator,
  type OrphanedWorkspacePruneCandidate,
  type OrphanedWorkspacePruneEligibility,
} from "./recovery-workspace-reconciliation";
import { cleanupExpiredDoneWorkspaces as cleanupExpiredDoneWorkspacesInModule } from "./recovery-workspace-reconciliation";
import { buildTrackedPrStaleFailureConvergencePatch } from "./recovery-tracked-pr-support";
import { mergeConflictDetected } from "./supervisor/supervisor-status-rendering";
import { projectTrackedPrLifecycle } from "./tracked-pr-lifecycle-projection";
import { hasFreshTrackedPrReadyPromotionBlockerEvidence } from "./tracked-pr-ready-promotion-blocker";
import { clearRequirementsBlockerIssueComment } from "./requirements-blocker-issue-comment";

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

function needsRecordUpdate(record: IssueRunRecord, patch: Partial<IssueRunRecord>): boolean {
  for (const [key, value] of Object.entries(patch)) {
    const recordValue = record[key as keyof IssueRunRecord];
    if (JSON.stringify(recordValue) !== JSON.stringify(value)) {
      return true;
    }
  }

  return false;
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
  const clearVerificationDiagnostics = record.blocked_reason === "verification";
  const updated = stateStore.touch(record, applyRecoveryEvent({
    state: "queued",
    codex_session_id: null,
    blocked_reason: null,
    last_error: clearVerificationDiagnostics ? null : record.last_error,
    last_failure_kind: clearVerificationDiagnostics ? null : record.last_failure_kind,
    last_failure_context: clearVerificationDiagnostics ? null : record.last_failure_context,
    last_blocker_signature: clearVerificationDiagnostics ? null : record.last_blocker_signature,
    last_failure_signature: clearVerificationDiagnostics ? null : record.last_failure_signature,
    timeout_retry_count: clearVerificationDiagnostics ? 0 : record.timeout_retry_count,
    blocked_verification_retry_count: clearVerificationDiagnostics ? 0 : record.blocked_verification_retry_count,
    repeated_blocker_count: clearVerificationDiagnostics ? 0 : record.repeated_blocker_count,
    repeated_failure_signature_count: clearVerificationDiagnostics ? 0 : record.repeated_failure_signature_count,
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
  updateReconciliationProgress: ((patch: {
    targetIssueNumber?: number | null;
    targetPrNumber?: number | null;
    waitStep?: string | null;
  }) => Promise<void>) | null = null,
  options: {
    maxRecords?: number | null;
  } = {},
): Promise<RecoveryEvent[]> {
  return reconcileMergedIssueClosuresInModule(
    github,
    stateStore,
    state,
    config,
    issues,
    {
      buildRecoveryEvent,
      applyRecoveryEvent,
      needsRecordUpdate,
    },
    updateReconciliationProgress,
    options,
  );
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
): Promise<RecoveryEvent[]> {
  let changed = false;
  const recoveryEvents: RecoveryEvent[] = [];
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
        recoveryEvents.push(recoveryEvent);
        continue;
      }

      const noPrRecoveryEvent = await reconcileStaleFailedNoPrRecord({
        github,
        stateStore,
        state,
        config,
        record,
        issueStateByNumber,
        ensureOriginDefaultBranchFetched,
        buildRecoveryEvent,
        applyRecoveryEvent,
      });
      if (noPrRecoveryEvent !== null) {
        changed = true;
        recoveryEvents.push(noPrRecoveryEvent);
      }
      continue;
    }

    const trackedPrRecoveryEvent = await reconcileStaleFailedTrackedPrRecord(
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
    );
    if (trackedPrRecoveryEvent !== null) {
      changed = true;
      recoveryEvents.push(trackedPrRecoveryEvent);
    }
  }

  if (changed) {
    await stateStore.save(state);
  }

  return recoveryEvents;
}

export async function reconcileStaleDoneIssueStates(
  github: Pick<RecoveryGitHubLike, "getIssue">,
  stateStore: StateStoreLike,
  state: SupervisorStateFile,
  issues: GitHubIssue[],
): Promise<RecoveryEvent[]> {
  return reconcileStaleDoneIssueStatesInModule(
    github,
    stateStore,
    state,
    issues,
    {
      buildRecoveryEvent,
      applyRecoveryEvent,
    },
  );
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
      const recoverySuppression = suppressSameHeadNoProgressReviewThreadRecovery(
        record,
        trackedPullRequest,
        reviewThreads,
        nextState,
      );
      if (recoverySuppression.shouldSuppress) {
        const suppressionPatch: Partial<IssueRunRecord> = {
          last_tracked_pr_progress_summary: recoverySuppression.progressSummary,
        };
        if (needsRecordUpdate(record, suppressionPatch)) {
          const updated = stateStore.touch(record, suppressionPatch);
          state.issues[String(record.issue_number)] = updated;
          changed = true;
        }
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
      if (recoverySuppression.progressSummary !== null) {
        patch.last_tracked_pr_progress_summary = recoverySuppression.progressSummary;
      }
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
  return reconcileParentEpicClosuresInModule(
    github,
    stateStore,
    state,
    issues,
    {
      buildRecoveryEvent,
      applyRecoveryEvent,
      createRecoveredDoneRecord: createUntrackedRecoveredDoneRecord,
      needsRecordUpdate,
    },
  );
}

export async function reconcileStaleActiveIssueReservation(args: {
  config?: Pick<SupervisorConfig, "issueJournalRelativePath" | "workspaceRoot">;
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
  return reconcileStaleActiveIssueReservationInModule({
    ...args,
    buildRecoveryEvent,
    applyRecoveryEvent,
  });
}

export type { StateStoreLike };
