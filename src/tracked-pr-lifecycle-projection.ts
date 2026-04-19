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
} from "./pull-request-state";
import {
  syncCopilotReviewRequestObservation,
  syncCopilotReviewTimeoutState,
  syncReviewWaitWindow,
} from "./pull-request-state-sync";
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
  copilotReviewTimeoutPatch: Pick<
    IssueRunRecord,
    "copilot_review_timed_out_at" | "copilot_review_timeout_action" | "copilot_review_timeout_reason"
  >;
  nextState: RunState;
  nextBlockedReason: BlockedReason | null;
  shouldSuppressRecovery: boolean;
}

function processedReviewThreadIdsStaleForHead(
  processedThreadIds: readonly string[],
  nextHeadSha: string,
): boolean {
  return processedThreadIds.some((key) => key.includes("@") && !key.endsWith(`@${nextHeadSha}`));
}

function filterProcessedReviewThreadIdsForHead(
  processedThreadIds: readonly string[],
  nextHeadSha: string,
): string[] {
  return processedThreadIds.filter((key) => !key.includes("@") || key.endsWith(`@${nextHeadSha}`));
}

function processedReviewThreadFingerprintsStaleForHead(
  processedThreadFingerprints: readonly string[],
  nextHeadSha: string,
): boolean {
  return processedThreadFingerprints.some((key) => {
    const fingerprintSeparator = key.indexOf("#");
    const threadKey = fingerprintSeparator >= 0 ? key.slice(0, fingerprintSeparator) : key;
    return threadKey.includes("@") && !threadKey.endsWith(`@${nextHeadSha}`);
  });
}

function filterProcessedReviewThreadFingerprintsForHead(
  processedThreadFingerprints: readonly string[],
  nextHeadSha: string,
): string[] {
  return processedThreadFingerprints.filter((key) => {
    const fingerprintSeparator = key.indexOf("#");
    const threadKey = fingerprintSeparator >= 0 ? key.slice(0, fingerprintSeparator) : key;
    return !threadKey.includes("@") || threadKey.endsWith(`@${nextHeadSha}`);
  });
}

