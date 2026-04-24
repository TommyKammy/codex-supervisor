import fs from "node:fs";
import path from "node:path";
import {
  configuredReviewBotLogins,
  configuredReviewProviderKinds,
  repoExpectsConfiguredBotReview,
  repoUsesCopilotOnlyReviewBot,
  reviewProviderProfileFromConfig,
} from "../core/review-providers";
import { GitHubPullRequest, IssueRunRecord, ReviewThread, SupervisorConfig } from "../core/types";
import { localReviewDegradedNeedsBlock } from "../review-handling";
import { classifyStaleReviewBotRecoverability, recoverabilityStatusToken } from "./stale-diagnostic-recoverability";

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

function configuredBotReviewNotExpectedWhileDraft(config: SupervisorConfig, pr: GitHubPullRequest): boolean {
  return configuredReviewProviderKinds(config).includes("coderabbit") && pr.isDraft && Boolean(pr.configuredBotDraftSkipAt);
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
  recentObservation?: string;
}

export interface ExternalSignalReadinessDiagnostics {
  status: string;
  ci: string;
  review: string;
  workflows: string;
}

function hasCurrentHeadProviderSuccess(activeRecord: IssueRunRecord, pr: GitHubPullRequest): boolean {
  return activeRecord.provider_success_head_sha === pr.headRefOid && Boolean(activeRecord.provider_success_observed_at);
}

function hasAuthoritativeExternalProviderActivity(
  activeRecord: IssueRunRecord,
  pr: GitHubPullRequest,
  observedReviewSignal: boolean,
  topLevelReviewEffect: string,
): boolean {
  return Boolean(
    hasCurrentHeadProviderSuccess(activeRecord, pr) ||
      pr.currentHeadCiGreenAt ||
      pr.configuredBotCurrentHeadObservedAt ||
      observedReviewSignal ||
      topLevelReviewEffect !== "none",
  );
}

export function configuredReviewBots(config: SupervisorConfig): string[] {
  return configuredReviewBotLogins(config);
}

