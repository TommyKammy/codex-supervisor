import { displayLocalCiCommand } from "./core/config-parsing";
import { configuredReviewProviderKinds } from "./core/review-providers";
import type { GitHubPullRequest, IssueRunRecord, PullRequestCheck, ReviewThread, SupervisorConfig } from "./core/types";
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
  const configuredThreads = args.configuredBotReviewThreads(args.config, args.reviewThreads);
  const staleCodexReviewState = configuredReviewProviderKinds(args.config).includes("codex")
    ? buildStaleReviewBotRemediation({
        config: args.config,
        record: args.record,
        pr: args.pr,
        checks: args.checks,
        reviewThreads: args.reviewThreads,
      })
    : null;
  const isCodexMissingCurrentHeadReview =
    staleCodexReviewState?.classification === "metadata_only_missing_current_head_review";
  const isCodexConvergedCurrentHeadReview =
    staleCodexReviewState?.classification === "metadata_only_current_head_converged";
  const isCodexVerifiedNoSourceChangeThreadResolution =
    staleCodexReviewState?.classification === "verified_no_source_change_pending_thread_resolution";
  const isCodexVerifiedCurrentHeadRepairThreadResolution =
    staleCodexReviewState?.classification === "verified_current_head_repair_pending_thread_resolution";
  const staleReviewCommitThreadIds = new Set(
    codexConnectorStaleReviewCommitThreads(args.pr, configuredThreads).map((thread) => thread.id),
  );
  const isStaleHeadMissingCurrentHeadReview =
    !isValidTimestamp(args.pr.configuredBotCurrentHeadObservedAt) &&
    (commitShasDifferForComparison(args.pr.configuredBotLatestReviewedCommitSha, args.pr.headRefOid) ||
      commitShasDifferForComparison(args.record.provider_success_head_sha, args.pr.headRefOid) ||
      commitShasDifferForComparison(args.record.external_review_head_sha, args.pr.headRefOid));
  const isCodexMetadataOnly =
    staleCodexReviewState?.classification === "metadata_only" ||
    staleCodexReviewState?.classification === "metadata_only_missing_current_head_review" ||
    staleCodexReviewState?.classification === "metadata_only_current_head_converged" ||
    isCodexVerifiedNoSourceChangeThreadResolution ||
    isCodexVerifiedCurrentHeadRepairThreadResolution;

  if (
    configuredReviewProviderKinds(args.config).includes("codex") &&
    !isCodexMissingCurrentHeadReview &&
    !isStaleHeadMissingCurrentHeadReview &&
    (isCodexConvergedCurrentHeadReview ||
      isCodexVerifiedNoSourceChangeThreadResolution ||
      isCodexVerifiedCurrentHeadRepairThreadResolution ||
      isCodexMetadataOnly ||
      staleCodexReviewState?.classification === "unresolved_work" ||
      staleCodexReviewState?.classification === "unknown_needs_operator")
  ) {
    return { kind: "none" };
  }

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
  const hasRecoverableStaleReviewCommitResidue =
    configuredReviewProviderKinds(args.config).includes("codex") &&
    staleReviewCommitThreadIds.size > 0 &&
    isStaleHeadMissingCurrentHeadReview &&
    currentHeadReviewRequestTimedOut;

  if (
    args.config.configuredBotCurrentHeadSignalTimeoutAction !== "request_review_comment" ||
    (!hasCurrentHeadRequestTrigger && !hasRecoverableStaleReviewCommitResidue) ||
    codexConnectorCurrentHeadReviewReadiness({
      config: args.config,
      pr: args.pr,
      checks: args.checks,
      manualThreadCount: args.manualReviewThreads(args.config, args.reviewThreads).length,
      configuredThreadsAreSafe: configuredThreadsAreSafeForCodexRequest,
      checkSummary,
      mergeConflict: args.mergeConflictDetected(args.pr),
    }).kind !== "eligible"
  ) {
    return { kind: "none" };
  }

  const recordRequestAt = args.record.codex_connector_review_requested_observed_at ?? null;
  const recordRequestHeadSha = args.record.codex_connector_review_requested_head_sha ?? null;
  const prRequestAt = args.pr.codexConnectorReviewRequestedAt ?? null;
  const prRequestHeadSha = args.pr.codexConnectorReviewRequestedHeadSha ?? null;
  const request =
    completeRequestMetadataPair(recordRequestAt, recordRequestHeadSha) ??
    completeRequestMetadataPair(prRequestAt, prRequestHeadSha);
  const requestAt = request?.requestedAt ?? null;
  const requestHeadSha = request?.headSha ?? null;
  const requestMatchesCurrentHead = Boolean(requestAt && requestHeadSha === args.pr.headRefOid);

  if (!requestMatchesCurrentHead) {
    return { kind: "initial" };
  }

  if (hasCodexConnectorReviewRequestCommentIdentity({ record: args.record, pr: args.pr })) {
    return { kind: "none" };
  }

  const retryLimit = args.config.codexConnectorReviewRequestRetryLimit ?? 1;
  if (retryLimit <= 0) {
    return { kind: "none" };
  }

  const retryCount =
    args.record.codex_connector_review_request_retry_head_sha === args.pr.headRefOid
      ? args.record.codex_connector_review_request_retry_count ?? 0
      : 0;
  if (retryCount >= retryLimit) {
    return { kind: "none" };
  }

  const retryAnchorAt =
    args.record.codex_connector_review_request_retry_head_sha === args.pr.headRefOid &&
    args.record.codex_connector_review_request_last_retried_at
      ? args.record.codex_connector_review_request_last_retried_at
      : requestAt;
  const waitUntil = retryAnchorAt
    ? addMinutes(retryAnchorAt, args.config.codexConnectorReviewRequestNoResponseMinutes ?? 10)
    : null;
  if (!waitUntil || nowMs < Date.parse(waitUntil)) {
    return { kind: "none" };
  }

  return {
    kind: "retry",
    retryCount,
    retryAttempt: retryCount + 1,
  };
}
