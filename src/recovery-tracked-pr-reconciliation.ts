import {
  type GitHubIssue,
  type GitHubPullRequest,
  type IssueRunRecord,
  type PullRequestCheck,
  type ReviewThread,
  type SupervisorConfig,
  type SupervisorStateFile,
} from "./core/types";
import { type StateStore } from "./core/state-store";
import { type RecoveryEvent } from "./run-once-cycle-prelude";
import {
  executionMetricsRetentionRootPath,
  syncExecutionMetricsRunSummarySafely,
} from "./supervisor/execution-metrics-run-summary";
import { syncPostMergeAuditArtifactSafely } from "./supervisor/post-merge-audit-artifact";
import { buildTrackedPrStaleFailureConvergencePatch } from "./recovery-tracked-pr-support";
import { projectTrackedPrLifecycle } from "./tracked-pr-lifecycle-projection";
import { inferGitHubWaitStep, inferStateFromPullRequest } from "./pull-request-state";
import {
  syncCopilotReviewRequestObservation,
  syncCopilotReviewTimeoutState,
  syncReviewWaitWindow,
} from "./pull-request-state-sync";
import { blockedReasonForLifecycleState, isOpenPullRequest } from "./supervisor/supervisor-lifecycle";
import { inferFailureContext } from "./supervisor/supervisor-failure-context";
import { latestReviewThreadCommentFingerprint } from "./review-handling";

type RecoveryGitHubLike = Pick<
  import("./github").GitHubClient,
  | "closeIssue"
  | "getChecks"
  | "getIssue"
  | "getPullRequestIfExists"
  | "getUnresolvedReviewThreads"
>;

type StateStoreLike = Pick<StateStore, "touch" | "save">;

type BuildRecoveryEvent = (issueNumber: number, reason: string) => RecoveryEvent;
type ApplyRecoveryEvent = (
  patch: Partial<IssueRunRecord>,
  recoveryEvent: RecoveryEvent,
) => Partial<IssueRunRecord>;

const TRACKED_PR_LIFECYCLE_REFRESH_STATES = new Set<IssueRunRecord["state"]>([
  "draft_pr",
  "local_review",
  "pr_open",
  "repairing_ci",
  "resolving_conflict",
  "waiting_ci",
  "addressing_review",
  "ready_to_merge",
  "merging",
]);

function needsRecordUpdate(record: IssueRunRecord, patch: Partial<IssueRunRecord>): boolean {
  for (const [key, value] of Object.entries(patch)) {
    const recordValue = record[key as keyof IssueRunRecord];
    if (JSON.stringify(recordValue) !== JSON.stringify(value)) {
      return true;
    }
  }

  return false;
}

function matchesTrackedBranch(
  record: Pick<IssueRunRecord, "branch">,
  pr: Pick<GitHubPullRequest, "headRefName">,
): boolean {
  return pr.headRefName === record.branch;
}

function unresolvedReviewThreadIds(reviewThreads: ReviewThread[]): string[] {
  return reviewThreads
    .filter((thread) => !thread.isResolved)
    .map((thread) => thread.id)
    .sort();
}

function unresolvedReviewThreadFingerprints(reviewThreads: ReviewThread[]): string[] {
  return reviewThreads
    .filter((thread) => !thread.isResolved)
    .map((thread) => `${thread.id}#${latestReviewThreadCommentFingerprint(thread) ?? "no-comment"}`)
    .sort();
}

function parseTrackedPrProgressSnapshotThreadIds(
  snapshot: string | null | undefined,
): string[] | null {
  if (!snapshot) {
    return null;
  }

  try {
    const parsed = JSON.parse(snapshot);
    return Array.isArray(parsed?.unresolvedReviewThreadIds)
      ? parsed.unresolvedReviewThreadIds
        .filter((threadId: unknown): threadId is string => typeof threadId === "string")
        .sort()
      : null;
  } catch {
    return null;
  }
}

