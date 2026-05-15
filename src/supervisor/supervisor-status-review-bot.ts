import fs from "node:fs";
import path from "node:path";
import {
  configuredReviewBotLogins,
  configuredReviewProviderKinds,
  repoExpectsConfiguredBotReview,
  repoUsesCopilotOnlyReviewBot,
  reviewProviderProfileFromConfig,
} from "../core/review-providers";
import { displayLocalCiCommand } from "../core/config-parsing";
import { GitHubPullRequest, IssueRunRecord, PullRequestCheck, ReviewThread, SupervisorConfig } from "../core/types";
import { localReviewDegradedNeedsBlock } from "../review-handling";
import {
  buildCodexConnectorPolicyBlockDiagnostic,
  evaluateCodexConnectorConvergencePolicy,
} from "../review-thread-reporting";
import { classifyStaleReviewBotRecoverability, recoverabilityStatusToken } from "./stale-diagnostic-recoverability";

type ReviewThreadClassifier = (config: SupervisorConfig, reviewThreads: ReviewThread[]) => ReviewThread[];
const DEFAULT_CONFIGURED_BOT_SETTLED_WAIT_MS = 5_000;
const DEFAULT_CONFIGURED_BOT_INITIAL_GRACE_WAIT_MS = 90_000;
type CurrentHeadSignalWaitProvider = "none" | "coderabbit" | "codex";

