import { configuredReviewProviderKinds } from "../core/review-providers";
import { displayLocalCiCommand } from "../core/config-parsing";
import { GitHubPullRequest, IssueRunRecord, PullRequestCheck, ReviewThread, SupervisorConfig } from "../core/types";
import { currentHeadLocalCiMissing, hasConfiguredLocalCiCommand } from "../local-ci-policy";
import {
  buildCodexConnectorReviewChurnDiagnostic,
  buildCodexConnectorReviewChurnHistory,
  buildCodexConnectorReviewChurnProgressSummary,
  compareCodexConnectorReviewChurnProgress,
  detectStableSameFileCodexConnectorChurn,
  formatCodexConnectorReviewChurnDiagnostic,
  type CodexConnectorReviewChurnHistoryEntry,
  type CodexConnectorReviewChurnProgressSummary,
  type CodexConnectorStableSameFileChurn,
} from "../codex-connector-review-churn";
import {
  buildCodexConnectorP2P3PolicyDiagnostic,
  buildCodexConnectorPolicyBlockDiagnostic,
  codexConnectorMustFixReviewThreads,
  codexConnectorStaleReviewCommitThreads,
  commitShasDifferForComparison,
  commitShasEqualForComparison,
  evaluateCodexConnectorConvergencePolicy,
  formatCodexConnectorP2P3PolicyDiagnostic,
  formatCodexConnectorPolicyBlockDiagnostic,
  latestCodexConnectorReviewComment,
} from "../codex-connector-review-policy";
import { configuredBotCurrentHeadSignalWaitWindow } from "./review-bot-wait-windows";
import {
  formatStaleReviewMetadataConvergenceDiagnostic,
  formatStaleReviewResidueOperatorDiagnostic,
  shouldSuppressActionableCodexDiagnostics,
  shouldUseStaleReviewRemediationDiagnostic,
  verifiedCurrentHeadRepairResidueAllowsMergeReadyAction,
} from "./stale-review-bot-diagnostics-presenter";
import {
  type StaleReviewBotRemediationDto,
} from "./stale-review-bot-remediation";
import { buildStaleReviewBotThreadDiagnostics } from "./stale-review-bot-diagnostics";
import { hasFreshCurrentHeadCodexSuccessReviewedCommit } from "../current-head-codex-repair-proof";

function addMinutes(timestamp: string, minutes: number): string | null {
  const parsed = Date.parse(timestamp);
  if (Number.isNaN(parsed)) {
    return null;
  }

  return new Date(parsed + minutes * 60_000).toISOString();
}

function formatDiagnosticToken(value: string): string {
  return value.replace(/\s+/g, "_");
}

export interface CodexConnectorDiagnosticBundle {
  policyBlockSummary: string | null;
  p2p3PolicySummary: string | null;
  reviewChurnSummary: string | null;
  currentClusterSummary: string | null;
  pendingHeadChurnSummary: string | null;
  reviewChurnProgressSummary: string | null;
  stableSameFileChurnSummary: string | null;
  reviewFallbackSummary: string | null;
  convergenceSummary: string | null;
  operatorDiagnosticSummary: string | null;
}

function isCodexConnectorReviewChurnProgressSummary(
  value: unknown,
): value is CodexConnectorReviewChurnProgressSummary {
  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as Partial<CodexConnectorReviewChurnProgressSummary>;
  return (
    typeof candidate.currentHeadSha === "string" &&
    typeof candidate.currentEffectiveMustFixCount === "number" &&
    Number.isFinite(candidate.currentEffectiveMustFixCount) &&
    typeof candidate.dominantFile === "string" &&
    typeof candidate.dominantFilePercent === "number" &&
    Number.isFinite(candidate.dominantFilePercent) &&
    typeof candidate.clusterCategorySignature === "string" &&
    Array.isArray(candidate.representativeThreadIds) &&
    candidate.representativeThreadIds.every((threadId) => typeof threadId === "string")
  );
}

function parsePreviousCodexConnectorReviewChurnProgress(
  snapshot: string | null | undefined,
): CodexConnectorReviewChurnProgressSummary | null {
  if (!snapshot) {
    return null;
  }

  try {
    const parsed = JSON.parse(snapshot) as { codexConnectorReviewChurnProgress?: unknown };
    return isCodexConnectorReviewChurnProgressSummary(parsed.codexConnectorReviewChurnProgress)
      ? parsed.codexConnectorReviewChurnProgress
      : null;
  } catch {
    return null;
  }
}

