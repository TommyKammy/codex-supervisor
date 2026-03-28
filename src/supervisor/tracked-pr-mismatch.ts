import type {
  BlockedReason,
  GitHubPullRequest,
  IssueRunRecord,
  PullRequestCheck,
  ReviewThread,
  RunState,
  SupervisorConfig,
} from "../core/types";
import {
  blockedReasonFromReviewState,
  inferStateFromPullRequest,
  syncCopilotReviewRequestObservation,
  syncCopilotReviewTimeoutState,
  syncReviewWaitWindow,
} from "../pull-request-state";

export interface TrackedPrMismatch {
  issueNumber: number;
  prNumber: number;
  githubState: RunState;
  githubBlockedReason: BlockedReason | null;
  localState: RunState;
  localBlockedReason: BlockedReason | null;
  staleLocalBlocker: boolean;
  summaryLine: string;
  guidanceLine: string;
}

function isBlockedLikeState(state: RunState): boolean {
  return state === "blocked" || state === "failed";
}

export function buildTrackedPrMismatch(
  config: SupervisorConfig,
  record: IssueRunRecord,
  pr: GitHubPullRequest,
  checks: PullRequestCheck[],
  reviewThreads: ReviewThread[],
): TrackedPrMismatch | null {
  if (record.pr_number === null) {
    return null;
  }

  const recordForState: IssueRunRecord = {
    ...record,
    pr_number: pr.number,
    last_head_sha: pr.headRefOid,
    ...syncReviewWaitWindow(record, pr),
    ...syncCopilotReviewRequestObservation(config, record, pr),
    ...syncCopilotReviewTimeoutState(config, record, pr),
  };
  const githubState = inferStateFromPullRequest(config, recordForState, pr, checks, reviewThreads);
  const githubBlockedReason =
    githubState === "blocked" ? blockedReasonFromReviewState(config, recordForState, pr, checks, reviewThreads) : null;
  const mismatch =
    isBlockedLikeState(record.state) &&
    (githubState !== record.state || (githubState === "blocked" && githubBlockedReason !== record.blocked_reason));

  if (!mismatch) {
    return null;
  }

  const staleLocalBlocker =
    record.blocked_reason !== null &&
    (githubState !== "blocked" || githubBlockedReason !== record.blocked_reason);

  return {
    issueNumber: record.issue_number,
    prNumber: pr.number,
    githubState,
    githubBlockedReason,
    localState: record.state,
    localBlockedReason: record.blocked_reason,
    staleLocalBlocker,
    summaryLine: [
      "tracked_pr_mismatch",
      `issue=#${record.issue_number}`,
      `pr=#${pr.number}`,
      `github_state=${githubState}`,
      `github_blocked_reason=${githubBlockedReason ?? "none"}`,
      `local_state=${record.state}`,
      `local_blocked_reason=${record.blocked_reason ?? "none"}`,
      `stale_local_blocker=${staleLocalBlocker ? "yes" : "no"}`,
    ].join(" "),
    guidanceLine:
      "recovery_guidance=Tracked PR facts are fresher than local state; run the supervisor again to refresh tracked PR state. Explicit requeue is unavailable for tracked PR work.",
  };
}
