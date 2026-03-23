import { displayRelativeArtifactPath } from "./supervisor-status-summary-helpers";
import {
  configuredBotInitialGraceWaitWindow,
  configuredBotSettledWaitWindow,
} from "./supervisor-status-review-bot";
import {
  getStaleStabilizingNoPrRecoveryCount,
  STALE_STABILIZING_NO_PR_RECOVERY_SIGNATURE,
} from "../no-pull-request-state";
import type { GitHubPullRequest, IssueRunRecord, RunState, SupervisorConfig } from "../core/types";

export interface SupervisorLatestRecoveryDto {
  issueNumber: number;
  at: string;
  reason: string;
  detail: string | null;
}

export interface SupervisorReviewWaitDto {
  kind: "configured_bot_initial_grace_wait" | "configured_bot_settled_wait";
  status: "active";
  provider: "coderabbit";
  pauseReason: string;
  recentObservation: string;
  observedAt: string | null;
  configuredWaitSeconds: number | null;
  waitUntil: string | null;
}

export interface SupervisorRetryContextDto {
  timeoutRetryCount: number;
  blockedVerificationRetryCount: number;
  repeatedBlockerCount: number;
  repeatedFailureSignatureCount: number;
  lastFailureSignature: string | null;
}

export interface SupervisorRepeatedRecoveryDto {
  kind: "stale_stabilizing_no_pr";
  repeatCount: number;
  repeatLimit: number;
  status: "retrying" | "manual_review_required";
  action: "confirm_whether_the_change_already_landed_or_retarget_the_issue_manually";
  lastFailureSignature: string;
}

export interface SupervisorPhaseChangeDto {
  at: string;
  from: RunState;
  to: RunState;
  reason: string;
  source: "recovery";
}

export interface SupervisorIssueActivityContextDto {
  handoffSummary: string | null;
  localReviewRoutingSummary: string | null;
  changeClassesSummary: string | null;
  verificationPolicySummary: string | null;
  durableGuardrailSummary: string | null;
  externalReviewFollowUpSummary: string | null;
  latestRecovery: SupervisorLatestRecoveryDto | null;
  retryContext: SupervisorRetryContextDto;
  repeatedRecovery: SupervisorRepeatedRecoveryDto | null;
  recentPhaseChanges: SupervisorPhaseChangeDto[];
  localReviewSummaryPath: string | null;
  externalReviewMissesPath: string | null;
  reviewWaits: SupervisorReviewWaitDto[];
}

type ActivityRecord = Pick<
  IssueRunRecord,
  | "issue_number"
  | "last_recovery_reason"
  | "last_recovery_at"
  | "local_review_summary_path"
  | "external_review_misses_path"
  | "review_wait_started_at"
  | "review_wait_head_sha"
  | "timeout_retry_count"
  | "blocked_verification_retry_count"
  | "repeated_blocker_count"
  | "repeated_failure_signature_count"
  | "last_failure_signature"
  | "state"
  | "blocked_reason"
>;

const RUN_STATE_VALUES: RunState[] = [
  "queued",
  "planning",
  "reproducing",
  "implementing",
  "local_review_fix",
  "stabilizing",
  "draft_pr",
  "local_review",
  "pr_open",
  "repairing_ci",
  "resolving_conflict",
  "waiting_ci",
  "addressing_review",
  "ready_to_merge",
  "merging",
  "done",
  "blocked",
  "failed",
];

export function buildLatestRecoveryDto(
  record: Pick<IssueRunRecord, "issue_number" | "last_recovery_reason" | "last_recovery_at">,
): SupervisorLatestRecoveryDto | null {
  if (!record.last_recovery_reason || !record.last_recovery_at) {
    return null;
  }

  const separatorIndex = record.last_recovery_reason.indexOf(":");
  const reason =
    separatorIndex >= 0
      ? record.last_recovery_reason.slice(0, separatorIndex).trim()
      : record.last_recovery_reason.trim();
  const detail =
    separatorIndex >= 0
      ? record.last_recovery_reason.slice(separatorIndex + 1).trim() || null
      : null;

  return {
    issueNumber: record.issue_number,
    at: record.last_recovery_at,
    reason,
    detail,
  };
}