export function resetTrackedPrHeadScopedStateOnAdvance(
  record: IssueRunRecord,
  nextHeadSha: string,
): Partial<IssueRunRecord> {
  const localReviewHeadStale =
    record.local_review_head_sha != null && record.local_review_head_sha !== nextHeadSha;
  const externalReviewHeadStale =
    record.external_review_head_sha != null && record.external_review_head_sha !== nextHeadSha;
  const reviewFollowUpHeadStale =
    record.review_follow_up_head_sha != null && record.review_follow_up_head_sha !== nextHeadSha;
  const blockerCommentHeadStale =
    record.last_host_local_pr_blocker_comment_head_sha != null
    && record.last_host_local_pr_blocker_comment_head_sha !== nextHeadSha;
  const observedHostLocalBlockerHeadStale =
    record.last_observed_host_local_pr_blocker_head_sha != null
    && record.last_observed_host_local_pr_blocker_head_sha !== nextHeadSha;
  const localCiHeadStale =
    record.latest_local_ci_result?.head_sha != null
    && record.latest_local_ci_result.head_sha !== nextHeadSha;
  const processedThreadIdsHeadStale = processedReviewThreadIdsStaleForHead(
    record.processed_review_thread_ids ?? [],
    nextHeadSha,
  );
  const processedThreadFingerprintsHeadStale = processedReviewThreadFingerprintsStaleForHead(
    record.processed_review_thread_fingerprints ?? [],
    nextHeadSha,
  );
  const currentHeadProcessedThreadIds = filterProcessedReviewThreadIdsForHead(
    record.processed_review_thread_ids ?? [],
    nextHeadSha,
  );
  const currentHeadProcessedThreadFingerprints = filterProcessedReviewThreadFingerprintsForHead(
    record.processed_review_thread_fingerprints ?? [],
    nextHeadSha,
  );
  const headScopedStateDiverged =
    localReviewHeadStale
    || externalReviewHeadStale
    || reviewFollowUpHeadStale
    || blockerCommentHeadStale
    || observedHostLocalBlockerHeadStale
    || localCiHeadStale
    || processedThreadIdsHeadStale
    || processedThreadFingerprintsHeadStale;
  const sameTrackedHead = record.last_head_sha === nextHeadSha;

  if (sameTrackedHead && !headScopedStateDiverged) {
    return {};
  }

  if (
    sameTrackedHead
    && !localReviewHeadStale
    && !externalReviewHeadStale
    && !reviewFollowUpHeadStale
    && (
      (!processedThreadIdsHeadStale && !processedThreadFingerprintsHeadStale) ||
      currentHeadProcessedThreadIds.length > 0 ||
      currentHeadProcessedThreadFingerprints.length > 0
    )
  ) {
    return {
      ...(processedThreadIdsHeadStale
        ? {
            processed_review_thread_ids: currentHeadProcessedThreadIds,
          }
        : {}),
      ...(processedThreadFingerprintsHeadStale
        ? {
            processed_review_thread_fingerprints: currentHeadProcessedThreadFingerprints,
          }
        : {}),
      ...(localCiHeadStale ? { latest_local_ci_result: null } : {}),
      ...(observedHostLocalBlockerHeadStale
        ? {
            last_observed_host_local_pr_blocker_signature: null,
            last_observed_host_local_pr_blocker_head_sha: null,
          }
        : {}),
      ...(blockerCommentHeadStale
        ? {
            last_host_local_pr_blocker_comment_signature: null,
            last_host_local_pr_blocker_comment_head_sha: null,
          }
        : {}),
    };
  }

  return {
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
    review_follow_up_head_sha: null,
    review_follow_up_remaining: 0,
    last_observed_host_local_pr_blocker_signature: null,
    last_observed_host_local_pr_blocker_head_sha: null,
    last_host_local_pr_blocker_comment_signature: null,
    last_host_local_pr_blocker_comment_head_sha: null,
    processed_review_thread_ids: [],
    processed_review_thread_fingerprints: [],
  };
}

export function projectTrackedPrLifecycle(args: ProjectTrackedPrLifecycleArgs): TrackedPrLifecycleProjection {
  const inferStateFromPullRequestImpl = args.inferStateFromPullRequest ?? inferStateFromPullRequest;
  const blockedReasonForLifecycleStateImpl = args.blockedReasonForLifecycleState ?? blockedReasonForLifecycleState;
  const syncReviewWaitWindowImpl = args.syncReviewWaitWindow ?? syncReviewWaitWindow;
  const syncCopilotReviewRequestObservationImpl =
    args.syncCopilotReviewRequestObservation ?? syncCopilotReviewRequestObservation;
  const syncCopilotReviewTimeoutStateImpl =
    args.syncCopilotReviewTimeoutState ?? syncCopilotReviewTimeoutState;
  const headAdvanceResetPatch = resetTrackedPrHeadScopedStateOnAdvance(args.record, args.pr.headRefOid);

  const projectionSeedRecord: IssueRunRecord = {
    ...args.record,
    ...headAdvanceResetPatch,
    pr_number: args.pr.number,
    last_head_sha: args.pr.headRefOid,
  };
  const reviewWaitPatch = syncReviewWaitWindowImpl(projectionSeedRecord, args.pr);
  const copilotReviewRequestObservationPatch = syncCopilotReviewRequestObservationImpl(
    args.config,
    projectionSeedRecord,
    args.pr,
  );
  const copilotReviewTimeoutPatch = syncCopilotReviewTimeoutStateImpl(args.config, projectionSeedRecord, args.pr);
  const recordForState: IssueRunRecord = {
    ...projectionSeedRecord,
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
