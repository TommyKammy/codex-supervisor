import { displayLocalCiCommand } from "./core/config-parsing";
import { configuredReviewProviderKinds } from "./core/review-providers";
import type {
  ConfiguredReviewProviderKind,
  GitHubPullRequest,
  IssueRunRecord,
  PullRequestCheck,
  ReviewThread,
  SupervisorConfig,
} from "./core/types";
import {
  hasProcessedReviewThread,
  latestReviewThreadCommentFingerprint,
} from "./review-handling";
import {
  codexConnectorMustFixReviewThreads,
  codexConnectorStaleReviewCommitThreads,
  commitShasDifferForComparison,
} from "./codex-connector-review-policy";
import {
  configuredBotReviewFollowUpState,
  latestReviewComment,
  latestReviewCommentAuthorIsAllowedBot,
  staleConfiguredBotReviewThreads,
} from "./review-thread-reporting";
import { buildStaleReviewBotRemediation } from "./supervisor/stale-review-bot-remediation";
import type { StaleReviewBotRemediationDto } from "./supervisor/stale-review-bot-remediation";
import { determineCopilotReviewTimeout } from "./pull-request-state-current-head-policy";
import {
  extractCodexConnectorPSeverity,
  hasCodexConnectorStrongRiskWording,
  isCodexConnectorReviewer,
} from "./external-review/external-review-normalization";
import { hasCodexConnectorReviewRequestCommentIdentity } from "./codex-connector-review-request-identity";

export type CodexConnectorReviewRequestAction =
  | { kind: "none" }
  | { kind: "initial" }
  | { kind: "retry"; retryCount: number; retryAttempt: number };

export type CodexConnectorReviewRequestPolicyOutcome =
  | "request_initial"
  | "request_retry"
  | "wait"
  | "block"
  | "advisory";

export type CodexConnectorReviewRequestPolicyReason =
  | "non_codex_provider"
  | "metadata_only_stale_review"
  | "unresolved_work"
  | "unknown_needs_operator"
  | "timeout_action_not_request_review_comment"
  | "waiting_for_timeout_trigger"
  | "readiness_not_eligible"
  | "request_not_yet_sent_for_current_head"
  | "request_comment_identity_present"
  | "retry_disabled"
  | "retry_exhausted"
  | "retry_wait_not_elapsed"
  | "retry_ready";

export type CodexConnectorReviewRequestPolicyDecision =
  | {
      outcome: Exclude<CodexConnectorReviewRequestPolicyOutcome, "request_retry">;
      reason: Exclude<CodexConnectorReviewRequestPolicyReason, "retry_ready">;
      action: { kind: "none" } | { kind: "initial" };
    }
  | {
      outcome: "request_retry";
      reason: "retry_ready";
      action: { kind: "retry"; retryCount: number; retryAttempt: number };
    };

export type CodexConnectorCurrentHeadReviewReadiness =
  | { kind: "eligible" }
  | {
      kind: "none";
      reason:
        | "non_codex_provider"
        | "draft_pr"
        | "changes_requested"
        | "merge_conflict"
        | "unsafe_configured_threads"
        | "manual_review_threads"
        | "current_head_already_observed"
        | "missing_fallback_signal"
        | "checks_not_green";
    };

export interface CodexConnectorCurrentHeadReviewReadinessArgs {
  config: SupervisorConfig;
  pr: GitHubPullRequest;
  checks: PullRequestCheck[];
  manualThreadCount: number;
  configuredThreadsAreSafe: boolean;
  checkSummary: { hasPending: boolean; hasFailing: boolean };
  mergeConflict: boolean;
}