function parseTrackedPrProgressSnapshotThreadFingerprints(
  snapshot: string | null | undefined,
): string[] | null {
  if (!snapshot) {
    return null;
  }

  try {
    const parsed = JSON.parse(snapshot);
    return Array.isArray(parsed?.unresolvedReviewThreadFingerprints)
      ? parsed.unresolvedReviewThreadFingerprints
        .filter((fingerprint: unknown): fingerprint is string => typeof fingerprint === "string")
        .sort()
      : null;
  } catch {
    return null;
  }
}

export function suppressSameHeadNoProgressReviewThreadRecovery(
  record: Pick<
    IssueRunRecord,
    | "last_head_sha"
    | "last_failure_signature"
    | "last_tracked_pr_progress_snapshot"
    | "last_tracked_pr_repeat_failure_decision"
    | "state"
  >,
  pr: Pick<GitHubPullRequest, "headRefOid">,
  reviewThreads: ReviewThread[],
  nextState: IssueRunRecord["state"],
): {
  shouldSuppress: boolean;
  progressSummary: string | null;
} {
  if (
    record.state !== "blocked" ||
    record.last_tracked_pr_repeat_failure_decision !== "stop_no_progress" ||
    record.last_head_sha === null ||
    record.last_head_sha !== pr.headRefOid ||
    nextState === "blocked"
  ) {
    return {
      shouldSuppress: false,
      progressSummary: null,
    };
  }

  const previousThreadIds = parseTrackedPrProgressSnapshotThreadIds(record.last_tracked_pr_progress_snapshot);
  const currentThreadIds = unresolvedReviewThreadIds(reviewThreads);
  const previousThreadFingerprints = parseTrackedPrProgressSnapshotThreadFingerprints(
    record.last_tracked_pr_progress_snapshot,
  );
  const currentThreadFingerprints = unresolvedReviewThreadFingerprints(reviewThreads);
  const failureSignature = record.last_failure_signature;
  const sameThreadIds =
    previousThreadIds !== null &&
    previousThreadIds.length > 0 &&
    previousThreadIds.length === currentThreadIds.length &&
    previousThreadIds.every((threadId, index) => threadId === currentThreadIds[index]);
  const sameBlockingThread =
    typeof failureSignature === "string" && failureSignature.length > 0 && currentThreadIds.includes(failureSignature);
  const hasComparableThreadGuidanceBaseline =
    previousThreadFingerprints !== null &&
    previousThreadFingerprints.length > 0 &&
    previousThreadFingerprints.length === currentThreadFingerprints.length;
  const sameThreadGuidance =
    hasComparableThreadGuidanceBaseline &&
    previousThreadFingerprints.every((fingerprint, index) => fingerprint === currentThreadFingerprints[index]);

  if (!sameThreadIds || !sameBlockingThread) {
    return {
      shouldSuppress: false,
      progressSummary: null,
    };
  }

  if (!hasComparableThreadGuidanceBaseline) {
    return {
      shouldSuppress: true,
      progressSummary: "suppressed_same_head_same_review_thread_blocker",
    };
  }

  if (!sameThreadGuidance) {
    return {
      shouldSuppress: false,
      progressSummary: "same_review_thread_guidance_changed",
    };
  }

  return {
    shouldSuppress: true,
    progressSummary: "suppressed_same_head_same_review_thread_blocker",
  };
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
    ...state.reconciliation_state,
    tracked_merged_but_open_last_processed_issue_number: issueNumber,
  };
  return true;
}

function orderTrackedMergedButOpenRecordsForResume(
  records: IssueRunRecord[],
  lastProcessedIssueNumber: number | null,
): IssueRunRecord[] {
  const ordered = [...records].sort((left, right) => left.issue_number - right.issue_number);
  if (lastProcessedIssueNumber === null) {
    return ordered;
  }

  const nextIndex = ordered.findIndex((record) => record.issue_number > lastProcessedIssueNumber);
  if (nextIndex === -1) {
    return ordered;
  }

  return [...ordered.slice(nextIndex), ...ordered.slice(0, nextIndex)];
}

