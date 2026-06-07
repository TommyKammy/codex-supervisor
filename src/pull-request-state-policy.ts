import {
  localReviewDegradedNeedsBlock,
  localReviewFixBlockedNeedsRepair,
  localReviewFollowUpNeedsRepair,
  localReviewManualReviewNeedsRepair,
  localReviewBlocksMerge,
  localReviewHighSeverityNeedsBlock,
  localReviewHighSeverityNeedsRetry,
  localReviewRequiresManualReview,
  localReviewRetryLoopStalled,
  reviewDecisionAllowsSamePrRepair,
} from "./review-handling";
import { shouldRunLocalReview } from "./local-review";
import {
  mergeConflictDetected,
  summarizeChecks,
} from "./supervisor/supervisor-reporting";
import {
  codexConnectorMustFixReviewThreads,
  latestCodexConnectorReviewCommentFingerprint,
} from "./codex-connector-review-policy";
import {
  actionableConfiguredBotReviewThreads,
  configuredBotReviewFollowUpState,
  configuredBotReviewThreads,
  manualReviewThreads,
  pendingBotReviewThreads,
  staleConfiguredBotReviewThreads,
} from "./review-thread-reporting";
import {
  BlockedReason,
  FailureContext,
  GitHubPullRequest,
  IssueRunRecord,
  PullRequestCheck,
  ReviewThread,
  RunState,
  SupervisorConfig,
} from "./core/types";
import {
  configuredBotCurrentHeadSignalPending,
  configuredReviewBotLabel,
  copilotReviewPending,
  determineConfiguredBotRateLimitWait,
  determineCopilotReviewTimeout as determineCopilotReviewTimeoutForNow,
  shouldWaitForConfiguredBotCurrentHeadQuietPeriod,
  shouldWaitForConfiguredBotDraftSkipRearm,
  shouldWaitForConfiguredBotInitialGracePeriod,
  shouldWaitForConfiguredBotLatestHeadRearm,
  shouldWaitForCopilotReviewPropagation,
} from "./pull-request-state-current-head-policy";
import { reviewLoopRetryBudgetExhaustedForThread } from "./review-handling";
import {
  effectiveConfiguredBotReviewThreadsForState,
  hasConfiguredProviderSuccess,
  hasProvenCodexConnectorStaleReviewMetadata,
  processedCodexConnectorMustFixThreadsExhaustedRepeatBudget,
  shouldWaitForCodexConnectorCurrentHeadReview,
  staleSameHeadCodexWaitHasOnlyOutdatedResidue,
} from "./pull-request-state-codex-residue-policy";
import { displayLocalCiCommand } from "./core/config-parsing";
import { nowIso } from "./core/utils";
import { hasQueuedReadyPromotionPathHygieneRepair } from "./ready-promotion-path-hygiene-repair";

export type GitHubWaitStep =
  | "configured_bot_rate_limit_wait"
  | "configured_bot_initial_grace_wait"
  | "configured_bot_current_head_signal_wait"
  | "configured_bot_settled_wait"
  | "copilot_review_propagation_wait"
  | "copilot_review_requested_wait"
  | "checks_pending";

export { copilotReviewArrived } from "./pull-request-state-current-head-policy";
export { effectiveConfiguredBotReviewThreadsForState } from "./pull-request-state-codex-residue-policy";

function pullRequestStateInferenceNowMs(nowMs?: number): number {
  return nowMs ?? Date.now.call(Date);
}

function reviewSatisfied(pr: GitHubPullRequest): boolean {
  return (
    (pr.reviewDecision !== "CHANGES_REQUESTED" || pr.configuredBotTopLevelReviewStrength === "nitpick_only") &&
    pr.reviewDecision !== "REVIEW_REQUIRED"
  );
}

export function determineCopilotReviewTimeout(
  config: SupervisorConfig,
  record: IssueRunRecord,
  pr: GitHubPullRequest,
  nowMs = pullRequestStateInferenceNowMs(),
) {
  return determineCopilotReviewTimeoutForNow(config, record, pr, nowMs);
}