export interface CodexConnectorReviewRequestDecisionArgs {
  config: SupervisorConfig;
  record: IssueRunRecord;
  pr: GitHubPullRequest;
  checks: PullRequestCheck[];
  reviewThreads: ReviewThread[];
  summarizeChecks: (checks: PullRequestCheck[]) => { hasPending: boolean; hasFailing: boolean };
  configuredBotReviewThreads: (config: SupervisorConfig, reviewThreads: ReviewThread[]) => ReviewThread[];
  manualReviewThreads: (config: SupervisorConfig, reviewThreads: ReviewThread[]) => ReviewThread[];
  mergeConflictDetected: (pr: GitHubPullRequest) => boolean;
  nowMs?: () => number;
}

export interface CodexConnectorReviewRequestMetadataPair {
  requestedAt: string | null;
  headSha: string | null;
}

export interface CodexConnectorReviewRequestPolicyArgs {
  configuredProviderKinds: ConfiguredReviewProviderKind[];
  timeoutAction: SupervisorConfig["configuredBotCurrentHeadSignalTimeoutAction"];
  currentHeadSha: string;
  currentHeadObservedAt: string | null;
  latestReviewedCommitSha: string | null;
  providerSuccessHeadSha: string | null;
  externalReviewHeadSha: string | null;
  staleReviewClassification: StaleReviewBotRemediationDto["classification"] | null;
  staleReviewCommitThreadCount: number;
  hasCurrentHeadRequestTrigger: boolean;
  currentHeadReviewRequestTimedOut: boolean;
  readiness: CodexConnectorCurrentHeadReviewReadiness;
  recordRequest: CodexConnectorReviewRequestMetadataPair;
  prRequest: CodexConnectorReviewRequestMetadataPair;
  hasRequestCommentIdentity: boolean;
  retryLimit: number;
  retryCountForCurrentHead: number;
  retryAnchorAt: string | null;
  retryNoResponseMinutes: number;
  nowMs: number;
}

function isValidTimestamp(value: string | null | undefined): boolean {
  return typeof value === "string" && value.length > 0 && !Number.isNaN(Date.parse(value));
}

export function codexConnectorCurrentHeadReviewReadiness(
  args: CodexConnectorCurrentHeadReviewReadinessArgs,
): CodexConnectorCurrentHeadReviewReadiness {
  const loadedChecksAreGreen =
    args.checks.length > 0 && args.checks.every((check) => check.bucket === "pass");
  const noChecksAndNoLocalCi = args.checks.length === 0 && !displayLocalCiCommand(args.config.localCiCommand);
  const hasFallbackEligibleSignal =
    isValidTimestamp(args.pr.currentHeadCiGreenAt) || loadedChecksAreGreen || noChecksAndNoLocalCi;

  if (!configuredReviewProviderKinds(args.config).includes("codex")) {
    return { kind: "none", reason: "non_codex_provider" };
  }

  if (args.pr.isDraft) {
    return { kind: "none", reason: "draft_pr" };
  }

  if (args.pr.reviewDecision === "CHANGES_REQUESTED") {
    return { kind: "none", reason: "changes_requested" };
  }

  if (args.mergeConflict) {
    return { kind: "none", reason: "merge_conflict" };
  }

  if (!args.configuredThreadsAreSafe) {
    return { kind: "none", reason: "unsafe_configured_threads" };
  }

  if (args.manualThreadCount > 0) {
    return { kind: "none", reason: "manual_review_threads" };
  }

  if (isValidTimestamp(args.pr.configuredBotCurrentHeadObservedAt)) {
    return { kind: "none", reason: "current_head_already_observed" };
  }

  if (args.checkSummary.hasPending || args.checkSummary.hasFailing) {
    return { kind: "none", reason: "checks_not_green" };
  }

  if (!hasFallbackEligibleSignal) {
    return { kind: "none", reason: "missing_fallback_signal" };
  }

  return { kind: "eligible" };
}

function addMinutes(timestamp: string, minutes: number): string | null {
  const parsed = Date.parse(timestamp);
  if (Number.isNaN(parsed)) {
    return null;
  }

  return new Date(parsed + minutes * 60_000).toISOString();
}