function isCodexConnectorReviewChurnHistoryEntry(
  value: unknown,
): value is CodexConnectorReviewChurnHistoryEntry {
  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as Partial<CodexConnectorReviewChurnHistoryEntry>;
  return (
    typeof candidate.reviewedHeadSha === "string" &&
    typeof candidate.effectiveMustFixCount === "number" &&
    Number.isFinite(candidate.effectiveMustFixCount) &&
    typeof candidate.dominantFile === "string" &&
    typeof candidate.clusterCategorySignature === "string" &&
    Array.isArray(candidate.representativeThreadIds) &&
    candidate.representativeThreadIds.every((threadId) => typeof threadId === "string")
  );
}

function parsePreviousCodexConnectorReviewChurnHistory(
  snapshot: string | null | undefined,
): CodexConnectorReviewChurnHistoryEntry[] | null {
  if (!snapshot) {
    return null;
  }

  try {
    const parsed = JSON.parse(snapshot) as { codexConnectorReviewChurnHistory?: unknown };
    return Array.isArray(parsed.codexConnectorReviewChurnHistory) &&
      parsed.codexConnectorReviewChurnHistory.every(isCodexConnectorReviewChurnHistoryEntry)
      ? parsed.codexConnectorReviewChurnHistory
      : null;
  } catch {
    return null;
  }
}

function formatCodexConnectorReviewChurnProgressDiagnostic(args: {
  current: CodexConnectorReviewChurnProgressSummary;
  previous: CodexConnectorReviewChurnProgressSummary;
}): string {
  const comparison = compareCodexConnectorReviewChurnProgress(args.current, args.previous);
  return [
    "codex_connector_review_churn_progress",
    `classification=${comparison.classification}`,
    `current_head_sha=${formatDiagnosticToken(comparison.currentHeadSha)}`,
    `previous_head_sha=${formatDiagnosticToken(comparison.previousHeadSha)}`,
    `current_effective_must_fix=${comparison.currentEffectiveMustFixCount}`,
    `previous_effective_must_fix=${comparison.previousEffectiveMustFixCount}`,
    `effective_must_fix_delta=${comparison.effectiveMustFixDelta}`,
    `dominant_file=${formatDiagnosticToken(args.current.dominantFile)}`,
    `previous_dominant_file=${formatDiagnosticToken(args.previous.dominantFile)}`,
    `dominant_file_percent=${args.current.dominantFilePercent}`,
    `cluster_category_signature=${formatDiagnosticToken(args.current.clusterCategorySignature)}`,
    `previous_cluster_category_signature=${formatDiagnosticToken(args.previous.clusterCategorySignature)}`,
    `representative_threads=${args.current.representativeThreadIds.map(formatDiagnosticToken).join(",") || "none"}`,
  ].join(" ");
}

function formatCodexConnectorStableSameFileChurnDiagnostic(
  stableChurn: CodexConnectorStableSameFileChurn,
): string {
  return [
    "codex_connector_same_file_churn_history",
    "status=stable_same_file_churn",
    `streak=${stableChurn.streak}`,
    `current_head_sha=${formatDiagnosticToken(stableChurn.reviewedHeadShas[stableChurn.reviewedHeadShas.length - 1] ?? "unknown")}`,
    `dominant_file=${formatDiagnosticToken(stableChurn.dominantFile)}`,
    `cluster_category_signature=${formatDiagnosticToken(stableChurn.clusterCategorySignature)}`,
    `current_effective_must_fix=${stableChurn.currentEffectiveMustFixCount}`,
    `reviewed_heads=${stableChurn.reviewedHeadShas.map(formatDiagnosticToken).join(",") || "none"}`,
    `representative_threads=${stableChurn.representativeThreadIds.map(formatDiagnosticToken).join(",") || "none"}`,
    "next_action=manual_review_same_file_churn_history",
  ].join(" ");
}

function countOutdatedUnresolvedCodexConnectorResidue(reviewThreads: ReviewThread[]): number {
  return reviewThreads.filter((thread) => {
    return !thread.isResolved && thread.isOutdated && latestCodexConnectorReviewComment(thread) !== null;
  }).length;
}

function formatCodexConnectorCurrentClusterDiagnostic(args: {
  reviewChurn: NonNullable<ReturnType<typeof buildCodexConnectorReviewChurnDiagnostic>>;
  outdatedUnresolvedResidueCount: number;
}): string {
  return [
    "codex_connector_current_clusters",
    `current_effective_must_fix=${args.reviewChurn.mustFixCount}`,
    `dominant_file=${formatDiagnosticToken(args.reviewChurn.dominantFile)}`,
    `dominant_file_threads=${args.reviewChurn.dominantFileThreadCount}`,
    `dominant_file_percent=${args.reviewChurn.dominantFilePercent}`,
    `clusters=${args.reviewChurn.clusterCount}`,
    `categories=${args.reviewChurn.normalizedCategories.map(formatDiagnosticToken).join("|")}`,
    `representative_threads=${args.reviewChurn.representativeThreadIds.map(formatDiagnosticToken).join(",") || "none"}`,
    `representative_urls=${args.reviewChurn.representativeSourceUrls.map(formatDiagnosticToken).join(",") || "none"}`,
    `outdated_unresolved_residue=${args.outdatedUnresolvedResidueCount}`,
    "next_action=repair_must_fix_findings",
  ].join(" ");
}

