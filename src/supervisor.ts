import fs from "node:fs";
import path from "node:path";
import { runCommand } from "./command";
import {
  compareExternalReviewPatterns,
  EXTERNAL_REVIEW_GUARDRAILS_PATH,
  loadCommittedExternalReviewGuardrails,
  VERIFIER_GUARDRAILS_PATH,
} from "./committed-guardrails";
import {
} from "./codex";
import { loadConfig } from "./config";
import { loadRelevantExternalReviewMissPatterns } from "./external-review-misses";
import { GitHubClient } from "./github";
import {
  findBlockingIssue,
  findHighRiskBlockingAmbiguity,
  findParentIssuesReadyToClose,
  lintExecutionReadyIssueBody,
  parseIssueMetadata,
} from "./issue-metadata";
import { describeGsdIntegration } from "./gsd";
import {
  issueJournalPath,
  readIssueJournal,
  summarizeIssueJournalHandoff,
} from "./journal";
import { acquireFileLock, inspectFileLock, LockHandle } from "./lock";
import { reviewDir } from "./local-review-artifacts";
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
} from "./run-once-turn-execution";
import {
  resolveRunnableIssueContext as resolveIssueSelectionContext,
  RestartRunOnce as SelectionRestartRunOnce,
} from "./run-once-issue-selection";
import { RecoveryEvent, runOnceCyclePrelude } from "./run-once-cycle-prelude";
import { StateStore } from "./state-store";
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
import { nowIso, truncate, isTerminalState, hoursSince } from "./utils";
import { loadRelevantVerifierGuardrails } from "./verifier-guardrails";
import {
  branchNameForIssue,
  cleanupWorkspace,
  ensureWorkspace,
  getWorkspaceStatus,
  isSafeCleanupTarget,
  pushBranch,
} from "./workspace";

export {
  loadLocalReviewRepairContext,
  localReviewHighSeverityNeedsRetry,
  nextExternalReviewMissPatch,
} from "./run-once-turn-execution";

const MAX_PROCESSED_REVIEW_THREAD_IDS = 200;
const COPILOT_REVIEW_PROPAGATION_GRACE_MS = 5_000;
const COPILOT_REVIEWER_LOGIN = "copilot-pull-request-reviewer";
const OWNER_GUARDED_ACTIVE_STATES = new Set<RunState>([
  "planning",
  "reproducing",
  "implementing",
  "local_review_fix",
  "stabilizing",
  "repairing_ci",
  "resolving_conflict",
  "addressing_review",
]);

function trimProcessedReviewThreadIds(ids: string[]): string[] {
  if (ids.length <= MAX_PROCESSED_REVIEW_THREAD_IDS) {
    return ids;
  }

  return ids.slice(ids.length - MAX_PROCESSED_REVIEW_THREAD_IDS);
}

function processedReviewThreadKey(threadId: string, headSha: string): string {
  return `${threadId}@${headSha}`;
}

