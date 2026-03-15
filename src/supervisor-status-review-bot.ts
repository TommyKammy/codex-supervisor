import { GitHubPullRequest, IssueRunRecord, ReviewThread, SupervisorConfig } from "./types";

const COPILOT_REVIEWER_LOGIN = "copilot-pull-request-reviewer";

type ReviewThreadClassifier = (config: SupervisorConfig, reviewThreads: ReviewThread[]) => ReviewThread[];

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
  return config.reviewBotLogins.map((login) => login.trim()).filter((login) => login.length > 0);
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

export function repoExpectsConfiguredBotReview(config: SupervisorConfig): boolean {
  return configuredReviewBots(config).length > 0;
}

export function repoUsesCopilotOnlyReviewBot(config: SupervisorConfig): boolean {
  const bots = configuredReviewBots(config);
  return bots.length === 1 && bots[0].toLowerCase() === COPILOT_REVIEWER_LOGIN;
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
  const reviewers = configuredReviewBots(config);
  const normalized = reviewers.map((reviewer) => reviewer.toLowerCase());
  const normalizedSet = new Set(normalized);

  if (normalized.length === 0) {
    return {
      profile: "none",
      provider: "none",
      reviewers,
      signalSource: "none",
    };
  }

  if (normalized.length === 1 && normalized[0] === COPILOT_REVIEWER_LOGIN) {
    return {
      profile: "copilot",
      provider: COPILOT_REVIEWER_LOGIN,
      reviewers,
      signalSource: "copilot_lifecycle",
    };
  }

  if (normalized.length === 1 && normalized[0] === "chatgpt-codex-connector") {
    return {
      profile: "codex",
      provider: "chatgpt-codex-connector",
      reviewers,
      signalSource: "review_threads",
    };
  }

  if (
    normalized.length === 2 &&
    normalizedSet.has("coderabbitai") &&
    normalizedSet.has("coderabbitai[bot]")
  ) {
    return {
      profile: "coderabbit",
      provider: "coderabbitai",
      reviewers,
      signalSource: "review_threads",
    };
  }

  return {
    profile: "custom",
    provider: reviewers.join(",") || "custom",
    reviewers,
    signalSource: normalized.includes(COPILOT_REVIEWER_LOGIN) ? "copilot_lifecycle+review_threads" : "review_threads",
  };
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
