import path from "node:path";
import { runCommand } from "../core/command";
import { loadConfig } from "../core/config";
import { GitHubClient } from "../github";
import { issueJournalPath, trackedIssueJournalPath } from "../core/journal";
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
  inferGitHubWaitStep,
} from "../pull-request-state";
import {
  syncCopilotReviewRequestObservation,
  syncCopilotReviewTimeoutState,
  syncReviewWaitWindow,
} from "../pull-request-state-sync";
import {
  hasStaleStabilizingNoPrRecoveryBudgetRemaining,
  inferStateWithoutPullRequest,
} from "../no-pull-request-state";
import {
  hasProcessedReviewThread,
  localReviewBlocksReady,
  localReviewHighSeverityNeedsBlock,
  localReviewRepairContinuationFailureContext,
  localReviewRepairContinuationSummary,
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
  reserveRunnableIssueSelection,
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
import { syncRetainedExecutionMetricsDailyRollups } from "./execution-metrics-aggregation";
import {
  executionMetricsRetentionRootPath,
  syncExecutionMetricsRunSummarySafely,
} from "./execution-metrics-run-summary";
import { syncPostMergeAuditArtifactSafely } from "./post-merge-audit-artifact";
import { summarizePostMergeAuditPatterns, type PostMergeAuditPatternSummaryDto } from "./post-merge-audit-summary";
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
} from "./supervisor-selection-readiness-summary";
import { buildIssueLintDto, type SupervisorIssueLintDto } from "./supervisor-selection-issue-lint";
import {
  renderIssueExplainDto,
  SupervisorExplainDto,
} from "./supervisor-selection-issue-explain";
import { inferFailureContext } from "./supervisor-failure-context";
import {
  isIgnoredSupervisorArtifactPath,
  parseGitStatusPorcelainV1Paths,
} from "../core/git-workspace-helpers";
import { StateStore } from "../core/state-store";
import { renderDoctorReport } from "../doctor";
import { buildSetupConfigPreview, type SetupConfigPreviewSelectableReviewProviderProfile } from "../setup-config-preview";
import { updateSetupConfig, type SetupConfigChanges } from "../setup-config-write";
import {
  blockedReasonForLifecycleState,
  determineTrackedPrRepeatFailureDisposition,
  derivePullRequestLifecycleSnapshot,
  isOpenPullRequest,
  resetNoPrLifecycleFailureTracking,
  selectSupervisorPollIntervalMs,
  shouldRunCodex,
  shouldStopForRepeatedFailureSignature,
} from "./supervisor-lifecycle";
import { mergeConflictDetected, sanitizeStatusValue, summarizeChecks } from "./supervisor-status-rendering";
import {
  formatInventoryRefreshStatusLine,
} from "../inventory-refresh-state";
import {
  type SupervisorExecutionMetricsRollupResultDto,
  type SupervisorMutationResultDto,
  type SupervisorOrphanPruneResultDto,
  type SupervisorRecoveryAction,
} from "./supervisor-mutation-report";
import {
  buildInventoryRefreshWarningMessage,
  renderSupervisorStatusDto,
  SupervisorStatusDto,
} from "./supervisor-status-report";
import { acquireSupervisorLoopRuntimeLock, readSupervisorLoopRuntime } from "./supervisor-loop-runtime-state";
import {
  clearCurrentReconciliationPhase,
  readCurrentReconciliationPhase,
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
  runSupervisorRunOnce,
  runSupervisorRunOnceIssuePhase,
  type RunOnceContinue,
  type RunOnceCycleContext,
  type RunOnceIssuePhaseContext,
  type RunOnceReturn,
} from "./supervisor-run-once-runtime";
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
  SupervisorConfig,
  SupervisorStateFile,
  WorkspaceStatus,
} from "../core/types";
import { isTerminalState, nowIso, truncate } from "../core/utils";
import {
  ensureWorkspace,
  getWorkspaceStatus,
  pushBranch,
} from "../core/workspace";
import {
  buildSupervisorDoctorReport,
  buildSupervisorExplainReport,
  buildSupervisorSetupReadinessReport,
  buildSupervisorStatusReport,
} from "./supervisor-read-only-reporting";

