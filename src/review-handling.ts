import { localReviewHasActionableFindings } from "./local-review";
import {
  FailureContext,
  GitHubPullRequest,
  IssueRunRecord,
  PullRequestCheck,
  ReviewThread,
  SupervisorConfig,
} from "./core/types";
import { nowIso } from "./core/utils";

export function processedReviewThreadKey(threadId: string, headSha: string): string {
  return `${threadId}@${headSha}`;
}

export function latestReviewThreadCommentFingerprint(
  thread: Pick<ReviewThread, "comments">,
): string | null {
  const latestComment = thread.comments.nodes[thread.comments.nodes.length - 1] ?? null;
  if (!latestComment) {
    return null;
  }

  return latestComment.id || latestComment.createdAt || null;
}

export function processedReviewThreadFingerprintKey(
  threadId: string,
  headSha: string,
  latestCommentFingerprint: string,
): string {
  return `${processedReviewThreadKey(threadId, headSha)}#${latestCommentFingerprint}`;
}

export function hasProcessedReviewThread(
  record: Pick<
    IssueRunRecord,
    "processed_review_thread_ids" | "processed_review_thread_fingerprints" | "last_head_sha"
  >,
  pr: Pick<GitHubPullRequest, "headRefOid">,
  thread: Pick<ReviewThread, "id" | "comments">,
): boolean {
  const processedKeys = record.processed_review_thread_ids ?? [];
  const processedFingerprints = record.processed_review_thread_fingerprints ?? [];
  const headScopedKey = processedReviewThreadKey(thread.id, pr.headRefOid);
  const latestCommentFingerprint = latestReviewThreadCommentFingerprint(thread);
  if (
    latestCommentFingerprint &&
    processedFingerprints.includes(
      processedReviewThreadFingerprintKey(thread.id, pr.headRefOid, latestCommentFingerprint),
    )
  ) {
    return true;
  }

  if (processedKeys.includes(headScopedKey)) {
    if (latestCommentFingerprint === null) {
      return true;
    }

    const threadFingerprintPrefix = `${headScopedKey}#`;
    const hasStoredFingerprintForThreadOnHead = processedFingerprints.some((key) =>
      key.startsWith(threadFingerprintPrefix),
    );
    return !hasStoredFingerprintForThreadOnHead;
  }

  return record.last_head_sha === pr.headRefOid && processedKeys.includes(thread.id);
}

export function localReviewBlocksReady(
  config: SupervisorConfig,
  record: Pick<
    IssueRunRecord,
    | "local_review_head_sha"
    | "local_review_findings_count"
    | "local_review_recommendation"
    | "pre_merge_evaluation_outcome"
    | "pre_merge_manual_review_count"
    | "pre_merge_follow_up_count"
  >,
  pr: GitHubPullRequest,
): boolean {
  if (!config.localReviewEnabled) {
    return false;
  }

  if (config.trackedPrCurrentHeadLocalReviewRequired && record.local_review_head_sha !== pr.headRefOid) {
    return true;
  }

  if (config.localReviewPolicy === "block_ready") {
    return record.local_review_head_sha !== pr.headRefOid || localReviewHasActionableFindings(record, pr);
  }

  if (localReviewFollowUpNeedsRepair(config, record, pr)) {
    return true;
  }

  if (config.localReviewPolicy !== "block_merge") {
    return false;
  }

  if (record.local_review_head_sha !== pr.headRefOid) {
    return true;
  }

  return (
    record.pre_merge_evaluation_outcome == null ||
    record.pre_merge_evaluation_outcome === "fix_blocked" ||
    record.pre_merge_evaluation_outcome === "manual_review_blocked"
  );
}

export function localReviewBlocksMerge(
  config: SupervisorConfig,
  record: Pick<
    IssueRunRecord,
    | "local_review_head_sha"
    | "local_review_findings_count"
    | "local_review_recommendation"
    | "pre_merge_evaluation_outcome"
    | "pre_merge_manual_review_count"
    | "pre_merge_follow_up_count"
  >,
  pr: GitHubPullRequest,
): boolean {
  if (!config.localReviewEnabled || pr.isDraft) {
    return false;
  }

  if (config.trackedPrCurrentHeadLocalReviewRequired && record.local_review_head_sha !== pr.headRefOid) {
    return true;
  }

  if (config.localReviewPolicy !== "block_merge") {
    return false;
  }

  if (localReviewFollowUpNeedsRepair(config, record, pr)) {
    return true;
  }

  if (record.local_review_head_sha !== pr.headRefOid) {
    return true;
  }

  return (
    record.pre_merge_evaluation_outcome == null ||
    record.pre_merge_evaluation_outcome === "fix_blocked" ||
    record.pre_merge_evaluation_outcome === "manual_review_blocked"
  );
}