function addMinutes(timestamp: string, minutes: number): string | null {
  const parsed = Date.parse(timestamp);
  if (Number.isNaN(parsed)) {
    return null;
  }

  return new Date(parsed + minutes * 60_000).toISOString();
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

export function formatCodexConnectorReviewFallbackDiagnostic(args: {
  config: SupervisorConfig;
  record: Pick<
    IssueRunRecord,
    | "codex_connector_review_requested_observed_at"
    | "codex_connector_review_requested_head_sha"
    | "codex_connector_review_request_retry_count"
    | "codex_connector_review_request_retry_head_sha"
    | "codex_connector_review_request_last_retried_at"
    | "codex_connector_review_request_comment_identity_status"
    | "codex_connector_review_request_comment_database_id"
    | "codex_connector_review_request_comment_node_id"
    | "codex_connector_review_request_comment_url"
  >;
  pr: GitHubPullRequest;
  checks?: PullRequestCheck[];
}): string | null {
  if (!configuredReviewProviderKinds(args.config).includes("codex")) {
    return null;
  }

  const waitWindow = configuredBotCurrentHeadSignalWaitWindow(args.config, args.pr);
  const currentHeadObservedAt = args.pr.configuredBotCurrentHeadObservedAt ?? null;
  const recordRequestAt = args.record.codex_connector_review_requested_observed_at ?? null;
  const recordRequestHeadSha = args.record.codex_connector_review_requested_head_sha ?? null;
  const prRequestAt = args.pr.codexConnectorReviewRequestedAt ?? null;
  const prRequestHeadSha = args.pr.codexConnectorReviewRequestedHeadSha ?? null;
  const requestAt = recordRequestAt ?? prRequestAt;
  const requestHeadSha = recordRequestHeadSha ?? prRequestHeadSha;
  const requestMatchesCurrentHead = Boolean(requestAt && requestHeadSha === args.pr.headRefOid);
  const retryCount =
    args.record.codex_connector_review_request_retry_head_sha === args.pr.headRefOid
      ? args.record.codex_connector_review_request_retry_count ?? 0
      : 0;
  const retryLimit = args.config.codexConnectorReviewRequestRetryLimit ?? 1;
  const retryAnchorAt =
    args.record.codex_connector_review_request_retry_head_sha === args.pr.headRefOid &&
    args.record.codex_connector_review_request_last_retried_at
      ? args.record.codex_connector_review_request_last_retried_at
      : requestAt;
  const retryWaitUntil = retryAnchorAt
    ? addMinutes(retryAnchorAt, args.config.codexConnectorReviewRequestNoResponseMinutes ?? 10)
    : null;
  const timeoutAction = args.config.configuredBotCurrentHeadSignalTimeoutAction ?? args.config.copilotReviewTimeoutAction;
  const retryConfigured = timeoutAction === "request_review_comment";
  const requestNoResponseElapsed = Boolean(
    retryConfigured &&
    requestMatchesCurrentHead &&
    !currentHeadObservedAt &&
    retryWaitUntil &&
    Date.now() >= Date.parse(retryWaitUntil),
  );
  const reviewSignal = currentHeadObservedAt ? "current_head_observed" : "missing";
  const loadedChecksAreGreen = Boolean(
    args.checks && args.checks.length > 0 && args.checks.every((check) => check.bucket === "pass"),
  );
  const noChecksAndNoLocalCi = Boolean(
    args.checks && args.checks.length === 0 && !displayLocalCiCommand(args.config.localCiCommand),
  );
  const requiredChecksGreenAt =
    args.pr.currentHeadCiGreenAt ??
    (loadedChecksAreGreen ? "loaded_checks_passed" : noChecksAndNoLocalCi ? "no_checks_local_ci_unset" : "none");

  let status:
    | "current_head_observed"
    | "waiting_current_head_signal"
    | "timeout_elapsed"
    | "request_posted"
    | "already_requested"
    | "request_posted_no_current_head_signal"
    | "request_retry_exhausted"
    | "missing_current_head_signal";
  if (currentHeadObservedAt) {
    status = "current_head_observed";
  } else if (requestNoResponseElapsed && retryCount >= retryLimit) {
    status = "request_retry_exhausted";
  } else if (requestNoResponseElapsed) {
    status = "request_posted_no_current_head_signal";
  } else if (requestMatchesCurrentHead && recordRequestAt) {
    status = "request_posted";
  } else if (requestMatchesCurrentHead) {
    status = "already_requested";
  } else if (waitWindow.status === "active") {
    status = "waiting_current_head_signal";
  } else if (waitWindow.status === "expired") {
    status = "timeout_elapsed";
  } else {
    status = "missing_current_head_signal";
  }

  const waitUntilSuffix = waitWindow.waitUntil ? ` wait_until=${waitWindow.waitUntil}` : "";
  const commentIdentity =
    args.record.codex_connector_review_request_comment_identity_status === "available"
      ? [
          `database_id=${args.record.codex_connector_review_request_comment_database_id ?? "none"}`,
          `node_id=${args.record.codex_connector_review_request_comment_node_id ?? "none"}`,
          `url=${args.record.codex_connector_review_request_comment_url ?? "none"}`,
        ].join(",")
      : "unavailable";
  const retryStatusSuffix =
    status === "request_posted_no_current_head_signal" || status === "request_retry_exhausted"
      ? [
          ` retry_status=${status === "request_retry_exhausted" ? "exhausted" : "eligible"}`,
          `retry_count=${retryCount}`,
          `retry_limit=${retryLimit}`,
          `retry_wait_until=${retryWaitUntil ?? "none"}`,
          `request_comment_identity=${commentIdentity}`,
          `next_action=${status === "request_retry_exhausted" ? "operator_manual_review" : "retry_request_review_comment"}`,
        ].join(" ")
      : "";
  return [
    `codex_connector_review_fallback status=${status}`,
    "provider=codex",
    `current_head_sha=${args.pr.headRefOid}`,
    `current_head_observed_at=${currentHeadObservedAt ?? "none"}`,
    `required_checks_green_at=${requiredChecksGreenAt}`,
    `timeout_action=${timeoutAction}`,
    `requested_at=${requestAt ?? "none"}`,
    `requested_head_sha=${requestHeadSha ?? "none"}`,
    `review_signal=${reviewSignal}`,
    "note=request_comment_is_not_review_completion",
  ].join(" ") + retryStatusSuffix + waitUntilSuffix;
}

export function formatCodexConnectorConvergenceDiagnostic(args: {
  config: SupervisorConfig;
  record: Pick<
    IssueRunRecord,
    | "state"
    | "provider_success_head_sha"
    | "provider_success_observed_at"
    | "external_review_head_sha"
    | "codex_connector_review_requested_observed_at"
    | "codex_connector_review_requested_head_sha"
  >;
  pr: GitHubPullRequest;
  reviewThreads: ReviewThread[];
}): string | null {
  if (!configuredReviewProviderKinds(args.config).includes("codex")) {
    return null;
  }

  const policy = evaluateCodexConnectorConvergencePolicy(args.config, args.pr, args.reviewThreads);
  if (!policy) {
    return null;
  }

  const currentHeadSha = args.pr.headRefOid;
  const staleSignalHeadSha =
    args.record.provider_success_head_sha && args.record.provider_success_head_sha !== currentHeadSha
      ? args.record.provider_success_head_sha
      : args.record.external_review_head_sha && args.record.external_review_head_sha !== currentHeadSha
        ? args.record.external_review_head_sha
        : null;
  const latestSignalHeadSha =
    staleSignalHeadSha ??
    (args.record.provider_success_head_sha === currentHeadSha
      ? args.record.provider_success_head_sha
      : policy.currentHeadObservedAt
        ? currentHeadSha
        : "none");
  const requestMatchesCurrentHead = Boolean(
    args.record.codex_connector_review_requested_observed_at &&
      args.record.codex_connector_review_requested_head_sha === currentHeadSha,
  );
  const hydratedRequestMatchesCurrentHead = Boolean(
    !requestMatchesCurrentHead &&
      args.pr.codexConnectorReviewRequestedAt &&
      args.pr.codexConnectorReviewRequestedHeadSha === currentHeadSha,
  );
  const hasCurrentHeadProviderSuccess = Boolean(
    args.record.provider_success_observed_at && args.record.provider_success_head_sha === currentHeadSha,
  );
  const findingCount = policy.mustFixCount + policy.nitpickCount;
  const policyBlock = buildCodexConnectorPolicyBlockDiagnostic(args.config, args.reviewThreads);
  const highestSeverity =
    policyBlock?.severity ?? (policy.nitpickCount > 0 ? "nitpick_only" : "none");

  let status:
    | "contradictory_evidence"
    | "stale_head"
    | "repairing_must_fix"
    | "re_requested_review"
    | "same_head_request_hydrated"
    | "waiting_review"
    | "missing_current_head_review"
    | "nitpick_only"
    | "converged";
  let mergeEffect: "blocked" | "nitpick_only" | "ready";
  let nextAction:
    | "fail_closed_inspect_connector_state"
    | "wait_for_current_head_signal"
    | "repair_must_fix_findings"
    | "wait_for_requested_review"
    | "request_current_head_review"
    | "merge_or_follow_up_nitpicks"
    | "merge_ready";

  if (hasCurrentHeadProviderSuccess && policy.outcome !== "converged" && policy.outcome !== "nitpick_only") {
    status = "contradictory_evidence";
    mergeEffect = "blocked";
    nextAction = "fail_closed_inspect_connector_state";
  } else if (staleSignalHeadSha) {
    status = "stale_head";
    mergeEffect = "blocked";
    nextAction = "wait_for_current_head_signal";
  } else if (policy.outcome === "must_fix_remaining") {
    status = "repairing_must_fix";
    mergeEffect = "blocked";
    nextAction = "repair_must_fix_findings";
  } else if (policy.outcome === "missing_current_head_review") {
    status = requestMatchesCurrentHead
      ? "re_requested_review"
      : hydratedRequestMatchesCurrentHead
        ? "same_head_request_hydrated"
        : "missing_current_head_review";
    mergeEffect = "blocked";
    nextAction = requestMatchesCurrentHead || hydratedRequestMatchesCurrentHead ? "wait_for_requested_review" : "request_current_head_review";
  } else if (policy.outcome === "nitpick_only") {
    status = "nitpick_only";
    mergeEffect = "nitpick_only";
    nextAction = "merge_or_follow_up_nitpicks";
  } else {
    status = "converged";
    mergeEffect = "ready";
    nextAction = "merge_ready";
  }

  const waitWindow = configuredBotCurrentHeadSignalWaitWindow(args.config, args.pr);
  if (status === "missing_current_head_review" && waitWindow.status === "active") {
    status = "waiting_review";
    nextAction = "wait_for_current_head_signal";
  }

  return [
    `codex_connector_convergence status=${status}`,
    "provider=codex",
    `current_head_sha=${currentHeadSha}`,
    `current_head_observed_at=${policy.currentHeadObservedAt ?? "none"}`,
    `latest_signal_head_sha=${latestSignalHeadSha}`,
    `highest_severity=${highestSeverity}`,
    `finding_count=${findingCount}`,
    `merge_effect=${mergeEffect}`,
    `next_action=${nextAction}`,
  ].join(" ");
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

  if (pr.configuredBotCurrentHeadObservationSource === "codex_pr_success_comment" && pr.configuredBotCurrentHeadObservedAt) {
    return { observedReview: "codex_pr_success_comment", hasSignal: true };
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