function prioritizeTrackedMergedButOpenRecords(
  records: IssueRunRecord[],
  lastProcessedIssueNumber: number | null,
): {
  records: IssueRunRecord[];
  deferredHistoricalDoneRecords: boolean;
} {
  const recoverableRecords = records.filter((record) => record.state !== "done");
  const historicalDoneRecords = records.filter((record) => record.state === "done");

  if (recoverableRecords.length > 0) {
    return {
      records: orderTrackedMergedButOpenRecordsForResume(recoverableRecords, lastProcessedIssueNumber),
      deferredHistoricalDoneRecords: historicalDoneRecords.length > 0,
    };
  }

  return {
    records: orderTrackedMergedButOpenRecordsForResume(historicalDoneRecords, lastProcessedIssueNumber),
    deferredHistoricalDoneRecords: false,
  };
}

export function buildTrackedPrResumeRecoveryEvent(
  record: Pick<IssueRunRecord, "issue_number" | "state" | "last_head_sha" | "blocked_reason">,
  pr: Pick<GitHubPullRequest, "number" | "headRefOid" | "isDraft">,
  nextState: IssueRunRecord["state"],
  buildRecoveryEvent: BuildRecoveryEvent,
): RecoveryEvent {
  const previousHead = record.last_head_sha ?? "unknown";
  const nextHead = pr.headRefOid;

  if (
    record.state === "blocked"
    && nextState === "blocked"
    && record.blocked_reason === "verification"
    && pr.isDraft
  ) {
    return buildRecoveryEvent(
      record.issue_number,
      `tracked_pr_ready_promotion_blocked: refreshed issue #${record.issue_number} while tracked PR #${pr.number} remains draft because ready-for-review promotion is blocked by a repo-owned gate at head ${nextHead}`,
    );
  }

  if (record.last_head_sha !== null && record.last_head_sha !== pr.headRefOid) {
    return buildRecoveryEvent(
      record.issue_number,
      `tracked_pr_head_advanced: resumed issue #${record.issue_number} from ${record.state} to ${nextState} after tracked PR #${pr.number} advanced from ${previousHead} to ${nextHead}`,
    );
  }

  return buildRecoveryEvent(
    record.issue_number,
    `tracked_pr_lifecycle_recovered: resumed issue #${record.issue_number} from ${record.state} to ${nextState} using fresh tracked PR #${pr.number} facts at head ${nextHead}`,
  );
}