function formatCodexConnectorPendingHeadChurnDiagnostic(args: {
  config: SupervisorConfig;
  record: Pick<
    IssueRunRecord,
    | "codex_connector_review_requested_observed_at"
    | "codex_connector_review_requested_head_sha"
  >;
  pr: GitHubPullRequest;
  reviewThreads: ReviewThread[];
}): string | null {
  const staleReviewCommitThreads = codexConnectorStaleReviewCommitThreads(args.pr, args.reviewThreads);
  if (staleReviewCommitThreads.length === 0 || args.pr.configuredBotCurrentHeadObservedAt) {
    return null;
  }

  const reviewChurn = buildCodexConnectorReviewChurnDiagnostic(args.config, staleReviewCommitThreads, null);
  if (!reviewChurn) {
    return null;
  }

  const currentHeadSha = args.pr.headRefOid;
  const latestReviewedHeadSha = args.pr.configuredBotLatestReviewedCommitSha ?? "none";
  const requestMatchesCurrentHead = Boolean(
    args.record.codex_connector_review_requested_observed_at &&
      commitShasEqualForComparison(args.record.codex_connector_review_requested_head_sha, currentHeadSha),
  );
  const hydratedRequestMatchesCurrentHead = Boolean(
    !requestMatchesCurrentHead &&
      args.pr.codexConnectorReviewRequestedAt &&
      commitShasEqualForComparison(args.pr.codexConnectorReviewRequestedHeadSha, currentHeadSha),
  );
  const waitWindow = configuredBotCurrentHeadSignalWaitWindow(args.config, args.pr);
  const timeoutAction = args.config.configuredBotCurrentHeadSignalTimeoutAction ?? args.config.copilotReviewTimeoutAction;
  const nextAction =
    requestMatchesCurrentHead || hydratedRequestMatchesCurrentHead
      ? "wait_for_requested_review"
      : waitWindow.status === "active"
        ? "wait_for_current_head_signal"
        : timeoutAction === "request_review_comment"
          ? "request_current_head_review"
          : "wait_for_current_head_signal";

  return [
    "codex_connector_pending_head_churn",
    "status=pending_current_head_review",
    `current_head_sha=${formatDiagnosticToken(currentHeadSha)}`,
    `latest_reviewed_head_sha=${formatDiagnosticToken(latestReviewedHeadSha)}`,
    "current_head_review_signal=missing",
    `current_effective_must_fix=${reviewChurn.mustFixCount}`,
    `threshold=${reviewChurn.threshold}`,
    `highest_severity=${reviewChurn.highestSeverity}`,
    `dominant_file=${formatDiagnosticToken(reviewChurn.dominantFile)}`,
    `dominant_file_threads=${reviewChurn.dominantFileThreadCount}`,
    `dominant_file_percent=${reviewChurn.dominantFilePercent}`,
    `categories=${reviewChurn.normalizedCategories.map(formatDiagnosticToken).join("|")}`,
    `representative_threads=${reviewChurn.representativeThreadIds.map(formatDiagnosticToken).join(",") || "none"}`,
    `representative_urls=${reviewChurn.representativeSourceUrls.map(formatDiagnosticToken).join(",") || "none"}`,
    `stale_review_commit_threads=${staleReviewCommitThreads.length}`,
    `next_action=${nextAction}`,
  ].join(" ");
}

