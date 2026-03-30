import type {
  BlockedReason,
  GitHubPullRequest,
  IssueRunRecord,
  PullRequestCheck,
  ReviewThread,
  RunState,
  SupervisorConfig,
} from "./core/types";
import {
  inferStateFromPullRequest,
  syncCopilotReviewRequestObservation,
  syncCopilotReviewTimeoutState,
  syncReviewWaitWindow,
} from "./pull-request-state";
import { blockedReasonForLifecycleState } from "./supervisor/supervisor-lifecycle";

interface ProjectTrackedPrLifecycleArgs {
  config: SupervisorConfig;
  record: IssueRunRecord;
  pr: GitHubPullRequest;
  checks: PullRequestCheck[];
  reviewThreads: ReviewThread[];
  inferStateFromPullRequest?: typeof inferStateFromPullRequest;
  blockedReasonForLifecycleState?: typeof blockedReasonForLifecycleState;
  syncReviewWaitWindow?: typeof syncReviewWaitWindow;
  syncCopilotReviewRequestObservation?: typeof syncCopilotReviewRequestObservation;
  syncCopilotReviewTimeoutState?: typeof syncCopilotReviewTimeoutState;
}

export interface TrackedPrLifecycleProjection {
  recordForState: IssueRunRecord;
  reviewWaitPatch: Partial<IssueRunRecord>;
  copilotReviewRequestObservationPatch: Partial<IssueRunRecord>;
  copilotReviewTimeoutPatch: Partial<IssueRunRecord>;
  nextState: RunState;
  nextBlockedReason: BlockedReason | null;
  shouldSuppressRecovery: boolean;
}

export function projectTrackedPrLifecycle(args: ProjectTrackedPrLifecycleArgs): TrackedPrLifecycleProjection {
  const inferStateFromPullRequestImpl = args.inferStateFromPullRequest ?? inferStateFromPullRequest;
  const blockedReasonForLifecycleStateImpl = args.blockedReasonForLifecycleState ?? blockedReasonForLifecycleState;
  const syncReviewWaitWindowImpl = args.syncReviewWaitWindow ?? syncReviewWaitWindow;
  const syncCopilotReviewRequestObservationImpl =
    args.syncCopilotReviewRequestObservation ?? syncCopilotReviewRequestObservation;
  const syncCopilotReviewTimeoutStateImpl =
    args.syncCopilotReviewTimeoutState ?? syncCopilotReviewTimeoutState;

  const reviewWaitPatch = syncReviewWaitWindowImpl(args.record, args.pr);
  const copilotReviewRequestObservationPatch = syncCopilotReviewRequestObservationImpl(
    args.config,
    args.record,
    args.pr,
  );
  const copilotReviewTimeoutPatch = syncCopilotReviewTimeoutStateImpl(args.config, args.record, args.pr);
  const recordForState: IssueRunRecord = {
    ...args.record,
    pr_number: args.pr.number,
    last_head_sha: args.pr.headRefOid,
    ...reviewWaitPatch,
    ...copilotReviewRequestObservationPatch,
    ...copilotReviewTimeoutPatch,
  };
  const nextState = inferStateFromPullRequestImpl(
    args.config,
    recordForState,
    args.pr,
    args.checks,
    args.reviewThreads,
  );

  return {
    recordForState,
    reviewWaitPatch,
    copilotReviewRequestObservationPatch,
    copilotReviewTimeoutPatch,
    nextState,
    nextBlockedReason:
      nextState === "blocked"
        ? blockedReasonForLifecycleStateImpl(args.config, recordForState, args.pr, args.checks, args.reviewThreads)
        : null,
    shouldSuppressRecovery: nextState === "failed",
  };
}
