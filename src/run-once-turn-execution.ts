import {
  extractBlockedReason,
  extractFailureSignature,
  extractStateHint,
  runCodexTurn,
} from "./codex";
import { loadRelevantExternalReviewMissPatterns } from "./external-review/external-review-misses";
import { GitHubClient } from "./github";
import {
  hasMeaningfulJournalHandoff,
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
import { StateStore } from "./core/state-store";
import {
  nextProcessedReviewThreadPatch,
  prepareCodexTurnPrompt,
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
import { getWorkspaceStatus, pushBranch } from "./core/workspace";

export {
  handlePostTurnPullRequestTransitionsPhase,
  PostTurnPullRequestContext,
  PostTurnPullRequestResult,
} from "./post-turn-pull-request";

function isOpenPullRequest(pr: GitHubPullRequest | null): pr is GitHubPullRequest {
  return pr !== null && pr.state === "OPEN" && !pr.mergedAt;
}

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

export interface CodexTurnShortCircuit {
  kind: "returned";
  message: string;
}

interface RecoverUnexpectedCodexTurnFailureArgs {
  stateStore: Pick<StateStore, "touch" | "save">;
  state: SupervisorStateFile;
  record: IssueRunRecord;
  issue: GitHubIssue;
  journalSync: (record: IssueRunRecord) => Promise<void>;
  error: unknown;
  workspaceStatus: Pick<WorkspaceStatus, "hasUncommittedChanges" | "headSha"> | null;
  pr: Pick<GitHubPullRequest, "number" | "headRefOid"> | null;
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
    reviewThreads: ReviewThread[],
  ) => IssueRunRecord["blocked_reason"];
  recoverUnexpectedCodexTurnFailure: (
    args: RecoverUnexpectedCodexTurnFailureArgs,
  ) => Promise<IssueRunRecord>;
  persistCodexTurnExecutionFailure?: (args: {
    stateStore: Pick<StateStore, "touch" | "save">;
    state: SupervisorStateFile;
    record: IssueRunRecord;
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
  }) => Promise<IssueRunRecord>;
  persistCodexTurnExitFailure?: (args: {
    stateStore: Pick<StateStore, "touch" | "save">;
    state: SupervisorStateFile;
    record: IssueRunRecord;
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
  }) => Promise<IssueRunRecord>;
  persistMissingCodexJournalHandoff?: (args: {
    stateStore: Pick<StateStore, "touch" | "save">;
    state: SupervisorStateFile;
    record: IssueRunRecord;
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
  }) => Promise<IssueRunRecord>;
  persistHintedCodexTurnState?: (args: {
    stateStore: Pick<StateStore, "touch" | "save">;
    state: SupervisorStateFile;
    record: IssueRunRecord;
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
  }) => Promise<IssueRunRecord>;
  getWorkspaceStatus?: typeof getWorkspaceStatus;
  pushBranch?: typeof pushBranch;
  readIssueJournal?: typeof readIssueJournal;
  runCodexTurnImpl?: typeof runCodexTurn;
}

export async function executeCodexTurnPhase(
  args: ExecuteCodexTurnPhaseArgs,
): Promise<CodexTurnResult | CodexTurnShortCircuit> {
  const getWorkspaceStatusImpl = args.getWorkspaceStatus ?? getWorkspaceStatus;
  const pushBranchImpl = args.pushBranch ?? pushBranch;
  const readIssueJournalImpl = args.readIssueJournal ?? readIssueJournal;
  const runCodexTurnImpl = args.runCodexTurnImpl ?? runCodexTurn;
  const persistCodexTurnExecutionFailureImpl =
    args.persistCodexTurnExecutionFailure ?? persistCodexTurnExecutionFailure;
  const persistCodexTurnExitFailureImpl = args.persistCodexTurnExitFailure ?? persistCodexTurnExitFailure;
  const persistMissingCodexJournalHandoffImpl =
    args.persistMissingCodexJournalHandoff ?? persistMissingCodexJournalHandoff;
  const persistHintedCodexTurnStateImpl =
    args.persistHintedCodexTurnState ?? persistHintedCodexTurnState;
  const { config, stateStore, github } = args;
  const { state, issue, previousCodexSummary, previousError, workspacePath, journalPath, syncJournal, memoryArtifacts, options } = args.context;
  let { record, workspaceStatus, pr, checks, reviewThreads } = args.context;

  try {
    if (options.dryRun) {
      return {
        kind: "returned",
        message: `Dry run: would invoke Codex for issue #${record.issue_number}.`,
      };
    }

    const journalContent = (await readIssueJournalImpl(journalPath)) ?? "";
    const preRunState = record.state;
    const sessionLock =
      args.sessionLock ??
      (record.codex_session_id ? await args.acquireSessionLock(record.codex_session_id) : null);
    if (sessionLock && !sessionLock.acquired) {
      return {
        kind: "returned",
        message: `Skipped issue #${record.issue_number}: ${sessionLock.reason}.`,
      };
    }

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
        journalContent,
        syncJournal,
        memoryArtifacts,
        pr,
        checks,
        reviewThreads,
        github,
      });
      record = preparedTurn.record;
      const { prompt, reviewThreadsToProcess } = preparedTurn;

      let codexResult;
      try {
        codexResult = await runCodexTurnImpl(
          config,
          workspacePath,
          prompt,
          record.state,
          record,
          record.codex_session_id,
        );
      } catch (error) {
        record = await persistCodexTurnExecutionFailureImpl({
          stateStore,
          state,
          record,
          syncJournal,
          issueNumber: record.issue_number,
          error,
          classifyFailure: args.classifyFailure,
          buildCodexFailureContext: args.buildCodexFailureContext,
          applyFailureSignature: args.applyFailureSignature,
        });
        return {
          kind: "returned",
          message: `Codex turn failed for issue #${record.issue_number}.`,
        };
      }

      const hintedState = extractStateHint(codexResult.lastMessage);
      const hintedBlockedReason = extractBlockedReason(codexResult.lastMessage);
      const hintedFailureSignature = extractFailureSignature(codexResult.lastMessage);
      const journalAfterRun = await readIssueJournalImpl(journalPath);
      record = stateStore.touch(record, {
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
        record = await persistMissingCodexJournalHandoffImpl({
          stateStore,
          state,
          record,
          syncJournal,
          issueNumber: record.issue_number,
          buildCodexFailureContext: args.buildCodexFailureContext,
          applyFailureSignature: args.applyFailureSignature,
        });
        return {
          kind: "returned",
          message: `Codex turn for issue #${record.issue_number} was rejected because no journal handoff was written.`,
        };
      }

      if (codexResult.exitCode !== 0) {
        record = await persistCodexTurnExitFailureImpl({
          stateStore,
          state,
          record,
          syncJournal,
          issueNumber: record.issue_number,
          codexResult,
          classifyFailure: args.classifyFailure,
          buildCodexFailureContext: args.buildCodexFailureContext,
          applyFailureSignature: args.applyFailureSignature,
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
          syncJournal,
          issueNumber: record.issue_number,
          lastMessage: codexResult.lastMessage,
          hintedState,
          hintedBlockedReason,
          hintedFailureSignature,
          buildCodexFailureContext: args.buildCodexFailureContext,
          applyFailureSignature: args.applyFailureSignature,
          normalizeBlockerSignature: args.normalizeBlockerSignature,
          isVerificationBlockedMessage: args.isVerificationBlockedMessage,
        });
        return {
          kind: "returned",
          message: `Codex reported ${hintedState} for issue #${record.issue_number}.`,
        };
      }

      workspaceStatus = await getWorkspaceStatusImpl(workspacePath, record.branch, config.defaultBranch);
      record = stateStore.touch(record, { last_head_sha: workspaceStatus.headSha });
      const evaluatedReviewHeadSha = workspaceStatus.headSha;

      if ((workspaceStatus.remoteAhead > 0 || !workspaceStatus.remoteBranchExists) && !workspaceStatus.hasUncommittedChanges) {
        await pushBranchImpl(workspacePath, record.branch, workspaceStatus.remoteBranchExists);
        workspaceStatus = await getWorkspaceStatusImpl(workspacePath, record.branch, config.defaultBranch);
      }

      const refreshedResolvedPr = await github.resolvePullRequestForBranch(record.branch, record.pr_number);
      pr = isOpenPullRequest(refreshedResolvedPr) ? refreshedResolvedPr : null;
      if (
        !pr &&
        workspaceStatus.baseAhead > 0 &&
        !workspaceStatus.hasUncommittedChanges &&
        record.implementation_attempt_count >= config.draftPrAfterAttempt
      ) {
        pr = await github.createPullRequest(issue, record, { draft: true });
      }

      checks = pr ? await github.getChecks(pr.number) : [];
      reviewThreads = pr ? await github.getUnresolvedReviewThreads(pr.number) : [];
      const processedReviewThreadPatch = nextProcessedReviewThreadPatch({
        preRunState,
        record,
        currentPr: pr,
        evaluatedReviewHeadSha,
        reviewThreadsToProcess,
      });
      const postRunSnapshot = pr
        ? args.derivePullRequestLifecycleSnapshot(
            record,
            pr,
            checks,
            reviewThreads,
            processedReviewThreadPatch,
          )
        : null;
      const postRunState = postRunSnapshot
        ? postRunSnapshot.nextState
        : hintedState ?? args.inferStateWithoutPullRequest(record, workspaceStatus);
      record = stateStore.touch(record, {
        pr_number: pr?.number ?? null,
        ...(postRunSnapshot?.reviewWaitPatch ?? {}),
        ...(postRunSnapshot?.copilotRequestObservationPatch ?? {}),
        ...(postRunSnapshot?.copilotTimeoutPatch ?? {}),
        ...processedReviewThreadPatch,
        blocked_verification_retry_count: pr ? 0 : record.blocked_verification_retry_count,
        repeated_blocker_count: 0,
        last_blocker_signature: null,
        last_error:
          postRunState === "blocked" && postRunSnapshot?.failureContext
            ? truncate(postRunSnapshot.failureContext.summary, 1000)
            : record.last_error,
        last_failure_context: postRunSnapshot?.failureContext ?? null,
        ...args.applyFailureSignature(record, postRunSnapshot?.failureContext ?? null),
        blocked_reason:
          pr && postRunState === "blocked"
            ? args.blockedReasonFromReviewState(postRunSnapshot?.recordForState ?? record, pr, reviewThreads)
            : null,
        state: postRunState,
      });
      state.issues[String(record.issue_number)] = record;
      await stateStore.save(state);
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
  }
}
