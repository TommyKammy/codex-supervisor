import path from "node:path";
import { buildCodexPrompt, extractBlockedReason, extractFailureSignature, extractStateHint, runCodexTurn } from "./codex";
import { loadConfig } from "./config";
import { GitHubClient } from "./github";
import { findBlockingIssue, findParentIssuesReadyToClose } from "./issue-metadata";
import { hasMeaningfulJournalHandoff, issueJournalPath, readIssueJournal, syncIssueJournal } from "./journal";
import { acquireFileLock, LockHandle } from "./lock";
import { runLocalReview, shouldRunLocalReview } from "./local-review";
import { syncMemoryArtifacts } from "./memory";
import { StateStore } from "./state-store";
import {
  BlockedReason,
  CliOptions,
  FailureContext,
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
import {
  branchNameForIssue,
  cleanupWorkspace,
  ensureWorkspace,
  getWorkspaceStatus,
  pushBranch,
  workspacePathForIssue,
} from "./workspace";

function createIssueRecord(config: SupervisorConfig, issueNumber: number): IssueRunRecord {
  const branch = branchNameForIssue(config, issueNumber);
  return {
    issue_number: issueNumber,
    state: "queued",
    branch,
    pr_number: null,
    workspace: workspacePathForIssue(config, issueNumber),
    journal_path: null,
    review_wait_started_at: null,
    review_wait_head_sha: null,
    codex_session_id: null,
    local_review_head_sha: null,
    local_review_summary_path: null,
    local_review_run_at: null,
    local_review_max_severity: null,
    local_review_findings_count: 0,
    attempt_count: 0,
    timeout_retry_count: 0,
    blocked_verification_retry_count: 0,
    repeated_blocker_count: 0,
    repeated_failure_signature_count: 0,
    last_head_sha: null,
    last_codex_summary: null,
    last_error: null,
    last_failure_kind: null,
    last_failure_context: null,
    last_blocker_signature: null,
    last_failure_signature: null,
    blocked_reason: null,
    processed_review_thread_ids: [],
    updated_at: nowIso(),
  };
}

function classifyFailure(message: string | null | undefined): "timeout" | "command_error" {
  return message?.includes("Command timed out after") ? "timeout" : "command_error";
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
    record.attempt_count < config.maxCodexAttemptsPerIssue &&
    record.blocked_verification_retry_count < config.blockedVerificationRetryLimit &&
    record.repeated_blocker_count < config.sameBlockerRepeatLimit &&
    record.repeated_failure_signature_count < config.sameFailureSignatureRepeatLimit
  );
}

function hasAttemptBudgetRemaining(record: IssueRunRecord, config: SupervisorConfig): boolean {
  return record.attempt_count < config.maxCodexAttemptsPerIssue;
}

function isEligibleForSelection(record: IssueRunRecord | undefined, config: SupervisorConfig): boolean {
  if (!record) {
    return true;
  }

  if (!isTerminalState(record.state)) {
    return true;
  }

  return shouldAutoRetryTimeout(record, config) || shouldAutoRetryBlockedVerification(record, config);
}

