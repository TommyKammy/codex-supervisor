import path from "node:path";
import {
} from "./codex";
import { loadConfig } from "./config";
import { GitHubClient } from "./github";
import {
  findBlockingIssue,
  findHighRiskBlockingAmbiguity,
  lintExecutionReadyIssueBody,
  parseIssueMetadata,
} from "./issue-metadata";
import { describeGsdIntegration } from "./gsd";
import {
  issueJournalPath,
  readIssueJournal,
  summarizeIssueJournalHandoff,
} from "./journal";
import { acquireFileLock, LockHandle } from "./lock";
import {
  cleanupExpiredDoneWorkspaces,
  formatRecoveryLog,
  prependRecoveryLog,
  reconcileMergedIssueClosures,
  reconcileParentEpicClosures,
  reconcileRecoverableBlockedIssueStates,
  reconcileStaleActiveIssueReservation,
  reconcileStaleFailedIssueStates,
  reconcileTrackedMergedButOpenIssues,
} from "./recovery-reconciliation";
import {
  isRestartRunOnce,
  IssueJournalSync,
  MemoryArtifacts,
  prepareIssueExecutionContext,
  PreparedIssueExecutionContext,
} from "./run-once-issue-preparation";
import {
  CodexTurnContext,
  CodexTurnResult,
  CodexTurnShortCircuit,
  executeCodexTurnPhase,
  handlePostTurnPullRequestTransitionsPhase,
  hasProcessedReviewThread,
  loadLocalReviewRepairContext,
  localReviewBlocksMerge,
  localReviewBlocksReady,
  localReviewFailureContext,
  localReviewFailureSummary,
  localReviewHighSeverityNeedsBlock,
  localReviewHighSeverityNeedsRetry,
  localReviewRetryLoopCandidate,
  localReviewRetryLoopStalled,
  localReviewStallFailureContext,
  nextExternalReviewMissPatch,
  nextLocalReviewSignatureTracking,
  PostTurnPullRequestContext,
  PostTurnPullRequestResult,
  processedReviewThreadKey,
} from "./run-once-turn-execution";
import {
  resolveRunnableIssueContext as resolveIssueSelectionContext,
  RestartRunOnce as SelectionRestartRunOnce,
} from "./run-once-issue-selection";
import { RecoveryEvent, runOnceCyclePrelude } from "./run-once-cycle-prelude";
import { StateStore } from "./state-store";
import {
  buildDurableGuardrailStatusLine,
  configuredBotReviewThreads,
  formatDetailedStatus,
  latestReviewComment,
  manualReviewThreads,
  mergeConflictDetected,
  pendingBotReviewThreads,
  sanitizeStatusValue,
  summarizeChecks,
} from "./supervisor-reporting";
import {
  BlockedReason,
  CliOptions,
  FailureContext,
  GitHubIssue,
  GitHubPullRequest,
  IssueRunRecord,
  PullRequestCheck,
  ReviewThread,
  RunState,
  SupervisorConfig,
  SupervisorStateFile,
  WorkspaceStatus,
} from "./types";
import { nowIso, truncate, isTerminalState } from "./utils";
import {
  ensureWorkspace,
  getWorkspaceStatus,
  pushBranch,
} from "./workspace";

export {
  loadLocalReviewRepairContext,
  localReviewHighSeverityNeedsRetry,
  nextExternalReviewMissPatch,
} from "./run-once-turn-execution";
export { reconcileRecoverableBlockedIssueStates } from "./recovery-reconciliation";
export { formatDetailedStatus, summarizeChecks } from "./supervisor-reporting";

const MAX_PROCESSED_REVIEW_THREAD_IDS = 200;
const COPILOT_REVIEW_PROPAGATION_GRACE_MS = 5_000;
const COPILOT_REVIEWER_LOGIN = "copilot-pull-request-reviewer";

function trimProcessedReviewThreadIds(ids: string[]): string[] {
  if (ids.length <= MAX_PROCESSED_REVIEW_THREAD_IDS) {
    return ids;
  }

  return ids.slice(ids.length - MAX_PROCESSED_REVIEW_THREAD_IDS);
}

function buildAuthFailureContext(message: string): FailureContext {
  return {
    category: "manual",
    summary: "GitHub CLI authentication is unavailable.",
    signature: "gh-auth-unavailable",
    command: "gh auth status --hostname github.com",
    details: [message],
    url: null,
    updated_at: nowIso(),
  };
}

function formatExecutionReadyMissingFields(fields: string[]): string {
  return fields.join(", ");
}

async function handleAuthFailure(
  github: GitHubClient,
  stateStore: StateStore,
  state: SupervisorStateFile,
): Promise<string | null> {
  const auth = await github.authStatus();
  if (auth.ok) {
    return null;
  }

  if (state.activeIssueNumber !== null) {
    const activeRecord = state.issues[String(state.activeIssueNumber)];
    if (activeRecord) {
      const failureContext = buildAuthFailureContext(auth.message ?? "GitHub CLI authentication is unavailable.");
      state.issues[String(activeRecord.issue_number)] = stateStore.touch(activeRecord, {
        state: "blocked",
        last_error: truncate(auth.message ?? failureContext.summary, 1000),
        last_failure_kind: "command_error",
        last_failure_context: failureContext,
        ...applyFailureSignature(activeRecord, failureContext),
        blocked_reason: "unknown",
      });
      await stateStore.save(state);
      return `Paused issue #${activeRecord.issue_number}: GitHub auth unavailable.`;
    }
  }

  return `Skipped supervisor cycle: GitHub auth unavailable (${auth.message ?? "gh auth status failed"}).`;
}

function classifyFailure(message: string | null | undefined): "timeout" | "command_error" {
  return message?.includes("Command timed out after") ? "timeout" : "command_error";
}

