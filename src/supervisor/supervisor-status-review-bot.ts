import {
  configuredReviewBotLogins,
  repoExpectsConfiguredBotReview,
  repoUsesCopilotOnlyReviewBot,
  reviewProviderProfileFromConfig,
} from "../core/review-providers";
import { GitHubPullRequest, IssueRunRecord, ReviewThread, SupervisorConfig } from "../core/types";

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
