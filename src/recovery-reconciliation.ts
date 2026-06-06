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
import { buildIssueDefinitionFingerprint, issueDefinitionFreshnessPatch } from "./issue-definition-freshness";
import { RecoveryEvent } from "./run-once-cycle-prelude";
import { StateStore } from "./core/state-store";
import { GitHubIssue, IssueRunRecord, PullRequestCheck, ReviewThread, RunState, SupervisorConfig, SupervisorStateFile } from "./core/types";
import { nowIso, truncate } from "./core/utils";
import {
  buildSupervisorMutationRecordSnapshot,
  type SupervisorMutationRecordSnapshotDto,
  type SupervisorMutationResultDto,
} from "./supervisor/supervisor-mutation-report";
import { STALE_STABILIZING_NO_PR_RECOVERY_SIGNATURE } from "./no-pull-request-state";
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
  reconcileStaleFailedTrackedPrRecord,
  reconcileTrackedMergedButOpenIssuesInModule,
} from "./recovery-tracked-pr-reconciliation";
import {
  codexConnectorChurnStopEvidenceSource,
  reconcileRecoverableBlockedIssueStatesInModule,
} from "./recovery-blocked-issue-reconciliation";
export {
  inspectOrphanedWorkspacePruneCandidates,
  pruneOrphanedWorkspacesForOperator,
  type OrphanedWorkspacePruneCandidate,
  type OrphanedWorkspacePruneEligibility,
} from "./recovery-workspace-reconciliation";
import { cleanupExpiredDoneWorkspaces as cleanupExpiredDoneWorkspacesInModule } from "./recovery-workspace-reconciliation";

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
> & Partial<
  Pick<import("./github").GitHubClient, "addIssueComment" | "getExternalReviewSurface" | "getIssueComments" | "updateIssueComment">
>;

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
  action: SupervisorMutationResultDto["action"],
  issueNumber: number,
  previousState: RunState | null,
  previousRecordSnapshot: SupervisorMutationRecordSnapshotDto | null,
  summary: string,
): SupervisorMutationResultDto {
  return {
    action,
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
      "requeue",
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
      "requeue",
      issueNumber,
      previousState,
      previousRecordSnapshot,
      `Rejected requeue for issue #${issueNumber}: active issue reservations cannot be mutated.`,
    );
  }

  if (record.pr_number !== null) {
    return buildRejectedMutationResult(
      "requeue",
      issueNumber,
      previousState,
      previousRecordSnapshot,
      `Rejected requeue for issue #${issueNumber}: tracked PR work cannot be requeued explicitly.`,
    );
  }

  if (!OPERATOR_REQUEUEABLE_STATES.has(record.state)) {
    return buildRejectedMutationResult(
      "requeue",
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

function isCodexConnectorChurnLatchRecord(
  record: Pick<
    IssueRunRecord,
    | "blocked_reason"
    | "codex_connector_stable_churn_dossier_consumed_signature"
    | "last_tracked_pr_progress_snapshot"
    | "last_tracked_pr_progress_summary"
    | "last_tracked_pr_repeat_failure_decision"
    | "pr_number"
    | "state"
  >,
): boolean {
  return (
    record.state === "blocked" &&
    record.blocked_reason === "manual_review" &&
    record.pr_number !== null &&
    record.last_tracked_pr_repeat_failure_decision === "stop_no_progress" &&
    typeof record.codex_connector_stable_churn_dossier_consumed_signature === "string" &&
    record.codex_connector_stable_churn_dossier_consumed_signature.length > 0 &&
    codexConnectorChurnStopEvidenceSource(record) !== null
  );
}

export async function releaseCodexConnectorChurnLatchForOperator(
  stateStore: StateStoreLike,
  state: SupervisorStateFile,
  issueNumber: number,
): Promise<SupervisorMutationResultDto> {
  const record = state.issues[String(issueNumber)];
  if (!record) {
    return buildRejectedMutationResult(
      "release-codex-churn-latch",
      issueNumber,
      null,
      null,
      `Rejected Codex Connector churn latch release for issue #${issueNumber}: the issue is not tracked in supervisor state.`,
    );
  }

  const previousRecordSnapshot = buildSupervisorMutationRecordSnapshot(record);
  const previousState = previousRecordSnapshot.state;

  if (state.activeIssueNumber === issueNumber) {
    return buildRejectedMutationResult(
      "release-codex-churn-latch",
      issueNumber,
      previousState,
      previousRecordSnapshot,
      `Rejected Codex Connector churn latch release for issue #${issueNumber}: active issue reservations cannot be mutated.`,
    );
  }

  if (!isCodexConnectorChurnLatchRecord(record)) {
    return buildRejectedMutationResult(
      "release-codex-churn-latch",
      issueNumber,
      previousState,
      previousRecordSnapshot,
      `Rejected Codex Connector churn latch release for issue #${issueNumber}: no blocked current-head Codex Connector churn latch is active.`,
    );
  }

  const recoveryEvent = buildRecoveryEvent(
    issueNumber,
    `operator_release_codex_churn_latch: cleared current-head Codex Connector churn latch for issue #${issueNumber}`,
  );
  const updated = stateStore.touch(record, applyRecoveryEvent({
    state: "waiting_ci",
    blocked_reason: null,
    codex_connector_stable_churn_dossier_consumed_signature: null,
    last_tracked_pr_progress_summary: null,
    last_tracked_pr_repeat_failure_decision: null,
    last_error: null,
    last_failure_kind: null,
    last_failure_context: null,
    last_failure_signature: null,
    repeated_failure_signature_count: 0,
  }, recoveryEvent));
  state.issues[String(issueNumber)] = updated;
  await stateStore.save(state);

  return {
    action: "release-codex-churn-latch",
    issueNumber,
    outcome: "mutated",
    summary: `Released Codex Connector churn latch for issue #${issueNumber}; supervisor may retry after operator intervention.`,
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
    & Partial<Pick<RecoveryGitHubLike, "addIssueComment" | "getExternalReviewSurface" | "getIssueComments" | "updateIssueComment">>,
  stateStore: StateStoreLike,
  state: SupervisorStateFile,
  config: SupervisorConfig,
  issues: GitHubIssue[],
  deps: Parameters<typeof reconcileRecoverableBlockedIssueStatesInModule>[5],
  options: Parameters<typeof reconcileRecoverableBlockedIssueStatesInModule>[6] = {},
): Promise<RecoveryEvent[]> {
  return reconcileRecoverableBlockedIssueStatesInModule(
    github,
    stateStore,
    state,
    config,
    issues,
    deps,
    options,
  );
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
  config?: Pick<SupervisorConfig, "issueJournalRelativePath" | "workspaceRoot"> & Partial<Pick<SupervisorConfig, "defaultBranch">>;
  stateStore: StateStoreLike;
  state: SupervisorStateFile;
  issueLockPath: (issueNumber: number) => string;
  sessionLockPath: (sessionId: string) => string;
  sameFailureSignatureRepeatLimit?: number;
  resolvePullRequestForBranch?: (
    branch: string,
    trackedPrNumber: number | null,
    options?: { purpose?: "status" | "action" },
  ) => Promise<import("./core/types").GitHubPullRequest | null>;
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
