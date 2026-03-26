import {
  localReviewBlocksMerge,
  localReviewHighSeverityNeedsBlock,
  localReviewHighSeverityNeedsRetry,
  localReviewRequiresManualReview,
  localReviewRetryLoopStalled,
} from "./review-handling";
import {
  mergeConflictDetected,
  summarizeChecks,
} from "./supervisor/supervisor-reporting";
import {
  configuredBotReviewFollowUpState,
  configuredBotReviewThreads,
  manualReviewThreads,
  pendingBotReviewThreads,
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
  repoExpectsConfiguredBotReview,
  reviewProviderWaitPolicyFromConfig,
} from "./core/review-providers";
import { nowIso } from "./core/utils";

const COPILOT_REVIEW_PROPAGATION_GRACE_MS = 5_000;
const DEFAULT_CONFIGURED_BOT_SETTLED_WAIT_MS = 5_000;
const DEFAULT_CONFIGURED_BOT_INITIAL_GRACE_WAIT_MS = 90_000;

interface CopilotReviewTimeoutStatus {
  timedOut: boolean;
  action: SupervisorConfig["copilotReviewTimeoutAction"] | null;
  startedAt: string | null;
  timedOutAt: string | null;
  reason: string | null;
}

interface ConfiguredBotRateLimitWaitStatus {
  active: boolean;
  observedAt: string | null;
  waitUntil: string | null;
}

export type GitHubWaitStep =
  | "configured_bot_rate_limit_wait"
  | "configured_bot_initial_grace_wait"
  | "configured_bot_settled_wait"
  | "copilot_review_propagation_wait"
  | "copilot_review_requested_wait"
  | "checks_pending";

function reviewSatisfied(pr: GitHubPullRequest): boolean {
  return (
    (pr.reviewDecision !== "CHANGES_REQUESTED" || pr.configuredBotTopLevelReviewStrength === "nitpick_only") &&
    pr.reviewDecision !== "REVIEW_REQUIRED"
  );
}

function configuredReviewBotLabel(config: SupervisorConfig): string {
  return reviewProviderWaitPolicyFromConfig(config).botLabel;
}

function copilotReviewArrived(pr: GitHubPullRequest): boolean {
  return (pr.copilotReviewState ?? "not_requested") === "arrived" || Boolean(pr.copilotReviewArrivedAt);
}

function determineConfiguredBotRateLimitWait(
  config: SupervisorConfig,
  pr: GitHubPullRequest,
): ConfiguredBotRateLimitWaitStatus {
  const policy = reviewProviderWaitPolicyFromConfig(config);
  const waitMinutes = config.configuredBotRateLimitWaitMinutes ?? 0;
  if (
    !policy.shouldApplyRateLimitCooldown ||
    waitMinutes <= 0 ||
    pr.isDraft ||
    copilotReviewArrived(pr) ||
    !pr.configuredBotRateLimitedAt
  ) {
    return { active: false, observedAt: null, waitUntil: null };
  }

  const observedAtMs = Date.parse(pr.configuredBotRateLimitedAt);
  if (Number.isNaN(observedAtMs)) {
    return { active: false, observedAt: pr.configuredBotRateLimitedAt, waitUntil: null };
  }

  const waitUntilMs = observedAtMs + waitMinutes * 60_000;
  return {
    active: Date.now() < waitUntilMs,
    observedAt: pr.configuredBotRateLimitedAt,
    waitUntil: new Date(waitUntilMs).toISOString(),
  };
}

function hasObservedCopilotRequest(
  config: SupervisorConfig,
  record: IssueRunRecord,
  pr: GitHubPullRequest,
): boolean {
  if (!reviewProviderWaitPolicyFromConfig(config).shouldTrackRequestedState) {
    return false;
  }

  return Boolean(record.copilot_review_requested_observed_at && record.copilot_review_requested_head_sha === pr.headRefOid);
}

function copilotReviewPending(config: SupervisorConfig, record: IssueRunRecord, pr: GitHubPullRequest): boolean {
  const policy = reviewProviderWaitPolicyFromConfig(config);
  if (
    !repoExpectsConfiguredBotReview(config) ||
    !policy.shouldWaitForRequestedReviewSignal ||
    pr.isDraft ||
    copilotReviewArrived(pr)
  ) {
    return false;
  }

  if (!policy.shouldApplyRequestedReviewTimeout && pr.configuredBotRateLimitedAt) {
    return false;
  }

  return (pr.copilotReviewState ?? "not_requested") === "requested" || hasObservedCopilotRequest(config, record, pr);
}