export function formatCodexConnectorReviewFallbackDiagnostic(args: {
  config: SupervisorConfig;
  record: Pick<
    IssueRunRecord,
    | "codex_connector_review_requested_observed_at"
    | "codex_connector_review_requested_head_sha"
    | "codex_connector_review_request_retry_count"
    | "codex_connector_review_request_retry_head_sha"
    | "codex_connector_review_request_last_retried_at"
    | "codex_connector_review_request_comment_identity_status"
    | "codex_connector_review_request_comment_database_id"
    | "codex_connector_review_request_comment_node_id"
    | "codex_connector_review_request_comment_url"
  >;
  pr: GitHubPullRequest;
  checks?: PullRequestCheck[];
}): string | null {
  if (!configuredReviewProviderKinds(args.config).includes("codex")) {
    return null;
  }

  const waitWindow = configuredBotCurrentHeadSignalWaitWindow(args.config, args.pr);
  const currentHeadObservedAt = args.pr.configuredBotCurrentHeadObservedAt ?? null;
  const recordRequestAt = args.record.codex_connector_review_requested_observed_at ?? null;
  const recordRequestHeadSha = args.record.codex_connector_review_requested_head_sha ?? null;
  const prRequestAt = args.pr.codexConnectorReviewRequestedAt ?? null;
  const prRequestHeadSha = args.pr.codexConnectorReviewRequestedHeadSha ?? null;
  const requestAt = recordRequestAt ?? prRequestAt;
  const requestHeadSha = recordRequestHeadSha ?? prRequestHeadSha;
  const requestMatchesCurrentHead = Boolean(requestAt && requestHeadSha === args.pr.headRefOid);
  const retryCount =
    args.record.codex_connector_review_request_retry_head_sha === args.pr.headRefOid
      ? args.record.codex_connector_review_request_retry_count ?? 0
      : 0;
  const retryLimit = args.config.codexConnectorReviewRequestRetryLimit ?? 1;
  const retryAnchorAt =
    args.record.codex_connector_review_request_retry_head_sha === args.pr.headRefOid &&
    args.record.codex_connector_review_request_last_retried_at
      ? args.record.codex_connector_review_request_last_retried_at
      : requestAt;
  const retryWaitUntil = retryAnchorAt
    ? addMinutes(retryAnchorAt, args.config.codexConnectorReviewRequestNoResponseMinutes ?? 10)
    : null;
  const timeoutAction = args.config.configuredBotCurrentHeadSignalTimeoutAction ?? args.config.copilotReviewTimeoutAction;
  const retryConfigured = timeoutAction === "request_review_comment";
  const requestNoResponseElapsed = Boolean(
    retryConfigured &&
    requestMatchesCurrentHead &&
    !currentHeadObservedAt &&
    retryWaitUntil &&
    Date.now() >= Date.parse(retryWaitUntil),
  );
  const reviewSignal = currentHeadObservedAt ? "current_head_observed" : "missing";
  const loadedChecksAreGreen = Boolean(
    args.checks && args.checks.length > 0 && args.checks.every((check) => check.bucket === "pass"),
  );
  const noChecksAndNoLocalCi = Boolean(
    args.checks && args.checks.length === 0 && !displayLocalCiCommand(args.config.localCiCommand),
  );
  const requiredChecksGreenAt =
    args.pr.currentHeadCiGreenAt ??
    (loadedChecksAreGreen ? "loaded_checks_passed" : noChecksAndNoLocalCi ? "no_checks_local_ci_unset" : "none");

  let status:
    | "current_head_observed"
    | "waiting_current_head_signal"
    | "timeout_elapsed"
    | "request_eligible"
    | "request_posted"
    | "already_requested"
    | "request_posted_no_current_head_signal"
    | "request_retry_exhausted"
    | "missing_current_head_signal";
  if (currentHeadObservedAt) {
    status = "current_head_observed";
  } else if (requestNoResponseElapsed && retryCount >= retryLimit) {
    status = "request_retry_exhausted";
  } else if (requestNoResponseElapsed) {
    status = "request_posted_no_current_head_signal";
  } else if (requestMatchesCurrentHead && recordRequestAt) {
    status = "request_posted";
  } else if (requestMatchesCurrentHead) {
    status = "already_requested";
  } else if (waitWindow.status === "active") {
    status = "waiting_current_head_signal";
  } else if (waitWindow.status === "expired" && retryConfigured && !requestAt) {
    status = "request_eligible";
  } else if (waitWindow.status === "expired") {
    status = "timeout_elapsed";
  } else {
    status = "missing_current_head_signal";
  }

  const waitUntilSuffix = waitWindow.waitUntil ? ` wait_until=${waitWindow.waitUntil}` : "";
  const commentIdentity =
    args.record.codex_connector_review_request_comment_identity_status === "available"
      ? [
          `database_id=${args.record.codex_connector_review_request_comment_database_id ?? "none"}`,
          `node_id=${args.record.codex_connector_review_request_comment_node_id ?? "none"}`,
          `url=${args.record.codex_connector_review_request_comment_url ?? "none"}`,
        ].join(",")
      : "unavailable";
  const retryStatusSuffix =
    status === "request_posted_no_current_head_signal" || status === "request_retry_exhausted"
      ? [
          ` retry_status=${status === "request_retry_exhausted" ? "exhausted" : "eligible"}`,
          `retry_count=${retryCount}`,
          `retry_limit=${retryLimit}`,
          `retry_wait_until=${retryWaitUntil ?? "none"}`,
          `request_comment_identity=${commentIdentity}`,
          `next_action=${status === "request_retry_exhausted" ? "operator_manual_review" : "retry_request_review_comment"}`,
        ].join(" ")
      : "";
  const requestEligibleSuffix = status === "request_eligible" ? " next_action=request_current_head_review" : "";
  return [
    `codex_connector_review_fallback status=${status}`,
    "provider=codex",
    `current_head_sha=${args.pr.headRefOid}`,
    `current_head_observed_at=${currentHeadObservedAt ?? "none"}`,
    `required_checks_green_at=${requiredChecksGreenAt}`,
    `timeout_action=${timeoutAction}`,
    `requested_at=${requestAt ?? "none"}`,
    `requested_head_sha=${requestHeadSha ?? "none"}`,
    `review_signal=${reviewSignal}`,
    "note=request_comment_is_not_review_completion",
  ].join(" ") + retryStatusSuffix + requestEligibleSuffix + waitUntilSuffix;
}

