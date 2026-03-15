import {
  localReviewRetryLoopStalled,
} from "./review-handling";
import {
  displayRelativeArtifactPath,
  formatRecentRecord,
  listChecksByBucket,
  localReviewHeadDetails,
  localReviewIsGating,
  summarizeCheckBuckets,
} from "./supervisor-status-summary-helpers";
import {
  configuredBotRateLimitWaitWindow,
  configuredBotTopLevelReviewEffect,
  configuredReviewBots,
  configuredReviewStatusLabel,
  inferReviewBotProfile,
  reviewBotDiagnostics,
} from "./supervisor-status-review-bot";
import { GitHubPullRequest, IssueRunRecord, PullRequestCheck, ReviewThread, SupervisorConfig } from "./types";
import { truncate } from "./utils";

type ReviewThreadClassifier = (config: SupervisorConfig, reviewThreads: ReviewThread[]) => ReviewThread[];
type PendingReviewThreadClassifier = (
  config: SupervisorConfig,
  record: Pick<
    IssueRunRecord,
    "processed_review_thread_ids" | "processed_review_thread_fingerprints" | "last_head_sha"
  >,
  pr: Pick<GitHubPullRequest, "headRefOid">,
  reviewThreads: ReviewThread[],
) => ReviewThread[];
type CheckSummaryFn = (
  checks: PullRequestCheck[],
) => { allPassing: boolean; hasPending: boolean; hasFailing: boolean };
type MergeConflictDetector = (pr: GitHubPullRequest) => boolean;

export interface BuildDetailedStatusModelArgs {
  config: SupervisorConfig;
  activeRecord: IssueRunRecord | null;
  latestRecord: IssueRunRecord | null;
  trackedIssueCount: number;
  pr: GitHubPullRequest | null;
  checks: PullRequestCheck[];
  reviewThreads: ReviewThread[];
  latestRecoveryRecord?: IssueRunRecord | null;
  manualReviewThreads: ReviewThreadClassifier;
  configuredBotReviewThreads: ReviewThreadClassifier;
  pendingBotReviewThreads: PendingReviewThreadClassifier;
  summarizeChecks: CheckSummaryFn;
  mergeConflictDetected: MergeConflictDetector;
}

export interface BuildDetailedStatusSummaryLinesArgs {
  config: SupervisorConfig;
  activeRecord: IssueRunRecord | null;
  latestRecoveryRecord?: IssueRunRecord | null;
  handoffSummary?: string | null;
  durableGuardrailSummary?: string | null;
}

function unresolvedReviewThreads(reviewThreads: ReviewThread[]): ReviewThread[] {
  return reviewThreads.filter((thread) => !thread.isResolved && !thread.isOutdated);
}

export function sanitizeStatusValue(value: string | null | undefined): string | null {
  if (!value) {
    return null;
  }

  return value.replace(/\r?\n/g, "\\n");
}

