import {
  localReviewBlocksMerge,
  localReviewHighSeverityNeedsBlock,
  localReviewHighSeverityNeedsRetry,
  localReviewRetryLoopStalled,
} from "./run-once-turn-execution";
import {
  configuredBotReviewThreads,
  manualReviewThreads,
  mergeConflictDetected,
  pendingBotReviewThreads,
  summarizeChecks,
} from "./supervisor-reporting";
import {
  BlockedReason,
  FailureContext,
  GitHubPullRequest,
  IssueRunRecord,
  PullRequestCheck,
  ReviewThread,
  RunState,
  SupervisorConfig,
} from "./types";
import { nowIso } from "./utils";

const COPILOT_REVIEW_PROPAGATION_GRACE_MS = 5_000;
const COPILOT_REVIEWER_LOGIN = "copilot-pull-request-reviewer";

interface CopilotReviewTimeoutStatus {
  timedOut: boolean;
  action: SupervisorConfig["copilotReviewTimeoutAction"] | null;
  startedAt: string | null;
  timedOutAt: string | null;
  reason: string | null;
}

function reviewSatisfied(pr: GitHubPullRequest): boolean {
  return pr.reviewDecision !== "CHANGES_REQUESTED" && pr.reviewDecision !== "REVIEW_REQUIRED";
}

function configuredReviewBots(config: SupervisorConfig): string[] {
  return config.reviewBotLogins.map((login) => login.trim()).filter((login) => login.length > 0);
}

function repoExpectsConfiguredBotReview(config: SupervisorConfig): boolean {
  return configuredReviewBots(config).length > 0;
}

function repoUsesCopilotOnlyReviewBot(config: SupervisorConfig): boolean {
  const bots = configuredReviewBots(config);
  return bots.length === 1 && bots[0].toLowerCase() === COPILOT_REVIEWER_LOGIN;
}

function configuredReviewBotLabel(config: SupervisorConfig): string {
  const bots = configuredReviewBots(config);
  if (repoUsesCopilotOnlyReviewBot(config)) {
    return "Copilot";
  }
  if (bots.length === 1) {
    return `configured review bot (${bots[0]})`;
  }
  if (bots.length > 1) {
    return `configured review bots (${bots.join(", ")})`;
  }
  return "configured review bot";
}

function copilotReviewArrived(pr: GitHubPullRequest): boolean {
  return (pr.copilotReviewState ?? "not_requested") === "arrived" || Boolean(pr.copilotReviewArrivedAt);
}

function hasObservedCopilotRequest(
  config: SupervisorConfig,
  record: IssueRunRecord,
  pr: GitHubPullRequest,
): boolean {
  if (!repoExpectsConfiguredBotReview(config)) {
    return false;
  }

  return Boolean(record.copilot_review_requested_observed_at && record.copilot_review_requested_head_sha === pr.headRefOid);
}

function copilotReviewPending(config: SupervisorConfig, record: IssueRunRecord, pr: GitHubPullRequest): boolean {
  if (!repoExpectsConfiguredBotReview(config) || pr.isDraft || copilotReviewArrived(pr)) {
    return false;
  }

  return (pr.copilotReviewState ?? "not_requested") === "requested" || hasObservedCopilotRequest(config, record, pr);
}

function copilotReviewTimeoutStart(config: SupervisorConfig, record: IssueRunRecord, pr: GitHubPullRequest): string | null {
  if (!copilotReviewPending(config, record, pr)) {
    return null;
  }

  if (pr.copilotReviewRequestedAt) {
    return pr.copilotReviewRequestedAt;
  }

  if (record.copilot_review_requested_head_sha === pr.headRefOid) {
    return record.copilot_review_requested_observed_at;
  }

  return null;
}

function determineCopilotReviewTimeout(
  config: SupervisorConfig,
  record: IssueRunRecord,
  pr: GitHubPullRequest,
): CopilotReviewTimeoutStatus {
  if (config.copilotReviewWaitMinutes <= 0) {
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
  if (
    !repoExpectsConfiguredBotReview(config) ||
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

export function blockedReasonFromReviewState(
  config: SupervisorConfig,
  record: IssueRunRecord,
  pr: GitHubPullRequest,
  reviewThreads: ReviewThread[],
): Exclude<BlockedReason, null> | null {
  const copilotTimeout = determineCopilotReviewTimeout(config, record, pr);
  if (copilotTimeout.timedOut && copilotTimeout.action === "block") {
    return "review_bot_timeout";
  }

  if (
    manualReviewThreads(config, reviewThreads).length > 0 ||
    configuredBotReviewThreads(config, reviewThreads).length > 0
  ) {
    return "manual_review";
  }

  if (pr.reviewDecision === "CHANGES_REQUESTED" && config.humanReviewBlocksMerge) {
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
  if (!repoExpectsConfiguredBotReview(config) || pr.isDraft || copilotReviewArrived(pr)) {
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

  if (hasObservedCopilotRequest(config, record, pr)) {
    return {
      copilot_review_requested_observed_at: record.copilot_review_requested_observed_at,
      copilot_review_requested_head_sha: record.copilot_review_requested_head_sha,
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
  const botThreads = pendingBotReviewThreads(config, record, pr, reviewThreads);

  if (pr.mergedAt || pr.state === "MERGED") {
    return "done";
  }

  if (pr.reviewDecision === "CHANGES_REQUESTED") {
    if (botThreads.length > 0) {
      return "addressing_review";
    }

    if (unresolvedBotThreads.length > 0 || config.humanReviewBlocksMerge) {
      return "blocked";
    }

    return "pr_open";
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

  if (botThreads.length > 0) {
    return "addressing_review";
  }

  if (unresolvedBotThreads.length > 0) {
    return "blocked";
  }

  if (config.humanReviewBlocksMerge && manualThreads.length > 0) {
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

  const copilotTimeout = determineCopilotReviewTimeout(config, record, pr);
  if (copilotTimeout.timedOut && copilotTimeout.action === "block") {
    return "blocked";
  }

  if (shouldWaitForCopilotReviewPropagation(config, record, pr)) {
    return "waiting_ci";
  }

  if (copilotReviewPending(config, record, pr) && !copilotTimeout.timedOut) {
    return "waiting_ci";
  }

  if (mergeConditionsSatisfied(pr, checks)) {
    return "ready_to_merge";
  }

  if (checkSummary.hasPending) {
    return "waiting_ci";
  }

  return "pr_open";
}