export function formatCodexConnectorConvergenceDiagnostic(args: {
  config: SupervisorConfig;
  record: Pick<
    IssueRunRecord,
    | "state"
    | "provider_success_head_sha"
    | "provider_success_observed_at"
    | "external_review_head_sha"
    | "codex_connector_review_requested_observed_at"
    | "codex_connector_review_requested_head_sha"
  >;
  pr: GitHubPullRequest;
  reviewThreads: ReviewThread[];
}): string | null {
  if (!configuredReviewProviderKinds(args.config).includes("codex")) {
    return null;
  }

  const policy = evaluateCodexConnectorConvergencePolicy(args.config, args.pr, args.reviewThreads);
  if (!policy) {
    return null;
  }

  const currentHeadSha = args.pr.headRefOid;
  const staleReviewCommitThreads = codexConnectorStaleReviewCommitThreads(args.pr, args.reviewThreads);
  const staleReviewCommitThreadIds = staleReviewCommitThreads.map((thread) => thread.id).join(",");
  const supersededMustFixThreads = codexConnectorMustFixReviewThreads(args.reviewThreads);
  const supersededByAnchoredCurrentHeadSuccess =
    policy.outcome === "must_fix_remaining" &&
    supersededMustFixThreads.length > 0 &&
    supersededMustFixThreads.length === policy.findingCount &&
    hasFreshCurrentHeadCodexSuccessReviewedCommit(args.pr, args.reviewThreads);
  const supersededMustFixThreadIds = supersededMustFixThreads.map((thread) => thread.id).join(",");
  const hasCurrentHeadProviderSuccess = Boolean(
    args.record.provider_success_observed_at && commitShasEqualForComparison(args.record.provider_success_head_sha, currentHeadSha),
  );
  const currentHeadSignalObserved = Boolean(
    policy.currentHeadObservedAt || hasCurrentHeadProviderSuccess,
  );
  const staleSignalHeadSha =
    !currentHeadSignalObserved && args.pr.configuredBotLatestReviewedCommitSha && commitShasDifferForComparison(args.pr.configuredBotLatestReviewedCommitSha, currentHeadSha)
      ? args.pr.configuredBotLatestReviewedCommitSha
      : !currentHeadSignalObserved && args.record.provider_success_head_sha && commitShasDifferForComparison(args.record.provider_success_head_sha, currentHeadSha)
        ? args.record.provider_success_head_sha
        : !currentHeadSignalObserved && args.record.external_review_head_sha && commitShasDifferForComparison(args.record.external_review_head_sha, currentHeadSha)
          ? args.record.external_review_head_sha
          : null;
  const latestSignalHeadSha =
    staleSignalHeadSha ??
    (commitShasEqualForComparison(args.record.provider_success_head_sha, currentHeadSha)
      ? args.record.provider_success_head_sha
      : policy.currentHeadObservedAt
        ? currentHeadSha
        : "none");
  const requestMatchesCurrentHead = Boolean(
    args.record.codex_connector_review_requested_observed_at &&
      commitShasEqualForComparison(args.record.codex_connector_review_requested_head_sha, currentHeadSha),
  );
  const hydratedRequestMatchesCurrentHead = Boolean(
    !requestMatchesCurrentHead &&
      args.pr.codexConnectorReviewRequestedAt &&
      commitShasEqualForComparison(args.pr.codexConnectorReviewRequestedHeadSha, currentHeadSha),
  );
  const waitWindow = configuredBotCurrentHeadSignalWaitWindow(args.config, args.pr);
  const timeoutAction = args.config.configuredBotCurrentHeadSignalTimeoutAction ?? args.config.copilotReviewTimeoutAction;
  const staleReviewCommitNextAction =
    requestMatchesCurrentHead || hydratedRequestMatchesCurrentHead
      ? "wait_for_requested_review"
      : waitWindow.status === "active"
        ? "wait_for_current_head_signal"
        : timeoutAction === "request_review_comment"
          ? "request_current_head_review"
          : "wait_for_current_head_signal";
  const findingCount = staleReviewCommitThreads.length > 0 ? 0 : policy.findingCount;
  const highestSeverity = staleReviewCommitThreads.length > 0 ? "none" : policy.highestSeverity;

  let status:
    | "contradictory_evidence"
    | "superseded_by_anchored_current_head_success"
    | "stale_review_commit_residue"
    | "stale_head"
    | "repairing_must_fix"
    | "re_requested_review"
    | "same_head_request_hydrated"
    | "waiting_review"
    | "missing_current_head_review"
    | "nitpick_only"
    | "converged";
  let mergeEffect = policy.mergeEffect;
  let nextAction:
    | "fail_closed_inspect_connector_state"
    | "wait_for_current_head_signal"
    | "repair_must_fix_findings"
    | "wait_for_requested_review"
    | "request_current_head_review"
    | "merge_or_follow_up_nitpicks"
    | "merge_ready";

  if (supersededByAnchoredCurrentHeadSuccess) {
    status = "superseded_by_anchored_current_head_success";
    mergeEffect = "ready";
    nextAction = "merge_ready";
  } else if (staleReviewCommitThreads.length > 0 && policy.outcome === "must_fix_remaining") {
    status = "stale_review_commit_residue";
    mergeEffect = "blocked";
    nextAction = staleReviewCommitNextAction;
  } else if (hasCurrentHeadProviderSuccess && policy.outcome !== "converged" && policy.outcome !== "nitpick_only") {
    status = "contradictory_evidence";
    nextAction = "fail_closed_inspect_connector_state";
  } else if (staleSignalHeadSha) {
    status = "stale_head";
    mergeEffect = "blocked";
    nextAction = staleReviewCommitNextAction;
  } else if (policy.outcome === "must_fix_remaining") {
    status = "repairing_must_fix";
    nextAction = policy.nextAction;
  } else if (policy.outcome === "missing_current_head_review") {
    status = requestMatchesCurrentHead
      ? "re_requested_review"
      : hydratedRequestMatchesCurrentHead
        ? "same_head_request_hydrated"
        : "missing_current_head_review";
    nextAction = requestMatchesCurrentHead || hydratedRequestMatchesCurrentHead ? "wait_for_requested_review" : "request_current_head_review";
  } else if (policy.outcome === "nitpick_only") {
    status = "nitpick_only";
    nextAction = policy.nextAction;
  } else {
    status = "converged";
    nextAction = policy.nextAction;
  }

  if (status === "missing_current_head_review" && waitWindow.status === "active") {
    status = "waiting_review";
    nextAction = "wait_for_current_head_signal";
  }

  return [
    `codex_connector_convergence status=${status}`,
    "provider=codex",
    `current_head_sha=${currentHeadSha}`,
    `current_head_observed_at=${policy.currentHeadObservedAt ?? "none"}`,
    `latest_signal_head_sha=${latestSignalHeadSha}`,
    `highest_severity=${supersededByAnchoredCurrentHeadSuccess ? "none" : highestSeverity}`,
    `finding_count=${supersededByAnchoredCurrentHeadSuccess ? 0 : findingCount}`,
    `merge_effect=${mergeEffect}`,
    `next_action=${nextAction}`,
    ...(supersededByAnchoredCurrentHeadSuccess
      ? [
          "note=anchored_current_head_codex_success_superseded_unresolved_findings",
          `superseded_review_threads=${supersededMustFixThreads.length}`,
          `superseded_review_thread_ids=${supersededMustFixThreadIds}`,
        ]
      : []),
    ...(staleReviewCommitThreads.length > 0
      ? [
          `stale_review_commit_threads=${staleReviewCommitThreads.length}`,
          `stale_review_commit_thread_ids=${staleReviewCommitThreadIds}`,
        ]
      : []),
  ].join(" ");
}

