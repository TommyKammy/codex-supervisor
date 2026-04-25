import type { GitHubPullRequest, IssueRunRecord, PullRequestCheck } from "../core/types";

export interface StaleReviewBotRemediationDto {
  issueNumber: number;
  prNumber: number | null;
  reasonCode: "stale_review_bot";
  currentHeadSha: string;
  processedOnCurrentHead: "yes" | "no" | "unknown";
  codeCiState: "green" | "not_green" | "unknown";
  reviewThreadUrl: string | null;
  manualNextStep: string;
  summary: string;
}

const STALE_REVIEW_BOT_MANUAL_NEXT_STEP =
  "inspect_exact_review_thread_then_resolve_or_leave_manual_note";
const STALE_REVIEW_BOT_SUMMARY =
  "code_or_ci_green_but_review_thread_metadata_unresolved";

function formatTokenValue(value: string): string {
  return value.replace(/\r?\n/gu, "\\n");
}

function processedOnCurrentHead(record: Pick<IssueRunRecord, "last_failure_context">): "yes" | "no" | "unknown" {
  for (const detail of record.last_failure_context?.details ?? []) {
    const match = detail.match(/\bprocessed_on_current_head=(yes|no)\b/u);
    if (match?.[1] === "yes" || match?.[1] === "no") {
      return match[1];
    }
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

export function buildStaleReviewBotRemediation(args: {
  record: IssueRunRecord;
  pr: GitHubPullRequest | null;
  checks: PullRequestCheck[];
}): StaleReviewBotRemediationDto | null {
  if (args.record.blocked_reason !== "stale_review_bot") {
    return null;
  }

  const currentHeadSha = args.pr?.headRefOid ?? args.record.last_head_sha;
  if (!currentHeadSha) {
    return null;
  }

  return {
    issueNumber: args.record.issue_number,
    prNumber: args.record.pr_number,
    reasonCode: "stale_review_bot",
    currentHeadSha,
    processedOnCurrentHead: processedOnCurrentHead(args.record),
    codeCiState: codeCiState(args.pr, args.checks),
    reviewThreadUrl: args.record.last_failure_context?.url ?? null,
    manualNextStep: STALE_REVIEW_BOT_MANUAL_NEXT_STEP,
    summary: STALE_REVIEW_BOT_SUMMARY,
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
    `review_thread_url=${remediation.reviewThreadUrl ? formatTokenValue(remediation.reviewThreadUrl) : "none"}`,
    `manual_next_step=${remediation.manualNextStep}`,
    `summary=${remediation.summary}`,
  ].join(" ");
}