export async function reconcileTrackedMergedButOpenIssuesInModule(
  github: Pick<
    RecoveryGitHubLike,
    "closeIssue" | "getChecks" | "getIssue" | "getPullRequestIfExists" | "getUnresolvedReviewThreads"
  >,
  stateStore: StateStoreLike,
  state: SupervisorStateFile,
  config: SupervisorConfig,
  issues: GitHubIssue[],
  helpers: {
    buildRecoveryEvent: BuildRecoveryEvent;
    applyRecoveryEvent: ApplyRecoveryEvent;
    doneResetPatch: typeof import("./recovery-support").doneResetPatch;
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
  options: {
    onlyIssueNumber?: number | null;
    maxRecords?: number | null;
  } = {},
): Promise<RecoveryEvent[]> {
  const defaultMaxRecordsPerCycle = 25;
  const maxRecordsPerCycle =
    typeof options.maxRecords === "number" && Number.isFinite(options.maxRecords) && options.maxRecords >= 1
      ? Math.floor(options.maxRecords)
      : defaultMaxRecordsPerCycle;
  let saveNeeded = false;
  const recoveryEvents: RecoveryEvent[] = [];
  const issueByNumber = new Map(issues.map((issue) => [issue.number, issue]));
  const selectedRecords = options.onlyIssueNumber === undefined || options.onlyIssueNumber === null
    ? Object.values(state.issues)
    : [state.issues[String(options.onlyIssueNumber)]].filter((record): record is IssueRunRecord => record !== undefined);
  const prBearingRecords = selectedRecords.filter((record): record is IssueRunRecord => record.pr_number !== null);
  const prioritizedRecords = options.onlyIssueNumber === undefined || options.onlyIssueNumber === null
    ? prioritizeTrackedMergedButOpenRecords(
      prBearingRecords,
      trackedMergedButOpenLastProcessedIssueNumber(state),
    )
    : {
      records: prBearingRecords,
      deferredHistoricalDoneRecords: false,
    };
  const { records, deferredHistoricalDoneRecords } = prioritizedRecords;
  let processedRecords = 0;
  let lastProcessedIssueNumber: number | null = null;

  for (const record of records) {
    if (processedRecords >= maxRecordsPerCycle) {
      break;
    }
    processedRecords += 1;
    lastProcessedIssueNumber = record.issue_number;

    await updateReconciliationProgress?.({
      targetIssueNumber: record.issue_number,
      targetPrNumber: record.pr_number,
      waitStep: null,
    });

    const trackedPrNumber = record.pr_number;
    if (trackedPrNumber === null) {
      continue;
    }

    const trackedPullRequest = await github.getPullRequestIfExists(trackedPrNumber);
    if (trackedPullRequest && !matchesTrackedBranch(record, trackedPullRequest)) {
      if (state.activeIssueNumber === record.issue_number) {
        continue;
      }

      const recoveryEvent = helpers.buildRecoveryEvent(
        record.issue_number,
        `stale_pr_context_cleanup: cleared tracked PR #${trackedPullRequest.number} because it belongs to branch ${trackedPullRequest.headRefName}`,
      );
      const updated = stateStore.touch(record, helpers.applyRecoveryEvent({
        pr_number: null,
        state: record.state === "stabilizing" ? "queued" : record.state,
      }, recoveryEvent));
      state.issues[String(record.issue_number)] = updated;
      saveNeeded = true;
      recoveryEvents.push(recoveryEvent);
      continue;
    }

    if (!trackedPullRequest || (!trackedPullRequest.mergedAt && trackedPullRequest.state !== "MERGED")) {
      if (!trackedPullRequest || !isOpenPullRequest(trackedPullRequest)) {
        continue;
      }

      if (!TRACKED_PR_LIFECYCLE_REFRESH_STATES.has(record.state)) {
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
        inferStateFromPullRequest,
        blockedReasonForLifecycleState,
        syncReviewWaitWindow,
        syncCopilotReviewRequestObservation,
        syncCopilotReviewTimeoutState,
      });
      const inferredWaitStep =
        projection.nextState === "waiting_ci"
          ? (helpers.inferGitHubWaitStep?.(config, projection.recordForState, trackedPullRequest, checks) ?? null)
          : null;
      await updateReconciliationProgress?.({
        waitStep: inferredWaitStep,
      });
      if (projection.shouldSuppressRecovery) {
        continue;
      }

      const nextState = projection.nextState;
      if (nextState === record.state) {
        continue;
      }
      const failureContext =
        nextState === "blocked"
          ? inferFailureContext(config, projection.recordForState, trackedPullRequest, checks, reviewThreads)
          : null;
      const patch = buildTrackedPrStaleFailureConvergencePatch({
        record,
        pr: trackedPullRequest,
        nextState,
        failureContext,
        blockedReason: projection.nextBlockedReason,
        reviewWaitPatch: projection.reviewWaitPatch,
        copilotReviewRequestObservationPatch: projection.copilotReviewRequestObservationPatch,
        copilotReviewTimeoutPatch: projection.copilotReviewTimeoutPatch,
      });
      if (!needsRecordUpdate(record, patch)) {
        continue;
      }

      const recoveryEvent = buildTrackedPrResumeRecoveryEvent(
        record,
        trackedPullRequest,
        nextState,
        helpers.buildRecoveryEvent,
      );
      const updated = stateStore.touch(record, helpers.applyRecoveryEvent(patch, recoveryEvent));
      state.issues[String(record.issue_number)] = updated;
      saveNeeded = true;
      recoveryEvents.push(recoveryEvent);
      continue;
    }

    let issue = issueByNumber.get(record.issue_number);
    if (issue?.state === "OPEN" && record.state === "merging") {
      issue = await github.getIssue(record.issue_number);
    } else if (!issue) {
      issue = await github.getIssue(record.issue_number);
    }

    if (!issue) {
      continue;
    }

    const recoveryEvent = helpers.buildRecoveryEvent(
      record.issue_number,
      `merged_pr_convergence: tracked PR #${trackedPullRequest.number} merged; marked issue #${record.issue_number} done`,
    );

    if (issue.state !== "OPEN") {
      const patch = helpers.doneResetPatch({
        pr_number: trackedPullRequest.number,
        last_head_sha: trackedPullRequest.headRefOid,
      });
      if (needsRecordUpdate(record, patch)) {
        const updated = stateStore.touch(record, helpers.applyRecoveryEvent(patch, recoveryEvent));
        state.issues[String(record.issue_number)] = updated;
        saveNeeded = true;
        recoveryEvents.push(recoveryEvent);
        await syncExecutionMetricsRunSummarySafely({
          previousRecord: record,
          nextRecord: updated,
          issue,
          pullRequest: trackedPullRequest,
          recoveryEvents: [recoveryEvent],
          retentionRootPath: executionMetricsRetentionRootPath(config.stateFile),
          warningContext: "reconciling",
        });
        await syncPostMergeAuditArtifactSafely({
          config,
          previousRecord: record,
          nextRecord: updated,
          issue,
          pullRequest: trackedPullRequest,
          warningContext: "reconciling",
        });
      }
      if (state.activeIssueNumber === record.issue_number) {
        state.activeIssueNumber = null;
        saveNeeded = true;
      }
      continue;
    }

    const mergedAtMs = Date.parse(trackedPullRequest.mergedAt ?? "");
    const issueUpdatedAtMs = Date.parse(issue.updatedAt);
    if (
      !Number.isFinite(mergedAtMs) ||
      !Number.isFinite(issueUpdatedAtMs) ||
      issueUpdatedAtMs > mergedAtMs
    ) {
      continue;
    }

    await github.closeIssue(
      record.issue_number,
      `Closed automatically because tracked PR #${trackedPullRequest.number} was merged.`,
    );

    const patch = helpers.doneResetPatch({
      pr_number: trackedPullRequest.number,
      last_head_sha: trackedPullRequest.headRefOid,
    });
    const updated = stateStore.touch(record, helpers.applyRecoveryEvent(patch, recoveryEvent));
    state.issues[String(record.issue_number)] = updated;
    if (state.activeIssueNumber === record.issue_number) {
      state.activeIssueNumber = null;
    }
    saveNeeded = true;
    recoveryEvents.push(recoveryEvent);
    await syncExecutionMetricsRunSummarySafely({
      previousRecord: record,
      nextRecord: updated,
      issue,
      pullRequest: trackedPullRequest,
      recoveryEvents: [recoveryEvent],
      retentionRootPath: executionMetricsRetentionRootPath(config.stateFile),
      warningContext: "reconciling",
    });
    await syncPostMergeAuditArtifactSafely({
      config,
      previousRecord: record,
      nextRecord: updated,
      issue,
      pullRequest: trackedPullRequest,
      warningContext: "reconciling",
    });
  }

  if (options.onlyIssueNumber === undefined || options.onlyIssueNumber === null) {
    const deferredRecordCount = Math.max(records.length - processedRecords, 0);
    let nextLastProcessedIssueNumber: number | null;
    if (processedRecords === 0) {
      nextLastProcessedIssueNumber = null;
    } else if (processedRecords >= records.length) {
      nextLastProcessedIssueNumber = deferredHistoricalDoneRecords
        ? trackedMergedButOpenLastProcessedIssueNumber(state)
        : null;
    } else {
      nextLastProcessedIssueNumber = lastProcessedIssueNumber;
    }
    if (setTrackedMergedButOpenLastProcessedIssueNumber(state, nextLastProcessedIssueNumber)) {
      saveNeeded = true;
    }
    if (deferredRecordCount > 0 && lastProcessedIssueNumber !== null) {
      recoveryEvents.push(helpers.buildRecoveryEvent(
        lastProcessedIssueNumber,
        `tracked_pr_reconciliation_bounded: deferred ${deferredRecordCount} tracked PR backlog record(s) after issue #${lastProcessedIssueNumber}; resume after this cursor next cycle`,
      ));
    }
  }

  if (saveNeeded) {
    await stateStore.save(state);
  }

  return recoveryEvents;
}

