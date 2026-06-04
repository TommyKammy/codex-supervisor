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
import {} from "./review-handling";
import { PullRequestLifecycleSnapshot } from "./post-turn-pull-request";
import {
  IssueJournalSync,
  MemoryArtifacts,
} from "./run-once-issue-preparation";
import { type LocalCiCommandRunner } from "./local-ci";
import {
  buildWorkstationLocalPathFailureContext,
  WORKSTATION_LOCAL_PATH_HYGIENE_REPAIRABLE_PUBLICATION_SIGNATURE,
  runWorkstationLocalPathGate,
  type WorkstationLocalPathGateResult,
} from "./workstation-local-path-gate";
import { StateStore } from "./core/state-store";
import {
  getStaleStabilizingNoPrRecoveryCount,
  shouldPreserveStaleStabilizingNoPrRecoveryTracking,
} from "./no-pull-request-state";
import * as trackedPrStatusComments from "./tracked-pr-status-comment";
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
import {
  commitAndPushTrackedFiles,
  filterPresentTrackedFilePaths,
  getWorkspaceStatus,
  listChangedTrackedFilesBetween,
  pushBranch,
} from "./core/workspace";
import { AgentRunner, createCodexAgentRunner } from "./supervisor/agent-runner";
import {
  executionMetricsRetentionRootPath,
  syncExecutionMetricsRunSummarySafely,
} from "./supervisor/execution-metrics-run-summary";
import { stableSameFileCodexConnectorChurnDossierConsumptionPatch } from "./supervisor/supervisor-lifecycle";
import {
  captureIssueJournalFingerprint,
  clearInterruptedTurnMarker,
  writeInterruptedTurnMarker,
} from "./interrupted-turn-marker";
import { issueDefinitionFreshnessPatch } from "./issue-definition-freshness";
import { applyCodexTurnPublicationGate } from "./turn-execution-publication-gate";
import { upsertTimelineArtifact } from "./timeline-artifacts";

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

const TRUSTED_DURABLE_ARTIFACT_NORMALIZATION_COMMIT_MESSAGE =
  "Normalize trusted durable artifacts for path hygiene";

const CODEX_TURN_VERIFICATION_COMMAND_NAMES = [
  "npm",
  "npx",
  "pnpm",
  "yarn",
  "bun",
  "node",
  "deno",
  "tsx",
  "tsc",
  "ts-node",
  "jest",
  "vitest",
  "mocha",
  "playwright",
  "pytest",
  "python",
  "python3",
  "uv",
  "go",
  "cargo",
  "make",
  "cmake",
  "mvn",
  "gradle",
  "bash",
  "sh",
  "zsh",
  "ruby",
  "bundle",
  "rspec",
  "eslint",
  "prettier",
  "ruff",
  "mypy",
  "gh",
  "git",
].join("|");
const CODEX_TURN_VERIFICATION_COMMAND_PATTERN = new RegExp(
  `^(?:[\\\`$]\\s*)?(?:(?:${CODEX_TURN_VERIFICATION_COMMAND_NAMES})\\b|(?:\\.{0,2}/))`,
  "i",
);

function hasExplicitCodexTurnVerificationCommandEvidence(value: string): boolean {
  return value
    .split(/[\n;]+/)
    .map((candidate) => candidate.trim().replace(/^`+|`+$/g, "").trim())
    .filter((candidate) => candidate.length > 0)
    .some((candidate) => CODEX_TURN_VERIFICATION_COMMAND_PATTERN.test(candidate));
}

function hasExplicitNegativeCodexTurnVerificationOutcome(value: string): boolean {
  const normalized = value.toLowerCase();
  if (
    normalized === "not run" ||
    normalized === "none" ||
    normalized === "n/a" ||
    normalized === "na" ||
    normalized.includes("not run") ||
    normalized.includes("no tests") ||
    normalized.includes("stale head") ||
    normalized.includes("ambiguous") ||
    normalized.includes("unclear") ||
    normalized.includes("?")
  ) {
    return true;
  }
  return /(?:^|\s)(?:failed|failure|error|timeout|blocked|skipped)(?=$|[\s:.,;])/i.test(
    value,
  );
}

