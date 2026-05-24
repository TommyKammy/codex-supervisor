import path from "node:path";
import { runCommand } from "../core/command";
import { loadConfig } from "../core/config";
import { GitHubClient } from "../github";
import { issueJournalPath, resolveTrackedIssueHostPaths } from "../core/journal";
import { acquireFileLock, LockHandle } from "../core/lock";
import {
  cleanupExpiredDoneWorkspaces,
  formatRecoveryLog,
  prependRecoveryLog,
  reconcileMergedIssueClosures,
  reconcileParentEpicClosures,
  reconcileRecoverableBlockedIssueStates,
  reconcileStaleActiveIssueReservation,
  reconcileStaleDoneIssueStates,
  reconcileStaleFailedIssueStates,
  reconcileTrackedMergedButOpenIssues,
} from "../recovery-reconciliation";
import {
  blockedReasonFromReviewState,
  effectiveConfiguredBotReviewThreadsForState,
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
  localReviewRepairContinuationFailureContext,
  localReviewRepairContinuationSummary,
} from "../review-handling";
import {
  isRestartRunOnce,
  prepareIssueExecutionContext,
} from "../run-once-issue-preparation";
import {
  CodexTurnContext,
  CodexTurnResult,
  CodexTurnShortCircuit,
  executeCodexTurnPhase,
} from "../run-once-turn-execution";
import {
  handlePostTurnPullRequestTransitionsPhase,
  PostTurnPullRequestContext,
  PostTurnPullRequestResult,
} from "../post-turn-pull-request";
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
  addressingReviewStrategyPatch,
  hasAttemptBudgetRemaining,
  incrementAttemptCounters,
  isVerificationBlockedMessage,
  shouldReconcileTrackedPrStaleReviewBot,
  shouldAutoRetryBlockedVerification,
  shouldAutoRetryHandoffMissing,
} from "./supervisor-execution-policy";
import { buildIssueLintDto, type SupervisorIssueLintDto } from "./supervisor-selection-issue-lint";
import {
  renderIssueExplainDto,
  renderIssueExplainTimelineDto,
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
import { updateSetupConfig, type SetupConfigChanges, type UpdateSetupConfigArgs } from "../setup-config-write";
import {
  blockedReasonForLifecycleState,
  derivePullRequestLifecycleSnapshot,
  isOpenPullRequest,
  selectSupervisorPollIntervalMs,
} from "./supervisor-lifecycle";
import { mergeConflictDetected, summarizeChecks } from "./supervisor-status-rendering";
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
  buildCorruptJsonFailClosedMessage,
  createSupervisorMutationRuntime,
  isCorruptJsonFailClosedMessage,
  readJsonParseErrorQuarantine,
  type SupervisorMutationRuntime,
} from "./supervisor-mutation-runtime";
import {
  renderSupervisorStatusDto,
  SupervisorStatusDto,
} from "./supervisor-status-report";
import { acquireSupervisorLoopRuntimeLock } from "./supervisor-loop-runtime-state";
import {
  clearCurrentReconciliationPhase,
  readCurrentReconciliationPhase,
  writeCurrentReconciliationPhase,
} from "./supervisor-reconciliation-phase";
import {
  buildRunLockBlockedEvent,
  emitSupervisorEvent,
  type SupervisorEventSink,
} from "./supervisor-events";
import {
  configuredBotReviewThreads,
  manualReviewThreads,
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
  runPreparedIssueFlow,
  type PreparedIssueRunContext,
} from "./prepared-issue-runner";
import {
  CliOptions,
  FailureContext,
  GitHubIssue,
  GitHubPullRequest,
  IssueRunRecord,
  JsonStateQuarantine,
  PullRequestCheck,
  ReviewThread,
  SupervisorConfig,
  SupervisorStateFile,
} from "../core/types";
import { truncate } from "../core/utils";
import {
  ensureWorkspace,
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

function buildAutoMergeRefusalContext(summary: string, details: string[], pr: GitHubPullRequest): FailureContext {
  return {
    category: "blocked",
    summary,
    signature: `auto-merge-refused:${pr.headRefOid}:${details.join("|")}`,
    command: null,
    details,
    url: pr.url,
    updated_at: new Date().toISOString(),
  };
}

function validTimestamp(value: string | null | undefined): string | null {
  if (typeof value !== "string" || value.length === 0) {
    return null;
  }

  return Number.isNaN(Date.parse(value)) ? null : value;
}

function hasConfiguredLocalCiCommand(config: Pick<SupervisorConfig, "localCiCommand">): boolean {
  if (typeof config.localCiCommand === "string") {
    return config.localCiCommand.trim() !== "";
  }

  return config.localCiCommand !== undefined;
}

interface FinalAutoMergeGuardResult {
  evidence: FailureContext;
  refusal: FailureContext | null;
}

function buildAutoMergeEvidenceContext(details: string[], pr: GitHubPullRequest): FailureContext {
  return {
    category: null,
    summary: `Final auto-merge guard passed for PR #${pr.number}.`,
    signature: `auto-merge-ready:${pr.headRefOid}`,
    command: null,
    details,
    url: pr.url,
    updated_at: new Date().toISOString(),
  };
}

function hasCurrentHeadCodexNoMajor(record: IssueRunRecord, pr: GitHubPullRequest): boolean {
  return Boolean(
    record.provider_success_head_sha === pr.headRefOid &&
      validTimestamp(record.provider_success_observed_at) &&
      pr.configuredBotCurrentHeadObservationSource === "codex_pr_success_comment" &&
      pr.configuredBotCurrentHeadStatusState === "SUCCESS" &&
      pr.configuredBotTopLevelReviewStrength !== "blocking" &&
      validTimestamp(pr.configuredBotCurrentHeadObservedAt),
  );
}

function finalAutoMergeGuard(args: {
  config: SupervisorConfig;
  record: IssueRunRecord;
  originalPr: GitHubPullRequest;
  currentPr: GitHubPullRequest;
  checks: PullRequestCheck[];
  reviewThreads: ReviewThread[];
}): FinalAutoMergeGuardResult {
  const { config, record, originalPr, currentPr, checks, reviewThreads } = args;
  const checkSummary = summarizeChecks(checks);
  const checksGreen = checks.length > 0 && checkSummary.allPassing;
  const effectiveConfiguredBotBlockers = effectiveConfiguredBotReviewThreadsForState(
    config,
    record,
    currentPr,
    checks,
    reviewThreads,
  ).length;
  const effectiveHumanBlockers = config.humanReviewBlocksMerge ? manualReviewThreads(config, reviewThreads).length : 0;
  const currentHeadCodexNoMajor = hasCurrentHeadCodexNoMajor(record, currentPr);
  const localCiResult = record.latest_local_ci_result ?? null;
  const localCiMissing =
    hasConfiguredLocalCiCommand(config) &&
    (localCiResult?.outcome !== "passed" || localCiResult?.head_sha !== currentPr.headRefOid);
  const evidenceDetails = [
    `head_sha=${currentPr.headRefOid}`,
    `mergeable=${currentPr.mergeable ?? "unknown"}`,
    `merge_state=${currentPr.mergeStateStatus ?? "unknown"}`,
    `checks=green count=${checks.length}`,
    `codex_current_head_no_major=${currentHeadCodexNoMajor ? "yes" : "no"}`,
    `configured_bot_blockers=${effectiveConfiguredBotBlockers}`,
    `human_blockers=${effectiveHumanBlockers}`,
    hasConfiguredLocalCiCommand(config)
      ? `local_ci=${localCiResult?.outcome ?? "missing"} head_sha=${localCiResult?.head_sha ?? "none"}`
      : "local_ci=not_configured",
  ];

  const details = [
    originalPr.headRefOid === currentPr.headRefOid ? null : `head_mismatch=${originalPr.headRefOid}->${currentPr.headRefOid}`,
    currentPr.mergeable === "MERGEABLE" ? null : `mergeable=${currentPr.mergeable ?? "unknown"}`,
    currentPr.mergeStateStatus === "CLEAN" ? null : `merge_state=${currentPr.mergeStateStatus ?? "unknown"}`,
    checks.length === 0 ? "required_checks_missing" : checksGreen ? null : "required_checks_not_green",
    currentHeadCodexNoMajor ? null : "missing_current_head_codex_no_major",
    effectiveConfiguredBotBlockers === 0 ? null : `configured_bot_blockers=${effectiveConfiguredBotBlockers}`,
    effectiveHumanBlockers === 0 ? null : `human_blockers=${effectiveHumanBlockers}`,
    localCiMissing ? "missing_current_head_local_ci_success" : null,
  ].filter((detail): detail is string => detail !== null);

  const evidence = buildAutoMergeEvidenceContext(evidenceDetails, currentPr);

  if (details.length === 0) {
    return { evidence, refusal: null };
  }

  return {
    evidence,
    refusal: buildAutoMergeRefusalContext(
      `Final auto-merge guard refused PR #${currentPr.number}.`,
      details,
      currentPr,
    ),
  };
}

async function publishFinalAutoMergeGuardComment(args: {
  github: GitHubClient;
  pr: GitHubPullRequest;
  evidence: FailureContext;
}): Promise<void> {
  const github = args.github as unknown as {
    addIssueComment?: (issueNumber: number, body: string) => Promise<unknown>;
  };
  if (!github.addIssueComment) {
    return;
  }

  await github.addIssueComment(
    args.pr.number,
    [
      `Final auto-merge guard passed for head \`${args.pr.headRefOid}\`.`,
      "",
      ...args.evidence.details.map((detail) => `- ${detail}`),
      "",
      "<!-- codex-supervisor:final-auto-merge-guard -->",
    ].join("\n"),
  );
}

function interruptedTurnRecoveryIssueNumber(events: RecoveryEvent[]): number | null {
  const event = events.find((candidate) => candidate.reason.startsWith("interrupted_turn_recovery:"));
  return event?.issueNumber ?? null;
}

async function ensureRecordJournalContext(
  config: SupervisorConfig,
  record: IssueRunRecord,
): Promise<Pick<IssueRunRecord, "issue_number" | "workspace" | "journal_path">> {
  const resolvedPaths = resolveTrackedIssueHostPaths(config, record);
  if (record.journal_path || resolvedPaths.usingCanonicalWorkspace) {
    return {
      issue_number: record.issue_number,
      workspace: resolvedPaths.workspace,
      journal_path: resolvedPaths.journal_path,
    };
  }

  const workspace = await ensureWorkspace(config, record.issue_number, record.branch);
  return {
    issue_number: record.issue_number,
    workspace: workspace.workspacePath,
    journal_path: issueJournalPath(workspace.workspacePath, config.issueJournalRelativePath, record.issue_number),
  };
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

export class Supervisor {
  private readonly github: GitHubClient;
  private readonly stateStore: StateStore;
  private readonly agentRunner: AgentRunner;
  private readonly mutationRuntime: SupervisorMutationRuntime;
  private readonly onEvent?: SupervisorEventSink;
  private readonly configPath?: string;
  private cachedFullIssueInventory: CachedFullIssueInventory | null = null;

  constructor(
    public readonly config: SupervisorConfig,
    options: {
      agentRunner?: AgentRunner;
      mutationRuntime?: SupervisorMutationRuntime;
      onEvent?: SupervisorEventSink;
      configPath?: string;
    } = {},
  ) {
    this.github = new GitHubClient(config);
    this.stateStore = new StateStore(config.stateFile, {
      backend: config.stateBackend,
      bootstrapFilePath: config.stateBootstrapFile,
    });
    this.agentRunner = options.agentRunner ?? createCodexAgentRunner({ config });
    this.mutationRuntime = options.mutationRuntime ?? createSupervisorMutationRuntime({
      config,
      stateStore: this.stateStore,
      lockPath: this.lockPath.bind(this),
    });
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
    const resolvedPaths = resolveTrackedIssueHostPaths(this.config, record);
    const journalRelativePath = path.relative(resolvedPaths.workspace, resolvedPaths.journal_path).replace(/\\/g, "/");
    const gitProbeTimeoutMs = this.config.codexExecTimeoutMinutes * 60_000;

    try {
      await runCommand("git", ["-C", this.config.repoPath, "fetch", "origin", this.config.defaultBranch], {
        timeoutMs: gitProbeTimeoutMs,
      });
      const [baseDiffResult, workspaceStatusResult] = await Promise.all([
        runCommand("git", ["-C", resolvedPaths.workspace, "diff", "--name-only", `origin/${this.config.defaultBranch}...HEAD`], {
          timeoutMs: gitProbeTimeoutMs,
        }),
        runCommand("git", ["-C", resolvedPaths.workspace, "status", "--porcelain=v1", "-z", "--untracked-files=all"], {
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
        ...addressingReviewStrategyPatch(record, nextState),
        last_failure_context: inferFailureContext(this.config, record, pr, checks, reviewThreads),
        blocked_reason: null,
      });
      state.issues[String(record.issue_number)] = record;
      await this.stateStore.save(state);
      await syncJournal(record);

      return executeCodexTurnPhase({
        config: this.config,
        stateStore: this.stateStore,
        github: this.github,
        context: {
          ...context,
          record,
          reviewThreads,
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
    return runPreparedIssueFlow(
      {
        config: this.config,
        stateStore: this.stateStore,
        github: this.github,
        onEvent: this.onEvent,
        executeCodexTurn: (codexContext) => this.executeCodexTurn(codexContext),
        handlePostTurnPullRequestTransitions: (postTurnContext) =>
          this.handlePostTurnPullRequestTransitions(postTurnContext),
        handlePostTurnMergeAndCompletion: (state, issue, record, pr, options, recoveryEvents) =>
          this.handlePostTurnMergeAndCompletion(state, issue, record, pr, options, recoveryEvents),
      },
      context,
    );
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
      } else if (this.config.codexConnectorAutoMergeEnabled !== true) {
        nextRecord = this.stateStore.touch(nextRecord, {
          ...lifecyclePatch,
          state: "ready_to_merge",
          blocked_reason: null,
          last_auto_merge_guard_context: null,
          last_head_sha: currentPr.headRefOid,
        });
      } else {
        const autoMergeGuard = finalAutoMergeGuard({
          config: this.config,
          record: lifecycle.recordForState,
          originalPr: pr,
          currentPr,
          checks: refreshed.checks,
          reviewThreads: refreshed.reviewThreads,
        });
        if (autoMergeGuard.refusal) {
          nextRecord = this.stateStore.touch(nextRecord, {
            ...lifecyclePatch,
            state: "blocked",
            blocked_reason: "verification",
            last_error: truncate(autoMergeGuard.refusal.summary, 1000),
            last_failure_context: autoMergeGuard.refusal,
            last_auto_merge_guard_context: autoMergeGuard.evidence,
            ...applyFailureSignature(nextRecord, autoMergeGuard.refusal),
            last_head_sha: currentPr.headRefOid,
          });
        } else {
          await publishFinalAutoMergeGuardComment({
            github: this.github,
            pr: currentPr,
            evidence: autoMergeGuard.evidence,
          });
          await this.github.enableAutoMerge(currentPr.number, currentPr.headRefOid);
          nextRecord = this.stateStore.touch(nextRecord, {
            ...lifecyclePatch,
            state: "merging",
            blocked_reason: null,
            last_failure_context: null,
            last_auto_merge_guard_context: autoMergeGuard.evidence,
            last_head_sha: currentPr.headRefOid,
          });
        }
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
      configPath: this.configPath,
      github: this.github,
      stateStore: this.stateStore,
      options,
    });
  }

  async explain(issueNumber: number): Promise<string> {
    return renderIssueExplainDto(await this.explainReport(issueNumber));
  }

  async explainTimeline(issueNumber: number): Promise<string> {
    return renderIssueExplainTimelineDto(await this.explainReport(issueNumber));
  }

  async runRecoveryAction(
    action: SupervisorRecoveryAction,
    issueNumber: number,
  ): Promise<SupervisorMutationResultDto> {
    return this.mutationRuntime.runRecoveryAction(action, issueNumber);
  }

  async pruneOrphanedWorkspaces(): Promise<SupervisorOrphanPruneResultDto> {
    return this.mutationRuntime.pruneOrphanedWorkspaces();
  }

  async rollupExecutionMetrics(): Promise<SupervisorExecutionMetricsRollupResultDto> {
    return this.mutationRuntime.rollupExecutionMetrics();
  }

  async postMergeAuditSummaryReport(): Promise<PostMergeAuditPatternSummaryDto> {
    return summarizePostMergeAuditPatterns(this.config);
  }

  async resetCorruptJsonState() {
    return this.mutationRuntime.resetCorruptJsonState();
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
      configPath: this.configPath,
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

  async updateSetupConfig(options: Pick<UpdateSetupConfigArgs, "changes" | "dangerousOptInConfirmation">) {
    return updateSetupConfig({
      configPath: this.configPath,
      changes: options.changes,
      dangerousOptInConfirmation: options.dangerousOptInConfirmation,
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
      shouldReconcileTrackedBlockedRecordDuringDegradedContinuation: (record) =>
        shouldReconcileTrackedPrStaleReviewBot(record, this.config),
      setReconciliationPhase: (phase) =>
        phase === null
          ? clearCurrentReconciliationPhase(this.config)
          : writeCurrentReconciliationPhase(this.config, phase),
      reconcileStaleActiveIssueReservation: (state) => reconcileStaleActiveIssueReservation({
        config: this.config,
        stateStore: this.stateStore,
        state,
        issueLockPath: (issueNumber) => this.lockPath("issues", `issue-${issueNumber}`),
        sessionLockPath: (sessionId) => this.lockPath("sessions", `session-${sessionId}`),
        sameFailureSignatureRepeatLimit: this.config.sameFailureSignatureRepeatLimit,
        resolvePullRequestForBranch: (branch, trackedPrNumber, options) =>
          this.github.resolvePullRequestForBranch(branch, trackedPrNumber, options),
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
      reconcileMergedIssueClosures: (state, issues, updateReconciliationProgress) =>
        reconcileMergedIssueClosures(
          this.github,
          this.stateStore,
          state,
          this.config,
          issues,
          updateReconciliationProgress,
        ),
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
      reconcileStaleDoneIssueStates: (state, issues) =>
        reconcileStaleDoneIssueStates(this.github, this.stateStore, state, issues),
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

    const interruptedIssueNumber = interruptedTurnRecoveryIssueNumber(prelude.recoveryEvents);
    if (interruptedIssueNumber !== null) {
      return prependRecoveryLog(
        `Interrupted active turn for issue #${interruptedIssueNumber} requires manual recovery before selecting another runnable issue.`,
        formatRecoveryLog(prelude.recoveryEvents),
      );
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