export async function reconcileStaleFailedTrackedPrRecord(
  github: Pick<RecoveryGitHubLike, "getChecks" | "getPullRequestIfExists" | "getUnresolvedReviewThreads">,
  stateStore: StateStoreLike,
  state: SupervisorStateFile,
  config: SupervisorConfig,
  record: IssueRunRecord,
  deps: {
    inferStateFromPullRequest: (
      config: SupervisorConfig,
      record: IssueRunRecord,
      pr: NonNullable<Awaited<ReturnType<RecoveryGitHubLike["getPullRequestIfExists"]>>>,
      checks: PullRequestCheck[],
      reviewThreads: ReviewThread[],
    ) => IssueRunRecord["state"];
    inferFailureContext: (
      config: SupervisorConfig,
      record: IssueRunRecord,
      pr: NonNullable<Awaited<ReturnType<RecoveryGitHubLike["getPullRequestIfExists"]>>>,
      checks: PullRequestCheck[],
      reviewThreads: ReviewThread[],
    ) => IssueRunRecord["last_failure_context"];
    blockedReasonForLifecycleState: (
      config: SupervisorConfig,
      record: IssueRunRecord,
      pr: NonNullable<Awaited<ReturnType<RecoveryGitHubLike["getPullRequestIfExists"]>>>,
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
    syncCopilotReviewTimeoutState: typeof import("./pull-request-state").syncCopilotReviewTimeoutState;
    inferGitHubWaitStep?: (
      config: SupervisorConfig,
      record: IssueRunRecord,
      pr: NonNullable<Awaited<ReturnType<RecoveryGitHubLike["getPullRequestIfExists"]>>>,
      checks: PullRequestCheck[],
    ) => string | null;
  },
  helpers: {
    buildRecoveryEvent: BuildRecoveryEvent;
    applyRecoveryEvent: ApplyRecoveryEvent;
  },
  updateReconciliationProgress: ((patch: {
    targetIssueNumber?: number | null;
    targetPrNumber?: number | null;
    waitStep?: string | null;
  }) => Promise<void>) | null = null,
): Promise<RecoveryEvent | null> {
  const trackedPrNumber = record.pr_number;
  if (trackedPrNumber === null) {
    return null;
  }

  const pr = await github.getPullRequestIfExists(trackedPrNumber);
  if (!pr || !deps.isOpenPullRequest(pr)) {
    return null;
  }

  const checks = await github.getChecks(pr.number);
  const reviewThreads = await github.getUnresolvedReviewThreads(pr.number);
  const projection = projectTrackedPrLifecycle({
    config,
    record,
    pr,
    checks,
    reviewThreads,
    inferStateFromPullRequest: deps.inferStateFromPullRequest,
    blockedReasonForLifecycleState: deps.blockedReasonForLifecycleState,
    syncReviewWaitWindow: deps.syncReviewWaitWindow,
    syncCopilotReviewRequestObservation: deps.syncCopilotReviewRequestObservation,
    syncCopilotReviewTimeoutState: deps.syncCopilotReviewTimeoutState,
  });
  const nextState = projection.nextState;
  await updateReconciliationProgress?.({
    waitStep:
      nextState === "waiting_ci" ? (deps.inferGitHubWaitStep?.(config, projection.recordForState, pr, checks) ?? null) : null,
  });

  if (projection.shouldSuppressRecovery) {
    return null;
  }

  const failureContext =
    nextState === "blocked"
      ? deps.inferFailureContext(config, projection.recordForState, pr, checks, reviewThreads)
      : null;
  const patch = buildTrackedPrStaleFailureConvergencePatch({
    record,
    pr,
    nextState,
    failureContext,
    blockedReason: projection.nextBlockedReason,
    reviewWaitPatch: projection.reviewWaitPatch,
    copilotReviewRequestObservationPatch: projection.copilotReviewRequestObservationPatch,
    copilotReviewTimeoutPatch: projection.copilotReviewTimeoutPatch,
  });
  if (!needsRecordUpdate(record, patch)) {
    return null;
  }
  const recoveryEvent = buildTrackedPrResumeRecoveryEvent(record, pr, nextState, helpers.buildRecoveryEvent);

  const updated = stateStore.touch(record, helpers.applyRecoveryEvent(patch, recoveryEvent));
  state.issues[String(record.issue_number)] = updated;
  return recoveryEvent;
}
