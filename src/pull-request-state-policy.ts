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
  hasProcessedReviewThread,
} from "./review-handling";
import { shouldRunLocalReview } from "./local-review";
import {
  mergeConflictDetected,
  summarizeChecks,
} from "./supervisor/supervisor-reporting";
import {
  codexConnectorNitpickOnlyReviewThreads,
  codexConnectorMustFixReviewThreads,
  evaluateCodexConnectorConvergencePolicy,
} from "./codex-connector-review-policy";
import { codexConnectorCurrentHeadReviewReadiness } from "./codex-connector-review-request-decision";
import {
  configuredBotReviewFollowUpState,
  configuredBotReviewThreads,
  latestReviewCommentAuthorIsAllowedBot,
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
  configuredReviewProviderKinds,
  repoExpectsConfiguredBotReview,
  reviewProviderWaitPolicyFromConfig,
} from "./core/review-providers";
import { displayLocalCiCommand } from "./core/config-parsing";
import { nowIso } from "./core/utils";
import { hasQueuedReadyPromotionPathHygieneRepair } from "./ready-promotion-path-hygiene-repair";
import {
  buildStaleReviewBotRemediation,
  isProvenStaleReviewMetadataClassification,
} from "./supervisor/stale-review-bot-remediation";

const COPILOT_REVIEW_PROPAGATION_GRACE_MS = 5_000;
const DEFAULT_CONFIGURED_BOT_SETTLED_WAIT_MS = 5_000;
const DEFAULT_CONFIGURED_BOT_INITIAL_GRACE_WAIT_MS = 90_000;

interface CopilotReviewTimeoutStatus {
  timedOut: boolean;
  action: SupervisorConfig["copilotReviewTimeoutAction"] | null;
  startedAt: string | null;
  timedOutAt: string | null;
  reason: string | null;
  timeoutMinutes: number | null;
  kind: "requested_review" | "current_head_signal" | null;
}

interface ConfiguredBotRateLimitWaitStatus {
  active: boolean;
  observedAt: string | null;
  waitUntil: string | null;
}

export type GitHubWaitStep =
  | "configured_bot_rate_limit_wait"
  | "configured_bot_initial_grace_wait"
  | "configured_bot_current_head_signal_wait"
  | "configured_bot_settled_wait"
  | "copilot_review_propagation_wait"
  | "copilot_review_requested_wait"
  | "checks_pending";

function pullRequestStateInferenceNowMs(nowMs?: number): number {
  return nowMs ?? Date.now.call(Date);
}

function reviewSatisfied(pr: GitHubPullRequest): boolean {
  return (
    (pr.reviewDecision !== "CHANGES_REQUESTED" || pr.configuredBotTopLevelReviewStrength === "nitpick_only") &&
    pr.reviewDecision !== "REVIEW_REQUIRED"
  );
}

function configuredReviewBotLabel(config: SupervisorConfig): string {
  return reviewProviderWaitPolicyFromConfig(config).botLabel;
}

export function copilotReviewArrived(pr: GitHubPullRequest): boolean {
  return (pr.copilotReviewState ?? "not_requested") === "arrived" || Boolean(pr.copilotReviewArrivedAt);
}

