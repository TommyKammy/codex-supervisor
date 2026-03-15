import fs from "node:fs";
import path from "node:path";
import {
  buildCodexPrompt,
  buildCodexResumePrompt,
  extractBlockedReason,
  extractFailureSignature,
  extractStateHint,
  runCodexTurn,
  shouldUseCompactResumePrompt,
} from "./codex";
import {
  collectExternalReviewSignals,
  ExternalReviewMissContext,
  loadRelevantExternalReviewMissPatterns,
  writeExternalReviewMissArtifact,
} from "./external-review-misses";
import { GitHubClient } from "./github";
import {
  hasMeaningfulJournalHandoff,
  readIssueJournal,
} from "./journal";
import { LockHandle } from "./lock";
import {
  persistCodexTurnExecutionFailure,
  persistCodexTurnExitFailure,
  persistHintedCodexTurnState,
  persistMissingCodexJournalHandoff,
} from "./turn-execution-failure-helpers";
import {
  hasProcessedReviewThread,
  latestReviewThreadCommentFingerprint,
  processedReviewThreadFingerprintKey,
  processedReviewThreadKey,
} from "./review-handling";
import {
  PullRequestLifecycleSnapshot,
} from "./post-turn-pull-request";
import { IssueJournalSync, MemoryArtifacts } from "./run-once-issue-preparation";
import { StateStore } from "./state-store";
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
} from "./types";
import { parseJson, truncate } from "./utils";
import { loadRelevantVerifierGuardrails } from "./verifier-guardrails";
import { getWorkspaceStatus, pushBranch } from "./workspace";

export {
  handlePostTurnPullRequestTransitionsPhase,
  PostTurnPullRequestContext,
  PostTurnPullRequestResult,
} from "./post-turn-pull-request";

function isOpenPullRequest(pr: GitHubPullRequest | null): pr is GitHubPullRequest {
  return pr !== null && pr.state === "OPEN" && !pr.mergedAt;
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
    codexResult: Pick<import("./types").CodexTurnResult, "lastMessage" | "stderr" | "stdout">;
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
    const reviewThreadsToProcess = (() => {
      if (preRunState !== "addressing_review" || pr == null) {
        return reviewThreads;
      }

      const currentPr = pr;
      return reviewThreads.filter((thread) => !hasProcessedReviewThread(record, currentPr, thread));
    })();
    const localReviewRepairContext =
      record.state === "local_review_fix"
        ? await loadLocalReviewRepairContext(record.local_review_summary_path, workspacePath)
        : null;
    const externalReviewSurface =
      pr &&
      preRunState === "addressing_review" &&
      reviewThreadsToProcess.length > 0 &&
      record.local_review_head_sha === pr.headRefOid &&
      record.local_review_summary_path
        ? await github.getExternalReviewSurface(pr.number)
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
            reviewSignals: collectExternalReviewSignals({
              reviewThreads: reviewThreadsToProcess,
              reviews: externalReviewSurface?.reviews ?? [],
              issueComments: externalReviewSurface?.issueComments ?? [],
              reviewBotLogins: config.reviewBotLogins,
            }),
            reviewBotLogins: config.reviewBotLogins,
            localReviewSummaryPath: record.local_review_summary_path,
          })
        : null;
    const externalReviewMissPatch = nextExternalReviewMissPatch(record, pr, externalReviewMissContext);
    if (Object.keys(externalReviewMissPatch).length > 0) {
      record = stateStore.touch(record, externalReviewMissPatch);
      state.issues[String(record.issue_number)] = record;
      await stateStore.save(state);
      await syncJournal(record);
    }

    const prompt = record.codex_session_id && shouldUseCompactResumePrompt(record.state)
      ? buildCodexResumePrompt({
          repoSlug: config.repoSlug,
          issue,
          branch: record.branch,
          workspacePath,
          state: record.state,
          journalPath,
          journalExcerpt: truncate(journalContent, 5000),
          failureContext: record.last_failure_context,
          previousSummary: previousCodexSummary,
          previousError,
        })
      : buildCodexPrompt({
          repoSlug: config.repoSlug,
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
          gsdEnabled: config.gsdEnabled,
          gsdPlanningFiles: config.gsdPlanningFiles,
          localReviewRepairContext,
          externalReviewMissContext,
        });

    const sessionLock =
      args.sessionLock ??
      (record.codex_session_id ? await args.acquireSessionLock(record.codex_session_id) : null);
    if (sessionLock && !sessionLock.acquired) {
      return {
        kind: "returned",
        message: `Skipped issue #${record.issue_number}: ${sessionLock.reason}.`,
      };
    }

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
    } finally {
      await sessionLock?.release();
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
    const currentPr = pr;
    const processedReviewThreadKeysForCurrentHead =
      preRunState === "addressing_review" && currentPr && currentPr.headRefOid === evaluatedReviewHeadSha
        ? reviewThreadsToProcess.map((thread) => processedReviewThreadKey(thread.id, evaluatedReviewHeadSha))
        : [];
    const processedReviewThreadFingerprintKeysForCurrentHead =
      preRunState === "addressing_review" && currentPr && currentPr.headRefOid === evaluatedReviewHeadSha
        ? reviewThreadsToProcess.flatMap((thread) => {
            const latestCommentFingerprint = latestReviewThreadCommentFingerprint(thread);
            return latestCommentFingerprint
              ? [
                  processedReviewThreadFingerprintKey(
                    thread.id,
                    evaluatedReviewHeadSha,
                    latestCommentFingerprint,
                  ),
                ]
              : [];
          })
        : [];
    const processedReviewThreadIds =
      processedReviewThreadKeysForCurrentHead.length > 0
        ? Array.from(
            new Set([
              ...record.processed_review_thread_ids,
              ...processedReviewThreadKeysForCurrentHead,
            ]),
          ).slice(-200)
        : record.processed_review_thread_ids;
    const processedReviewThreadFingerprints =
      processedReviewThreadFingerprintKeysForCurrentHead.length > 0
        ? Array.from(
            new Set([
              ...record.processed_review_thread_fingerprints,
              ...processedReviewThreadFingerprintKeysForCurrentHead,
            ]),
          ).slice(-200)
        : record.processed_review_thread_fingerprints;
    const postRunSnapshot = pr
      ? args.derivePullRequestLifecycleSnapshot(
          record,
          pr,
          checks,
          reviewThreads,
          {
            processed_review_thread_ids: processedReviewThreadIds,
            processed_review_thread_fingerprints: processedReviewThreadFingerprints,
          },
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
      processed_review_thread_ids: processedReviewThreadIds,
      processed_review_thread_fingerprints: processedReviewThreadFingerprints,
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
