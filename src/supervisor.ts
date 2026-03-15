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
  blockedReasonFromReviewState,
  buildCopilotReviewTimeoutFailureContext,
  inferStateFromPullRequest,
  syncCopilotReviewRequestObservation,
  syncCopilotReviewTimeoutState,
  syncReviewWaitWindow,
} from "./pull-request-state";
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
import {
  applyFailureSignature,
  buildCodexFailureContext,
  classifyFailure,
  handleAuthFailure,
  normalizeBlockerSignature,
  recoverUnexpectedCodexTurnFailure,
  shouldAutoRetryTimeout,
} from "./supervisor-failure-helpers";
import {
  attemptBudgetForLane,
  attemptLane,
  attemptsUsedForLane,
  formatExecutionReadyMissingFields,
  hasAttemptBudgetRemaining,
  incrementAttemptCounters,
  isEligibleForSelection,
  isVerificationBlockedMessage,
  shouldAutoRetryBlockedVerification,
  shouldAutoRetryHandoffMissing,
  shouldEnforceExecutionReady,
} from "./supervisor-execution-policy";
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
import { nowIso, truncate } from "./utils";
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
export { inferStateFromPullRequest } from "./pull-request-state";
export { reconcileRecoverableBlockedIssueStates } from "./recovery-reconciliation";
export { formatDetailedStatus, summarizeChecks } from "./supervisor-reporting";
export { recoverUnexpectedCodexTurnFailure } from "./supervisor-failure-helpers";
export { shouldAutoRetryHandoffMissing } from "./supervisor-execution-policy";

const MAX_PROCESSED_REVIEW_THREAD_IDS = 200;

function trimProcessedReviewThreadIds(ids: string[]): string[] {
  if (ids.length <= MAX_PROCESSED_REVIEW_THREAD_IDS) {
    return ids;
  }

  return ids.slice(ids.length - MAX_PROCESSED_REVIEW_THREAD_IDS);
}

function shouldPreserveNoPrFailureTracking(record: IssueRunRecord): boolean {
  return (
    record.pr_number === null &&
    record.last_failure_context?.category === "blocked" &&
    record.last_failure_signature !== null &&
    record.repeated_failure_signature_count > 0
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

function buildRequestedChangesFailureContext(pr: GitHubPullRequest): FailureContext {
  return {
    category: "manual",
    summary: `PR #${pr.number} has requested changes and requires manual review resolution before merge.`,
    signature: `changes-requested:${pr.headRefOid}`,
    command: null,
    details: [`reviewDecision=${pr.reviewDecision ?? "none"}`],
    url: pr.url,
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

    if (pr.reviewDecision === "CHANGES_REQUESTED") {
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

      if (config.humanReviewBlocksMerge) {
        return buildRequestedChangesFailureContext(pr);
      }
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
      return localReviewStallFailureContext(record);
    }

    if (localReviewHighSeverityNeedsBlock(config, record, pr)) {
      return localReviewFailureContext(record);
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

    if (localReviewBlocksMerge(config, record, pr)) {
      return localReviewFailureContext(record);
    }

    if (mergeConflictDetected(pr)) {
      return buildConflictFailureContext(pr);
    }
  }

  return null;
}

function blockedReasonForLifecycleState(
  config: SupervisorConfig,
  record: IssueRunRecord,
  pr: GitHubPullRequest,
  checks: PullRequestCheck[],
  reviewThreads: ReviewThread[],
): IssueRunRecord["blocked_reason"] {
  return (
    blockedReasonFromReviewState(config, record, pr, reviewThreads) ??
    (localReviewRetryLoopStalled(
      config,
      record,
      pr,
      checks,
      reviewThreads,
      manualReviewThreads,
      configuredBotReviewThreads,
      summarizeChecks,
      mergeConflictDetected,
    ) || localReviewHighSeverityNeedsBlock(config, record, pr)
      ? "verification"
      : null)
  );
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
      const effectiveFailureContext =
        lifecycle.failureContext ??
        (lifecycle.nextState === "local_review_fix" &&
        localReviewHighSeverityNeedsRetry(this.config, lifecycle.recordForState, pr)
          ? localReviewFailureContext(lifecycle.recordForState)
          : null);
      record = this.stateStore.touch(record, {
        pr_number: pr.number,
        state: lifecycle.nextState,
        ...lifecycle.reviewWaitPatch,
        ...lifecycle.copilotRequestObservationPatch,
        ...lifecycle.copilotTimeoutPatch,
        last_error:
          lifecycle.nextState === "blocked" && effectiveFailureContext
            ? truncate(effectiveFailureContext.summary, 1000)
            : record.last_error,
        last_failure_context: effectiveFailureContext,
        ...applyFailureSignature(record, effectiveFailureContext),
        blocked_reason:
          lifecycle.nextState === "blocked"
            ? blockedReasonForLifecycleState(this.config, lifecycle.recordForState, pr, checks, reviewThreads)
            : null,
      });

      if (effectiveFailureContext && shouldStopForRepeatedFailureSignature(record, this.config)) {
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
