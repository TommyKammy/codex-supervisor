import fs from "node:fs";
import path from "node:path";
import { buildCodexPrompt, extractBlockedReason, extractFailureSignature, extractStateHint, runCodexTurn } from "./codex";
import { loadConfig } from "./config";
import { ExternalReviewMissContext, loadRelevantExternalReviewMissPatterns, writeExternalReviewMissArtifact } from "./external-review-misses";
import { GitHubClient } from "./github";
import { findBlockingIssue, findParentIssuesReadyToClose, lintExecutionReadyIssueBody, parseIssueMetadata } from "./issue-metadata";
import { describeGsdIntegration } from "./gsd";
import { hasMeaningfulJournalHandoff, issueJournalPath, readIssueJournal, syncIssueJournal } from "./journal";
import { acquireFileLock, inspectFileLock, LockHandle } from "./lock";
import { localReviewHasActionableFindings, runLocalReview, shouldRunLocalReview } from "./local-review";
import { syncMemoryArtifacts } from "./memory";
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
import { nowIso, truncate, isTerminalState, hoursSince, parseJson } from "./utils";
import { loadRelevantVerifierGuardrails } from "./verifier-guardrails";
import {
  branchNameForIssue,
  cleanupWorkspace,
  ensureWorkspace,
  getWorkspaceStatus,
  isSafeCleanupTarget,
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
    copilot_review_requested_observed_at: null,
    copilot_review_requested_head_sha: null,
    copilot_review_timed_out_at: null,
    copilot_review_timeout_action: null,
    copilot_review_timeout_reason: null,
    codex_session_id: null,
    local_review_head_sha: null,
    local_review_summary_path: null,
    local_review_run_at: null,
    local_review_max_severity: null,
    local_review_findings_count: 0,
    local_review_root_cause_count: 0,
    local_review_verified_max_severity: null,
    local_review_verified_findings_count: 0,
    local_review_recommendation: null,
    local_review_degraded: false,
    last_local_review_signature: null,
    repeated_local_review_signature_count: 0,
    external_review_head_sha: null,
    external_review_misses_path: null,
    external_review_matched_findings_count: 0,
    external_review_near_match_findings_count: 0,
    external_review_missed_findings_count: 0,
    attempt_count: 0,
    implementation_attempt_count: 0,
    repair_attempt_count: 0,
    timeout_retry_count: 0,
    blocked_verification_retry_count: 0,
    repeated_blocker_count: 0,
    repeated_failure_signature_count: 0,
    last_head_sha: null,
    last_codex_summary: null,
    last_recovery_reason: null,
    last_recovery_at: null,
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

function localReviewBlocksReady(config: SupervisorConfig, record: Pick<IssueRunRecord, "local_review_head_sha" | "local_review_findings_count" | "local_review_recommendation">, pr: GitHubPullRequest): boolean {
  return config.localReviewPolicy === "block_ready" && localReviewHasActionableFindings(record, pr);
}

function localReviewBlocksMerge(config: SupervisorConfig, record: Pick<IssueRunRecord, "local_review_head_sha" | "local_review_findings_count" | "local_review_recommendation">, pr: GitHubPullRequest): boolean {
  return !pr.isDraft && config.localReviewPolicy === "block_merge" && localReviewHasActionableFindings(record, pr);
}

export function nextExternalReviewMissPatch(
  record: Pick<
    IssueRunRecord,
    | "external_review_head_sha"
    | "external_review_misses_path"
    | "external_review_matched_findings_count"
    | "external_review_near_match_findings_count"
    | "external_review_missed_findings_count"
  >,
  pr: Pick<GitHubPullRequest, "headRefOid"> | null,
  context: ExternalReviewMissContext | null,
): Partial<IssueRunRecord> {
  if (context && pr) {
    return {
      external_review_head_sha: pr.headRefOid,
      external_review_misses_path: context.artifactPath,
      external_review_matched_findings_count: context.matchedCount,
      external_review_near_match_findings_count: context.nearMatchCount,
      external_review_missed_findings_count: context.missedCount,
    };
  }

  if (pr && record.external_review_head_sha && record.external_review_head_sha !== pr.headRefOid) {
    return {
      external_review_head_sha: null,
      external_review_misses_path: null,
      external_review_matched_findings_count: 0,
      external_review_near_match_findings_count: 0,
      external_review_missed_findings_count: 0,
    };
  }

  return {};
}

export function localReviewHighSeverityNeedsRetry(
  config: SupervisorConfig,
  record: Pick<IssueRunRecord, "local_review_head_sha" | "local_review_verified_max_severity">,
  pr: GitHubPullRequest,
): boolean {
  return (
    config.localReviewPolicy !== "advisory" &&
    record.local_review_head_sha === pr.headRefOid &&
    record.local_review_verified_max_severity === "high" &&
    config.localReviewHighSeverityAction === "retry"
  );
}

interface LocalReviewRepairArtifact {
  branch?: string;
  headSha?: string;
  actionableFindings?: Array<{ file?: string | null }>;
  rootCauseSummaries?: Array<{
    severity?: "low" | "medium" | "high";
    summary?: string;
    file?: string | null;
    start?: number | null;
    end?: number | null;
  }>;
}

export async function loadLocalReviewRepairContext(summaryPath: string | null, workspacePath?: string) {
  if (!summaryPath) {
    return null;
  }

  const findingsPath =
    path.extname(summaryPath) === ".md"
      ? `${summaryPath.slice(0, -3)}.json`
      : null;
  if (!findingsPath) {
    return null;
  }

  let raw: string;
  try {
    raw = await fs.promises.readFile(findingsPath, "utf8");
  } catch (error) {
    const maybeErr = error as NodeJS.ErrnoException;
    if (maybeErr.code === "ENOENT") {
      return null;
    }

    throw error;
  }

  const artifact = parseJson<LocalReviewRepairArtifact>(raw, findingsPath);
  const rootCauses = (artifact.rootCauseSummaries ?? [])
    .filter((rootCause) => typeof rootCause.summary === "string" && rootCause.summary.trim() !== "")
    .slice(0, 5)
    .map((rootCause) => {
      const start = typeof rootCause.start === "number" ? rootCause.start : null;
      const end = typeof rootCause.end === "number" ? rootCause.end : start;
      return {
        severity: rootCause.severity ?? "medium",
        summary: rootCause.summary!.trim(),
        file: rootCause.file ?? null,
        lines:
          start == null
            ? null
            : end != null && end !== start
              ? `${start}-${end}`
              : `${start}`,
      };
    });
  const relevantFiles = [...new Set([
    ...rootCauses.map((rootCause) => rootCause.file).filter((filePath): filePath is string => Boolean(filePath)),
    ...(artifact.actionableFindings ?? [])
      .map((finding) => (typeof finding.file === "string" && finding.file.trim() !== "" ? finding.file : null))
      .filter((filePath): filePath is string => Boolean(filePath)),
  ])].slice(0, 10);
  const priorMissPatterns =
    workspacePath && typeof artifact.branch === "string" && typeof artifact.headSha === "string"
      ? await loadRelevantExternalReviewMissPatterns({
          artifactDir: path.dirname(summaryPath),
          branch: artifact.branch,
          currentHeadSha: artifact.headSha,
          changedFiles: relevantFiles,
          limit: 3,
          workspacePath,
        })
      : [];
  const verifierGuardrails =
    workspacePath
      ? await loadRelevantVerifierGuardrails({
          workspacePath,
          changedFiles: relevantFiles,
          limit: 3,
        })
      : [];

  return {
    summaryPath,
    findingsPath,
    relevantFiles,
    rootCauses,
    priorMissPatterns,
    verifierGuardrails,
  };
}

function localReviewRetryLoopCandidate(
  config: SupervisorConfig,
  record: Pick<IssueRunRecord, "local_review_head_sha" | "local_review_verified_max_severity" | "repeated_local_review_signature_count" | "processed_review_thread_ids">,
  pr: GitHubPullRequest,
  checks: PullRequestCheck[],
  reviewThreads: ReviewThread[],
): boolean {
  const checkSummary = summarizeChecks(checks);
  const manualThreads = manualReviewThreads(config, reviewThreads);
  const unresolvedBotThreads = configuredBotReviewThreads(config, reviewThreads);
  return (
    localReviewHighSeverityNeedsRetry(config, record, pr) &&
    !checkSummary.hasFailing &&
    !checkSummary.hasPending &&
    unresolvedBotThreads.length === 0 &&
    (!config.humanReviewBlocksMerge || manualThreads.length === 0) &&
    !mergeConflictDetected(pr)
  );
}

function localReviewRetryLoopStalled(
  config: SupervisorConfig,
  record: Pick<IssueRunRecord, "local_review_head_sha" | "local_review_verified_max_severity" | "repeated_local_review_signature_count" | "processed_review_thread_ids">,
  pr: GitHubPullRequest,
  checks: PullRequestCheck[],
  reviewThreads: ReviewThread[],
): boolean {
  return (
    localReviewRetryLoopCandidate(config, record, pr, checks, reviewThreads) &&
    record.repeated_local_review_signature_count >= config.sameFailureSignatureRepeatLimit
  );
}

function localReviewHighSeverityNeedsBlock(
  config: SupervisorConfig,
  record: Pick<IssueRunRecord, "local_review_head_sha" | "local_review_verified_max_severity">,
  pr: GitHubPullRequest,
): boolean {
  return (
    config.localReviewPolicy !== "advisory" &&
    record.local_review_head_sha === pr.headRefOid &&
    record.local_review_verified_max_severity === "high" &&
    config.localReviewHighSeverityAction === "blocked"
  );
}

function localReviewFailureSummary(
  record: Pick<
    IssueRunRecord,
    | "local_review_findings_count"
    | "local_review_root_cause_count"
    | "local_review_max_severity"
    | "local_review_verified_findings_count"
    | "local_review_verified_max_severity"
    | "local_review_degraded"
  >,
): string {
  if (record.local_review_degraded) {
    return "Local review completed in a degraded state.";
  }

  return `Local review found ${record.local_review_findings_count} actionable finding(s) across ${record.local_review_root_cause_count} root cause(s); max severity=${record.local_review_max_severity ?? "unknown"}; verified high-severity findings=${record.local_review_verified_findings_count}; verified max severity=${record.local_review_verified_max_severity ?? "none"}.`;
}

function localReviewFailureContext(
  record: Pick<
    IssueRunRecord,
    | "local_review_findings_count"
    | "local_review_root_cause_count"
    | "local_review_max_severity"
    | "local_review_verified_findings_count"
    | "local_review_verified_max_severity"
    | "local_review_degraded"
    | "local_review_summary_path"
  >,
): FailureContext {
  return {
    category: "blocked",
    summary: localReviewFailureSummary(record),
    signature: `local-review:${record.local_review_max_severity ?? "unknown"}:${record.local_review_verified_max_severity ?? "none"}:${record.local_review_root_cause_count}:${record.local_review_verified_findings_count}:${record.local_review_degraded ? "degraded" : "clean"}`,
    command: null,
    details: [
      `findings=${record.local_review_findings_count}`,
      `root_causes=${record.local_review_root_cause_count}`,
      record.local_review_summary_path ? `summary=${record.local_review_summary_path}` : "summary=none",
    ],
    url: null,
    updated_at: nowIso(),
  };
}

function localReviewStallFailureContext(
  record: Pick<
    IssueRunRecord,
    | "local_review_findings_count"
    | "local_review_root_cause_count"
    | "local_review_max_severity"
    | "local_review_verified_findings_count"
    | "local_review_verified_max_severity"
    | "local_review_degraded"
    | "local_review_summary_path"
    | "repeated_local_review_signature_count"
  >,
): FailureContext {
  return {
    ...localReviewFailureContext(record),
    summary:
      `Local review findings repeated without code changes ${record.repeated_local_review_signature_count} times; manual intervention is required.`,
    signature:
      `local-review-stalled:${record.local_review_max_severity ?? "unknown"}:` +
      `${record.local_review_root_cause_count}:${record.local_review_degraded ? "degraded" : "clean"}`,
    details: [
      `findings=${record.local_review_findings_count}`,
      `root_causes=${record.local_review_root_cause_count}`,
      `repeated_local_review_signature_count=${record.repeated_local_review_signature_count}`,
      record.local_review_summary_path ? `summary=${record.local_review_summary_path}` : "summary=none",
    ],
  };
}

function nextLocalReviewSignatureTracking(
  record: Pick<IssueRunRecord, "local_review_head_sha" | "last_local_review_signature" | "repeated_local_review_signature_count">,
  prHeadSha: string,
  actionableSignature: string | null,
): Pick<IssueRunRecord, "last_local_review_signature" | "repeated_local_review_signature_count"> {
  if (!actionableSignature) {
    return {
      last_local_review_signature: null,
      repeated_local_review_signature_count: 0,
    };
  }

  const sameHead = record.local_review_head_sha === prHeadSha;
  const sameSignature = record.last_local_review_signature === actionableSignature;
  return {
    last_local_review_signature: actionableSignature,
    repeated_local_review_signature_count:
      sameHead && sameSignature ? record.repeated_local_review_signature_count + 1 : 1,
  };
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

function buildExecutionReadyFailureContext(
  issue: Pick<GitHubIssue, "number" | "url">,
  missingRequired: string[],
  missingRecommended: string[],
): FailureContext {
  const missingRequiredText = formatExecutionReadyMissingFields(missingRequired);
  return {
    category: "blocked",
    summary:
      `Issue #${issue.number} is not execution-ready because it is missing: ` +
      `${missingRequiredText}.`,
    signature: `requirements:${missingRequired.join("|")}`,
    command: null,
    details: [
      `missing_required=${missingRequiredText}`,
      `missing_recommended=${
        missingRecommended.length > 0 ? formatExecutionReadyMissingFields(missingRecommended) : "none"
      }`,
    ],
    url: issue.url,
    updated_at: nowIso(),
  };
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
  record: Pick<IssueRunRecord, "processed_review_thread_ids">,
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

    const copilotTimeoutContext = buildCopilotReviewTimeoutFailureContext(config, record, pr);
    if (copilotTimeoutContext) {
      return copilotTimeoutContext;
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

interface CopilotReviewTimeoutStatus {
  timedOut: boolean;
  action: SupervisorConfig["copilotReviewTimeoutAction"] | null;
  startedAt: string | null;
  timedOutAt: string | null;
  reason: string | null;
}

function copilotReviewArrived(pr: GitHubPullRequest): boolean {
  return (pr.copilotReviewState ?? "not_requested") === "arrived" || Boolean(pr.copilotReviewArrivedAt);
}

function hasObservedCopilotRequest(record: IssueRunRecord, pr: GitHubPullRequest): boolean {
  return Boolean(record.copilot_review_requested_observed_at && record.copilot_review_requested_head_sha === pr.headRefOid);
}

function copilotReviewPending(record: IssueRunRecord, pr: GitHubPullRequest): boolean {
  if (pr.isDraft || copilotReviewArrived(pr)) {
    return false;
  }

  return (pr.copilotReviewState ?? "not_requested") === "requested" || hasObservedCopilotRequest(record, pr);
}

function copilotReviewTimeoutStart(record: IssueRunRecord, pr: GitHubPullRequest): string | null {
  if (!copilotReviewPending(record, pr)) {
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
  const startedAt = copilotReviewTimeoutStart(record, pr);
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
      `Requested Copilot review never arrived within ${config.copilotReviewWaitMinutes} minute(s) ` +
      `for head ${pr.headRefOid}.`,
  };
}

function repoExpectsCopilotReview(config: SupervisorConfig): boolean {
  return config.reviewBotLogins.includes(COPILOT_REVIEWER_LOGIN);
}

function shouldWaitForCopilotReviewPropagation(
  config: SupervisorConfig,
  record: Pick<IssueRunRecord, "review_wait_started_at" | "review_wait_head_sha">,
  pr: GitHubPullRequest,
): boolean {
  if (
    !repoExpectsCopilotReview(config) ||
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
    summary: `PR #${pr.number} is blocked after a requested Copilot review timed out.`,
    signature: `copilot-timeout:${pr.headRefOid}:${timeout.action}`,
    command: null,
    details: [
      `requested_at=${timeout.startedAt ?? "none"}`,
      `timed_out_at=${timeout.timedOutAt ?? "none"}`,
      `timeout_minutes=${config.copilotReviewWaitMinutes}`,
      timeout.reason ?? "Requested Copilot review timed out.",
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
    return "copilot_timeout";
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

function syncCopilotReviewRequestObservation(record: IssueRunRecord, pr: GitHubPullRequest): Partial<IssueRunRecord> {
  if (pr.isDraft || copilotReviewArrived(pr)) {
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

  if (hasObservedCopilotRequest(record, pr)) {
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

  if (localReviewRetryLoopStalled(config, record, pr, checks, reviewThreads)) {
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

  if (copilotReviewPending(record, pr) && !copilotTimeout.timedOut) {
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
  const copilotRequestObservationPatch = syncCopilotReviewRequestObservation(baseRecord, pr);
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
    if (shouldEnforceExecutionReady(existing)) {
      const readiness = lintExecutionReadyIssueBody(issue);
      if (!readiness.isExecutionReady) {
        blocked.push(
          `#${issue.number} blocked_by=requirements:${formatExecutionReadyMissingFields(readiness.missingRequired)}`,
        );
        continue;
      }
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

    runnable.push(`#${issue.number} ready=${formatRunnableReadinessReason(issue, issues, state)}`);
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
): string {
  const metadata = parseIssueMetadata(issue);
  const reasons = ["execution_ready"];

  if (metadata.dependsOn.length > 0) {
    const satisfiedDependencies = metadata.dependsOn.filter(
      (dependencyNumber) => state.issues[String(dependencyNumber)]?.state === "done",
    );

    if (satisfiedDependencies.length > 0) {
      reasons.push(`depends_on_satisfied:${satisfiedDependencies.join(",")}`);
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
      reasons.push(`execution_order_satisfied:${clearedPredecessors.join(",")}`);
    }
  }

  return reasons.join("+");
}

type IssueJournalSync = (record: IssueRunRecord) => Promise<void>;
type MemoryArtifacts = Awaited<ReturnType<typeof syncMemoryArtifacts>>;

interface SelectedIssueResult {
  kind: "selected";
  record: IssueRunRecord;
}

interface PreparedWorkspaceContext {
  record: IssueRunRecord;
  issue: GitHubIssue;
  previousCodexSummary: string | null;
  previousError: string | null;
  workspacePath: string;
  journalPath: string;
  syncJournal: IssueJournalSync;
  memoryArtifacts: MemoryArtifacts;
  workspaceStatus: WorkspaceStatus;
}

interface ReadyIssueContext {
  kind: "ready";
  record: IssueRunRecord;
  issue: GitHubIssue;
  issueLock: LockHandle;
}

interface HydratedPullRequestContext {
  record: IssueRunRecord;
  pr: GitHubPullRequest | null;
  checks: PullRequestCheck[];
  reviewThreads: ReviewThread[];
  workspaceStatus: WorkspaceStatus;
}

interface PreparedIssueExecutionContext extends PreparedWorkspaceContext, HydratedPullRequestContext {}

interface RestartRunOnce {
  kind: "restart";
  recoveryEvents?: RecoveryEvent[];
}

function isRestartRunOnce(result: HydratedPullRequestContext | PreparedIssueExecutionContext | RestartRunOnce): result is RestartRunOnce {
  return "kind" in result && result.kind === "restart";
}

interface CodexTurnContext {
  state: SupervisorStateFile;
  record: IssueRunRecord;
  issue: GitHubIssue;
  previousCodexSummary: string | null;
  previousError: string | null;
  workspacePath: string;
  journalPath: string;
  syncJournal: IssueJournalSync;
  memoryArtifacts: MemoryArtifacts;
  workspaceStatus: WorkspaceStatus;
  pr: GitHubPullRequest | null;
  checks: PullRequestCheck[];
  reviewThreads: ReviewThread[];
  options: Pick<CliOptions, "dryRun">;
}

interface CodexTurnResult {
  kind: "completed";
  record: IssueRunRecord;
  workspaceStatus: WorkspaceStatus;
  pr: GitHubPullRequest | null;
  checks: PullRequestCheck[];
  reviewThreads: ReviewThread[];
}

interface CodexTurnShortCircuit {
  kind: "returned";
  message: string;
}

interface PreparedIssueRunContext extends PreparedIssueExecutionContext {
  state: SupervisorStateFile;
  options: Pick<CliOptions, "dryRun">;
  recoveryLog: string | null;
}

interface PostTurnPullRequestContext {
  state: SupervisorStateFile;
  record: IssueRunRecord;
  issue: GitHubIssue;
  workspacePath: string;
  syncJournal: IssueJournalSync;
  memoryArtifacts: MemoryArtifacts;
  pr: GitHubPullRequest;
  options: Pick<CliOptions, "dryRun">;
}

interface PostTurnPullRequestResult {
  record: IssueRunRecord;
  pr: GitHubPullRequest;
  checks: PullRequestCheck[];
  reviewThreads: ReviewThread[];
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

interface RecoveryEvent {
  issueNumber: number;
  reason: string;
  at: string;
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
} {
  return {
    status: localReviewHeadStatus(record, pr),
    reviewedHeadSha: record.local_review_head_sha ?? "none",
    prHeadSha: pr?.headRefOid ?? "unknown",
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
    pr && localReviewRetryLoopStalled(config, activeRecord, pr, checks, reviewThreads) ? "yes" : "no";
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
    `local_review gating=${localReviewGating} policy=${config.localReviewPolicy} findings=${activeRecord.local_review_findings_count} root_causes=${activeRecord.local_review_root_cause_count} max_severity=${activeRecord.local_review_max_severity ?? "none"} verified_findings=${activeRecord.local_review_verified_findings_count} verified_max_severity=${activeRecord.local_review_verified_max_severity ?? "none"} head=${localReviewHead.status} reviewed_head_sha=${localReviewHead.reviewedHeadSha} pr_head_sha=${localReviewHead.prHeadSha} ran_at=${activeRecord.local_review_run_at ?? "none"} signature=${activeRecord.last_local_review_signature ?? "none"} repeated=${activeRecord.repeated_local_review_signature_count} stalled=${localReviewStalled}`,
    `external_review head=${externalReviewHeadStatus} reviewed_head_sha=${activeRecord.external_review_head_sha ?? "none"} matched=${activeRecord.external_review_matched_findings_count} near_match=${activeRecord.external_review_near_match_findings_count} missed=${activeRecord.external_review_missed_findings_count}`,
  ];

  if (activeRecord.last_error) {
    const sanitizedLastError = sanitizeStatusValue(activeRecord.last_error);
    lines.push(`last_error=${truncate(sanitizedLastError, 300)}`);
  }

  if (pr) {
    const copilotReviewState = pr.copilotReviewState === null ? "unknown" : (pr.copilotReviewState ?? "not_requested");
    lines.push(
      `copilot_review state=${copilotReviewState} requested_at=${pr.copilotReviewRequestedAt ?? "none"} arrived_at=${pr.copilotReviewArrivedAt ?? "none"} timed_out_at=${activeRecord.copilot_review_timed_out_at ?? "none"} timeout_action=${activeRecord.copilot_review_timeout_action ?? "none"}`,
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
      `review_threads bot_pending=${pendingBotReviewThreads(config, activeRecord, reviewThreads).length} bot_unresolved=${configuredBotReviewThreads(config, reviewThreads).length} manual=${manualReviewThreads(config, reviewThreads).length}`,
    );
  }

  if (activeRecord.last_failure_context) {
    lines.push(
      `failure_context category=${activeRecord.last_failure_context.category ?? "none"} summary=${truncate(activeRecord.last_failure_context.summary, 200) ?? "none"}`,
    );
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
): Promise<void> {
  if (config.cleanupDoneWorkspacesAfterHours < 0 && config.maxDoneWorkspaces < 0) {
    return;
  }

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
    return;
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
}

function doneResetPatch(
  patch: Partial<IssueRunRecord> = {},
): Partial<IssueRunRecord> {
  return {
    state: "done",
    last_error: null,
    blocked_reason: null,
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
      ...syncCopilotReviewRequestObservation(record, pr),
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

  private async selectIssueRecord(
    state: SupervisorStateFile,
    currentRecord: IssueRunRecord | null,
  ): Promise<SelectedIssueResult | string> {
    let record = currentRecord;

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

    return {
      kind: "selected",
      record,
    };
  }

  private async prepareWorkspaceContext(
    state: SupervisorStateFile,
    record: IssueRunRecord,
    issue: GitHubIssue,
  ): Promise<PreparedWorkspaceContext> {
    const previousCodexSummary = record.last_codex_summary;
    const previousError = record.last_error;
    const workspacePath = await ensureWorkspace(this.config, record.issue_number, record.branch);
    const journalPath = issueJournalPath(workspacePath, this.config.issueJournalRelativePath);
    const syncJournal: IssueJournalSync = async (currentRecord: IssueRunRecord): Promise<void> => {
      await syncIssueJournal({
        issue,
        record: currentRecord,
        journalPath,
        maxChars: this.config.issueJournalMaxChars,
      });
    };

    const preparedRecord = this.stateStore.touch(record, {
      workspace: workspacePath,
      journal_path: journalPath,
      state: record.implementation_attempt_count === 0 ? "planning" : record.state,
      last_error: null,
      last_failure_kind: null,
      blocked_reason: null,
    });
    state.issues[String(preparedRecord.issue_number)] = preparedRecord;
    await this.stateStore.save(state);
    await syncJournal(preparedRecord);

    const memoryArtifacts = await syncMemoryArtifacts({
      config: this.config,
      issueNumber: preparedRecord.issue_number,
      workspacePath,
      journalPath,
    });

    const workspaceStatus = await getWorkspaceStatus(workspacePath, preparedRecord.branch, this.config.defaultBranch);
    const hydratedRecord = this.stateStore.touch(preparedRecord, { last_head_sha: workspaceStatus.headSha });
    state.issues[String(hydratedRecord.issue_number)] = hydratedRecord;
    await this.stateStore.save(state);

    return {
      record: hydratedRecord,
      issue,
      previousCodexSummary,
      previousError,
      workspacePath,
      journalPath,
      syncJournal,
      memoryArtifacts,
      workspaceStatus,
    };
  }

  private async resolveRunnableIssueContext(
    state: SupervisorStateFile,
    currentRecord: IssueRunRecord | null,
  ): Promise<ReadyIssueContext | RestartRunOnce | string> {
    const selectedIssue = await this.selectIssueRecord(state, currentRecord);
    if (typeof selectedIssue === "string") {
      return selectedIssue;
    }

    let record = selectedIssue.record;
    const issueLock = await acquireFileLock(
      this.lockPath("issues", `issue-${record.issue_number}`),
      `issue-${record.issue_number}`,
    );
    if (!issueLock.acquired) {
      return `Skipped issue #${record.issue_number}: ${issueLock.reason}.`;
    }

    let shouldReleaseIssueLock = true;
    try {
      const issue = await this.github.getIssue(record.issue_number);
      if (issue.state === "CLOSED" && record.pr_number !== null) {
        record = this.stateStore.touch(record, { state: "done" });
        state.issues[String(record.issue_number)] = record;
        state.activeIssueNumber = null;
        await this.stateStore.save(state);
        shouldReleaseIssueLock = false;
        await issueLock.release();
        return { kind: "restart" };
      }

      if (shouldEnforceExecutionReady(record)) {
        const readiness = lintExecutionReadyIssueBody(issue);
        if (!readiness.isExecutionReady) {
          const failureContext = buildExecutionReadyFailureContext(
            issue,
            readiness.missingRequired,
            readiness.missingRecommended,
          );
          const blockedRecord = this.stateStore.touch(record, {
            state: "blocked",
            last_error: truncate(
              `Missing required execution-ready metadata: ${formatExecutionReadyMissingFields(readiness.missingRequired)}.`,
              1000,
            ),
            last_failure_kind: null,
            last_failure_context: failureContext,
            ...applyFailureSignature(record, failureContext),
            blocked_reason: "requirements",
          });
          state.issues[String(blockedRecord.issue_number)] = blockedRecord;
          state.activeIssueNumber = null;
          await this.stateStore.save(state);
          if (blockedRecord.journal_path) {
            await syncIssueJournal({
              issue,
              record: blockedRecord,
              journalPath: blockedRecord.journal_path,
              maxChars: this.config.issueJournalMaxChars,
            });
          }
          shouldReleaseIssueLock = false;
          await issueLock.release();
          return { kind: "restart" };
        }
      }

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
        shouldReleaseIssueLock = false;
        await issueLock.release();
        return { kind: "restart" };
      }

      const budgetLaneBeforeWorkspace = attemptLane(record, null);
      if (!hasAttemptBudgetRemaining(record, this.config, budgetLaneBeforeWorkspace)) {
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
        shouldReleaseIssueLock = false;
        await issueLock.release();
        return `Issue #${record.issue_number} reached max ${budgetLaneBeforeWorkspace} Codex attempts.`;
      }

      shouldReleaseIssueLock = false;
      return {
        kind: "ready",
        record,
        issue,
        issueLock,
      };
    } catch (error) {
      if (shouldReleaseIssueLock) {
        await issueLock.release();
      }
      throw error;
    }
  }

  private async hydratePullRequestContext(
    state: SupervisorStateFile,
    record: IssueRunRecord,
    issue: GitHubIssue,
    workspacePath: string,
    workspaceStatus: WorkspaceStatus,
    syncJournal: IssueJournalSync,
    options: Pick<CliOptions, "dryRun">,
  ): Promise<HydratedPullRequestContext | RestartRunOnce | string> {
    let nextWorkspaceStatus = workspaceStatus;
    if (nextWorkspaceStatus.remoteBranchExists && nextWorkspaceStatus.remoteAhead > 0) {
      await pushBranch(workspacePath, record.branch, true);
      nextWorkspaceStatus = await getWorkspaceStatus(workspacePath, record.branch, this.config.defaultBranch);
    }

    const resolvedPr = await this.github.resolvePullRequestForBranch(record.branch, record.pr_number);
    let pr = isOpenPullRequest(resolvedPr) ? resolvedPr : null;
    let checks = pr ? await this.github.getChecks(pr.number) : [];
    let reviewThreads = pr ? await this.github.getUnresolvedReviewThreads(pr.number) : [];

    if (!pr) {
      if (!resolvedPr) {
        // No current or historical PR for this branch; continue with normal branch/PR flow.
      } else if (resolvedPr.mergedAt || resolvedPr.state === "MERGED") {
        const recoveryEvent = buildRecoveryEvent(
          record.issue_number,
          `merged_pr_convergence: tracked PR #${resolvedPr.number} merged; marked issue #${record.issue_number} done`,
        );
        const doneRecord = this.stateStore.touch(record, {
          pr_number: resolvedPr.number,
          state: "done",
          last_head_sha: resolvedPr.headRefOid,
          ...applyRecoveryEvent({}, recoveryEvent),
        });
        state.issues[String(doneRecord.issue_number)] = doneRecord;
        state.activeIssueNumber = null;
        await this.stateStore.save(state);
        return { kind: "restart", recoveryEvents: [recoveryEvent] };
      } else if (resolvedPr.state === "CLOSED") {
        const failureContext = buildCodexFailureContext(
          "manual",
          `PR #${resolvedPr.number} was closed without merge.`,
          ["Manual intervention is required before the supervisor can continue this issue."],
        );
        const blockedRecord = this.stateStore.touch(record, {
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
        state.issues[String(blockedRecord.issue_number)] = blockedRecord;
        state.activeIssueNumber = null;
        await this.stateStore.save(state);
        await syncJournal(blockedRecord);
        return `Issue #${blockedRecord.issue_number} blocked because PR #${resolvedPr.number} was closed without merge.`;
      }
    }

    if (
      !pr &&
      nextWorkspaceStatus.baseAhead > 0 &&
      !nextWorkspaceStatus.hasUncommittedChanges &&
      record.implementation_attempt_count >= this.config.draftPrAfterAttempt
    ) {
      await pushBranch(workspacePath, record.branch, nextWorkspaceStatus.remoteBranchExists);
      pr = await this.github.createPullRequest(issue, record, { draft: true });
      checks = await this.github.getChecks(pr.number);
      reviewThreads = await this.github.getUnresolvedReviewThreads(pr.number);
    }

    return {
      record,
      pr,
      checks,
      reviewThreads,
      workspaceStatus: nextWorkspaceStatus,
    };
  }

  private async prepareIssueExecutionContext(
    state: SupervisorStateFile,
    record: IssueRunRecord,
    issue: GitHubIssue,
    options: Pick<CliOptions, "dryRun">,
  ): Promise<PreparedIssueExecutionContext | RestartRunOnce | string> {
    const preparedWorkspace = await this.prepareWorkspaceContext(state, record, issue);
    const hydratedPullRequest = await this.hydratePullRequestContext(
      state,
      preparedWorkspace.record,
      issue,
      preparedWorkspace.workspacePath,
      preparedWorkspace.workspaceStatus,
      preparedWorkspace.syncJournal,
      options,
    );
    if (typeof hydratedPullRequest === "string") {
      return hydratedPullRequest;
    }
    if (isRestartRunOnce(hydratedPullRequest)) {
      return hydratedPullRequest;
    }

    return {
      ...preparedWorkspace,
      ...hydratedPullRequest,
    };
  }

  private async executeCodexTurn(context: CodexTurnContext): Promise<CodexTurnResult | CodexTurnShortCircuit> {
    let {
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
    } = context;

    try {
      const reviewThreadsToProcess = pendingBotReviewThreads(this.config, record, reviewThreads);

      if (options.dryRun) {
        record = this.stateStore.touch(record, {
          state: pr
            ? inferStateFromPullRequest(this.config, record, pr, checks, reviewThreads)
            : inferStateWithoutPullRequest(record, workspaceStatus),
        });
        state.issues[String(record.issue_number)] = record;
        await this.stateStore.save(state);
        return {
          kind: "returned",
          message: `Dry run: would invoke Codex for issue #${record.issue_number}. ${formatStatus(record)}`,
        };
      }

      const preRunState: RunState = pr
        ? inferStateFromPullRequest(this.config, record, pr, checks, reviewThreads)
        : inferStateWithoutPullRequest(record, workspaceStatus);
      const preRunAttemptLane = attemptLane(record, pr);
      record = this.stateStore.touch(record, {
        state: preRunState,
        ...incrementAttemptCounters(record, preRunAttemptLane),
        last_failure_context: inferFailureContext(this.config, record, pr, checks, reviewThreads),
        blocked_reason: null,
      });
      state.issues[String(record.issue_number)] = record;
      await this.stateStore.save(state);
      await syncJournal(record);

      const journalContent = await readIssueJournal(journalPath);
      const localReviewRepairContext =
        record.state === "local_review_fix"
          ? await loadLocalReviewRepairContext(record.local_review_summary_path, workspacePath)
          : null;
      const externalReviewMissContext: ExternalReviewMissContext | null =
        pr &&
        preRunState === "addressing_review" &&
        reviewThreadsToProcess.length > 0 &&
        record.local_review_head_sha === pr.headRefOid &&
        record.local_review_summary_path
          ? await writeExternalReviewMissArtifact({
              artifactDir: path.dirname(record.local_review_summary_path),
              issueNumber: issue.number,
              prNumber: pr.number,
              branch: record.branch,
              headSha: pr.headRefOid,
              reviewThreads: reviewThreadsToProcess,
              reviewBotLogins: this.config.reviewBotLogins,
              localReviewSummaryPath: record.local_review_summary_path,
            })
          : null;
      const externalReviewMissPatch = nextExternalReviewMissPatch(record, pr, externalReviewMissContext);
      if (Object.keys(externalReviewMissPatch).length > 0) {
        record = this.stateStore.touch(record, externalReviewMissPatch);
        state.issues[String(record.issue_number)] = record;
        await this.stateStore.save(state);
        await syncJournal(record);
      }

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
        gsdEnabled: this.config.gsdEnabled,
        gsdPlanningFiles: this.config.gsdPlanningFiles,
        localReviewRepairContext,
        externalReviewMissContext,
      });

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

      let codexResult;
      try {
        codexResult = await runCodexTurn(
          this.config,
          workspacePath,
          prompt,
          record.state,
          record,
          record.codex_session_id,
        );
      } catch (error) {
        const message = error instanceof Error ? error.stack ?? error.message : String(error);
        const failureKind = classifyFailure(message);
        const failureContext = buildCodexFailureContext(
          "codex",
          `Codex turn execution failed for issue #${record.issue_number}.`,
          [truncate(message, 2000) ?? "Unknown failure"],
        );
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
        return {
          kind: "returned",
          message: `Codex turn failed for issue #${record.issue_number}.`,
        };
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
        return {
          kind: "returned",
          message: `Codex turn for issue #${record.issue_number} was rejected because no journal handoff was written.`,
        };
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
        return {
          kind: "returned",
          message: `Codex turn failed for issue #${record.issue_number}.`,
        };
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
        return {
          kind: "returned",
          message: `Codex reported ${hintedState} for issue #${record.issue_number}.`,
        };
      }

      workspaceStatus = await getWorkspaceStatus(workspacePath, record.branch, this.config.defaultBranch);
      record = this.stateStore.touch(record, { last_head_sha: workspaceStatus.headSha });

      if ((workspaceStatus.remoteAhead > 0 || !workspaceStatus.remoteBranchExists) && !workspaceStatus.hasUncommittedChanges) {
        await pushBranch(workspacePath, record.branch, workspaceStatus.remoteBranchExists);
        workspaceStatus = await getWorkspaceStatus(workspacePath, record.branch, this.config.defaultBranch);
      }

      const refreshedResolvedPr = await this.github.resolvePullRequestForBranch(record.branch, record.pr_number);
      pr = isOpenPullRequest(refreshedResolvedPr) ? refreshedResolvedPr : null;
      if (
        !pr &&
        workspaceStatus.baseAhead > 0 &&
        !workspaceStatus.hasUncommittedChanges &&
        record.implementation_attempt_count >= this.config.draftPrAfterAttempt
      ) {
        pr = await this.github.createPullRequest(issue, record, { draft: true });
      }

      checks = pr ? await this.github.getChecks(pr.number) : [];
      reviewThreads = pr ? await this.github.getUnresolvedReviewThreads(pr.number) : [];
      const processedReviewThreadIds =
        preRunState === "addressing_review"
          ? trimProcessedReviewThreadIds(
              Array.from(new Set([...record.processed_review_thread_ids, ...reviewThreadsToProcess.map((thread) => thread.id)])),
            )
          : record.processed_review_thread_ids;
      const postRunSnapshot = pr
        ? derivePullRequestLifecycleSnapshot(
            this.config,
            record,
            pr,
            checks,
            reviewThreads,
            { processed_review_thread_ids: processedReviewThreadIds },
          )
        : null;
      const postRunState = postRunSnapshot
        ? postRunSnapshot.nextState
        : hintedState ?? inferStateWithoutPullRequest(record, workspaceStatus);
      record = this.stateStore.touch(record, {
        pr_number: pr?.number ?? null,
        ...(postRunSnapshot?.reviewWaitPatch ?? {}),
        ...(postRunSnapshot?.copilotRequestObservationPatch ?? {}),
        ...(postRunSnapshot?.copilotTimeoutPatch ?? {}),
        processed_review_thread_ids: processedReviewThreadIds,
        blocked_verification_retry_count: pr ? 0 : record.blocked_verification_retry_count,
        repeated_blocker_count: 0,
        last_blocker_signature: null,
        last_error:
          postRunState === "blocked" && postRunSnapshot?.failureContext
            ? truncate(postRunSnapshot.failureContext.summary, 1000)
            : record.last_error,
        last_failure_context: postRunSnapshot?.failureContext ?? null,
        ...applyFailureSignature(record, postRunSnapshot?.failureContext ?? null),
        blocked_reason:
          pr && postRunState === "blocked"
            ? blockedReasonFromReviewState(this.config, postRunSnapshot?.recordForState ?? record, pr, reviewThreads)
            : null,
        state: postRunState,
      });
      state.issues[String(record.issue_number)] = record;
      await this.stateStore.save(state);
      await syncJournal(record);

      return {
        kind: "completed",
        record,
        workspaceStatus,
        pr,
        checks,
        reviewThreads,
      };
    } catch (error) {
      record = await recoverUnexpectedCodexTurnFailure({
        stateStore: this.stateStore,
        state,
        record,
        issue,
        journalSync: syncJournal,
        error,
        workspaceStatus,
        pr,
      });
      return {
        kind: "returned",
        message: `Recovered from unexpected Codex turn failure for issue #${record.issue_number}.`,
      };
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
    const { state, issue, workspacePath, syncJournal, memoryArtifacts, options } = context;
    let { record, pr } = context;

    let ranLocalReviewThisCycle = false;
    const refreshed = await this.loadOpenPullRequestSnapshot(pr.number);
    const refreshedCheckSummary = summarizeChecks(refreshed.checks);

    if (
      shouldRunLocalReview(this.config, record, refreshed.pr) &&
      !refreshedCheckSummary.hasPending &&
      !refreshedCheckSummary.hasFailing &&
      configuredBotReviewThreads(this.config, refreshed.reviewThreads).length === 0 &&
      (!this.config.humanReviewBlocksMerge || manualReviewThreads(this.config, refreshed.reviewThreads).length === 0) &&
      !mergeConflictDetected(refreshed.pr) &&
      !options.dryRun
    ) {
      ranLocalReviewThisCycle = true;
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
          pr: refreshed.pr,
          alwaysReadFiles: memoryArtifacts.alwaysReadFiles,
          onDemandFiles: memoryArtifacts.onDemandFiles,
        });
        const actionableSignature =
          localReview.recommendation !== "ready"
            ? `local-review:${localReview.maxSeverity ?? "unknown"}:${localReview.rootCauseCount}:${localReview.degraded ? "degraded" : "clean"}`
            : null;
        const signatureTracking = nextLocalReviewSignatureTracking(record, refreshed.pr.headRefOid, actionableSignature);

        record = this.stateStore.touch(record, {
          state: "draft_pr",
          local_review_head_sha: refreshed.pr.headRefOid,
          local_review_summary_path: localReview.summaryPath,
          local_review_run_at: localReview.ranAt,
          local_review_max_severity: localReview.maxSeverity,
          local_review_findings_count: localReview.findingsCount,
          local_review_root_cause_count: localReview.rootCauseCount,
          local_review_verified_max_severity: localReview.verifiedMaxSeverity,
          local_review_verified_findings_count: localReview.verifiedFindingsCount,
          local_review_recommendation: localReview.recommendation,
          local_review_degraded: localReview.degraded,
          ...signatureTracking,
          external_review_head_sha: null,
          external_review_misses_path: null,
          external_review_matched_findings_count: 0,
          external_review_near_match_findings_count: 0,
          external_review_missed_findings_count: 0,
          blocked_reason:
            localReview.recommendation !== "ready" && this.config.localReviewHighSeverityAction === "blocked" && localReview.verifiedMaxSeverity === "high"
              ? "verification"
              : null,
          last_error:
            localReview.recommendation !== "ready"
              ? truncate(
                  localReview.degraded
                    ? "Local review completed in a degraded state."
                    : localReview.verifiedMaxSeverity === "high" && this.config.localReviewHighSeverityAction === "retry"
                      ? `Local review found high-severity issues (${localReview.findingsCount} actionable findings across ${localReview.rootCauseCount} root cause(s)). Codex will continue with a repair pass before the PR can proceed.`
                      : localReview.verifiedMaxSeverity === "high" && this.config.localReviewHighSeverityAction === "blocked"
                        ? `Local review found high-severity issues (${localReview.findingsCount} actionable findings across ${localReview.rootCauseCount} root cause(s)). Manual attention is required before the PR can proceed.`
                        : `Local review requested changes (${localReview.findingsCount} actionable findings across ${localReview.rootCauseCount} root cause(s)).`,
                  500,
                )
              : null,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        record = this.stateStore.touch(record, {
          state: "draft_pr",
          local_review_head_sha: refreshed.pr.headRefOid,
          local_review_summary_path: null,
          local_review_run_at: nowIso(),
          local_review_max_severity: null,
          local_review_findings_count: 0,
          local_review_root_cause_count: 0,
          local_review_verified_max_severity: null,
          local_review_verified_findings_count: 0,
          local_review_recommendation: "unknown",
          local_review_degraded: true,
          last_local_review_signature: null,
          repeated_local_review_signature_count: 0,
          external_review_head_sha: null,
          external_review_misses_path: null,
          external_review_matched_findings_count: 0,
          external_review_near_match_findings_count: 0,
          external_review_missed_findings_count: 0,
          blocked_reason: "verification",
          last_error: `Local review failed: ${truncate(message, 500) ?? "unknown error"}`,
        });
      }

      state.issues[String(record.issue_number)] = record;
      await this.stateStore.save(state);
      await syncJournal(record);
    }

    if (
      refreshed.pr.isDraft &&
      !refreshedCheckSummary.hasPending &&
      !refreshedCheckSummary.hasFailing &&
      configuredBotReviewThreads(this.config, refreshed.reviewThreads).length === 0 &&
      (!this.config.humanReviewBlocksMerge || manualReviewThreads(this.config, refreshed.reviewThreads).length === 0) &&
      !mergeConflictDetected(refreshed.pr) &&
      !localReviewBlocksReady(this.config, record, refreshed.pr) &&
      !options.dryRun
    ) {
      await this.github.markPullRequestReady(refreshed.pr.number);
    }

    const postReady = await this.loadOpenPullRequestSnapshot(pr.number);
    const repeatedLocalReviewSignatureCount =
      !ranLocalReviewThisCycle &&
      localReviewRetryLoopCandidate(this.config, record, postReady.pr, postReady.checks, postReady.reviewThreads) &&
      record.last_head_sha === postReady.pr.headRefOid &&
      record.local_review_head_sha === postReady.pr.headRefOid
        ? record.repeated_local_review_signature_count + 1
        : localReviewHighSeverityNeedsRetry(this.config, record, postReady.pr) &&
            record.local_review_head_sha === postReady.pr.headRefOid
        ? 0
        : record.repeated_local_review_signature_count;
    const refreshedLifecycle = derivePullRequestLifecycleSnapshot(
      this.config,
      record,
      postReady.pr,
      postReady.checks,
      postReady.reviewThreads,
      { repeated_local_review_signature_count: repeatedLocalReviewSignatureCount },
    );
    const postReadyLocalReviewFailureContext =
      refreshedLifecycle.nextState === "blocked" &&
      localReviewRetryLoopStalled(
        this.config,
        refreshedLifecycle.recordForState,
        postReady.pr,
        postReady.checks,
        postReady.reviewThreads,
      )
        ? localReviewStallFailureContext(refreshedLifecycle.recordForState)
        : refreshedLifecycle.nextState === "blocked" &&
            localReviewHighSeverityNeedsBlock(this.config, refreshedLifecycle.recordForState, postReady.pr)
          ? localReviewFailureContext(refreshedLifecycle.recordForState)
          : refreshedLifecycle.nextState === "local_review_fix" &&
              localReviewHighSeverityNeedsRetry(this.config, refreshedLifecycle.recordForState, postReady.pr)
            ? localReviewFailureContext(refreshedLifecycle.recordForState)
            : null;
    const effectiveFailureContext = refreshedLifecycle.failureContext ?? postReadyLocalReviewFailureContext;
    record = this.stateStore.touch(record, {
      pr_number: postReady.pr.number,
      ...refreshedLifecycle.reviewWaitPatch,
      ...refreshedLifecycle.copilotRequestObservationPatch,
      ...refreshedLifecycle.copilotTimeoutPatch,
      state: refreshedLifecycle.nextState,
      last_head_sha: postReady.pr.headRefOid,
      repeated_local_review_signature_count: repeatedLocalReviewSignatureCount,
      last_error:
        refreshedLifecycle.nextState === "blocked" && effectiveFailureContext
          ? truncate(effectiveFailureContext.summary, 1000)
          : refreshedLifecycle.nextState === "local_review_fix" &&
              localReviewHighSeverityNeedsRetry(this.config, refreshedLifecycle.recordForState, postReady.pr)
            ? truncate(localReviewFailureSummary(refreshedLifecycle.recordForState), 1000)
            : record.last_error,
      last_failure_context: effectiveFailureContext,
      ...applyFailureSignature(record, effectiveFailureContext),
      blocked_reason:
        refreshedLifecycle.nextState === "blocked"
          ? blockedReasonFromReviewState(
              this.config,
              refreshedLifecycle.recordForState,
              postReady.pr,
              postReady.reviewThreads,
            ) ??
            ((localReviewRetryLoopStalled(
              this.config,
              refreshedLifecycle.recordForState,
              postReady.pr,
              postReady.checks,
              postReady.reviewThreads,
            ) ||
              localReviewHighSeverityNeedsBlock(this.config, refreshedLifecycle.recordForState, postReady.pr))
              ? "verification"
              : null)
          : null,
    });
    state.issues[String(record.issue_number)] = record;
    await this.stateStore.save(state);

    return {
      record,
      pr: postReady.pr,
      checks: postReady.checks,
      reviewThreads: postReady.reviewThreads,
    };
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

    try {
      pr = await this.github.resolvePullRequestForBranch(activeRecord.branch, activeRecord.pr_number);
      if (isOpenPullRequest(pr)) {
        checks = await this.github.getChecks(pr.number);
        reviewThreads = await this.github.getUnresolvedReviewThreads(pr.number);
      }
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
    })]
      .filter(Boolean)
      .join("\n");
  }

  async runOnce(options: Pick<CliOptions, "dryRun">): Promise<string> {
    let carryoverRecoveryEvents: RecoveryEvent[] = [];
    for (;;) {
      const state = await this.stateStore.load();
      const recoveryEvents: RecoveryEvent[] = [...carryoverRecoveryEvents];
      carryoverRecoveryEvents = [];
      recoveryEvents.push(...(await this.reconcileStaleActiveIssueReservation(state)));
      const authFailure = await handleAuthFailure(this.github, this.stateStore, state);
      if (authFailure) {
        return prependRecoveryLog(authFailure, formatRecoveryLog(recoveryEvents));
      }
      const issues = await this.github.listAllIssues();
      recoveryEvents.push(...(await reconcileTrackedMergedButOpenIssues(this.github, this.stateStore, state, issues)));
      recoveryEvents.push(...(await reconcileMergedIssueClosures(this.github, this.stateStore, state, issues)));
      await reconcileStaleFailedIssueStates(this.github, this.stateStore, state, this.config, issues);
      recoveryEvents.push(...(await reconcileRecoverableBlockedIssueStates(this.stateStore, state, this.config, issues)));
      await reconcileParentEpicClosures(this.github, this.stateStore, state, issues);
      await cleanupExpiredDoneWorkspaces(this.config, state);
      const recoveryLog = formatRecoveryLog(recoveryEvents);

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

      const runnableIssue = await this.resolveRunnableIssueContext(state, record);
      if (typeof runnableIssue === "string") {
        return prependRecoveryLog(runnableIssue, recoveryLog);
      }
      if (runnableIssue.kind === "restart") {
        continue;
      }

      record = runnableIssue.record;
      try {
        const issue = runnableIssue.issue;
        const preparedIssue = await this.prepareIssueExecutionContext(state, record, issue, options);
        if (typeof preparedIssue === "string") {
          return prependRecoveryLog(preparedIssue, recoveryLog);
        }
        if (isRestartRunOnce(preparedIssue)) {
          carryoverRecoveryEvents = [
            ...recoveryEvents,
            ...(preparedIssue.recoveryEvents ?? []),
          ];
          continue;
        }

        return await this.runPreparedIssue({
          ...preparedIssue,
          state,
          options,
          recoveryLog,
        });
      } finally {
        await runnableIssue.issueLock.release();
      }
    }
  }
}