interface ReadyIssueContext {
  kind: "ready";
  record: IssueRunRecord;
  issue: GitHubIssue;
  issueLock: LockHandle;
}

const FULL_ISSUE_INVENTORY_REUSE_TTL_MS = 5 * 60 * 1000;

interface CachedFullIssueInventory {
  issues: GitHubIssue[];
  fetchedAtMs: number;
}

function shouldBlockTrackedPrRepeatedFailure(args: {
  record: Pick<IssueRunRecord, "pr_number">;
  failureContext: FailureContext | null;
}): boolean {
  return (
    args.record.pr_number !== null &&
    (args.failureContext?.category === "review" || args.failureContext?.category === "manual")
  );
}

async function ensureRecordJournalContext(
  config: SupervisorConfig,
  record: IssueRunRecord,
): Promise<Pick<IssueRunRecord, "issue_number" | "workspace" | "journal_path">> {
  if (record.journal_path) {
    return {
      issue_number: record.issue_number,
      workspace: record.workspace,
      journal_path: trackedIssueJournalPath(
        record.workspace,
        record.journal_path,
        config.issueJournalRelativePath,
        record.issue_number,
      ),
    };
  }

  const workspace = await ensureWorkspace(config, record.issue_number, record.branch);
  return {
    issue_number: record.issue_number,
    workspace: workspace.workspacePath,
    journal_path: issueJournalPath(workspace.workspacePath, config.issueJournalRelativePath, record.issue_number),
  };
}

interface PreparedIssueRunContext extends PreparedIssueExecutionContext {
  state: SupervisorStateFile;
  options: Pick<CliOptions, "dryRun">;
  recoveryEvents: RecoveryEvent[];
  recoveryLog: string | null;
}

function formatStatus(record: IssueRunRecord | null, state?: SupervisorStateFile): string {
  const inventoryRefreshStatusLine = formatInventoryRefreshStatusLine(state?.inventory_refresh_failure);
  if (!record) {
    return inventoryRefreshStatusLine ? `No active issue. ${inventoryRefreshStatusLine}` : "No active issue.";
  }

  return [
    `issue=#${record.issue_number}`,
    `state=${record.state}`,
    `branch=${record.branch}`,
    `pr=${record.pr_number ?? "none"}`,
    `attempts=${record.attempt_count} impl=${record.implementation_attempt_count} repair=${record.repair_attempt_count}`,
    `workspace=${record.workspace}`,
    ...(inventoryRefreshStatusLine ? [inventoryRefreshStatusLine] : []),
  ].join(" ");
}