export function buildCopilotReviewTimeoutFailureContext(
  config: SupervisorConfig,
  record: IssueRunRecord,
  pr: GitHubPullRequest,
  nowMs = pullRequestStateInferenceNowMs(),
): FailureContext | null {
  const timeout = determineCopilotReviewTimeout(config, record, pr, nowMs);
  if (!timeout.timedOut || timeout.action !== "block") {
    return null;
  }

  const summary =
    timeout.kind === "current_head_signal"
      ? `PR #${pr.number} is blocked while waiting for a current-head ${configuredReviewBotLabel(config)} signal.`
      : `PR #${pr.number} is blocked after a requested ${configuredReviewBotLabel(config)} review timed out.`;

  return {
    category: "blocked",
    summary,
    signature: `review-bot-timeout:${pr.headRefOid}:${timeout.action}`,
    command: null,
    details: [
      `timeout_kind=${timeout.kind ?? "none"}`,
      `requested_at=${timeout.startedAt ?? "none"}`,
      `timed_out_at=${timeout.timedOutAt ?? "none"}`,
      `timeout_minutes=${timeout.timeoutMinutes ?? "none"}`,
      timeout.reason ?? `${configuredReviewBotLabel(config)} review wait timed out.`,
    ],
    url: pr.url,
    updated_at: nowIso(),
  };
}

function mergeConditionsSatisfied(pr: GitHubPullRequest, checks: PullRequestCheck[]): boolean {
  const checkSummary = summarizeChecks(checks);
  return (
    pr.state === "OPEN" &&
    !pr.isDraft &&
    reviewSatisfied(pr) &&
    checkSummary.allPassing &&
    pr.mergeStateStatus === "CLEAN"
  );
}

function pullRequestHeadMatchesRecord(record: Pick<IssueRunRecord, "last_head_sha">, pr: GitHubPullRequest): boolean {
  return record.last_head_sha === null || record.last_head_sha === pr.headRefOid;
}

function isMergeCriticalPullRequest(pr: GitHubPullRequest): boolean {
  return pr.state === "OPEN" && !pr.isDraft && !pr.mergedAt;
}

export function syncMergeLatencyVisibility(
  config: SupervisorConfig,
  record: IssueRunRecord,
  pr: GitHubPullRequest,
  checks: PullRequestCheck[],
  reviewThreads: ReviewThread[],
): Pick<
  IssueRunRecord,
  "provider_success_observed_at" | "provider_success_head_sha" | "merge_readiness_last_evaluated_at"
> {
  const observedNow = nowIso();
  const mergeReadinessLastEvaluatedAt = isMergeCriticalPullRequest(pr) ? observedNow : null;

  if (!hasConfiguredProviderSuccess(config, record, pr, checks, reviewThreads)) {
    return {
      provider_success_observed_at: null,
      provider_success_head_sha: null,
      merge_readiness_last_evaluated_at: mergeReadinessLastEvaluatedAt,
    };
  }

  if (record.provider_success_head_sha === pr.headRefOid && record.provider_success_observed_at) {
    return {
      provider_success_observed_at: record.provider_success_observed_at,
      provider_success_head_sha: record.provider_success_head_sha ?? pr.headRefOid,
      merge_readiness_last_evaluated_at: mergeReadinessLastEvaluatedAt,
    };
  }

  return {
    provider_success_observed_at: observedNow,
    provider_success_head_sha: pr.headRefOid,
    merge_readiness_last_evaluated_at: mergeReadinessLastEvaluatedAt,
  };
}