export function localReviewRequiresManualReview(
  config: SupervisorConfig,
  record: Pick<
    IssueRunRecord,
    "local_review_head_sha" | "pre_merge_evaluation_outcome" | "pre_merge_manual_review_count" | "pre_merge_follow_up_count"
  >,
  pr: GitHubPullRequest,
): boolean {
  return (
    config.localReviewEnabled &&
    config.localReviewPolicy === "block_merge" &&
    record.local_review_head_sha === pr.headRefOid &&
    record.pre_merge_evaluation_outcome === "manual_review_blocked" &&
    !localReviewManualReviewNeedsRepair(config, record, pr)
  );
}

export function localReviewHighSeverityNeedsRetry(
  config: SupervisorConfig,
  record: Pick<IssueRunRecord, "local_review_head_sha" | "local_review_verified_max_severity">,
  pr: GitHubPullRequest,
): boolean {
  return (
    config.localReviewPolicy !== "advisory" &&
    record.local_review_head_sha === pr.headRefOid &&
    record.local_review_verified_max_severity === "high" &&
    config.localReviewHighSeverityAction === "retry"
  );
}

export function localReviewFollowUpNeedsRepair(
  config: SupervisorConfig,
  record: Pick<
    IssueRunRecord,
    "local_review_head_sha" | "pre_merge_evaluation_outcome" | "pre_merge_manual_review_count" | "pre_merge_follow_up_count"
  >,
  pr: GitHubPullRequest,
): boolean {
  return (
    config.localReviewPolicy !== "advisory" &&
    config.localReviewFollowUpRepairEnabled === true &&
    record.local_review_head_sha === pr.headRefOid &&
    record.pre_merge_evaluation_outcome === "follow_up_eligible" &&
    (record.pre_merge_follow_up_count ?? 0) > 0
  );
}

export function reviewDecisionAllowsSamePrManualReviewRepair(
  pr: Pick<GitHubPullRequest, "reviewDecision" | "configuredBotTopLevelReviewStrength">,
): boolean {
  return (
    pr.reviewDecision !== "REVIEW_REQUIRED" &&
    (pr.reviewDecision !== "CHANGES_REQUESTED" || pr.configuredBotTopLevelReviewStrength === "nitpick_only")
  );
}

export function localReviewManualReviewNeedsRepair(
  config: SupervisorConfig,
  record: Pick<
    IssueRunRecord,
    "local_review_head_sha" | "pre_merge_evaluation_outcome" | "pre_merge_manual_review_count" | "pre_merge_follow_up_count"
  >,
  pr: GitHubPullRequest,
): boolean {
  return (
    config.localReviewPolicy !== "advisory" &&
    config.localReviewManualReviewRepairEnabled === true &&
    record.local_review_head_sha === pr.headRefOid &&
    reviewDecisionAllowsSamePrManualReviewRepair(pr) &&
    record.pre_merge_evaluation_outcome === "manual_review_blocked" &&
    (record.pre_merge_manual_review_count ?? 0) > 0
  );
}

export function localReviewRetryLoopCandidate(
  config: SupervisorConfig,
  record: Pick<
    IssueRunRecord,
    | "local_review_head_sha"
    | "local_review_verified_max_severity"
    | "pre_merge_evaluation_outcome"
    | "pre_merge_manual_review_count"
    | "pre_merge_follow_up_count"
    | "repeated_local_review_signature_count"
    | "processed_review_thread_ids"
    | "processed_review_thread_fingerprints"
  >,
  pr: GitHubPullRequest,
  checks: PullRequestCheck[],
  reviewThreads: ReviewThread[],
  manualReviewThreads: (config: SupervisorConfig, reviewThreads: ReviewThread[]) => ReviewThread[],
  configuredBotReviewThreads: (config: SupervisorConfig, reviewThreads: ReviewThread[]) => ReviewThread[],
  summarizeChecks: (checks: PullRequestCheck[]) => { hasFailing: boolean; hasPending: boolean },
  mergeConflictDetected: (pr: GitHubPullRequest) => boolean,
): boolean {
  const checkSummary = summarizeChecks(checks);
  const manualThreads = manualReviewThreads(config, reviewThreads);
  const unresolvedBotThreads = configuredBotReviewThreads(config, reviewThreads);
  return (
    (
      localReviewHighSeverityNeedsRetry(config, record, pr) ||
      localReviewFollowUpNeedsRepair(config, record, pr) ||
      localReviewManualReviewNeedsRepair(config, record, pr)
    ) &&
    !checkSummary.hasFailing &&
    !checkSummary.hasPending &&
    unresolvedBotThreads.length === 0 &&
    (!config.humanReviewBlocksMerge || manualThreads.length === 0) &&
    !mergeConflictDetected(pr)
  );
}