export async function recoverUnexpectedCodexTurnFailure(args: {
  stateStore: StateStore;
  state: SupervisorStateFile;
  record: IssueRunRecord;
  issue: GitHubIssue;
  journalSync: (record: IssueRunRecord) => Promise<void>;
  error: unknown;
  workspaceStatus: Pick<WorkspaceStatus, "hasUncommittedChanges" | "headSha"> | null;
  pr: Pick<GitHubPullRequest, "number" | "headRefOid"> | null;
}): Promise<IssueRunRecord> {
  const { stateStore, state, record, issue, journalSync, error, workspaceStatus, pr } = args;
  const message = error instanceof Error ? error.stack ?? error.message : String(error);
  const failureKind = classifyFailure(message);
  const failureContext = buildCodexFailureContext(
    "codex",
    `Supervisor failed while recovering a Codex turn for issue #${record.issue_number}.`,
    [
      `previous_state=${record.state}`,
      `workspace_dirty=${workspaceStatus?.hasUncommittedChanges ? "yes" : "no"}`,
      `workspace_head=${workspaceStatus?.headSha ?? record.last_head_sha ?? "unknown"}`,
      `pr_number=${pr?.number ?? "none"}`,
      `pr_head=${pr?.headRefOid ?? "none"}`,
      `codex_session_id=${record.codex_session_id ?? "none"}`,
      truncate(message, 2000) ?? "Unknown failure",
    ],
  );

  const updated = stateStore.touch(record, {
    state: "failed",
    last_error: truncate(message),
    last_failure_kind: failureKind,
    last_failure_context: failureContext,
    ...applyFailureSignature(record, failureContext),
    blocked_reason: null,
    timeout_retry_count:
      failureKind === "timeout" ? record.timeout_retry_count + 1 : record.timeout_retry_count,
  });
  state.issues[String(record.issue_number)] = updated;
  if (state.activeIssueNumber === record.issue_number) {
    state.activeIssueNumber = null;
  }
  await stateStore.save(state);

  try {
    await journalSync(updated);
  } catch (journalError) {
    const journalMessage = journalError instanceof Error ? journalError.message : String(journalError);
    console.warn(
      `Failed to sync issue journal after unexpected Codex turn failure for issue #${issue.number}: ${journalMessage}`,
    );
  }

  return updated;
}

function shouldAutoRetryTimeout(record: IssueRunRecord, config: SupervisorConfig): boolean {
  return (
    record.state === "failed" &&
    record.last_failure_kind === "timeout" &&
    record.timeout_retry_count < config.timeoutRetryLimit
  );
}

function isVerificationBlockedMessage(message: string | null | undefined): boolean {
  if (!message) {
    return false;
  }

  const lower = message.toLowerCase();
  const mentionsVerification =
    lower.includes("playwright") ||
    lower.includes("e2e") ||
    lower.includes("vitest") ||
    lower.includes("test") ||
    lower.includes("assertion") ||
    lower.includes("verification");
  const mentionsFailure =
    lower.includes("fails") ||
    lower.includes("failing") ||
    lower.includes("failed") ||
    lower.includes("still failing");
  const hardBlocker =
    lower.includes("missing permissions") ||
    lower.includes("missing secrets") ||
    lower.includes("unclear requirements");

  return mentionsVerification && mentionsFailure && !hardBlocker;
}

function normalizeBlockerSignature(message: string | null | undefined): string | null {
  if (!message) {
    return null;
  }

  return message
    .toLowerCase()
    .replace(/\d{4}-\d{2}-\d{2}t\d{2}:\d{2}:\d{2}(?:\.\d+)?z/g, "<ts>")
    .replace(/#\d+/g, "#<n>")
    .replace(/\b[0-9a-f]{7,40}\b/g, "<sha>")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 1000);
}

function shouldAutoRetryBlockedVerification(record: IssueRunRecord, config: SupervisorConfig): boolean {
  return (
    record.state === "blocked" &&
    isVerificationBlockedMessage(record.last_error) &&
    hasAttemptBudgetRemaining(record, config, "implementation") &&
    record.blocked_verification_retry_count < config.blockedVerificationRetryLimit &&
    record.repeated_blocker_count < config.sameBlockerRepeatLimit &&
    record.repeated_failure_signature_count < config.sameFailureSignatureRepeatLimit
  );
}

export function shouldAutoRetryHandoffMissing(record: IssueRunRecord, config: SupervisorConfig): boolean {
  return (
    record.state === "blocked" &&
    record.blocked_reason === "handoff_missing" &&
    record.pr_number === null &&
    hasAttemptBudgetRemaining(record, config, "implementation") &&
    record.repeated_failure_signature_count < config.sameFailureSignatureRepeatLimit
  );
}

function shouldPreserveNoPrFailureTracking(record: IssueRunRecord): boolean {
  return (
    record.pr_number === null &&
    record.last_failure_context?.category === "blocked" &&
    record.last_failure_signature !== null &&
    record.repeated_failure_signature_count > 0
  );
}

type AttemptLane = "implementation" | "repair";

function attemptLane(record: IssueRunRecord, pr: GitHubPullRequest | null): AttemptLane {
  return pr !== null || record.pr_number !== null ? "repair" : "implementation";
}

function attemptBudgetForLane(config: SupervisorConfig, lane: AttemptLane): number {
  return lane === "repair" ? config.maxRepairAttemptsPerIssue : config.maxImplementationAttemptsPerIssue;
}

function attemptsUsedForLane(record: IssueRunRecord, lane: AttemptLane): number {
  return lane === "repair" ? record.repair_attempt_count : record.implementation_attempt_count;
}

function hasAttemptBudgetRemaining(
  record: IssueRunRecord,
  config: SupervisorConfig,
  lane: AttemptLane,
): boolean {
  return attemptsUsedForLane(record, lane) < attemptBudgetForLane(config, lane);
}

function shouldEnforceExecutionReady(record: Pick<IssueRunRecord, "attempt_count" | "pr_number"> | undefined | null): boolean {
  return (record?.pr_number ?? null) === null && (record?.attempt_count ?? 0) === 0;
}

function incrementAttemptCounters(
  record: IssueRunRecord,
  lane: AttemptLane,
): Pick<IssueRunRecord, "attempt_count" | "implementation_attempt_count" | "repair_attempt_count"> {
  return {
    attempt_count: record.attempt_count + 1,
    implementation_attempt_count:
      lane === "implementation" ? record.implementation_attempt_count + 1 : record.implementation_attempt_count,
    repair_attempt_count:
      lane === "repair" ? record.repair_attempt_count + 1 : record.repair_attempt_count,
  };
}

function isEligibleForSelection(record: IssueRunRecord | undefined, config: SupervisorConfig): boolean {
  if (!record) {
    return true;
  }

  if (!isTerminalState(record.state)) {
    return true;
  }

  return (
    shouldAutoRetryTimeout(record, config) ||
    shouldAutoRetryBlockedVerification(record, config) ||
    shouldAutoRetryHandoffMissing(record, config)
  );
}

