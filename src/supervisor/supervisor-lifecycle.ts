import { shouldPreserveNoPrFailureTracking } from "../no-pull-request-state";
import type { PullRequestLifecycleSnapshot } from "../post-turn-pull-request";
import {
  blockedReasonFromReviewState,
  inferStateFromPullRequest,
  syncMergeLatencyVisibility,
  syncCopilotReviewRequestObservation,
  syncCopilotReviewTimeoutState,
  syncReviewWaitWindow,
} from "../pull-request-state";
import {
  localReviewHighSeverityNeedsBlock,
  localReviewRetryLoopStalled,
} from "../review-handling";
import { inferFailureContext } from "./supervisor-failure-context";
import { mergeConflictDetected, summarizeChecks } from "./supervisor-status-rendering";
import { configuredBotReviewThreads, manualReviewThreads } from "../review-thread-reporting";
import {
  FailureContext,
  GitHubPullRequest,
  IssueRunRecord,
  PullRequestCheck,
  ReviewThread,
  RunState,
  SupervisorConfig,
} from "../core/types";

function mergeCriticalRecheckIntervalMs(config: SupervisorConfig): number | null {
  return typeof config.mergeCriticalRecheckSeconds === "number" &&
    Number.isFinite(config.mergeCriticalRecheckSeconds) &&
    Number.isInteger(config.mergeCriticalRecheckSeconds) &&
    config.mergeCriticalRecheckSeconds > 0
    ? config.mergeCriticalRecheckSeconds * 1000
    : null;
}

function progressTimestampMs(timestamp: string | null | undefined): number | null {
  if (!timestamp) {
    return null;
  }

  const parsed = Date.parse(timestamp);
  return Number.isNaN(parsed) ? null : parsed;
}

function progressMatchesCurrentHead(
  progressHeadSha: string | null | undefined,
  record: Pick<IssueRunRecord, "last_head_sha">,
): boolean {
  return progressHeadSha === null || progressHeadSha === undefined || record.last_head_sha === null || progressHeadSha === record.last_head_sha;
}

function latestMergeCriticalProgressMs(record: IssueRunRecord): number | null {
  const candidates = [
    progressMatchesCurrentHead(record.provider_success_head_sha, record)
      ? progressTimestampMs(record.provider_success_observed_at)
      : null,
    progressMatchesCurrentHead(record.review_wait_head_sha, record) ? progressTimestampMs(record.review_wait_started_at) : null,
    progressMatchesCurrentHead(record.copilot_review_requested_head_sha, record)
      ? progressTimestampMs(record.copilot_review_requested_observed_at)
      : null,
  ].filter((value): value is number => value !== null);

  if (candidates.length === 0) {
    return null;
  }

  return Math.max(...candidates);
}

function shouldUseMergeCriticalWaitingCadence(config: SupervisorConfig, record: IssueRunRecord): boolean {
  const recheckIntervalMs = mergeCriticalRecheckIntervalMs(config);
  if (recheckIntervalMs === null || record.state !== "waiting_ci" || record.blocked_reason !== null) {
    return false;
  }

  const latestProgressMs = latestMergeCriticalProgressMs(record);
  if (latestProgressMs === null) {
    return false;
  }

  return Date.now() - latestProgressMs < config.pollIntervalSeconds * 1000;
}

export function selectSupervisorPollIntervalMs(config: SupervisorConfig, record: IssueRunRecord | null): number {
  if (record && shouldUseMergeCriticalWaitingCadence(config, record)) {
    return mergeCriticalRecheckIntervalMs(config) ?? config.pollIntervalSeconds * 1000;
  }

  return config.pollIntervalSeconds * 1000;
}

export function shouldStopForRepeatedFailureSignature(record: IssueRunRecord, config: SupervisorConfig): boolean {
  return (
    record.last_failure_signature !== null &&
    record.repeated_failure_signature_count >= config.sameFailureSignatureRepeatLimit
  );
}

