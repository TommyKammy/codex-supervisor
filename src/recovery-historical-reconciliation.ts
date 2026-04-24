import { type StateStore } from "./core/state-store";
import { type GitHubIssue, type GitHubPullRequest, type IssueRunRecord, type SupervisorConfig, type SupervisorStateFile } from "./core/types";
import { truncate } from "./core/utils";
import {
  executionMetricsRetentionRootPath,
  syncExecutionMetricsRunSummarySafely,
} from "./supervisor/execution-metrics-run-summary";
import { syncPostMergeAuditArtifactSafely } from "./supervisor/post-merge-audit-artifact";
import {
  buildUnsafeNoPrFailureContext,
  doneResetPatch,
  shouldReconsiderNoPrDoneRecord,
} from "./recovery-support";
import { type RecoveryEvent } from "./run-once-cycle-prelude";

type StateStoreLike = Pick<StateStore, "touch" | "save">;
type BuildRecoveryEvent = (issueNumber: number, reason: string) => RecoveryEvent;
type ApplyRecoveryEvent = (
  patch: Partial<IssueRunRecord>,
  recoveryEvent: RecoveryEvent,
) => Partial<IssueRunRecord>;

type HistoricalRecoveryGitHubLike = Pick<
  import("./github").GitHubClient,
  "closePullRequest" | "getIssue" | "getMergedPullRequestsClosingIssue" | "getPullRequestIfExists"
>;

function mergedIssueClosuresLastProcessedIssueNumber(state: SupervisorStateFile): number | null {
  return state.reconciliation_state?.merged_issue_closures_last_processed_issue_number ?? null;
}

function setMergedIssueClosuresLastProcessedIssueNumber(
  state: SupervisorStateFile,
  issueNumber: number | null,
): boolean {
  const currentIssueNumber = mergedIssueClosuresLastProcessedIssueNumber(state);
  if (currentIssueNumber === issueNumber) {
    return false;
  }

  state.reconciliation_state = {
    ...(state.reconciliation_state ?? {}),
    merged_issue_closures_last_processed_issue_number: issueNumber,
  };
  return true;
}

function orderMergedIssueClosureRecordsForResume(
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

  return [
    ...ordered.slice(nextIndex),
    ...ordered.slice(0, nextIndex),
  ];
}

