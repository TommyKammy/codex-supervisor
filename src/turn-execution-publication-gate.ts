import { GitHubClient } from "./github";
import {
  runLocalCiGate,
  runWorkspacePreparationGate,
  type LocalCiCommandRunner,
} from "./local-ci";
import { StateStore } from "./core/state-store";
import {
  FailureContext,
  GitHubIssue,
  GitHubPullRequest,
  IssueRunRecord,
  PullRequestCheck,
  ReviewThread,
  SupervisorConfig,
  SupervisorStateFile,
  WorkspaceStatus,
} from "./core/types";
import { truncate } from "./core/utils";
import { issueDefinitionFreshnessPatch } from "./issue-definition-freshness";
import {
  buildWorkstationLocalPathFailureContext,
  runWorkstationLocalPathGate,
  type WorkstationLocalPathGateResult,
} from "./workstation-local-path-gate";
import {
  commitAndPushTrackedFiles,
  filterPresentTrackedFilePaths,
  getWorkspaceStatus,
  listTrackedSupervisorArtifactPaths,
} from "./core/workspace";

function isOpenPullRequest(
  pr: GitHubPullRequest | null,
): pr is GitHubPullRequest {
  return pr !== null && pr.state === "OPEN" && !pr.mergedAt;
}

export interface CodexTurnPublicationGateBlockedResult {
  kind: "blocked";
  message: string;
  record: IssueRunRecord;
  pr: null;
  checks: [];
  reviewThreads: [];
}

export interface CodexTurnPublicationGateSameTurnRepairResult {
  kind: "same_turn_repair";
  message: string;
  record: IssueRunRecord;
  failureContext: FailureContext;
  actionablePublishableFilePaths: string[];
  rewrittenTrackedPaths: string[];
}

export interface CodexTurnPublicationGateReadyResult {
  kind: "ready";
  record: IssueRunRecord;
  pr: GitHubPullRequest | null;
  checks: PullRequestCheck[];
  reviewThreads: ReviewThread[];
}

export type CodexTurnPublicationGateResult =
  | CodexTurnPublicationGateBlockedResult
  | CodexTurnPublicationGateSameTurnRepairResult
  | CodexTurnPublicationGateReadyResult;

const TRUSTED_DURABLE_ARTIFACT_NORMALIZATION_COMMIT_MESSAGE =
  "Normalize trusted durable artifacts for path hygiene";
const SUPERVISOR_LOCAL_DURABLE_ARTIFACT_SIGNATURE =
  "supervisor-local-durable-artifacts-tracked-before-publication";

function buildSupervisorLocalArtifactFailureContext(
  trackedPaths: string[],
  issueNumber: number,
): FailureContext {
  const listedPaths = trackedPaths.join(", ");
  return {
    category: "blocked",
    summary:
      `Tracked supervisor-local durable artifacts blocked pull request creation for issue #${issueNumber}. ` +
      `Remove or unstage these tracked paths before publishing checkpoint commits: ${listedPaths}.`,
    signature: SUPERVISOR_LOCAL_DURABLE_ARTIFACT_SIGNATURE,
    command: "git ls-files -- .codex-supervisor",
    details: [
      "Supervisor-local durable artifacts must not be committed into issue-branch publication checkpoints.",
      ...trackedPaths.map(
        (trackedPath) => `tracked supervisor-local artifact: ${trackedPath}`,
      ),
    ],
    url: null,
    updated_at: new Date().toISOString(),
  };
}