export function formatCodexConnectorOperatorDiagnostic(args: {
  config: SupervisorConfig;
  record: Pick<
    IssueRunRecord,
    | "provider_success_head_sha"
    | "provider_success_observed_at"
    | "external_review_head_sha"
    | "codex_connector_review_requested_observed_at"
    | "codex_connector_review_requested_head_sha"
  >;
  pr: GitHubPullRequest;
  reviewThreads: ReviewThread[];
}): string | null {
  if (!configuredReviewProviderKinds(args.config).includes("codex")) {
    return null;
  }

  const policy = evaluateCodexConnectorConvergencePolicy(args.config, args.pr, args.reviewThreads);
  if (!policy || (policy.outcome !== "missing_current_head_review" && policy.outcome !== "must_fix_remaining")) {
    return null;
  }

  const currentHeadSha = args.pr.headRefOid;
  const staleReviewCommitThreads = codexConnectorStaleReviewCommitThreads(args.pr, args.reviewThreads);
  const staleReviewCommitThreadIds = staleReviewCommitThreads.map((thread) => thread.id).join(",");
  const actionableCurrentDiffThreads =
    staleReviewCommitThreads.length > 0 ? 0 : codexConnectorMustFixReviewThreads(args.reviewThreads).length;
  const currentHeadReviewSignal =
    policy.currentHeadObservedAt || commitShasEqualForComparison(args.record.provider_success_head_sha, currentHeadSha)
      ? "observed"
      : "missing";
  const latestConfiguredBotReviewSha =
    currentHeadReviewSignal === "observed"
      ? currentHeadSha
      : args.pr.configuredBotLatestReviewedCommitSha ?? args.record.provider_success_head_sha ?? args.record.external_review_head_sha ?? "none";
  const requestMatchesCurrentHead = Boolean(
    args.record.codex_connector_review_requested_observed_at &&
      commitShasEqualForComparison(args.record.codex_connector_review_requested_head_sha, currentHeadSha),
  );
  const hydratedRequestMatchesCurrentHead = Boolean(
    !requestMatchesCurrentHead &&
      args.pr.codexConnectorReviewRequestedAt &&
      commitShasEqualForComparison(args.pr.codexConnectorReviewRequestedHeadSha, currentHeadSha),
  );
  const waitWindow = configuredBotCurrentHeadSignalWaitWindow(args.config, args.pr);
  const timeoutAction = args.config.configuredBotCurrentHeadSignalTimeoutAction ?? args.config.copilotReviewTimeoutAction;
  const nextAction =
    staleReviewCommitThreads.length > 0
      ? requestMatchesCurrentHead || hydratedRequestMatchesCurrentHead
        ? "wait_for_requested_review"
        : waitWindow.status === "active"
          ? "wait_for_current_head_signal"
          : timeoutAction === "request_review_comment"
            ? "request_current_head_review"
            : "wait_for_current_head_signal"
      : policy.outcome === "must_fix_remaining"
      ? "repair_must_fix_findings"
      : requestMatchesCurrentHead || hydratedRequestMatchesCurrentHead
        ? "wait_for_requested_review"
        : waitWindow.status === "active"
          ? "wait_for_current_head_signal"
          : "request_current_head_review";
  const interpretation =
    staleReviewCommitThreads.length > 0
      ? "current_head_review_pending_with_stale_threads"
      : policy.outcome === "must_fix_remaining"
        ? "actionable_current_diff"
        : "review_gate_waiting";

  return [
    "codex_connector_operator_diagnostic",
    `interpretation=${interpretation}`,
    `current_head_sha=${currentHeadSha}`,
    `latest_configured_bot_review_sha=${latestConfiguredBotReviewSha}`,
    `current_head_review_signal=${currentHeadReviewSignal}`,
    `actionable_current_diff_threads=${actionableCurrentDiffThreads}`,
    ...(staleReviewCommitThreads.length > 0
      ? [
          `stale_review_commit_threads=${staleReviewCommitThreads.length}`,
          `stale_review_commit_thread_ids=${staleReviewCommitThreadIds}`,
        ]
      : []),
    `next_action=${nextAction}`,
  ].join(" ");
}

