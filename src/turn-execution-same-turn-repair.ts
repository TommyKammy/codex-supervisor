import { GitHubClient } from "./github";
import { StateStore } from "./core/state-store";
import {
  FailureContext,
  GitHubIssue,
  GitHubPullRequest,
  IssueRunRecord,
  SupervisorStateFile,
  WorkspaceStatus,
} from "./core/types";
import { truncate } from "./core/utils";
import {
  commitAndPushTrackedFiles,
  filterPresentTrackedFilePaths,
  getWorkspaceStatus,
} from "./core/workspace";
import { IssueJournalSync } from "./run-once-issue-preparation";
import { buildWorkstationLocalPathFailureContext } from "./workstation-local-path-gate";
import { persistPublicationPathHygieneBlocked } from "./turn-execution-path-hygiene-persistence";

const TRUSTED_DURABLE_ARTIFACT_NORMALIZATION_COMMIT_MESSAGE =
  "Normalize trusted durable artifacts for path hygiene";

type StateStoreLike = Pick<StateStore, "touch" | "save">;

type SameTurnRepairGitHubLike = Partial<
  Pick<GitHubClient, "addIssueComment" | "getExternalReviewSurface" | "updateIssueComment">
>;

type IssueDefinitionLike = Pick<GitHubIssue, "body" | "labels" | "title" | "updatedAt">;

type FailureSignaturePatch = Pick<
  IssueRunRecord,
  "last_failure_signature" | "repeated_failure_signature_count"
>;

export type SameTurnDurableArtifactRepairResult =
  | {
      kind: "retry";
      record: IssueRunRecord;
      workspaceStatus: WorkspaceStatus;
    }
  | {
      kind: "blocked";
      record: IssueRunRecord;
      message: string;
    };

export async function runSameTurnDurableArtifactRepairRetry(args: {
  stateStore: StateStoreLike;
  state: SupervisorStateFile;
  record: IssueRunRecord;
  issue: IssueDefinitionLike;
  pr: GitHubPullRequest | null;
  github: SameTurnRepairGitHubLike;
  syncJournal: IssueJournalSync;
  failureContext: FailureContext;
  applyFailureSignature: (
    record: IssueRunRecord,
    failureContext: FailureContext | null,
  ) => FailureSignaturePatch;
  workspacePath: string;
  workspaceStatus: WorkspaceStatus;
  defaultBranch: string;
  rewrittenTrackedPaths: readonly string[];
  getWorkspaceStatus?: typeof getWorkspaceStatus;
  publishTrackedPrCommentOnFailure?: boolean;
  syncExecutionMetricsRunSummary: (record: IssueRunRecord) => Promise<void>;
}): Promise<SameTurnDurableArtifactRepairResult> {
  const presentRewrittenTrackedPaths = await filterPresentTrackedFilePaths(
    args.workspacePath,
    [...args.rewrittenTrackedPaths],
  );

  let workspaceStatus = args.workspaceStatus;
  let record = args.record;
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
      const retryPersistenceFailureContext =
        buildWorkstationLocalPathFailureContext({
          gateLabel: "before publication",
          details: [
            `durable artifact normalization persistence failed for ${presentRewrittenTrackedPaths.join(", ")}: ${message}`,
          ],
        });
      const persistenceResult = await persistPublicationPathHygieneBlocked({
        stateStore: args.stateStore,
        state: args.state,
        record,
        issue: args.issue,
        pr: args.pr,
        github: args.github,
        syncJournal: args.syncJournal,
        failureContext: retryPersistenceFailureContext,
        applyFailureSignature: args.applyFailureSignature,
        workspaceHeadSha: workspaceStatus.headSha,
        publishTrackedPrComment: args.publishTrackedPrCommentOnFailure,
        syncExecutionMetricsRunSummary: args.syncExecutionMetricsRunSummary,
      });
      return {
        kind: "blocked",
        record: persistenceResult.record,
        message: `Workstation-local path hygiene blocked publication for issue #${persistenceResult.record.issue_number}.`,
      };
    }

    const getWorkspaceStatusImpl = args.getWorkspaceStatus ?? getWorkspaceStatus;
    workspaceStatus = await getWorkspaceStatusImpl(
      args.workspacePath,
      record.branch,
      args.defaultBranch,
    );
    record = args.stateStore.touch(record, {
      last_head_sha: workspaceStatus.headSha,
    });
  }

  record = args.stateStore.touch(record, {
    last_error: truncate(args.failureContext.summary, 1000),
    last_failure_kind: null,
    last_failure_context: args.failureContext,
    ...args.applyFailureSignature(record, args.failureContext),
  });
  args.state.issues[String(record.issue_number)] = record;
  await args.stateStore.save(args.state);
  await args.syncJournal(record);

  return {
    kind: "retry",
    record,
    workspaceStatus,
  };
}
