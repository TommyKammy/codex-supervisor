import {
  localReviewFailureContext,
  localReviewHighSeverityNeedsBlock,
  localReviewRepairContinuationFailureContext,
  localReviewRepairContinuationSummary,
  localReviewRetryLoopStalled,
  localReviewStallFailureContext,
} from "./review-handling";
import type { IssueJournalSync } from "./run-once-issue-preparation";
import type { StateStore } from "./core/state-store";
import type {
  FailureContext,
  GitHubPullRequest,
  IssueRunRecord,
  PullRequestCheck,
  ReviewThread,
  SupervisorConfig,
  SupervisorStateFile,
} from "./core/types";
import { truncate } from "./core/utils";
import type {
  HandlePostTurnPullRequestTransitionsArgs,
  PullRequestLifecycleSnapshot,
} from "./post-turn-pull-request";

export async function applyTrackedPrLifecycleState(args: {
  config: SupervisorConfig;
  stateStore: Pick<StateStore, "touch" | "save">;
  state: SupervisorStateFile;
  syncJournal: IssueJournalSync;
  record: IssueRunRecord;
  pr: GitHubPullRequest;
  checks: PullRequestCheck[];
  reviewThreads: ReviewThread[];
  repeatedLocalReviewSignatureCount: number;
  derivePullRequestLifecycleSnapshot: (
    record: IssueRunRecord,
    pr: GitHubPullRequest,
    checks: PullRequestCheck[],
    reviewThreads: ReviewThread[],
    recordPatch?: Partial<IssueRunRecord>,
  ) => PullRequestLifecycleSnapshot;
  applyFailureSignature: (
    record: IssueRunRecord,
    failureContext: FailureContext | null,
  ) => Pick<IssueRunRecord, "last_failure_signature" | "repeated_failure_signature_count">;
  blockedReasonFromReviewState: HandlePostTurnPullRequestTransitionsArgs["blockedReasonFromReviewState"];
  summarizeChecks: HandlePostTurnPullRequestTransitionsArgs["summarizeChecks"];
  manualReviewThreads: HandlePostTurnPullRequestTransitionsArgs["manualReviewThreads"];
  configuredBotReviewThreads: HandlePostTurnPullRequestTransitionsArgs["configuredBotReviewThreads"];
  mergeConflictDetected: HandlePostTurnPullRequestTransitionsArgs["mergeConflictDetected"];
}): Promise<{ record: IssueRunRecord; effectiveFailureContext: FailureContext | null }> {
  const refreshedLifecycle = args.derivePullRequestLifecycleSnapshot(
    args.record,
    args.pr,
    args.checks,
    args.reviewThreads,
    { repeated_local_review_signature_count: args.repeatedLocalReviewSignatureCount },
  );
  const localReviewRepairSummary =
    refreshedLifecycle.nextState === "local_review_fix"
      ? localReviewRepairContinuationSummary(args.config, refreshedLifecycle.recordForState, args.pr)
      : null;
  const postReadyLocalReviewFailureContext =
    refreshedLifecycle.nextState === "blocked" &&
    localReviewRetryLoopStalled(
      args.config,
      refreshedLifecycle.recordForState,
      args.pr,
      args.checks,
      args.reviewThreads,
      args.manualReviewThreads,
      args.configuredBotReviewThreads,
      args.summarizeChecks,
      args.mergeConflictDetected,
    )
      ? localReviewStallFailureContext(refreshedLifecycle.recordForState)
      : refreshedLifecycle.nextState === "blocked" &&
          localReviewHighSeverityNeedsBlock(args.config, refreshedLifecycle.recordForState, args.pr)
        ? localReviewFailureContext(refreshedLifecycle.recordForState)
        : refreshedLifecycle.nextState === "local_review_fix"
          ? localReviewRepairContinuationFailureContext(args.config, refreshedLifecycle.recordForState, args.pr)
          : null;
  const effectiveFailureContext = refreshedLifecycle.failureContext ?? postReadyLocalReviewFailureContext;
  const updatedRecord = args.stateStore.touch(args.record, {
    pr_number: args.pr.number,
    ...refreshedLifecycle.reviewWaitPatch,
    ...refreshedLifecycle.codexConnectorRequestObservationPatch,
    ...refreshedLifecycle.copilotRequestObservationPatch,
    merge_readiness_last_evaluated_at: refreshedLifecycle.mergeLatencyVisibilityPatch.merge_readiness_last_evaluated_at,
    provider_success_head_sha: refreshedLifecycle.mergeLatencyVisibilityPatch.provider_success_head_sha,
    provider_success_observed_at: refreshedLifecycle.mergeLatencyVisibilityPatch.provider_success_observed_at,
    ...refreshedLifecycle.copilotTimeoutPatch,
    state: refreshedLifecycle.nextState,
    last_head_sha: args.pr.headRefOid,
    repeated_local_review_signature_count: args.repeatedLocalReviewSignatureCount,
    last_error:
      refreshedLifecycle.nextState === "blocked" && effectiveFailureContext
        ? truncate(effectiveFailureContext.summary, 1000)
        : localReviewRepairSummary
          ? truncate(localReviewRepairSummary, 1000)
          : refreshedLifecycle.nextState === "blocked"
            ? args.record.last_error
            : null,
    last_failure_context: effectiveFailureContext,
    ...args.applyFailureSignature(args.record, effectiveFailureContext),
    blocked_reason:
      refreshedLifecycle.nextState === "blocked"
        ? args.blockedReasonFromReviewState(
            refreshedLifecycle.recordForState,
            args.pr,
            args.checks,
            args.reviewThreads,
          ) ??
          ((localReviewRetryLoopStalled(
            args.config,
            refreshedLifecycle.recordForState,
            args.pr,
            args.checks,
            args.reviewThreads,
            args.manualReviewThreads,
            args.configuredBotReviewThreads,
            args.summarizeChecks,
            args.mergeConflictDetected,
          ) ||
            localReviewHighSeverityNeedsBlock(args.config, refreshedLifecycle.recordForState, args.pr))
            ? "verification"
            : null)
        : null,
  });
  args.state.issues[String(updatedRecord.issue_number)] = updatedRecord;
  await args.stateStore.save(args.state);
  await args.syncJournal(updatedRecord);
  return {
    record: updatedRecord,
    effectiveFailureContext,
  };
}