function completeRequestMetadataPair(
  requestedAt: string | null,
  headSha: string | null,
): { requestedAt: string; headSha: string } | null {
  return requestedAt && headSha ? { requestedAt, headSha } : null;
}

function reviewRequestPolicyInactiveReason(
  readiness: CodexConnectorCurrentHeadReviewReadiness,
): Exclude<CodexConnectorReviewRequestPolicyOutcome, "request_retry"> {
  if (readiness.kind === "eligible") {
    return "wait";
  }

  if (
    readiness.reason === "manual_review_threads" ||
    readiness.reason === "unsafe_configured_threads" ||
    readiness.reason === "changes_requested" ||
    readiness.reason === "merge_conflict"
  ) {
    return "block";
  }

  return readiness.reason === "current_head_already_observed" ? "advisory" : "wait";
}

function staleReviewPolicySuppressesRequest(
  args: Pick<
    CodexConnectorReviewRequestPolicyArgs,
    | "configuredProviderKinds"
    | "currentHeadObservedAt"
    | "latestReviewedCommitSha"
    | "providerSuccessHeadSha"
    | "externalReviewHeadSha"
    | "currentHeadSha"
    | "staleReviewClassification"
  >,
): CodexConnectorReviewRequestPolicyDecision | null {
  if (!args.configuredProviderKinds.includes("codex")) {
    return {
      outcome: "advisory",
      reason: "non_codex_provider",
      action: { kind: "none" },
    };
  }

  const isCodexMissingCurrentHeadReview =
    args.staleReviewClassification === "metadata_only_missing_current_head_review";
  const isStaleHeadMissingCurrentHeadReview =
    !isValidTimestamp(args.currentHeadObservedAt) &&
    (commitShasDifferForComparison(args.latestReviewedCommitSha, args.currentHeadSha) ||
      commitShasDifferForComparison(args.providerSuccessHeadSha, args.currentHeadSha) ||
      commitShasDifferForComparison(args.externalReviewHeadSha, args.currentHeadSha));
  if (isCodexMissingCurrentHeadReview || isStaleHeadMissingCurrentHeadReview) {
    return null;
  }

  if (
    args.staleReviewClassification === "metadata_only" ||
    args.staleReviewClassification === "metadata_only_current_head_converged" ||
    args.staleReviewClassification === "verified_no_source_change_pending_thread_resolution" ||
    args.staleReviewClassification === "verified_current_head_repair_pending_thread_resolution"
  ) {
    return {
      outcome: "advisory",
      reason: "metadata_only_stale_review",
      action: { kind: "none" },
    };
  }

  if (args.staleReviewClassification === "unresolved_work") {
    return {
      outcome: "block",
      reason: "unresolved_work",
      action: { kind: "none" },
    };
  }

  if (args.staleReviewClassification === "unknown_needs_operator") {
    return {
      outcome: "block",
      reason: "unknown_needs_operator",
      action: { kind: "none" },
    };
  }

  return null;
}

