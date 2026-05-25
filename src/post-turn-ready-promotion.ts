import type { GitHubClient } from "./github";
import type { LocalCiCommandRunner } from "./local-ci";
import type { IssueJournalSync } from "./run-once-issue-preparation";
import type { StateStore } from "./core/state-store";
import type {
  FailureContext,
  GitHubPullRequest,
  IssueRunRecord,
  PullRequestCheck,
  ReviewThread,
  SupervisorConfig,
  SupervisorStateFile,
} from "./core/types";
import { commitAndPushTrackedFiles, filterPresentTrackedFilePaths } from "./core/workspace";
import {
  buildWorkstationLocalPathFailureContext,
  listReadyPromotionChangedFilePaths,
  runWorkstationLocalPathGate,
  type WorkstationLocalPathGateResult,
} from "./workstation-local-path-gate";
import { deriveReadyPromotionPathHygieneDecision } from "./ready-promotion-gate";
import {
  persistTrackedPrHostLocalBlocker,
  runTrackedPrCurrentHeadLocalCiGate,
} from "./tracked-pr-local-ci-publication-gate";
import * as trackedPrStatusComments from "./tracked-pr-status-comment";
import type { PostTurnPullRequestResult } from "./post-turn-pull-request";

const TRUSTED_DURABLE_ARTIFACT_NORMALIZATION_COMMIT_MESSAGE = "Normalize trusted durable artifacts for path hygiene";

