import { GitHubClient } from "./github";
import { StateStore } from "./core/state-store";
import {
  FailureContext,
  GitHubIssue,
  GitHubPullRequest,
  IssueRunRecord,
  SupervisorStateFile,
} from "./core/types";
import { truncate } from "./core/utils";
import { issueDefinitionFreshnessPatch } from "./issue-definition-freshness";
import { IssueJournalSync } from "./run-once-issue-preparation";
import * as trackedPrStatusComments from "./tracked-pr-status-comment";

const PUBLICATION_PATH_HYGIENE_BLOCKED_SUMMARY =
  "Tracked durable artifacts failed workstation-local path hygiene before publication.";

type PathHygieneRemediationTarget = "manual_review" | "repair_already_queued";

type StateStoreLike = Pick<StateStore, "touch" | "save">;

type PathHygieneGitHubLike = Partial<
  Pick<GitHubClient, "addIssueComment" | "getExternalReviewSurface" | "updateIssueComment">
>;

type IssueDefinitionLike = Pick<GitHubIssue, "body" | "labels" | "title" | "updatedAt">;

type FailureSignaturePatch = Pick<
  IssueRunRecord,
  "last_failure_signature" | "repeated_failure_signature_count"
>;

interface BasePathHygienePersistenceArgs {
  stateStore: StateStoreLike;
  state: SupervisorStateFile;
  record: IssueRunRecord;
  issue: IssueDefinitionLike;
  pr: GitHubPullRequest | null;
  github: PathHygieneGitHubLike;
  syncJournal: IssueJournalSync;
  failureContext: FailureContext | null;
  applyFailureSignature: (
    record: IssueRunRecord,
    failureContext: FailureContext | null,
  ) => FailureSignaturePatch;
  workspaceHeadSha: string;
  syncExecutionMetricsRunSummary: (record: IssueRunRecord) => Promise<void>;
}

export interface PathHygienePersistenceResult {
  record: IssueRunRecord;
  didPublishTrackedPrComment: boolean;
}

async function publishTrackedPrHostLocalBlockerComment(
  args: BasePathHygienePersistenceArgs & {
    record: IssueRunRecord;
    remediationTarget: PathHygieneRemediationTarget;
  },
): Promise<PathHygienePersistenceResult> {
  if (!args.pr) {
    return { record: args.record, didPublishTrackedPrComment: false };
  }

  const updatedRecord = await trackedPrStatusComments.maybeCommentOnTrackedPrHostLocalBlocker({
    github: args.github,
    stateStore: args.stateStore,
    state: args.state,
    record: args.record,
    pr: args.pr,
    syncJournal: args.syncJournal,
    gateType: "workstation_local_path_hygiene",
    blockerSignature: args.failureContext?.signature ?? null,
    failureClass: args.failureContext?.signature ?? null,
    remediationTarget: args.remediationTarget,
    summary: args.failureContext?.summary ?? PUBLICATION_PATH_HYGIENE_BLOCKED_SUMMARY,
    details: args.failureContext?.details,
    localHeadSha: args.workspaceHeadSha,
    remoteHeadSha: args.pr.headRefOid,
  });
  return {
    record: updatedRecord,
    didPublishTrackedPrComment: updatedRecord !== args.record,
  };
}

export async function persistPublicationPathHygieneBlocked(
  args: BasePathHygienePersistenceArgs & {
    summary?: string;
  },
): Promise<PathHygienePersistenceResult> {
  const blockedRecord = args.stateStore.touch(args.record, {
    state: "blocked",
    last_error: truncate(
      args.failureContext?.summary ?? args.summary ?? PUBLICATION_PATH_HYGIENE_BLOCKED_SUMMARY,
      1000,
    ),
    last_failure_kind: null,
    last_failure_context: args.failureContext,
    ...args.applyFailureSignature(args.record, args.failureContext),
    blocked_reason: "verification",
    ...issueDefinitionFreshnessPatch(args.issue),
  });
  const commentResult = await publishTrackedPrHostLocalBlockerComment({
    ...args,
    record: blockedRecord,
    remediationTarget: "manual_review",
  });

  if (!commentResult.didPublishTrackedPrComment) {
    args.state.issues[String(commentResult.record.issue_number)] = commentResult.record;
    await args.stateStore.save(args.state);
  }
  await args.syncExecutionMetricsRunSummary(commentResult.record);
  if (!commentResult.didPublishTrackedPrComment) {
    await args.syncJournal(commentResult.record);
  }

  return commentResult;
}

export async function persistPublicationPathHygieneRepairQueued(
  args: BasePathHygienePersistenceArgs & {
    failureContext: FailureContext;
    actionablePublishableFilePaths: readonly string[];
  },
): Promise<PathHygienePersistenceResult> {
  const repairQueuedRecord = args.stateStore.touch(args.record, {
    state: "repairing_ci",
    timeline_artifacts: [
      ...(args.record.timeline_artifacts ?? []),
      {
        type: "path_hygiene_result",
        gate: "workstation_local_path_hygiene",
        command: args.failureContext.command,
        head_sha: args.workspaceHeadSha,
        outcome: "repair_queued",
        remediation_target: "repair_already_queued",
        next_action: "wait_for_repair_turn",
        summary: args.failureContext.summary,
        recorded_at: args.failureContext.updated_at,
        repair_targets: [...args.actionablePublishableFilePaths].sort((left, right) =>
          left.localeCompare(right),
        ),
      },
    ],
    last_error: truncate(args.failureContext.summary, 1000),
    last_failure_kind: null,
    last_failure_context: args.failureContext,
    ...args.applyFailureSignature(args.record, args.failureContext),
    blocked_reason: null,
    ...issueDefinitionFreshnessPatch(args.issue),
  });
  args.state.issues[String(repairQueuedRecord.issue_number)] = repairQueuedRecord;
  await args.stateStore.save(args.state);
  await args.syncExecutionMetricsRunSummary(repairQueuedRecord);

  const commentResult = await publishTrackedPrHostLocalBlockerComment({
    ...args,
    record: repairQueuedRecord,
    remediationTarget: "repair_already_queued",
  });
  if (!commentResult.didPublishTrackedPrComment) {
    await args.syncJournal(commentResult.record);
  }

  return commentResult;
}
