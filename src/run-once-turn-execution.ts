import { loadRelevantExternalReviewMissPatterns } from "./external-review/external-review-misses";
import { GitHubClient } from "./github";
import {
  hasMeaningfulJournalHandoff,
  normalizeCommittedIssueJournal,
  readIssueJournal,
} from "./core/journal";
import { LockHandle } from "./core/lock";
import {
  persistCodexTurnExecutionFailure,
  persistCodexTurnExitFailure,
  persistHintedCodexTurnState,
  persistMissingCodexJournalHandoff,
} from "./turn-execution-failure-helpers";
import {
} from "./review-handling";
import {
  PullRequestLifecycleSnapshot,
} from "./post-turn-pull-request";
import { IssueJournalSync, MemoryArtifacts } from "./run-once-issue-preparation";
import { type LocalCiCommandRunner } from "./local-ci";
import {
  buildWorkstationLocalPathFailureContext,
  runWorkstationLocalPathGate,
  type WorkstationLocalPathGateResult,
} from "./workstation-local-path-gate";
import { StateStore } from "./core/state-store";
import {
  getStaleStabilizingNoPrRecoveryCount,
  shouldPreserveStaleStabilizingNoPrRecoveryTracking,
} from "./no-pull-request-state";
import {
  nextProcessedReviewThreadPatch,
  nextReviewFollowUpPatch,
  prepareCodexTurnPrompt,
  shouldResumeAgentTurn,
} from "./turn-execution-orchestration";
import {
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
} from "./core/types";
import { truncate } from "./core/utils";
import { commitAndPushTrackedFiles, filterPresentTrackedFilePaths, getWorkspaceStatus, pushBranch } from "./core/workspace";
import { AgentRunner, createCodexAgentRunner } from "./supervisor/agent-runner";
import {
  executionMetricsRetentionRootPath,
  syncExecutionMetricsRunSummarySafely,
} from "./supervisor/execution-metrics-run-summary";
import {
  captureIssueJournalFingerprint,
  clearInterruptedTurnMarker,
  writeInterruptedTurnMarker,
} from "./interrupted-turn-marker";
import { issueDefinitionFreshnessPatch } from "./issue-definition-freshness";
import { applyCodexTurnPublicationGate } from "./turn-execution-publication-gate";

export {
  handlePostTurnPullRequestTransitionsPhase,
  PostTurnPullRequestContext,
  PostTurnPullRequestResult,
} from "./post-turn-pull-request";

export { loadLocalReviewRepairContext } from "./local-review/repair-context";

export interface CodexTurnContext {
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
  options: { dryRun: boolean };
}

export interface CodexTurnResult {
  kind: "completed";
  record: IssueRunRecord;
  workspaceStatus: WorkspaceStatus;
  pr: GitHubPullRequest | null;
  checks: PullRequestCheck[];
  reviewThreads: ReviewThread[];
}

const TRUSTED_DURABLE_ARTIFACT_NORMALIZATION_COMMIT_MESSAGE = "Normalize trusted durable artifacts for path hygiene";

export interface CodexTurnShortCircuit {
  kind: "returned";
  message: string;
}

interface RecoverUnexpectedCodexTurnFailureArgs {
  config: Pick<SupervisorConfig, "stateFile">;
  stateStore: Pick<StateStore, "touch" | "save">;
  state: SupervisorStateFile;
  record: IssueRunRecord;
  issue: GitHubIssue;
  journalSync: (record: IssueRunRecord) => Promise<void>;
  error: unknown;
  workspaceStatus: Pick<WorkspaceStatus, "hasUncommittedChanges" | "headSha"> | null;
  pr: Pick<GitHubPullRequest, "number" | "headRefOid" | "createdAt" | "mergedAt"> | null;
}