export function codexConnectorReviewRequestPolicy(
  args: CodexConnectorReviewRequestPolicyArgs,
): CodexConnectorReviewRequestPolicyDecision {
  const staleReviewSuppression = staleReviewPolicySuppressesRequest(args);
  if (staleReviewSuppression) {
    return staleReviewSuppression;
  }

  const hasRecoverableStaleReviewCommitResidue =
    args.configuredProviderKinds.includes("codex") &&
    args.staleReviewCommitThreadCount > 0 &&
    !isValidTimestamp(args.currentHeadObservedAt) &&
    (commitShasDifferForComparison(args.latestReviewedCommitSha, args.currentHeadSha) ||
      commitShasDifferForComparison(args.providerSuccessHeadSha, args.currentHeadSha) ||
      commitShasDifferForComparison(args.externalReviewHeadSha, args.currentHeadSha)) &&
    args.currentHeadReviewRequestTimedOut;

  if (args.timeoutAction !== "request_review_comment") {
    return {
      outcome: "wait",
      reason: "timeout_action_not_request_review_comment",
      action: { kind: "none" },
    };
  }

  if (!args.hasCurrentHeadRequestTrigger && !hasRecoverableStaleReviewCommitResidue) {
    return {
      outcome: "wait",
      reason: "waiting_for_timeout_trigger",
      action: { kind: "none" },
    };
  }

  if (args.readiness.kind !== "eligible") {
    return {
      outcome: reviewRequestPolicyInactiveReason(args.readiness),
      reason: "readiness_not_eligible",
      action: { kind: "none" },
    };
  }

  const request =
    completeRequestMetadataPair(args.recordRequest.requestedAt, args.recordRequest.headSha) ??
    completeRequestMetadataPair(args.prRequest.requestedAt, args.prRequest.headSha);
  const requestAt = request?.requestedAt ?? null;
  const requestHeadSha = request?.headSha ?? null;
  const requestMatchesCurrentHead = Boolean(requestAt && requestHeadSha === args.currentHeadSha);

  if (!requestMatchesCurrentHead) {
    return {
      outcome: "request_initial",
      reason: "request_not_yet_sent_for_current_head",
      action: { kind: "initial" },
    };
  }

  if (args.hasRequestCommentIdentity) {
    return {
      outcome: "advisory",
      reason: "request_comment_identity_present",
      action: { kind: "none" },
    };
  }

  if (args.retryLimit <= 0) {
    return {
      outcome: "wait",
      reason: "retry_disabled",
      action: { kind: "none" },
    };
  }

  if (args.retryCountForCurrentHead >= args.retryLimit) {
    return {
      outcome: "block",
      reason: "retry_exhausted",
      action: { kind: "none" },
    };
  }

  const waitUntil = args.retryAnchorAt ? addMinutes(args.retryAnchorAt, args.retryNoResponseMinutes) : null;
  if (!waitUntil || args.nowMs < Date.parse(waitUntil)) {
    return {
      outcome: "wait",
      reason: "retry_wait_not_elapsed",
      action: { kind: "none" },
    };
  }

  return {
    outcome: "request_retry",
    reason: "retry_ready",
    action: {
      kind: "retry",
      retryCount: args.retryCountForCurrentHead,
      retryAttempt: args.retryCountForCurrentHead + 1,
    },
  };
}

function hasProcessedReviewThreadOnNonCurrentHead(
  record: Pick<IssueRunRecord, "processed_review_thread_ids" | "processed_review_thread_fingerprints">,
  pr: Pick<GitHubPullRequest, "headRefOid">,
  thread: Pick<ReviewThread, "id" | "comments">,
): boolean {
  const latestCommentFingerprint = latestReviewThreadCommentFingerprint(thread);
  if (!latestCommentFingerprint) {
    return false;
  }

  const processedKeys = new Set(record.processed_review_thread_ids ?? []);
  const fingerprintPrefix = `${thread.id}@`;
  const fingerprintSuffix = `#${latestCommentFingerprint}`;
  return (record.processed_review_thread_fingerprints ?? []).some((key) => {
    if (!key.startsWith(fingerprintPrefix) || !key.endsWith(fingerprintSuffix)) {
      return false;
    }

    const headSha = key.slice(fingerprintPrefix.length, key.length - fingerprintSuffix.length);
    return Boolean(headSha && headSha !== pr.headRefOid && processedKeys.has(`${thread.id}@${headSha}`));
  });
}

function latestCommentIsSoftenedCodexP3Thread(thread: ReviewThread): boolean {
  const latestComment = latestReviewComment(thread);
  const latestLogin = latestComment?.author?.login;
  const allCommentsAreCodexConnector = thread.comments.nodes.every((comment) => {
    const login = comment.author?.login;
    return Boolean(login && isCodexConnectorReviewer(login));
  });
  return Boolean(
    allCommentsAreCodexConnector &&
    latestLogin &&
      latestComment &&
      isCodexConnectorReviewer(latestLogin) &&
      extractCodexConnectorPSeverity(latestComment.body) === "P3" &&
      !hasCodexConnectorStrongRiskWording(latestComment.body),
  );
}

