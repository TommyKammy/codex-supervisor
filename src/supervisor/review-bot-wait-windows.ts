import { configuredReviewProviderKinds } from "../core/review-providers";
import { GitHubPullRequest, IssueRunRecord, SupervisorConfig } from "../core/types";

const DEFAULT_CONFIGURED_BOT_SETTLED_WAIT_MS = 5_000;
const DEFAULT_CONFIGURED_BOT_INITIAL_GRACE_WAIT_MS = 90_000;

export type CurrentHeadSignalWaitProvider = "none" | "coderabbit" | "codex";

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

function currentHeadSignalWaitProvider(config: SupervisorConfig): Exclude<CurrentHeadSignalWaitProvider, "none"> | null {
  const providerKinds = configuredReviewProviderKinds(config);
  if (providerKinds.includes("codex")) {
    return "codex";
  }
  if (providerKinds.includes("coderabbit")) {
    return "coderabbit";
  }
  return null;
}

function requiresCurrentHeadSignalWait(config: SupervisorConfig): boolean {
  const provider = currentHeadSignalWaitProvider(config);
  return provider !== null && (provider === "codex" || config.configuredBotRequireCurrentHeadSignal === true);
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

export function configuredBotCurrentHeadSignalWaitWindow(
  config: SupervisorConfig,
  pr: GitHubPullRequest,
): {
  status: "inactive" | "active" | "expired";
  provider: CurrentHeadSignalWaitProvider;
  pauseReason: "none" | "awaiting_current_head_signal_after_required_checks";
  recentObservation: "none" | "required_checks_green";
  observedAt: string | null;
  configuredWaitMinutes: number | null;
  waitUntil: string | null;
} {
  const provider = currentHeadSignalWaitProvider(config);
  if (
    !provider ||
    !requiresCurrentHeadSignalWait(config) ||
    pr.isDraft ||
    pr.configuredBotCurrentHeadObservedAt ||
    !pr.currentHeadCiGreenAt
  ) {
    return {
      status: "inactive",
      provider: "none",
      pauseReason: "none",
      recentObservation: "none",
      observedAt: pr.currentHeadCiGreenAt ?? null,
      configuredWaitMinutes: null,
      waitUntil: null,
    };
  }

  const observedAtMs = Date.parse(pr.currentHeadCiGreenAt);
  const configuredWaitMinutes = config.configuredBotCurrentHeadSignalTimeoutMinutes ?? null;
  if (Number.isNaN(observedAtMs) || !configuredWaitMinutes || configuredWaitMinutes <= 0) {
    return {
      status: "inactive",
      provider,
      pauseReason: "awaiting_current_head_signal_after_required_checks",
      recentObservation: "required_checks_green",
      observedAt: pr.currentHeadCiGreenAt,
      configuredWaitMinutes,
      waitUntil: null,
    };
  }

  const waitUntil = new Date(observedAtMs + configuredWaitMinutes * 60_000).toISOString();
  return {
    status: Date.now() < Date.parse(waitUntil) ? "active" : "expired",
    provider,
    pauseReason: "awaiting_current_head_signal_after_required_checks",
    recentObservation: "required_checks_green",
    observedAt: pr.currentHeadCiGreenAt,
    configuredWaitMinutes,
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