interface ExecuteCodexTurnPhaseArgs {
  config: SupervisorConfig;
  stateStore: Pick<StateStore, "touch" | "save">;
  github: Pick<
    GitHubClient,
    "resolvePullRequestForBranch" | "createPullRequest" | "getChecks" | "getUnresolvedReviewThreads" | "getExternalReviewSurface"
  >;
  context: CodexTurnContext;
  sessionLock?: LockHandle | null;
  acquireSessionLock: (sessionId: string) => Promise<LockHandle | null>;
  classifyFailure: (message: string | null | undefined) => "timeout" | "command_error";
  buildCodexFailureContext: (
    category: FailureContext["category"],
    summary: string,
    details: string[],
  ) => FailureContext;
  applyFailureSignature: (
    record: IssueRunRecord,
    failureContext: FailureContext | null,
  ) => Pick<IssueRunRecord, "last_failure_signature" | "repeated_failure_signature_count">;
  normalizeBlockerSignature: (message: string | null | undefined) => string | null;
  isVerificationBlockedMessage: (message: string | null | undefined) => boolean;
  derivePullRequestLifecycleSnapshot: (
    record: IssueRunRecord,
    pr: GitHubPullRequest,
    checks: PullRequestCheck[],
    reviewThreads: ReviewThread[],
    recordPatch?: Partial<IssueRunRecord>,
  ) => PullRequestLifecycleSnapshot;
  inferStateWithoutPullRequest: (record: IssueRunRecord, workspaceStatus: WorkspaceStatus) => RunState;
  blockedReasonFromReviewState: (
    record: IssueRunRecord,
    pr: GitHubPullRequest,
    checks: PullRequestCheck[],
    reviewThreads: ReviewThread[],
  ) => IssueRunRecord["blocked_reason"];
  recoverUnexpectedCodexTurnFailure: (
    args: RecoverUnexpectedCodexTurnFailureArgs,
  ) => Promise<IssueRunRecord>;
  persistCodexTurnExecutionFailure?: (args: {
    stateStore: Pick<StateStore, "touch" | "save">;
    state: SupervisorStateFile;
    record: IssueRunRecord;
    issue: Pick<GitHubIssue, "createdAt">;
    syncJournal: (record: IssueRunRecord) => Promise<void>;
    issueNumber: number;
    error: unknown;
    classifyFailure: (message: string | null | undefined) => "timeout" | "command_error";
    buildCodexFailureContext: (
      category: FailureContext["category"],
      summary: string,
      details: string[],
    ) => FailureContext;
    applyFailureSignature: (
      record: IssueRunRecord,
      failureContext: FailureContext | null,
    ) => Pick<IssueRunRecord, "last_failure_signature" | "repeated_failure_signature_count">;
    retentionRootPath?: string;
  }) => Promise<IssueRunRecord>;
  persistCodexTurnExitFailure?: (args: {
    stateStore: Pick<StateStore, "touch" | "save">;
    state: SupervisorStateFile;
    record: IssueRunRecord;
    issue: Pick<GitHubIssue, "createdAt">;
    syncJournal: (record: IssueRunRecord) => Promise<void>;
    issueNumber: number;
    codexResult: Pick<import("./core/types").CodexTurnResult, "lastMessage" | "stderr" | "stdout">;
    classifyFailure: (message: string | null | undefined) => "timeout" | "command_error";
    buildCodexFailureContext: (
      category: FailureContext["category"],
      summary: string,
      details: string[],
    ) => FailureContext;
    applyFailureSignature: (
      record: IssueRunRecord,
      failureContext: FailureContext | null,
    ) => Pick<IssueRunRecord, "last_failure_signature" | "repeated_failure_signature_count">;
    retentionRootPath?: string;
  }) => Promise<IssueRunRecord>;
  persistMissingCodexJournalHandoff?: (args: {
    stateStore: Pick<StateStore, "touch" | "save">;
    state: SupervisorStateFile;
    record: IssueRunRecord;
    issue: Pick<GitHubIssue, "createdAt">;
    syncJournal: (record: IssueRunRecord) => Promise<void>;
    issueNumber: number;
    buildCodexFailureContext: (
      category: FailureContext["category"],
      summary: string,
      details: string[],
    ) => FailureContext;
    applyFailureSignature: (
      record: IssueRunRecord,
      failureContext: FailureContext | null,
    ) => Pick<IssueRunRecord, "last_failure_signature" | "repeated_failure_signature_count">;
    retentionRootPath?: string;
  }) => Promise<IssueRunRecord>;
  persistHintedCodexTurnState?: (args: {
    stateStore: Pick<StateStore, "touch" | "save">;
    state: SupervisorStateFile;
    record: IssueRunRecord;
    issue: Pick<GitHubIssue, "createdAt">;
    syncJournal: (record: IssueRunRecord) => Promise<void>;
    issueNumber: number;
    lastMessage: string;
    hintedState: "blocked" | "failed";
    hintedBlockedReason: IssueRunRecord["blocked_reason"];
    hintedFailureSignature: string | null;
    buildCodexFailureContext: (
      category: FailureContext["category"],
      summary: string,
      details: string[],
    ) => FailureContext;
    applyFailureSignature: (
      record: IssueRunRecord,
      failureContext: FailureContext | null,
    ) => Pick<IssueRunRecord, "last_failure_signature" | "repeated_failure_signature_count">;
    normalizeBlockerSignature: (message: string | null | undefined) => string | null;
    isVerificationBlockedMessage: (message: string | null | undefined) => boolean;
    retentionRootPath?: string;
  }) => Promise<IssueRunRecord>;
  getWorkspaceStatus?: typeof getWorkspaceStatus;
  pushBranch?: typeof pushBranch;
  readIssueJournal?: typeof readIssueJournal;
  agentRunner?: AgentRunner;
  runLocalCiCommand?: LocalCiCommandRunner;
  runWorkstationLocalPathGate?: (args: {
    workspacePath: string;
    gateLabel: string;
    publishablePathAllowlistMarkers?: readonly string[];
  }) => Promise<WorkstationLocalPathGateResult>;
}