function summarizeChecks(checks: PullRequestCheck[]): { allPassing: boolean; hasPending: boolean; hasFailing: boolean } {
  if (checks.length === 0) {
    return { allPassing: true, hasPending: false, hasFailing: false };
  }

  let allPassing = true;
  let hasPending = false;
  let hasFailing = false;

  for (const check of checks) {
    if (check.bucket === "pending") {
      hasPending = true;
      allPassing = false;
    } else if (check.bucket === "fail" || check.bucket === "cancel") {
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
  if (record.attempt_count === 0) {
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

function buildChecksFailureContext(pr: GitHubPullRequest, checks: PullRequestCheck[]): FailureContext | null {
  const failingChecks = checks.filter((check) => check.bucket === "fail" || check.bucket === "cancel");
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
  record: IssueRunRecord,
  reviewThreads: ReviewThread[],
): ReviewThread[] {
  return configuredBotReviewThreads(config, reviewThreads).filter(
    (thread) => !record.processed_review_thread_ids.includes(thread.id),
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

    const manualReviewContext =
      config.humanReviewBlocksMerge ? buildManualReviewFailureContext(manualReviewThreads(config, reviewThreads)) : null;
    if (manualReviewContext) {
      return manualReviewContext;
    }

    const reviewContext = buildReviewFailureContext(pendingBotReviewThreads(config, record, reviewThreads));
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
  reviewThreads: ReviewThread[],
): Exclude<BlockedReason, null> | null {
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

function copilotReviewGraceExpired(
  record: IssueRunRecord,
  pr: GitHubPullRequest,
  config: SupervisorConfig,
): boolean {
  if (config.copilotReviewWaitMinutes <= 0) {
    return true;
  }

  const anchor = !pr.isDraft && record.review_wait_started_at ? record.review_wait_started_at : pr.createdAt;
  const createdAtMs = Date.parse(anchor);
  if (Number.isNaN(createdAtMs)) {
    return false;
  }

  return Date.now() - createdAtMs >= config.copilotReviewWaitMinutes * 60_000;
}

function inferStateFromPullRequest(
  config: SupervisorConfig,
  record: IssueRunRecord,
  pr: GitHubPullRequest,
  checks: PullRequestCheck[],
  reviewThreads: ReviewThread[],
): RunState {
  const manualThreads = manualReviewThreads(config, reviewThreads);
  const unresolvedBotThreads = configuredBotReviewThreads(config, reviewThreads);
  const botThreads = pendingBotReviewThreads(config, record, reviewThreads);

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

  if (mergeConflictDetected(pr)) {
    return "resolving_conflict";
  }

  if (pr.isDraft) {
    return "draft_pr";
  }

  if (!copilotReviewGraceExpired(record, pr, config)) {
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
    inferred === "reproducing" ||
    inferred === "stabilizing"
  );
}

function isOpenPullRequest(pr: GitHubPullRequest | null): pr is GitHubPullRequest {
  return pr !== null && pr.state === "OPEN" && !pr.mergedAt;
}

async function selectNextIssue(
  github: GitHubClient,
  config: SupervisorConfig,
  state: SupervisorStateFile,
): Promise<IssueRunRecord | null> {
  const issues = await github.listCandidateIssues();
  for (const issue of issues) {
    if (config.skipTitlePrefixes.some((prefix) => issue.title.startsWith(prefix))) {
      continue;
    }

    if (findBlockingIssue(issue, issues, state)) {
      continue;
    }

    const existing = state.issues[String(issue.number)];
    if (!isEligibleForSelection(existing, config)) {
      continue;
    }

    return existing ?? createIssueRecord(config, issue.number);
  }

  return null;
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
    `attempts=${record.attempt_count}`,
    `workspace=${record.workspace}`,
  ].join(" ");
}

function sanitizeStatusValue(value: string | null | undefined): string | null {
  if (!value) {
    return null;
  }

  return value.replace(/\r?\n/g, "\\n");
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

function formatDetailedStatus(args: {
  config: SupervisorConfig;
  activeRecord: IssueRunRecord | null;
  latestRecord: IssueRunRecord | null;
  trackedIssueCount: number;
  pr: GitHubPullRequest | null;
  checks: PullRequestCheck[];
  reviewThreads: ReviewThread[];
}): string {
  const { config, activeRecord, latestRecord, trackedIssueCount, pr, checks, reviewThreads } = args;

  if (!activeRecord) {
    return [
      "No active issue.",
      `tracked_issues=${trackedIssueCount}`,
      `latest_record=${formatRecentRecord(latestRecord)}`,
    ].join("\n");
  }

  const lines = [
    `issue=#${activeRecord.issue_number}`,
    `state=${activeRecord.state}`,
    `branch=${activeRecord.branch}`,
    `pr=${activeRecord.pr_number ?? "none"}`,
    `attempts=${activeRecord.attempt_count}`,
    `updated_at=${activeRecord.updated_at}`,
    `workspace=${activeRecord.workspace}`,
    `blocked_reason=${activeRecord.blocked_reason ?? "none"}`,
    `last_failure_kind=${activeRecord.last_failure_kind ?? "none"}`,
    `last_failure_signature=${activeRecord.last_failure_signature ?? "none"}`,
    `retries timeout=${activeRecord.timeout_retry_count} verification=${activeRecord.blocked_verification_retry_count} same_blocker=${activeRecord.repeated_blocker_count} same_failure_signature=${activeRecord.repeated_failure_signature_count}`,
    `local_review head=${activeRecord.local_review_head_sha ?? "none"} severity=${activeRecord.local_review_max_severity ?? "none"} findings=${activeRecord.local_review_findings_count} ran_at=${activeRecord.local_review_run_at ?? "none"}`,
  ];

  if (activeRecord.last_error) {
    const sanitizedLastError = sanitizeStatusValue(activeRecord.last_error);
    lines.push(`last_error=${truncate(sanitizedLastError, 300)}`);
  }

  if (pr) {
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
      `review_threads bot_pending=${pendingBotReviewThreads(config, activeRecord, reviewThreads).length} bot_unresolved=${configuredBotReviewThreads(config, reviewThreads).length} manual=${manualReviewThreads(config, reviewThreads).length}`,
    );
  }

  if (activeRecord.last_failure_context) {
    lines.push(
      `failure_context category=${activeRecord.last_failure_context.category ?? "none"} summary=${truncate(activeRecord.last_failure_context.summary, 200) ?? "none"}`,
    );
  }

  if (activeRecord.local_review_summary_path) {
    lines.push(`local_review_summary_path=${activeRecord.local_review_summary_path}`);
  }

  return lines.join("\n");
}

async function cleanupExpiredDoneWorkspaces(
  config: SupervisorConfig,
  state: SupervisorStateFile,
): Promise<void> {
  if (config.cleanupDoneWorkspacesAfterHours < 0) {
    return;
  }

  for (const record of Object.values(state.issues)) {
    if (record.state !== "done") {
      continue;
    }

    if (hoursSince(record.updated_at) < config.cleanupDoneWorkspacesAfterHours) {
      continue;
    }

    await cleanupWorkspace(config.repoPath, record.workspace, record.branch);
  }
}

async function reconcileMergedIssueClosures(
  github: GitHubClient,
  stateStore: StateStore,
  state: SupervisorStateFile,
): Promise<void> {
  let changed = false;

  for (const record of Object.values(state.issues)) {
    if (record.pr_number === null) {
      continue;
    }

    if (record.state !== "done" && record.state !== "merging") {
      continue;
    }

    const pr = await github.getPullRequest(record.pr_number);
    if (!pr.mergedAt && pr.state !== "MERGED") {
      continue;
    }

    const issue = await github.getIssue(record.issue_number);
    if (issue.state !== "CLOSED") {
      await github.closeIssue(
        record.issue_number,
        `Closed automatically because PR #${record.pr_number} was merged.`,
      );
    }

    const updated = stateStore.touch(record, { state: "done", last_head_sha: pr.headRefOid });
    state.issues[String(record.issue_number)] = updated;
    if (state.activeIssueNumber === record.issue_number) {
      state.activeIssueNumber = null;
    }
    changed = true;
  }

  if (changed) {
    await stateStore.save(state);
  }
}

async function reconcileParentEpicClosures(
  github: GitHubClient,
  stateStore: StateStore,
  state: SupervisorStateFile,
): Promise<void> {
  const issues = await github.listAllIssues();
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
      const updated = stateStore.touch(existingRecord, {
        state: "done",
        last_error: null,
        blocked_reason: null,
      });
      state.issues[String(parentIssue.number)] = updated;
      if (state.activeIssueNumber === parentIssue.number) {
        state.activeIssueNumber = null;
      }
      changed = true;
    }
  }

  if (changed) {
    await stateStore.save(state);
  }
}

export class Supervisor {
  private readonly github: GitHubClient;
  private readonly stateStore: StateStore;

  constructor(private readonly config: SupervisorConfig) {
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

  async acquireSupervisorLock(label: "loop" | "run-once"): Promise<LockHandle> {
    return acquireFileLock(this.lockPath("supervisor", "run"), `supervisor-${label}`);
  }

  async status(): Promise<string> {
    const state = await this.stateStore.load();
    const activeRecord =
      state.activeIssueNumber !== null ? state.issues[String(state.activeIssueNumber)] ?? null : null;
    let latestRecord: IssueRunRecord | null = null;
    for (const record of Object.values(state.issues)) {
      if (latestRecord === null || record.updated_at.localeCompare(latestRecord.updated_at) > 0) {
        latestRecord = record;
      }
    }

    if (!activeRecord) {
      return formatDetailedStatus({
        config: this.config,
        activeRecord: null,
        latestRecord,
        trackedIssueCount: Object.keys(state.issues).length,
        pr: null,
        checks: [],
        reviewThreads: [],
      });
    }

    let pr: GitHubPullRequest | null = null;
    let checks: PullRequestCheck[] = [];
    let reviewThreads: ReviewThread[] = [];

    try {
      pr = await this.github.resolvePullRequestForBranch(activeRecord.branch, activeRecord.pr_number);
      if (isOpenPullRequest(pr)) {
        checks = await this.github.getChecks(pr.number);
        reviewThreads = await this.github.getUnresolvedReviewThreads(pr.number);
      }
    } catch (error) {
        const message = sanitizeStatusValue(error instanceof Error ? error.message : String(error));
        return `${formatDetailedStatus({
          config: this.config,
          activeRecord,
          latestRecord,
          trackedIssueCount: Object.keys(state.issues).length,
          pr,
        checks,
        reviewThreads,
      })}\nstatus_warning=${truncate(message, 200)}`;
    }

    return formatDetailedStatus({
      config: this.config,
      activeRecord,
      latestRecord,
      trackedIssueCount: Object.keys(state.issues).length,
      pr,
      checks,
      reviewThreads,
    });
  }

  async runOnce(options: Pick<CliOptions, "dryRun">): Promise<string> {
    const state = await this.stateStore.load();
    await reconcileMergedIssueClosures(this.github, this.stateStore, state);
    await reconcileParentEpicClosures(this.github, this.stateStore, state);
    await cleanupExpiredDoneWorkspaces(this.config, state);

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

    if (!record || !isEligibleForSelection(record, this.config)) {
      record = await selectNextIssue(this.github, this.config, state);
      if (!record) {
        state.activeIssueNumber = null;
        await this.stateStore.save(state);
        return "No matching open issue found.";
      }

      state.activeIssueNumber = record.issue_number;
      state.issues[String(record.issue_number)] = record;
      await this.stateStore.save(state);
    }

    if (!record) {
      throw new Error("Invariant violation: active issue record is missing after selection.");
    }

    const issueLock = await acquireFileLock(
      this.lockPath("issues", `issue-${record.issue_number}`),
      `issue-${record.issue_number}`,
    );
    if (!issueLock.acquired) {
      return `Skipped issue #${record.issue_number}: ${issueLock.reason}.`;
    }

    try {
      const issue = await this.github.getIssue(record.issue_number);
      if (issue.state === "CLOSED" && record.pr_number !== null) {
        record = this.stateStore.touch(record, { state: "done" });
        state.issues[String(record.issue_number)] = record;
        state.activeIssueNumber = null;
        await this.stateStore.save(state);
        return this.runOnce(options);
      }

      const previousCodexSummary = record.last_codex_summary;
      const previousError = record.last_error;

      const candidateIssues = await this.github.listCandidateIssues();
      const blockingIssue = findBlockingIssue(issue, candidateIssues, state);
      if (blockingIssue) {
        record = this.stateStore.touch(record, {
          state: "queued",
          last_error: `Waiting for ${blockingIssue.reason} before continuing issue #${record.issue_number}.`,
        });
        state.issues[String(record.issue_number)] = record;
        state.activeIssueNumber = null;
        await this.stateStore.save(state);
        return this.runOnce(options);
      }

      if (!hasAttemptBudgetRemaining(record, this.config)) {
        const failureContext = buildCodexFailureContext("manual", `Issue #${record.issue_number} exhausted its Codex attempt budget.`, [
          `attempts=${record.attempt_count}`,
          `max=${this.config.maxCodexAttemptsPerIssue}`,
        ]);
        record = this.stateStore.touch(record, {
          state: "failed",
          last_failure_kind: "command_error",
          last_error:
            `Reached max Codex attempts for issue #${record.issue_number} ` +
            `(${record.attempt_count}/${this.config.maxCodexAttemptsPerIssue}).`,
          last_failure_context: failureContext,
          ...applyFailureSignature(record, failureContext),
          blocked_reason: null,
        });
        state.issues[String(record.issue_number)] = record;
        state.activeIssueNumber = null;
        await this.stateStore.save(state);
        return `Issue #${record.issue_number} reached max Codex attempts.`;
      }

      const workspacePath = await ensureWorkspace(this.config, record.issue_number, record.branch);
      const journalPath = issueJournalPath(workspacePath, this.config.issueJournalRelativePath);
      const syncJournal = async (currentRecord: IssueRunRecord): Promise<void> => {
        await syncIssueJournal({
          issue,
          record: currentRecord,
          journalPath,
          maxChars: this.config.issueJournalMaxChars,
        });
      };
      record = this.stateStore.touch(record, {
        workspace: workspacePath,
        journal_path: journalPath,
        state: record.attempt_count === 0 ? "planning" : record.state,
        last_error: null,
        last_failure_kind: null,
        blocked_reason: null,
      });
      state.issues[String(record.issue_number)] = record;
      await this.stateStore.save(state);
      await syncJournal(record);
      const memoryArtifacts = await syncMemoryArtifacts({
        config: this.config,
        issueNumber: record.issue_number,
        workspacePath,
        journalPath,
      });

      let workspaceStatus = await getWorkspaceStatus(workspacePath, record.branch, this.config.defaultBranch);
      record = this.stateStore.touch(record, { last_head_sha: workspaceStatus.headSha });
      state.issues[String(record.issue_number)] = record;
      await this.stateStore.save(state);

      if (workspaceStatus.remoteBranchExists && workspaceStatus.remoteAhead > 0) {
        await pushBranch(workspacePath, record.branch, true);
        workspaceStatus = await getWorkspaceStatus(workspacePath, record.branch, this.config.defaultBranch);
      }

      let resolvedPr = await this.github.resolvePullRequestForBranch(record.branch, record.pr_number);
      let pr = isOpenPullRequest(resolvedPr) ? resolvedPr : null;
      let checks = pr ? await this.github.getChecks(pr.number) : [];
      let reviewThreads = pr ? await this.github.getUnresolvedReviewThreads(pr.number) : [];

      if (!pr) {
        if (!resolvedPr) {
          // No current or historical PR for this branch; continue with normal branch/PR flow.
        } else if (resolvedPr.mergedAt || resolvedPr.state === "MERGED") {
          record = this.stateStore.touch(record, {
            pr_number: resolvedPr.number,
            state: "done",
            last_head_sha: resolvedPr.headRefOid,
          });
          state.issues[String(record.issue_number)] = record;
          state.activeIssueNumber = null;
          await this.stateStore.save(state);
          return this.runOnce(options);
        } else if (resolvedPr.state === "CLOSED") {
          const failureContext = buildCodexFailureContext(
            "manual",
            `PR #${resolvedPr.number} was closed without merge.`,
            ["Manual intervention is required before the supervisor can continue this issue."],
          );
          record = this.stateStore.touch(record, {
            pr_number: resolvedPr.number,
            state: "blocked",
            last_error:
              `PR #${resolvedPr.number} was closed without merge. ` +
              `Manual intervention is required before issue #${record.issue_number} can continue.`,
            last_failure_kind: null,
            last_failure_context: failureContext,
            ...applyFailureSignature(record, failureContext),
            blocked_reason: "manual_pr_closed",
          });
          state.issues[String(record.issue_number)] = record;
          state.activeIssueNumber = null;
          await this.stateStore.save(state);
          await syncJournal(record);
          return `Issue #${record.issue_number} blocked because PR #${resolvedPr.number} was closed without merge.`;
        }
      }

      if (
        !pr &&
        workspaceStatus.baseAhead > 0 &&
        !workspaceStatus.hasUncommittedChanges &&
        record.attempt_count >= this.config.draftPrAfterAttempt
      ) {
        await pushBranch(workspacePath, record.branch, workspaceStatus.remoteBranchExists);
        pr = await this.github.createPullRequest(issue, record, { draft: true });
        checks = await this.github.getChecks(pr.number);
        reviewThreads = await this.github.getUnresolvedReviewThreads(pr.number);
      }

      if (pr) {
        const failureContext = inferFailureContext(this.config, record, pr, checks, reviewThreads);
        const reviewWaitPatch = syncReviewWaitWindow(record, pr);
        const nextState = inferStateFromPullRequest(this.config, record, pr, checks, reviewThreads);
        record = this.stateStore.touch(record, {
          pr_number: pr.number,
          state: nextState,
          ...reviewWaitPatch,
          last_error: nextState === "blocked" && failureContext ? truncate(failureContext.summary, 1000) : record.last_error,
          last_failure_context: failureContext,
          ...applyFailureSignature(record, failureContext),
          blocked_reason: nextState === "blocked" ? blockedReasonFromReviewState(this.config, reviewThreads) : null,
        });
        if (failureContext && shouldStopForRepeatedFailureSignature(record, this.config)) {
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
          return `Issue #${record.issue_number} stopped after repeated identical failure signatures.`;
        }
      } else {
        record = this.stateStore.touch(record, {
          state: inferStateWithoutPullRequest(record, workspaceStatus),
          last_failure_context: null,
          last_failure_signature: null,
          repeated_failure_signature_count: 0,
          blocked_reason: null,
        });
      }
      state.issues[String(record.issue_number)] = record;
      await this.stateStore.save(state);
      await syncJournal(record);

      if (shouldRunCodex(record, pr, checks, reviewThreads, this.config)) {
      const reviewThreadsToProcess = pendingBotReviewThreads(this.config, record, reviewThreads);

      if (options.dryRun) {
        record = this.stateStore.touch(record, {
          state: pr
            ? inferStateFromPullRequest(this.config, record, pr, checks, reviewThreads)
            : inferStateWithoutPullRequest(record, workspaceStatus),
        });
        state.issues[String(record.issue_number)] = record;
        await this.stateStore.save(state);
        return `Dry run: would invoke Codex for issue #${record.issue_number}. ${formatStatus(record)}`;
      }

      const preRunState: RunState = pr
        ? inferStateFromPullRequest(this.config, record, pr, checks, reviewThreads)
        : inferStateWithoutPullRequest(record, workspaceStatus);
      record = this.stateStore.touch(record, {
        state: preRunState,
        attempt_count: record.attempt_count + 1,
        last_failure_context: inferFailureContext(this.config, record, pr, checks, reviewThreads),
        blocked_reason: null,
      });
      state.issues[String(record.issue_number)] = record;
      await this.stateStore.save(state);
      await syncJournal(record);

      const journalContent = await readIssueJournal(journalPath);

      const prompt = buildCodexPrompt({
        repoSlug: this.config.repoSlug,
        issue,
        branch: record.branch,
        workspacePath,
        state: record.state,
        pr,
        checks,
        reviewThreads: reviewThreadsToProcess,
        journalPath,
        journalExcerpt: truncate(journalContent, 5000),
        failureContext: record.last_failure_context,
        previousSummary: previousCodexSummary,
        previousError,
        alwaysReadFiles: memoryArtifacts.alwaysReadFiles,
        onDemandMemoryFiles: memoryArtifacts.onDemandFiles,
      });

      const sessionLock = record.codex_session_id
        ? await acquireFileLock(
            this.lockPath("sessions", `session-${record.codex_session_id}`),
            `session-${record.codex_session_id}`,
          )
        : null;
      if (sessionLock && !sessionLock.acquired) {
        return `Skipped issue #${record.issue_number}: ${sessionLock.reason}.`;
      }

      let codexResult;
      try {
        codexResult = await runCodexTurn(this.config, workspacePath, prompt, record.codex_session_id);
      } catch (error) {
        const message = error instanceof Error ? error.stack ?? error.message : String(error);
        const failureKind = classifyFailure(message);
        const failureContext = buildCodexFailureContext("codex", `Codex turn execution failed for issue #${record.issue_number}.`, [
          truncate(message, 2000) ?? "Unknown failure",
        ]);
        record = this.stateStore.touch(record, {
          state: "failed",
          last_error: truncate(message),
          last_failure_kind: failureKind,
          last_failure_context: failureContext,
          ...applyFailureSignature(record, failureContext),
          blocked_reason: null,
          timeout_retry_count:
            failureKind === "timeout" ? record.timeout_retry_count + 1 : record.timeout_retry_count,
        });
        state.issues[String(record.issue_number)] = record;
        await this.stateStore.save(state);
        await syncJournal(record);
        return `Codex turn failed for issue #${record.issue_number}.`;
      } finally {
        await sessionLock?.release();
      }

      const hintedState = extractStateHint(codexResult.lastMessage);
      const hintedBlockedReason = extractBlockedReason(codexResult.lastMessage);
      const hintedFailureSignature = extractFailureSignature(codexResult.lastMessage);
      const journalAfterRun = await readIssueJournal(journalPath);
      record = this.stateStore.touch(record, {
        codex_session_id: codexResult.sessionId,
        last_codex_summary: truncate(codexResult.lastMessage),
        last_failure_kind: null,
        last_error:
          codexResult.exitCode === 0
            ? null
            : truncate([codexResult.stderr.trim(), codexResult.stdout.trim()].filter(Boolean).join("\n")),
      });

      if (
        codexResult.exitCode === 0 &&
        (!journalAfterRun ||
          journalAfterRun === journalContent ||
          !hasMeaningfulJournalHandoff(journalAfterRun))
      ) {
        const failureContext = buildCodexFailureContext(
          "blocked",
          `Codex completed without updating the issue journal for issue #${record.issue_number}.`,
          ["Update the Codex Working Notes section before ending the turn."],
        );
        record = this.stateStore.touch(record, {
          state: "blocked",
          last_error: truncate(failureContext.summary),
          last_failure_kind: null,
          last_failure_context: failureContext,
          ...applyFailureSignature(record, failureContext),
          blocked_reason: "handoff_missing",
        });
        state.issues[String(record.issue_number)] = record;
        await this.stateStore.save(state);
        await syncJournal(record);
        return `Codex turn for issue #${record.issue_number} was rejected because no journal handoff was written.`;
      }

      if (codexResult.exitCode !== 0) {
        const failureOutput = [codexResult.lastMessage, codexResult.stderr, codexResult.stdout]
          .filter(Boolean)
          .join("\n");
        const failureKind = classifyFailure(failureOutput) === "timeout" ? "timeout" : "codex_exit";
        const failureContext = buildCodexFailureContext(
          "codex",
          `Codex exited non-zero for issue #${record.issue_number}.`,
          [truncate(failureOutput, 2000) ?? "Unknown failure output"],
        );
        record = this.stateStore.touch(record, {
          state: "failed",
          last_error: truncate(failureOutput),
          last_failure_kind: failureKind,
          last_failure_context: failureContext,
          ...applyFailureSignature(record, failureContext),
          blocked_reason: null,
          timeout_retry_count:
            failureKind === "timeout" ? record.timeout_retry_count + 1 : record.timeout_retry_count,
        });
        state.issues[String(record.issue_number)] = record;
        await this.stateStore.save(state);
        await syncJournal(record);
        return `Codex turn failed for issue #${record.issue_number}.`;
      }

      if (hintedState === "blocked" || hintedState === "failed") {
        const blockerSignature = hintedState === "blocked" ? normalizeBlockerSignature(codexResult.lastMessage) : null;
        const repeatedBlockerCount =
          hintedState === "blocked" && blockerSignature && blockerSignature === record.last_blocker_signature
            ? record.repeated_blocker_count + 1
            : hintedState === "blocked"
              ? 1
              : 0;
        const failureContext = buildCodexFailureContext(
          hintedState === "failed" ? "codex" : "blocked",
          `Codex reported ${hintedState} for issue #${record.issue_number}.`,
          [truncate(codexResult.lastMessage, 2000) ?? "No additional summary."],
        );
        if (hintedFailureSignature) {
          failureContext.signature = hintedFailureSignature;
        }
        record = this.stateStore.touch(record, {
          state: hintedState,
          last_error: truncate(codexResult.lastMessage),
          last_failure_kind: hintedState === "failed" ? "codex_failed" : null,
          last_failure_context: failureContext,
          ...applyFailureSignature(record, failureContext),
          repeated_blocker_count: repeatedBlockerCount,
          last_blocker_signature: blockerSignature,
          blocked_reason:
            hintedState === "blocked"
              ? hintedBlockedReason ?? (isVerificationBlockedMessage(codexResult.lastMessage) ? "verification" : "unknown")
              : null,
        });
        state.issues[String(record.issue_number)] = record;
        await this.stateStore.save(state);
        await syncJournal(record);
        return `Codex reported ${hintedState} for issue #${record.issue_number}.`;
      }

      workspaceStatus = await getWorkspaceStatus(workspacePath, record.branch, this.config.defaultBranch);
      record = this.stateStore.touch(record, { last_head_sha: workspaceStatus.headSha });

      if ((workspaceStatus.remoteAhead > 0 || !workspaceStatus.remoteBranchExists) && !workspaceStatus.hasUncommittedChanges) {
        await pushBranch(workspacePath, record.branch, workspaceStatus.remoteBranchExists);
        workspaceStatus = await getWorkspaceStatus(workspacePath, record.branch, this.config.defaultBranch);
      }

      resolvedPr = await this.github.resolvePullRequestForBranch(record.branch, record.pr_number);
      pr = isOpenPullRequest(resolvedPr) ? resolvedPr : null;
      if (
        !pr &&
        workspaceStatus.baseAhead > 0 &&
        !workspaceStatus.hasUncommittedChanges &&
        record.attempt_count >= this.config.draftPrAfterAttempt
      ) {
        pr = await this.github.createPullRequest(issue, record, { draft: true });
      }

      checks = pr ? await this.github.getChecks(pr.number) : [];
      reviewThreads = pr ? await this.github.getUnresolvedReviewThreads(pr.number) : [];
      const processedReviewThreadIds =
        preRunState === "addressing_review"
          ? Array.from(new Set([...record.processed_review_thread_ids, ...reviewThreadsToProcess.map((thread) => thread.id)]))
          : record.processed_review_thread_ids;
      const postRunFailureContext = inferFailureContext(this.config, record, pr, checks, reviewThreads);
      const postRunReviewWaitPatch = pr ? syncReviewWaitWindow(record, pr) : {};
      const postRunState = pr
        ? inferStateFromPullRequest(
            this.config,
            { ...record, processed_review_thread_ids: processedReviewThreadIds },
            pr,
            checks,
            reviewThreads,
          )
        : hintedState ?? inferStateWithoutPullRequest(record, workspaceStatus);
      record = this.stateStore.touch(record, {
        pr_number: pr?.number ?? null,
        ...postRunReviewWaitPatch,
        processed_review_thread_ids: processedReviewThreadIds,
        blocked_verification_retry_count: pr ? 0 : record.blocked_verification_retry_count,
        repeated_blocker_count: 0,
        last_blocker_signature: null,
        last_error: postRunState === "blocked" && postRunFailureContext ? truncate(postRunFailureContext.summary, 1000) : record.last_error,
        last_failure_context: postRunFailureContext,
        ...applyFailureSignature(record, postRunFailureContext),
        blocked_reason: pr && postRunState === "blocked" ? blockedReasonFromReviewState(this.config, reviewThreads) : null,
        state: postRunState,
      });
      state.issues[String(record.issue_number)] = record;
      await this.stateStore.save(state);
      await syncJournal(record);
      }

      if (pr) {
      const refreshedPr = await this.github.getPullRequest(pr.number);
      const refreshedChecks = await this.github.getChecks(pr.number);
      const refreshedReviewThreads = await this.github.getUnresolvedReviewThreads(pr.number);
      const refreshedCheckSummary = summarizeChecks(refreshedChecks);
      if (
        shouldRunLocalReview(this.config, record, refreshedPr) &&
        !refreshedCheckSummary.hasPending &&
        !refreshedCheckSummary.hasFailing &&
        configuredBotReviewThreads(this.config, refreshedReviewThreads).length === 0 &&
        (!this.config.humanReviewBlocksMerge || manualReviewThreads(this.config, refreshedReviewThreads).length === 0) &&
        !mergeConflictDetected(refreshedPr) &&
        !options.dryRun
      ) {
        record = this.stateStore.touch(record, { state: "local_review" });
        state.issues[String(record.issue_number)] = record;
        await this.stateStore.save(state);
        await syncJournal(record);

        try {
          const localReview = await runLocalReview({
            config: this.config,
            issue,
            branch: record.branch,
            workspacePath,
            defaultBranch: this.config.defaultBranch,
            pr: refreshedPr,
            alwaysReadFiles: memoryArtifacts.alwaysReadFiles,
            onDemandFiles: memoryArtifacts.onDemandFiles,
          });

          record = this.stateStore.touch(record, {
            state: "draft_pr",
            local_review_head_sha: refreshedPr.headRefOid,
            local_review_summary_path: localReview.summaryPath,
            local_review_run_at: localReview.ranAt,
            local_review_max_severity: localReview.maxSeverity,
            local_review_findings_count: localReview.findingsCount,
            last_error: null,
          });
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          record = this.stateStore.touch(record, {
            state: "draft_pr",
            local_review_head_sha: refreshedPr.headRefOid,
            local_review_run_at: nowIso(),
            local_review_max_severity: null,
            local_review_findings_count: 0,
            last_error: `Local review failed: ${truncate(message, 500) ?? "unknown error"}`,
          });
        }

        state.issues[String(record.issue_number)] = record;
        await this.stateStore.save(state);
        await syncJournal(record);
      }

      if (
        refreshedPr.isDraft &&
        !refreshedCheckSummary.hasPending &&
        !refreshedCheckSummary.hasFailing &&
        configuredBotReviewThreads(this.config, refreshedReviewThreads).length === 0 &&
        (!this.config.humanReviewBlocksMerge || manualReviewThreads(this.config, refreshedReviewThreads).length === 0) &&
        !mergeConflictDetected(refreshedPr) &&
        !options.dryRun
      ) {
        await this.github.markPullRequestReady(refreshedPr.number);
      }
      const postReadyPr = await this.github.getPullRequest(pr.number);
      const postReadyChecks = await this.github.getChecks(pr.number);
      const postReadyReviewThreads = await this.github.getUnresolvedReviewThreads(pr.number);
      const nextState = inferStateFromPullRequest(
        this.config,
        record,
        postReadyPr,
        postReadyChecks,
        postReadyReviewThreads,
      );
      const refreshedFailureContext = inferFailureContext(this.config, record, postReadyPr, postReadyChecks, postReadyReviewThreads);
      const refreshedReviewWaitPatch = syncReviewWaitWindow(record, postReadyPr);
      record = this.stateStore.touch(record, {
        pr_number: postReadyPr.number,
        ...refreshedReviewWaitPatch,
        state: nextState,
        last_head_sha: postReadyPr.headRefOid,
        last_error: nextState === "blocked" && refreshedFailureContext ? truncate(refreshedFailureContext.summary, 1000) : record.last_error,
        last_failure_context: refreshedFailureContext,
        ...applyFailureSignature(record, refreshedFailureContext),
        blocked_reason: nextState === "blocked" ? blockedReasonFromReviewState(this.config, postReadyReviewThreads) : null,
      });
      state.issues[String(record.issue_number)] = record;

      if (nextState === "ready_to_merge" && !options.dryRun) {
        await this.github.enableAutoMerge(postReadyPr.number, postReadyPr.headRefOid);
        record = this.stateStore.touch(record, { state: "merging" });
        state.issues[String(record.issue_number)] = record;
      }

      if (record.state === "done") {
        state.activeIssueNumber = null;
      }

      await this.stateStore.save(state);
      await syncJournal(record);
      return formatStatus(record);
      }

      state.issues[String(record.issue_number)] = record;
      await this.stateStore.save(state);
      await syncJournal(record);
      return formatStatus(record);
    } finally {
      await issueLock.release();
    }
  }
}
