import path from "node:path";
import { runCommand } from "../core/command";
import { loadConfig, summarizeCadenceDiagnostics, summarizeLocalCiContract, summarizeTrustDiagnostics } from "../core/config";
import { GitHubClient } from "../github";
import { describeGsdIntegration } from "../gsd";
import { issueJournalPath } from "../core/journal";
import { acquireFileLock, LockHandle } from "../core/lock";
import {
  cleanupExpiredDoneWorkspaces,
  formatRecoveryLog,
  prependRecoveryLog,
  pruneOrphanedWorkspacesForOperator,
  requeueIssueForOperator,
  reconcileMergedIssueClosures,
  reconcileParentEpicClosures,
  reconcileRecoverableBlockedIssueStates,
  reconcileStaleActiveIssueReservation,
  reconcileStaleFailedIssueStates,
  reconcileTrackedMergedButOpenIssues,
} from "../recovery-reconciliation";
import {
  blockedReasonFromReviewState,
  buildCopilotReviewTimeoutFailureContext,
  inferStateFromPullRequest,
  syncCopilotReviewRequestObservation,
  syncCopilotReviewTimeoutState,
  syncReviewWaitWindow,
} from "../pull-request-state";
import { inferStateWithoutPullRequest } from "../no-pull-request-state";
import {
  hasProcessedReviewThread,
  localReviewBlocksMerge,
  localReviewBlocksReady,
  localReviewFailureContext,
  localReviewFailureSummary,
  localReviewHighSeverityNeedsBlock,
  localReviewHighSeverityNeedsRetry,
  localReviewRetryLoopCandidate,
  localReviewRetryLoopStalled,
  localReviewStallFailureContext,
  nextLocalReviewSignatureTracking,
  processedReviewThreadKey,
} from "../review-handling";
import {
  isRestartRunOnce,
  IssueJournalSync,
  MemoryArtifacts,
  prepareIssueExecutionContext,
  PreparedIssueExecutionContext,
} from "../run-once-issue-preparation";
import {
  CodexTurnContext,
  CodexTurnResult,
  CodexTurnShortCircuit,
  executeCodexTurnPhase,
  loadLocalReviewRepairContext,
} from "../run-once-turn-execution";
import {
  handlePostTurnPullRequestTransitionsPhase,
  PostTurnPullRequestContext,
  PostTurnPullRequestResult,
} from "../post-turn-pull-request";
import { buildChecksFailureContext, buildConflictFailureContext } from "../pull-request-failure-context";
import {
  resolveRunnableIssueContext as resolveIssueSelectionContext,
  RestartRunOnce as SelectionRestartRunOnce,
} from "../run-once-issue-selection";
import { RecoveryEvent, runOnceCyclePrelude } from "../run-once-cycle-prelude";
import {
  applyFailureSignature,
  buildCodexFailureContext,
  classifyFailure,
  handleAuthFailure,
  normalizeBlockerSignature,
  recoverUnexpectedCodexTurnFailure,
  shouldAutoRetryTimeout,
} from "./supervisor-failure-helpers";
import { AgentRunner, createCodexAgentRunner } from "./agent-runner";
import { syncExecutionMetricsRunSummary } from "./execution-metrics-run-summary";
import {
  attemptBudgetForLane,
  attemptLane,
  attemptsUsedForLane,
  hasAttemptBudgetRemaining,
  incrementAttemptCounters,
  isVerificationBlockedMessage,
  shouldAutoRetryBlockedVerification,
  shouldAutoRetryHandoffMissing,
} from "./supervisor-execution-policy";
import {
  buildCandidateDiscoverySummary,
  buildReadinessSummary,
  buildSelectionSummary,
  buildSelectionWhySummary,
  formatCandidateDiscoveryBehaviorLine,
} from "./supervisor-selection-readiness-summary";
import { buildIssueLintDto, type SupervisorIssueLintDto } from "./supervisor-selection-issue-lint";
import {
  buildIssueExplainDto,
  renderIssueExplainDto,
  SupervisorExplainDto,
} from "./supervisor-selection-issue-explain";
import { loadActiveIssueStatusSnapshot } from "./supervisor-selection-active-status";
import { summarizeSupervisorStatusRecords } from "./supervisor-selection-status-records";
import { inferFailureContext } from "./supervisor-failure-context";
import { StateStore } from "../core/state-store";
import { diagnoseSupervisorHost, loadStateReadonlyForDoctor, renderDoctorReport } from "../doctor";
import { buildSetupConfigPreview, type SetupConfigPreviewSelectableReviewProviderProfile } from "../setup-config-preview";
import { updateSetupConfig, type SetupConfigChanges } from "../setup-config-write";
import { diagnoseSetupReadiness } from "../setup-readiness";
import {
  blockedReasonForLifecycleState,
  derivePullRequestLifecycleSnapshot,
  isOpenPullRequest,
  resetNoPrLifecycleFailureTracking,
  selectSupervisorPollIntervalMs,
  shouldRunCodex,
  shouldStopForRepeatedFailureSignature,
} from "./supervisor-lifecycle";
import {
  mergeConflictDetected,
  summarizeChecks,
  sanitizeStatusValue,
} from "./supervisor-status-rendering";
import { buildDetailedStatusModel, buildDetailedStatusSummaryLines } from "./supervisor-status-model";
import {
  type SupervisorMutationResultDto,
  type SupervisorOrphanPruneResultDto,
  type SupervisorRecoveryAction,
} from "./supervisor-mutation-report";
import { buildTrackedIssueDtos, renderSupervisorStatusDto, SupervisorStatusDto } from "./supervisor-status-report";
import {
  clearCurrentReconciliationPhase,
  readCurrentReconciliationPhase,
  readCurrentReconciliationPhaseSnapshot,
  writeCurrentReconciliationPhase,
} from "./supervisor-reconciliation-phase";
import {
  buildRunLockBlockedEvent,
  emitSupervisorEvent,
  maybeBuildReviewWaitChangedEvent,
  type SupervisorEventSink,
} from "./supervisor-events";
import {
  buildManualReviewFailureContext,
  buildRequestedChangesFailureContext,
  buildReviewFailureContext,
  buildStalledBotReviewFailureContext,
  configuredBotReviewThreads,
  manualReviewThreads,
  pendingBotReviewThreads,
} from "../review-thread-reporting";
import {
  BlockedReason,
  CliOptions,
  FailureContext,
  GitHubIssue,
  GitHubPullRequest,
  IssueRunRecord,
  JsonStateQuarantine,
  PullRequestCheck,
  ReviewThread,
  RunState,
  StateLoadFinding,
  SupervisorConfig,
  SupervisorStateFile,
  WorkspaceStatus,
} from "../core/types";
import { nowIso, truncate } from "../core/utils";
import {
  ensureWorkspace,
  getWorkspaceStatus,
  pushBranch,
} from "../core/workspace";