export function blockedReasonForLifecycleState(
  config: SupervisorConfig,
  record: IssueRunRecord,
  pr: GitHubPullRequest,
  checks: PullRequestCheck[],
  reviewThreads: ReviewThread[],
): IssueRunRecord["blocked_reason"] {
  return (
    blockedReasonFromReviewState(config, record, pr, reviewThreads) ??
    (localReviewRetryLoopStalled(
      config,
      record,
      pr,
      checks,
      reviewThreads,
      manualReviewThreads,
      configuredBotReviewThreads,
      summarizeChecks,
      mergeConflictDetected,
    ) || localReviewHighSeverityNeedsBlock(config, record, pr)
      ? "verification"
      : null)
  );
}

export function derivePullRequestLifecycleSnapshot(
  config: SupervisorConfig,
  record: IssueRunRecord,
  pr: GitHubPullRequest,
  checks: PullRequestCheck[],
  reviewThreads: ReviewThread[],
  recordPatch: Partial<IssueRunRecord> = {},
): PullRequestLifecycleSnapshot {
  const baseRecord = { ...record, ...recordPatch };
  const reviewWaitPatch = syncReviewWaitWindow(baseRecord, pr);
  const copilotRequestObservationPatch = syncCopilotReviewRequestObservation(config, baseRecord, pr);
  const recordForState = {
    ...baseRecord,
    ...reviewWaitPatch,
    ...copilotRequestObservationPatch,
  };
  const mergeLatencyVisibilityPatch = syncMergeLatencyVisibility(config, recordForState, pr, reviewThreads);
  const copilotTimeoutPatch = syncCopilotReviewTimeoutState(config, recordForState, pr);
  const finalizedRecordForState = {
    ...recordForState,
    ...mergeLatencyVisibilityPatch,
    ...copilotTimeoutPatch,
  };

  return {
    recordForState: finalizedRecordForState,
    nextState: inferStateFromPullRequest(config, finalizedRecordForState, pr, checks, reviewThreads),
    failureContext: inferFailureContext(config, finalizedRecordForState, pr, checks, reviewThreads),
    reviewWaitPatch,
    copilotRequestObservationPatch,
    mergeLatencyVisibilityPatch,
    copilotTimeoutPatch,
  };
}

export function shouldRunCodex(
  record: IssueRunRecord,
  pr: GitHubPullRequest | null,
  checks: PullRequestCheck[],
  reviewThreads: ReviewThread[],
  config: SupervisorConfig,
): boolean {
  if (!pr) {
    return true;
  }

  const inferred = inferStateFromPullRequest(config, record, pr, checks, reviewThreads);
  return (
    inferred === "draft_pr" ||
    inferred === "repairing_ci" ||
    inferred === "resolving_conflict" ||
    inferred === "addressing_review" ||
    inferred === "implementing" ||
    inferred === "local_review_fix" ||
    inferred === "reproducing" ||
    inferred === "stabilizing"
  );
}

export function isOpenPullRequest(pr: GitHubPullRequest | null): pr is GitHubPullRequest {
  return pr !== null && pr.state === "OPEN" && !pr.mergedAt;
}

export function resetNoPrLifecycleFailureTracking(
  record: IssueRunRecord,
): Pick<
  IssueRunRecord,
  | "copilot_review_requested_observed_at"
  | "copilot_review_requested_head_sha"
  | "copilot_review_timed_out_at"
  | "copilot_review_timeout_action"
  | "copilot_review_timeout_reason"
  | "provider_success_observed_at"
  | "provider_success_head_sha"
  | "merge_readiness_last_evaluated_at"
  | "last_failure_context"
  | "last_failure_signature"
  | "repeated_failure_signature_count"
  | "blocked_reason"
> {
  const preserveFailureTracking = shouldPreserveNoPrFailureTracking(record);
  return {
    copilot_review_requested_observed_at: null,
    copilot_review_requested_head_sha: null,
    copilot_review_timed_out_at: null,
    copilot_review_timeout_action: null,
    copilot_review_timeout_reason: null,
    provider_success_observed_at: null,
    provider_success_head_sha: null,
    merge_readiness_last_evaluated_at: null,
    last_failure_context: preserveFailureTracking ? record.last_failure_context : null,
    last_failure_signature: preserveFailureTracking ? record.last_failure_signature : null,
    repeated_failure_signature_count: preserveFailureTracking ? record.repeated_failure_signature_count : 0,
    blocked_reason: null,
  };
}