function configuredBotThreadsAllowCodexConnectorRequest(args: {
  config: SupervisorConfig;
  record: IssueRunRecord;
  pr: GitHubPullRequest;
  reviewThreads: ReviewThread[];
  configuredThreads: ReviewThread[];
}): boolean {
  if (args.configuredThreads.length === 0) {
    return true;
  }

  const staleHeadConfiguredThreadIds = new Set(
    args.configuredThreads
      .filter(
        (thread) =>
          latestReviewCommentAuthorIsAllowedBot(args.config, thread) &&
          hasProcessedReviewThreadOnNonCurrentHead(args.record, args.pr, thread),
      )
      .map((thread) => thread.id),
  );
  const currentHeadConfiguredThreadIds = new Set(
    args.configuredThreads
      .filter((thread) => hasProcessedReviewThread(args.record, args.pr, thread))
      .map((thread) => thread.id),
  );
  const staleConfiguredThreadIds = new Set(
    staleConfiguredBotReviewThreads(args.config, args.record, args.pr, args.reviewThreads).map((thread) => thread.id),
  );
  const staleReviewCommitThreadIds = new Set(
    codexConnectorStaleReviewCommitThreads(args.pr, args.configuredThreads).map((thread) => thread.id),
  );
  const codexMustFixThreadIds = new Set(codexConnectorMustFixReviewThreads(args.configuredThreads).map((thread) => thread.id));
  const pureCodexSoftP3ThreadIds = new Set(
    args.configuredThreads
      .filter((thread) => latestCommentIsSoftenedCodexP3Thread(thread))
      .map((thread) => thread.id),
  );

  if (
    args.configuredThreads.some(
      (thread) =>
        codexMustFixThreadIds.has(thread.id) &&
        !staleHeadConfiguredThreadIds.has(thread.id) &&
        !currentHeadConfiguredThreadIds.has(thread.id) &&
        !staleConfiguredThreadIds.has(thread.id) &&
        !staleReviewCommitThreadIds.has(thread.id),
    )
  ) {
    return false;
  }

  if (configuredBotReviewFollowUpState(args.config, args.record, args.pr, args.configuredThreads) === "eligible") {
    return false;
  }

  return args.configuredThreads.every(
    (thread) =>
      pureCodexSoftP3ThreadIds.has(thread.id) ||
      staleHeadConfiguredThreadIds.has(thread.id) ||
      staleConfiguredThreadIds.has(thread.id) ||
      staleReviewCommitThreadIds.has(thread.id) ||
      (thread.isOutdated && latestReviewCommentAuthorIsAllowedBot(args.config, thread)) ||
      (latestReviewCommentAuthorIsAllowedBot(args.config, thread) &&
        hasProcessedReviewThread(args.record, args.pr, thread)),
  );
}