export function buildReviewWaitDtos(
  config: SupervisorConfig,
  record: Pick<IssueRunRecord, "review_wait_started_at" | "review_wait_head_sha">,
  pr: GitHubPullRequest | null,
): SupervisorReviewWaitDto[] {
  if (!pr) {
    return [];
  }

  const reviewWaits: SupervisorReviewWaitDto[] = [];
  const initialGraceWait = configuredBotInitialGraceWaitWindow(config, pr, record);
  if (initialGraceWait.status === "active" && initialGraceWait.provider === "coderabbit") {
    reviewWaits.push({
      kind: "configured_bot_initial_grace_wait",
      status: "active",
      provider: "coderabbit",
      pauseReason: initialGraceWait.pauseReason,
      recentObservation: initialGraceWait.recentObservation,
      observedAt: initialGraceWait.observedAt,
      configuredWaitSeconds: initialGraceWait.configuredWaitSeconds,
      waitUntil: initialGraceWait.waitUntil,
    });
  }

  const settledWait = configuredBotSettledWaitWindow(config, pr);
  if (settledWait.status === "active" && settledWait.provider === "coderabbit") {
    reviewWaits.push({
      kind: "configured_bot_settled_wait",
      status: "active",
      provider: "coderabbit",
      pauseReason: settledWait.pauseReason,
      recentObservation: settledWait.recentObservation,
      observedAt: settledWait.observedAt,
      configuredWaitSeconds: settledWait.configuredWaitSeconds,
      waitUntil: settledWait.waitUntil,
    });
  }

  return reviewWaits;
}

export function buildRetryContextDto(
  record: Pick<
    IssueRunRecord,
    | "timeout_retry_count"
    | "blocked_verification_retry_count"
    | "repeated_blocker_count"
    | "repeated_failure_signature_count"
    | "last_failure_signature"
  >,
): SupervisorRetryContextDto {
  return {
    timeoutRetryCount: record.timeout_retry_count,
    blockedVerificationRetryCount: record.blocked_verification_retry_count,
    repeatedBlockerCount: record.repeated_blocker_count,
    repeatedFailureSignatureCount: record.repeated_failure_signature_count,
    lastFailureSignature: record.last_failure_signature,
  };
}

export function buildRepeatedRecoveryDto(
  config: Pick<SupervisorConfig, "sameFailureSignatureRepeatLimit">,
  record: Pick<
    IssueRunRecord,
    | "blocked_reason"
    | "last_failure_signature"
    | "repeated_failure_signature_count"
    | "stale_stabilizing_no_pr_recovery_count"
  >,
): SupervisorRepeatedRecoveryDto | null {
  const repeatCount = getStaleStabilizingNoPrRecoveryCount(record);
  if (record.last_failure_signature !== STALE_STABILIZING_NO_PR_RECOVERY_SIGNATURE || repeatCount <= 0) {
    return null;
  }

  const repeatLimit = Math.max(config.sameFailureSignatureRepeatLimit, 1);
  return {
    kind: "stale_stabilizing_no_pr",
    repeatCount,
    repeatLimit,
    status: record.blocked_reason === "manual_review" || repeatCount >= repeatLimit ? "manual_review_required" : "retrying",
    action: "confirm_whether_the_change_already_landed_or_retarget_the_issue_manually",
    lastFailureSignature: STALE_STABILIZING_NO_PR_RECOVERY_SIGNATURE,
  };
}

function parsePhaseChangeStates(detail: string | null): Pick<SupervisorPhaseChangeDto, "from" | "to"> | null {
  if (!detail) {
    return null;
  }

  const match = detail.match(/\bfrom\s+([a-z_]+)\s+to\s+([a-z_]+)/i);
  if (!match) {
    return null;
  }

  const from = match[1]?.toLowerCase() as RunState;
  const to = match[2]?.toLowerCase() as RunState;
  if (!RUN_STATE_VALUES.includes(from) || !RUN_STATE_VALUES.includes(to)) {
    return null;
  }

  return { from, to };
}