function repoHasGitHubActionsWorkflows(repoPath: string): boolean | null {
  try {
    const workflowDir = path.join(repoPath, ".github", "workflows");
    const entries = fs.readdirSync(workflowDir, { withFileTypes: true });
    return entries.some((entry) => entry.isFile());
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return false;
    }
    return null;
  }
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
  provider: "none" | "coderabbit";
  pauseReason: "none" | "awaiting_current_head_signal_after_required_checks";
  recentObservation: "none" | "required_checks_green";
  observedAt: string | null;
  configuredWaitMinutes: number | null;
  waitUntil: string | null;
} {
  if (
    !configuredReviewProviderKinds(config).includes("coderabbit") ||
    !config.configuredBotRequireCurrentHeadSignal ||
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
      provider: "coderabbit",
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
    provider: "coderabbit",
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

function staleProviderSignalObservation(activeRecord: IssueRunRecord, pr: GitHubPullRequest): string | null {
  if (activeRecord.external_review_head_sha && activeRecord.external_review_head_sha !== pr.headRefOid) {
    return `external_review_record:${activeRecord.external_review_head_sha}->${pr.headRefOid}`;
  }

  return null;
}

function providerOutageObservation(
  config: SupervisorConfig,
  pr: GitHubPullRequest,
  activeRecord: Pick<IssueRunRecord, "review_wait_started_at" | "review_wait_head_sha">,
): string | null {
  const currentHeadSignalWait = configuredBotCurrentHeadSignalWaitWindow(config, pr);
  if (currentHeadSignalWait.status === "expired" && currentHeadSignalWait.observedAt) {
    return `${currentHeadSignalWait.recentObservation}:${currentHeadSignalWait.observedAt}`;
  }

  const initialGraceWait = configuredBotInitialGraceWaitWindow(config, pr, activeRecord);
  if (initialGraceWait.status === "expired" && initialGraceWait.observedAt) {
    return `${initialGraceWait.recentObservation}:${initialGraceWait.observedAt}`;
  }

  return null;
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

  if (configuredBotReviewNotExpectedWhileDraft(config, pr)) {
    return {
      status: "review_not_expected_while_draft",
      observedReview: "draft_skip",
      nextCheck: "ready_for_review",
    };
  }

  const unresolvedConfiguredThreads = unresolvedReviewThreads(configuredBotReviewThreads(config, reviewThreads));
  const topLevelReviewEffect = configuredBotTopLevelReviewEffect(config, pr, reviewThreads, configuredBotReviewThreads);
  if (unresolvedConfiguredThreads.length > 0 || topLevelReviewEffect === "blocking") {
    return {
      status: "actionable_provider_review",
      observedReview: unresolvedConfiguredThreads.length > 0 ? "review_thread" : "top_level_review",
      nextCheck: "address_review",
      recentObservation:
        unresolvedConfiguredThreads.length > 0
          ? `unresolved_threads:${unresolvedConfiguredThreads.length}`
          : `top_level_review:${pr.configuredBotTopLevelReviewSubmittedAt ?? "unknown"}`,
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

  const staleProviderObservation = staleProviderSignalObservation(activeRecord, pr);
  if (staleProviderObservation) {
    return {
      status: "stale_provider_signal",
      observedReview: "stale_external_review_record",
      nextCheck: "wait_for_current_head_signal",
      recentObservation: staleProviderObservation,
    };
  }

  if (observed.observedReview === "copilot_requested") {
    return {
      status: "waiting_for_provider_review",
      observedReview: observed.observedReview,
      nextCheck: "provider_delivery",
    };
  }

  const providerOutageRecentObservation = providerOutageObservation(config, pr, activeRecord);
  if (providerOutageRecentObservation) {
    const staleReviewBotRecoverability = classifyStaleReviewBotRecoverability(activeRecord, config);
    const recoverability =
      staleReviewBotRecoverability === "provider_outage_suspected"
        ? recoverabilityStatusToken(staleReviewBotRecoverability)
        : recoverabilityStatusToken("provider_outage_suspected");
    return {
      status: "provider_outage_suspected",
      observedReview: "none",
      nextCheck: "wait_or_provider_setup_or_manual_review",
      recentObservation: `${providerOutageRecentObservation} ${recoverability}`,
    };
  }

  return {
    status: "missing_provider_signal",
    observedReview: observed.observedReview,
    nextCheck: "provider_setup_or_delivery",
  };
}

export function externalSignalReadinessDiagnostics(
  config: SupervisorConfig,
  activeRecord: IssueRunRecord,
  pr: GitHubPullRequest,
  checks: { bucket: string }[],
  reviewThreads: ReviewThread[],
  configuredBotReviewThreads: ReviewThreadClassifier,
): ExternalSignalReadinessDiagnostics {
  const workflowPresence = repoHasGitHubActionsWorkflows(config.repoPath);
  const workflows =
    workflowPresence === true ? "present" : workflowPresence === false ? "absent" : "unknown";
  const hasFailingChecks = checks.some((check) => check.bucket === "fail");
  const hasPendingChecks = checks.some((check) => check.bucket === "pending" || check.bucket === "cancel");
  const hasPassingChecks = checks.some((check) => check.bucket === "pass" || check.bucket === "skipping");
  const unresolvedConfiguredThreads = unresolvedReviewThreads(configuredBotReviewThreads(config, reviewThreads));
  const observed = summarizeObservedReviewSignal(config, activeRecord, pr, reviewThreads, configuredBotReviewThreads);
  const topLevelReviewEffect = configuredBotTopLevelReviewEffect(config, pr, reviewThreads, configuredBotReviewThreads);
  const hasExternalProviderActivity = hasAuthoritativeExternalProviderActivity(
    activeRecord,
    pr,
    observed.hasSignal,
    topLevelReviewEffect,
  );
  const draftLocalReviewBlocked = pr.isDraft && localReviewDegradedNeedsBlock(config, activeRecord, pr);
  const ci =
    hasFailingChecks
      ? "failing"
      : hasPendingChecks
        ? "pending"
        : hasPassingChecks || pr.currentHeadCiGreenAt || hasCurrentHeadProviderSuccess(activeRecord, pr)
          ? "passing"
          : workflowPresence === false && hasExternalProviderActivity
            ? "awaiting_external_signal"
          : workflowPresence === false
            ? "repo_not_configured"
            : checks.length === 0
              ? "awaiting_signal"
              : "unknown";

  const reviewSignalSource = reviewProviderProfileFromConfig(config).signalSource;
  const review =
    !repoExpectsConfiguredBotReview(config)
      ? "disabled"
      : draftLocalReviewBlocked
        ? "local_review_blocked"
      : configuredBotReviewNotExpectedWhileDraft(config, pr)
        ? "not_expected_while_draft"
      : unresolvedConfiguredThreads.length > 0 || topLevelReviewEffect === "blocking"
        ? "feedback_present"
      : observed.hasSignal || topLevelReviewEffect !== "none"
          ? "signal_observed"
          : observed.observedReview === "copilot_requested"
            ? "pending_delivery"
            : workflowPresence === false &&
                reviewSignalSource === "review_threads" &&
                checks.length === 0 &&
                !hasExternalProviderActivity
              ? "repo_not_configured"
              : "awaiting_signal";

  const hasRepoReadinessGap = ci === "repo_not_configured" || review === "repo_not_configured";
  const status =
    ci === "failing" || review === "feedback_present"
      ? "blocked_by_ci_or_review_feedback"
      : review === "local_review_blocked"
        ? "blocked_by_local_review"
      : hasRepoReadinessGap
        ? "repo_not_ready_for_expected_signals"
        : ci === "awaiting_signal" ||
            ci === "awaiting_external_signal" ||
            review === "awaiting_signal" ||
            review === "pending_delivery"
          ? "awaiting_expected_signals"
          : "signals_observed";

  return { status, ci, review, workflows };
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