export function blockedReasonFromReviewState(
  config: SupervisorConfig,
  record: IssueRunRecord,
  pr: GitHubPullRequest,
  checks: PullRequestCheck[],
  reviewThreads: ReviewThread[],
  nowMs = pullRequestStateInferenceNowMs(),
): Exclude<BlockedReason, null> | null {
  const manualThreads = manualReviewThreads(config, reviewThreads);
  const provenCodexStaleReviewMetadata = hasProvenCodexConnectorStaleReviewMetadata({
    config,
    record,
    pr,
    checks,
    reviewThreads,
  });
  const unresolvedBotThreads = effectiveConfiguredBotReviewThreadsForState(config, record, pr, checks, reviewThreads);
  const staleBotThreads =
    manualThreads.length === 0 && !provenCodexStaleReviewMetadata
      ? staleConfiguredBotReviewThreads(config, record, pr, unresolvedBotThreads)
      : [];
  const checkSummary = summarizeChecks(checks);
  const staleCodexWaitHasOnlyOutdatedResidue = staleSameHeadCodexWaitHasOnlyOutdatedResidue(
    config,
    record,
    pr,
    checks,
    reviewThreads,
  );
  const copilotTimeout = determineCopilotReviewTimeout(config, record, pr, nowMs);
  if (
    copilotTimeout.timedOut &&
    copilotTimeout.action === "block" &&
    !provenCodexStaleReviewMetadata &&
    !staleCodexWaitHasOnlyOutdatedResidue
  ) {
    return "review_bot_timeout";
  }

  if (manualThreads.length > 0) {
    return "manual_review";
  }

  if (
    staleBotThreads.length > 0 &&
    !checkSummary.hasPending &&
    !checkSummary.hasFailing &&
    !mergeConflictDetected(pr)
  ) {
    return "stale_review_bot";
  }

  if (unresolvedBotThreads.length > 0) {
    return "manual_review";
  }

  if (
    pr.reviewDecision === "CHANGES_REQUESTED" &&
    (pr.configuredBotTopLevelReviewStrength === "blocking" ||
      (config.humanReviewBlocksMerge && pr.configuredBotTopLevelReviewStrength !== "nitpick_only"))
  ) {
    return "manual_review";
  }

  if (localReviewRequiresManualReview(config, record, pr)) {
    return "manual_review";
  }

  if (localReviewDegradedNeedsBlock(config, record, pr)) {
    return "verification";
  }

  if (localReviewHighSeverityNeedsBlock(config, record, pr) || localReviewBlocksMerge(config, record, pr)) {
    return "verification";
  }

  return null;
}

