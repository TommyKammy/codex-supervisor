import { configuredReviewProviderKinds } from "../core/review-providers";
import { displayLocalCiCommand } from "../core/config-parsing";
import { GitHubPullRequest, IssueRunRecord, PullRequestCheck, ReviewThread, SupervisorConfig } from "../core/types";
import {
  buildCodexConnectorP2P3PolicyDiagnostic,
  buildCodexConnectorPolicyBlockDiagnostic,
  buildCodexConnectorReviewChurnDiagnostic,
  codexConnectorMustFixReviewThreads,
  codexConnectorStaleReviewCommitThreads,
  commitShasDifferForComparison,
  commitShasEqualForComparison,
  evaluateCodexConnectorConvergencePolicy,
  formatCodexConnectorP2P3PolicyDiagnostic,
  formatCodexConnectorPolicyBlockDiagnostic,
  formatCodexConnectorReviewChurnDiagnostic,
} from "../codex-connector-review-policy";
import { configuredBotCurrentHeadSignalWaitWindow } from "./review-bot-wait-windows";
import {
  formatStaleReviewMetadataConvergenceDiagnostic,
  formatStaleReviewResidueOperatorDiagnostic,
  shouldSuppressActionableCodexDiagnostics,
  shouldUseStaleReviewRemediationDiagnostic,
} from "./stale-review-bot-diagnostics-presenter";
import { type StaleReviewBotRemediationDto } from "./stale-review-bot-remediation";

function addMinutes(timestamp: string, minutes: number): string | null {
  const parsed = Date.parse(timestamp);
  if (Number.isNaN(parsed)) {
    return null;
  }

  return new Date(parsed + minutes * 60_000).toISOString();
}

export interface CodexConnectorDiagnosticBundle {
  policyBlockSummary: string | null;
  p2p3PolicySummary: string | null;
  reviewChurnSummary: string | null;
  reviewFallbackSummary: string | null;
  convergenceSummary: string | null;
  operatorDiagnosticSummary: string | null;
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

  if (staleReviewCommitThreads.length > 0 && policy.outcome === "must_fix_remaining") {
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
    `highest_severity=${highestSeverity}`,
    `finding_count=${findingCount}`,
    `merge_effect=${mergeEffect}`,
    `next_action=${nextAction}`,
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
  return {
    policyBlockSummary: policyBlock ? formatCodexConnectorPolicyBlockDiagnostic(policyBlock) : null,
    p2p3PolicySummary: p2p3Policy ? formatCodexConnectorP2P3PolicyDiagnostic(p2p3Policy) : null,
    reviewChurnSummary: reviewChurn ? formatCodexConnectorReviewChurnDiagnostic(reviewChurn) : null,
    reviewFallbackSummary: formatCodexConnectorReviewFallbackDiagnostic({
      config: args.config,
      record: args.record,
      pr: args.pr,
      checks: args.checks,
    }),
    convergenceSummary:
      staleReviewBotRemediation
        ? formatStaleReviewMetadataConvergenceDiagnostic({
          remediation: staleReviewBotRemediation,
          pr: args.pr,
        }) ??
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
        }),
    operatorDiagnosticSummary: staleReviewBotRemediation
      ? formatStaleReviewResidueOperatorDiagnostic(staleReviewBotRemediation)
      : formatCodexConnectorOperatorDiagnostic({
        config: args.config,
        record: args.record,
        pr: args.pr,
        reviewThreads: args.reviewThreads,
      }),
  };
}