export function buildRecentPhaseChangesDto(
  record: Pick<IssueRunRecord, "last_recovery_reason" | "last_recovery_at">,
): SupervisorPhaseChangeDto[] {
  const latestRecovery = buildLatestRecoveryDto({
    issue_number: 0,
    last_recovery_reason: record.last_recovery_reason,
    last_recovery_at: record.last_recovery_at,
  });
  const parsedChange = parsePhaseChangeStates(latestRecovery?.detail ?? null);
  if (!latestRecovery || !parsedChange) {
    return [];
  }

  return [
    {
      at: latestRecovery.at,
      from: parsedChange.from,
      to: parsedChange.to,
      reason: latestRecovery.reason,
      source: "recovery",
    },
  ];
}

export function buildIssueActivityContext(args: {
  config: SupervisorConfig;
  record: ActivityRecord;
  pr: GitHubPullRequest | null;
  handoffSummary?: string | null;
  localReviewRoutingSummary?: string | null;
  changeClassesSummary?: string | null;
  verificationPolicySummary?: string | null;
  durableGuardrailSummary?: string | null;
  externalReviewFollowUpSummary?: string | null;
}): SupervisorIssueActivityContextDto {
  return {
    handoffSummary: args.handoffSummary ?? null,
    localReviewRoutingSummary: args.localReviewRoutingSummary ?? null,
    changeClassesSummary: args.changeClassesSummary ?? null,
    verificationPolicySummary: args.verificationPolicySummary ?? null,
    durableGuardrailSummary: args.durableGuardrailSummary ?? null,
    externalReviewFollowUpSummary: args.externalReviewFollowUpSummary ?? null,
    latestRecovery: buildLatestRecoveryDto(args.record),
    retryContext: buildRetryContextDto(args.record),
    repeatedRecovery: buildRepeatedRecoveryDto(args.config, args.record),
    recentPhaseChanges: buildRecentPhaseChangesDto(args.record),
    localReviewSummaryPath: args.record.local_review_summary_path
      ? displayRelativeArtifactPath(args.config, args.record.local_review_summary_path)
      : null,
    externalReviewMissesPath: args.record.external_review_misses_path
      ? displayRelativeArtifactPath(args.config, args.record.external_review_misses_path)
      : null,
    reviewWaits: buildReviewWaitDtos(args.config, args.record, args.pr),
  };
}

export function maybeBuildIssueActivityContext(args: {
  config: SupervisorConfig;
  record: ActivityRecord;
  pr: GitHubPullRequest | null;
  handoffSummary?: string | null;
  localReviewRoutingSummary?: string | null;
  changeClassesSummary?: string | null;
  verificationPolicySummary?: string | null;
  durableGuardrailSummary?: string | null;
  externalReviewFollowUpSummary?: string | null;
}): SupervisorIssueActivityContextDto | null {
  const context = buildIssueActivityContext(args);
  const hasSummary =
    context.handoffSummary !== null ||
    context.localReviewRoutingSummary !== null ||
    context.changeClassesSummary !== null ||
    context.verificationPolicySummary !== null ||
    context.durableGuardrailSummary !== null ||
    context.externalReviewFollowUpSummary !== null ||
    context.latestRecovery !== null ||
    context.retryContext.timeoutRetryCount > 0 ||
    context.retryContext.blockedVerificationRetryCount > 0 ||
    context.retryContext.repeatedBlockerCount > 0 ||
    context.retryContext.repeatedFailureSignatureCount > 0 ||
    context.retryContext.lastFailureSignature !== null ||
    context.repeatedRecovery !== null ||
    context.recentPhaseChanges.length > 0 ||
    context.localReviewSummaryPath !== null ||
    context.externalReviewMissesPath !== null ||
    context.reviewWaits.length > 0;

  return hasSummary ? context : null;
}
