import fs from "node:fs";
import path from "node:path";
import {
  configuredReviewBotLogins,
  repoExpectsConfiguredBotReview,
  repoUsesCopilotOnlyReviewBot,
} from "../core/review-providers";
import { GitHubPullRequest, IssueRunRecord, ReviewThread, SupervisorConfig } from "../core/types";
import { localReviewDegradedNeedsBlock } from "../review-handling";
import {
  codexConnectorMustFixTopLevelReviewFindings,
  codexConnectorNitpickTopLevelReviewFindings,
  highestCodexConnectorPSeverity,
} from "../codex-connector-top-level-review";
import { codexConnectorNitpickOnlyReviewThreads } from "../codex-connector-review-policy";
import { classifyStaleReviewBotRecoverability, recoverabilityStatusToken } from "./stale-diagnostic-recoverability";
import {
  configuredBotCurrentHeadSignalWaitWindow,
  configuredBotInitialGraceWaitWindow,
  configuredBotRateLimitWaitWindow,
  configuredBotSettledWaitWindow,
} from "./review-bot-wait-windows";
import {
  configuredBotReviewNotExpectedWhileDraft,
  inferReviewBotProfile,
  summarizeObservedReviewSignal,
  type ReviewThreadClassifier,
} from "./review-bot-profile";

export {
  configuredBotCurrentHeadSignalWaitWindow,
  configuredBotInitialGraceWaitWindow,
  configuredBotRateLimitWaitWindow,
  configuredBotSettledWaitWindow,
} from "./review-bot-wait-windows";
export {
  inferReviewBotProfile,
  summarizeObservedReviewSignal,
} from "./review-bot-profile";
export type { ReviewBotProfileId, ReviewBotProfileSummary } from "./review-bot-profile";
export {
  buildCodexConnectorDiagnosticBundle,
  formatCodexConnectorConvergenceDiagnostic,
  formatCodexConnectorOperatorDiagnostic,
  formatCodexConnectorReviewFallbackDiagnostic,
} from "./codex-connector-diagnostics-presenter";
export type { CodexConnectorDiagnosticBundle } from "./codex-connector-diagnostics-presenter";
export { formatStaleReviewResidueOperatorDiagnostic } from "./stale-review-bot-diagnostics-presenter";

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

export function configuredReviewStatusLabel(config: SupervisorConfig): string {
  return !repoExpectsConfiguredBotReview(config) || repoUsesCopilotOnlyReviewBot(config)
    ? "copilot_review"
    : "configured_bot_review";
}

function unresolvedReviewThreads(reviewThreads: ReviewThread[]): ReviewThread[] {
  return reviewThreads.filter((thread) => !thread.isResolved && !thread.isOutdated);
}

function validStatusTimestamp(value: string | null | undefined): string | null {
  if (typeof value !== "string" || value.length === 0) {
    return null;
  }

  return Number.isNaN(Date.parse(value)) ? null : value;
}

function blockingConfiguredBotReviewThreads(pr: GitHubPullRequest, reviewThreads: ReviewThread[]): ReviewThread[] {
  if (!validStatusTimestamp(pr.configuredBotCurrentHeadObservedAt)) {
    return reviewThreads;
  }

  const nitpickOnlyThreads = new Set(codexConnectorNitpickOnlyReviewThreads(reviewThreads));
  return reviewThreads.filter((thread) => !nitpickOnlyThreads.has(thread));
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
  const blockingConfiguredThreads = blockingConfiguredBotReviewThreads(pr, unresolvedConfiguredThreads);
  const topLevelReviewEffect = configuredBotTopLevelReviewEffect(config, pr, reviewThreads, configuredBotReviewThreads);
  if (blockingConfiguredThreads.length > 0 || topLevelReviewEffect === "blocking") {
    return {
      status: "actionable_provider_review",
      observedReview: blockingConfiguredThreads.length > 0 ? "review_thread" : "top_level_review",
      nextCheck: "address_review",
      recentObservation:
        blockingConfiguredThreads.length > 0
          ? `unresolved_threads:${blockingConfiguredThreads.length}`
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
  const blockingConfiguredThreads = blockingConfiguredBotReviewThreads(pr, unresolvedConfiguredThreads);
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

  const reviewSignalSource = inferReviewBotProfile(config).signalSource;
  const review =
    !repoExpectsConfiguredBotReview(config)
      ? "disabled"
      : draftLocalReviewBlocked
        ? "local_review_blocked"
      : configuredBotReviewNotExpectedWhileDraft(config, pr)
        ? "not_expected_while_draft"
      : blockingConfiguredThreads.length > 0 || topLevelReviewEffect === "blocking"
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
  if (!repoExpectsConfiguredBotReview(config)) {
    return "none";
  }
  const mustFixFindings = codexConnectorMustFixTopLevelReviewFindings(pr.configuredBotTopLevelReviewFindings ?? []);
  if (mustFixFindings.length > 0) {
    return "blocking";
  }

  if (!pr.configuredBotTopLevelReviewStrength) {
    return "none";
  }

  if (pr.configuredBotTopLevelReviewStrength === "nitpick_only") {
    const unresolvedConfiguredThreads = unresolvedReviewThreads(configuredBotReviewThreads(config, reviewThreads));
    return blockingConfiguredBotReviewThreads(pr, unresolvedConfiguredThreads).length === 0
      ? "softened"
      : "awaiting_thread_resolution";
  }

  return "blocking";
}

export function configuredBotTopLevelReviewSummary(pr: GitHubPullRequest): string {
  const findings = pr.configuredBotTopLevelReviewFindings ?? [];
  const mustFixFindings = codexConnectorMustFixTopLevelReviewFindings(findings);
  const nitpickFindings = codexConnectorNitpickTopLevelReviewFindings(findings);
  return [
    `strength=${pr.configuredBotTopLevelReviewStrength ?? "none"}`,
    `submitted_at=${pr.configuredBotTopLevelReviewSubmittedAt ?? "none"}`,
    `finding_count=${findings.length}`,
    `must_fix_count=${mustFixFindings.length}`,
    `nitpick_count=${nitpickFindings.length}`,
    `highest_severity=${highestCodexConnectorPSeverity(findings) ?? "none"}`,
  ].join(" ");
}
