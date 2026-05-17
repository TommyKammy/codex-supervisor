import { displayLocalCiCommand } from "./core/config-parsing";
import { configuredReviewProviderKinds } from "./core/review-providers";
import type { GitHubPullRequest, IssueRunRecord, PullRequestCheck, ReviewThread, SupervisorConfig } from "./core/types";
import {
  hasProcessedReviewThread,
  latestReviewThreadCommentFingerprint,
} from "./review-handling";
import {
  codexConnectorMustFixReviewThreads,
  configuredBotReviewFollowUpState,
  latestReviewCommentAuthorIsAllowedBot,
  staleConfiguredBotReviewThreads,
} from "./review-thread-reporting";
import { buildStaleReviewBotRemediation } from "./supervisor/stale-review-bot-remediation";

export type CodexConnectorReviewRequestAction =
  | { kind: "none" }
  | { kind: "initial" }
  | { kind: "retry"; retryCount: number; retryAttempt: number };

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
  const codexMustFixThreadIds = new Set(codexConnectorMustFixReviewThreads(args.configuredThreads).map((thread) => thread.id));

  if (
    args.configuredThreads.some(
      (thread) =>
        codexMustFixThreadIds.has(thread.id) &&
        !staleHeadConfiguredThreadIds.has(thread.id) &&
        !currentHeadConfiguredThreadIds.has(thread.id) &&
        !staleConfiguredThreadIds.has(thread.id),
    )
  ) {
    return false;
  }

  if (configuredBotReviewFollowUpState(args.config, args.record, args.pr, args.configuredThreads) === "eligible") {
    return false;
  }

  return args.configuredThreads.every(
    (thread) =>
      staleHeadConfiguredThreadIds.has(thread.id) ||
      staleConfiguredThreadIds.has(thread.id) ||
      (latestReviewCommentAuthorIsAllowedBot(args.config, thread) &&
        hasProcessedReviewThread(args.record, args.pr, thread)),
  );
}

export function codexConnectorReviewRequestAction(
  args: CodexConnectorReviewRequestDecisionArgs,
): CodexConnectorReviewRequestAction {
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
  const isCodexMetadataOnly =
    staleCodexReviewState?.classification === "metadata_only" ||
    staleCodexReviewState?.classification === "metadata_only_missing_current_head_review" ||
    staleCodexReviewState?.classification === "metadata_only_current_head_converged" ||
    isCodexVerifiedNoSourceChangeThreadResolution ||
    isCodexVerifiedCurrentHeadRepairThreadResolution;

  if (
    configuredReviewProviderKinds(args.config).includes("codex") &&
    !isCodexMissingCurrentHeadReview &&
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
  const loadedChecksAreGreen =
    args.checks.length > 0 && args.checks.every((check) => check.bucket === "pass");
  const noChecksAndNoLocalCi = args.checks.length === 0 && !displayLocalCiCommand(args.config.localCiCommand);
  const hasFallbackEligibleSignal =
    isValidTimestamp(args.pr.currentHeadCiGreenAt) || loadedChecksAreGreen || noChecksAndNoLocalCi;

  if (
    args.config.configuredBotCurrentHeadSignalTimeoutAction !== "request_review_comment" ||
    !configuredReviewProviderKinds(args.config).includes("codex") ||
    args.record.copilot_review_timeout_action !== "request_review_comment" ||
    !args.record.copilot_review_timed_out_at ||
    args.pr.isDraft ||
    args.pr.reviewDecision === "CHANGES_REQUESTED" ||
    args.mergeConflictDetected(args.pr) ||
    !configuredThreadsAreSafeForCodexRequest ||
    args.manualReviewThreads(args.config, args.reviewThreads).length > 0 ||
    isValidTimestamp(args.pr.configuredBotCurrentHeadObservedAt) ||
    !hasFallbackEligibleSignal
  ) {
    return { kind: "none" };
  }

  if (checkSummary.hasPending || checkSummary.hasFailing) {
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
  if (!waitUntil || (args.nowMs ?? Date.now)() < Date.parse(waitUntil)) {
    return { kind: "none" };
  }

  return {
    kind: "retry",
    retryCount,
    retryAttempt: retryCount + 1,
  };
}