const CORRUPT_JSON_FAIL_CLOSED_PREFIX = "Blocked execution-changing command: corrupted JSON supervisor state detected";

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
  private cachedFullIssueInventory: CachedFullIssueInventory | null = null;

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

  async acquireLoopRuntimeLock(): Promise<LockHandle> {
    return acquireSupervisorLoopRuntimeLock(this.config.stateFile);
  }

  private lockPath(kind: "issues" | "sessions" | "supervisor", key: string): string {
    const safeKey = key.replace(/[^a-zA-Z0-9._-]/g, "_");
    return path.resolve(path.dirname(this.config.stateFile), "locks", kind, `${safeKey}.lock`);
  }

  private async classifyStaleStabilizingNoPrBranchState(
    record: Pick<IssueRunRecord, "issue_number" | "workspace" | "journal_path">,
  ): Promise<"recoverable" | "already_satisfied_on_main"> {
    const journalPath = trackedIssueJournalPath(
      record.workspace,
      record.journal_path,
      this.config.issueJournalRelativePath,
      record.issue_number,
    );
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
        runCommand("git", ["-C", record.workspace, "status", "--porcelain=v1", "-z", "--untracked-files=all"], {
          timeoutMs: gitProbeTimeoutMs,
        }),
      ]);
      const meaningfulBaseDiff = baseDiffResult.stdout
        .split("\n")
        .filter((line) => line.length > 0 && !isIgnoredSupervisorArtifactPath(line, journalRelativePath));
      const meaningfulWorkspaceChanges = parseGitStatusPorcelainV1Paths(workspaceStatusResult.stdout)
        .filter((paths) =>
          paths.some((relativePath) => !isIgnoredSupervisorArtifactPath(relativePath, journalRelativePath)));

      return meaningfulBaseDiff.length === 0 && meaningfulWorkspaceChanges.length === 0
        ? "already_satisfied_on_main"
        : "recoverable";
    } catch {
      return "recoverable";
    }
  }

  private async listLoopIssueInventory(): Promise<GitHubIssue[]> {
    const nowMs = Date.now();
    const cachedInventory = this.cachedFullIssueInventory;
    if (cachedInventory !== null && nowMs - cachedInventory.fetchedAtMs < FULL_ISSUE_INVENTORY_REUSE_TTL_MS) {
      return cachedInventory.issues;
    }

    try {
      const issues = await this.withLoopInventoryCapture((captureDir) =>
        this.github.listAllIssues({ captureDir }));
      this.cachedFullIssueInventory = {
        issues,
        fetchedAtMs: Date.now(),
      };
      return issues;
    } catch (error) {
      this.cachedFullIssueInventory = null;
      throw error;
    }
  }

  private inventoryRefreshCaptureDir(): string {
    return path.join(path.dirname(this.config.stateFile), "inventory-refresh-failures");
  }

  private async withLoopInventoryCapture<T>(operation: (captureDir: string) => Promise<T>): Promise<T> {
    return operation(this.inventoryRefreshCaptureDir());
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
    const staleNoPrRecoveryBudgetApplies =
      budgetLaneBeforeWorkspace === "implementation"
      && hasStaleStabilizingNoPrRecoveryBudgetRemaining(record, this.config);
    if (!staleNoPrRecoveryBudgetApplies && !hasAttemptBudgetRemaining(record, this.config, budgetLaneBeforeWorkspace)) {
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
        message: `Dry run: would invoke Codex for issue #${record.issue_number}. ${formatStatus(record, state)}`,
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
        blockedReasonFromReviewState: (phaseRecord, phasePr, phaseChecks, phaseReviewThreads) =>
          blockedReasonFromReviewState(this.config, phaseRecord, phasePr, phaseChecks, phaseReviewThreads),
        recoverUnexpectedCodexTurnFailure: (args) =>
          recoverUnexpectedCodexTurnFailure({
            ...args,
            config: this.config,
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
      recoveryEvents,
    } = context;
    let record = context.record;
    let workspaceStatus = context.workspaceStatus;
    let pr = context.pr;
    let checks = context.checks;
    let reviewThreads = context.reviewThreads;

    if (pr) {
      const lifecycle = derivePullRequestLifecycleSnapshot(this.config, record, pr, checks, reviewThreads);
      const localReviewRepairSummary =
        lifecycle.nextState === "local_review_fix"
          ? localReviewRepairContinuationSummary(this.config, lifecycle.recordForState, pr)
          : null;
      const effectiveFailureContext =
        lifecycle.failureContext ??
        (lifecycle.nextState === "local_review_fix"
          ? localReviewRepairContinuationFailureContext(this.config, lifecycle.recordForState, pr)
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
            : localReviewRepairSummary
              ? truncate(localReviewRepairSummary, 1000)
              : record.last_error,
        last_failure_context: effectiveFailureContext,
        ...applyFailureSignature(record, effectiveFailureContext),
        blocked_reason:
          lifecycle.nextState === "blocked"
            ? blockedReasonForLifecycleState(this.config, lifecycle.recordForState, pr, checks, reviewThreads)
            : null,
      });
      const trackedPrRepeatFailureDisposition = determineTrackedPrRepeatFailureDisposition({
        record,
        config: this.config,
        pr,
        checks,
        reviewThreads,
      });
      record = this.stateStore.touch(record, {
        last_tracked_pr_progress_snapshot: trackedPrRepeatFailureDisposition.progressSnapshot,
        last_tracked_pr_progress_summary: trackedPrRepeatFailureDisposition.progressSummary,
        last_tracked_pr_repeat_failure_decision: null,
      });
      emitSupervisorEvent(this.onEvent, maybeBuildReviewWaitChangedEvent(context.record, record, pr.number));

      if (effectiveFailureContext && shouldStopForRepeatedFailureSignature(record, this.config)) {
        if (!trackedPrRepeatFailureDisposition.shouldStop) {
          record = this.stateStore.touch(record, {
            last_tracked_pr_progress_summary: trackedPrRepeatFailureDisposition.progressSummary,
            last_tracked_pr_repeat_failure_decision: trackedPrRepeatFailureDisposition.decision,
          });
        } else if (shouldBlockTrackedPrRepeatedFailure({ record, failureContext: effectiveFailureContext })) {
          record = this.stateStore.touch(record, {
            state: "blocked",
            last_error: truncate(effectiveFailureContext.summary, 1000),
            last_failure_kind: null,
            last_tracked_pr_progress_summary: trackedPrRepeatFailureDisposition.progressSummary,
            last_tracked_pr_repeat_failure_decision: trackedPrRepeatFailureDisposition.decision,
            blocked_reason: "manual_review",
          });
          state.issues[String(record.issue_number)] = record;
          state.activeIssueNumber = null;
          await this.stateStore.save(state);
          await syncExecutionMetricsRunSummarySafely({
            previousRecord: lifecycle.recordForState,
            nextRecord: record,
            issue,
            pullRequest: pr,
            recoveryEvents,
            retentionRootPath: executionMetricsRetentionRootPath(this.config.stateFile),
            warningContext: "persisting",
          });
          await syncJournal(record);
          return prependRecoveryLog(
            `Issue #${record.issue_number} blocked after repeated identical review-related failure signatures.`,
            recoveryLog,
          );
        } else {
          record = this.stateStore.touch(record, {
            state: "failed",
            last_error:
              `Repeated identical failure signature ${record.repeated_failure_signature_count} times: ` +
              `${record.last_failure_signature ?? "unknown"}`,
            last_failure_kind: "command_error",
            last_tracked_pr_progress_summary: trackedPrRepeatFailureDisposition.progressSummary,
            last_tracked_pr_repeat_failure_decision: trackedPrRepeatFailureDisposition.decision,
            blocked_reason: null,
          });
          state.issues[String(record.issue_number)] = record;
          state.activeIssueNumber = null;
          await this.stateStore.save(state);
          await syncExecutionMetricsRunSummarySafely({
            previousRecord: lifecycle.recordForState,
            nextRecord: record,
            issue,
            pullRequest: pr,
            recoveryEvents,
            retentionRootPath: executionMetricsRetentionRootPath(this.config.stateFile),
            warningContext: "persisting",
          });
          await syncJournal(record);
          return prependRecoveryLog(
            `Issue #${record.issue_number} stopped after repeated identical failure signatures.`,
            recoveryLog,
          );
        }
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
      state.issues[String(record.issue_number)] = record;
      await this.stateStore.save(state);
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
      record = await this.handlePostTurnMergeAndCompletion(state, issue, postTurn.record, postTurn.pr, options, recoveryEvents);
      await syncJournal(record);
      return prependRecoveryLog(formatStatus(record, state), recoveryLog);
    }

    state.issues[String(record.issue_number)] = record;
    if (state.activeIssueNumber === null && !isTerminalState(record.state)) {
      state.activeIssueNumber = record.issue_number;
    }
    await this.stateStore.save(state);
    await syncJournal(record);
    return prependRecoveryLog(formatStatus(record, state), recoveryLog);
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
      blockedReasonFromReviewState: (record, pr, checks, reviewThreads) =>
        blockedReasonFromReviewState(this.config, record, pr, checks, reviewThreads),
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
    issue: GitHubIssue,
    record: IssueRunRecord,
    pr: GitHubPullRequest,
    options: Pick<CliOptions, "dryRun">,
    recoveryEvents: RecoveryEvent[] = [],
  ): Promise<IssueRunRecord> {
    let nextRecord = record;
    let currentPr = pr;

    if (nextRecord.state === "ready_to_merge" && !options.dryRun) {
      const refreshed = await this.loadOpenPullRequestSnapshot(pr.number);
      currentPr = refreshed.pr;
      const lifecycle = derivePullRequestLifecycleSnapshot(
        this.config,
        nextRecord,
        currentPr,
        refreshed.checks,
        refreshed.reviewThreads,
      );
      const lifecyclePatch = {
        ...lifecycle.reviewWaitPatch,
        ...lifecycle.copilotRequestObservationPatch,
        ...lifecycle.mergeLatencyVisibilityPatch,
        ...lifecycle.copilotTimeoutPatch,
      };
      const localReviewRepairSummary =
        lifecycle.nextState === "local_review_fix"
          ? localReviewRepairContinuationSummary(this.config, lifecycle.recordForState, currentPr)
          : null;
      const effectiveFailureContext =
        lifecycle.failureContext ??
        (lifecycle.nextState === "local_review_fix"
          ? localReviewRepairContinuationFailureContext(this.config, lifecycle.recordForState, currentPr)
          : null);
      const staleReadyToMerge = currentPr.headRefOid !== pr.headRefOid && lifecycle.nextState === "ready_to_merge";

      if (lifecycle.nextState !== "ready_to_merge" || staleReadyToMerge) {
        nextRecord = this.stateStore.touch(nextRecord, {
          ...lifecyclePatch,
          state: staleReadyToMerge ? "stabilizing" : lifecycle.nextState,
          last_error:
            staleReadyToMerge
              ? nextRecord.last_error
              : lifecycle.nextState === "blocked" && effectiveFailureContext
              ? truncate(effectiveFailureContext.summary, 1000)
              : localReviewRepairSummary
                ? truncate(localReviewRepairSummary, 1000)
                : nextRecord.last_error,
          last_failure_context: effectiveFailureContext,
          ...applyFailureSignature(nextRecord, effectiveFailureContext),
          blocked_reason:
            staleReadyToMerge
              ? null
              : lifecycle.nextState === "blocked"
              ? blockedReasonForLifecycleState(
                  this.config,
                  lifecycle.recordForState,
                  currentPr,
                  refreshed.checks,
                  refreshed.reviewThreads,
                )
              : null,
          last_head_sha: currentPr.headRefOid,
        });
      } else {
        await this.github.enableAutoMerge(currentPr.number, currentPr.headRefOid);
        nextRecord = this.stateStore.touch(nextRecord, {
          ...lifecyclePatch,
          state: "merging",
          blocked_reason: null,
          last_head_sha: currentPr.headRefOid,
        });
      }
      state.issues[String(nextRecord.issue_number)] = nextRecord;
    }

    if (nextRecord.state === "done") {
      state.activeIssueNumber = null;
    }

    state.issues[String(nextRecord.issue_number)] = nextRecord;
    await this.stateStore.save(state);
    await syncExecutionMetricsRunSummarySafely({
      previousRecord: record,
      nextRecord,
      issue,
      pullRequest: currentPr,
      recoveryEvents,
      retentionRootPath: executionMetricsRetentionRootPath(this.config.stateFile),
      warningContext: "persisting",
    });
    await syncPostMergeAuditArtifactSafely({
      config: this.config,
      previousRecord: record,
      nextRecord,
      issue,
      pullRequest: currentPr,
      warningContext: "persisting",
    });
    return nextRecord;
  }

  async acquireSupervisorLock(label: "loop" | "run-once"): Promise<LockHandle> {
    const lock = await acquireFileLock(this.lockPath("supervisor", "run"), `supervisor-${label}`);
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
    return buildSupervisorStatusReport({
      config: this.config,
      github: this.github,
      stateStore: this.stateStore,
      options,
    });
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

  async rollupExecutionMetrics(): Promise<SupervisorExecutionMetricsRollupResultDto> {
    const lock = await acquireFileLock(this.lockPath("supervisor", "run"), "supervisor-recovery-rollup-execution-metrics", {
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
          action: "rollup-execution-metrics",
          outcome: "rejected",
          summary: buildCorruptJsonFailClosedMessage(this.config, quarantine),
          artifactPath: null,
          runSummaryCount: 0,
        };
      }
      const result = await syncRetainedExecutionMetricsDailyRollups({
        stateFilePath: this.config.stateFile,
      });
      return {
        action: "rollup-execution-metrics",
        outcome: "completed",
        summary:
          `Wrote daily execution metrics rollups from ${result.runSummaryCount} retained run summar` +
          `${result.runSummaryCount === 1 ? "y" : "ies"}.`,
        artifactPath: result.artifactPath,
        runSummaryCount: result.runSummaryCount,
      };
    } finally {
      await lock.release();
    }
  }

  async postMergeAuditSummaryReport(): Promise<PostMergeAuditPatternSummaryDto> {
    return summarizePostMergeAuditPatterns(this.config);
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
    return buildSupervisorExplainReport({
      config: this.config,
      github: this.github,
      stateStore: this.stateStore,
      issueNumber,
    });
  }

  async issueLint(issueNumber: number): Promise<SupervisorIssueLintDto> {
    return buildIssueLintDto(this.github, issueNumber);
  }

  async doctor(): Promise<string> {
    return renderDoctorReport(await this.doctorReport());
  }

  async doctorReport() {
    return buildSupervisorDoctorReport({
      config: this.config,
      github: this.github,
    });
  }

  async setupReadinessReport() {
    return buildSupervisorSetupReadinessReport({
      configPath: this.configPath,
      github: this.github,
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
    return runSupervisorRunOnce({
      options,
      loadState: () => this.stateStore.load(),
      readJsonParseErrorQuarantine: (state) => readJsonParseErrorQuarantine(this.config, state),
      buildCorruptJsonFailClosedMessage: (quarantine) =>
        buildCorruptJsonFailClosedMessage(this.config, quarantine as JsonStateQuarantine),
      startRunOnceCycle: (carryoverRecoveryEvents) => this.startRunOnceCycle(carryoverRecoveryEvents),
      normalizeActiveIssueRecordForExecution: (state) => this.normalizeActiveIssueRecordForExecution(state),
      runOnceIssuePhase: (context) => this.runOnceIssuePhase(context),
    });
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
      reserveRunnableIssueSelection: async (state) => {
        const reserved = await reserveRunnableIssueSelection({
          github: this.github,
          config: this.config,
          stateStore: this.stateStore,
          state,
          currentRecord: null,
          emitEvent: this.onEvent,
        });
        return reserved !== null;
      },
      handleAuthFailure: (state) => handleAuthFailure(this.github, this.stateStore, state),
      listAllIssues: () => this.listLoopIssueInventory(),
      getIssueForParentEpicClosureFallback: (issueNumber) => this.github.getIssue(issueNumber),
      reconcileTrackedMergedButOpenIssues: (state, issues, updateReconciliationProgress, options) =>
        reconcileTrackedMergedButOpenIssues(
          this.github,
          this.stateStore,
          state,
          this.config,
          issues,
          updateReconciliationProgress,
          options,
        ),
      reconcileMergedIssueClosures: (state, issues) =>
        reconcileMergedIssueClosures(this.github, this.stateStore, state, this.config, issues),
      reconcileStaleFailedIssueStates: (state, issues, updateReconciliationProgress) =>
        reconcileStaleFailedIssueStates(this.github, this.stateStore, state, this.config, issues, {
          inferStateFromPullRequest,
          inferFailureContext,
          blockedReasonForLifecycleState,
          isOpenPullRequest,
          syncReviewWaitWindow,
          syncCopilotReviewRequestObservation,
          syncCopilotReviewTimeoutState,
          inferGitHubWaitStep,
        }, updateReconciliationProgress),
      reconcileRecoverableBlockedIssueStates: (state, issues, options) =>
        reconcileRecoverableBlockedIssueStates(this.github, this.stateStore, state, this.config, issues, {
          shouldAutoRetryHandoffMissing,
          inferStateFromPullRequest,
          inferFailureContext,
          blockedReasonForLifecycleState,
          isOpenPullRequest,
          syncReviewWaitWindow,
          syncCopilotReviewRequestObservation,
          syncCopilotReviewTimeoutState,
        }, options),
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
    return runSupervisorRunOnceIssuePhase({
      ...context,
      resolveRunnableIssueContext: (state, record) => this.resolveRunnableIssueContext(state, record),
      prepareIssueExecutionContext: (runnableIssue, state, options) =>
        prepareIssueExecutionContext({
          github: this.github,
          config: this.config,
          stateStore: this.stateStore,
          state,
          record: runnableIssue.record,
          issue: runnableIssue.issue,
          options,
        }),
      isRestartRunOnce,
      runPreparedIssue: (preparedIssue, runContext) =>
        this.runPreparedIssue({
          ...preparedIssue,
          state: runContext.state,
          options: runContext.options,
          recoveryEvents: runContext.recoveryEvents,
          recoveryLog: runContext.recoveryLog,
        }),
    });
  }
}

export { isCorruptJsonFailClosedMessage };