function inferStateWithoutPullRequest(
  record: IssueRunRecord,
  workspaceStatus: WorkspaceStatus,
): RunState {
  const branchHasCheckpoint = workspaceStatus.baseAhead > 0 || workspaceStatus.remoteAhead > 0;
  if (record.implementation_attempt_count === 0) {
    return "reproducing";
  }

  if (branchHasCheckpoint && !workspaceStatus.hasUncommittedChanges) {
    return "draft_pr";
  }

  if (record.state === "planning" || record.state === "reproducing") {
    return "reproducing";
  }

  return "stabilizing";
}

export function buildChecksFailureContext(pr: GitHubPullRequest, checks: PullRequestCheck[]): FailureContext | null {
  const failingChecks = checks.filter((check) => check.bucket === "fail");
  if (failingChecks.length === 0) {
    return null;
  }

  return {
    category: "checks",
    summary: `PR #${pr.number} has failing checks.`,
    signature: failingChecks.map((check) => `${check.name}:${check.bucket}`).join("|"),
    command: "gh pr checks",
    details: failingChecks.map((check) => `${check.name} (${check.bucket}/${check.state}) ${check.link ?? ""}`.trim()),
    url: pr.url,
    updated_at: nowIso(),
  };
}

function buildReviewFailureContext(reviewThreads: ReviewThread[]): FailureContext | null {
  if (reviewThreads.length === 0) {
    return null;
  }

  const details = reviewThreads.slice(0, 5).map((thread) => {
    const latestComment = thread.comments.nodes[thread.comments.nodes.length - 1];
    return `${thread.path ?? "unknown"}:${thread.line ?? "?"} ${latestComment?.body.replace(/\s+/g, " ").trim() ?? ""}`;
  });

  return {
    category: "review",
    summary: `${reviewThreads.length} unresolved automated review thread(s) remain.`,
    signature: reviewThreads.map((thread) => thread.id).join("|"),
    command: null,
    details,
    url: reviewThreads[0]?.comments.nodes[0]?.url ?? null,
    updated_at: nowIso(),
  };
}

function buildManualReviewFailureContext(reviewThreads: ReviewThread[]): FailureContext | null {
  if (reviewThreads.length === 0) {
    return null;
  }

  const details = reviewThreads.slice(0, 5).map((thread) => {
    const latestComment = latestReviewComment(thread);
    const author = latestComment?.author?.login ?? "unknown";
    return `${thread.path ?? "unknown"}:${thread.line ?? "?"} reviewer=${author} ${latestComment?.body.replace(/\s+/g, " ").trim() ?? ""}`;
  });

  return {
    category: "manual",
    summary: `${reviewThreads.length} unresolved manual or unconfigured review thread(s) require human attention.`,
    signature: reviewThreads.map((thread) => `manual:${thread.id}`).join("|"),
    command: null,
    details,
    url: reviewThreads[0]?.comments.nodes[0]?.url ?? null,
    updated_at: nowIso(),
  };
}

function buildStalledBotReviewFailureContext(reviewThreads: ReviewThread[]): FailureContext | null {
  if (reviewThreads.length === 0) {
    return null;
  }

  const details = reviewThreads.slice(0, 5).map((thread) => {
    const latestComment = latestReviewComment(thread);
    const author = latestComment?.author?.login ?? "unknown";
    return `${thread.path ?? "unknown"}:${thread.line ?? "?"} reviewer=${author} ${latestComment?.body.replace(/\s+/g, " ").trim() ?? ""}`;
  });

  return {
    category: "manual",
    summary: `${reviewThreads.length} configured bot review thread(s) remain unresolved after processing and now require manual attention.`,
    signature: reviewThreads.map((thread) => `stalled-bot:${thread.id}`).join("|"),
    command: null,
    details,
    url: reviewThreads[0]?.comments.nodes[0]?.url ?? null,
    updated_at: nowIso(),
  };
}

function buildConflictFailureContext(pr: GitHubPullRequest): FailureContext {
  return {
    category: "conflict",
    summary: `PR #${pr.number} has merge conflicts and needs a base-branch integration pass.`,
    signature: `dirty:${pr.headRefOid}`,
    command: "git fetch origin && git merge origin/<default-branch>",
    details: [`mergeStateStatus=${pr.mergeStateStatus ?? "unknown"}`],
    url: pr.url,
    updated_at: nowIso(),
  };
}

function buildCodexFailureContext(
  category: FailureContext["category"],
  summary: string,
  details: string[],
): FailureContext {
  return {
    category,
    summary,
    signature: normalizeBlockerSignature(`${summary}\n${details.join("\n")}`),
    command: null,
    details,
    url: null,
    updated_at: nowIso(),
  };
}

function applyFailureSignature(record: IssueRunRecord, failureContext: FailureContext | null): Pick<IssueRunRecord, "last_failure_signature" | "repeated_failure_signature_count"> {
  const signature = failureContext?.signature ?? null;
  if (!signature) {
    return {
      last_failure_signature: null,
      repeated_failure_signature_count: 0,
    };
  }

  return {
    last_failure_signature: signature,
    repeated_failure_signature_count:
      record.last_failure_signature === signature ? record.repeated_failure_signature_count + 1 : 1,
  };
}

function shouldStopForRepeatedFailureSignature(record: IssueRunRecord, config: SupervisorConfig): boolean {
  return (
    record.last_failure_signature !== null &&
    record.repeated_failure_signature_count >= config.sameFailureSignatureRepeatLimit
  );
}

function inferFailureContext(
  config: SupervisorConfig,
  record: IssueRunRecord,
  pr: GitHubPullRequest | null,
  checks: PullRequestCheck[],
  reviewThreads: ReviewThread[],
): FailureContext | null {
  if (pr) {
    const checksContext = buildChecksFailureContext(pr, checks);
    if (checksContext) {
      return checksContext;
    }

    const copilotTimeoutContext = buildCopilotReviewTimeoutFailureContext(config, record, pr);
    if (copilotTimeoutContext) {
      return copilotTimeoutContext;
    }

    const manualReviewContext =
      config.humanReviewBlocksMerge ? buildManualReviewFailureContext(manualReviewThreads(config, reviewThreads)) : null;
    if (manualReviewContext) {
      return manualReviewContext;
    }

    const reviewContext = buildReviewFailureContext(pendingBotReviewThreads(config, record, pr, reviewThreads));
    if (reviewContext) {
      return reviewContext;
    }

    const stalledBotReviewContext = buildStalledBotReviewFailureContext(
      configuredBotReviewThreads(config, reviewThreads),
    );
    if (stalledBotReviewContext) {
      return stalledBotReviewContext;
    }

    if (mergeConflictDetected(pr)) {
      return buildConflictFailureContext(pr);
    }
  }

  return null;
}