export function codexConnectorReviewRequestAction(
  args: CodexConnectorReviewRequestDecisionArgs,
): CodexConnectorReviewRequestAction {
  const nowMs = args.nowMs?.() ?? Date.now();
  const checkSummary = args.summarizeChecks(args.checks);
  const configuredProviderKinds = configuredReviewProviderKinds(args.config);
  const configuredThreads = args.configuredBotReviewThreads(args.config, args.reviewThreads);
  const staleCodexReviewState = configuredProviderKinds.includes("codex")
    ? buildStaleReviewBotRemediation({
        config: args.config,
        record: args.record,
        pr: args.pr,
        checks: args.checks,
        reviewThreads: args.reviewThreads,
      })
    : null;
  const staleReviewCommitThreadIds = new Set(
    codexConnectorStaleReviewCommitThreads(args.pr, configuredThreads).map((thread) => thread.id),
  );
  const configuredThreadsAreSafeForCodexRequest = configuredBotThreadsAllowCodexConnectorRequest({
    config: args.config,
    record: args.record,
    pr: args.pr,
    reviewThreads: args.reviewThreads,
    configuredThreads,
  });
  const hasCurrentHeadRequestTrigger =
    args.record.copilot_review_timeout_action === "request_review_comment" &&
    Boolean(args.record.copilot_review_timed_out_at);
  const currentHeadReviewTimeout = determineCopilotReviewTimeout(args.config, args.record, args.pr, nowMs);
  const currentHeadReviewRequestTimedOut =
    currentHeadReviewTimeout.kind === "current_head_signal" &&
    currentHeadReviewTimeout.timedOut &&
    currentHeadReviewTimeout.action === "request_review_comment";
  const readiness = codexConnectorCurrentHeadReviewReadiness({
    config: args.config,
    pr: args.pr,
    checks: args.checks,
    manualThreadCount: args.manualReviewThreads(args.config, args.reviewThreads).length,
    configuredThreadsAreSafe: configuredThreadsAreSafeForCodexRequest,
    checkSummary,
    mergeConflict: args.mergeConflictDetected(args.pr),
  });

  const recordRequestAt = args.record.codex_connector_review_requested_observed_at ?? null;
  const recordRequestHeadSha = args.record.codex_connector_review_requested_head_sha ?? null;
  const prRequestAt = args.pr.codexConnectorReviewRequestedAt ?? null;
  const prRequestHeadSha = args.pr.codexConnectorReviewRequestedHeadSha ?? null;
  const request =
    completeRequestMetadataPair(recordRequestAt, recordRequestHeadSha) ??
    completeRequestMetadataPair(prRequestAt, prRequestHeadSha);
  const requestAt = request?.requestedAt ?? null;
  const retryLimit = args.config.codexConnectorReviewRequestRetryLimit ?? 1;
  const retryCount =
    args.record.codex_connector_review_request_retry_head_sha === args.pr.headRefOid
      ? args.record.codex_connector_review_request_retry_count ?? 0
      : 0;
  const retryAnchorAt =
    args.record.codex_connector_review_request_retry_head_sha === args.pr.headRefOid &&
    args.record.codex_connector_review_request_last_retried_at
      ? args.record.codex_connector_review_request_last_retried_at
      : requestAt;

  return codexConnectorReviewRequestPolicy({
    configuredProviderKinds,
    timeoutAction: args.config.configuredBotCurrentHeadSignalTimeoutAction,
    currentHeadSha: args.pr.headRefOid,
    currentHeadObservedAt: args.pr.configuredBotCurrentHeadObservedAt ?? null,
    latestReviewedCommitSha: args.pr.configuredBotLatestReviewedCommitSha ?? null,
    providerSuccessHeadSha: args.record.provider_success_head_sha ?? null,
    externalReviewHeadSha: args.record.external_review_head_sha ?? null,
    staleReviewClassification: staleCodexReviewState?.classification ?? null,
    staleReviewCommitThreadCount: staleReviewCommitThreadIds.size,
    hasCurrentHeadRequestTrigger,
    currentHeadReviewRequestTimedOut,
    readiness,
    recordRequest: {
      requestedAt: recordRequestAt,
      headSha: recordRequestHeadSha,
    },
    prRequest: {
      requestedAt: prRequestAt,
      headSha: prRequestHeadSha,
    },
    hasRequestCommentIdentity: hasCodexConnectorReviewRequestCommentIdentity({ record: args.record, pr: args.pr }),
    retryLimit,
    retryCountForCurrentHead: retryCount,
    retryAnchorAt,
    retryNoResponseMinutes: args.config.codexConnectorReviewRequestNoResponseMinutes ?? 10,
    nowMs,
  }).action;
}
