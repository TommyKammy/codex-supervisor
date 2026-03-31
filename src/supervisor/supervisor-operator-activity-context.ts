import { displayRelativeArtifactPath } from "./supervisor-status-summary-helpers";
import {
  configuredBotInitialGraceWaitWindow,
  configuredBotSettledWaitWindow,
} from "./supervisor-status-review-bot";
import {
  getStaleStabilizingNoPrRecoveryCount,
  STALE_STABILIZING_NO_PR_RECOVERY_SIGNATURE,
} from "../no-pull-request-state";
import type { GitHubPullRequest, IssueRunRecord, LatestLocalCiResult, RunState, SupervisorConfig } from "../core/types";
import type { SupervisorPreMergeEvaluationDto } from "./supervisor-pre-merge-evaluation";

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
  preMergeEvaluation?: SupervisorPreMergeEvaluationDto | null;
  localCiStatus: SupervisorLocalCiStatusDto | null;
  latestRecovery: SupervisorLatestRecoveryDto | null;
  retryContext: SupervisorRetryContextDto;
  repeatedRecovery: SupervisorRepeatedRecoveryDto | null;
  recentPhaseChanges: SupervisorPhaseChangeDto[];
  localReviewSummaryPath: string | null;
  externalReviewMissesPath: string | null;
  reviewWaits: SupervisorReviewWaitDto[];
}

export interface SupervisorLocalCiStatusDto {
  outcome: LatestLocalCiResult["outcome"];
  summary: string;
  ranAt: string;
  headSha: string | null;
  headStatus: "current" | "stale" | "unknown";
  context: "blocking" | "warning" | "notice";
  failureClass: LatestLocalCiResult["failure_class"];
  remediationTarget: LatestLocalCiResult["remediation_target"];
}

function isLocalCiBlockingFailureSignature(signature: string | null): boolean {
  return (
    signature === "local-ci-gate-failed" ||
    signature === "local-ci-gate-missing_command" ||
    signature === "local-ci-gate-workspace_toolchain_missing" ||
    signature === "local-ci-gate-non_zero_exit"
  );
}

function retrySummaryHasLoopRisk(context: Pick<SupervisorIssueActivityContextDto, "retryContext" | "repeatedRecovery">): boolean {
  return (
    context.repeatedRecovery !== null ||
    context.retryContext.repeatedBlockerCount > 1 ||
    context.retryContext.repeatedFailureSignatureCount > 1
  );
}

export function formatRetrySummaryLine(
  context: SupervisorIssueActivityContextDto | null,
): string | null {
  if (!context) {
    return null;
  }

  const parts: string[] = [];
  if (context.retryContext.timeoutRetryCount > 0) {
    parts.push(`timeout=${context.retryContext.timeoutRetryCount}`);
  }
  if (context.retryContext.blockedVerificationRetryCount > 0) {
    parts.push(`verification=${context.retryContext.blockedVerificationRetryCount}`);
  }
  if (context.retryContext.repeatedBlockerCount > 1) {
    parts.push(`same_blocker=${context.retryContext.repeatedBlockerCount}`);
  }
  if (context.retryContext.repeatedFailureSignatureCount > 1) {
    parts.push(`same_failure_signature=${context.retryContext.repeatedFailureSignatureCount}`);
  }

  if (parts.length === 0) {
    return null;
  }

  if (context.retryContext.lastFailureSignature) {
    parts.push(`last_failure_signature=${context.retryContext.lastFailureSignature}`);
  }
  parts.push(`apparent_no_progress=${retrySummaryHasLoopRisk(context) ? "yes" : "watch"}`);
  return `retry_summary ${parts.join(" ")}`;
}