export function buildCodexConnectorDiagnosticBundle(args: {
  config: SupervisorConfig;
  record: IssueRunRecord;
  pr: GitHubPullRequest;
  checks: PullRequestCheck[];
  reviewThreads: ReviewThread[];
  staleReviewBotRemediation?: StaleReviewBotRemediationDto | null;
  includeP2P3Policy?: boolean;
}): CodexConnectorDiagnosticBundle {
  const staleReviewBotRemediation = shouldUseStaleReviewRemediationDiagnostic(args.staleReviewBotRemediation)
    ? args.staleReviewBotRemediation
    : null;
  const suppressActionableReviewPolicy = Boolean(
    staleReviewBotRemediation &&
      shouldSuppressActionableCodexDiagnostics(staleReviewBotRemediation),
  );
  const policyBlock = suppressActionableReviewPolicy
    ? null
    : buildCodexConnectorPolicyBlockDiagnostic(args.config, args.reviewThreads, args.pr);
  const p2p3Policy =
    args.includeP2P3Policy && !suppressActionableReviewPolicy
      ? buildCodexConnectorP2P3PolicyDiagnostic(args.config, args.reviewThreads, args.pr)
      : null;
  const reviewChurn = suppressActionableReviewPolicy
    ? null
    : buildCodexConnectorReviewChurnDiagnostic(args.config, args.reviewThreads, args.pr);
  const currentReviewChurnProgress = reviewChurn
    ? buildCodexConnectorReviewChurnProgressSummary(reviewChurn, args.pr.headRefOid)
    : null;
  const previousReviewChurnProgress = parsePreviousCodexConnectorReviewChurnProgress(
    args.record.last_tracked_pr_progress_snapshot,
  );
  const previousReviewChurnHistory = parsePreviousCodexConnectorReviewChurnHistory(
    args.record.last_tracked_pr_progress_snapshot,
  );
  const reviewChurnHistory = currentReviewChurnProgress
    ? buildCodexConnectorReviewChurnHistory({
        current: currentReviewChurnProgress,
        previousProgress: previousReviewChurnProgress,
        previousHistory: previousReviewChurnHistory,
      })
    : null;
  const stableSameFileChurn = detectStableSameFileCodexConnectorChurn(reviewChurnHistory);
  const staleReviewBotThreadDiagnostics = staleReviewBotRemediation
    ? buildStaleReviewBotThreadDiagnostics({
        config: args.config,
        record: args.record,
        pr: args.pr,
        checks: args.checks,
        reviewThreads: args.reviewThreads,
        remediation: staleReviewBotRemediation,
      })
    : null;
  const verifiedCurrentHeadRepairResidueMergeReady =
    args.config.verifiedCurrentHeadRepairReviewThreadAutoResolve === true &&
    verifiedCurrentHeadRepairResidueAllowsMergeReadyAction({
      remediation: staleReviewBotRemediation,
      diagnostics: staleReviewBotThreadDiagnostics,
      pr: args.pr,
      checks: args.checks,
      localCiAllowsMergeReady:
        !hasConfiguredLocalCiCommand(args.config) || !currentHeadLocalCiMissing(args.record, args.pr),
    });
  const suppressStaleReviewMetadataConvergence =
    staleReviewBotRemediation?.classification === "verified_current_head_repair_pending_thread_resolution" &&
    !verifiedCurrentHeadRepairResidueMergeReady;
  const staleReviewMetadataConvergenceSummary = staleReviewBotRemediation
    ? formatStaleReviewMetadataConvergenceDiagnostic({
      remediation: staleReviewBotRemediation,
      pr: args.pr,
    })
    : null;
  const convergenceSummary = staleReviewBotRemediation
    ? suppressStaleReviewMetadataConvergence
      ? null
      : staleReviewMetadataConvergenceSummary ??
      (staleReviewBotRemediation.missingProbeReason
        ? null
        : formatCodexConnectorConvergenceDiagnostic({
          config: args.config,
          record: args.record,
          pr: args.pr,
          reviewThreads: args.reviewThreads,
        }))
    : formatCodexConnectorConvergenceDiagnostic({
      config: args.config,
      record: args.record,
      pr: args.pr,
      reviewThreads: args.reviewThreads,
    });
  const suppressOperatorDiagnosticAfterAnchoredSupersession =
    convergenceSummary?.includes("status=superseded_by_anchored_current_head_success") === true;
  return {
    policyBlockSummary: policyBlock ? formatCodexConnectorPolicyBlockDiagnostic(policyBlock) : null,
    p2p3PolicySummary: p2p3Policy ? formatCodexConnectorP2P3PolicyDiagnostic(p2p3Policy) : null,
    reviewChurnSummary: reviewChurn ? formatCodexConnectorReviewChurnDiagnostic(reviewChurn) : null,
    currentClusterSummary: reviewChurn
      ? formatCodexConnectorCurrentClusterDiagnostic({
          reviewChurn,
          outdatedUnresolvedResidueCount: countOutdatedUnresolvedCodexConnectorResidue(args.reviewThreads),
        })
      : null,
    pendingHeadChurnSummary: suppressActionableReviewPolicy
      ? null
      : formatCodexConnectorPendingHeadChurnDiagnostic({
          config: args.config,
          record: args.record,
          pr: args.pr,
          reviewThreads: args.reviewThreads,
        }),
    reviewChurnProgressSummary:
      currentReviewChurnProgress && previousReviewChurnProgress
        ? formatCodexConnectorReviewChurnProgressDiagnostic({
            current: currentReviewChurnProgress,
            previous: previousReviewChurnProgress,
          })
        : null,
    stableSameFileChurnSummary: stableSameFileChurn
      ? formatCodexConnectorStableSameFileChurnDiagnostic(stableSameFileChurn)
      : null,
    reviewFallbackSummary: formatCodexConnectorReviewFallbackDiagnostic({
      config: args.config,
      record: args.record,
      pr: args.pr,
      checks: args.checks,
    }),
    convergenceSummary,
    operatorDiagnosticSummary: suppressOperatorDiagnosticAfterAnchoredSupersession
      ? null
      : staleReviewBotRemediation
      ? formatStaleReviewResidueOperatorDiagnostic({
        remediation: staleReviewBotRemediation,
        verifiedCurrentHeadRepairResidueMergeReady,
      })
      : formatCodexConnectorOperatorDiagnostic({
        config: args.config,
        record: args.record,
        pr: args.pr,
        reviewThreads: args.reviewThreads,
      }),
  };
}