export async function maybePromoteDraftPullRequestToReady(args: {
  config: SupervisorConfig;
  stateStore: Pick<StateStore, "touch" | "save">;
  state: SupervisorStateFile;
  github: Pick<GitHubClient, "markPullRequestReady"> &
    Partial<Pick<GitHubClient, "addIssueComment" | "updateIssueComment">>;
  record: IssueRunRecord;
  pr: GitHubPullRequest;
  checks: PullRequestCheck[];
  reviewThreads: ReviewThread[];
  workspacePath: string;
  syncJournal: IssueJournalSync;
  applyFailureSignature: (
    record: IssueRunRecord,
    failureContext: FailureContext | null,
  ) => Pick<IssueRunRecord, "last_failure_signature" | "repeated_failure_signature_count">;
  runWorkspacePreparationCommand?: LocalCiCommandRunner;
  runLocalCiCommand?: LocalCiCommandRunner;
  runWorkstationLocalPathGate?: (args: {
    workspacePath: string;
    gateLabel: string;
    publishablePathAllowlistMarkers?: readonly string[];
    readyPromotionChangedFilePaths?: readonly string[];
  }) => Promise<WorkstationLocalPathGateResult>;
  loadOpenPullRequestSnapshot: (prNumber: number) => Promise<{
    pr: GitHubPullRequest;
    checks: PullRequestCheck[];
    reviewThreads: ReviewThread[];
  }>;
}): Promise<{ handled: true; result: PostTurnPullRequestResult } | { handled: false; record: IssueRunRecord }> {
  const runWorkstationLocalPathGateImpl = args.runWorkstationLocalPathGate ?? runWorkstationLocalPathGate;
  let record = args.record;
  const readyPromotionChangedFilePaths =
    listReadyPromotionChangedFilePaths({
      workspacePath: args.workspacePath,
      baseRef: `origin/${args.config.defaultBranch}`,
      headRef: args.pr.headRefName,
    }) ??
    listReadyPromotionChangedFilePaths({
      workspacePath: args.workspacePath,
      baseRef: args.config.defaultBranch,
      headRef: args.pr.headRefName,
    }) ??
    undefined;
  const pathHygieneGate = await runWorkstationLocalPathGateImpl({
    workspacePath: args.workspacePath,
    gateLabel: `before marking PR #${args.pr.number} ready`,
    publishablePathAllowlistMarkers: args.config.publishablePathAllowlistMarkers,
    readyPromotionChangedFilePaths,
  });
  const pathHygieneDecision = deriveReadyPromotionPathHygieneDecision({
    record,
    pr: args.pr,
    gate: pathHygieneGate,
    fallbackSummary: `Tracked durable artifacts failed workstation-local path hygiene before marking PR #${args.pr.number} ready.`,
    applyFailureSignature: args.applyFailureSignature,
  });
  if (pathHygieneDecision.kind === "repair" || pathHygieneDecision.kind === "manual_review") {
    record = args.stateStore.touch(record, pathHygieneDecision.recordPatch);
    args.state.issues[String(record.issue_number)] = record;
    await args.stateStore.save(args.state);
    await args.syncJournal(record);
    record = await trackedPrStatusComments.maybeCommentOnTrackedPrHostLocalBlocker({
      github: args.github,
      stateStore: args.stateStore,
      state: args.state,
      record,
      pr: args.pr,
      syncJournal: args.syncJournal,
      ...pathHygieneDecision.comment,
    });
    return {
      handled: true,
      result: {
        record,
        pr: args.pr,
        checks: args.checks,
        reviewThreads: args.reviewThreads,
      },
    };
  }

  if (
    pathHygieneDecision.maintenanceFindingDetails.length > 0 ||
    (record.ready_promotion_maintenance_finding_details?.length ?? 0) > 0
  ) {
    record = args.stateStore.touch(record, {
      ready_promotion_maintenance_finding_details: pathHygieneDecision.maintenanceFindingDetails,
      ready_promotion_maintenance_head_sha: args.pr.headRefOid ?? null,
    });
    args.state.issues[String(record.issue_number)] = record;
    await args.stateStore.save(args.state);
    await args.syncJournal(record);
  }

  const presentRewrittenTrackedPaths = await filterPresentTrackedFilePaths(
    args.workspacePath,
    pathHygieneDecision.rewrittenTrackedPaths,
  );
  if (presentRewrittenTrackedPaths.length > 0) {
    let persistedNormalizationCommit = false;
    try {
      persistedNormalizationCommit = await commitAndPushTrackedFiles({
        workspacePath: args.workspacePath,
        branch: args.pr.headRefName,
        remoteBranchExists: true,
        filePaths: presentRewrittenTrackedPaths,
        commitMessage: TRUSTED_DURABLE_ARTIFACT_NORMALIZATION_COMMIT_MESSAGE,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const failureContext = buildWorkstationLocalPathFailureContext({
        gateLabel: `before marking PR #${args.pr.number} ready`,
        details: [
          `durable artifact normalization persistence failed for ${presentRewrittenTrackedPaths.join(", ")}: ${message}`,
        ],
      });
      record = await persistTrackedPrHostLocalBlocker({
        stateStore: args.stateStore,
        state: args.state,
        record,
        pr: args.pr,
        failureContext,
        syncJournal: args.syncJournal,
        applyFailureSignature: args.applyFailureSignature,
      });
      return {
        handled: true,
        result: {
          record,
          pr: args.pr,
          checks: args.checks,
          reviewThreads: args.reviewThreads,
        },
      };
    }
    if (!persistedNormalizationCommit) {
      const failureContext = buildWorkstationLocalPathFailureContext({
        gateLabel: `before marking PR #${args.pr.number} ready`,
        details: [
          `durable artifact normalization reported rewritten paths for ${presentRewrittenTrackedPaths.join(", ")} but did not create a commit to publish.`,
        ],
      });
      record = await persistTrackedPrHostLocalBlocker({
        stateStore: args.stateStore,
        state: args.state,
        record,
        pr: args.pr,
        failureContext,
        syncJournal: args.syncJournal,
        applyFailureSignature: args.applyFailureSignature,
      });
      return {
        handled: true,
        result: {
          record,
          pr: args.pr,
          checks: args.checks,
          reviewThreads: args.reviewThreads,
        },
      };
    }

    const persisted = await args.loadOpenPullRequestSnapshot(args.pr.number);
    record = args.stateStore.touch(record, {
      state: "draft_pr",
      pr_number: persisted.pr.number,
      last_head_sha: persisted.pr.headRefOid,
      blocked_reason: null,
      last_error: null,
      last_failure_kind: null,
      last_failure_context: null,
      last_failure_signature: null,
      repeated_failure_signature_count: 0,
    });
    args.state.issues[String(record.issue_number)] = record;
    await args.stateStore.save(args.state);
    await args.syncJournal(record);
    return {
      handled: true,
      result: {
        record,
        pr: persisted.pr,
        checks: persisted.checks,
        reviewThreads: persisted.reviewThreads,
      },
    };
  }

  const currentHeadLocalCiGate = await runTrackedPrCurrentHeadLocalCiGate({
    config: args.config,
    stateStore: args.stateStore,
    state: args.state,
    record,
    pr: args.pr,
    workspacePath: args.workspacePath,
    gateLabel: `before marking PR #${args.pr.number} ready`,
    workspaceHeadMismatchDetail: (localHeadSha, prHeadSha) =>
      `local workspace HEAD ${localHeadSha} does not match PR head ${prHeadSha}; the ready gate is failing closed until the local commit is published.`,
    publishWorkspaceHeadMismatchComment: true,
    github: args.github,
    syncJournal: args.syncJournal,
    applyFailureSignature: args.applyFailureSignature,
    runWorkspacePreparationCommand: args.runWorkspacePreparationCommand,
    runLocalCiCommand: args.runLocalCiCommand,
  });
  record = currentHeadLocalCiGate.record;
  if (!currentHeadLocalCiGate.ok) {
    return {
      handled: true,
      result: {
        record,
        pr: args.pr,
        checks: args.checks,
        reviewThreads: args.reviewThreads,
      },
    };
  }
  await args.github.markPullRequestReady(args.pr.number);
  return { handled: false, record };
}