function reviewSatisfied(pr: GitHubPullRequest): boolean {
  return pr.reviewDecision !== "CHANGES_REQUESTED" && pr.reviewDecision !== "REVIEW_REQUIRED";
}

interface CopilotReviewTimeoutStatus {
  timedOut: boolean;
  action: SupervisorConfig["copilotReviewTimeoutAction"] | null;
  startedAt: string | null;
  timedOutAt: string | null;
  reason: string | null;
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

function buildCopilotReviewTimeoutFailureContext(
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

function blockedReasonFromReviewState(
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

  return null;
}

function syncReviewWaitWindow(record: IssueRunRecord, pr: GitHubPullRequest): Partial<IssueRunRecord> {
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

function syncCopilotReviewRequestObservation(
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

function syncCopilotReviewTimeoutState(
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

interface PullRequestLifecycleSnapshot {
  recordForState: IssueRunRecord;
  nextState: RunState;
  failureContext: FailureContext | null;
  reviewWaitPatch: Partial<Pick<IssueRunRecord, "review_wait_started_at" | "review_wait_head_sha">>;
  copilotRequestObservationPatch: Partial<
    Pick<IssueRunRecord, "copilot_review_requested_observed_at" | "copilot_review_requested_head_sha">
  >;
  copilotTimeoutPatch: Pick<
    IssueRunRecord,
    "copilot_review_timed_out_at" | "copilot_review_timeout_action" | "copilot_review_timeout_reason"
  >;
}

function derivePullRequestLifecycleSnapshot(
  config: SupervisorConfig,
  record: IssueRunRecord,
  pr: GitHubPullRequest,
  checks: PullRequestCheck[],
  reviewThreads: ReviewThread[],
  recordPatch: Partial<IssueRunRecord> = {},
): PullRequestLifecycleSnapshot {
  const baseRecord = { ...record, ...recordPatch };
  const reviewWaitPatch = syncReviewWaitWindow(baseRecord, pr);
  const copilotRequestObservationPatch = syncCopilotReviewRequestObservation(config, baseRecord, pr);
  const recordForState = {
    ...baseRecord,
    ...reviewWaitPatch,
    ...copilotRequestObservationPatch,
  };
  const copilotTimeoutPatch = syncCopilotReviewTimeoutState(config, recordForState, pr);
  const finalizedRecordForState = {
    ...recordForState,
    ...copilotTimeoutPatch,
  };

  return {
    recordForState: finalizedRecordForState,
    nextState: inferStateFromPullRequest(config, finalizedRecordForState, pr, checks, reviewThreads),
    failureContext: inferFailureContext(config, finalizedRecordForState, pr, checks, reviewThreads),
    reviewWaitPatch,
    copilotRequestObservationPatch,
    copilotTimeoutPatch,
  };
}

function shouldRunCodex(
  record: IssueRunRecord,
  pr: GitHubPullRequest | null,
  checks: PullRequestCheck[],
  reviewThreads: ReviewThread[],
  config: SupervisorConfig,
): boolean {
  if (!pr) {
    return true;
  }

  const inferred = inferStateFromPullRequest(config, record, pr, checks, reviewThreads);
  return (
    inferred === "draft_pr" ||
    inferred === "repairing_ci" ||
    inferred === "resolving_conflict" ||
    inferred === "addressing_review" ||
    inferred === "implementing" ||
    inferred === "local_review_fix" ||
    inferred === "reproducing" ||
    inferred === "stabilizing"
  );
}

function isOpenPullRequest(pr: GitHubPullRequest | null): pr is GitHubPullRequest {
  return pr !== null && pr.state === "OPEN" && !pr.mergedAt;
}

async function buildReadinessSummary(
  github: GitHubClient,
  config: SupervisorConfig,
  state: SupervisorStateFile,
): Promise<string[]> {
  const issues = await github.listCandidateIssues();
  const runnable: string[] = [];
  const blocked: string[] = [];

  for (const issue of issues) {
    if (config.skipTitlePrefixes.some((prefix) => issue.title.startsWith(prefix))) {
      continue;
    }

    const existing = state.issues[String(issue.number)];
    const readiness = lintExecutionReadyIssueBody(issue);
    if (shouldEnforceExecutionReady(existing) && !readiness.isExecutionReady) {
      blocked.push(
        `#${issue.number} blocked_by=requirements:${formatExecutionReadyMissingFields(readiness.missingRequired)}`,
      );
      continue;
    }

    const clarificationBlock = findHighRiskBlockingAmbiguity(issue);
    if (clarificationBlock) {
      blocked.push(
        `#${issue.number} blocked_by=clarification:${clarificationBlock.ambiguityClasses.join("|")}:${clarificationBlock.riskyChangeClasses.join("|")}`,
      );
      continue;
    }

    const blockingIssue = findBlockingIssue(issue, issues, state);
    if (blockingIssue) {
      blocked.push(`#${issue.number} blocked_by=${blockingIssue.reason}`);
      continue;
    }

    if (!isEligibleForSelection(existing, config)) {
      blocked.push(
        `#${issue.number} blocked_by=local_state:${existing?.state ?? "unknown"}`,
      );
      continue;
    }

    runnable.push(`#${issue.number} ready=${formatRunnableReadinessReason(issue, issues, state, readiness.isExecutionReady)}`);
  }

  return [
    `runnable_issues=${runnable.length > 0 ? runnable.join(",") : "none"}`,
    `blocked_issues=${blocked.length > 0 ? blocked.join("; ") : "none"}`,
  ];
}

function formatRunnableReadinessReason(
  issue: GitHubIssue,
  issues: GitHubIssue[],
  state: SupervisorStateFile,
  isExecutionReady: boolean,
): string {
  const metadata = parseIssueMetadata(issue);
  const reasons = [isExecutionReady ? "execution_ready" : "requirements_skipped"];

  if (metadata.dependsOn.length > 0) {
    const satisfiedDependencies = metadata.dependsOn.filter(
      (dependencyNumber) => state.issues[String(dependencyNumber)]?.state === "done",
    );

    if (satisfiedDependencies.length > 0) {
      reasons.push(`depends_on_satisfied:${satisfiedDependencies.join("|")}`);
    }
  }

  if (
    metadata.parentIssueNumber !== null &&
    metadata.executionOrderIndex !== null &&
    metadata.executionOrderIndex > 1
  ) {
    const clearedPredecessors = issues
      .filter((candidate) => candidate.number !== issue.number)
      .map((candidate) => ({
        issue: candidate,
        metadata: parseIssueMetadata(candidate),
      }))
      .filter(
        ({ metadata: candidateMetadata }) =>
          candidateMetadata.parentIssueNumber === metadata.parentIssueNumber &&
          candidateMetadata.executionOrderIndex !== null &&
          candidateMetadata.executionOrderIndex < metadata.executionOrderIndex!,
      )
      .sort(
        (left, right) =>
          (left.metadata.executionOrderIndex ?? Number.MAX_SAFE_INTEGER) -
          (right.metadata.executionOrderIndex ?? Number.MAX_SAFE_INTEGER),
      )
      .map(({ issue: predecessorIssue }) => predecessorIssue.number)
      .filter((predecessorNumber) => state.issues[String(predecessorNumber)]?.state === "done");

    if (clearedPredecessors.length > 0) {
      reasons.push(`execution_order_satisfied:${clearedPredecessors.join("|")}`);
    }
  }

  return reasons.join("+");
}

interface ReadyIssueContext {
  kind: "ready";
  record: IssueRunRecord;
  issue: GitHubIssue;
  issueLock: LockHandle;
}

async function ensureRecordJournalContext(
  config: SupervisorConfig,
  record: IssueRunRecord,
): Promise<Pick<IssueRunRecord, "workspace" | "journal_path">> {
  if (record.journal_path) {
    return {
      workspace: record.workspace,
      journal_path: record.journal_path,
    };
  }

  const workspace = await ensureWorkspace(config, record.issue_number, record.branch);
  return {
    workspace,
    journal_path: issueJournalPath(workspace, config.issueJournalRelativePath),
  };
}

interface PreparedIssueRunContext extends PreparedIssueExecutionContext {
  state: SupervisorStateFile;
  options: Pick<CliOptions, "dryRun">;
  recoveryLog: string | null;
}

interface RunOnceCycleContext {
  state: SupervisorStateFile;
  recoveryEvents: RecoveryEvent[];
  recoveryLog: string | null;
}

interface RunOnceIssuePhaseContext extends RunOnceCycleContext {
  record: IssueRunRecord | null;
  options: Pick<CliOptions, "dryRun">;
}

interface RunOnceContinue {
  kind: "restart";
  carryoverRecoveryEvents: RecoveryEvent[];
}

interface RunOnceReturn {
  kind: "return";
  message: string;
}

function formatStatus(record: IssueRunRecord | null): string {
  if (!record) {
    return "No active issue.";
  }

  return [
    `issue=#${record.issue_number}`,
    `state=${record.state}`,
    `branch=${record.branch}`,
    `pr=${record.pr_number ?? "none"}`,
    `attempts=${record.attempt_count} impl=${record.implementation_attempt_count} repair=${record.repair_attempt_count}`,
    `workspace=${record.workspace}`,
  ].join(" ");
}

export class Supervisor {
  private readonly github: GitHubClient;
  private readonly stateStore: StateStore;

  constructor(public readonly config: SupervisorConfig) {
    this.github = new GitHubClient(config);
    this.stateStore = new StateStore(config.stateFile, {
      backend: config.stateBackend,
      bootstrapFilePath: config.stateBootstrapFile,
    });
  }

  static fromConfig(configPath?: string): Supervisor {
    return new Supervisor(loadConfig(configPath));
  }

  pollIntervalMs(): number {
    return this.config.pollIntervalSeconds * 1000;
  }

  private lockPath(kind: "issues" | "sessions" | "supervisor", key: string): string {
    const safeKey = key.replace(/[^a-zA-Z0-9._-]/g, "_");
    return path.resolve(path.dirname(this.config.stateFile), "locks", kind, `${safeKey}.lock`);
  }

  private async resolveRunnableIssueContext(
    state: SupervisorStateFile,
    currentRecord: IssueRunRecord | null,
  ): Promise<ReadyIssueContext | SelectionRestartRunOnce | string> {
    const runnableIssue = await resolveIssueSelectionContext({
      github: this.github,
      config: this.config,
      stateStore: this.stateStore,
      state,
      currentRecord,
      acquireIssueLock: (record) =>
        acquireFileLock(
          this.lockPath("issues", `issue-${record.issue_number}`),
          `issue-${record.issue_number}`,
        ),
      ensureRecordJournalContext: (record) => ensureRecordJournalContext(this.config, record),
    });
    if (typeof runnableIssue === "string") {
      return runnableIssue;
    }
    if (runnableIssue.kind === "restart") {
      return runnableIssue;
    }

    let { record, issue, issueLock } = runnableIssue;
    const budgetLaneBeforeWorkspace = attemptLane(record, null);
    if (!hasAttemptBudgetRemaining(record, this.config, budgetLaneBeforeWorkspace)) {
      try {
        const used = attemptsUsedForLane(record, budgetLaneBeforeWorkspace);
        const max = attemptBudgetForLane(this.config, budgetLaneBeforeWorkspace);
        const failureContext = buildCodexFailureContext(
          "manual",
          `Issue #${record.issue_number} exhausted its ${budgetLaneBeforeWorkspace} Codex attempt budget.`,
          [
            `attempt_lane=${budgetLaneBeforeWorkspace}`,
            `attempts=${used}`,
            `max=${max}`,
            `total_attempts=${record.attempt_count}`,
          ],
        );
        record = this.stateStore.touch(record, {
          state: "failed",
          last_failure_kind: "command_error",
          last_error:
            `Reached max ${budgetLaneBeforeWorkspace} Codex attempts for issue #${record.issue_number} ` +
            `(${used}/${max}).`,
          last_failure_context: failureContext,
          ...applyFailureSignature(record, failureContext),
          blocked_reason: null,
        });
        state.issues[String(record.issue_number)] = record;
        state.activeIssueNumber = null;
        await this.stateStore.save(state);
        return `Issue #${record.issue_number} reached max ${budgetLaneBeforeWorkspace} Codex attempts.`;
      } finally {
        await issueLock.release();
      }
    }

    return {
      kind: "ready",
      record,
      issue,
      issueLock,
    };
  }

  private async executeCodexTurn(context: CodexTurnContext): Promise<CodexTurnResult | CodexTurnShortCircuit> {
    let { state, record, pr, checks, reviewThreads, workspaceStatus, syncJournal, options } = context;
    const nextState = pr
      ? inferStateFromPullRequest(this.config, record, pr, checks, reviewThreads)
      : inferStateWithoutPullRequest(record, workspaceStatus);

    if (options.dryRun) {
      record = this.stateStore.touch(record, { state: nextState });
      state.issues[String(record.issue_number)] = record;
      await this.stateStore.save(state);
      return {
        kind: "returned",
        message: `Dry run: would invoke Codex for issue #${record.issue_number}. ${formatStatus(record)}`,
      };
    }

    const sessionLock = record.codex_session_id
      ? await acquireFileLock(
          this.lockPath("sessions", `session-${record.codex_session_id}`),
          `session-${record.codex_session_id}`,
        )
      : null;
    if (sessionLock && !sessionLock.acquired) {
      return {
        kind: "returned",
        message: `Skipped issue #${record.issue_number}: ${sessionLock.reason}.`,
      };
    }

    try {
      const preRunAttemptLane = attemptLane(record, pr);
      record = this.stateStore.touch(record, {
        state: nextState,
        ...incrementAttemptCounters(record, preRunAttemptLane),
        last_failure_context: inferFailureContext(this.config, record, pr, checks, reviewThreads),
        blocked_reason: null,
      });
      state.issues[String(record.issue_number)] = record;
      await this.stateStore.save(state);
      await syncJournal(record);

      const reviewThreadsToProcess = pr ? pendingBotReviewThreads(this.config, record, pr, reviewThreads) : [];
      return executeCodexTurnPhase({
        config: this.config,
        stateStore: this.stateStore,
        github: this.github,
        context: {
          ...context,
          record,
          reviewThreads: reviewThreadsToProcess,
        },
        sessionLock,
        acquireSessionLock: async (sessionId) => acquireFileLock(
          this.lockPath("sessions", `session-${sessionId}`),
          `session-${sessionId}`,
        ),
        classifyFailure,
        buildCodexFailureContext,
        applyFailureSignature,
        normalizeBlockerSignature,
        isVerificationBlockedMessage,
        derivePullRequestLifecycleSnapshot: (phaseRecord, phasePr, phaseChecks, phaseReviewThreads, recordPatch = {}) =>
          derivePullRequestLifecycleSnapshot(
            this.config,
            phaseRecord,
            phasePr,
            phaseChecks,
            phaseReviewThreads,
            recordPatch,
          ),
        inferStateWithoutPullRequest,
        blockedReasonFromReviewState: (phaseRecord, phasePr, phaseReviewThreads) =>
          blockedReasonFromReviewState(this.config, phaseRecord, phasePr, phaseReviewThreads),
        recoverUnexpectedCodexTurnFailure: (args) =>
          recoverUnexpectedCodexTurnFailure({
            ...args,
            stateStore: this.stateStore,
          }),
      });
    } catch (error) {
      await sessionLock?.release();
      throw error;
    }
  }

  private async runPreparedIssue(context: PreparedIssueRunContext): Promise<string> {
    const {
      state,
      issue,
      previousCodexSummary,
      previousError,
      workspacePath,
      journalPath,
      syncJournal,
      memoryArtifacts,
      options,
      recoveryLog,
    } = context;
    let record = context.record;
    let workspaceStatus = context.workspaceStatus;
    let pr = context.pr;
    let checks = context.checks;
    let reviewThreads = context.reviewThreads;

    if (pr) {
      const lifecycle = derivePullRequestLifecycleSnapshot(this.config, record, pr, checks, reviewThreads);
      record = this.stateStore.touch(record, {
        pr_number: pr.number,
        state: lifecycle.nextState,
        ...lifecycle.reviewWaitPatch,
        ...lifecycle.copilotRequestObservationPatch,
        ...lifecycle.copilotTimeoutPatch,
        last_error:
          lifecycle.nextState === "blocked" && lifecycle.failureContext
            ? truncate(lifecycle.failureContext.summary, 1000)
            : record.last_error,
        last_failure_context: lifecycle.failureContext,
        ...applyFailureSignature(record, lifecycle.failureContext),
        blocked_reason:
          lifecycle.nextState === "blocked"
            ? blockedReasonFromReviewState(this.config, lifecycle.recordForState, pr, reviewThreads)
            : null,
      });

      if (lifecycle.failureContext && shouldStopForRepeatedFailureSignature(record, this.config)) {
        record = this.stateStore.touch(record, {
          state: "failed",
          last_error:
            `Repeated identical failure signature ${record.repeated_failure_signature_count} times: ` +
            `${record.last_failure_signature ?? "unknown"}`,
          last_failure_kind: "command_error",
          blocked_reason: null,
        });
        state.issues[String(record.issue_number)] = record;
        state.activeIssueNumber = null;
        await this.stateStore.save(state);
        await syncJournal(record);
        return prependRecoveryLog(
          `Issue #${record.issue_number} stopped after repeated identical failure signatures.`,
          recoveryLog,
        );
      }
    } else {
      const preserveFailureTracking = shouldPreserveNoPrFailureTracking(record);
      record = this.stateStore.touch(record, {
        state: inferStateWithoutPullRequest(record, workspaceStatus),
        copilot_review_requested_observed_at: null,
        copilot_review_requested_head_sha: null,
        copilot_review_timed_out_at: null,
        copilot_review_timeout_action: null,
        copilot_review_timeout_reason: null,
        last_failure_context: preserveFailureTracking ? record.last_failure_context : null,
        last_failure_signature: preserveFailureTracking ? record.last_failure_signature : null,
        repeated_failure_signature_count: preserveFailureTracking ? record.repeated_failure_signature_count : 0,
        blocked_reason: null,
      });
    }
    state.issues[String(record.issue_number)] = record;
    await this.stateStore.save(state);
    await syncJournal(record);

    if (shouldRunCodex(record, pr, checks, reviewThreads, this.config)) {
      const codexTurn = await this.executeCodexTurn({
        state,
        record,
        issue,
        previousCodexSummary,
        previousError,
        workspacePath,
        journalPath,
        syncJournal,
        memoryArtifacts,
        workspaceStatus,
        pr,
        checks,
        reviewThreads,
        options,
      });
      if (codexTurn.kind === "returned") {
        return prependRecoveryLog(codexTurn.message, recoveryLog);
      }

      record = codexTurn.record;
      workspaceStatus = codexTurn.workspaceStatus;
      pr = codexTurn.pr;
      checks = codexTurn.checks;
      reviewThreads = codexTurn.reviewThreads;
    }

    if (pr) {
      const postTurn = await this.handlePostTurnPullRequestTransitions({
        state,
        record,
        issue,
        workspacePath,
        syncJournal,
        memoryArtifacts,
        pr,
        options,
      });
      record = await this.handlePostTurnMergeAndCompletion(state, postTurn.record, postTurn.pr, options);
      await syncJournal(record);
      return prependRecoveryLog(formatStatus(record), recoveryLog);
    }

    state.issues[String(record.issue_number)] = record;
    await this.stateStore.save(state);
    await syncJournal(record);
    return prependRecoveryLog(formatStatus(record), recoveryLog);
  }

  private async loadOpenPullRequestSnapshot(prNumber: number): Promise<{
    pr: GitHubPullRequest;
    checks: PullRequestCheck[];
    reviewThreads: ReviewThread[];
  }> {
    const pr = await this.github.getPullRequest(prNumber);
    const checks = await this.github.getChecks(prNumber);
    const reviewThreads = await this.github.getUnresolvedReviewThreads(prNumber);
    return { pr, checks, reviewThreads };
  }

  private async handlePostTurnPullRequestTransitions(
    context: PostTurnPullRequestContext,
  ): Promise<PostTurnPullRequestResult> {
    return handlePostTurnPullRequestTransitionsPhase({
      config: this.config,
      stateStore: this.stateStore,
      github: this.github,
      context,
      derivePullRequestLifecycleSnapshot: (record, pr, checks, reviewThreads, recordPatch = {}) =>
        derivePullRequestLifecycleSnapshot(this.config, record, pr, checks, reviewThreads, recordPatch),
      applyFailureSignature,
      blockedReasonFromReviewState: (record, pr, reviewThreads) =>
        blockedReasonFromReviewState(this.config, record, pr, reviewThreads),
      summarizeChecks,
      configuredBotReviewThreads,
      manualReviewThreads,
      mergeConflictDetected,
      loadOpenPullRequestSnapshot: (prNumber) => this.loadOpenPullRequestSnapshot(prNumber),
    });
  }

  private async handlePostTurnMergeAndCompletion(
    state: SupervisorStateFile,
    record: IssueRunRecord,
    pr: GitHubPullRequest,
    options: Pick<CliOptions, "dryRun">,
  ): Promise<IssueRunRecord> {
    let nextRecord = record;

    if (nextRecord.state === "ready_to_merge" && !options.dryRun) {
      await this.github.enableAutoMerge(pr.number, pr.headRefOid);
      nextRecord = this.stateStore.touch(nextRecord, { state: "merging" });
      state.issues[String(nextRecord.issue_number)] = nextRecord;
    }

    if (nextRecord.state === "done") {
      state.activeIssueNumber = null;
    }

    state.issues[String(nextRecord.issue_number)] = nextRecord;
    await this.stateStore.save(state);
    return nextRecord;
  }

  async acquireSupervisorLock(label: "loop" | "run-once"): Promise<LockHandle> {
    return acquireFileLock(this.lockPath("supervisor", "run"), `supervisor-${label}`);
  }

  async status(): Promise<string> {
    const state = await this.stateStore.load();
    const gsdSummary = await describeGsdIntegration(this.config);
    const activeRecord =
      state.activeIssueNumber !== null ? state.issues[String(state.activeIssueNumber)] ?? null : null;
    let latestRecord: IssueRunRecord | null = null;
    let latestRecoveryRecord: IssueRunRecord | null = null;
    for (const record of Object.values(state.issues)) {
      if (latestRecord === null || record.updated_at.localeCompare(latestRecord.updated_at) > 0) {
        latestRecord = record;
      }
      if (
        record.last_recovery_reason &&
        record.last_recovery_at &&
        (latestRecoveryRecord === null ||
          record.last_recovery_at.localeCompare(latestRecoveryRecord.last_recovery_at ?? "") > 0)
      ) {
        latestRecoveryRecord = record;
      }
    }

    if (!activeRecord) {
      const baseStatus = formatDetailedStatus({
        config: this.config,
        activeRecord: null,
        latestRecord,
        latestRecoveryRecord,
        trackedIssueCount: Object.keys(state.issues).length,
        pr: null,
        checks: [],
        reviewThreads: [],
      });
      try {
        const readinessLines = await buildReadinessSummary(this.github, this.config, state);
        return [gsdSummary, `${baseStatus}\n${readinessLines.join("\n")}`]
          .filter(Boolean)
          .join("\n");
      } catch (error) {
        const message = sanitizeStatusValue(error instanceof Error ? error.message : String(error));
        return [gsdSummary, `${baseStatus}\nreadiness_warning=${truncate(message, 200)}`]
          .filter(Boolean)
          .join("\n");
      }
    }

    let pr: GitHubPullRequest | null = null;
    let checks: PullRequestCheck[] = [];
    let reviewThreads: ReviewThread[] = [];
    let handoffSummary: string | null = null;
    let durableGuardrailSummary: string | null = null;

    try {
      if (activeRecord.journal_path) {
        handoffSummary = summarizeIssueJournalHandoff(await readIssueJournal(activeRecord.journal_path));
      }
      pr = await this.github.resolvePullRequestForBranch(activeRecord.branch, activeRecord.pr_number);
      if (isOpenPullRequest(pr)) {
        checks = await this.github.getChecks(pr.number);
        reviewThreads = await this.github.getUnresolvedReviewThreads(pr.number);
      }
      durableGuardrailSummary = await buildDurableGuardrailStatusLine({
        config: this.config,
        activeRecord,
        pr,
      });
    } catch (error) {
      const message = sanitizeStatusValue(error instanceof Error ? error.message : String(error));
      return [gsdSummary, `${formatDetailedStatus({
        config: this.config,
        activeRecord,
        latestRecord,
        latestRecoveryRecord,
        trackedIssueCount: Object.keys(state.issues).length,
        pr,
        checks,
        reviewThreads,
        handoffSummary,
        durableGuardrailSummary,
      })}\nstatus_warning=${truncate(message, 200)}`]
        .filter(Boolean)
        .join("\n");
    }

    return [gsdSummary, formatDetailedStatus({
      config: this.config,
      activeRecord,
      latestRecord,
      latestRecoveryRecord,
      trackedIssueCount: Object.keys(state.issues).length,
      pr,
      checks,
      reviewThreads,
      handoffSummary,
      durableGuardrailSummary,
    })]
      .filter(Boolean)
      .join("\n");
  }

  async runOnce(options: Pick<CliOptions, "dryRun">): Promise<string> {
    let carryoverRecoveryEvents: RecoveryEvent[] = [];
    for (;;) {
      const cycle = await this.startRunOnceCycle(carryoverRecoveryEvents);
      if (typeof cycle === "string") {
        return cycle;
      }
      carryoverRecoveryEvents = [];

      const record = await this.normalizeActiveIssueRecordForExecution(cycle.state);
      const result = await this.runOnceIssuePhase({
        ...cycle,
        record,
        options,
      });
      if (result.kind === "restart") {
        carryoverRecoveryEvents = result.carryoverRecoveryEvents;
        continue;
      }

      return result.message;
    }
  }

  private async startRunOnceCycle(carryoverRecoveryEvents: RecoveryEvent[]): Promise<RunOnceCycleContext | string> {
    const prelude = await runOnceCyclePrelude({
      stateStore: this.stateStore,
      carryoverRecoveryEvents,
      reconcileStaleActiveIssueReservation: (state) => reconcileStaleActiveIssueReservation({
        stateStore: this.stateStore,
        state,
        issueLockPath: (issueNumber) => this.lockPath("issues", `issue-${issueNumber}`),
        sessionLockPath: (sessionId) => this.lockPath("sessions", `session-${sessionId}`),
      }),
      handleAuthFailure: (state) => handleAuthFailure(this.github, this.stateStore, state),
      listAllIssues: () => this.github.listAllIssues(),
      reconcileTrackedMergedButOpenIssues: (state, issues) =>
        reconcileTrackedMergedButOpenIssues(this.github, this.stateStore, state, issues),
      reconcileMergedIssueClosures: (state, issues) =>
        reconcileMergedIssueClosures(this.github, this.stateStore, state, issues),
      reconcileStaleFailedIssueStates: (state, issues) =>
        reconcileStaleFailedIssueStates(this.github, this.stateStore, state, this.config, issues, {
          inferStateFromPullRequest,
          isOpenPullRequest,
          syncReviewWaitWindow,
          syncCopilotReviewRequestObservation,
          syncCopilotReviewTimeoutState,
        }),
      reconcileRecoverableBlockedIssueStates: (state, issues) =>
        reconcileRecoverableBlockedIssueStates(this.stateStore, state, this.config, issues, {
          shouldAutoRetryHandoffMissing,
        }),
      reconcileParentEpicClosures: (state, issues) =>
        reconcileParentEpicClosures(this.github, this.stateStore, state, issues),
      cleanupExpiredDoneWorkspaces: (state) => cleanupExpiredDoneWorkspaces(this.config, state),
    });
    if ("kind" in prelude) {
      return prependRecoveryLog(prelude.message, formatRecoveryLog(prelude.recoveryEvents));
    }

    return {
      state: prelude.state,
      recoveryEvents: prelude.recoveryEvents,
      recoveryLog: formatRecoveryLog(prelude.recoveryEvents),
    };
  }

  private async normalizeActiveIssueRecordForExecution(state: SupervisorStateFile): Promise<IssueRunRecord | null> {
    let record =
      state.activeIssueNumber !== null ? state.issues[String(state.activeIssueNumber)] ?? null : null;

    if (record && shouldAutoRetryTimeout(record, this.config)) {
      record = this.stateStore.touch(record, {
        state: "queued",
        last_error: `Auto-retrying after timeout (${record.timeout_retry_count}/${this.config.timeoutRetryLimit}).`,
        blocked_reason: null,
      });
      state.issues[String(record.issue_number)] = record;
      await this.stateStore.save(state);
    }

    if (record && shouldAutoRetryBlockedVerification(record, this.config)) {
      record = this.stateStore.touch(record, {
        state: "queued",
        blocked_verification_retry_count: record.blocked_verification_retry_count + 1,
        last_error:
          `Auto-retrying after verification failure (` +
          `${record.blocked_verification_retry_count + 1}/${this.config.blockedVerificationRetryLimit}). ` +
          `Previous blocker: ${truncate(record.last_error, 1000) ?? "n/a"}`,
        blocked_reason: "verification",
      });
      state.issues[String(record.issue_number)] = record;
      await this.stateStore.save(state);
    }

    return record;
  }

  private async runOnceIssuePhase(context: RunOnceIssuePhaseContext): Promise<RunOnceContinue | RunOnceReturn> {
    const { state, record, options, recoveryEvents, recoveryLog } = context;
    const runnableIssue = await this.resolveRunnableIssueContext(state, record);
    if (typeof runnableIssue === "string") {
      return {
        kind: "return",
        message: prependRecoveryLog(runnableIssue, recoveryLog),
      };
    }
    if (runnableIssue.kind === "restart") {
      return {
        kind: "restart",
        carryoverRecoveryEvents: recoveryEvents,
      };
    }

    try {
      const issue = runnableIssue.issue;
      const preparedIssue = await prepareIssueExecutionContext({
        github: this.github,
        config: this.config,
        stateStore: this.stateStore,
        state,
        record: runnableIssue.record,
        issue,
        options,
      });
      if (typeof preparedIssue === "string") {
        return {
          kind: "return",
          message: prependRecoveryLog(preparedIssue, recoveryLog),
        };
      }
      if (isRestartRunOnce(preparedIssue)) {
        return {
          kind: "restart",
          carryoverRecoveryEvents: [...recoveryEvents, ...(preparedIssue.recoveryEvents ?? [])],
        };
      }

      return {
        kind: "return",
        message: await this.runPreparedIssue({
          ...preparedIssue,
          state,
          options,
          recoveryLog,
        }),
      };
    } finally {
      await runnableIssue.issueLock.release();
    }
  }
}