function hasProcessedReviewThread(
  record: Pick<IssueRunRecord, "processed_review_thread_ids" | "last_head_sha">,
  pr: Pick<GitHubPullRequest, "headRefOid">,
  threadId: string,
): boolean {
  const processedKeys = record.processed_review_thread_ids ?? [];
  if (processedKeys.includes(processedReviewThreadKey(threadId, pr.headRefOid))) {
    return true;
  }

  return record.last_head_sha === pr.headRefOid && processedKeys.includes(threadId);
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

async function cleanupRecordWorkspace(config: SupervisorConfig, record: IssueRunRecord): Promise<void> {
  if (!isSafeCleanupTarget(config, record.workspace, record.branch)) {
    console.warn(
      `Skipped unsafe cleanup target workspace=${record.workspace} branch=${record.branch} for issue #${record.issue_number}.`,
    );
    return;
  }

  await cleanupWorkspace(config.repoPath, record.workspace, record.branch);
}

function parseIssueNumberFromWorkspaceName(workspaceName: string): number | null {
  const match = /^issue-([1-9]\d*)$/.exec(workspaceName);
  if (!match) {
    return null;
  }

  return Number.parseInt(match[1], 10);
}

async function cleanupOrphanedIssueWorkspaces(
  config: SupervisorConfig,
  state: SupervisorStateFile,
): Promise<RecoveryEvent[]> {
  const referencedWorkspaces = new Set(
    Object.values(state.issues).map((record) => path.resolve(record.workspace)),
  );
  const recoveryEvents: RecoveryEvent[] = [];
  let workspaceEntries: fs.Dirent[];
  try {
    workspaceEntries = fs.readdirSync(config.workspaceRoot, { withFileTypes: true });
  } catch (error) {
    const maybeErr = error as NodeJS.ErrnoException;
    if (maybeErr.code !== "ENOENT") {
      console.warn(
        `Skipped orphaned workspace cleanup: unable to read workspace root ${config.workspaceRoot} (${maybeErr.message}).`,
      );
    }
    return recoveryEvents;
  }

  for (const entry of workspaceEntries) {
    if (!entry.isDirectory()) {
      continue;
    }

    const issueNumber = parseIssueNumberFromWorkspaceName(entry.name);
    if (issueNumber === null) {
      continue;
    }

    const workspacePath = path.join(config.workspaceRoot, entry.name);
    if (referencedWorkspaces.has(path.resolve(workspacePath))) {
      continue;
    }

    if (!fs.existsSync(path.join(workspacePath, ".git"))) {
      continue;
    }

    let branch: string;
    try {
      branch = branchNameForIssue(config, issueNumber);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`Skipped orphaned workspace cleanup for ${workspacePath}: ${message}`);
      continue;
    }

    if (!isSafeCleanupTarget(config, workspacePath, branch)) {
      console.warn(`Skipped unsafe orphaned workspace cleanup target workspace=${workspacePath} branch=${branch}.`);
      continue;
    }

    await cleanupWorkspace(config.repoPath, workspacePath, branch);
    recoveryEvents.push(buildRecoveryEvent(issueNumber, `pruned orphaned worktree ${entry.name}`));
  }

  return recoveryEvents;
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

export function summarizeChecks(checks: PullRequestCheck[]): { allPassing: boolean; hasPending: boolean; hasFailing: boolean } {
  if (checks.length === 0) {
    return { allPassing: true, hasPending: false, hasFailing: false };
  }

  let allPassing = true;
  let hasPending = false;
  let hasFailing = false;

  for (const check of checks) {
    if (check.bucket === "pending" || check.bucket === "cancel") {
      hasPending = true;
      allPassing = false;
    } else if (check.bucket === "fail") {
      hasFailing = true;
      allPassing = false;
    } else if (check.bucket !== "pass" && check.bucket !== "skipping") {
      allPassing = false;
    }
  }

  return { allPassing, hasPending, hasFailing };
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

function latestReviewComment(thread: ReviewThread) {
  return thread.comments.nodes[thread.comments.nodes.length - 1] ?? null;
}

function isAllowedReviewBotThread(config: SupervisorConfig, thread: ReviewThread): boolean {
  return thread.comments.nodes.some((comment) => {
    const login = comment.author?.login?.toLowerCase();
    return Boolean(login && config.reviewBotLogins.includes(login));
  });
}

function manualReviewThreads(config: SupervisorConfig, reviewThreads: ReviewThread[]): ReviewThread[] {
  return reviewThreads.filter((thread) => !isAllowedReviewBotThread(config, thread));
}

function configuredBotReviewThreads(
  config: SupervisorConfig,
  reviewThreads: ReviewThread[],
): ReviewThread[] {
  return reviewThreads.filter((thread) => isAllowedReviewBotThread(config, thread));
}

function pendingBotReviewThreads(
  config: SupervisorConfig,
  record: Pick<IssueRunRecord, "processed_review_thread_ids" | "last_head_sha">,
  pr: Pick<GitHubPullRequest, "headRefOid">,
  reviewThreads: ReviewThread[],
): ReviewThread[] {
  return configuredBotReviewThreads(config, reviewThreads).filter(
    (thread) => !hasProcessedReviewThread(record, pr, thread.id),
  );
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

function mergeConflictDetected(pr: GitHubPullRequest): boolean {
  return pr.mergeStateStatus === "DIRTY";
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

function configuredReviewStatusLabel(config: SupervisorConfig): string {
  return !repoExpectsConfiguredBotReview(config) || repoUsesCopilotOnlyReviewBot(config)
    ? "copilot_review"
    : "configured_bot_review";
}

type ReviewBotProfileId = "none" | "copilot" | "codex" | "coderabbit" | "custom";

interface ReviewBotProfileSummary {
  profile: ReviewBotProfileId;
  provider: string;
  reviewers: string[];
  signalSource: string;
}

interface ReviewBotDiagnostics {
  status: string;
  observedReview: string;
  nextCheck: string;
}

function inferReviewBotProfile(config: SupervisorConfig): ReviewBotProfileSummary {
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

function summarizeObservedReviewSignal(
  config: SupervisorConfig,
  activeRecord: IssueRunRecord,
  pr: GitHubPullRequest,
  reviewThreads: ReviewThread[],
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

function reviewBotDiagnostics(
  config: SupervisorConfig,
  activeRecord: IssueRunRecord,
  pr: GitHubPullRequest,
  reviewThreads: ReviewThread[],
): ReviewBotDiagnostics {
  if (!repoExpectsConfiguredBotReview(config)) {
    return {
      status: "disabled",
      observedReview: "none",
      nextCheck: "none",
    };
  }

  const observed = summarizeObservedReviewSignal(config, activeRecord, pr, reviewThreads);
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

function buildRecoveryEvent(issueNumber: number, reason: string): RecoveryEvent {
  return {
    issueNumber,
    reason,
    at: nowIso(),
  };
}

function applyRecoveryEvent(
  patch: Partial<IssueRunRecord>,
  recoveryEvent: RecoveryEvent,
): Partial<IssueRunRecord> {
  return {
    ...patch,
    last_recovery_reason: recoveryEvent.reason,
    last_recovery_at: recoveryEvent.at,
  };
}

function formatRecoveryLog(events: RecoveryEvent[]): string | null {
  if (events.length === 0) {
    return null;
  }

  return [...events]
    .sort((left, right) => left.issueNumber - right.issueNumber || left.reason.localeCompare(right.reason))
    .map((event) => `recovery issue=#${event.issueNumber} reason=${sanitizeStatusValue(event.reason)}`)
    .join("; ");
}

function prependRecoveryLog(message: string, recoveryLog: string | null): string {
  return recoveryLog ? `${recoveryLog}; ${message}` : message;
}

function sanitizeStatusValue(value: string | null | undefined): string | null {
  if (!value) {
    return null;
  }

  return value.replace(/\r?\n/g, "\\n");
}

function displayStatusArtifactPath(config: SupervisorConfig, filePath: string): string {
  const relativePath = path.relative(config.localReviewArtifactDir, filePath);
  return relativePath && !relativePath.startsWith("..") && !path.isAbsolute(relativePath)
    ? relativePath
    : path.basename(filePath);
}

async function loadStatusChangedFiles(config: SupervisorConfig, workspacePath: string): Promise<string[]> {
  let result;
  try {
    result = await runCommand(
      "git",
      ["diff", "--name-only", `origin/${config.defaultBranch}...HEAD`],
      {
        cwd: workspacePath,
        env: process.env,
      },
    );
  } catch {
    return [];
  }

  return [...new Set(
    result.stdout
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0),
  )].sort();
}

async function buildDurableGuardrailStatusLine(args: {
  config: SupervisorConfig;
  activeRecord: Pick<IssueRunRecord, "branch" | "issue_number" | "last_head_sha" | "workspace">;
  pr: Pick<GitHubPullRequest, "headRefOid"> | null;
}): Promise<string | null> {
  const changedFiles = await loadStatusChangedFiles(args.config, args.activeRecord.workspace);
  if (changedFiles.length === 0) {
    return null;
  }

  const changedFileSet = new Set(changedFiles);
  const verifierGuardrails = await loadRelevantVerifierGuardrails({
    workspacePath: args.activeRecord.workspace,
    changedFiles,
    limit: 3,
  });
  const committedExternalReviewPatterns = (await loadCommittedExternalReviewGuardrails(args.activeRecord.workspace))
    .filter((pattern) => changedFileSet.has(pattern.file))
    .sort(compareExternalReviewPatterns);
  const runtimeExternalReviewPatterns = await loadRelevantExternalReviewMissPatterns({
    artifactDir: reviewDir(args.config, args.activeRecord.issue_number),
    branch: args.activeRecord.branch,
    currentHeadSha: args.pr?.headRefOid ?? args.activeRecord.last_head_sha ?? "",
    changedFiles,
    limit: Number.MAX_SAFE_INTEGER,
  });
  const activeExternalReviewPatterns = new Map<string, {
    sourceType: "committed" | "runtime";
    pattern: (typeof committedExternalReviewPatterns)[number];
  }>();
  for (const pattern of committedExternalReviewPatterns) {
    activeExternalReviewPatterns.set(pattern.fingerprint, {
      sourceType: "committed",
      pattern,
    });
  }
  for (const pattern of runtimeExternalReviewPatterns) {
    const existing = activeExternalReviewPatterns.get(pattern.fingerprint);
    if (!existing || compareExternalReviewPatterns(pattern, existing.pattern) < 0) {
      activeExternalReviewPatterns.set(pattern.fingerprint, {
        sourceType: "runtime",
        pattern,
      });
    }
  }
  const activeExternalReviewWinners = [...activeExternalReviewPatterns.values()]
    .sort((left, right) => compareExternalReviewPatterns(left.pattern, right.pattern))
    .slice(0, 3);

  if (
    verifierGuardrails.length === 0 &&
    activeExternalReviewWinners.length === 0
  ) {
    return null;
  }

  const verifierSummary =
    verifierGuardrails.length > 0
      ? `committed:${VERIFIER_GUARDRAILS_PATH}#${verifierGuardrails.length}`
      : "none";
  const externalReviewSources: string[] = [];
  let committedCount = 0;
  const runtimeCounts = new Map<string, number>();
  for (const winner of activeExternalReviewWinners) {
    if (winner.sourceType === "committed") {
      committedCount += 1;
      continue;
    }

    const sourcePath = displayStatusArtifactPath(args.config, winner.pattern.sourceArtifactPath);
    runtimeCounts.set(sourcePath, (runtimeCounts.get(sourcePath) ?? 0) + 1);
  }
  if (committedCount > 0) {
    externalReviewSources.push(`committed:${EXTERNAL_REVIEW_GUARDRAILS_PATH}#${committedCount}`);
  }
  for (const sourcePath of [...runtimeCounts.keys()].sort()) {
    externalReviewSources.push(`runtime:${sourcePath}#${runtimeCounts.get(sourcePath)}`);
  }

  return `durable_guardrails verifier=${verifierSummary} external_review=${externalReviewSources.length > 0 ? externalReviewSources.join("|") : "none"}`;
}

function summarizeCheckBuckets(checks: PullRequestCheck[]): string {
  if (checks.length === 0) {
    return "none";
  }

  const counts = {
    pass: 0,
    fail: 0,
    pending: 0,
    skipping: 0,
    cancel: 0,
    other: 0,
  };

  for (const check of checks) {
    if (check.bucket === "pass") {
      counts.pass += 1;
    } else if (check.bucket === "fail") {
      counts.fail += 1;
    } else if (check.bucket === "pending") {
      counts.pending += 1;
    } else if (check.bucket === "skipping") {
      counts.skipping += 1;
    } else if (check.bucket === "cancel") {
      counts.cancel += 1;
    } else {
      counts.other += 1;
    }
  }

  return Object.entries(counts)
    .filter(([, count]) => count > 0)
    .map(([bucket, count]) => `${bucket}=${count}`)
    .join(" ");
}

function listChecksByBucket(checks: PullRequestCheck[], bucket: "fail" | "pending"): string | null {
  const matches = checks.filter((check) => check.bucket === bucket).map((check) => check.name);
  return matches.length > 0 ? matches.join(", ") : null;
}

function formatRecentRecord(record: IssueRunRecord | null): string {
  if (!record) {
    return "none";
  }

  return `#${record.issue_number} state=${record.state} updated_at=${record.updated_at}`;
}

function localReviewHeadStatus(
  record: Pick<IssueRunRecord, "local_review_head_sha">,
  pr: Pick<GitHubPullRequest, "headRefOid"> | null,
): "none" | "current" | "stale" | "unknown" {
  if (!record.local_review_head_sha) {
    return "none";
  }

  if (!pr) {
    return "unknown";
  }

  return record.local_review_head_sha === pr.headRefOid ? "current" : "stale";
}

function localReviewHeadDetails(
  record: Pick<IssueRunRecord, "local_review_head_sha">,
  pr: Pick<GitHubPullRequest, "headRefOid"> | null,
): {
  status: "none" | "current" | "stale" | "unknown";
  reviewedHeadSha: string;
  prHeadSha: string;
  driftSuffix: string;
} {
  const status = localReviewHeadStatus(record, pr);
  const reviewedHeadSha = record.local_review_head_sha ?? "none";
  const prHeadSha = pr?.headRefOid ?? "unknown";

  return {
    status,
    reviewedHeadSha,
    prHeadSha,
    driftSuffix: status === "stale" ? ` needs_review_run=yes drift=${reviewedHeadSha}->${prHeadSha}` : "",
  };
}

function localReviewIsGating(
  config: SupervisorConfig,
  record: Pick<
    IssueRunRecord,
    "local_review_head_sha" | "local_review_findings_count" | "local_review_recommendation"
  >,
  pr: GitHubPullRequest | null,
): boolean {
  if (!pr) {
    return false;
  }

  return localReviewBlocksReady(config, record, pr) || localReviewBlocksMerge(config, record, pr);
}

export function formatDetailedStatus(args: {
  config: SupervisorConfig;
  activeRecord: IssueRunRecord | null;
  latestRecord: IssueRunRecord | null;
  latestRecoveryRecord?: IssueRunRecord | null;
  trackedIssueCount: number;
  pr: GitHubPullRequest | null;
  checks: PullRequestCheck[];
  reviewThreads: ReviewThread[];
  handoffSummary?: string | null;
  durableGuardrailSummary?: string | null;
}): string {
  const {
    config,
    activeRecord,
    latestRecord,
    latestRecoveryRecord = null,
    trackedIssueCount,
    pr,
    checks,
    reviewThreads,
    handoffSummary = null,
    durableGuardrailSummary = null,
  } = args;

  if (!activeRecord) {
    const lines = [
      "No active issue.",
      `tracked_issues=${trackedIssueCount}`,
      `latest_record=${formatRecentRecord(latestRecord)}`,
    ];

    if (latestRecoveryRecord?.last_recovery_reason && latestRecoveryRecord.last_recovery_at) {
      lines.push(
        `latest_recovery issue=#${latestRecoveryRecord.issue_number} at=${latestRecoveryRecord.last_recovery_at} reason=${sanitizeStatusValue(latestRecoveryRecord.last_recovery_reason)}`,
      );
    }

    return lines.join("\n");
  }

  const localReviewHead = localReviewHeadDetails(activeRecord, pr);
  const localReviewGating = localReviewIsGating(config, activeRecord, pr) ? "yes" : "no";
  const localReviewStalled =
    pr &&
    localReviewRetryLoopStalled(
      config,
      activeRecord,
      pr,
      checks,
      reviewThreads,
      manualReviewThreads,
      configuredBotReviewThreads,
      summarizeChecks,
      mergeConflictDetected,
    )
      ? "yes"
      : "no";
  const externalReviewHeadStatus =
    !activeRecord.external_review_head_sha
      ? "none"
      : pr
        ? activeRecord.external_review_head_sha === pr.headRefOid
          ? "current"
          : "stale"
        : "unknown";
  const lines = [
    `issue=#${activeRecord.issue_number}`,
    `state=${activeRecord.state}`,
    `branch=${activeRecord.branch}`,
    `pr=${activeRecord.pr_number ?? "none"}`,
    `attempts=${activeRecord.attempt_count}`,
    `implementation_attempts=${activeRecord.implementation_attempt_count}`,
    `repair_attempts=${activeRecord.repair_attempt_count}`,
    `updated_at=${activeRecord.updated_at}`,
    `workspace=${activeRecord.workspace}`,
    `blocked_reason=${activeRecord.blocked_reason ?? "none"}`,
    `last_failure_kind=${activeRecord.last_failure_kind ?? "none"}`,
    `last_failure_signature=${activeRecord.last_failure_signature ?? "none"}`,
    `retries timeout=${activeRecord.timeout_retry_count} verification=${activeRecord.blocked_verification_retry_count} same_blocker=${activeRecord.repeated_blocker_count} same_failure_signature=${activeRecord.repeated_failure_signature_count}`,
    `local_review gating=${localReviewGating} policy=${config.localReviewPolicy} findings=${activeRecord.local_review_findings_count} root_causes=${activeRecord.local_review_root_cause_count} max_severity=${activeRecord.local_review_max_severity ?? "none"} verified_findings=${activeRecord.local_review_verified_findings_count} verified_max_severity=${activeRecord.local_review_verified_max_severity ?? "none"} head=${localReviewHead.status} reviewed_head_sha=${localReviewHead.reviewedHeadSha} pr_head_sha=${localReviewHead.prHeadSha} ran_at=${activeRecord.local_review_run_at ?? "none"}${localReviewGating === "yes" && activeRecord.local_review_blocker_summary ? ` blocker_summary=${truncate(sanitizeStatusValue(activeRecord.local_review_blocker_summary), 160)}` : ""}${localReviewHead.driftSuffix} signature=${activeRecord.last_local_review_signature ?? "none"} repeated=${activeRecord.repeated_local_review_signature_count} stalled=${localReviewStalled}`,
    `external_review head=${externalReviewHeadStatus} reviewed_head_sha=${activeRecord.external_review_head_sha ?? "none"} matched=${activeRecord.external_review_matched_findings_count} near_match=${activeRecord.external_review_near_match_findings_count} missed=${activeRecord.external_review_missed_findings_count}`,
  ];

  if (activeRecord.last_error) {
    const sanitizedLastError = sanitizeStatusValue(activeRecord.last_error);
    lines.push(`last_error=${truncate(sanitizedLastError, 300)}`);
  }

  if (pr) {
    const reviewBotProfile = inferReviewBotProfile(config);
    const reviewBotStatus = reviewBotDiagnostics(config, activeRecord, pr, reviewThreads);
    const copilotReviewState = pr.copilotReviewState === null ? "unknown" : (pr.copilotReviewState ?? "not_requested");
    const reviewStatusLabel = configuredReviewStatusLabel(config);
    const reviewers = configuredReviewBots(config);
    const reviewersSuffix =
      reviewStatusLabel === "configured_bot_review" && reviewers.length > 0 ? ` reviewers=${reviewers.join(",")}` : "";
    lines.push(
      `review_bot_profile profile=${reviewBotProfile.profile} provider=${reviewBotProfile.provider} reviewers=${reviewBotProfile.reviewers.length > 0 ? reviewBotProfile.reviewers.join(",") : "none"} signal_source=${reviewBotProfile.signalSource}`,
    );
    lines.push(
      `review_bot_diagnostics status=${reviewBotStatus.status} observed_review=${reviewBotStatus.observedReview} expected_reviewers=${reviewBotProfile.reviewers.length > 0 ? reviewBotProfile.reviewers.join(",") : "none"} next_check=${reviewBotStatus.nextCheck}`,
    );
    lines.push(
      `${reviewStatusLabel} state=${copilotReviewState}${reviewersSuffix} requested_at=${pr.copilotReviewRequestedAt ?? "none"} arrived_at=${pr.copilotReviewArrivedAt ?? "none"} timed_out_at=${activeRecord.copilot_review_timed_out_at ?? "none"} timeout_action=${activeRecord.copilot_review_timeout_action ?? "none"}`,
    );
    if (activeRecord.copilot_review_timeout_reason) {
      lines.push(`timeout_reason=${sanitizeStatusValue(activeRecord.copilot_review_timeout_reason)}`);
    }
    lines.push(
      `pr_state=${pr.state} draft=${pr.isDraft ? "yes" : "no"} merge_state=${pr.mergeStateStatus ?? "unknown"} review_decision=${pr.reviewDecision ?? "none"} head_sha=${pr.headRefOid}`,
    );
    lines.push(`checks=${summarizeCheckBuckets(checks)}`);
    const failingChecks = listChecksByBucket(checks, "fail");
    if (failingChecks) {
      lines.push(`failing_checks=${failingChecks}`);
    }
    const pendingChecks = listChecksByBucket(checks, "pending");
    if (pendingChecks) {
      lines.push(`pending_checks=${pendingChecks}`);
    }
    lines.push(
      `review_threads bot_pending=${pendingBotReviewThreads(config, activeRecord, pr, reviewThreads).length} bot_unresolved=${configuredBotReviewThreads(config, reviewThreads).length} manual=${manualReviewThreads(config, reviewThreads).length}`,
    );
  }

  if (activeRecord.last_failure_context) {
    lines.push(
      `failure_context category=${activeRecord.last_failure_context.category ?? "none"} summary=${truncate(activeRecord.last_failure_context.summary, 200) ?? "none"}`,
    );
  }

  if (handoffSummary) {
    lines.push(`handoff_summary=${truncate(sanitizeStatusValue(handoffSummary), 200)}`);
  }

  if (durableGuardrailSummary) {
    lines.push(truncate(sanitizeStatusValue(durableGuardrailSummary), 300) ?? "");
  }

  if (latestRecoveryRecord?.last_recovery_reason && latestRecoveryRecord.last_recovery_at) {
    lines.push(
      `latest_recovery issue=#${latestRecoveryRecord.issue_number} at=${latestRecoveryRecord.last_recovery_at} reason=${sanitizeStatusValue(latestRecoveryRecord.last_recovery_reason)}`,
    );
  }

  if (activeRecord.local_review_summary_path) {
    const relativeSummaryPath = path.relative(config.localReviewArtifactDir, activeRecord.local_review_summary_path);
    const displayedSummaryPath =
      relativeSummaryPath && !relativeSummaryPath.startsWith("..") && !path.isAbsolute(relativeSummaryPath)
        ? relativeSummaryPath
        : path.basename(activeRecord.local_review_summary_path);
    const sanitizedSummaryPath = sanitizeStatusValue(displayedSummaryPath);
    lines.push(`local_review_summary_path=${truncate(sanitizedSummaryPath, 200)}`);
  }

  if (activeRecord.external_review_misses_path) {
    const relativeMissesPath = path.relative(config.localReviewArtifactDir, activeRecord.external_review_misses_path);
    const displayedMissesPath =
      relativeMissesPath && !relativeMissesPath.startsWith("..") && !path.isAbsolute(relativeMissesPath)
        ? relativeMissesPath
        : path.basename(activeRecord.external_review_misses_path);
    lines.push(`external_review_misses_path=${truncate(sanitizeStatusValue(displayedMissesPath), 200)}`);
  }

  return lines.join("\n");
}

async function cleanupExpiredDoneWorkspaces(
  config: SupervisorConfig,
  state: SupervisorStateFile,
): Promise<RecoveryEvent[]> {
  if (config.cleanupDoneWorkspacesAfterHours < 0 && config.maxDoneWorkspaces < 0) {
    return [];
  }

  const recoveryEvents = await cleanupOrphanedIssueWorkspaces(config, state);

  const doneRecords = Object.values(state.issues)
    .filter((record) => record.state === "done")
    .sort((left, right) => left.updated_at.localeCompare(right.updated_at));

  const existingDoneRecords = doneRecords.filter((record) =>
    fs.existsSync(path.join(record.workspace, ".git")),
  );

  const cleanedWorkspacePaths = new Set<string>();

  if (config.maxDoneWorkspaces >= 0 && existingDoneRecords.length > config.maxDoneWorkspaces) {
    const overflowCount = existingDoneRecords.length - config.maxDoneWorkspaces;
    const overflowRecords = existingDoneRecords.slice(0, overflowCount);
    for (const record of overflowRecords) {
      await cleanupRecordWorkspace(config, record);
      cleanedWorkspacePaths.add(record.workspace);
    }
  }

  if (config.cleanupDoneWorkspacesAfterHours < 0) {
    return recoveryEvents;
  }

  for (const record of doneRecords) {
    if (cleanedWorkspacePaths.has(record.workspace)) {
      continue;
    }

    if (hoursSince(record.updated_at) < config.cleanupDoneWorkspacesAfterHours) {
      continue;
    }

    await cleanupRecordWorkspace(config, record);
  }

  return recoveryEvents;
}

function doneResetPatch(
  patch: Partial<IssueRunRecord> = {},
): Partial<IssueRunRecord> {
  return {
    state: "done",
    last_error: null,
    blocked_reason: null,
    local_review_blocker_summary: null,
    local_review_recommendation: null,
    local_review_degraded: false,
    external_review_head_sha: null,
    external_review_misses_path: null,
    external_review_matched_findings_count: 0,
    external_review_near_match_findings_count: 0,
    external_review_missed_findings_count: 0,
    last_failure_kind: null,
    last_failure_context: null,
    last_blocker_signature: null,
    last_failure_signature: null,
    timeout_retry_count: 0,
    blocked_verification_retry_count: 0,
    repeated_blocker_count: 0,
    repeated_failure_signature_count: 0,
    ...patch,
  };
}

function needsRecordUpdate(record: IssueRunRecord, patch: Partial<IssueRunRecord>): boolean {
  for (const [key, value] of Object.entries(patch)) {
    const recordValue = record[key as keyof IssueRunRecord];
    if (JSON.stringify(recordValue) !== JSON.stringify(value)) {
      return true;
    }
  }

  return false;
}

async function reconcileMergedIssueClosures(
  github: GitHubClient,
  stateStore: StateStore,
  state: SupervisorStateFile,
  issues: GitHubIssue[],
): Promise<RecoveryEvent[]> {
  let changed = false;
  const recoveryEvents: RecoveryEvent[] = [];
  const issueStateByNumber = new Map(issues.map((issue) => [issue.number, issue.state ?? null]));

  for (const record of Object.values(state.issues)) {
    if (issueStateByNumber.get(record.issue_number) !== "CLOSED") {
      continue;
    }

    const satisfyingPullRequests = await github.getMergedPullRequestsClosingIssue(record.issue_number);
    const satisfyingPullRequest = satisfyingPullRequests[0] ?? null;

    if (!satisfyingPullRequest) {
      const patch = doneResetPatch();
      if (needsRecordUpdate(record, patch)) {
        const updated = stateStore.touch(record, patch);
        state.issues[String(record.issue_number)] = updated;
        if (state.activeIssueNumber === record.issue_number) {
          state.activeIssueNumber = null;
        }
        changed = true;
      }
      continue;
    }

    if (
      record.pr_number !== null &&
      record.pr_number !== satisfyingPullRequest.number
    ) {
      const trackedPullRequest = await github.getPullRequestIfExists(record.pr_number);
      if (trackedPullRequest && trackedPullRequest.state === "OPEN" && !trackedPullRequest.mergedAt) {
        await github.closePullRequest(
          trackedPullRequest.number,
          `Closing as superseded because issue #${record.issue_number} was satisfied by merged PR #${satisfyingPullRequest.number}.`,
        );
      }
    }

    const patch = doneResetPatch({
      pr_number: satisfyingPullRequest.number,
      last_head_sha: satisfyingPullRequest.headRefOid,
    });
    if (needsRecordUpdate(record, patch)) {
      const recoveryEvent = buildRecoveryEvent(
        record.issue_number,
        `merged_pr_convergence: merged PR #${satisfyingPullRequest.number} satisfied issue #${record.issue_number}; marked issue #${record.issue_number} done`,
      );
      const updated = stateStore.touch(record, applyRecoveryEvent(patch, recoveryEvent));
      state.issues[String(record.issue_number)] = updated;
      if (state.activeIssueNumber === record.issue_number) {
        state.activeIssueNumber = null;
      }
      changed = true;
      recoveryEvents.push(recoveryEvent);
    }
  }

  if (changed) {
    await stateStore.save(state);
  }

  return recoveryEvents;
}

async function reconcileTrackedMergedButOpenIssues(
  github: GitHubClient,
  stateStore: StateStore,
  state: SupervisorStateFile,
  issues: GitHubIssue[],
): Promise<RecoveryEvent[]> {
  let changed = false;
  const recoveryEvents: RecoveryEvent[] = [];
  const issueByNumber = new Map(issues.map((issue) => [issue.number, issue]));

  for (const record of Object.values(state.issues)) {
    if (record.pr_number === null) {
      continue;
    }

    const trackedPullRequest = await github.getPullRequestIfExists(record.pr_number);
    if (!trackedPullRequest || (!trackedPullRequest.mergedAt && trackedPullRequest.state !== "MERGED")) {
      continue;
    }

    let issue = issueByNumber.get(record.issue_number);
    if (!issue && record.state === "merging") {
      issue = await github.getIssue(record.issue_number);
    }

    if (!issue) {
      continue;
    }

    const recoveryEvent = buildRecoveryEvent(
      record.issue_number,
      `merged_pr_convergence: tracked PR #${trackedPullRequest.number} merged; marked issue #${record.issue_number} done`,
    );

    if (issue.state !== "OPEN") {
      const patch = doneResetPatch({
        pr_number: trackedPullRequest.number,
        last_head_sha: trackedPullRequest.headRefOid,
      });
      const updated = stateStore.touch(record, applyRecoveryEvent(patch, recoveryEvent));
      state.issues[String(record.issue_number)] = updated;
      if (state.activeIssueNumber === record.issue_number) {
        state.activeIssueNumber = null;
      }
      changed = true;
      recoveryEvents.push(recoveryEvent);
      continue;
    }

    const mergedAtMs = Date.parse(trackedPullRequest.mergedAt ?? "");
    const issueUpdatedAtMs = Date.parse(issue.updatedAt);
    // If the issue changed after the tracked PR merged, treat it as intentionally still open
    // (for example, reopened after requirements changed) and do not auto-close it.
    if (
      !Number.isFinite(mergedAtMs) ||
      !Number.isFinite(issueUpdatedAtMs) ||
      issueUpdatedAtMs > mergedAtMs
    ) {
      continue;
    }

    await github.closeIssue(
      record.issue_number,
      `Closed automatically because tracked PR #${trackedPullRequest.number} was merged.`,
    );

    const patch = doneResetPatch({
      pr_number: trackedPullRequest.number,
      last_head_sha: trackedPullRequest.headRefOid,
    });
    const updated = stateStore.touch(record, applyRecoveryEvent(patch, recoveryEvent));
    state.issues[String(record.issue_number)] = updated;
    if (state.activeIssueNumber === record.issue_number) {
      state.activeIssueNumber = null;
    }
    changed = true;
    recoveryEvents.push(recoveryEvent);
  }

  if (changed) {
    await stateStore.save(state);
  }

  return recoveryEvents;
}

async function reconcileStaleFailedIssueStates(
  github: GitHubClient,
  stateStore: StateStore,
  state: SupervisorStateFile,
  config: SupervisorConfig,
  issues: GitHubIssue[],
): Promise<void> {
  let changed = false;
  const issueStateByNumber = new Map(issues.map((issue) => [issue.number, issue.state ?? null]));

  for (const record of Object.values(state.issues)) {
    if (record.state !== "failed" || record.pr_number === null) {
      continue;
    }

    if (issueStateByNumber.get(record.issue_number) !== "OPEN") {
      continue;
    }

    const pr = await github.getPullRequestIfExists(record.pr_number);
    if (!pr || !isOpenPullRequest(pr)) {
      continue;
    }

    const checks = await github.getChecks(pr.number);
    const reviewThreads = await github.getUnresolvedReviewThreads(pr.number);
    const nextState = inferStateFromPullRequest(config, record, pr, checks, reviewThreads);

    if (nextState === "blocked" || nextState === "failed") {
      continue;
    }

    const patch: Partial<IssueRunRecord> = {
      state: nextState,
      last_error: null,
      last_failure_kind: null,
      last_failure_context: null,
      last_blocker_signature: null,
      last_failure_signature: null,
      blocked_reason: null,
      repeated_blocker_count: 0,
      repeated_failure_signature_count: 0,
      timeout_retry_count: 0,
      blocked_verification_retry_count: 0,
      pr_number: pr.number,
      last_head_sha: pr.headRefOid,
      ...syncReviewWaitWindow(record, pr),
      ...syncCopilotReviewRequestObservation(config, record, pr),
      ...syncCopilotReviewTimeoutState(config, record, pr),
    };

    const updated = stateStore.touch(record, patch);
    state.issues[String(record.issue_number)] = updated;
    changed = true;
  }

  if (changed) {
    await stateStore.save(state);
  }
}

type StateStoreLike = Pick<StateStore, "touch" | "save">;

export async function reconcileRecoverableBlockedIssueStates(
  stateStore: StateStoreLike,
  state: SupervisorStateFile,
  config: SupervisorConfig,
  issues: GitHubIssue[],
): Promise<RecoveryEvent[]> {
  let changed = false;
  const recoveryEvents: RecoveryEvent[] = [];
  const issuesByNumber = new Map(issues.map((issue) => [issue.number, issue]));

  for (const record of Object.values(state.issues)) {
    const issue = issuesByNumber.get(record.issue_number);
    if (!issue || issue.state !== "OPEN") {
      continue;
    }

    if (shouldAutoRetryHandoffMissing(record, config)) {
      const recoveryEvent = buildRecoveryEvent(
        record.issue_number,
        `stale_state_cleanup: requeued issue #${record.issue_number} after recovering a missing handoff`,
      );
      const updated = stateStore.touch(record, {
        state: "queued",
        blocked_reason: null,
        last_error: null,
        last_failure_kind: null,
        last_blocker_signature: null,
        codex_session_id: null,
        review_wait_started_at: null,
        review_wait_head_sha: null,
        copilot_review_requested_observed_at: null,
        copilot_review_requested_head_sha: null,
        copilot_review_timed_out_at: null,
        copilot_review_timeout_action: null,
        copilot_review_timeout_reason: null,
        ...applyRecoveryEvent({}, recoveryEvent),
      });
      state.issues[String(record.issue_number)] = updated;
      changed = true;
      recoveryEvents.push(recoveryEvent);
      continue;
    }

    if (record.state === "blocked" && record.blocked_reason === "requirements") {
      const readiness = lintExecutionReadyIssueBody(issue);
      if (!readiness.isExecutionReady) {
        continue;
      }

      const recoveryEvent = buildRecoveryEvent(
        record.issue_number,
        `requirements_recovered: requeued issue #${record.issue_number} after execution-ready metadata was added`,
      );
      const updated = stateStore.touch(record, {
        state: "queued",
        blocked_reason: null,
        last_error: null,
        last_failure_kind: null,
        last_failure_context: null,
        last_blocker_signature: null,
        last_failure_signature: null,
        repeated_failure_signature_count: 0,
        ...applyRecoveryEvent({}, recoveryEvent),
      });
      state.issues[String(record.issue_number)] = updated;
      changed = true;
      recoveryEvents.push(recoveryEvent);
      continue;
    }

    if (record.state === "blocked" && record.blocked_reason === "clarification") {
      if (findHighRiskBlockingAmbiguity(issue)) {
        continue;
      }

      const recoveryEvent = buildRecoveryEvent(
        record.issue_number,
        `clarification_recovered: requeued issue #${record.issue_number} after blocking ambiguity was resolved`,
      );
      const updated = stateStore.touch(record, {
        state: "queued",
        blocked_reason: null,
        last_error: null,
        last_failure_kind: null,
        last_failure_context: null,
        last_blocker_signature: null,
        last_failure_signature: null,
        repeated_failure_signature_count: 0,
        ...applyRecoveryEvent({}, recoveryEvent),
      });
      state.issues[String(record.issue_number)] = updated;
      changed = true;
      recoveryEvents.push(recoveryEvent);
    }
  }

  if (changed) {
    await stateStore.save(state);
  }

  return recoveryEvents;
}

async function reconcileParentEpicClosures(
  github: GitHubClient,
  stateStore: StateStore,
  state: SupervisorStateFile,
  issues: GitHubIssue[],
): Promise<void> {
  const parentIssuesReadyToClose = findParentIssuesReadyToClose(issues);
  if (parentIssuesReadyToClose.length === 0) {
    return;
  }

  let changed = false;

  for (const { parentIssue, childIssues } of parentIssuesReadyToClose) {
    const childIssueNumbers = childIssues
      .map((childIssue) => `#${childIssue.number}`)
      .sort((left, right) => Number(left.slice(1)) - Number(right.slice(1)));

    await github.closeIssue(
      parentIssue.number,
      `Closed automatically because all child issues are closed: ${childIssueNumbers.join(", ")}.`,
    );

    const existingRecord = state.issues[String(parentIssue.number)];
    if (existingRecord) {
      const patch = doneResetPatch();
      if (needsRecordUpdate(existingRecord, patch)) {
        const updated = stateStore.touch(existingRecord, patch);
        state.issues[String(parentIssue.number)] = updated;
        if (state.activeIssueNumber === parentIssue.number) {
          state.activeIssueNumber = null;
        }
        changed = true;
      }
    }
  }

  if (changed) {
    await stateStore.save(state);
  }
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

  private async reconcileStaleActiveIssueReservation(state: SupervisorStateFile): Promise<RecoveryEvent[]> {
    const recoveryEvents: RecoveryEvent[] = [];
    if (state.activeIssueNumber === null) {
      return recoveryEvents;
    }

    const record = state.issues[String(state.activeIssueNumber)] ?? null;
    if (!record) {
      state.activeIssueNumber = null;
      await this.stateStore.save(state);
      return recoveryEvents;
    }

    if (!OWNER_GUARDED_ACTIVE_STATES.has(record.state)) {
      return recoveryEvents;
    }

    const issueLock = await inspectFileLock(this.lockPath("issues", `issue-${record.issue_number}`));
    if (issueLock.status === "live") {
      return recoveryEvents;
    }

    let missingLockReason = "issue lock was missing";
    if (record.codex_session_id) {
      const sessionLock = await inspectFileLock(this.lockPath("sessions", `session-${record.codex_session_id}`));
      if (sessionLock.status === "live") {
        return recoveryEvents;
      }
      missingLockReason = "issue lock and session lock were missing";
    }

    const recoveryEvent = buildRecoveryEvent(
      record.issue_number,
      `stale_state_cleanup: cleared stale active reservation after ${missingLockReason}`,
    );
    state.issues[String(record.issue_number)] = this.stateStore.touch(record, {
      codex_session_id: null,
      ...applyRecoveryEvent({}, recoveryEvent),
    });
    state.activeIssueNumber = null;
    await this.stateStore.save(state);
    recoveryEvents.push(recoveryEvent);
    return recoveryEvents;
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
      reconcileStaleActiveIssueReservation: (state) => this.reconcileStaleActiveIssueReservation(state),
      handleAuthFailure: (state) => handleAuthFailure(this.github, this.stateStore, state),
      listAllIssues: () => this.github.listAllIssues(),
      reconcileTrackedMergedButOpenIssues: (state, issues) =>
        reconcileTrackedMergedButOpenIssues(this.github, this.stateStore, state, issues),
      reconcileMergedIssueClosures: (state, issues) =>
        reconcileMergedIssueClosures(this.github, this.stateStore, state, issues),
      reconcileStaleFailedIssueStates: (state, issues) =>
        reconcileStaleFailedIssueStates(this.github, this.stateStore, state, this.config, issues),
      reconcileRecoverableBlockedIssueStates: (state, issues) =>
        reconcileRecoverableBlockedIssueStates(this.stateStore, state, this.config, issues),
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
