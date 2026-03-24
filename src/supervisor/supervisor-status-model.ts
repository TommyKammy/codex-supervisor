import {
  buildActiveDetailedStatusLines,
  buildInactiveDetailedStatusLines,
  formatLatestRecoveryStatusLine,
  sanitizeStatusValue,
} from "./supervisor-detailed-status-assembly";
import { buildStaleStabilizingNoPrRecoveryWarningLine } from "../no-pull-request-state";
import {
  displayRelativeArtifactPath,
} from "./supervisor-status-summary-helpers";
import { GitHubPullRequest, IssueRunRecord, PullRequestCheck, ReviewThread, SupervisorConfig } from "../core/types";
import { truncate } from "../core/utils";
import {
  formatRecoveryLoopSummaryLine,
  formatRetrySummaryLine,
  type SupervisorIssueActivityContextDto,
} from "./supervisor-operator-activity-context";
import { formatPreMergeEvaluationStatusLine } from "./supervisor-pre-merge-evaluation";

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
  activityContext?: SupervisorIssueActivityContextDto | null;
  handoffSummary?: string | null;
  localReviewRoutingSummary?: string | null;
  changeClassesSummary?: string | null;
  verificationPolicySummary?: string | null;
  durableGuardrailSummary?: string | null;
  externalReviewFollowUpSummary?: string | null;
  executionMetricsSummaryLines?: string[];
}

export function buildDetailedStatusModel(args: BuildDetailedStatusModelArgs): string[] {
  const { activeRecord } = args;

  if (!activeRecord) {
    return buildInactiveDetailedStatusLines(args);
  }

  return buildActiveDetailedStatusLines({ ...args, activeRecord });
}

export function buildDetailedStatusSummaryLines(args: BuildDetailedStatusSummaryLinesArgs): string[] {
  const {
    config,
    activeRecord,
    latestRecoveryRecord = null,
    activityContext = null,
    handoffSummary = null,
    localReviewRoutingSummary = null,
    changeClassesSummary = null,
    verificationPolicySummary = null,
    durableGuardrailSummary = null,
    externalReviewFollowUpSummary = null,
    executionMetricsSummaryLines = [],
  } = args;
  const lines: string[] = [];

  if (handoffSummary) {
    lines.push(`handoff_summary=${truncate(sanitizeStatusValue(handoffSummary), 200)}`);
  }

  const preMergeEvaluationLine = formatPreMergeEvaluationStatusLine(activityContext?.preMergeEvaluation ?? null);
  if (preMergeEvaluationLine) {
    lines.push(preMergeEvaluationLine);
  }

  if (localReviewRoutingSummary) {
    lines.push(truncate(sanitizeStatusValue(localReviewRoutingSummary), 200) ?? "");
  }

  if (changeClassesSummary) {
    lines.push(truncate(sanitizeStatusValue(changeClassesSummary), 200) ?? "");
  }

  if (verificationPolicySummary) {
    lines.push(truncate(sanitizeStatusValue(verificationPolicySummary), 200) ?? "");
  }

  if (durableGuardrailSummary) {
    lines.push(truncate(sanitizeStatusValue(durableGuardrailSummary), 300) ?? "");
  }

  if (externalReviewFollowUpSummary) {
    lines.push(truncate(sanitizeStatusValue(externalReviewFollowUpSummary), 200) ?? "");
  }

  for (const executionMetricsSummaryLine of executionMetricsSummaryLines) {
    lines.push(truncate(sanitizeStatusValue(executionMetricsSummaryLine), 240) ?? "");
  }

  const retrySummaryLine = formatRetrySummaryLine(activityContext);
  if (retrySummaryLine) {
    lines.push(retrySummaryLine);
  }

  const recoveryLoopSummaryLine = formatRecoveryLoopSummaryLine(activityContext);
  if (recoveryLoopSummaryLine) {
    lines.push(recoveryLoopSummaryLine);
  }

  if (activeRecord && latestRecoveryRecord?.last_recovery_reason && latestRecoveryRecord.last_recovery_at) {
    const latestRecoveryLine = formatLatestRecoveryStatusLine(latestRecoveryRecord);
    if (latestRecoveryLine) {
      lines.push(latestRecoveryLine);
    }
  }

  if (activeRecord) {
    const staleRecoveryWarningLine = buildStaleStabilizingNoPrRecoveryWarningLine(activeRecord, config);
    if (staleRecoveryWarningLine) {
      lines.push(staleRecoveryWarningLine);
    }
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

export { sanitizeStatusValue };
