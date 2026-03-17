import {
  configuredReviewBotLogins,
  configuredReviewProviderKinds,
  repoExpectsConfiguredBotReview,
  repoUsesCopilotOnlyReviewBot,
  reviewProviderProfileFromConfig,
} from "../core/review-providers";
import { GitHubPullRequest, IssueRunRecord, ReviewThread, SupervisorConfig } from "../core/types";

type ReviewThreadClassifier = (config: SupervisorConfig, reviewThreads: ReviewThread[]) => ReviewThread[];
const DEFAULT_CONFIGURED_BOT_SETTLED_WAIT_MS = 5_000;
const DEFAULT_CONFIGURED_BOT_INITIAL_GRACE_WAIT_MS = 90_000;

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

function configuredBotDraftSkipRewaitStartAt(
  config: SupervisorConfig,
  pr: GitHubPullRequest,
  record?: Pick<IssueRunRecord, "review_wait_started_at" | "review_wait_head_sha"> | null,
): string | null {
  if (!configuredReviewProviderKinds(config).includes("coderabbit") || pr.isDraft || !pr.configuredBotDraftSkipAt) {
    return null;
  }

  if (!record?.review_wait_started_at || record.review_wait_head_sha !== pr.headRefOid) {
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

export type ReviewBotProfileId = "none" | "copilot" | "codex" | "coderabbit" | "custom";

export interface ReviewBotProfileSummary {
  profile: ReviewBotProfileId;
  provider: string;
  reviewers: string[];
  signalSource: string;
}

export interface ReviewBotDiagnostics {
  status: string;
  observedReview: string;
  nextCheck: string;
}

export function configuredReviewBots(config: SupervisorConfig): string[] {
  return configuredReviewBotLogins(config);
}

export function configuredBotRateLimitWaitWindow(
  config: SupervisorConfig,
  pr: GitHubPullRequest,
): { status: "inactive" | "active" | "expired"; observedAt: string | null; waitUntil: string | null } {
  const waitMinutes = config.configuredBotRateLimitWaitMinutes ?? 0;
  if (waitMinutes <= 0 || !pr.configuredBotRateLimitedAt) {
    return { status: "inactive", observedAt: pr.configuredBotRateLimitedAt ?? null, waitUntil: null };
  }

  const observedAtMs = Date.parse(pr.configuredBotRateLimitedAt);
  if (Number.isNaN(observedAtMs)) {
    return { status: "inactive", observedAt: pr.configuredBotRateLimitedAt, waitUntil: null };
  }

  const waitUntil = new Date(observedAtMs + waitMinutes * 60_000).toISOString();
  return {
    status: Date.now() < Date.parse(waitUntil) ? "active" : "expired",
    observedAt: pr.configuredBotRateLimitedAt,
    waitUntil,
  };
}

export function configuredBotSettledWaitWindow(
  config: SupervisorConfig,
  pr: GitHubPullRequest,
): {
  status: "inactive" | "active" | "expired";
  provider: "none" | "coderabbit";
  pauseReason: "none" | "recent_current_head_observation";
  recentObservation: "none" | "current_head_activity";
  observedAt: string | null;
  configuredWaitSeconds: number | null;
  waitUntil: string | null;
} {
  if (!configuredReviewProviderKinds(config).includes("coderabbit") || pr.isDraft || !pr.configuredBotCurrentHeadObservedAt) {
    return {
      status: "inactive",
      provider: "none",
      pauseReason: "none",
      recentObservation: "none",
      observedAt: pr.configuredBotCurrentHeadObservedAt ?? null,
      configuredWaitSeconds: null,
      waitUntil: null,
    };
  }

  const observedAtMs = Date.parse(pr.configuredBotCurrentHeadObservedAt);
  const configuredWaitSeconds = config.configuredBotSettledWaitSeconds ?? DEFAULT_CONFIGURED_BOT_SETTLED_WAIT_MS / 1_000;
  if (Number.isNaN(observedAtMs)) {
    return {
      status: "inactive",
      provider: "coderabbit",
      pauseReason: "recent_current_head_observation",
      recentObservation: "current_head_activity",
      observedAt: pr.configuredBotCurrentHeadObservedAt,
      configuredWaitSeconds,
      waitUntil: null,
    };
  }

  const settledWaitMs = configuredWaitSeconds * 1_000;
  const waitUntil = new Date(observedAtMs + settledWaitMs).toISOString();
  return {
    status: Date.now() < Date.parse(waitUntil) ? "active" : "expired",
    provider: "coderabbit",
    pauseReason: "recent_current_head_observation",
    recentObservation: "current_head_activity",
    observedAt: pr.configuredBotCurrentHeadObservedAt,
    configuredWaitSeconds,
    waitUntil,
  };
}

export function configuredBotInitialGraceWaitWindow(
  config: SupervisorConfig,
  pr: GitHubPullRequest,
  record?: Pick<IssueRunRecord, "review_wait_started_at" | "review_wait_head_sha"> | null,
): {
  status: "inactive" | "active" | "expired";
  provider: "none" | "coderabbit";
  pauseReason: "none" | "awaiting_initial_provider_activity" | "awaiting_fresh_provider_review_after_draft_skip";
  recentObservation: "none" | "required_checks_green" | "ready_for_review_reopened_wait";
  observedAt: string | null;
  configuredWaitSeconds: number | null;
  waitUntil: string | null;
} {
  const draftSkipRewaitStartedAt = configuredBotDraftSkipRewaitStartAt(config, pr, record);
  if (draftSkipRewaitStartedAt) {
    const observedAtMs = Date.parse(draftSkipRewaitStartedAt);
    const configuredWaitSeconds =
      config.configuredBotInitialGraceWaitSeconds ?? DEFAULT_CONFIGURED_BOT_INITIAL_GRACE_WAIT_MS / 1_000;
    if (Number.isNaN(observedAtMs)) {
      return {
        status: "inactive",
        provider: "coderabbit",
        pauseReason: "awaiting_fresh_provider_review_after_draft_skip",
        recentObservation: "ready_for_review_reopened_wait",
        observedAt: draftSkipRewaitStartedAt,
        configuredWaitSeconds,
        waitUntil: null,
      };
    }

    const initialGraceWaitMs = configuredWaitSeconds * 1_000;
    const waitUntil = new Date(observedAtMs + initialGraceWaitMs).toISOString();
    return {
      status: Date.now() < Date.parse(waitUntil) ? "active" : "expired",
      provider: "coderabbit",
      pauseReason: "awaiting_fresh_provider_review_after_draft_skip",
      recentObservation: "ready_for_review_reopened_wait",
      observedAt: draftSkipRewaitStartedAt,
      configuredWaitSeconds,
      waitUntil,
    };
  }

  if (!configuredReviewProviderKinds(config).includes("coderabbit") || pr.isDraft || pr.configuredBotCurrentHeadObservedAt || !pr.currentHeadCiGreenAt) {
    return {
      status: "inactive",
      provider: "none",
      pauseReason: "none",
      recentObservation: "none",
      observedAt: pr.currentHeadCiGreenAt ?? null,
      configuredWaitSeconds: null,
      waitUntil: null,
    };
  }

  const observedAtMs = Date.parse(pr.currentHeadCiGreenAt);
  const configuredWaitSeconds =
    config.configuredBotInitialGraceWaitSeconds ?? DEFAULT_CONFIGURED_BOT_INITIAL_GRACE_WAIT_MS / 1_000;
  if (Number.isNaN(observedAtMs)) {
    return {
      status: "inactive",
      provider: "coderabbit",
      pauseReason: "awaiting_initial_provider_activity",
      recentObservation: "required_checks_green",
      observedAt: pr.currentHeadCiGreenAt,
      configuredWaitSeconds,
      waitUntil: null,
    };
  }

  const initialGraceWaitMs = configuredWaitSeconds * 1_000;
  const waitUntil = new Date(observedAtMs + initialGraceWaitMs).toISOString();
  return {
    status: Date.now() < Date.parse(waitUntil) ? "active" : "expired",
    provider: "coderabbit",
    pauseReason: "awaiting_initial_provider_activity",
    recentObservation: "required_checks_green",
    observedAt: pr.currentHeadCiGreenAt,
    configuredWaitSeconds,
    waitUntil,
  };
}

export function configuredReviewStatusLabel(config: SupervisorConfig): string {
  return !repoExpectsConfiguredBotReview(config) || repoUsesCopilotOnlyReviewBot(config)
    ? "copilot_review"
    : "configured_bot_review";
}

function unresolvedReviewThreads(reviewThreads: ReviewThread[]): ReviewThread[] {
  return reviewThreads.filter((thread) => !thread.isResolved && !thread.isOutdated);
}

export function inferReviewBotProfile(config: SupervisorConfig): ReviewBotProfileSummary {
  return reviewProviderProfileFromConfig(config);
}

export function summarizeObservedReviewSignal(
  config: SupervisorConfig,
  activeRecord: IssueRunRecord,
  pr: GitHubPullRequest,
  reviewThreads: ReviewThread[],
  configuredBotReviewThreads: ReviewThreadClassifier,
): { observedReview: string; hasSignal: boolean } {
  const configuredThreads = configuredBotReviewThreads(config, reviewThreads);
  if (configuredThreads.length > 0) {
    return { observedReview: "review_thread", hasSignal: true };
  }

  if (activeRecord.external_review_head_sha === pr.headRefOid) {
    return { observedReview: "external_review_record", hasSignal: true };
  }

  const lifecycleState = pr.copilotReviewState ?? "not_requested";
  if (lifecycleState === "arrived") {
    return { observedReview: "copilot_arrived", hasSignal: true };
  }
  if (lifecycleState === "requested") {
    return { observedReview: "copilot_requested", hasSignal: false };
  }
  if (pr.copilotReviewState === null) {
    return { observedReview: "unknown", hasSignal: false };
  }

  return { observedReview: "none", hasSignal: false };
}

export function reviewBotDiagnostics(
  config: SupervisorConfig,
  activeRecord: IssueRunRecord,
  pr: GitHubPullRequest,
  reviewThreads: ReviewThread[],
  configuredBotReviewThreads: ReviewThreadClassifier,
): ReviewBotDiagnostics {
  if (!repoExpectsConfiguredBotReview(config)) {
    return {
      status: "disabled",
      observedReview: "none",
      nextCheck: "none",
    };
  }

  const observed = summarizeObservedReviewSignal(config, activeRecord, pr, reviewThreads, configuredBotReviewThreads);
  if (observed.hasSignal) {
    return {
      status: "review_signal_observed",
      observedReview: observed.observedReview,
      nextCheck: "none",
    };
  }

  if (observed.observedReview === "copilot_requested") {
    return {
      status: "waiting_for_provider_review",
      observedReview: observed.observedReview,
      nextCheck: "provider_delivery",
    };
  }

  return {
    status: "missing_provider_signal",
    observedReview: observed.observedReview,
    nextCheck: "provider_setup_or_delivery",
  };
}

export function configuredBotTopLevelReviewEffect(
  config: SupervisorConfig,
  pr: GitHubPullRequest,
  reviewThreads: ReviewThread[],
  configuredBotReviewThreads: ReviewThreadClassifier,
): string {
  if (!repoExpectsConfiguredBotReview(config) || !pr.configuredBotTopLevelReviewStrength) {
    return "none";
  }

  if (pr.configuredBotTopLevelReviewStrength === "nitpick_only") {
    return unresolvedReviewThreads(configuredBotReviewThreads(config, reviewThreads)).length === 0
      ? "softened"
      : "awaiting_thread_resolution";
  }

  return "blocking";
}