export function inferStateFromPullRequest(
  config: SupervisorConfig,
  record: IssueRunRecord,
  pr: GitHubPullRequest,
  checks: PullRequestCheck[],
  reviewThreads: ReviewThread[],
  nowMs = pullRequestStateInferenceNowMs(),
): RunState {
  const manualThreads = manualReviewThreads(config, reviewThreads);
  const provenCodexStaleReviewMetadata = hasProvenCodexConnectorStaleReviewMetadata({
    config,
    record,
    pr,
    checks,
    reviewThreads,
  });
  const unresolvedBotThreads = effectiveConfiguredBotReviewThreadsForState(config, record, pr, checks, reviewThreads);
  const codexConnectorMustFixThreads = codexConnectorMustFixReviewThreads(unresolvedBotThreads);
  const codexConnectorMustFixThreadIds = new Set(codexConnectorMustFixThreads.map((thread) => thread.id));
  const retryFingerprintForThread = (thread: ReviewThread) =>
    codexConnectorMustFixThreadIds.has(thread.id) ? latestCodexConnectorReviewCommentFingerprint(thread) : undefined;
  const reviewLoopRetryBudgetAvailable = (thread: ReviewThread) =>
    !reviewLoopRetryBudgetExhaustedForThread(record, pr, thread, 1, retryFingerprintForThread(thread));
  const pendingBotThreads = pendingBotReviewThreads(config, record, pr, unresolvedBotThreads).filter(
    reviewLoopRetryBudgetAvailable,
  );
  const botFollowUpState = configuredBotReviewFollowUpState(config, record, pr, unresolvedBotThreads);
  const actionableFollowUpThreads = actionableConfiguredBotReviewThreads(config, unresolvedBotThreads).filter(
    (thread) => !thread.isResolved && !thread.isOutdated,
  );
  const availableActionableFollowUpThreads = actionableFollowUpThreads.filter(reviewLoopRetryBudgetAvailable);
  const botFollowUpStateEligibleWithRetryBudget =
    botFollowUpState === "eligible" && availableActionableFollowUpThreads.length > 0;
  const botFollowUpStateExhaustedByRetryBudget =
    botFollowUpState === "eligible" &&
    actionableFollowUpThreads.length > 0 &&
    availableActionableFollowUpThreads.length === 0;
  const codexConnectorMustFixThreadsExhausted =
    codexConnectorMustFixThreads.length > 0 &&
    codexConnectorMustFixThreads.every((thread) => !reviewLoopRetryBudgetAvailable(thread));
  const checkSummary = summarizeChecks(checks);
  const staleCodexWaitHasOnlyOutdatedResidue = staleSameHeadCodexWaitHasOnlyOutdatedResidue(
    config,
    record,
    pr,
    checks,
    reviewThreads,
  );

  if (pr.mergedAt || pr.state === "MERGED") {
    return "done";
  }

  if (
    !provenCodexStaleReviewMetadata &&
    shouldWaitForCodexConnectorCurrentHeadReview({
      config,
      record,
      pr,
      checks,
      reviewThreads,
      manualThreads,
      unresolvedBotThreads,
      nowMs,
    })
  ) {
    return "waiting_ci";
  }

  if (pr.reviewDecision === "CHANGES_REQUESTED") {
    if (
      processedCodexConnectorMustFixThreadsExhaustedRepeatBudget({
        config,
        record,
        pr,
        checks,
        manualThreads,
        codexConnectorMustFixThreads,
      })
    ) {
      return "blocked";
    }

    if (pendingBotThreads.length > 0 || (botFollowUpStateEligibleWithRetryBudget && manualThreads.length === 0)) {
      return "addressing_review";
    }

    const nitpickOnlyConfiguredBotReview =
      pr.configuredBotTopLevelReviewStrength === "nitpick_only" &&
      unresolvedBotThreads.length === 0 &&
      manualThreads.length === 0;

    if (unresolvedBotThreads.length > 0 || pr.configuredBotTopLevelReviewStrength === "blocking") {
      if (
        codexConnectorMustFixThreads.length > 0 &&
        !codexConnectorMustFixThreadsExhausted &&
        !checkSummary.hasFailing &&
        !checkSummary.hasPending &&
        (!config.humanReviewBlocksMerge || manualThreads.length === 0) &&
        !mergeConflictDetected(pr)
      ) {
        return "addressing_review";
      }

      return "blocked";
    }

    if (config.humanReviewBlocksMerge && !nitpickOnlyConfiguredBotReview) {
      return "blocked";
    }

    if (!nitpickOnlyConfiguredBotReview) {
      return "pr_open";
    }
  }

  if (
    localReviewRetryLoopStalled(
      config,
      record,
      pr,
      checks,
      reviewThreads,
      manualReviewThreads,
      configuredBotReviewThreads,
      summarizeChecks,
      mergeConflictDetected,
    )
  ) {
    return "blocked";
  }

  if (localReviewHighSeverityNeedsRetry(config, record, pr)) {
    return "local_review_fix";
  }

  if (
    localReviewFixBlockedNeedsRepair(config, record, pr) &&
    reviewDecisionAllowsSamePrRepair(pr) &&
    !checkSummary.hasFailing &&
    !checkSummary.hasPending &&
    unresolvedBotThreads.length === 0 &&
    (!config.humanReviewBlocksMerge || manualThreads.length === 0) &&
    !mergeConflictDetected(pr)
  ) {
    return "local_review_fix";
  }

  if (
    localReviewFollowUpNeedsRepair(config, record, pr) &&
    !checkSummary.hasFailing &&
    !checkSummary.hasPending &&
    unresolvedBotThreads.length === 0 &&
    (!config.humanReviewBlocksMerge || manualThreads.length === 0) &&
    !mergeConflictDetected(pr)
  ) {
    return "local_review_fix";
  }

  if (
    localReviewManualReviewNeedsRepair(config, record, pr) &&
    !checkSummary.hasFailing &&
    !checkSummary.hasPending &&
    unresolvedBotThreads.length === 0 &&
    (!config.humanReviewBlocksMerge || manualThreads.length === 0) &&
    !mergeConflictDetected(pr)
  ) {
    return "local_review_fix";
  }

  if (
    codexConnectorMustFixThreads.length > 0 &&
    !codexConnectorMustFixThreadsExhausted &&
    !checkSummary.hasFailing &&
    !checkSummary.hasPending &&
    (!config.humanReviewBlocksMerge || manualThreads.length === 0) &&
    !mergeConflictDetected(pr)
  ) {
    return "addressing_review";
  }

  if (codexConnectorMustFixThreadsExhausted && !checkSummary.hasFailing && !checkSummary.hasPending) {
    return "blocked";
  }

  if (checkSummary.hasFailing) {
    return "repairing_ci";
  }

  if (pendingBotThreads.length > 0 || (botFollowUpStateEligibleWithRetryBudget && manualThreads.length === 0)) {
    return "addressing_review";
  }

  if (
    botFollowUpStateExhaustedByRetryBudget &&
    manualThreads.length === 0 &&
    !checkSummary.hasFailing &&
    !checkSummary.hasPending &&
    !mergeConflictDetected(pr)
  ) {
    return "blocked";
  }

  if (unresolvedBotThreads.length > 0) {
    return "blocked";
  }

  if (config.humanReviewBlocksMerge && manualThreads.length > 0) {
    return "blocked";
  }

  if (localReviewHighSeverityNeedsBlock(config, record, pr)) {
    return "blocked";
  }

  if (
    !pr.isDraft &&
    shouldRunLocalReview(config, record, pr) &&
    !checkSummary.hasPending &&
    unresolvedBotThreads.length === 0 &&
    (!config.humanReviewBlocksMerge || manualThreads.length === 0) &&
    !mergeConflictDetected(pr)
  ) {
    return "local_review";
  }

  if (
    !pr.isDraft &&
    shouldRunLocalReview(config, record, pr) &&
    checkSummary.hasPending &&
    unresolvedBotThreads.length === 0 &&
    (!config.humanReviewBlocksMerge || manualThreads.length === 0) &&
    !mergeConflictDetected(pr)
  ) {
    return "waiting_ci";
  }

  if (localReviewRequiresManualReview(config, record, pr)) {
    return "blocked";
  }

  if (localReviewDegradedNeedsBlock(config, record, pr)) {
    return "blocked";
  }

  if (mergeConflictDetected(pr)) {
    return "resolving_conflict";
  }

  if (localReviewBlocksMerge(config, record, pr)) {
    return "blocked";
  }

  if (hasQueuedReadyPromotionPathHygieneRepair(record, pr)) {
    return "repairing_ci";
  }

  if (pr.isDraft) {
    return "draft_pr";
  }

  const configuredBotRateLimitWait = determineConfiguredBotRateLimitWait(config, pr, nowMs);
  if (configuredBotRateLimitWait.active) {
    return "waiting_ci";
  }

  const copilotTimeout = determineCopilotReviewTimeout(config, record, pr, nowMs);
  if (
    copilotTimeout.timedOut &&
    copilotTimeout.action === "block" &&
    !provenCodexStaleReviewMetadata &&
    !staleCodexWaitHasOnlyOutdatedResidue
  ) {
    return "blocked";
  }

  if (
    copilotTimeout.timedOut &&
    copilotTimeout.action === "request_review_comment" &&
    !provenCodexStaleReviewMetadata &&
    !staleCodexWaitHasOnlyOutdatedResidue
  ) {
    return "waiting_ci";
  }

  if (shouldWaitForConfiguredBotLatestHeadRearm(config, record, pr, nowMs)) {
    return "waiting_ci";
  }

  if (shouldWaitForConfiguredBotDraftSkipRearm(config, record, pr, nowMs)) {
    return "waiting_ci";
  }

  if (shouldWaitForConfiguredBotInitialGracePeriod(config, pr, nowMs)) {
    return "waiting_ci";
  }

  if (shouldWaitForConfiguredBotCurrentHeadQuietPeriod(config, pr, nowMs)) {
    return "waiting_ci";
  }

  if (
    !provenCodexStaleReviewMetadata &&
    !staleCodexWaitHasOnlyOutdatedResidue &&
    configuredBotCurrentHeadSignalPending(config, record, pr) &&
    !copilotTimeout.timedOut
  ) {
    return "waiting_ci";
  }

  if (shouldWaitForCopilotReviewPropagation(config, record, pr, nowMs)) {
    return "waiting_ci";
  }

  if (copilotReviewPending(config, record, pr) && !copilotTimeout.timedOut) {
    return "waiting_ci";
  }

  if (!pullRequestHeadMatchesRecord(record, pr) && mergeConditionsSatisfied(pr, checks)) {
    return "stabilizing";
  }

  if (mergeConditionsSatisfied(pr, checks)) {
    return "ready_to_merge";
  }

  if (checkSummary.hasPending) {
    return "waiting_ci";
  }

  return "pr_open";
}

