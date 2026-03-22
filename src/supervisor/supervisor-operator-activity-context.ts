import { displayRelativeArtifactPath } from "./supervisor-status-summary-helpers";
import {
  configuredBotInitialGraceWaitWindow,
  configuredBotSettledWaitWindow,
} from "./supervisor-status-review-bot";
import type { GitHubPullRequest, IssueRunRecord, SupervisorConfig } from "../core/types";

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

export interface SupervisorIssueActivityContextDto {
  handoffSummary: string | null;
  localReviewRoutingSummary: string | null;
  changeClassesSummary: string | null;
  verificationPolicySummary: string | null;
  durableGuardrailSummary: string | null;
  externalReviewFollowUpSummary: string | null;
  latestRecovery: SupervisorLatestRecoveryDto | null;
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
>;

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
    context.localReviewSummaryPath !== null ||
    context.externalReviewMissesPath !== null ||
    context.reviewWaits.length > 0;

  return hasSummary ? context : null;
}
