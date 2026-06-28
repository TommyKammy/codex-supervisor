import {
  GitHubPullRequest,
  IssueRunRecord,
  SupervisorConfig,
} from "./core/types";
import {
  configuredReviewProviderKinds,
  repoExpectsConfiguredBotReview,
  reviewProviderWaitPolicyFromConfig,
} from "./core/review-providers";

const COPILOT_REVIEW_PROPAGATION_GRACE_MS = 5_000;
const DEFAULT_CONFIGURED_BOT_SETTLED_WAIT_MS = 5_000;
const DEFAULT_CONFIGURED_BOT_INITIAL_GRACE_WAIT_MS = 90_000;

export interface CopilotReviewTimeoutStatus {
  timedOut: boolean;
  action: SupervisorConfig["copilotReviewTimeoutAction"] | null;
  startedAt: string | null;
  timedOutAt: string | null;
  reason: string | null;
  timeoutMinutes: number | null;
  kind: "requested_review" | "current_head_signal" | null;
}

export interface ConfiguredBotRateLimitWaitStatus {
  active: boolean;
  observedAt: string | null;
  waitUntil: string | null;
}

export function configuredReviewBotLabel(config: SupervisorConfig): string {
  return reviewProviderWaitPolicyFromConfig(config).botLabel;
}

export function copilotReviewArrived(pr: GitHubPullRequest): boolean {
  return (pr.copilotReviewState ?? "not_requested") === "arrived" || Boolean(pr.copilotReviewArrivedAt);
}

export function determineConfiguredBotRateLimitWait(
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

export function copilotReviewPending(config: SupervisorConfig, record: IssueRunRecord, pr: GitHubPullRequest): boolean {
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
  nowMs: number,
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

export function shouldWaitForCopilotReviewPropagation(
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

export function shouldWaitForConfiguredBotCurrentHeadQuietPeriod(
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

export function validTimestamp(value: string | null | undefined): string | null {
  if (typeof value !== "string" || value.length === 0) {
    return null;
  }

  return Number.isNaN(Date.parse(value)) ? null : value;
}

export function hasCurrentHeadProviderSuccess(
  record: Pick<IssueRunRecord, "provider_success_head_sha" | "provider_success_observed_at">,
  pr: GitHubPullRequest,
): boolean {
  return (
    record.provider_success_head_sha === pr.headRefOid &&
    validTimestamp(record.provider_success_observed_at) !== null
  );
}

export function currentHeadObservationSatisfiesActiveWait(
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

export function currentHeadTimestampSatisfiesActiveWait(
  record: Pick<IssueRunRecord, "review_wait_started_at" | "review_wait_head_sha">,
  pr: Pick<GitHubPullRequest, "headRefOid">,
  observedAtValue: string | null | undefined,
): boolean {
  const observedAt = validTimestamp(observedAtValue);
  if (!observedAt) {
    return false;
  }

  const waitStartedAt = validTimestamp(record.review_wait_started_at);
  if (!waitStartedAt || record.review_wait_head_sha !== pr.headRefOid) {
    return true;
  }

  return Date.parse(observedAt) >= Date.parse(waitStartedAt);
}

export function shouldWaitForConfiguredBotInitialGracePeriod(
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

export function requiresConfiguredBotCurrentHeadSignal(config: SupervisorConfig): boolean {
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

export function shouldWaitForConfiguredBotDraftSkipRearm(
  config: SupervisorConfig,
  record: IssueRunRecord,
  pr: GitHubPullRequest,
  nowMs: number,
): boolean {
  const startedAt = configuredBotDraftSkipRearmStartedAt(config, record, pr);
  if (!startedAt) {
    return false;
  }

  const startedAtMs = Date.parse(startedAt);
  if (Number.isNaN(startedAtMs)) {
    return false;
  }

  return nowMs < startedAtMs + configuredBotInitialGraceWaitMs(config);
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

export function shouldWaitForConfiguredBotLatestHeadRearm(
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
  if (!requiresConfiguredBotCurrentHeadSignal(config) || pr.isDraft) {
    return null;
  }

  const codexConnectorRequiresSignal = configuredReviewProviderKinds(config).includes("codex");
  if (
    codexConnectorRequiresSignal
      ? hasCurrentHeadProviderSuccess(record, pr) && currentHeadObservationSatisfiesActiveWait(record, pr)
      : hasCurrentHeadProviderSuccess(record, pr)
  ) {
    return null;
  }

  if (validTimestamp(pr.configuredBotCurrentHeadObservedAt) && currentHeadObservationSatisfiesActiveWait(record, pr)) {
    return null;
  }

  const currentHeadCiGreenAt = validTimestamp(pr.currentHeadCiGreenAt);
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

export function configuredBotCurrentHeadSignalPending(
  config: SupervisorConfig,
  record: IssueRunRecord,
  pr: GitHubPullRequest,
): boolean {
  if (!requiresConfiguredBotCurrentHeadSignal(config)) {
    return false;
  }

  return configuredBotCurrentHeadSignalWaitStartAt(config, record, pr) !== null;
}