export function formatRecoveryLoopSummaryLine(
  context: SupervisorIssueActivityContextDto | null,
): string | null {
  if (!context) {
    return null;
  }

  if (context.repeatedRecovery) {
    return [
      "recovery_loop_summary",
      `kind=${context.repeatedRecovery.kind}`,
      `status=${context.repeatedRecovery.status}`,
      `repeat_count=${context.repeatedRecovery.repeatCount}/${context.repeatedRecovery.repeatLimit}`,
      `action=${context.repeatedRecovery.action}`,
      "apparent_no_progress=yes",
    ].join(" ");
  }

  const latestReason = context.latestRecovery?.reason ?? null;
  const phaseChange = context.recentPhaseChanges[0] ?? null;
  if (!latestReason || !phaseChange || !retrySummaryHasLoopRisk(context)) {
    return null;
  }

  return [
    "recovery_loop_summary",
    `latest_reason=${latestReason}`,
    `phase_change=${phaseChange.from}->${phaseChange.to}`,
    "apparent_no_progress=yes",
  ].join(" ");
}

export function formatLocalCiStatusLine(
  context: SupervisorIssueActivityContextDto | null,
): string | null {
  const localCiStatus = context?.localCiStatus ?? null;
  if (!localCiStatus) {
    return null;
  }

  return [
    "local_ci_result",
    `outcome=${localCiStatus.outcome}`,
    `context=${localCiStatus.context}`,
    `failure_class=${localCiStatus.failureClass ?? "none"}`,
    `remediation_target=${localCiStatus.remediationTarget ?? "none"}`,
    `head=${localCiStatus.headStatus}`,
    `head_sha=${localCiStatus.headSha ?? "none"}`,
    `ran_at=${localCiStatus.ranAt}`,
    `summary=${localCiStatus.summary.replace(/\r?\n/g, "\\n")}`,
  ].join(" ");
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
  | "latest_local_ci_result"
  | "last_head_sha"
  | "timeout_retry_count"
  | "blocked_verification_retry_count"
  | "repeated_blocker_count"
  | "repeated_failure_signature_count"
  | "last_failure_signature"
  | "state"
  | "blocked_reason"
>;

function buildLocalCiStatusDto(
  record: Pick<IssueRunRecord, "latest_local_ci_result" | "last_head_sha" | "blocked_reason" | "last_failure_signature">,
  pr: GitHubPullRequest | null,
): SupervisorLocalCiStatusDto | null {
  const result = record.latest_local_ci_result ?? null;
  if (!result) {
    return null;
  }

  const currentHeadSha = pr?.headRefOid ?? record.last_head_sha ?? null;
  const headStatus =
    result.head_sha === null || currentHeadSha === null
      ? "unknown"
      : result.head_sha === currentHeadSha
        ? "current"
        : "stale";
  const context =
    result.outcome === "passed"
      ? "notice"
      : result.outcome === "not_configured"
        ? "notice"
        : record.blocked_reason === "verification" && isLocalCiBlockingFailureSignature(record.last_failure_signature)
        ? "blocking"
        : "warning";

  return {
    outcome: result.outcome,
    summary: result.summary,
    ranAt: result.ran_at,
    headSha: result.head_sha,
    headStatus,
    context,
    failureClass: result.failure_class,
    remediationTarget: result.remediation_target,
  };
}

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
  preMergeEvaluation?: SupervisorPreMergeEvaluationDto | null;
}): SupervisorIssueActivityContextDto {
  return {
    handoffSummary: args.handoffSummary ?? null,
    localReviewRoutingSummary: args.localReviewRoutingSummary ?? null,
    changeClassesSummary: args.changeClassesSummary ?? null,
    verificationPolicySummary: args.verificationPolicySummary ?? null,
    durableGuardrailSummary: args.durableGuardrailSummary ?? null,
    externalReviewFollowUpSummary: args.externalReviewFollowUpSummary ?? null,
    preMergeEvaluation: args.preMergeEvaluation ?? null,
    localCiStatus: buildLocalCiStatusDto(args.record, args.pr),
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
  preMergeEvaluation?: SupervisorPreMergeEvaluationDto | null;
}): SupervisorIssueActivityContextDto | null {
  const context = buildIssueActivityContext(args);
  const hasSummary =
    context.handoffSummary !== null ||
    context.localReviewRoutingSummary !== null ||
    context.changeClassesSummary !== null ||
    context.verificationPolicySummary !== null ||
    context.durableGuardrailSummary !== null ||
    context.externalReviewFollowUpSummary !== null ||
    context.preMergeEvaluation !== null ||
    context.localCiStatus !== null ||
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