function determineConfiguredBotRateLimitWait(
  config: SupervisorConfig,
  pr: GitHubPullRequest,
  nowMs: number,
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
    active: nowMs < waitUntilMs,
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

export function determineCopilotReviewTimeout(
  config: SupervisorConfig,
  record: IssueRunRecord,
  pr: GitHubPullRequest,
  nowMs = pullRequestStateInferenceNowMs(),
): CopilotReviewTimeoutStatus {
  const policy = reviewProviderWaitPolicyFromConfig(config);
  const empty: CopilotReviewTimeoutStatus = {
    timedOut: false,
    action: null,
    startedAt: null,
    timedOutAt: null,
    reason: null,
    timeoutMinutes: null,
    kind: null,
  };
  const reviewRequestTimeoutEnabled = policy.shouldApplyRequestedReviewTimeout && config.copilotReviewWaitMinutes > 0;
  const requestedReviewStartedAt = reviewRequestTimeoutEnabled ? copilotReviewTimeoutStart(config, record, pr) : null;
  const requestedReviewTimeout: CopilotReviewTimeoutStatus = requestedReviewStartedAt
    ? (() => {
        const requestedAtMs = Date.parse(requestedReviewStartedAt);
        if (!Number.isNaN(requestedAtMs)) {
          const timeoutMs = config.copilotReviewWaitMinutes * 60_000;
          if (nowMs >= requestedAtMs + timeoutMs) {
            return {
              timedOut: true,
              action: config.copilotReviewTimeoutAction,
              startedAt: requestedReviewStartedAt,
              timedOutAt: new Date(requestedAtMs + timeoutMs).toISOString(),
              reason:
                `Requested ${configuredReviewBotLabel(config)} review never arrived within ${config.copilotReviewWaitMinutes} minute(s) ` +
                `for head ${pr.headRefOid}.`,
              timeoutMinutes: config.copilotReviewWaitMinutes,
              kind: "requested_review",
            };
          }
        }

        return {
          timedOut: false,
          action: null,
          startedAt: requestedReviewStartedAt,
          timedOutAt: null,
          reason: null,
          timeoutMinutes: config.copilotReviewWaitMinutes,
          kind: "requested_review",
        };
      })()
    : empty;

  const configuredBotTimeoutEnabled =
    requiresConfiguredBotCurrentHeadSignal(config) && (config.configuredBotCurrentHeadSignalTimeoutMinutes ?? 0) > 0;
  const currentHeadSignalStartedAt = configuredBotTimeoutEnabled
    ? configuredBotCurrentHeadSignalTimeoutStartAt(config, record, pr)
    : null;
  const currentHeadSignalTimeout: CopilotReviewTimeoutStatus = currentHeadSignalStartedAt
    ? (() => {
        const startedAtMs = Date.parse(currentHeadSignalStartedAt);
        if (Number.isNaN(startedAtMs)) {
          return {
            timedOut: false,
            action: null,
            startedAt: currentHeadSignalStartedAt,
            timedOutAt: null,
            reason: null,
            timeoutMinutes: config.configuredBotCurrentHeadSignalTimeoutMinutes ?? null,
            kind: "current_head_signal",
          };
        }

        const timeoutMs = (config.configuredBotCurrentHeadSignalTimeoutMinutes ?? 0) * 60_000;
        if (nowMs < startedAtMs + timeoutMs) {
          return {
            timedOut: false,
            action: null,
            startedAt: currentHeadSignalStartedAt,
            timedOutAt: null,
            reason: null,
            timeoutMinutes: config.configuredBotCurrentHeadSignalTimeoutMinutes ?? null,
            kind: "current_head_signal",
          };
        }

        const timedOutAt = new Date(startedAtMs + timeoutMs).toISOString();
        return {
          timedOut: true,
          action: config.configuredBotCurrentHeadSignalTimeoutAction ?? "block",
          startedAt: currentHeadSignalStartedAt,
          timedOutAt,
          reason:
            `${configuredReviewBotLabel(config)} never produced a current-head review signal within ` +
            `${config.configuredBotCurrentHeadSignalTimeoutMinutes} minute(s) for head ${pr.headRefOid}.`,
          timeoutMinutes: config.configuredBotCurrentHeadSignalTimeoutMinutes ?? null,
          kind: "current_head_signal",
        };
      })()
    : empty;

  if (currentHeadSignalTimeout.kind !== null) {
    return currentHeadSignalTimeout;
  }

  return requestedReviewTimeout;
}

function shouldWaitForCopilotReviewPropagation(
  config: SupervisorConfig,
  record: Pick<IssueRunRecord, "review_wait_started_at" | "review_wait_head_sha">,
  pr: GitHubPullRequest,
  nowMs: number,
): boolean {
  const policy = reviewProviderWaitPolicyFromConfig(config);
  if (
    !policy.shouldWaitForRequestPropagation ||
    config.copilotReviewWaitMinutes <= 0 ||
    pr.isDraft ||
    pr.configuredBotCurrentHeadObservedAt ||
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

  return nowMs < startedAtMs + COPILOT_REVIEW_PROPAGATION_GRACE_MS;
}

function shouldWaitForConfiguredBotCurrentHeadQuietPeriod(
  config: SupervisorConfig,
  pr: GitHubPullRequest,
  nowMs: number,
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
  return nowMs < observedAtMs + settledWaitMs;
}

function validTimestamp(value: string | null | undefined): string | null {
  if (typeof value !== "string" || value.length === 0) {
    return null;
  }

  return Number.isNaN(Date.parse(value)) ? null : value;
}

function currentHeadObservationSatisfiesActiveWait(
  record: Pick<IssueRunRecord, "review_wait_started_at" | "review_wait_head_sha">,
  pr: GitHubPullRequest,
): boolean {
  if (pr.configuredBotCurrentHeadObservationSource !== "codex_pr_success_comment") {
    return true;
  }

  const observedAt = validTimestamp(pr.configuredBotCurrentHeadObservedAt);
  const waitStartedAt = validTimestamp(record.review_wait_started_at);
  if (!observedAt) {
    return false;
  }

  if (!waitStartedAt || record.review_wait_head_sha !== pr.headRefOid) {
    return true;
  }

  return Date.parse(observedAt) >= Date.parse(waitStartedAt);
}

function shouldWaitForConfiguredBotInitialGracePeriod(
  config: SupervisorConfig,
  pr: GitHubPullRequest,
  nowMs: number,
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

  return nowMs < ciGreenAtMs + configuredBotInitialGraceWaitMs(config);
}

function requiresConfiguredBotCurrentHeadSignal(config: SupervisorConfig): boolean {
  const policy = reviewProviderWaitPolicyFromConfig(config);
  return (
    policy.shouldApplyCurrentHeadQuietPeriod &&
    (config.configuredBotRequireCurrentHeadSignal === true || configuredReviewProviderKinds(config).includes("codex"))
  );
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
  nowMs: number,
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

  return nowMs < reviewWaitStartedAtMs + configuredBotInitialGraceWaitMs(config);
}

function configuredBotDraftSkipRearmStartedAt(
  config: SupervisorConfig,
  record: IssueRunRecord,
  pr: GitHubPullRequest,
): string | null {
  const policy = reviewProviderWaitPolicyFromConfig(config);
  if (!policy.shouldApplyCurrentHeadQuietPeriod || pr.isDraft || !pr.configuredBotDraftSkipAt || !record.review_wait_started_at) {
    return null;
  }

  if (record.review_wait_head_sha !== pr.headRefOid) {
    return null;
  }

  const draftSkipAtMs = Date.parse(pr.configuredBotDraftSkipAt);
  const reviewWaitStartedAtMs = Date.parse(record.review_wait_started_at);
  if (Number.isNaN(draftSkipAtMs) || Number.isNaN(reviewWaitStartedAtMs) || reviewWaitStartedAtMs <= draftSkipAtMs) {
    return null;
  }

  const actionableSignalAt = latestConfiguredBotActionableSignalAt(pr);
  if (actionableSignalAt) {
    const actionableSignalAtMs = Date.parse(actionableSignalAt);
    if (!Number.isNaN(actionableSignalAtMs) && actionableSignalAtMs >= reviewWaitStartedAtMs) {
      return null;
    }
  }

  return record.review_wait_started_at;
}

function shouldWaitForConfiguredBotLatestHeadRearm(
  config: SupervisorConfig,
  record: Pick<IssueRunRecord, "review_wait_started_at" | "review_wait_head_sha">,
  pr: GitHubPullRequest,
  nowMs: number,
): boolean {
  const startedAt = configuredBotLatestHeadRearmStartedAt(config, record, pr);
  if (!startedAt) {
    return false;
  }

  const startedAtMs = Date.parse(startedAt);
  if (Number.isNaN(startedAtMs)) {
    return false;
  }

  return nowMs < startedAtMs + configuredBotInitialGraceWaitMs(config);
}

function configuredBotLatestHeadRearmStartedAt(
  config: SupervisorConfig,
  record: Pick<IssueRunRecord, "review_wait_started_at" | "review_wait_head_sha">,
  pr: GitHubPullRequest,
): string | null {
  const policy = reviewProviderWaitPolicyFromConfig(config);
  if (!policy.shouldApplyCurrentHeadQuietPeriod || pr.isDraft || !record.review_wait_started_at) {
    return null;
  }

  if (record.review_wait_head_sha !== pr.headRefOid) {
    return null;
  }

  const reviewWaitStartedAtMs = Date.parse(record.review_wait_started_at);
  if (Number.isNaN(reviewWaitStartedAtMs)) {
    return null;
  }

  const actionableSignalAt = latestConfiguredBotActionableSignalAt(pr);
  if (!actionableSignalAt) {
    return record.review_wait_started_at;
  }

  const actionableSignalAtMs = Date.parse(actionableSignalAt);
  if (Number.isNaN(actionableSignalAtMs)) {
    return null;
  }

  return actionableSignalAtMs < reviewWaitStartedAtMs ? record.review_wait_started_at : null;
}

function configuredBotInitialGraceWaitMs(config: SupervisorConfig): number {
  return (config.configuredBotInitialGraceWaitSeconds ?? DEFAULT_CONFIGURED_BOT_INITIAL_GRACE_WAIT_MS / 1_000) * 1_000;
}

function configuredBotCurrentHeadSignalWaitStartAt(
  config: SupervisorConfig,
  record: IssueRunRecord,
  pr: GitHubPullRequest,
): string | null {
  if (
    !requiresConfiguredBotCurrentHeadSignal(config) ||
    pr.isDraft ||
    (validTimestamp(pr.configuredBotCurrentHeadObservedAt) && currentHeadObservationSatisfiesActiveWait(record, pr))
  ) {
    return null;
  }

  const currentHeadCiGreenAt = validTimestamp(pr.currentHeadCiGreenAt);
  const codexConnectorRequiresSignal = configuredReviewProviderKinds(config).includes("codex");
  const fallbackWaitStartedAt =
    codexConnectorRequiresSignal && record.review_wait_head_sha === pr.headRefOid
      ? validTimestamp(record.review_wait_started_at)
      : codexConnectorRequiresSignal
        ? validTimestamp(pr.createdAt)
        : null;
  const waitAnchor = currentHeadCiGreenAt ?? fallbackWaitStartedAt;
  if (!waitAnchor) {
    return null;
  }

  const waitAnchorMs = Date.parse(waitAnchor);
  if (Number.isNaN(waitAnchorMs)) {
    return null;
  }

  const clampWaitStartAt = (startedAt: string | null): string | null => {
    if (!startedAt) {
      return null;
    }

    const startedAtMs = Date.parse(startedAt);
    if (Number.isNaN(startedAtMs)) {
      return null;
    }

    return startedAtMs < waitAnchorMs ? waitAnchor : startedAt;
  };

  const draftSkipStartedAt = configuredBotDraftSkipRearmStartedAt(config, record, pr);
  const clampedDraftSkipStartedAt = clampWaitStartAt(draftSkipStartedAt);
  if (clampedDraftSkipStartedAt) {
    return clampedDraftSkipStartedAt;
  }

  const latestHeadRearmStartedAt = configuredBotLatestHeadRearmStartedAt(config, record, pr);
  const clampedLatestHeadRearmStartedAt = clampWaitStartAt(latestHeadRearmStartedAt);
  if (clampedLatestHeadRearmStartedAt) {
    return clampedLatestHeadRearmStartedAt;
  }

  return waitAnchor;
}

function configuredBotCurrentHeadSignalTimeoutStartAt(
  config: SupervisorConfig,
  record: IssueRunRecord,
  pr: GitHubPullRequest,
): string | null {
  const waitStartedAt = configuredBotCurrentHeadSignalWaitStartAt(config, record, pr);
  if (!waitStartedAt) {
    return null;
  }

  const waitStartedAtMs = Date.parse(waitStartedAt);
  if (Number.isNaN(waitStartedAtMs)) {
    return null;
  }

  return new Date(waitStartedAtMs + configuredBotInitialGraceWaitMs(config)).toISOString();
}

function configuredBotCurrentHeadSignalPending(
  config: SupervisorConfig,
  record: IssueRunRecord,
  pr: GitHubPullRequest,
): boolean {
  if (!requiresConfiguredBotCurrentHeadSignal(config)) {
    return false;
  }

  return configuredBotCurrentHeadSignalWaitStartAt(config, record, pr) !== null;
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

function isIssueJournalThreadPath(thread: Pick<ReviewThread, "path">): boolean {
  const normalizedPath = thread.path?.replace(/\\/g, "/") ?? "";
  return /^\.codex-supervisor\/.+\/issue-journal\.md$/.test(normalizedPath);
}

function allowJournalOnlyConfiguredBotThreadException(
  config: SupervisorConfig,
  pr: GitHubPullRequest,
  checks: PullRequestCheck[],
  reviewThreads: ReviewThread[],
): boolean {
  if (!reviewProviderWaitPolicyFromConfig(config).shouldApplyCurrentHeadQuietPeriod) {
    return false;
  }

  if (
    pr.state !== "OPEN" ||
    pr.isDraft ||
    pr.mergedAt ||
    pr.mergeStateStatus !== "CLEAN" ||
    pr.mergeable !== "MERGEABLE" ||
    pr.configuredBotCurrentHeadStatusState !== "SUCCESS" ||
    pr.configuredBotTopLevelReviewStrength === "blocking"
  ) {
    return false;
  }

  const checkSummary = summarizeChecks(checks);
  if (!checkSummary.allPassing) {
    return false;
  }

  const unresolvedConfiguredBotThreads = configuredBotReviewThreads(config, reviewThreads);
  return unresolvedConfiguredBotThreads.length > 0 && unresolvedConfiguredBotThreads.every(isIssueJournalThreadPath);
}

function effectiveConfiguredBotReviewThreads(
  config: SupervisorConfig,
  record: IssueRunRecord,
  pr: GitHubPullRequest,
  checks: PullRequestCheck[],
  reviewThreads: ReviewThread[],
): ReviewThread[] {
  const unresolvedConfiguredBotThreads = configuredBotReviewThreads(config, reviewThreads);
  const codexConnectorPolicy = evaluateCodexConnectorConvergencePolicy(config, pr, unresolvedConfiguredBotThreads);
  const codexConnectorNitpickThreads = new Set(codexConnectorNitpickOnlyReviewThreads(unresolvedConfiguredBotThreads));
  const clearOutdatedCodexConnectorThreads = codexConnectorOutdatedThreadClearanceAllowed(
    config,
    record,
    pr,
    checks,
    reviewThreads,
  );
  const effectiveThreads =
    codexConnectorPolicy?.outcome === "nitpick_only" || codexConnectorPolicy?.outcome === "converged"
      ? unresolvedConfiguredBotThreads.filter((thread) => !codexConnectorNitpickThreads.has(thread))
      : unresolvedConfiguredBotThreads;
  const threadsAfterOutdatedClearance = clearOutdatedCodexConnectorThreads
    ? effectiveThreads.filter(
        (thread) => !thread.isOutdated || !latestReviewCommentAuthorIsAllowedBot(config, thread),
      )
    : effectiveThreads;
  return allowJournalOnlyConfiguredBotThreadException(config, pr, checks, threadsAfterOutdatedClearance)
    ? threadsAfterOutdatedClearance.filter((thread) => !isIssueJournalThreadPath(thread))
    : threadsAfterOutdatedClearance;
}

export function effectiveConfiguredBotReviewThreadsForState(
  config: SupervisorConfig,
  record: IssueRunRecord,
  pr: GitHubPullRequest,
  checks: PullRequestCheck[],
  reviewThreads: ReviewThread[],
): ReviewThread[] {
  return hasProvenCodexConnectorStaleReviewMetadata({
    config,
    record,
    pr,
    checks,
    reviewThreads,
  })
    ? []
    : effectiveConfiguredBotReviewThreads(config, record, pr, checks, reviewThreads);
}

function codexConnectorOutdatedThreadClearanceAllowed(
  config: SupervisorConfig,
  record: IssueRunRecord,
  pr: GitHubPullRequest,
  checks: PullRequestCheck[],
  reviewThreads: ReviewThread[],
): boolean {
  return Boolean(
    configuredReviewProviderKinds(config).includes("codex") &&
      pr.configuredBotCurrentHeadObservationSource === "codex_pr_success_comment" &&
      pr.configuredBotCurrentHeadStatusState === "SUCCESS" &&
      pr.configuredBotTopLevelReviewStrength !== "blocking" &&
      validTimestamp(pr.configuredBotCurrentHeadObservedAt) &&
      (currentHeadObservationSatisfiesActiveWait(record, pr) ||
        staleSameHeadCodexWaitHasOnlyOutdatedResidue(config, record, pr, checks, reviewThreads)) &&
      summarizeChecks(checks).allPassing,
  );
}

function staleSameHeadCodexWaitHasOnlyOutdatedResidue(
  config: SupervisorConfig,
  record: IssueRunRecord,
  pr: GitHubPullRequest,
  checks: PullRequestCheck[],
  reviewThreads: ReviewThread[],
): boolean {
  if (
    !configuredReviewProviderKinds(config).includes("codex") ||
    pr.configuredBotCurrentHeadObservationSource !== "codex_pr_success_comment" ||
    pr.configuredBotCurrentHeadStatusState !== "SUCCESS" ||
    pr.configuredBotTopLevelReviewStrength === "blocking"
  ) {
    return false;
  }

  const observedAt = validTimestamp(pr.configuredBotCurrentHeadObservedAt);
  const waitStartedAt = validTimestamp(record.review_wait_started_at);
  if (!observedAt || !waitStartedAt || record.review_wait_head_sha !== pr.headRefOid) {
    return false;
  }

  if (Date.parse(observedAt) >= Date.parse(waitStartedAt)) {
    return false;
  }

  if (!pullRequestHeadMatchesRecord(record, pr) || mergeConflictDetected(pr) || !summarizeChecks(checks).allPassing) {
    return false;
  }

  if (manualReviewThreads(config, reviewThreads).length > 0) {
    return false;
  }

  const configuredThreads = configuredBotReviewThreads(config, reviewThreads);
  return (
    configuredThreads.length > 0 &&
    configuredThreads.every((thread) => thread.isOutdated && latestReviewCommentAuthorIsAllowedBot(config, thread))
  );
}

function hasProvenCodexConnectorStaleReviewMetadata(args: {
  config: SupervisorConfig;
  record: IssueRunRecord;
  pr: GitHubPullRequest;
  checks: PullRequestCheck[];
  reviewThreads: ReviewThread[];
}): boolean {
  const remediation = buildStaleReviewBotRemediation({
    config: args.config,
    record: args.record,
    pr: args.pr,
    checks: args.checks,
    reviewThreads: args.reviewThreads,
  });
  return remediation ? isProvenStaleReviewMetadataClassification(remediation.classification) : false;
}

function configuredBotThreadsAllowCodexConnectorCurrentHeadWait(args: {
  config: SupervisorConfig;
  record: IssueRunRecord;
  pr: GitHubPullRequest;
  configuredThreads: ReviewThread[];
}): boolean {
  if (codexConnectorMustFixReviewThreads(args.configuredThreads).length > 0) {
    return false;
  }

  if (configuredBotReviewFollowUpState(args.config, args.record, args.pr, args.configuredThreads) === "eligible") {
    return false;
  }

  return args.configuredThreads.every(
    (thread) =>
      hasProcessedReviewThread(args.record, args.pr, thread) ||
      !latestReviewCommentAuthorIsAllowedBot(args.config, thread),
  );
}

function shouldWaitForCodexConnectorCurrentHeadReview(args: {
  config: SupervisorConfig;
  record: IssueRunRecord;
  pr: GitHubPullRequest;
  checks: PullRequestCheck[];
  reviewThreads: ReviewThread[];
  manualThreads: ReviewThread[];
  unresolvedBotThreads: ReviewThread[];
  nowMs: number;
}): boolean {
  if (
    !configuredReviewProviderKinds(args.config).includes("codex") ||
    args.pr.isDraft ||
    mergeConflictDetected(args.pr) ||
    args.manualThreads.length > 0 ||
    validTimestamp(args.pr.configuredBotCurrentHeadObservedAt)
  ) {
    return false;
  }

  const configuredThreadsAreSafe = configuredBotThreadsAllowCodexConnectorCurrentHeadWait({
      config: args.config,
      record: args.record,
      pr: args.pr,
      configuredThreads: args.unresolvedBotThreads,
  });
  if (
    codexConnectorCurrentHeadReviewReadiness({
      config: args.config,
      pr: args.pr,
      checks: args.checks,
      manualThreadCount: args.manualThreads.length,
      configuredThreadsAreSafe,
      checkSummary: summarizeChecks(args.checks),
      mergeConflict: mergeConflictDetected(args.pr),
    }).kind !== "eligible"
  ) {
    return false;
  }

  const timeout = determineCopilotReviewTimeout(args.config, args.record, args.pr, args.nowMs);
  return (
    (configuredBotCurrentHeadSignalPending(args.config, args.record, args.pr) && !timeout.timedOut) ||
    (timeout.timedOut && timeout.action === "request_review_comment")
  );
}

// Blocks already-processed Codex Connector must-fix threads once the tracked PR
// repeat budget has made a no-progress stop decision.
function processedCodexConnectorMustFixThreadsExhaustedRepeatBudget(args: {
  config: SupervisorConfig;
  record: IssueRunRecord;
  pr: GitHubPullRequest;
  checks: PullRequestCheck[];
  manualThreads: ReviewThread[];
  codexConnectorMustFixThreads: ReviewThread[];
}): boolean {
  if (
    !configuredReviewProviderKinds(args.config).includes("codex") ||
    args.codexConnectorMustFixThreads.length === 0 ||
    args.manualThreads.length > 0 ||
    args.record.last_tracked_pr_repeat_failure_decision !== "stop_no_progress"
  ) {
    return false;
  }

  const checkSummary = summarizeChecks(args.checks);
  if (checkSummary.hasFailing || checkSummary.hasPending || mergeConflictDetected(args.pr)) {
    return false;
  }

  return args.codexConnectorMustFixThreads.every((thread) =>
    hasProcessedReviewThread(args.record, args.pr, thread),
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
  record: IssueRunRecord,
  pr: GitHubPullRequest,
  checks: PullRequestCheck[],
  reviewThreads: ReviewThread[],
): boolean {
  if (!repoExpectsConfiguredBotReview(config) || !isMergeCriticalPullRequest(pr)) {
    return false;
  }

  const codexConnectorPolicy = evaluateCodexConnectorConvergencePolicy(config, pr, reviewThreads);
  if (codexConnectorPolicy?.outcome === "must_fix_remaining" || codexConnectorPolicy?.outcome === "missing_current_head_review") {
    return false;
  }

  const clearOutdatedCodexConnectorThreads = codexConnectorOutdatedThreadClearanceAllowed(
    config,
    record,
    pr,
    checks,
    reviewThreads,
  );
  const configuredBotThreads = configuredBotReviewThreads(config, reviewThreads).filter(
    (thread) =>
      !clearOutdatedCodexConnectorThreads ||
      !thread.isOutdated ||
      !latestReviewCommentAuthorIsAllowedBot(config, thread),
  );
  const codexConnectorNitpickThreads = new Set(codexConnectorNitpickOnlyReviewThreads(configuredBotThreads));
  if (configuredBotThreads.filter((thread) => !codexConnectorNitpickThreads.has(thread)).length > 0) {
    return false;
  }

  if (pr.reviewDecision === "CHANGES_REQUESTED" && pr.configuredBotTopLevelReviewStrength !== "nitpick_only") {
    return false;
  }

  return Boolean(
    validTimestamp(pr.configuredBotCurrentHeadObservedAt) ||
      validTimestamp(pr.copilotReviewArrivedAt) ||
      (pr.configuredBotTopLevelReviewStrength === "nitpick_only" && validTimestamp(pr.configuredBotTopLevelReviewSubmittedAt)),
  );
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
  const pendingBotThreads = pendingBotReviewThreads(config, record, pr, unresolvedBotThreads);
  const botFollowUpState = configuredBotReviewFollowUpState(config, record, pr, unresolvedBotThreads);
  const codexConnectorMustFixThreads = codexConnectorMustFixReviewThreads(unresolvedBotThreads);
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

    if (pendingBotThreads.length > 0 || (botFollowUpState === "eligible" && manualThreads.length === 0)) {
      return "addressing_review";
    }

    const nitpickOnlyConfiguredBotReview =
      pr.configuredBotTopLevelReviewStrength === "nitpick_only" &&
      unresolvedBotThreads.length === 0 &&
      manualThreads.length === 0;

    if (unresolvedBotThreads.length > 0 || pr.configuredBotTopLevelReviewStrength === "blocking") {
      if (
        codexConnectorMustFixThreads.length > 0 &&
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
    !checkSummary.hasFailing &&
    !checkSummary.hasPending &&
    (!config.humanReviewBlocksMerge || manualThreads.length === 0) &&
    !mergeConflictDetected(pr)
  ) {
    return "addressing_review";
  }

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
  nowMs = pullRequestStateInferenceNowMs(),
): GitHubWaitStep | null {
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
  if (configuredBotCurrentHeadSignalPending(config, record, pr) && !copilotTimeout.timedOut) {
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