export function buildDetailedStatusModel(args: BuildDetailedStatusModelArgs): string[] {
  const {
    config,
    activeRecord,
    latestRecord,
    latestRecoveryRecord = null,
    trackedIssueCount,
    pr,
    checks,
    reviewThreads,
    manualReviewThreads,
    configuredBotReviewThreads,
    pendingBotReviewThreads,
    summarizeChecks,
    mergeConflictDetected,
  } = args;

  if (!activeRecord) {
    const lines = [
      "No active issue.",
      `tracked_issues=${trackedIssueCount}`,
      `latest_record=${formatRecentRecord(latestRecord)}`,
    ];

    if (latestRecoveryRecord?.last_recovery_reason && latestRecoveryRecord.last_recovery_at) {
      lines.push(
        `latest_recovery issue=#${latestRecoveryRecord.issue_number} at=${latestRecoveryRecord.last_recovery_at} reason=${sanitizeStatusValue(latestRecoveryRecord.last_recovery_reason)}`,
      );
    }

    return lines;
  }

  const localReviewHead = localReviewHeadDetails(activeRecord, pr);
  const localReviewGating = localReviewIsGating(config, activeRecord, pr) ? "yes" : "no";
  const localReviewStalled =
    pr &&
    localReviewRetryLoopStalled(
      config,
      activeRecord,
      pr,
      checks,
      reviewThreads,
      manualReviewThreads,
      configuredBotReviewThreads,
      summarizeChecks,
      mergeConflictDetected,
    )
      ? "yes"
      : "no";
  const externalReviewHeadStatus =
    !activeRecord.external_review_head_sha
      ? "none"
      : pr
        ? activeRecord.external_review_head_sha === pr.headRefOid
          ? "current"
          : "stale"
        : "unknown";
  const lines = [
    `issue=#${activeRecord.issue_number}`,
    `state=${activeRecord.state}`,
    `branch=${activeRecord.branch}`,
    `pr=${activeRecord.pr_number ?? "none"}`,
    `attempts=${activeRecord.attempt_count}`,
    `implementation_attempts=${activeRecord.implementation_attempt_count}`,
    `repair_attempts=${activeRecord.repair_attempt_count}`,
    `updated_at=${activeRecord.updated_at}`,
    `workspace=${activeRecord.workspace}`,
    `blocked_reason=${activeRecord.blocked_reason ?? "none"}`,
    `last_failure_kind=${activeRecord.last_failure_kind ?? "none"}`,
    `last_failure_signature=${activeRecord.last_failure_signature ?? "none"}`,
    `retries timeout=${activeRecord.timeout_retry_count} verification=${activeRecord.blocked_verification_retry_count} same_blocker=${activeRecord.repeated_blocker_count} same_failure_signature=${activeRecord.repeated_failure_signature_count}`,
    `local_review gating=${localReviewGating} policy=${config.localReviewPolicy} findings=${activeRecord.local_review_findings_count} root_causes=${activeRecord.local_review_root_cause_count} max_severity=${activeRecord.local_review_max_severity ?? "none"} verified_findings=${activeRecord.local_review_verified_findings_count} verified_max_severity=${activeRecord.local_review_verified_max_severity ?? "none"} head=${localReviewHead.status} reviewed_head_sha=${localReviewHead.reviewedHeadSha} pr_head_sha=${localReviewHead.prHeadSha} ran_at=${activeRecord.local_review_run_at ?? "none"}${localReviewGating === "yes" && activeRecord.local_review_blocker_summary ? ` blocker_summary=${truncate(sanitizeStatusValue(activeRecord.local_review_blocker_summary), 160)}` : ""}${localReviewHead.driftSuffix} signature=${activeRecord.last_local_review_signature ?? "none"} repeated=${activeRecord.repeated_local_review_signature_count} stalled=${localReviewStalled}`,
    `external_review head=${externalReviewHeadStatus} reviewed_head_sha=${activeRecord.external_review_head_sha ?? "none"} matched=${activeRecord.external_review_matched_findings_count} near_match=${activeRecord.external_review_near_match_findings_count} missed=${activeRecord.external_review_missed_findings_count}`,
  ];

  if (activeRecord.last_error) {
    lines.push(`last_error=${truncate(sanitizeStatusValue(activeRecord.last_error), 300)}`);
  }

  if (pr) {
    const reviewBotProfile = inferReviewBotProfile(config);
    const reviewBotStatus = reviewBotDiagnostics(config, activeRecord, pr, reviewThreads, configuredBotReviewThreads);
    const copilotReviewState = pr.copilotReviewState === null ? "unknown" : (pr.copilotReviewState ?? "not_requested");
    const reviewStatusLabel = configuredReviewStatusLabel(config);
    const reviewers = configuredReviewBots(config);
    const reviewersSuffix =
      reviewStatusLabel === "configured_bot_review" && reviewers.length > 0 ? ` reviewers=${reviewers.join(",")}` : "";
    lines.push(
      `review_bot_profile profile=${reviewBotProfile.profile} provider=${reviewBotProfile.provider} reviewers=${reviewBotProfile.reviewers.length > 0 ? reviewBotProfile.reviewers.join(",") : "none"} signal_source=${reviewBotProfile.signalSource}`,
    );
    lines.push(
      `review_bot_diagnostics status=${reviewBotStatus.status} observed_review=${reviewBotStatus.observedReview} expected_reviewers=${reviewBotProfile.reviewers.length > 0 ? reviewBotProfile.reviewers.join(",") : "none"} next_check=${reviewBotStatus.nextCheck}`,
    );
    lines.push(
      `${reviewStatusLabel} state=${copilotReviewState}${reviewersSuffix} requested_at=${pr.copilotReviewRequestedAt ?? "none"} arrived_at=${pr.copilotReviewArrivedAt ?? "none"} timed_out_at=${activeRecord.copilot_review_timed_out_at ?? "none"} timeout_action=${activeRecord.copilot_review_timeout_action ?? "none"}`,
    );
    lines.push(
      `configured_bot_top_level_review strength=${pr.configuredBotTopLevelReviewStrength ?? "none"} submitted_at=${pr.configuredBotTopLevelReviewSubmittedAt ?? "none"} effect=${configuredBotTopLevelReviewEffect(config, pr, reviewThreads, configuredBotReviewThreads)}`,
    );
    const configuredBotRateLimit = configuredBotRateLimitWaitWindow(config, pr);
    if (configuredBotRateLimit.observedAt) {
      lines.push(
        `configured_bot_rate_limit status=${configuredBotRateLimit.status} observed_at=${configuredBotRateLimit.observedAt} wait_until=${configuredBotRateLimit.waitUntil ?? "none"}`,
      );
    }
    if (activeRecord.copilot_review_timeout_reason) {
      lines.push(`timeout_reason=${sanitizeStatusValue(activeRecord.copilot_review_timeout_reason)}`);
    }
    lines.push(
      `pr_state=${pr.state} draft=${pr.isDraft ? "yes" : "no"} merge_state=${pr.mergeStateStatus ?? "unknown"} review_decision=${pr.reviewDecision ?? "none"} head_sha=${pr.headRefOid}`,
    );
    lines.push(`checks=${summarizeCheckBuckets(checks)}`);
    const failingChecks = listChecksByBucket(checks, "fail");
    if (failingChecks) {
      lines.push(`failing_checks=${failingChecks}`);
    }
    const pendingChecks = listChecksByBucket(checks, "pending");
    if (pendingChecks) {
      lines.push(`pending_checks=${pendingChecks}`);
    }
    const unresolvedConfiguredBotThreads = unresolvedReviewThreads(configuredBotReviewThreads(config, reviewThreads));
    lines.push(
      `review_threads bot_pending=${pendingBotReviewThreads(config, activeRecord, pr, reviewThreads).length} bot_unresolved=${unresolvedConfiguredBotThreads.length} manual=${manualReviewThreads(config, reviewThreads).length}`,
    );
  }

  if (activeRecord.last_failure_context) {
    lines.push(
      `failure_context category=${activeRecord.last_failure_context.category ?? "none"} summary=${truncate(sanitizeStatusValue(activeRecord.last_failure_context.summary), 200) ?? "none"}`,
    );
    if (activeRecord.last_failure_context.details.length > 0) {
      lines.push(
        `failure_details=${truncate(sanitizeStatusValue(activeRecord.last_failure_context.details.join(" | ")), 300) ?? "none"}`,
      );
    }
  }

  return lines;
}

