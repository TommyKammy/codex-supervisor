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
  localReviewHasActionableFindings,
  LOCAL_REVIEW_DEGRADED_BLOCKER_SUMMARY,
  runLocalReview,
  shouldRunLocalReview,
} from "./local-review";
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
import { nowIso, parseJson, truncate } from "./utils";
import { loadRelevantVerifierGuardrails } from "./verifier-guardrails";
import { getWorkspaceStatus, pushBranch } from "./workspace";

function isOpenPullRequest(pr: GitHubPullRequest | null): pr is GitHubPullRequest {
  return pr !== null && pr.state === "OPEN" && !pr.mergedAt;
}

export function localReviewBlocksReady(
  config: SupervisorConfig,
  record: Pick<IssueRunRecord, "local_review_head_sha" | "local_review_findings_count" | "local_review_recommendation">,
  pr: GitHubPullRequest,
): boolean {
  return config.localReviewPolicy === "block_ready" && localReviewHasActionableFindings(record, pr);
}

export function localReviewBlocksMerge(
  config: SupervisorConfig,
  record: Pick<IssueRunRecord, "local_review_head_sha" | "local_review_findings_count" | "local_review_recommendation">,
  pr: GitHubPullRequest,
): boolean {
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

export function localReviewRetryLoopCandidate(
  config: SupervisorConfig,
  record: Pick<IssueRunRecord, "local_review_head_sha" | "local_review_verified_max_severity" | "repeated_local_review_signature_count" | "processed_review_thread_ids">,
  pr: GitHubPullRequest,
  checks: PullRequestCheck[],
  reviewThreads: ReviewThread[],
  manualReviewThreads: (config: SupervisorConfig, reviewThreads: ReviewThread[]) => ReviewThread[],
  configuredBotReviewThreads: (config: SupervisorConfig, reviewThreads: ReviewThread[]) => ReviewThread[],
  summarizeChecks: (checks: PullRequestCheck[]) => { hasFailing: boolean; hasPending: boolean },
  mergeConflictDetected: (pr: GitHubPullRequest) => boolean,
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

export function localReviewRetryLoopStalled(
  config: SupervisorConfig,
  record: Pick<IssueRunRecord, "local_review_head_sha" | "local_review_verified_max_severity" | "repeated_local_review_signature_count" | "processed_review_thread_ids">,
  pr: GitHubPullRequest,
  checks: PullRequestCheck[],
  reviewThreads: ReviewThread[],
  manualReviewThreads: (config: SupervisorConfig, reviewThreads: ReviewThread[]) => ReviewThread[],
  configuredBotReviewThreads: (config: SupervisorConfig, reviewThreads: ReviewThread[]) => ReviewThread[],
  summarizeChecks: (checks: PullRequestCheck[]) => { hasFailing: boolean; hasPending: boolean },
  mergeConflictDetected: (pr: GitHubPullRequest) => boolean,
): boolean {
  return (
    localReviewRetryLoopCandidate(
      config,
      record,
      pr,
      checks,
      reviewThreads,
      manualReviewThreads,
      configuredBotReviewThreads,
      summarizeChecks,
      mergeConflictDetected,
    ) &&
    record.repeated_local_review_signature_count >= config.sameFailureSignatureRepeatLimit
  );
}

export function localReviewHighSeverityNeedsBlock(
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

export function localReviewFailureSummary(
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

export function localReviewFailureContext(
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

export function localReviewStallFailureContext(
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

export function nextLocalReviewSignatureTracking(
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

export interface PostTurnPullRequestContext {
  state: SupervisorStateFile;
  record: IssueRunRecord;
  issue: GitHubIssue;
  workspacePath: string;
  syncJournal: IssueJournalSync;
  memoryArtifacts: MemoryArtifacts;
  pr: GitHubPullRequest;
  options: { dryRun: boolean };
}

export interface PostTurnPullRequestResult {
  record: IssueRunRecord;
  pr: GitHubPullRequest;
  checks: PullRequestCheck[];
  reviewThreads: ReviewThread[];
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
  getWorkspaceStatus?: typeof getWorkspaceStatus;
  pushBranch?: typeof pushBranch;
  readIssueJournal?: typeof readIssueJournal;
  runCodexTurnImpl?: typeof runCodexTurn;
}

interface HandlePostTurnPullRequestTransitionsArgs {
  config: SupervisorConfig;
  stateStore: Pick<StateStore, "touch" | "save">;
  github: Pick<GitHubClient, "getPullRequest" | "getChecks" | "getUnresolvedReviewThreads" | "markPullRequestReady">;
  context: PostTurnPullRequestContext;
  derivePullRequestLifecycleSnapshot: (
    record: IssueRunRecord,
    pr: GitHubPullRequest,
    checks: PullRequestCheck[],
    reviewThreads: ReviewThread[],
    recordPatch?: Partial<IssueRunRecord>,
  ) => PullRequestLifecycleSnapshot;
  applyFailureSignature: (
    record: IssueRunRecord,
    failureContext: FailureContext | null,
  ) => Pick<IssueRunRecord, "last_failure_signature" | "repeated_failure_signature_count">;
  blockedReasonFromReviewState: (
    record: IssueRunRecord,
    pr: GitHubPullRequest,
    reviewThreads: ReviewThread[],
  ) => IssueRunRecord["blocked_reason"];
  summarizeChecks: (checks: PullRequestCheck[]) => { hasPending: boolean; hasFailing: boolean };
  configuredBotReviewThreads: (config: SupervisorConfig, reviewThreads: ReviewThread[]) => ReviewThread[];
  manualReviewThreads: (config: SupervisorConfig, reviewThreads: ReviewThread[]) => ReviewThread[];
  mergeConflictDetected: (pr: GitHubPullRequest) => boolean;
  runLocalReviewImpl?: typeof runLocalReview;
  loadOpenPullRequestSnapshot?: (prNumber: number) => Promise<{
    pr: GitHubPullRequest;
    checks: PullRequestCheck[];
    reviewThreads: ReviewThread[];
  }>;
}

async function loadOpenPullRequestSnapshot(
  github: Pick<GitHubClient, "getPullRequest" | "getChecks" | "getUnresolvedReviewThreads">,
  prNumber: number,
): Promise<{
  pr: GitHubPullRequest;
  checks: PullRequestCheck[];
  reviewThreads: ReviewThread[];
}> {
  const pr = await github.getPullRequest(prNumber);
  const checks = await github.getChecks(prNumber);
  const reviewThreads = await github.getUnresolvedReviewThreads(prNumber);
  return { pr, checks, reviewThreads };
}

export async function executeCodexTurnPhase(
  args: ExecuteCodexTurnPhaseArgs,
): Promise<CodexTurnResult | CodexTurnShortCircuit> {
  const getWorkspaceStatusImpl = args.getWorkspaceStatus ?? getWorkspaceStatus;
  const pushBranchImpl = args.pushBranch ?? pushBranch;
  const readIssueJournalImpl = args.readIssueJournal ?? readIssueJournal;
  const runCodexTurnImpl = args.runCodexTurnImpl ?? runCodexTurn;
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

    const journalContent = await fs.promises.readFile(journalPath, "utf8").catch(() => "");
    const preRunState = record.state;
    const reviewThreadsToProcess = preRunState === "addressing_review"
      ? reviewThreads.filter((thread) => !record.processed_review_thread_ids.includes(thread.id))
      : reviewThreads;
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

    const sessionLock = record.codex_session_id
      ? await args.acquireSessionLock(record.codex_session_id)
      : null;
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
      const message = error instanceof Error ? error.stack ?? error.message : String(error);
      const failureKind = args.classifyFailure(message);
      const failureContext = args.buildCodexFailureContext(
        "codex",
        `Codex turn execution failed for issue #${record.issue_number}.`,
        [truncate(message, 2000) ?? "Unknown failure"],
      );
      record = stateStore.touch(record, {
        state: "failed",
        last_error: truncate(message),
        last_failure_kind: failureKind,
        last_failure_context: failureContext,
        ...args.applyFailureSignature(record, failureContext),
        blocked_reason: null,
        timeout_retry_count:
          failureKind === "timeout" ? record.timeout_retry_count + 1 : record.timeout_retry_count,
      });
      state.issues[String(record.issue_number)] = record;
      await stateStore.save(state);
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
      const failureContext = args.buildCodexFailureContext(
        "blocked",
        `Codex completed without updating the issue journal for issue #${record.issue_number}.`,
        ["Update the Codex Working Notes section before ending the turn."],
      );
      record = stateStore.touch(record, {
        state: "blocked",
        last_error: truncate(failureContext.summary),
        last_failure_kind: null,
        last_failure_context: failureContext,
        ...args.applyFailureSignature(record, failureContext),
        blocked_reason: "handoff_missing",
      });
      state.issues[String(record.issue_number)] = record;
      await stateStore.save(state);
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
      const failureKind = args.classifyFailure(failureOutput) === "timeout" ? "timeout" : "codex_exit";
      const failureContext = args.buildCodexFailureContext(
        "codex",
        `Codex exited non-zero for issue #${record.issue_number}.`,
        [truncate(failureOutput, 2000) ?? "Unknown failure output"],
      );
      record = stateStore.touch(record, {
        state: "failed",
        last_error: truncate(failureOutput),
        last_failure_kind: failureKind,
        last_failure_context: failureContext,
        ...args.applyFailureSignature(record, failureContext),
        blocked_reason: null,
        timeout_retry_count:
          failureKind === "timeout" ? record.timeout_retry_count + 1 : record.timeout_retry_count,
      });
      state.issues[String(record.issue_number)] = record;
      await stateStore.save(state);
      await syncJournal(record);
      return {
        kind: "returned",
        message: `Codex turn failed for issue #${record.issue_number}.`,
      };
    }

    if (hintedState === "blocked" || hintedState === "failed") {
      const blockerSignature = hintedState === "blocked" ? args.normalizeBlockerSignature(codexResult.lastMessage) : null;
      const repeatedBlockerCount =
        hintedState === "blocked" && blockerSignature && blockerSignature === record.last_blocker_signature
          ? record.repeated_blocker_count + 1
          : hintedState === "blocked"
            ? 1
            : 0;
      const failureContext = args.buildCodexFailureContext(
        hintedState === "failed" ? "codex" : "blocked",
        `Codex reported ${hintedState} for issue #${record.issue_number}.`,
        [truncate(codexResult.lastMessage, 2000) ?? "No additional summary."],
      );
      if (hintedFailureSignature) {
        failureContext.signature = hintedFailureSignature;
      }
      record = stateStore.touch(record, {
        state: hintedState,
        last_error: truncate(codexResult.lastMessage),
        last_failure_kind: hintedState === "failed" ? "codex_failed" : null,
        last_failure_context: failureContext,
        ...args.applyFailureSignature(record, failureContext),
        repeated_blocker_count: repeatedBlockerCount,
        last_blocker_signature: blockerSignature,
        blocked_reason:
          hintedState === "blocked"
            ? hintedBlockedReason ?? (args.isVerificationBlockedMessage(codexResult.lastMessage) ? "verification" : "unknown")
            : null,
      });
      state.issues[String(record.issue_number)] = record;
      await stateStore.save(state);
      await syncJournal(record);
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
        ? reviewThreadsToProcess.map((thread) => `${thread.id}@${evaluatedReviewHeadSha}`)
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
    const postRunSnapshot = pr
      ? args.derivePullRequestLifecycleSnapshot(
          record,
          pr,
          checks,
          reviewThreads,
          { processed_review_thread_ids: processedReviewThreadIds },
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

export async function handlePostTurnPullRequestTransitionsPhase(
  args: HandlePostTurnPullRequestTransitionsArgs,
): Promise<PostTurnPullRequestResult> {
  const runLocalReviewImpl = args.runLocalReviewImpl ?? runLocalReview;
  const loadOpenPullRequestSnapshotImpl =
    args.loadOpenPullRequestSnapshot ?? ((prNumber: number) => loadOpenPullRequestSnapshot(args.github, prNumber));
  const { config, stateStore, github } = args;
  const { state, issue, workspacePath, syncJournal, memoryArtifacts, options } = args.context;
  let { record, pr } = args.context;

  let ranLocalReviewThisCycle = false;
  const refreshed = await loadOpenPullRequestSnapshotImpl(pr.number);
  const refreshedCheckSummary = args.summarizeChecks(refreshed.checks);

  if (
    shouldRunLocalReview(config, record, refreshed.pr) &&
    !refreshedCheckSummary.hasPending &&
    !refreshedCheckSummary.hasFailing &&
    args.configuredBotReviewThreads(config, refreshed.reviewThreads).length === 0 &&
    (!config.humanReviewBlocksMerge || args.manualReviewThreads(config, refreshed.reviewThreads).length === 0) &&
    !args.mergeConflictDetected(refreshed.pr) &&
    !options.dryRun
  ) {
    ranLocalReviewThisCycle = true;
    record = stateStore.touch(record, { state: "local_review" });
    state.issues[String(record.issue_number)] = record;
    await stateStore.save(state);
    await syncJournal(record);

    try {
      const localReview = await runLocalReviewImpl({
        config,
        issue,
        branch: record.branch,
        workspacePath,
        defaultBranch: config.defaultBranch,
        pr: refreshed.pr,
        alwaysReadFiles: memoryArtifacts.alwaysReadFiles,
        onDemandFiles: memoryArtifacts.onDemandFiles,
      });
      const actionableSignature =
        localReview.recommendation !== "ready"
          ? `local-review:${localReview.maxSeverity ?? "unknown"}:${localReview.rootCauseCount}:${localReview.degraded ? "degraded" : "clean"}`
          : null;
      const signatureTracking = nextLocalReviewSignatureTracking(record, refreshed.pr.headRefOid, actionableSignature);

      record = stateStore.touch(record, {
        state: "draft_pr",
        local_review_head_sha: refreshed.pr.headRefOid,
        local_review_blocker_summary: localReview.blockerSummary,
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
          localReview.recommendation !== "ready" && config.localReviewHighSeverityAction === "blocked" && localReview.verifiedMaxSeverity === "high"
            ? "verification"
            : null,
        last_error:
          localReview.recommendation !== "ready"
            ? truncate(
                localReview.degraded
                  ? "Local review completed in a degraded state."
                  : localReview.verifiedMaxSeverity === "high" && config.localReviewHighSeverityAction === "retry"
                    ? `Local review found high-severity issues (${localReview.findingsCount} actionable findings across ${localReview.rootCauseCount} root cause(s)). Codex will continue with a repair pass before the PR can proceed.`
                    : localReview.verifiedMaxSeverity === "high" && config.localReviewHighSeverityAction === "blocked"
                      ? `Local review found high-severity issues (${localReview.findingsCount} actionable findings across ${localReview.rootCauseCount} root cause(s)). Manual attention is required before the PR can proceed.`
                      : `Local review requested changes (${localReview.findingsCount} actionable findings across ${localReview.rootCauseCount} root cause(s)).`,
                500,
              )
            : null,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      record = stateStore.touch(record, {
        state: "draft_pr",
        local_review_head_sha: refreshed.pr.headRefOid,
        local_review_blocker_summary: LOCAL_REVIEW_DEGRADED_BLOCKER_SUMMARY,
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
    await stateStore.save(state);
    await syncJournal(record);
  }

  if (
    refreshed.pr.isDraft &&
    !refreshedCheckSummary.hasPending &&
    !refreshedCheckSummary.hasFailing &&
    args.configuredBotReviewThreads(config, refreshed.reviewThreads).length === 0 &&
    (!config.humanReviewBlocksMerge || args.manualReviewThreads(config, refreshed.reviewThreads).length === 0) &&
    !args.mergeConflictDetected(refreshed.pr) &&
    !localReviewBlocksReady(config, record, refreshed.pr) &&
    !options.dryRun
  ) {
    await github.markPullRequestReady(refreshed.pr.number);
  }

  const postReady = await loadOpenPullRequestSnapshotImpl(pr.number);
  const repeatedLocalReviewSignatureCount =
    !ranLocalReviewThisCycle &&
    localReviewRetryLoopCandidate(
      config,
      record,
      postReady.pr,
      postReady.checks,
      postReady.reviewThreads,
      args.manualReviewThreads,
      args.configuredBotReviewThreads,
      args.summarizeChecks,
      args.mergeConflictDetected,
    ) &&
    record.last_head_sha === postReady.pr.headRefOid &&
    record.local_review_head_sha === postReady.pr.headRefOid
      ? record.repeated_local_review_signature_count + 1
      : localReviewHighSeverityNeedsRetry(config, record, postReady.pr) &&
          record.local_review_head_sha === postReady.pr.headRefOid
        ? 0
        : record.repeated_local_review_signature_count;
  const refreshedLifecycle = args.derivePullRequestLifecycleSnapshot(
    record,
    postReady.pr,
    postReady.checks,
    postReady.reviewThreads,
    { repeated_local_review_signature_count: repeatedLocalReviewSignatureCount },
  );
  const postReadyLocalReviewFailureContext =
    refreshedLifecycle.nextState === "blocked" &&
    localReviewRetryLoopStalled(
      config,
      refreshedLifecycle.recordForState,
      postReady.pr,
      postReady.checks,
      postReady.reviewThreads,
      args.manualReviewThreads,
      args.configuredBotReviewThreads,
      args.summarizeChecks,
      args.mergeConflictDetected,
    )
      ? localReviewStallFailureContext(refreshedLifecycle.recordForState)
      : refreshedLifecycle.nextState === "blocked" &&
          localReviewHighSeverityNeedsBlock(config, refreshedLifecycle.recordForState, postReady.pr)
        ? localReviewFailureContext(refreshedLifecycle.recordForState)
        : refreshedLifecycle.nextState === "local_review_fix" &&
            localReviewHighSeverityNeedsRetry(config, refreshedLifecycle.recordForState, postReady.pr)
          ? localReviewFailureContext(refreshedLifecycle.recordForState)
          : null;
  const effectiveFailureContext = refreshedLifecycle.failureContext ?? postReadyLocalReviewFailureContext;
  record = stateStore.touch(record, {
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
            localReviewHighSeverityNeedsRetry(config, refreshedLifecycle.recordForState, postReady.pr)
          ? truncate(localReviewFailureSummary(refreshedLifecycle.recordForState), 1000)
          : record.last_error,
    last_failure_context: effectiveFailureContext,
    ...args.applyFailureSignature(record, effectiveFailureContext),
    blocked_reason:
      refreshedLifecycle.nextState === "blocked"
        ? args.blockedReasonFromReviewState(
            refreshedLifecycle.recordForState,
            postReady.pr,
            postReady.reviewThreads,
          ) ??
          ((localReviewRetryLoopStalled(
            config,
            refreshedLifecycle.recordForState,
            postReady.pr,
            postReady.checks,
            postReady.reviewThreads,
            args.manualReviewThreads,
            args.configuredBotReviewThreads,
            args.summarizeChecks,
            args.mergeConflictDetected,
          ) ||
            localReviewHighSeverityNeedsBlock(config, refreshedLifecycle.recordForState, postReady.pr))
            ? "verification"
            : null)
        : null,
  });
  state.issues[String(record.issue_number)] = record;
  await stateStore.save(state);

  return {
    record,
    pr: postReady.pr,
    checks: postReady.checks,
    reviewThreads: postReady.reviewThreads,
  };
}