function prioritizeMergedIssueClosureRecords(
  records: IssueRunRecord[],
  lastProcessedIssueNumber: number | null,
  activeIssueNumber: number | null,
): IssueRunRecord[] {
  const activeRecord = activeIssueNumber === null
    ? null
    : records.find((record) => record.issue_number === activeIssueNumber) ?? null;
  const remainingRecords = activeRecord === null
    ? records
    : records.filter((record) => record.issue_number !== activeRecord.issue_number);
  const orderedRemainingRecords = orderMergedIssueClosureRecordsForResume(
    remainingRecords,
    activeRecord === null ? lastProcessedIssueNumber : activeRecord.issue_number,
  );

  return activeRecord === null
    ? orderedRemainingRecords
    : [activeRecord, ...orderedRemainingRecords];
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

function shouldRevalidateMergedIssueClosureRecord(
  record: Pick<
    IssueRunRecord,
    | "issue_number"
    | "state"
    | "pr_number"
    | "last_head_sha"
    | "last_recovery_reason"
    | "last_failure_context"
    | "last_recovery_at"
    | "updated_at"
  >,
  issue: Pick<GitHubIssue, "updatedAt">,
  activeIssueNumber: number | null,
): boolean {
  if (activeIssueNumber === record.issue_number) {
    return true;
  }

  if (record.state !== "done") {
    return true;
  }

  if (record.pr_number === null || record.last_head_sha === null) {
    return true;
  }

  if (!record.last_recovery_reason?.startsWith("merged_pr_convergence:")) {
    return true;
  }

  const issueUpdatedAtMs = Date.parse(issue.updatedAt);
  const localTerminalObservedAtMs = latestFiniteTimestamp(
    record.last_failure_context?.updated_at,
    record.last_recovery_at,
    record.updated_at,
  );
  if (!Number.isFinite(issueUpdatedAtMs) || localTerminalObservedAtMs === null) {
    return true;
  }

  return issueUpdatedAtMs > localTerminalObservedAtMs;
}

export async function reconcileMergedIssueClosuresInModule(
  github: HistoricalRecoveryGitHubLike,
  stateStore: StateStoreLike,
  state: SupervisorStateFile,
  config: SupervisorConfig,
  issues: GitHubIssue[],
  helpers: {
    buildRecoveryEvent: BuildRecoveryEvent;
    applyRecoveryEvent: ApplyRecoveryEvent;
    needsRecordUpdate: (record: IssueRunRecord, patch: Partial<IssueRunRecord>) => boolean;
  },
  updateReconciliationProgress: ((patch: {
    targetIssueNumber?: number | null;
    targetPrNumber?: number | null;
    waitStep?: string | null;
  }) => Promise<void>) | null = null,
  options: {
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
  const revalidationEligibleRecords = Object.values(state.issues).filter((record) => {
    const issue = issueByNumber.get(record.issue_number);
    return issue?.state === "CLOSED" && shouldRevalidateMergedIssueClosureRecord(record, issue, state.activeIssueNumber);
  });
  const orderedRecords = prioritizeMergedIssueClosureRecords(
    revalidationEligibleRecords,
    mergedIssueClosuresLastProcessedIssueNumber(state),
    state.activeIssueNumber,
  );
  let processedRecords = 0;
  let lastProcessedIssueNumber: number | null = null;

  for (const record of orderedRecords) {
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

    const issue = issueByNumber.get(record.issue_number);
    if (!issue) {
      continue;
    }
    const satisfyingPullRequests = await github.getMergedPullRequestsClosingIssue(record.issue_number);
    const satisfyingPullRequest = satisfyingPullRequests[0] ?? null;

    if (!satisfyingPullRequest) {
      const patch = doneResetPatch();
      if (helpers.needsRecordUpdate(record, patch)) {
        const updated = stateStore.touch(record, patch);
        state.issues[String(record.issue_number)] = updated;
        saveNeeded = true;
      }
      if (state.activeIssueNumber === record.issue_number) {
        state.activeIssueNumber = null;
        saveNeeded = true;
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
    const needsMergedConvergenceBackfill =
      !record.last_recovery_reason?.startsWith("merged_pr_convergence:");
    if (helpers.needsRecordUpdate(record, patch) || needsMergedConvergenceBackfill) {
      const recoveryEvent = helpers.buildRecoveryEvent(
        record.issue_number,
        `merged_pr_convergence: merged PR #${satisfyingPullRequest.number} satisfied issue #${record.issue_number}; marked issue #${record.issue_number} done`,
      );
      const updated = stateStore.touch(record, helpers.applyRecoveryEvent(patch, recoveryEvent));
      state.issues[String(record.issue_number)] = updated;
      saveNeeded = true;
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
        pullRequest: satisfyingPullRequest as GitHubPullRequest,
        warningContext: "reconciling",
      });
    }
    if (state.activeIssueNumber === record.issue_number) {
      state.activeIssueNumber = null;
      saveNeeded = true;
    }
  }

  const nextLastProcessedIssueNumber =
    processedRecords === 0 || processedRecords >= orderedRecords.length
      ? null
      : lastProcessedIssueNumber;
  if (setMergedIssueClosuresLastProcessedIssueNumber(state, nextLastProcessedIssueNumber)) {
    saveNeeded = true;
  }

  if (saveNeeded) {
    await stateStore.save(state);
  }

  return recoveryEvents;
}

export async function reconcileStaleDoneIssueStatesInModule(
  github: Pick<HistoricalRecoveryGitHubLike, "getIssue">,
  stateStore: StateStoreLike,
  state: SupervisorStateFile,
  issues: GitHubIssue[],
  helpers: {
    buildRecoveryEvent: BuildRecoveryEvent;
    applyRecoveryEvent: ApplyRecoveryEvent;
  },
): Promise<RecoveryEvent[]> {
  let changed = false;
  const recoveryEvents: RecoveryEvent[] = [];
  const issueStateByNumber = new Map(issues.map((issue) => [issue.number, issue.state ?? null]));

  const downgradeToManualReview = (
    record: IssueRunRecord,
    failureContext: NonNullable<IssueRunRecord["last_failure_context"]>,
    reason: string,
  ): void => {
    const recoveryEvent = helpers.buildRecoveryEvent(record.issue_number, reason);
    const updated = stateStore.touch(
      record,
      helpers.applyRecoveryEvent({
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
