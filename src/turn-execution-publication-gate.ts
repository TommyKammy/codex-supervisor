import { GitHubClient } from "./github";
import { runLocalCiGate, runWorkspacePreparationGate, type LocalCiCommandRunner } from "./local-ci";
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
import {
  runWorkstationLocalPathGate,
  type WorkstationLocalPathGateResult,
} from "./workstation-local-path-gate";

function isOpenPullRequest(pr: GitHubPullRequest | null): pr is GitHubPullRequest {
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

export interface CodexTurnPublicationGateReadyResult {
  kind: "ready";
  record: IssueRunRecord;
  pr: GitHubPullRequest | null;
  checks: PullRequestCheck[];
  reviewThreads: ReviewThread[];
}

export type CodexTurnPublicationGateResult =
  | CodexTurnPublicationGateBlockedResult
  | CodexTurnPublicationGateReadyResult;

export async function applyCodexTurnPublicationGate(args: {
  config: Pick<SupervisorConfig, "draftPrAfterAttempt" | "workspacePreparationCommand" | "localCiCommand">;
  stateStore: Pick<StateStore, "touch" | "save">;
  state: SupervisorStateFile;
  record: IssueRunRecord;
  issue: Pick<GitHubIssue, "number" | "createdAt" | "title" | "body" | "updatedAt" | "url" | "state">;
  workspacePath: string;
  workspaceStatus: WorkspaceStatus;
  github: Pick<
    GitHubClient,
    "resolvePullRequestForBranch" | "createPullRequest" | "getChecks" | "getUnresolvedReviewThreads"
  >;
  syncJournal: (record: IssueRunRecord) => Promise<void>;
  applyFailureSignature: (
    record: IssueRunRecord,
    failureContext: FailureContext | null,
  ) => Pick<IssueRunRecord, "last_failure_signature" | "repeated_failure_signature_count">;
  runWorkspacePreparationCommand?: LocalCiCommandRunner;
  runLocalCiCommand?: LocalCiCommandRunner;
  runWorkstationLocalPathGate?: (args: {
    workspacePath: string;
    gateLabel: string;
  }) => Promise<WorkstationLocalPathGateResult>;
  syncExecutionMetricsRunSummary: (record: IssueRunRecord) => Promise<void>;
}): Promise<CodexTurnPublicationGateResult> {
  let record = args.record;
  const runWorkstationLocalPathGateImpl = args.runWorkstationLocalPathGate ?? runWorkstationLocalPathGate;
  const resolvedPr = await args.github.resolvePullRequestForBranch(record.branch, record.pr_number, { purpose: "action" });
  let pr = isOpenPullRequest(resolvedPr) ? resolvedPr : null;

  if (
    !pr &&
    args.workspaceStatus.baseAhead > 0 &&
    !args.workspaceStatus.hasUncommittedChanges &&
    record.implementation_attempt_count >= args.config.draftPrAfterAttempt
  ) {
    const pathHygieneGate = await runWorkstationLocalPathGateImpl({
      workspacePath: args.workspacePath,
      gateLabel: "before publication",
    });
    if (!pathHygieneGate.ok) {
      const failureContext = pathHygieneGate.failureContext;
      record = args.stateStore.touch(record, {
        state: "blocked",
        last_error: truncate(
          failureContext?.summary ?? "Tracked durable artifacts failed workstation-local path hygiene before publication.",
          1000,
        ),
        last_failure_kind: null,
        last_failure_context: failureContext,
        ...args.applyFailureSignature(record, failureContext),
        blocked_reason: "verification",
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
              head_sha: args.workspaceStatus.headSha,
            }
          : null,
        last_error: truncate(failureContext?.summary, 1000),
        last_failure_kind: null,
        last_failure_context: failureContext,
        ...args.applyFailureSignature(record, failureContext),
        blocked_reason: "verification",
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
            head_sha: args.workspaceStatus.headSha,
          }
        : null,
    });
    args.state.issues[String(record.issue_number)] = record;
    await args.stateStore.save(args.state);
    await args.syncJournal(record);
    pr = await args.github.createPullRequest(args.issue, record, { draft: true });
  }

  return {
    kind: "ready",
    record,
    pr,
    checks: pr ? await args.github.getChecks(pr.number) : [],
    reviewThreads: pr ? await args.github.getUnresolvedReviewThreads(pr.number) : [],
  };
}
