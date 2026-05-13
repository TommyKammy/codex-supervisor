import type { GitHubPullRequest, IssueRunRecord, PullRequestCheck, ReviewThread, SupervisorConfig } from "../core/types";
import { hasProcessedReviewThread } from "../review-handling";
import {
  configuredBotReviewFollowUpState,
  configuredBotReviewThreads,
  codexConnectorMustFixReviewThreads,
  evaluateCodexConnectorConvergencePolicy,
  manualReviewThreads,
  pendingBotReviewThreads,
} from "../review-thread-reporting";
import { configuredReviewProviderKinds } from "../core/review-providers";

export interface StaleReviewBotRemediationDto {
  issueNumber: number;
  prNumber: number | null;
  reasonCode: "stale_review_bot";
  currentHeadSha: string;
  processedOnCurrentHead: "yes" | "no" | "unknown";
  codeCiState: "green" | "not_green" | "unknown";
  classification:
    | "metadata_only"
    | "metadata_only_missing_current_head_review"
    | "metadata_only_current_head_converged"
    | "unresolved_work"
    | "unknown_needs_operator";
  codexCurrentHeadReviewState: "observed" | "requested" | "missing" | "not_applicable";
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
const STALE_REVIEW_BOT_METADATA_CURRENT_HEAD_SUMMARY =
  "stale_configured_bot_thread_metadata_only_pending_current_head_review_request";

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

function codexConnectorCurrentHeadReviewState(args: {
  config: SupervisorConfig | null;
  record: IssueRunRecord;
  pr: GitHubPullRequest;
}): "observed" | "requested" | "missing" | "not_applicable" {
  if (!args.config || !configuredReviewProviderKinds(args.config).includes("codex")) {
    return "not_applicable";
  }

  if (
    args.pr.configuredBotCurrentHeadObservationSource === "codex_pr_success_comment" &&
    args.pr.configuredBotCurrentHeadObservedAt
  ) {
    return "observed";
  }

  const recordRequestedSha = args.record.codex_connector_review_requested_head_sha;
  const prRequestedSha = args.pr.codexConnectorReviewRequestedHeadSha;
  if (
    (args.record.codex_connector_review_requested_observed_at || args.pr.codexConnectorReviewRequestedAt) &&
    (recordRequestedSha ?? prRequestedSha) === args.pr.headRefOid
  ) {
    return "requested";
  }

  return "missing";
}

function classifyCodexMetadataOnly(args: {
  config: SupervisorConfig;
  record: IssueRunRecord;
  pr: GitHubPullRequest;
  checks: PullRequestCheck[];
  reviewThreads: ReviewThread[];
}): Pick<StaleReviewBotRemediationDto, "classification" | "summary"> {
  const unresolvedWork = {
    classification: "unresolved_work" as const,
    summary: STALE_REVIEW_BOT_SUMMARY,
  };

  const configuredThreads = configuredBotReviewThreads(args.config, args.reviewThreads);
  if (configuredThreads.length === 0) {
    return unresolvedWork;
  }

  if (
    manualReviewThreads(args.config, args.reviewThreads).length > 0 ||
    args.record.last_head_sha !== args.pr.headRefOid ||
    !allChecksPassing(args.checks) ||
    !hasCleanMergeState(args.pr) ||
    pendingBotReviewThreads(args.config, args.record, args.pr, configuredThreads).length > 0 ||
    configuredBotReviewFollowUpState(args.config, args.record, args.pr, configuredThreads) === "eligible" ||
    !configuredThreads.every((thread) => hasProcessedReviewThread(args.record, args.pr, thread))
  ) {
    return unresolvedWork;
  }

  const policy = evaluateCodexConnectorConvergencePolicy(args.config, args.pr, args.reviewThreads);
  if (!policy) {
    return {
      classification: "unknown_needs_operator",
      summary: STALE_REVIEW_BOT_SUMMARY,
    };
  }

  if (policy.outcome === "missing_current_head_review") {
    return {
      classification: "metadata_only_missing_current_head_review",
      summary: STALE_REVIEW_BOT_METADATA_CURRENT_HEAD_SUMMARY,
    };
  }

  if (policy.outcome === "must_fix_remaining") {
    const hasUnprocessedMustFix = codexConnectorMustFixReviewThreads(args.reviewThreads).some(
      (thread) => !hasProcessedReviewThread(args.record, args.pr, thread),
    );
    if (hasUnprocessedMustFix) {
      return unresolvedWork;
    }
    if (!policy.currentHeadObservedAt) {
      return {
        classification: "metadata_only_missing_current_head_review",
        summary: STALE_REVIEW_BOT_METADATA_CURRENT_HEAD_SUMMARY,
      };
    }
  }

  if (policy.outcome === "converged" || policy.outcome === "nitpick_only") {
    return {
      classification: "metadata_only_current_head_converged",
      summary: STALE_REVIEW_BOT_METADATA_ONLY_SUMMARY,
    };
  }

  return {
    classification: "unknown_needs_operator",
    summary: STALE_REVIEW_BOT_SUMMARY,
  };
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
  if (configuredReviewProviderKinds(config).includes("codex")) {
    return classifyCodexMetadataOnly({
      config,
      record,
      pr,
      checks,
      reviewThreads,
    });
  }

  if (
    configuredThreads.length === 0 ||
    manualReviewThreads(config, reviewThreads).length > 0 ||
    record.last_head_sha !== pr.headRefOid ||
    !pr.configuredBotCurrentHeadObservedAt ||
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
  const codexCurrentHeadReviewState = args.pr
    ? codexConnectorCurrentHeadReviewState({
      config: args.config ?? null,
      record: args.record,
      pr: args.pr,
    })
    : "not_applicable";

  return {
    issueNumber: args.record.issue_number,
    prNumber: args.record.pr_number,
    reasonCode: "stale_review_bot",
    currentHeadSha,
    processedOnCurrentHead: processedOnCurrentHead(args.record),
    codeCiState: codeCiState(args.pr, args.checks),
    classification: classification.classification,
    codexCurrentHeadReviewState,
    reviewThreadUrl: args.record.last_failure_context?.url ?? null,
    manualNextStep: STALE_REVIEW_BOT_MANUAL_NEXT_STEP,
    summary: classification.summary,
  };
}

export function formatStaleReviewBotRemediationLine(remediation: StaleReviewBotRemediationDto): string {
  const tokens = [
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
  ];
  if (remediation.codexCurrentHeadReviewState !== "not_applicable") {
    tokens.splice(8, 0, `codex_current_head_review_state=${remediation.codexCurrentHeadReviewState}`);
  }
  return tokens.join(" ");
}