function explicitPassingCodexTurnVerificationCommand(
  tests: string | null | undefined,
): string | null {
  const value = tests?.trim();
  if (!value) {
    return null;
  }
  if (hasExplicitNegativeCodexTurnVerificationOutcome(value)) {
    return null;
  }
  if (!hasExplicitCodexTurnVerificationCommandEvidence(value)) {
    return null;
  }
  return value;
}

function conciseCodexVerificationSummary(summary: string | null | undefined): string {
  const value = summary?.trim();
  return truncate(value && value.length > 0 ? value : "Codex turn verification passed.", 500) ??
    "Codex turn verification passed.";
}

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
  workspaceStatus: Pick<
    WorkspaceStatus,
    "hasUncommittedChanges" | "headSha"
  > | null;
  pr: Pick<
    GitHubPullRequest,
    "number" | "headRefOid" | "createdAt" | "mergedAt"
  > | null;
}

interface ExecuteCodexTurnPhaseArgs {
  config: SupervisorConfig;
  stateStore: Pick<StateStore, "touch" | "save">;
  github: Pick<
    GitHubClient,
    | "resolvePullRequestForBranch"
    | "createPullRequest"
    | "getChecks"
    | "getUnresolvedReviewThreads"
    | "getExternalReviewSurface"
  >;
  context: CodexTurnContext;
  sessionLock?: LockHandle | null;
  acquireSessionLock: (sessionId: string) => Promise<LockHandle | null>;
  classifyFailure: (
    message: string | null | undefined,
  ) => "timeout" | "command_error";
  buildCodexFailureContext: (
    category: FailureContext["category"],
    summary: string,
    details: string[],
  ) => FailureContext;
  applyFailureSignature: (
    record: IssueRunRecord,
    failureContext: FailureContext | null,
  ) => Pick<
    IssueRunRecord,
    "last_failure_signature" | "repeated_failure_signature_count"
  >;
  normalizeBlockerSignature: (
    message: string | null | undefined,
  ) => string | null;
  isVerificationBlockedMessage: (message: string | null | undefined) => boolean;
  derivePullRequestLifecycleSnapshot: (
    record: IssueRunRecord,
    pr: GitHubPullRequest,
    checks: PullRequestCheck[],
    reviewThreads: ReviewThread[],
    recordPatch?: Partial<IssueRunRecord>,
  ) => PullRequestLifecycleSnapshot;
  inferStateWithoutPullRequest: (
    record: IssueRunRecord,
    workspaceStatus: WorkspaceStatus,
  ) => RunState;
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
    classifyFailure: (
      message: string | null | undefined,
    ) => "timeout" | "command_error";
    buildCodexFailureContext: (
      category: FailureContext["category"],
      summary: string,
      details: string[],
    ) => FailureContext;
    applyFailureSignature: (
      record: IssueRunRecord,
      failureContext: FailureContext | null,
    ) => Pick<
      IssueRunRecord,
      "last_failure_signature" | "repeated_failure_signature_count"
    >;
    retentionRootPath?: string;
  }) => Promise<IssueRunRecord>;
  persistCodexTurnExitFailure?: (args: {
    stateStore: Pick<StateStore, "touch" | "save">;
    state: SupervisorStateFile;
    record: IssueRunRecord;
    issue: Pick<GitHubIssue, "createdAt">;
    syncJournal: (record: IssueRunRecord) => Promise<void>;
    issueNumber: number;
    codexResult: Pick<
      import("./core/types").CodexTurnResult,
      "lastMessage" | "stderr" | "stdout"
    >;
    classifyFailure: (
      message: string | null | undefined,
    ) => "timeout" | "command_error";
    buildCodexFailureContext: (
      category: FailureContext["category"],
      summary: string,
      details: string[],
    ) => FailureContext;
    applyFailureSignature: (
      record: IssueRunRecord,
      failureContext: FailureContext | null,
    ) => Pick<
      IssueRunRecord,
      "last_failure_signature" | "repeated_failure_signature_count"
    >;
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
    ) => Pick<
      IssueRunRecord,
      "last_failure_signature" | "repeated_failure_signature_count"
    >;
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
    ) => Pick<
      IssueRunRecord,
      "last_failure_signature" | "repeated_failure_signature_count"
    >;
    normalizeBlockerSignature: (
      message: string | null | undefined,
    ) => string | null;
    isVerificationBlockedMessage: (
      message: string | null | undefined,
    ) => boolean;
    retentionRootPath?: string;
  }) => Promise<IssueRunRecord>;
  getWorkspaceStatus?: typeof getWorkspaceStatus;
  listChangedTrackedFilesBetween?: typeof listChangedTrackedFilesBetween;
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
  const listChangedTrackedFilesBetweenImpl =
    args.listChangedTrackedFilesBetween ?? listChangedTrackedFilesBetween;
  const pushBranchImpl = args.pushBranch ?? pushBranch;
  const readIssueJournalImpl = args.readIssueJournal ?? readIssueJournal;
  const persistCodexTurnExecutionFailureImpl =
    args.persistCodexTurnExecutionFailure ?? persistCodexTurnExecutionFailure;
  const persistCodexTurnExitFailureImpl =
    args.persistCodexTurnExitFailure ?? persistCodexTurnExitFailure;
  const persistMissingCodexJournalHandoffImpl =
    args.persistMissingCodexJournalHandoff ?? persistMissingCodexJournalHandoff;
  const persistHintedCodexTurnStateImpl =
    args.persistHintedCodexTurnState ?? persistHintedCodexTurnState;
  const runWorkstationLocalPathGateImpl =
    args.runWorkstationLocalPathGate ?? runWorkstationLocalPathGate;
  const agentRunner =
    args.agentRunner ??
    createCodexAgentRunner({
      config: args.config,
      classifyFailureImpl: args.classifyFailure,
      buildFailureContextImpl: args.buildCodexFailureContext,
    });
  const { config, stateStore, github } = args;
  const {
    state,
    issue,
    workspacePath,
    journalPath,
    syncJournal,
    memoryArtifacts,
    options,
  } = args.context;
  let { record, workspaceStatus, pr, checks, reviewThreads } = args.context;
  let turnMarkerWritten = false;
  let sessionLock: LockHandle | null = null;
  const turnStartHeadSha = workspaceStatus.headSha;
  let usedSameTurnPathRepairRetry = false;

  try {
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
      sessionLock =
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

      while (true) {
        let journalContent = await readIssueJournalImpl(journalPath);
        if (journalContent === null) {
          await syncJournal(record);
          journalContent = await readIssueJournalImpl(journalPath);
        }
        const effectiveJournalContent = journalContent ?? "";
        const previousCodexSummary = record.last_codex_summary;
        const previousError = record.last_error;

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
        const preRunJournalFingerprint =
          await captureIssueJournalFingerprint(journalPath);
        await writeInterruptedTurnMarker({
          workspacePath,
          issueNumber: record.issue_number,
          state: record.state,
          journalFingerprint: preRunJournalFingerprint,
        });
        turnMarkerWritten = true;
        const turnResult = await agentRunner.runTurn(turnContext);
        const codexSessionStarted =
          turnContext.kind === "start" &&
          typeof turnResult.sessionId === "string" &&
          turnResult.sessionId.trim().length > 0;
        const dossierConsumptionPatch =
          record.state === "addressing_review" && codexSessionStarted
            ? stableSameFileCodexConnectorChurnDossierConsumptionPatch(record)
            : {};
        const structuredResult = agentRunner.capabilities
          .supportsStructuredResult
          ? turnResult.structuredResult
          : null;
        const hintedState = structuredResult?.stateHint ?? null;
        const hintedBlockedReason = structuredResult?.blockedReason ?? null;
        const hintedFailureSignature =
          structuredResult?.failureSignature ?? null;
        const preTurnFailureContext = record.last_failure_context;
        const preTurnFailureSignature = record.last_failure_signature;
        const preTurnStaleNoPrRecoveryCount =
          getStaleStabilizingNoPrRecoveryCount(record);
        const preTurnLastError = record.last_error;
        const journalAfterRun = await readIssueJournalImpl(journalPath);
        const normalizedJournalAfterRun =
          journalAfterRun === null
            ? null
            : await normalizeCommittedIssueJournal({
                journalPath,
                workspacePath,
              });
        const effectiveJournalAfterRun =
          normalizedJournalAfterRun ?? journalAfterRun;
        record = stateStore.touch(record, {
          ...dossierConsumptionPatch,
          codex_session_id: turnResult.sessionId,
          last_codex_summary: truncate(turnResult.supervisorMessage),
          last_failure_kind: turnResult.failureKind,
          last_error:
            turnResult.exitCode === 0
              ? null
              : truncate(
                  [turnResult.stderr.trim(), turnResult.stdout.trim()]
                    .filter(Boolean)
                    .join("\n"),
                ),
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
            retentionRootPath: executionMetricsRetentionRootPath(
              args.config.stateFile,
            ),
          });
          return {
            kind: "returned",
            message: `Codex turn for issue #${record.issue_number} was rejected because no journal handoff was written.`,
          };
        }

        if (
          turnResult.failureKind === "timeout" ||
          turnResult.failureKind === "command_error"
        ) {
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
            retentionRootPath: executionMetricsRetentionRootPath(
              args.config.stateFile,
            ),
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
            retentionRootPath: executionMetricsRetentionRootPath(
              args.config.stateFile,
            ),
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
            retentionRootPath: executionMetricsRetentionRootPath(
              args.config.stateFile,
            ),
          });
          return {
            kind: "returned",
            message: `Codex reported ${hintedState} for issue #${record.issue_number}.`,
          };
        }

        workspaceStatus = await getWorkspaceStatusImpl(
          workspacePath,
          record.branch,
          config.defaultBranch,
        );
        record = stateStore.touch(record, {
          last_head_sha: workspaceStatus.headSha,
        });
        let evaluatedReviewHeadSha = workspaceStatus.headSha;
        const changedFilesInCurrentTurn =
          workspaceStatus.headSha === turnStartHeadSha
            ? []
            : await listChangedTrackedFilesBetweenImpl(
                workspacePath,
                turnStartHeadSha,
                workspaceStatus.headSha,
              );

        const publishTrackedPrHostLocalBlockerComment = async (
          failureContext: WorkstationLocalPathGateResult["failureContext"] | null,
          remediationTarget: "manual_review" | "repair_already_queued",
        ): Promise<{ record: IssueRunRecord; didPublish: boolean }> => {
          if (!pr) {
            return { record, didPublish: false };
          }

          const originalRecord = record;
          const updatedRecord = await trackedPrStatusComments.maybeCommentOnTrackedPrHostLocalBlocker({
            github,
            stateStore,
            state,
            record,
            pr,
            syncJournal,
            gateType: "workstation_local_path_hygiene",
            blockerSignature: failureContext?.signature ?? null,
            failureClass: failureContext?.signature ?? null,
            remediationTarget,
            summary:
              failureContext?.summary ??
              "Tracked durable artifacts failed workstation-local path hygiene before publication.",
            details: failureContext?.details,
            localHeadSha: workspaceStatus.headSha,
            remoteHeadSha: pr.headRefOid,
          });
          return {
            record: updatedRecord,
            didPublish: updatedRecord !== originalRecord,
          };
        };
        if (
          (workspaceStatus.remoteAhead > 0 ||
            !workspaceStatus.remoteBranchExists) &&
          !workspaceStatus.hasUncommittedChanges
        ) {
          const pathHygieneGate = await runWorkstationLocalPathGateImpl({
            workspacePath,
            gateLabel: "before publication",
            publishablePathAllowlistMarkers:
              config.publishablePathAllowlistMarkers,
          });
          if (!pathHygieneGate.ok) {
            const failureContext = pathHygieneGate.failureContext;
            const actionablePublishableFilePaths =
              pathHygieneGate.actionablePublishableFilePaths ?? [];
            const repairFailureContext =
              failureContext !== null && actionablePublishableFilePaths.length > 0
                ? {
                    ...failureContext,
                    summary:
                      `Publication path hygiene found actionable fixture-level failures on publishable files (${actionablePublishableFilePaths.join(", ")}). ${failureContext.summary}`,
                    signature:
                      WORKSTATION_LOCAL_PATH_HYGIENE_REPAIRABLE_PUBLICATION_SIGNATURE,
                  }
                : null;
            const sameTurnRepairEligible =
              !usedSameTurnPathRepairRetry &&
              failureContext !== null &&
              actionablePublishableFilePaths.length > 0 &&
              actionablePublishableFilePaths.every((filePath) =>
                changedFilesInCurrentTurn.includes(filePath),
              );
            if (sameTurnRepairEligible) {
              const rewrittenTrackedPaths = [
                ...(pathHygieneGate.rewrittenJournalPaths ?? []),
                ...(pathHygieneGate.rewrittenTrustedGeneratedArtifactPaths ??
                  []),
              ];
              const presentRewrittenTrackedPaths =
                await filterPresentTrackedFilePaths(
                  workspacePath,
                  rewrittenTrackedPaths,
                );
              if (presentRewrittenTrackedPaths.length > 0) {
                try {
                  await commitAndPushTrackedFiles({
                    workspacePath,
                    branch: record.branch,
                    remoteBranchExists: workspaceStatus.remoteBranchExists,
                    filePaths: presentRewrittenTrackedPaths,
                    commitMessage:
                      TRUSTED_DURABLE_ARTIFACT_NORMALIZATION_COMMIT_MESSAGE,
                  });
                } catch (error) {
                  const message =
                    error instanceof Error ? error.message : String(error);
                  const retryPersistenceFailureContext =
                    buildWorkstationLocalPathFailureContext({
                      gateLabel: "before publication",
                      details: [
                        `durable artifact normalization persistence failed for ${presentRewrittenTrackedPaths.join(", ")}: ${message}`,
                      ],
                    });
                  record = stateStore.touch(record, {
                    state: "blocked",
                    last_error: truncate(
                      retryPersistenceFailureContext.summary,
                      1000,
                    ),
                    last_failure_kind: null,
                    last_failure_context: retryPersistenceFailureContext,
                    ...args.applyFailureSignature(
                      record,
                      retryPersistenceFailureContext,
                    ),
                    blocked_reason: "verification",
                    ...issueDefinitionFreshnessPatch(issue),
                  });
                  const { record: blockageRecord, didPublish } =
                    await publishTrackedPrHostLocalBlockerComment(
                      retryPersistenceFailureContext,
                      "manual_review",
                    );
                  record = blockageRecord;
                  if (!didPublish) {
                    state.issues[String(record.issue_number)] = record;
                    await stateStore.save(state);
                  }
                  await syncExecutionMetricsRunSummarySafely({
                    previousRecord: args.context.record,
                    nextRecord: record,
                    issue,
                    pullRequest: pr,
                    retentionRootPath: executionMetricsRetentionRootPath(
                      args.config.stateFile,
                    ),
                    warningContext: "persisting",
                  });
                  if (!didPublish) {
                    await syncJournal(record);
                  }
                  return {
                    kind: "returned",
                    message: `Workstation-local path hygiene blocked publication for issue #${record.issue_number}.`,
                  };
                }
                workspaceStatus = await getWorkspaceStatusImpl(
                  workspacePath,
                  record.branch,
                  config.defaultBranch,
                );
                record = stateStore.touch(record, {
                  last_head_sha: workspaceStatus.headSha,
                });
              }
              usedSameTurnPathRepairRetry = true;
              record = stateStore.touch(record, {
                last_error: truncate(failureContext.summary, 1000),
                last_failure_kind: null,
                last_failure_context: failureContext,
                ...args.applyFailureSignature(record, failureContext),
              });
              state.issues[String(record.issue_number)] = record;
              await stateStore.save(state);
              await syncJournal(record);
              continue;
            }
            if (repairFailureContext !== null) {
              record = stateStore.touch(record, {
                state: "repairing_ci",
                timeline_artifacts: [
                  ...(record.timeline_artifacts ?? []),
                  {
                    type: "path_hygiene_result",
                    gate: "workstation_local_path_hygiene",
                    command: repairFailureContext.command,
                    head_sha: workspaceStatus.headSha,
                    outcome: "repair_queued",
                    remediation_target: "repair_already_queued",
                    next_action: "wait_for_repair_turn",
                    summary: repairFailureContext.summary,
                    recorded_at: repairFailureContext.updated_at,
                    repair_targets: [...actionablePublishableFilePaths].sort((left, right) => left.localeCompare(right)),
                  },
                ],
                last_error: truncate(repairFailureContext.summary, 1000),
                last_failure_kind: null,
                last_failure_context: repairFailureContext,
                ...args.applyFailureSignature(record, repairFailureContext),
                blocked_reason: null,
                ...issueDefinitionFreshnessPatch(issue),
              });
              state.issues[String(record.issue_number)] = record;
              await stateStore.save(state);
              await syncExecutionMetricsRunSummarySafely({
                previousRecord: args.context.record,
                nextRecord: record,
                issue,
                pullRequest: pr,
                retentionRootPath: executionMetricsRetentionRootPath(
                  args.config.stateFile,
                ),
                warningContext: "persisting",
              });
              const { record: blockageRecord, didPublish } =
                await publishTrackedPrHostLocalBlockerComment(
                  repairFailureContext,
                  "repair_already_queued",
                );
              record = blockageRecord;
              if (!didPublish) {
                await syncJournal(record);
              }
              return {
                kind: "returned",
                message: `Workstation-local path hygiene blocked publication for issue #${record.issue_number}.`,
              };
            }
            record = stateStore.touch(record, {
              state: "blocked",
              last_error: truncate(
                failureContext?.summary ??
                  "Tracked durable artifacts failed workstation-local path hygiene before publication.",
                1000,
              ),
              last_failure_kind: null,
              last_failure_context: failureContext,
              ...args.applyFailureSignature(record, failureContext),
              blocked_reason: "verification",
              ...issueDefinitionFreshnessPatch(issue),
            });
            const { record: blockageRecord, didPublish } =
              await publishTrackedPrHostLocalBlockerComment(
              failureContext,
              "manual_review",
            );
            record = blockageRecord;
            if (!didPublish) {
              state.issues[String(record.issue_number)] = record;
              await stateStore.save(state);
            }
            await syncExecutionMetricsRunSummarySafely({
              previousRecord: args.context.record,
              nextRecord: record,
              issue,
              pullRequest: pr,
              retentionRootPath: executionMetricsRetentionRootPath(
                args.config.stateFile,
              ),
              warningContext: "persisting",
            });
            if (!didPublish) {
              await syncJournal(record);
            }
            return {
              kind: "returned",
              message: `Workstation-local path hygiene blocked publication for issue #${record.issue_number}.`,
            };
          }
          const rewrittenTrackedPaths = [
            ...(pathHygieneGate.rewrittenJournalPaths ?? []),
            ...(pathHygieneGate.rewrittenTrustedGeneratedArtifactPaths ?? []),
          ];
          const presentRewrittenTrackedPaths =
            await filterPresentTrackedFilePaths(
              workspacePath,
              rewrittenTrackedPaths,
            );
          if (presentRewrittenTrackedPaths.length > 0) {
            try {
              await commitAndPushTrackedFiles({
                workspacePath,
                branch: record.branch,
                remoteBranchExists: workspaceStatus.remoteBranchExists,
                filePaths: presentRewrittenTrackedPaths,
                commitMessage:
                  TRUSTED_DURABLE_ARTIFACT_NORMALIZATION_COMMIT_MESSAGE,
              });
            } catch (error) {
              const message =
                error instanceof Error ? error.message : String(error);
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
              const { record: blockageRecord, didPublish } =
                await publishTrackedPrHostLocalBlockerComment(
                failureContext,
                "manual_review",
              );
              record = blockageRecord;
              if (!didPublish) {
                state.issues[String(record.issue_number)] = record;
                await stateStore.save(state);
              }
              await syncExecutionMetricsRunSummarySafely({
                previousRecord: args.context.record,
                nextRecord: record,
                issue,
                pullRequest: pr,
                retentionRootPath: executionMetricsRetentionRootPath(
                  args.config.stateFile,
                ),
                warningContext: "persisting",
              });
              if (!didPublish) {
                await syncJournal(record);
              }
              return {
                kind: "returned",
                message: `Workstation-local path hygiene blocked publication for issue #${record.issue_number}.`,
              };
            }
            workspaceStatus = await getWorkspaceStatusImpl(
              workspacePath,
              record.branch,
              config.defaultBranch,
            );
            evaluatedReviewHeadSha = workspaceStatus.headSha;
            record = stateStore.touch(record, {
              last_head_sha: evaluatedReviewHeadSha,
            });
          }
          if (
            workspaceStatus.remoteAhead > 0 ||
            !workspaceStatus.remoteBranchExists
          ) {
            await pushBranchImpl(
              workspacePath,
              record.branch,
              workspaceStatus.remoteBranchExists,
            );
            workspaceStatus = await getWorkspaceStatusImpl(
              workspacePath,
              record.branch,
              config.defaultBranch,
            );
            evaluatedReviewHeadSha = workspaceStatus.headSha;
            record = stateStore.touch(record, {
              last_head_sha: evaluatedReviewHeadSha,
            });
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
          allowSameTurnPathRepairRetry: !usedSameTurnPathRepairRetry,
          changedFilesInCurrentTurn,
          syncExecutionMetricsRunSummary: async (blockedRecord) => {
            await syncExecutionMetricsRunSummarySafely({
              previousRecord: args.context.record,
              nextRecord: blockedRecord,
              issue,
              retentionRootPath: executionMetricsRetentionRootPath(
                args.config.stateFile,
              ),
              warningContext: "persisting",
            });
          },
        });
        record = publicationGate.record;
        if (publicationGate.kind === "same_turn_repair") {
          const presentRewrittenTrackedPaths = await filterPresentTrackedFilePaths(
            workspacePath,
            publicationGate.rewrittenTrackedPaths,
          );
          if (presentRewrittenTrackedPaths.length > 0) {
            try {
              await commitAndPushTrackedFiles({
                workspacePath,
                branch: record.branch,
                remoteBranchExists: workspaceStatus.remoteBranchExists,
                filePaths: presentRewrittenTrackedPaths,
                commitMessage:
                  TRUSTED_DURABLE_ARTIFACT_NORMALIZATION_COMMIT_MESSAGE,
              });
            } catch (error) {
              const message =
                error instanceof Error ? error.message : String(error);
              const retryPersistenceFailureContext =
                buildWorkstationLocalPathFailureContext({
                  gateLabel: "before publication",
                  details: [
                    `durable artifact normalization persistence failed for ${presentRewrittenTrackedPaths.join(", ")}: ${message}`,
                  ],
                });
              record = stateStore.touch(record, {
                state: "blocked",
                last_error: truncate(
                  retryPersistenceFailureContext.summary,
                  1000,
                ),
                last_failure_kind: null,
                last_failure_context: retryPersistenceFailureContext,
                ...args.applyFailureSignature(
                  record,
                  retryPersistenceFailureContext,
                ),
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
                retentionRootPath: executionMetricsRetentionRootPath(
                  args.config.stateFile,
                ),
                warningContext: "persisting",
              });
              await syncJournal(record);
              return {
                kind: "returned",
                message: `Workstation-local path hygiene blocked publication for issue #${record.issue_number}.`,
              };
            }
            workspaceStatus = await getWorkspaceStatusImpl(
              workspacePath,
              record.branch,
              config.defaultBranch,
            );
            record = stateStore.touch(record, {
              last_head_sha: workspaceStatus.headSha,
            });
          }
          usedSameTurnPathRepairRetry = true;
          record = stateStore.touch(record, {
            last_error: truncate(publicationGate.failureContext.summary, 1000),
            last_failure_kind: null,
            last_failure_context: publicationGate.failureContext,
            ...args.applyFailureSignature(
              record,
              publicationGate.failureContext,
            ),
          });
          state.issues[String(record.issue_number)] = record;
          await stateStore.save(state);
          await syncJournal(record);
          continue;
        }
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
          : (hintedState ??
            args.inferStateWithoutPullRequest(record, workspaceStatus));
        const codexVerificationCommand =
          explicitPassingCodexTurnVerificationCommand(structuredResult?.tests);
        const codexTurnVerificationHeadSha =
          pr &&
          codexVerificationCommand &&
          workspaceStatus.headSha === pr.headRefOid &&
          postRunState !== "blocked" &&
          postRunState !== "failed"
            ? pr.headRefOid
            : null;
        const codexTurnVerificationTimelineArtifacts =
          pr &&
          codexVerificationCommand &&
          codexTurnVerificationHeadSha
            ? upsertTimelineArtifact(
                record,
                {
                  type: "verification_result",
                  gate: "codex_turn",
                  command: codexVerificationCommand,
                  head_sha: codexTurnVerificationHeadSha,
                  outcome: "passed",
                  remediation_target: null,
                  next_action: "continue",
                  summary: conciseCodexVerificationSummary(
                    structuredResult?.summary,
                  ),
                  recorded_at: new Date().toISOString(),
                },
                (candidate) =>
                  candidate.type === "verification_result" &&
                  candidate.gate === "codex_turn" &&
                  candidate.outcome === "passed" &&
                  candidate.head_sha === codexTurnVerificationHeadSha &&
                  candidate.command === codexVerificationCommand,
              )
            : null;
        const preserveStaleNoPrRecoveryTracking =
          pr === null &&
          postRunSnapshot === null &&
          shouldPreserveStaleStabilizingNoPrRecoveryTracking(
            record,
            postRunState,
          );
        record = stateStore.touch(record, {
          pr_number: pr?.number ?? null,
          ...(postRunSnapshot?.reviewWaitPatch ?? {}),
          ...(postRunSnapshot?.codexConnectorRequestObservationPatch ?? {}),
          ...(postRunSnapshot?.copilotRequestObservationPatch ?? {}),
          ...(postRunSnapshot?.copilotTimeoutPatch ?? {}),
          ...processedReviewThreadPatch,
          ...reviewFollowUpPatch,
          blocked_verification_retry_count: pr
            ? 0
            : record.blocked_verification_retry_count,
          repeated_blocker_count: 0,
          last_blocker_signature: null,
          stale_stabilizing_no_pr_recovery_count:
            preserveStaleNoPrRecoveryTracking
              ? preTurnStaleNoPrRecoveryCount
              : 0,
          last_error: preserveStaleNoPrRecoveryTracking
            ? preTurnLastError
            : postRunState === "blocked" && postRunSnapshot?.failureContext
              ? truncate(postRunSnapshot.failureContext.summary, 1000)
              : record.last_error,
          last_failure_context: preserveStaleNoPrRecoveryTracking
            ? preTurnFailureContext
            : (postRunSnapshot?.failureContext ?? null),
          ...(preserveStaleNoPrRecoveryTracking
            ? {
                last_failure_signature: preTurnFailureSignature,
                repeated_failure_signature_count: 0,
              }
            : args.applyFailureSignature(
                record,
                postRunSnapshot?.failureContext ?? null,
              )),
          blocked_reason:
            pr && postRunState === "blocked"
              ? args.blockedReasonFromReviewState(
                  postRunSnapshot?.recordForState ?? record,
                  pr,
                  checks,
                  reviewThreads,
                )
              : null,
          ...(codexTurnVerificationTimelineArtifacts
            ? { timeline_artifacts: codexTurnVerificationTimelineArtifacts }
            : {}),
          state: postRunState,
          ...(pr === null &&
          (postRunState === "blocked" || postRunState === "failed")
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
          retentionRootPath: executionMetricsRetentionRootPath(
            args.config.stateFile,
          ),
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
      }
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