function copilotReviewTimeoutStart(config: SupervisorConfig, record: IssueRunRecord, pr: GitHubPullRequest): string | null {
  const policy = reviewProviderWaitPolicyFromConfig(config);
  if (!copilotReviewPending(config, record, pr)) {
    return null;
  }

  if (pr.copilotReviewRequestedAt) {
    return pr.copilotReviewRequestedAt;
  }

  if (policy.shouldTrackRequestedState && hasObservedCopilotRequest(config, record, pr)) {
    return record.copilot_review_requested_observed_at;
  }

  return null;
}

function determineCopilotReviewTimeout(
  config: SupervisorConfig,
  record: IssueRunRecord,
  pr: GitHubPullRequest,
): CopilotReviewTimeoutStatus {
  const policy = reviewProviderWaitPolicyFromConfig(config);
  if (!policy.shouldApplyRequestedReviewTimeout || config.copilotReviewWaitMinutes <= 0) {
    return { timedOut: false, action: null, startedAt: null, timedOutAt: null, reason: null };
  }

  const startedAt = copilotReviewTimeoutStart(config, record, pr);
  if (!startedAt) {
    return { timedOut: false, action: null, startedAt: null, timedOutAt: null, reason: null };
  }

  const startedAtMs = Date.parse(startedAt);
  if (Number.isNaN(startedAtMs)) {
    return { timedOut: false, action: null, startedAt, timedOutAt: null, reason: null };
  }

  const timeoutMs = config.copilotReviewWaitMinutes * 60_000;
  if (Date.now() < startedAtMs + timeoutMs) {
    return { timedOut: false, action: null, startedAt, timedOutAt: null, reason: null };
  }

  const timedOutAt = new Date(startedAtMs + timeoutMs).toISOString();
  return {
    timedOut: true,
    action: config.copilotReviewTimeoutAction,
    startedAt,
    timedOutAt,
    reason:
      `Requested ${configuredReviewBotLabel(config)} review never arrived within ${config.copilotReviewWaitMinutes} minute(s) ` +
      `for head ${pr.headRefOid}.`,
  };
}

function shouldWaitForCopilotReviewPropagation(
  config: SupervisorConfig,
  record: Pick<IssueRunRecord, "review_wait_started_at" | "review_wait_head_sha">,
  pr: GitHubPullRequest,
): boolean {
  const policy = reviewProviderWaitPolicyFromConfig(config);
  if (
    !policy.shouldWaitForRequestPropagation ||
    config.copilotReviewWaitMinutes <= 0 ||
    pr.isDraft ||
    pr.headRefOid !== record.review_wait_head_sha
  ) {
    return false;
  }

  const lifecycleState = pr.copilotReviewState ?? "not_requested";
  if (lifecycleState === "requested" || lifecycleState === "arrived") {
    return false;
  }

  const startedAt = record.review_wait_started_at;
  if (!startedAt) {
    return false;
  }

  const startedAtMs = Date.parse(startedAt);
  if (Number.isNaN(startedAtMs)) {
    return false;
  }

  return Date.now() < startedAtMs + COPILOT_REVIEW_PROPAGATION_GRACE_MS;
}

function shouldWaitForConfiguredBotCurrentHeadQuietPeriod(
  config: SupervisorConfig,
  pr: GitHubPullRequest,
): boolean {
  const policy = reviewProviderWaitPolicyFromConfig(config);
  if (!policy.shouldApplyCurrentHeadQuietPeriod || pr.isDraft || !pr.configuredBotCurrentHeadObservedAt) {
    return false;
  }

  const observedAtMs = Date.parse(pr.configuredBotCurrentHeadObservedAt);
  if (Number.isNaN(observedAtMs)) {
    return false;
  }

  const settledWaitMs = (config.configuredBotSettledWaitSeconds ?? DEFAULT_CONFIGURED_BOT_SETTLED_WAIT_MS / 1_000) * 1_000;
  return Date.now() < observedAtMs + settledWaitMs;
}

function shouldWaitForConfiguredBotInitialGracePeriod(
  config: SupervisorConfig,
  pr: GitHubPullRequest,
): boolean {
  const policy = reviewProviderWaitPolicyFromConfig(config);
  if (
    !policy.shouldApplyCurrentHeadQuietPeriod ||
    pr.isDraft ||
    pr.configuredBotCurrentHeadObservedAt ||
    !pr.currentHeadCiGreenAt
  ) {
    return false;
  }

  const ciGreenAtMs = Date.parse(pr.currentHeadCiGreenAt);
  if (Number.isNaN(ciGreenAtMs)) {
    return false;
  }

  return Date.now() < ciGreenAtMs + configuredBotInitialGraceWaitMs(config);
}