export function inferGitHubWaitStep(
  config: SupervisorConfig,
  record: IssueRunRecord,
  pr: GitHubPullRequest,
  checks: PullRequestCheck[],
  reviewThreadsOrNowMs: ReviewThread[] | number = pullRequestStateInferenceNowMs(),
  maybeNowMs?: number,
): GitHubWaitStep | null {
  const reviewThreads = Array.isArray(reviewThreadsOrNowMs) ? reviewThreadsOrNowMs : [];
  const nowMs =
    typeof reviewThreadsOrNowMs === "number"
      ? reviewThreadsOrNowMs
      : maybeNowMs ?? pullRequestStateInferenceNowMs();
  const configuredBotRateLimitWait = determineConfiguredBotRateLimitWait(config, pr, nowMs);
  if (configuredBotRateLimitWait.active) {
    return "configured_bot_rate_limit_wait";
  }

  if (shouldWaitForConfiguredBotLatestHeadRearm(config, record, pr, nowMs)) {
    return "configured_bot_initial_grace_wait";
  }

  if (shouldWaitForConfiguredBotDraftSkipRearm(config, record, pr, nowMs)) {
    return "configured_bot_initial_grace_wait";
  }

  if (shouldWaitForConfiguredBotInitialGracePeriod(config, pr, nowMs)) {
    return "configured_bot_initial_grace_wait";
  }

  if (shouldWaitForConfiguredBotCurrentHeadQuietPeriod(config, pr, nowMs)) {
    return "configured_bot_settled_wait";
  }

  const copilotTimeout = determineCopilotReviewTimeout(config, record, pr, nowMs);
  const staleCodexWaitHasOnlyOutdatedResidue =
    reviewThreads.length > 0 && staleSameHeadCodexWaitHasOnlyOutdatedResidue(config, record, pr, checks, reviewThreads);
  if (
    !staleCodexWaitHasOnlyOutdatedResidue &&
    configuredBotCurrentHeadSignalPending(config, record, pr) &&
    !copilotTimeout.timedOut
  ) {
    return "configured_bot_current_head_signal_wait";
  }

  if (shouldWaitForCopilotReviewPropagation(config, record, pr, nowMs)) {
    return "copilot_review_propagation_wait";
  }

  if (copilotReviewPending(config, record, pr) && !copilotTimeout.timedOut) {
    return "copilot_review_requested_wait";
  }

  if (summarizeChecks(checks).hasPending) {
    return "checks_pending";
  }

  return null;
}