export async function executeCodexTurnPhase(
  args: ExecuteCodexTurnPhaseArgs,
): Promise<CodexTurnResult | CodexTurnShortCircuit> {
  const getWorkspaceStatusImpl = args.getWorkspaceStatus ?? getWorkspaceStatus;
  const pushBranchImpl = args.pushBranch ?? pushBranch;
  const readIssueJournalImpl = args.readIssueJournal ?? readIssueJournal;
  const persistCodexTurnExecutionFailureImpl =
    args.persistCodexTurnExecutionFailure ?? persistCodexTurnExecutionFailure;
  const persistCodexTurnExitFailureImpl = args.persistCodexTurnExitFailure ?? persistCodexTurnExitFailure;
  const persistMissingCodexJournalHandoffImpl =
    args.persistMissingCodexJournalHandoff ?? persistMissingCodexJournalHandoff;
  const persistHintedCodexTurnStateImpl =
    args.persistHintedCodexTurnState ?? persistHintedCodexTurnState;
  const runWorkstationLocalPathGateImpl = args.runWorkstationLocalPathGate ?? runWorkstationLocalPathGate;
  const agentRunner =
    args.agentRunner ??
    createCodexAgentRunner({
      config: args.config,
      classifyFailureImpl: args.classifyFailure,
      buildFailureContextImpl: args.buildCodexFailureContext,
    });
  const { config, stateStore, github } = args;
  const { state, issue, previousCodexSummary, previousError, workspacePath, journalPath, syncJournal, memoryArtifacts, options } = args.context;
  let { record, workspaceStatus, pr, checks, reviewThreads } = args.context;
  let turnMarkerWritten = false;

  try {
    if (options.dryRun) {
      return {
        kind: "returned",
        message: `Dry run: would invoke Codex for issue #${record.issue_number}.`,
      };
    }

    const preRunState = record.state;
    const shouldResumeTurn = shouldResumeAgentTurn({
      record,
      agentRunnerCapabilities: agentRunner.capabilities,
    });
    const sessionLock =
      args.sessionLock ??
      (shouldResumeTurn
        ? await args.acquireSessionLock(record.codex_session_id!)
        : null);
    if (sessionLock && !sessionLock.acquired) {
      return {
        kind: "returned",
        message: `Skipped issue #${record.issue_number}: ${sessionLock.reason}.`,
      };
    }

    let journalContent = await readIssueJournalImpl(journalPath);
    if (journalContent === null) {
      await syncJournal(record);
      journalContent = await readIssueJournalImpl(journalPath);
    }
    const effectiveJournalContent = journalContent ?? "";

    try {
      const preparedTurn = await prepareCodexTurnPrompt({
        config,
        stateStore,
        state,
        record,
        issue,
        previousCodexSummary,
        previousError,
        workspacePath,
        journalPath,
        journalContent: effectiveJournalContent,
        syncJournal,
        memoryArtifacts,
        pr,
        checks,
        reviewThreads,
        github,
        agentRunnerCapabilities: agentRunner.capabilities,
      });
      record = preparedTurn.record;
      const { turnContext, reviewThreadsToProcess } = preparedTurn;
      const preRunJournalFingerprint = await captureIssueJournalFingerprint(journalPath);
      await writeInterruptedTurnMarker({
        workspacePath,
        issueNumber: record.issue_number,
        state: record.state,
        journalFingerprint: preRunJournalFingerprint,
      });
      turnMarkerWritten = true;
      const turnResult = await agentRunner.runTurn(turnContext);
      const structuredResult = agentRunner.capabilities.supportsStructuredResult ? turnResult.structuredResult : null;
      const hintedState = structuredResult?.stateHint ?? null;
      const hintedBlockedReason = structuredResult?.blockedReason ?? null;
      const hintedFailureSignature = structuredResult?.failureSignature ?? null;
      const preTurnFailureContext = record.last_failure_context;
      const preTurnFailureSignature = record.last_failure_signature;
      const preTurnStaleNoPrRecoveryCount = getStaleStabilizingNoPrRecoveryCount(record);
      const preTurnLastError = record.last_error;
      const journalAfterRun = await readIssueJournalImpl(journalPath);
      const normalizedJournalAfterRun =
        journalAfterRun === null
          ? null
          : await normalizeCommittedIssueJournal({
              journalPath,
              workspacePath,
            });
      const effectiveJournalAfterRun = normalizedJournalAfterRun ?? journalAfterRun;
      record = stateStore.touch(record, {
        codex_session_id: turnResult.sessionId,
        last_codex_summary: truncate(turnResult.supervisorMessage),
        last_failure_kind: turnResult.failureKind,
        last_error:
          turnResult.exitCode === 0
            ? null
            : truncate([turnResult.stderr.trim(), turnResult.stdout.trim()].filter(Boolean).join("\n")),
      });

      if (
        turnResult.exitCode === 0 &&
        (!effectiveJournalAfterRun ||
          effectiveJournalAfterRun === effectiveJournalContent ||
          !hasMeaningfulJournalHandoff(effectiveJournalAfterRun))
      ) {
        record = await persistMissingCodexJournalHandoffImpl({
          stateStore,
          state,
          record,
          issue,
          syncJournal,
          issueNumber: record.issue_number,
          buildCodexFailureContext: args.buildCodexFailureContext,
          applyFailureSignature: args.applyFailureSignature,
          retentionRootPath: executionMetricsRetentionRootPath(args.config.stateFile),
        });
        return {
          kind: "returned",
          message: `Codex turn for issue #${record.issue_number} was rejected because no journal handoff was written.`,
        };
      }

      if (turnResult.failureKind === "timeout" || turnResult.failureKind === "command_error") {
        const message =
          turnResult.stderr.trim() ||
          turnResult.stdout.trim() ||
          turnResult.supervisorMessage.trim() ||
          "Unknown failure";
        record = await persistCodexTurnExecutionFailureImpl({
          stateStore,
          state,
          record,
          issue,
          syncJournal,
          issueNumber: record.issue_number,
          error: new Error(message),
          classifyFailure: args.classifyFailure,
          buildCodexFailureContext: args.buildCodexFailureContext,
          applyFailureSignature: args.applyFailureSignature,
          retentionRootPath: executionMetricsRetentionRootPath(args.config.stateFile),
        });
        return {
          kind: "returned",
          message: `Codex turn failed for issue #${record.issue_number}.`,
        };
      }

      if (turnResult.exitCode !== 0) {
        record = await persistCodexTurnExitFailureImpl({
          stateStore,
          state,
          record,
          issue,
          syncJournal,
          issueNumber: record.issue_number,
          codexResult: {
            lastMessage: turnResult.supervisorMessage,
            stderr: turnResult.stderr,
            stdout: turnResult.stdout,
          },
          classifyFailure: args.classifyFailure,
          buildCodexFailureContext: args.buildCodexFailureContext,
          applyFailureSignature: args.applyFailureSignature,
          retentionRootPath: executionMetricsRetentionRootPath(args.config.stateFile),
        });
        return {
          kind: "returned",
          message: `Codex turn failed for issue #${record.issue_number}.`,
        };
      }

      if (hintedState === "blocked" || hintedState === "failed") {
        record = await persistHintedCodexTurnStateImpl({
          stateStore,
          state,
          record,
          issue,
          syncJournal,
          issueNumber: record.issue_number,
          lastMessage: turnResult.supervisorMessage,
          hintedState,
          hintedBlockedReason,
          hintedFailureSignature,
          buildCodexFailureContext: args.buildCodexFailureContext,
          applyFailureSignature: args.applyFailureSignature,
          normalizeBlockerSignature: args.normalizeBlockerSignature,
          isVerificationBlockedMessage: args.isVerificationBlockedMessage,
          retentionRootPath: executionMetricsRetentionRootPath(args.config.stateFile),
        });
        return {
          kind: "returned",
          message: `Codex reported ${hintedState} for issue #${record.issue_number}.`,
        };
      }

      workspaceStatus = await getWorkspaceStatusImpl(workspacePath, record.branch, config.defaultBranch);
      record = stateStore.touch(record, { last_head_sha: workspaceStatus.headSha });
      let evaluatedReviewHeadSha = workspaceStatus.headSha;

      if ((workspaceStatus.remoteAhead > 0 || !workspaceStatus.remoteBranchExists) && !workspaceStatus.hasUncommittedChanges) {
        const pathHygieneGate = await runWorkstationLocalPathGateImpl({
          workspacePath,
          gateLabel: "before publication",
          publishablePathAllowlistMarkers: config.publishablePathAllowlistMarkers,
        });
        if (!pathHygieneGate.ok) {
          const failureContext = pathHygieneGate.failureContext;
          record = stateStore.touch(record, {
            state: "blocked",
            last_error: truncate(
              failureContext?.summary ?? "Tracked durable artifacts failed workstation-local path hygiene before publication.",
              1000,
            ),
            last_failure_kind: null,
            last_failure_context: failureContext,
            ...args.applyFailureSignature(record, failureContext),
            blocked_reason: "verification",
            ...issueDefinitionFreshnessPatch(issue),
          });
          state.issues[String(record.issue_number)] = record;
          await stateStore.save(state);
          await syncExecutionMetricsRunSummarySafely({
            previousRecord: args.context.record,
            nextRecord: record,
            issue,
            pullRequest: pr,
            retentionRootPath: executionMetricsRetentionRootPath(args.config.stateFile),
            warningContext: "persisting",
          });
          await syncJournal(record);
          return {
            kind: "returned",
            message: `Workstation-local path hygiene blocked publication for issue #${record.issue_number}.`,
          };
        }
        const rewrittenTrackedPaths = [
          ...(pathHygieneGate.rewrittenJournalPaths ?? []),
          ...(pathHygieneGate.rewrittenTrustedGeneratedArtifactPaths ?? []),
        ];
        const presentRewrittenTrackedPaths = await filterPresentTrackedFilePaths(workspacePath, rewrittenTrackedPaths);
        if (presentRewrittenTrackedPaths.length > 0) {
          try {
            await commitAndPushTrackedFiles({
              workspacePath,
              branch: record.branch,
              remoteBranchExists: workspaceStatus.remoteBranchExists,
              filePaths: presentRewrittenTrackedPaths,
              commitMessage: TRUSTED_DURABLE_ARTIFACT_NORMALIZATION_COMMIT_MESSAGE,
            });
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            const failureContext = buildWorkstationLocalPathFailureContext({
              gateLabel: "before publication",
              details: [
                `durable artifact normalization persistence failed for ${presentRewrittenTrackedPaths.join(", ")}: ${message}`,
              ],
            });
            record = stateStore.touch(record, {
              state: "blocked",
              last_error: truncate(failureContext.summary, 1000),
              last_failure_kind: null,
              last_failure_context: failureContext,
              ...args.applyFailureSignature(record, failureContext),
              blocked_reason: "verification",
              ...issueDefinitionFreshnessPatch(issue),
            });
            state.issues[String(record.issue_number)] = record;
            await stateStore.save(state);
            await syncExecutionMetricsRunSummarySafely({
              previousRecord: args.context.record,
              nextRecord: record,
              issue,
              pullRequest: pr,
              retentionRootPath: executionMetricsRetentionRootPath(args.config.stateFile),
              warningContext: "persisting",
            });
            await syncJournal(record);
            return {
              kind: "returned",
              message: `Workstation-local path hygiene blocked publication for issue #${record.issue_number}.`,
            };
          }
          workspaceStatus = await getWorkspaceStatusImpl(workspacePath, record.branch, config.defaultBranch);
          evaluatedReviewHeadSha = workspaceStatus.headSha;
          record = stateStore.touch(record, { last_head_sha: evaluatedReviewHeadSha });
        }
        if (workspaceStatus.remoteAhead > 0 || !workspaceStatus.remoteBranchExists) {
          await pushBranchImpl(workspacePath, record.branch, workspaceStatus.remoteBranchExists);
          workspaceStatus = await getWorkspaceStatusImpl(workspacePath, record.branch, config.defaultBranch);
          evaluatedReviewHeadSha = workspaceStatus.headSha;
          record = stateStore.touch(record, { last_head_sha: evaluatedReviewHeadSha });
        }
      }

      const publicationGate = await applyCodexTurnPublicationGate({
        config,
        stateStore,
        state,
        record,
        issue,
        workspacePath,
        workspaceStatus,
        github,
        syncJournal,
        applyFailureSignature: args.applyFailureSignature,
        runLocalCiCommand: args.runLocalCiCommand,
        runWorkstationLocalPathGate: args.runWorkstationLocalPathGate,
        syncExecutionMetricsRunSummary: async (blockedRecord) => {
          await syncExecutionMetricsRunSummarySafely({
            previousRecord: args.context.record,
            nextRecord: blockedRecord,
            issue,
            retentionRootPath: executionMetricsRetentionRootPath(args.config.stateFile),
            warningContext: "persisting",
          });
        },
      });
      record = publicationGate.record;
      pr = publicationGate.pr;
      checks = publicationGate.checks;
      reviewThreads = publicationGate.reviewThreads;
      if (publicationGate.kind === "blocked") {
        return {
          kind: "returned",
          message: publicationGate.message,
        };
      }

      const processedReviewThreadPatch = nextProcessedReviewThreadPatch({
        preRunState,
        record,
        currentPr: pr,
        evaluatedReviewHeadSha,
        reviewThreadsToProcess,
      });
      const reviewFollowUpPatch = nextReviewFollowUpPatch({
        config,
        preRunState,
        record,
        currentPr: pr,
        evaluatedReviewHeadSha,
        preRunReviewThreads: args.context.reviewThreads,
        postRunReviewThreads: reviewThreads,
      });
      const postRunSnapshot = pr
        ? args.derivePullRequestLifecycleSnapshot(
            record,
            pr,
            checks,
            reviewThreads,
            {
              ...processedReviewThreadPatch,
              ...reviewFollowUpPatch,
            },
          )
        : null;
      const postRunState = postRunSnapshot
        ? postRunSnapshot.nextState
        : hintedState ?? args.inferStateWithoutPullRequest(record, workspaceStatus);
      const preserveStaleNoPrRecoveryTracking =
        pr === null && postRunSnapshot === null && shouldPreserveStaleStabilizingNoPrRecoveryTracking(record, postRunState);
      record = stateStore.touch(record, {
        pr_number: pr?.number ?? null,
        ...(postRunSnapshot?.reviewWaitPatch ?? {}),
        ...(postRunSnapshot?.copilotRequestObservationPatch ?? {}),
        ...(postRunSnapshot?.copilotTimeoutPatch ?? {}),
        ...processedReviewThreadPatch,
        ...reviewFollowUpPatch,
        blocked_verification_retry_count: pr ? 0 : record.blocked_verification_retry_count,
        repeated_blocker_count: 0,
        last_blocker_signature: null,
        stale_stabilizing_no_pr_recovery_count: preserveStaleNoPrRecoveryTracking
          ? preTurnStaleNoPrRecoveryCount
          : 0,
        last_error:
          preserveStaleNoPrRecoveryTracking
            ? preTurnLastError
            : postRunState === "blocked" && postRunSnapshot?.failureContext
            ? truncate(postRunSnapshot.failureContext.summary, 1000)
            : record.last_error,
        last_failure_context:
          preserveStaleNoPrRecoveryTracking ? preTurnFailureContext : postRunSnapshot?.failureContext ?? null,
        ...(
          preserveStaleNoPrRecoveryTracking
            ? {
                last_failure_signature: preTurnFailureSignature,
                repeated_failure_signature_count: 0,
              }
            : args.applyFailureSignature(record, postRunSnapshot?.failureContext ?? null)
        ),
        blocked_reason:
          pr && postRunState === "blocked"
            ? args.blockedReasonFromReviewState(postRunSnapshot?.recordForState ?? record, pr, checks, reviewThreads)
            : null,
        state: postRunState,
        ...((pr === null && (postRunState === "blocked" || postRunState === "failed"))
          ? issueDefinitionFreshnessPatch(issue)
          : {}),
      });
      state.issues[String(record.issue_number)] = record;
      await stateStore.save(state);
      await syncExecutionMetricsRunSummarySafely({
        previousRecord: args.context.record,
        nextRecord: record,
        issue,
        pullRequest: pr,
        retentionRootPath: executionMetricsRetentionRootPath(args.config.stateFile),
        warningContext: "persisting",
      });
      await syncJournal(record);

      return {
        kind: "completed",
        record,
        workspaceStatus,
        pr,
        checks,
        reviewThreads,
      };
    } finally {
      await sessionLock?.release();
    }
  } catch (error) {
    record = await args.recoverUnexpectedCodexTurnFailure({
      config,
      stateStore,
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
  } finally {
    if (turnMarkerWritten) {
      try {
        await clearInterruptedTurnMarker(workspacePath);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.warn(
          `Failed to clear interrupted turn marker for issue #${record.issue_number} in ${workspacePath}: ${message}`,
        );
      }
    }
  }
}
