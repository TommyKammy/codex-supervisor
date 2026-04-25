import type { GitHubPullRequest, IssueRunRecord, PullRequestCheck, ReviewThread, SupervisorConfig } from "../core/types";
import { hasProcessedReviewThread } from "../review-handling";
import {
  configuredBotReviewFollowUpState,
  configuredBotReviewThreads,
  manualReviewThreads,
  pendingBotReviewThreads,
} from "../review-thread-reporting";

export interface StaleReviewBotRemediationDto {
  issueNumber: number;
  prNumber: number | null;
  reasonCode: "stale_review_bot";
  currentHeadSha: string;
  processedOnCurrentHead: "yes" | "no" | "unknown";
  codeCiState: "green" | "not_green" | "unknown";
  classification: "metadata_only" | "unresolved_work";
  reviewThreadUrl: string | null;
  manualNextStep: string;
  summary: string;
}

const STALE_REVIEW_BOT_MANUAL_NEXT_STEP =
  "inspect_exact_review_thread_then_resolve_or_leave_manual_note";
const STALE_REVIEW_BOT_SUMMARY =
  "code_or_ci_green_but_review_thread_metadata_unresolved";
const STALE_REVIEW_BOT_METADATA_ONLY_SUMMARY =
  "stale_configured_bot_thread_metadata_only";

function formatTokenValue(value: string): string {
  return value.replace(/\r?\n/gu, "\\n");
}

function processedOnCurrentHead(record: Pick<IssueRunRecord, "last_failure_context">): "yes" | "no" | "unknown" {
  let sawYes = false;
  let sawNo = false;

  for (const detail of record.last_failure_context?.details ?? []) {
    const match = detail.match(/\bprocessed_on_current_head=(yes|no)\b/u);
    if (match?.[1] === "yes") {
      sawYes = true;
    } else if (match?.[1] === "no") {
      sawNo = true;
    }
  }

  if (sawYes && sawNo) {
    return "unknown";
  }
  if (sawYes) {
    return "yes";
  }
  if (sawNo) {
    return "no";
  }
  return "unknown";
}

function codeCiState(
  pr: Pick<GitHubPullRequest, "currentHeadCiGreenAt"> | null,
  checks: Pick<PullRequestCheck, "bucket">[],
): StaleReviewBotRemediationDto["codeCiState"] {
  if (checks.some((check) => check.bucket === "fail" || check.bucket === "pending" || check.bucket === "cancel")) {
    return "not_green";
  }

  if (checks.length > 0 && checks.every((check) => check.bucket === "pass" || check.bucket === "skipping")) {
    return "green";
  }

  return pr?.currentHeadCiGreenAt ? "green" : "unknown";
}

function allChecksPassing(checks: Pick<PullRequestCheck, "bucket">[]): boolean {
  return checks.length > 0 && checks.every((check) => check.bucket === "pass" || check.bucket === "skipping");
}

function hasCleanMergeState(pr: GitHubPullRequest): boolean {
  return pr.state === "OPEN" && !pr.isDraft && pr.mergeStateStatus === "CLEAN" && pr.mergeable === "MERGEABLE";
}

function classifyRemediation(args: {
  config: SupervisorConfig | null;
  record: IssueRunRecord;
  pr: GitHubPullRequest | null;
  checks: PullRequestCheck[];
  reviewThreads: ReviewThread[];
}): Pick<StaleReviewBotRemediationDto, "classification" | "summary"> {
  const unresolvedWork = {
    classification: "unresolved_work" as const,
    summary: STALE_REVIEW_BOT_SUMMARY,
  };
  if (!args.config || !args.pr) {
    return unresolvedWork;
  }

  const { config, record, pr, checks, reviewThreads } = args;
  const configuredThreads = configuredBotReviewThreads(config, reviewThreads);
  if (
    configuredThreads.length === 0 ||
    manualReviewThreads(config, reviewThreads).length > 0 ||
    record.last_head_sha !== pr.headRefOid ||
    pr.configuredBotCurrentHeadStatusState !== "SUCCESS" ||
    !allChecksPassing(checks) ||
    !hasCleanMergeState(pr) ||
    pendingBotReviewThreads(config, record, pr, configuredThreads).length > 0 ||
    configuredBotReviewFollowUpState(config, record, pr, configuredThreads) === "eligible" ||
    !configuredThreads.every((thread) => hasProcessedReviewThread(record, pr, thread))
  ) {
    return unresolvedWork;
  }

  return {
    classification: "metadata_only",
    summary: STALE_REVIEW_BOT_METADATA_ONLY_SUMMARY,
  };
}

export function buildStaleReviewBotRemediation(args: {
  config?: SupervisorConfig | null;
  record: IssueRunRecord;
  pr: GitHubPullRequest | null;
  checks: PullRequestCheck[];
  reviewThreads?: ReviewThread[];
}): StaleReviewBotRemediationDto | null {
  if (args.record.blocked_reason !== "stale_review_bot") {
    return null;
  }

  const currentHeadSha = args.pr?.headRefOid ?? args.record.last_head_sha;
  if (!currentHeadSha) {
    return null;
  }
  const classification = classifyRemediation({
    config: args.config ?? null,
    record: args.record,
    pr: args.pr,
    checks: args.checks,
    reviewThreads: args.reviewThreads ?? [],
  });

  return {
    issueNumber: args.record.issue_number,
    prNumber: args.record.pr_number,
    reasonCode: "stale_review_bot",
    currentHeadSha,
    processedOnCurrentHead: processedOnCurrentHead(args.record),
    codeCiState: codeCiState(args.pr, args.checks),
    classification: classification.classification,
    reviewThreadUrl: args.record.last_failure_context?.url ?? null,
    manualNextStep: STALE_REVIEW_BOT_MANUAL_NEXT_STEP,
    summary: classification.summary,
  };
}

export function formatStaleReviewBotRemediationLine(remediation: StaleReviewBotRemediationDto): string {
  return [
    "stale_review_bot_remediation",
    `issue=#${remediation.issueNumber}`,
    `pr=${remediation.prNumber === null ? "none" : `#${remediation.prNumber}`}`,
    `reason=${remediation.reasonCode}`,
    `code_ci=${remediation.codeCiState}`,
    `current_head_sha=${formatTokenValue(remediation.currentHeadSha)}`,
    `processed_on_current_head=${remediation.processedOnCurrentHead}`,
    `classification=${remediation.classification}`,
    `review_thread_url=${remediation.reviewThreadUrl ? formatTokenValue(remediation.reviewThreadUrl) : "none"}`,
    `manual_next_step=${remediation.manualNextStep}`,
    `summary=${remediation.summary}`,
  ].join(" ");
}