interface ReadyIssueContext {
  kind: "ready";
  record: IssueRunRecord;
  issue: GitHubIssue;
  issueLock: LockHandle;
}

const LONG_RECONCILIATION_WARNING_THRESHOLD_MS = 5 * 60 * 1000;

function buildLongReconciliationWarning(snapshot: {
  phase: string;
  startedAt: string | null;
} | null): string | null {
  if (snapshot === null || snapshot.startedAt === null) {
    return null;
  }

  const startedAtMs = Date.parse(snapshot.startedAt);
  if (Number.isNaN(startedAtMs)) {
    return null;
  }

  const elapsedMs = Date.now() - startedAtMs;
  if (elapsedMs <= LONG_RECONCILIATION_WARNING_THRESHOLD_MS) {
    return null;
  }

  return [
    "reconciliation_warning=long_running",
    `phase=${snapshot.phase}`,
    `elapsed_seconds=${Math.floor(elapsedMs / 1000)}`,
    `threshold_seconds=${Math.floor(LONG_RECONCILIATION_WARNING_THRESHOLD_MS / 1000)}`,
    `started_at=${snapshot.startedAt}`,
  ].join(" ");
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
    workspace: workspace.workspacePath,
    journal_path: issueJournalPath(workspace.workspacePath, config.issueJournalRelativePath),
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

const MAX_RENDERED_STATUS_STATE_LOAD_FINDINGS = 5;
const CORRUPT_JSON_FAIL_CLOSED_PREFIX = "Blocked execution-changing command: corrupted JSON supervisor state detected";

function formatStatusStateLoadFinding(finding: StateLoadFinding): string {
  const issueNumber = finding.issue_number === null ? "none" : String(finding.issue_number);
  return [
    "state_load_finding",
    `backend=${finding.backend}`,
    `scope=${finding.scope}`,
    `issue_number=${issueNumber}`,
    `location=${sanitizeStatusValue(finding.location)}`,
    `message=${sanitizeStatusValue(finding.message)}`,
  ].join(" ");
}

function buildStateLoadDiagnosticLines(
  config: SupervisorConfig,
  state: SupervisorStateFile,
): string[] {
  if (config.stateBackend !== "json") {
    return [];
  }

  const findings = (state.load_findings ?? []).filter((finding) => finding.backend === "json");
  if (findings.length === 0) {
    return [];
  }

  const lines = [
    [
      "state_diagnostic",
      "severity=hard",
      "backend=json",
      "summary=corrupted_json_state_forced_empty_fallback_not_missing_bootstrap",
      `findings=${findings.length}`,
      `location=${sanitizeStatusValue(config.stateFile)}`,
    ].join(" "),
    ...findings.slice(0, MAX_RENDERED_STATUS_STATE_LOAD_FINDINGS).map((finding) => formatStatusStateLoadFinding(finding)),
  ];

  if (findings.length > MAX_RENDERED_STATUS_STATE_LOAD_FINDINGS) {
    lines.push(`state_load_finding_omitted count=${findings.length - MAX_RENDERED_STATUS_STATE_LOAD_FINDINGS}`);
  }

  return lines;
}

function readJsonParseErrorQuarantine(
  config: SupervisorConfig,
  state: SupervisorStateFile,
): JsonStateQuarantine | null {
  if (config.stateBackend !== "json") {
    return null;
  }

  const quarantine = state.json_state_quarantine;
  if (
    !quarantine ||
    quarantine.kind !== "parse_error" ||
    quarantine.marker_file !== config.stateFile ||
    typeof quarantine.quarantined_file !== "string" ||
    quarantine.quarantined_file.trim() === ""
  ) {
    return null;
  }

  const matchingFindings = (state.load_findings ?? []).filter((finding) =>
    finding.backend === "json" &&
    finding.kind === "parse_error" &&
    finding.scope === "state_file" &&
    finding.location === config.stateFile &&
    finding.issue_number === null
  );

  return matchingFindings.length > 0 ? quarantine : null;
}

function buildCorruptJsonFailClosedMessage(config: SupervisorConfig, quarantine: JsonStateQuarantine): string {
  return [
    `${CORRUPT_JSON_FAIL_CLOSED_PREFIX} at ${config.stateFile}.`,
    `Quarantined payload: ${quarantine.quarantined_file}.`,
    "Run status, doctor, or reset-corrupt-json-state before retrying.",
  ].join(" ");
}

function isCorruptJsonFailClosedMessage(message: string): boolean {
  return message.startsWith(CORRUPT_JSON_FAIL_CLOSED_PREFIX);
}

export class Supervisor {
  private readonly github: GitHubClient;
  private readonly stateStore: StateStore;
  private readonly agentRunner: AgentRunner;
  private readonly onEvent?: SupervisorEventSink;
  private readonly configPath?: string;

  constructor(
    public readonly config: SupervisorConfig,
    options: { agentRunner?: AgentRunner; onEvent?: SupervisorEventSink; configPath?: string } = {},
  ) {
    this.github = new GitHubClient(config);
    this.stateStore = new StateStore(config.stateFile, {
      backend: config.stateBackend,
      bootstrapFilePath: config.stateBootstrapFile,
    });
    this.agentRunner = options.agentRunner ?? createCodexAgentRunner({ config });
    this.onEvent = options.onEvent;
    this.configPath = options.configPath;
  }

  static fromConfig(
    configPath?: string,
    options: { agentRunner?: AgentRunner; onEvent?: SupervisorEventSink } = {},
  ): Supervisor {
    return new Supervisor(loadConfig(configPath), { ...options, configPath });
  }

  async pollIntervalMs(): Promise<number> {
    try {
      const state = await this.stateStore.load();
      const activeIssueNumber = state.activeIssueNumber;
      const activeRecord =
        activeIssueNumber === null ? null : state.issues[String(activeIssueNumber)] ?? null;
      return selectSupervisorPollIntervalMs(this.config, activeRecord);
    } catch {
      return this.config.pollIntervalSeconds * 1000;
    }
  }

  private lockPath(kind: "issues" | "sessions" | "supervisor", key: string): string {
    const safeKey = key.replace(/[^a-zA-Z0-9._-]/g, "_");
    return path.resolve(path.dirname(this.config.stateFile), "locks", kind, `${safeKey}.lock`);
  }

  private async classifyStaleStabilizingNoPrBranchState(
    record: Pick<IssueRunRecord, "workspace" | "journal_path">,
  ): Promise<"recoverable" | "already_satisfied_on_main"> {
    const journalPath = record.journal_path ?? issueJournalPath(record.workspace, this.config.issueJournalRelativePath);
    const journalRelativePath = path.relative(record.workspace, journalPath).replace(/\\/g, "/");
    const gitProbeTimeoutMs = this.config.codexExecTimeoutMinutes * 60_000;

    try {
      await runCommand("git", ["-C", this.config.repoPath, "fetch", "origin", this.config.defaultBranch], {
        timeoutMs: gitProbeTimeoutMs,
      });
      const [baseDiffResult, workspaceStatusResult] = await Promise.all([
        runCommand("git", ["-C", record.workspace, "diff", "--name-only", `origin/${this.config.defaultBranch}...HEAD`], {
          timeoutMs: gitProbeTimeoutMs,
        }),
        runCommand("git", ["-C", record.workspace, "status", "--short", "--untracked-files=all"], {
          timeoutMs: gitProbeTimeoutMs,
        }),
      ]);
      const meaningfulBaseDiff = baseDiffResult.stdout
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line.length > 0 && line !== journalRelativePath);
      const meaningfulWorkspaceChanges = workspaceStatusResult.stdout
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line.length > 0)
        .map((line) => line.replace(/^[ MADRCU?!]{2}\s+/, ""))
        .filter((line) => line.length > 0 && line !== journalRelativePath);

      return meaningfulBaseDiff.length === 0 && meaningfulWorkspaceChanges.length === 0
        ? "already_satisfied_on_main"
        : "recoverable";
    } catch {
      return "recoverable";
    }
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
      emitEvent: this.onEvent,
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

    const sessionLock = record.codex_session_id && this.agentRunner.capabilities.supportsResume
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
        agentRunner: this.agentRunner,
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
      emitSupervisorEvent(this.onEvent, maybeBuildReviewWaitChangedEvent(context.record, record, pr.number));

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
        await syncExecutionMetricsRunSummary({
          previousRecord: lifecycle.recordForState,
          nextRecord: record,
        });
        await syncJournal(record);
        return prependRecoveryLog(
          `Issue #${record.issue_number} stopped after repeated identical failure signatures.`,
          recoveryLog,
        );
      }
    } else {
      const nextState = inferStateWithoutPullRequest(record, workspaceStatus);
      record = this.stateStore.touch(record, {
        state: nextState,
        ...resetNoPrLifecycleFailureTracking(record, nextState),
      });
    }
    const shouldExecuteCodex = shouldRunCodex(record, pr, checks, reviewThreads, this.config);

    if (shouldExecuteCodex) {
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
    } else {
      state.issues[String(record.issue_number)] = record;
      await this.stateStore.save(state);
      await syncJournal(record);
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
      emitEvent: this.onEvent,
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
      const refreshedPr = await this.github.getPullRequest(pr.number);
      await this.github.enableAutoMerge(refreshedPr.number, refreshedPr.headRefOid);
      nextRecord = this.stateStore.touch(nextRecord, { state: "merging" });
      state.issues[String(nextRecord.issue_number)] = nextRecord;
    }

    if (nextRecord.state === "done") {
      state.activeIssueNumber = null;
    }

    state.issues[String(nextRecord.issue_number)] = nextRecord;
    await this.stateStore.save(state);
    await syncExecutionMetricsRunSummary({
      previousRecord: record,
      nextRecord,
    });
    return nextRecord;
  }

  async acquireSupervisorLock(label: "loop" | "run-once"): Promise<LockHandle> {
    const lock = await acquireFileLock(this.lockPath("supervisor", "run"), `supervisor-${label}`, {
      allowAmbiguousOwnerCleanup: true,
    });
    if (lock.acquired) {
      return lock;
    }

    if (!lock.reason) {
      return lock;
    }

    let reconciliationPhase: string | null = null;
    try {
      reconciliationPhase = await readCurrentReconciliationPhase(this.config);
    } catch {
      return lock;
    }

    if (reconciliationPhase === null) {
      emitSupervisorEvent(this.onEvent, buildRunLockBlockedEvent({
        command: label,
        reason: lock.reason,
        reconciliationPhase: null,
      }));
      return lock;
    }

    const blockedLock = {
      ...lock,
      reason: `${lock.reason} for reconciliation work (${reconciliationPhase})`,
    };
    emitSupervisorEvent(this.onEvent, buildRunLockBlockedEvent({
      command: label,
      reason: blockedLock.reason ?? lock.reason,
      reconciliationPhase,
    }));
    return blockedLock;
  }

  async status(options: Pick<CliOptions, "why"> = { why: false }): Promise<string> {
    return renderSupervisorStatusDto(await this.statusReport(options));
  }

  async statusReport(options: Pick<CliOptions, "why"> = { why: false }): Promise<SupervisorStatusDto> {
    const state = await this.stateStore.load();
    const stateDiagnosticLines = buildStateLoadDiagnosticLines(this.config, state);
    const trustDiagnostics = summarizeTrustDiagnostics(this.config);
    const cadenceDiagnostics = summarizeCadenceDiagnostics(this.config);
    const candidateDiscoverySummary = formatCandidateDiscoveryBehaviorLine(this.config);
    const localCiContract = summarizeLocalCiContract(this.config);
    const gsdSummary = await describeGsdIntegration(this.config);
    const statusRecords = summarizeSupervisorStatusRecords(state);
    const trackedIssues = buildTrackedIssueDtos(state);
    const reconciliationSnapshot = await readCurrentReconciliationPhaseSnapshot(this.config);
    const reconciliationPhase = reconciliationSnapshot?.phase ?? null;
    const reconciliationWarning = buildLongReconciliationWarning(reconciliationSnapshot);

    if (!statusRecords.activeRecord) {
      const detailedStatusLines = buildDetailedStatusModel({
        config: this.config,
        activeRecord: null,
        latestRecord: statusRecords.latestRecord,
        latestRecoveryRecord: statusRecords.latestRecoveryRecord,
        trackedIssueCount: statusRecords.trackedIssueCount,
        pr: null,
        checks: [],
        reviewThreads: [],
        manualReviewThreads,
        configuredBotReviewThreads,
        pendingBotReviewThreads,
        summarizeChecks,
        mergeConflictDetected,
      });
      try {
        const candidateDiscoveryDiagnostics =
          typeof this.github.getCandidateDiscoveryDiagnostics === "function"
            ? await this.github.getCandidateDiscoveryDiagnostics()
            : null;
        const candidateDiscovery = buildCandidateDiscoverySummary(this.config, candidateDiscoveryDiagnostics);
        const readinessSummary = await buildReadinessSummary(
          this.github,
          this.config,
          state,
          candidateDiscoveryDiagnostics,
        );
        const whyLines = options.why ? await buildSelectionWhySummary(this.github, this.config, state) : [];
        return {
          gsdSummary,
          trustDiagnostics,
          cadenceDiagnostics,
          candidateDiscoverySummary,
          candidateDiscovery,
          localCiContract,
          activeIssue: null,
          selectionSummary: options.why ? await buildSelectionSummary(this.github, this.config, state) : null,
          trackedIssues,
          runnableIssues: readinessSummary.runnableIssues,
          blockedIssues: readinessSummary.blockedIssues,
          detailedStatusLines: [...detailedStatusLines, ...stateDiagnosticLines],
          reconciliationPhase,
          reconciliationWarning,
          readinessLines: readinessSummary.readinessLines,
          whyLines,
          warning: null,
        };
      } catch (error) {
        const message = sanitizeStatusValue(error instanceof Error ? error.message : String(error));
        return {
          gsdSummary,
          trustDiagnostics,
          cadenceDiagnostics,
          candidateDiscoverySummary,
          candidateDiscovery: buildCandidateDiscoverySummary(this.config, null),
          localCiContract,
          activeIssue: null,
          selectionSummary: null,
          trackedIssues,
          runnableIssues: [],
          blockedIssues: [],
          detailedStatusLines: [...detailedStatusLines, ...stateDiagnosticLines],
          reconciliationPhase,
          reconciliationWarning,
          readinessLines: [],
          whyLines: [],
          warning: {
            kind: "readiness",
            message: truncate(message, 200) ?? "",
          },
        };
      }
    }

    const activeStatus = await loadActiveIssueStatusSnapshot({
      github: this.github,
      config: this.config,
      activeRecord: statusRecords.activeRecord,
    });
    const detailedStatusLines = buildDetailedStatusModel({
      config: this.config,
      activeRecord: statusRecords.activeRecord,
      latestRecord: statusRecords.latestRecord,
      latestRecoveryRecord: statusRecords.latestRecoveryRecord,
      trackedIssueCount: statusRecords.trackedIssueCount,
      pr: activeStatus.pr,
      checks: activeStatus.checks,
      reviewThreads: activeStatus.reviewThreads,
      manualReviewThreads,
      configuredBotReviewThreads,
      pendingBotReviewThreads,
      summarizeChecks,
      mergeConflictDetected,
    });
    const summaryLines = buildDetailedStatusSummaryLines({
      config: this.config,
      activeRecord: statusRecords.activeRecord,
      latestRecoveryRecord: statusRecords.latestRecoveryRecord,
      activityContext: activeStatus.activityContext,
      handoffSummary: activeStatus.handoffSummary,
      localReviewRoutingSummary: activeStatus.localReviewRoutingSummary,
      changeClassesSummary: activeStatus.changeClassesSummary,
      verificationPolicySummary: activeStatus.verificationPolicySummary,
      durableGuardrailSummary: activeStatus.durableGuardrailSummary,
      externalReviewFollowUpSummary: activeStatus.externalReviewFollowUpSummary,
    });

    return {
      gsdSummary,
      trustDiagnostics,
      cadenceDiagnostics,
      candidateDiscoverySummary,
      candidateDiscovery: buildCandidateDiscoverySummary(this.config, null),
      localCiContract,
      activeIssue: {
        issueNumber: statusRecords.activeRecord.issue_number,
        state: statusRecords.activeRecord.state,
        branch: statusRecords.activeRecord.branch,
        prNumber: statusRecords.activeRecord.pr_number,
        blockedReason: statusRecords.activeRecord.blocked_reason,
        activityContext: activeStatus.activityContext,
      },
      selectionSummary: {
        selectedIssueNumber: null,
        selectionReason: null,
      },
      trackedIssues,
      runnableIssues: [],
      blockedIssues: [],
      detailedStatusLines: [...detailedStatusLines, ...summaryLines, ...stateDiagnosticLines],
      reconciliationPhase,
      reconciliationWarning,
      readinessLines: [],
      whyLines: [],
      warning: activeStatus.warningMessage
        ? {
          kind: "status",
          message: truncate(sanitizeStatusValue(activeStatus.warningMessage), 200) ?? "",
        }
        : null,
    };
  }

  async explain(issueNumber: number): Promise<string> {
    return renderIssueExplainDto(await this.explainReport(issueNumber));
  }

  async runRecoveryAction(
    action: SupervisorRecoveryAction,
    issueNumber: number,
  ): Promise<SupervisorMutationResultDto> {
    if (action !== "requeue") {
      throw new Error(`Unsupported recovery action: ${String(action)}`);
    }

    const lock = await acquireFileLock(this.lockPath("supervisor", "run"), `supervisor-recovery-${action}`, {
      allowAmbiguousOwnerCleanup: true,
    });
    if (!lock.acquired) {
      throw new Error(`Cannot run recovery action while supervisor is active: ${lock.reason ?? "lock unavailable"}`);
    }

    try {
      const state = await this.stateStore.load();
      const quarantine = readJsonParseErrorQuarantine(this.config, state);
      if (quarantine) {
        return {
          action,
          issueNumber,
          outcome: "rejected",
          summary: buildCorruptJsonFailClosedMessage(this.config, quarantine),
          previousState: null,
          previousRecordSnapshot: null,
          nextState: null,
          recoveryReason: null,
        };
      }
      return requeueIssueForOperator(this.stateStore, state, issueNumber);
    } finally {
      await lock.release();
    }
  }

  async pruneOrphanedWorkspaces(): Promise<SupervisorOrphanPruneResultDto> {
    const lock = await acquireFileLock(this.lockPath("supervisor", "run"), "supervisor-recovery-prune-orphaned-workspaces", {
      allowAmbiguousOwnerCleanup: true,
    });
    if (!lock.acquired) {
      throw new Error(`Cannot run recovery action while supervisor is active: ${lock.reason ?? "lock unavailable"}`);
    }

    try {
      const state = await this.stateStore.load();
      const quarantine = readJsonParseErrorQuarantine(this.config, state);
      if (quarantine) {
        return {
          action: "prune-orphaned-workspaces",
          outcome: "rejected",
          summary: buildCorruptJsonFailClosedMessage(this.config, quarantine),
          pruned: [],
          skipped: [],
        };
      }
      return pruneOrphanedWorkspacesForOperator(this.config, state);
    } finally {
      await lock.release();
    }
  }

  async resetCorruptJsonState() {
    const lock = await acquireFileLock(this.lockPath("supervisor", "run"), "supervisor-recovery-reset-corrupt-json-state", {
      allowAmbiguousOwnerCleanup: true,
    });
    if (!lock.acquired) {
      throw new Error(`Cannot run recovery action while supervisor is active: ${lock.reason ?? "lock unavailable"}`);
    }

    try {
      return this.stateStore.resetCorruptJsonState();
    } finally {
      await lock.release();
    }
  }

  async explainReport(issueNumber: number): Promise<SupervisorExplainDto> {
    const state = await this.stateStore.load();
    return buildIssueExplainDto(this.github, this.config, state, issueNumber);
  }

  async issueLint(issueNumber: number): Promise<SupervisorIssueLintDto> {
    return buildIssueLintDto(this.github, issueNumber);
  }

  async doctor(): Promise<string> {
    return renderDoctorReport(await this.doctorReport());
  }

  async doctorReport() {
    return diagnoseSupervisorHost({
      config: this.config,
      authStatus: () => this.github.authStatus(),
      loadState: () => loadStateReadonlyForDoctor(this.config),
    });
  }

  async setupReadinessReport() {
    return diagnoseSetupReadiness({
      configPath: this.configPath,
      authStatus: () => this.github.authStatus(),
    });
  }

  async setupConfigPreview(options: {
    reviewProviderProfile?: SetupConfigPreviewSelectableReviewProviderProfile;
  } = {}) {
    return buildSetupConfigPreview({
      configPath: this.configPath,
      reviewProviderProfile: options.reviewProviderProfile,
    });
  }

  async updateSetupConfig(options: { changes: SetupConfigChanges }) {
    return updateSetupConfig({
      configPath: this.configPath,
      changes: options.changes,
    });
  }

  async runOnce(options: Pick<CliOptions, "dryRun">): Promise<string> {
    const state = await this.stateStore.load();
    const quarantine = readJsonParseErrorQuarantine(this.config, state);
    if (quarantine) {
      return buildCorruptJsonFailClosedMessage(this.config, quarantine);
    }

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
      emitEvent: this.onEvent,
      setReconciliationPhase: (phase) =>
        phase === null
          ? clearCurrentReconciliationPhase(this.config)
          : writeCurrentReconciliationPhase(this.config, phase),
      reconcileStaleActiveIssueReservation: (state) => reconcileStaleActiveIssueReservation({
        stateStore: this.stateStore,
        state,
        issueLockPath: (issueNumber) => this.lockPath("issues", `issue-${issueNumber}`),
        sessionLockPath: (sessionId) => this.lockPath("sessions", `session-${sessionId}`),
        sameFailureSignatureRepeatLimit: this.config.sameFailureSignatureRepeatLimit,
        resolvePullRequestForBranch: (branch, trackedPrNumber) =>
          this.github.resolvePullRequestForBranch(branch, trackedPrNumber),
        classifyStaleStabilizingNoPrBranchState: (record) =>
          this.classifyStaleStabilizingNoPrBranchState(record),
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

export { isCorruptJsonFailClosedMessage };