function latestConfiguredBotActionableSignalAt(pr: GitHubPullRequest): string | null {
  const candidates = [
    pr.configuredBotCurrentHeadObservedAt,
    pr.copilotReviewArrivedAt,
    pr.configuredBotTopLevelReviewSubmittedAt,
  ]
    .map((value) => {
      if (typeof value !== "string" || value.length === 0) {
        return null;
      }

      const timestampMs = Date.parse(value);
      if (Number.isNaN(timestampMs)) {
        return null;
      }

      return { value, timestampMs };
    })
    .filter((candidate): candidate is { value: string; timestampMs: number } => candidate !== null);

  if (candidates.length === 0) {
    return null;
  }

  return candidates.reduce((latest, candidate) => (candidate.timestampMs > latest.timestampMs ? candidate : latest)).value;
}

function shouldWaitForConfiguredBotDraftSkipRearm(
  config: SupervisorConfig,
  record: IssueRunRecord,
  pr: GitHubPullRequest,
): boolean {
  const policy = reviewProviderWaitPolicyFromConfig(config);
  if (!policy.shouldApplyCurrentHeadQuietPeriod || pr.isDraft || !pr.configuredBotDraftSkipAt || !record.review_wait_started_at) {
    return false;
  }

  if (record.review_wait_head_sha !== pr.headRefOid) {
    return false;
  }

  const draftSkipAtMs = Date.parse(pr.configuredBotDraftSkipAt);
  const reviewWaitStartedAtMs = Date.parse(record.review_wait_started_at);
  if (Number.isNaN(draftSkipAtMs) || Number.isNaN(reviewWaitStartedAtMs) || reviewWaitStartedAtMs <= draftSkipAtMs) {
    return false;
  }

  const actionableSignalAt = latestConfiguredBotActionableSignalAt(pr);
  if (actionableSignalAt) {
    const actionableSignalAtMs = Date.parse(actionableSignalAt);
    if (!Number.isNaN(actionableSignalAtMs) && actionableSignalAtMs >= reviewWaitStartedAtMs) {
      return false;
    }
  }

  return Date.now() < reviewWaitStartedAtMs + configuredBotInitialGraceWaitMs(config);
}

function shouldWaitForConfiguredBotLatestHeadRearm(
  config: SupervisorConfig,
  record: Pick<IssueRunRecord, "review_wait_started_at" | "review_wait_head_sha">,
  pr: GitHubPullRequest,
): boolean {
  const policy = reviewProviderWaitPolicyFromConfig(config);
  if (!policy.shouldApplyCurrentHeadQuietPeriod || pr.isDraft || !record.review_wait_started_at) {
    return false;
  }

  if (record.review_wait_head_sha !== pr.headRefOid) {
    return false;
  }

  const actionableSignalAt = latestConfiguredBotActionableSignalAt(pr);
  if (!actionableSignalAt) {
    return false;
  }

  const reviewWaitStartedAtMs = Date.parse(record.review_wait_started_at);
  const actionableSignalAtMs = Date.parse(actionableSignalAt);
  if (Number.isNaN(reviewWaitStartedAtMs) || Number.isNaN(actionableSignalAtMs)) {
    return false;
  }

  return (
    actionableSignalAtMs < reviewWaitStartedAtMs &&
    Date.now() < reviewWaitStartedAtMs + configuredBotInitialGraceWaitMs(config)
  );
}

function configuredBotInitialGraceWaitMs(config: SupervisorConfig): number {
  return (config.configuredBotInitialGraceWaitSeconds ?? DEFAULT_CONFIGURED_BOT_INITIAL_GRACE_WAIT_MS / 1_000) * 1_000;
}