export function buildDetailedStatusSummaryLines(args: BuildDetailedStatusSummaryLinesArgs): string[] {
  const {
    config,
    activeRecord,
    latestRecoveryRecord = null,
    handoffSummary = null,
    durableGuardrailSummary = null,
  } = args;
  const lines: string[] = [];

  if (handoffSummary) {
    lines.push(`handoff_summary=${truncate(sanitizeStatusValue(handoffSummary), 200)}`);
  }

  if (durableGuardrailSummary) {
    lines.push(truncate(sanitizeStatusValue(durableGuardrailSummary), 300) ?? "");
  }

  if (activeRecord && latestRecoveryRecord?.last_recovery_reason && latestRecoveryRecord.last_recovery_at) {
    lines.push(
      `latest_recovery issue=#${latestRecoveryRecord.issue_number} at=${latestRecoveryRecord.last_recovery_at} reason=${sanitizeStatusValue(latestRecoveryRecord.last_recovery_reason)}`,
    );
  }

  if (activeRecord?.local_review_summary_path) {
    const displayedSummaryPath = displayRelativeArtifactPath(config, activeRecord.local_review_summary_path);
    lines.push(`local_review_summary_path=${truncate(sanitizeStatusValue(displayedSummaryPath), 200)}`);
  }

  if (activeRecord?.external_review_misses_path) {
    const displayedMissesPath = displayRelativeArtifactPath(config, activeRecord.external_review_misses_path);
    lines.push(`external_review_misses_path=${truncate(sanitizeStatusValue(displayedMissesPath), 200)}`);
  }

  return lines;
}