export async function applyCodexTurnPublicationGate(args: {
  config: Pick<
    SupervisorConfig,
    | "repoPath"
    | "defaultBranch"
    | "draftPrAfterAttempt"
    | "issueJournalRelativePath"
    | "workspacePreparationCommand"
    | "localCiCommand"
    | "publishablePathAllowlistMarkers"
  >;
  stateStore: Pick<StateStore, "touch" | "save">;
  state: SupervisorStateFile;
  record: IssueRunRecord;
  issue: Pick<
    GitHubIssue,
    "number" | "createdAt" | "title" | "body" | "updatedAt" | "url" | "state"
  >;
  workspacePath: string;
  workspaceStatus: WorkspaceStatus;
  github: Pick<
    GitHubClient,
    | "resolvePullRequestForBranch"
    | "createPullRequest"
    | "getChecks"
    | "getUnresolvedReviewThreads"
  >;
  syncJournal: (record: IssueRunRecord) => Promise<void>;
  applyFailureSignature: (
    record: IssueRunRecord,
    failureContext: FailureContext | null,
  ) => Pick<
    IssueRunRecord,
    "last_failure_signature" | "repeated_failure_signature_count"
  >;
  runWorkspacePreparationCommand?: LocalCiCommandRunner;
  runLocalCiCommand?: LocalCiCommandRunner;
  runWorkstationLocalPathGate?: (args: {
    workspacePath: string;
    gateLabel: string;
    publishablePathAllowlistMarkers?: readonly string[];
  }) => Promise<WorkstationLocalPathGateResult>;
  allowSameTurnPathRepairRetry?: boolean;
  changedFilesInCurrentTurn?: readonly string[];
  syncExecutionMetricsRunSummary: (record: IssueRunRecord) => Promise<void>;
}): Promise<CodexTurnPublicationGateResult> {
  let record = args.record;
  let workspaceStatus = args.workspaceStatus;
  const runWorkstationLocalPathGateImpl =
    args.runWorkstationLocalPathGate ?? runWorkstationLocalPathGate;
  const resolvedPr = await args.github.resolvePullRequestForBranch(
    record.branch,
    record.pr_number,
    { purpose: "action" },
  );
  let pr = isOpenPullRequest(resolvedPr) ? resolvedPr : null;

  if (
    !pr &&
    workspaceStatus.baseAhead > 0 &&
    !workspaceStatus.hasUncommittedChanges &&
    record.implementation_attempt_count >= args.config.draftPrAfterAttempt
  ) {
    const trackedSupervisorArtifactPaths =
      await listTrackedSupervisorArtifactPaths(
        args.workspacePath,
        args.config.issueJournalRelativePath,
      );
    if (trackedSupervisorArtifactPaths.length > 0) {
      const failureContext = buildSupervisorLocalArtifactFailureContext(
        trackedSupervisorArtifactPaths,
        record.issue_number,
      );
      record = args.stateStore.touch(record, {
        state: "blocked",
        last_error: truncate(failureContext.summary, 1000),
        last_failure_kind: null,
        last_failure_context: failureContext,
        ...args.applyFailureSignature(record, failureContext),
        blocked_reason: "verification",
        ...issueDefinitionFreshnessPatch(args.issue),
      });
      args.state.issues[String(record.issue_number)] = record;
      await args.stateStore.save(args.state);
      await args.syncExecutionMetricsRunSummary(record);
      await args.syncJournal(record);
      return {
        kind: "blocked",
        message: failureContext.summary,
        record,
        pr: null,
        checks: [],
        reviewThreads: [],
      };
    }

    const pathHygieneGate = await runWorkstationLocalPathGateImpl({
      workspacePath: args.workspacePath,
      gateLabel: "before publication",
      publishablePathAllowlistMarkers:
        args.config.publishablePathAllowlistMarkers,
    });
    if (!pathHygieneGate.ok) {
      const failureContext = pathHygieneGate.failureContext;
      const actionablePublishableFilePaths =
        pathHygieneGate.actionablePublishableFilePaths ?? [];
      const rewrittenTrackedPaths = [
        ...(pathHygieneGate.rewrittenJournalPaths ?? []),
        ...(pathHygieneGate.rewrittenTrustedGeneratedArtifactPaths ?? []),
      ];
      const changedFilesInCurrentTurn = new Set(
        args.changedFilesInCurrentTurn ?? [],
      );
      const sameTurnRepairEligible =
        args.allowSameTurnPathRepairRetry === true &&
        failureContext !== null &&
        actionablePublishableFilePaths.length > 0 &&
        actionablePublishableFilePaths.every((filePath) =>
          changedFilesInCurrentTurn.has(filePath),
        );
      if (sameTurnRepairEligible) {
        return {
          kind: "same_turn_repair",
          message: `Workstation-local path hygiene requested a same-turn repair retry for issue #${record.issue_number}.`,
          record,
          failureContext,
          actionablePublishableFilePaths,
          rewrittenTrackedPaths,
        };
      }
      record = args.stateStore.touch(record, {
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
        ...issueDefinitionFreshnessPatch(args.issue),
      });
      args.state.issues[String(record.issue_number)] = record;
      await args.stateStore.save(args.state);
      await args.syncExecutionMetricsRunSummary(record);
      await args.syncJournal(record);
      return {
        kind: "blocked",
        message: `Workstation-local path hygiene blocked pull request creation for issue #${record.issue_number}.`,
        record,
        pr: null,
        checks: [],
        reviewThreads: [],
      };
    }
    const rewrittenTrackedPaths = [
      ...(pathHygieneGate.rewrittenJournalPaths ?? []),
      ...(pathHygieneGate.rewrittenTrustedGeneratedArtifactPaths ?? []),
    ];
    const presentRewrittenTrackedPaths = await filterPresentTrackedFilePaths(
      args.workspacePath,
      rewrittenTrackedPaths,
    );
    if (presentRewrittenTrackedPaths.length > 0) {
      try {
        await commitAndPushTrackedFiles({
          workspacePath: args.workspacePath,
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
        record = args.stateStore.touch(record, {
          state: "blocked",
          last_error: truncate(failureContext.summary, 1000),
          last_failure_kind: null,
          last_failure_context: failureContext,
          ...args.applyFailureSignature(record, failureContext),
          blocked_reason: "verification",
          ...issueDefinitionFreshnessPatch(args.issue),
        });
        args.state.issues[String(record.issue_number)] = record;
        await args.stateStore.save(args.state);
        await args.syncExecutionMetricsRunSummary(record);
        await args.syncJournal(record);
        return {
          kind: "blocked",
          message: `Workstation-local path hygiene blocked pull request creation for issue #${record.issue_number}.`,
          record,
          pr: null,
          checks: [],
          reviewThreads: [],
        };
      }
      workspaceStatus = await getWorkspaceStatus(
        args.workspacePath,
        record.branch,
        args.config.defaultBranch,
      );
      record = args.stateStore.touch(record, {
        last_head_sha: workspaceStatus.headSha,
      });
    }

    const workspacePreparationGate = await runWorkspacePreparationGate({
      config: args.config,
      workspacePath: args.workspacePath,
      gateLabel: "before opening a pull request",
      runWorkspacePreparationCommand: args.runWorkspacePreparationCommand,
    });
    if (!workspacePreparationGate.ok) {
      const failureContext = workspacePreparationGate.failureContext;
      record = args.stateStore.touch(record, {
        state: "blocked",
        last_error: truncate(failureContext?.summary, 1000),
        last_failure_kind: null,
        last_failure_context: failureContext,
        ...args.applyFailureSignature(record, failureContext),
        blocked_reason: "verification",
        ...issueDefinitionFreshnessPatch(args.issue),
      });
      args.state.issues[String(record.issue_number)] = record;
      await args.stateStore.save(args.state);
      await args.syncExecutionMetricsRunSummary(record);
      await args.syncJournal(record);
      return {
        kind: "blocked",
        message: `Workspace preparation blocked pull request creation for issue #${record.issue_number}.`,
        record,
        pr: null,
        checks: [],
        reviewThreads: [],
      };
    }

    const localCiGate = await runLocalCiGate({
      config: args.config,
      workspacePath: args.workspacePath,
      gateLabel: "before opening a pull request",
      runLocalCiCommand: args.runLocalCiCommand,
    });
    if (!localCiGate.ok) {
      const failureContext = localCiGate.failureContext;
      record = args.stateStore.touch(record, {
        state: "blocked",
        latest_local_ci_result: localCiGate.latestResult
          ? {
              ...localCiGate.latestResult,
              head_sha: workspaceStatus.headSha,
            }
          : null,
        last_error: truncate(failureContext?.summary, 1000),
        last_failure_kind: null,
        last_failure_context: failureContext,
        ...args.applyFailureSignature(record, failureContext),
        blocked_reason: "verification",
        ...issueDefinitionFreshnessPatch(args.issue),
      });
      args.state.issues[String(record.issue_number)] = record;
      await args.stateStore.save(args.state);
      await args.syncExecutionMetricsRunSummary(record);
      await args.syncJournal(record);
      return {
        kind: "blocked",
        message: `Local CI gate blocked pull request creation for issue #${record.issue_number}.`,
        record,
        pr: null,
        checks: [],
        reviewThreads: [],
      };
    }

    record = args.stateStore.touch(record, {
      latest_local_ci_result: localCiGate.latestResult
        ? {
            ...localCiGate.latestResult,
            head_sha: workspaceStatus.headSha,
          }
        : null,
    });
    args.state.issues[String(record.issue_number)] = record;
    await args.stateStore.save(args.state);
    await args.syncJournal(record);
    pr = await args.github.createPullRequest(args.issue, record, {
      draft: true,
    });
  }

  return {
    kind: "ready",
    record,
    pr,
    checks: pr ? await args.github.getChecks(pr.number) : [],
    reviewThreads: pr
      ? await args.github.getUnresolvedReviewThreads(pr.number)
      : [],
  };
}