export function buildCopilotReviewTimeoutFailureContext(
  config: SupervisorConfig,
  record: IssueRunRecord,
  pr: GitHubPullRequest,
): FailureContext | null {
  const timeout = determineCopilotReviewTimeout(config, record, pr);
  if (!timeout.timedOut || timeout.action !== "block") {
    return null;
  }

  return {
    category: "blocked",
    summary: `PR #${pr.number} is blocked after a requested ${configuredReviewBotLabel(config)} review timed out.`,
    signature: `review-bot-timeout:${pr.headRefOid}:${timeout.action}`,
    command: null,
    details: [
      `requested_at=${timeout.startedAt ?? "none"}`,
      `timed_out_at=${timeout.timedOutAt ?? "none"}`,
      `timeout_minutes=${config.copilotReviewWaitMinutes}`,
      timeout.reason ?? `Requested ${configuredReviewBotLabel(config)} review timed out.`,
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

function hasConfiguredProviderSuccess(
  config: SupervisorConfig,
  pr: GitHubPullRequest,
  reviewThreads: ReviewThread[],
): boolean {
  if (!repoExpectsConfiguredBotReview(config) || !isMergeCriticalPullRequest(pr)) {
    return false;
  }

  if (configuredBotReviewThreads(config, reviewThreads).length > 0) {
    return false;
  }

  if (pr.reviewDecision === "CHANGES_REQUESTED" && pr.configuredBotTopLevelReviewStrength !== "nitpick_only") {
    return false;
  }

  return Boolean(
    pr.configuredBotCurrentHeadObservedAt ||
      pr.copilotReviewArrivedAt ||
      (pr.configuredBotTopLevelReviewStrength === "nitpick_only" && pr.configuredBotTopLevelReviewSubmittedAt),
  );
}

export function syncMergeLatencyVisibility(
  config: SupervisorConfig,
  record: IssueRunRecord,
  pr: GitHubPullRequest,
  reviewThreads: ReviewThread[],
): Pick<
  IssueRunRecord,
  "provider_success_observed_at" | "provider_success_head_sha" | "merge_readiness_last_evaluated_at"
> {
  const observedNow = nowIso();
  const mergeReadinessLastEvaluatedAt = isMergeCriticalPullRequest(pr) ? observedNow : null;

  if (!hasConfiguredProviderSuccess(config, pr, reviewThreads)) {
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
  reviewThreads: ReviewThread[],
): Exclude<BlockedReason, null> | null {
  const manualThreads = manualReviewThreads(config, reviewThreads);
  const unresolvedBotThreads = configuredBotReviewThreads(config, reviewThreads);
  const copilotTimeout = determineCopilotReviewTimeout(config, record, pr);
  if (copilotTimeout.timedOut && copilotTimeout.action === "block") {
    return "review_bot_timeout";
  }

  if (manualThreads.length > 0 || unresolvedBotThreads.length > 0) {
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

  if (localReviewHighSeverityNeedsBlock(config, record, pr) || localReviewBlocksMerge(config, record, pr)) {
    return "verification";
  }

  return null;
}

export function syncReviewWaitWindow(record: IssueRunRecord, pr: GitHubPullRequest): Partial<IssueRunRecord> {
  if (pr.isDraft) {
    return {
      review_wait_started_at: null,
      review_wait_head_sha: null,
    };
  }

  if (!record.review_wait_started_at || record.review_wait_head_sha !== pr.headRefOid) {
    return {
      review_wait_started_at: nowIso(),
      review_wait_head_sha: pr.headRefOid,
    };
  }

  return {
    review_wait_started_at: record.review_wait_started_at,
    review_wait_head_sha: record.review_wait_head_sha,
  };
}

export function syncCopilotReviewRequestObservation(
  config: SupervisorConfig,
  record: IssueRunRecord,
  pr: GitHubPullRequest,
): Partial<IssueRunRecord> {
  if (!reviewProviderWaitPolicyFromConfig(config).shouldTrackRequestedState || pr.isDraft || copilotReviewArrived(pr)) {
    return {
      copilot_review_requested_observed_at: null,
      copilot_review_requested_head_sha: null,
    };
  }

  if (pr.copilotReviewRequestedAt) {
    return {
      copilot_review_requested_observed_at: pr.copilotReviewRequestedAt,
      copilot_review_requested_head_sha: pr.headRefOid,
    };
  }

  if (
    record.copilot_review_requested_observed_at &&
    record.copilot_review_requested_head_sha === pr.headRefOid
  ) {
    return {
      copilot_review_requested_observed_at: record.copilot_review_requested_observed_at,
      copilot_review_requested_head_sha: record.copilot_review_requested_head_sha,
    };
  }

  if ((pr.copilotReviewState ?? "not_requested") === "requested") {
    return {
      copilot_review_requested_observed_at: nowIso(),
      copilot_review_requested_head_sha: pr.headRefOid,
    };
  }

  return {
    copilot_review_requested_observed_at: null,
    copilot_review_requested_head_sha: null,
  };
}

export function syncCopilotReviewTimeoutState(
  config: SupervisorConfig,
  record: IssueRunRecord,
  pr: GitHubPullRequest,
): Pick<
  IssueRunRecord,
  | "copilot_review_timed_out_at"
  | "copilot_review_timeout_action"
  | "copilot_review_timeout_reason"
> {
  const timeout = determineCopilotReviewTimeout(config, record, pr);
  if (!timeout.timedOut || !timeout.action) {
    return {
      copilot_review_timed_out_at: null,
      copilot_review_timeout_action: null,
      copilot_review_timeout_reason: null,
    };
  }

  return {
    copilot_review_timed_out_at: timeout.timedOutAt,
    copilot_review_timeout_action: timeout.action,
    copilot_review_timeout_reason: timeout.reason,
  };
}

export function inferStateFromPullRequest(
  config: SupervisorConfig,
  record: IssueRunRecord,
  pr: GitHubPullRequest,
  checks: PullRequestCheck[],
  reviewThreads: ReviewThread[],
): RunState {
  const manualThreads = manualReviewThreads(config, reviewThreads);
  const unresolvedBotThreads = configuredBotReviewThreads(config, reviewThreads);
  const pendingBotThreads = pendingBotReviewThreads(config, record, pr, reviewThreads);
  const botFollowUpState = configuredBotReviewFollowUpState(record, pr, unresolvedBotThreads);

  if (pr.mergedAt || pr.state === "MERGED") {
    return "done";
  }

  if (pr.reviewDecision === "CHANGES_REQUESTED") {
    if (pendingBotThreads.length > 0 || (botFollowUpState === "eligible" && manualThreads.length === 0)) {
      return "addressing_review";
    }

    const nitpickOnlyConfiguredBotReview =
      pr.configuredBotTopLevelReviewStrength === "nitpick_only" &&
      unresolvedBotThreads.length === 0 &&
      manualThreads.length === 0;

    if (unresolvedBotThreads.length > 0 || pr.configuredBotTopLevelReviewStrength === "blocking") {
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

  if (localReviewHighSeverityNeedsBlock(config, record, pr)) {
    return "blocked";
  }

  const checkSummary = summarizeChecks(checks);
  if (checkSummary.hasFailing) {
    return "repairing_ci";
  }

  if (pendingBotThreads.length > 0 || (botFollowUpState === "eligible" && manualThreads.length === 0)) {
    return "addressing_review";
  }

  if (unresolvedBotThreads.length > 0) {
    return "blocked";
  }

  if (config.humanReviewBlocksMerge && manualThreads.length > 0) {
    return "blocked";
  }

  if (localReviewRequiresManualReview(config, record, pr)) {
    return "blocked";
  }

  if (localReviewBlocksMerge(config, record, pr)) {
    return "blocked";
  }

  if (mergeConflictDetected(pr)) {
    return "resolving_conflict";
  }

  if (pr.isDraft) {
    return "draft_pr";
  }

  const configuredBotRateLimitWait = determineConfiguredBotRateLimitWait(config, pr);
  if (configuredBotRateLimitWait.active) {
    return "waiting_ci";
  }

  const copilotTimeout = determineCopilotReviewTimeout(config, record, pr);
  if (copilotTimeout.timedOut && copilotTimeout.action === "block") {
    return "blocked";
  }

  if (shouldWaitForConfiguredBotLatestHeadRearm(config, record, pr)) {
    return "waiting_ci";
  }

  if (shouldWaitForConfiguredBotDraftSkipRearm(config, record, pr)) {
    return "waiting_ci";
  }

  if (shouldWaitForConfiguredBotInitialGracePeriod(config, pr)) {
    return "waiting_ci";
  }

  if (shouldWaitForConfiguredBotCurrentHeadQuietPeriod(config, pr)) {
    return "waiting_ci";
  }

  if (shouldWaitForCopilotReviewPropagation(config, record, pr)) {
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
): GitHubWaitStep | null {
  const configuredBotRateLimitWait = determineConfiguredBotRateLimitWait(config, pr);
  if (configuredBotRateLimitWait.active) {
    return "configured_bot_rate_limit_wait";
  }

  if (shouldWaitForConfiguredBotLatestHeadRearm(config, record, pr)) {
    return "configured_bot_initial_grace_wait";
  }

  if (shouldWaitForConfiguredBotDraftSkipRearm(config, record, pr)) {
    return "configured_bot_initial_grace_wait";
  }

  if (shouldWaitForConfiguredBotInitialGracePeriod(config, pr)) {
    return "configured_bot_initial_grace_wait";
  }

  if (shouldWaitForConfiguredBotCurrentHeadQuietPeriod(config, pr)) {
    return "configured_bot_settled_wait";
  }

  if (shouldWaitForCopilotReviewPropagation(config, record, pr)) {
    return "copilot_review_propagation_wait";
  }

  const copilotTimeout = determineCopilotReviewTimeout(config, record, pr);
  if (copilotReviewPending(config, record, pr) && !copilotTimeout.timedOut) {
    return "copilot_review_requested_wait";
  }

  if (summarizeChecks(checks).hasPending) {
    return "checks_pending";
  }

  return null;
}