export function localReviewRetryLoopStalled(
  config: SupervisorConfig,
  record: Pick<
    IssueRunRecord,
    | "local_review_head_sha"
    | "local_review_verified_max_severity"
    | "pre_merge_evaluation_outcome"
    | "pre_merge_manual_review_count"
    | "pre_merge_follow_up_count"
    | "repeated_local_review_signature_count"
    | "processed_review_thread_ids"
    | "processed_review_thread_fingerprints"
  >,
  pr: GitHubPullRequest,
  checks: PullRequestCheck[],
  reviewThreads: ReviewThread[],
  manualReviewThreads: (config: SupervisorConfig, reviewThreads: ReviewThread[]) => ReviewThread[],
  configuredBotReviewThreads: (config: SupervisorConfig, reviewThreads: ReviewThread[]) => ReviewThread[],
  summarizeChecks: (checks: PullRequestCheck[]) => { hasFailing: boolean; hasPending: boolean },
  mergeConflictDetected: (pr: GitHubPullRequest) => boolean,
): boolean {
  return (
    localReviewRetryLoopCandidate(
      config,
      record,
      pr,
      checks,
      reviewThreads,
      manualReviewThreads,
      configuredBotReviewThreads,
      summarizeChecks,
      mergeConflictDetected,
    ) &&
    record.repeated_local_review_signature_count >= config.sameFailureSignatureRepeatLimit
  );
}

export function localReviewHighSeverityNeedsBlock(
  config: SupervisorConfig,
  record: Pick<IssueRunRecord, "local_review_head_sha" | "local_review_verified_max_severity">,
  pr: GitHubPullRequest,
): boolean {
  return (
    config.localReviewPolicy !== "advisory" &&
    record.local_review_head_sha === pr.headRefOid &&
    record.local_review_verified_max_severity === "high" &&
    config.localReviewHighSeverityAction === "blocked"
  );
}

export function localReviewFailureSummary(
  record: Pick<
    IssueRunRecord,
    | "local_review_findings_count"
    | "local_review_root_cause_count"
    | "local_review_max_severity"
    | "local_review_verified_findings_count"
    | "local_review_verified_max_severity"
    | "local_review_degraded"
  >,
): string {
  if (record.local_review_degraded) {
    return "Local review completed in a degraded state.";
  }

  return `Local review found ${record.local_review_findings_count} actionable finding(s) across ${record.local_review_root_cause_count} root cause(s); max severity=${record.local_review_max_severity ?? "unknown"}; verified high-severity findings=${record.local_review_verified_findings_count}; verified max severity=${record.local_review_verified_max_severity ?? "none"}.`;
}

export function localReviewFailureContext(
  record: Pick<
    IssueRunRecord,
    | "local_review_findings_count"
    | "local_review_root_cause_count"
    | "local_review_max_severity"
    | "local_review_verified_findings_count"
    | "local_review_verified_max_severity"
    | "local_review_degraded"
    | "local_review_summary_path"
  >,
): FailureContext {
  return {
    category: "blocked",
    summary: localReviewFailureSummary(record),
    signature: `local-review:${record.local_review_max_severity ?? "unknown"}:${record.local_review_verified_max_severity ?? "none"}:${record.local_review_root_cause_count}:${record.local_review_verified_findings_count}:${record.local_review_degraded ? "degraded" : "clean"}`,
    command: null,
    details: [
      `findings=${record.local_review_findings_count}`,
      `root_causes=${record.local_review_root_cause_count}`,
      record.local_review_summary_path ? `summary=${record.local_review_summary_path}` : "summary=none",
    ],
    url: null,
    updated_at: nowIso(),
  };
}

export function localReviewStallFailureContext(
  record: Pick<
    IssueRunRecord,
    | "local_review_findings_count"
    | "local_review_root_cause_count"
    | "local_review_max_severity"
    | "local_review_verified_findings_count"
    | "local_review_verified_max_severity"
    | "local_review_degraded"
    | "local_review_summary_path"
    | "repeated_local_review_signature_count"
  >,
): FailureContext {
  return {
    ...localReviewFailureContext(record),
    summary:
      `Local review findings repeated without code changes ${record.repeated_local_review_signature_count} times; manual intervention is required.`,
    signature:
      `local-review-stalled:${record.local_review_max_severity ?? "unknown"}:` +
      `${record.local_review_root_cause_count}:${record.local_review_degraded ? "degraded" : "clean"}`,
    details: [
      `findings=${record.local_review_findings_count}`,
      `root_causes=${record.local_review_root_cause_count}`,
      `repeated_local_review_signature_count=${record.repeated_local_review_signature_count}`,
      record.local_review_summary_path ? `summary=${record.local_review_summary_path}` : "summary=none",
    ],
  };
}

export function nextLocalReviewSignatureTracking(
  record: Pick<IssueRunRecord, "local_review_head_sha" | "last_local_review_signature" | "repeated_local_review_signature_count">,
  prHeadSha: string,
  actionableSignature: string | null,
): Pick<IssueRunRecord, "last_local_review_signature" | "repeated_local_review_signature_count"> {
  if (!actionableSignature) {
    return {
      last_local_review_signature: null,
      repeated_local_review_signature_count: 0,
    };
  }

  const sameHead = record.local_review_head_sha === prHeadSha;
  const sameSignature = record.last_local_review_signature === actionableSignature;
  return {
    last_local_review_signature: actionableSignature,
    repeated_local_review_signature_count:
      sameHead && sameSignature ? record.repeated_local_review_signature_count + 1 : 1,
  };
}
