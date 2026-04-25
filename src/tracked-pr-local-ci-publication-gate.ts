import { GitHubClient } from "./github";
import {
  runLocalCiGate,
  runWorkspacePreparationGate,
  type LocalCiCommandRunner,
} from "./local-ci";
import { IssueJournalSync } from "./run-once-issue-preparation";
import { StateStore } from "./core/state-store";
import {
  FailureContext,
  GitHubPullRequest,
  IssueRunRecord,
  SupervisorConfig,
  SupervisorStateFile,
} from "./core/types";
import { truncate } from "./core/utils";
import * as trackedPrStatusComments from "./tracked-pr-status-comment";
import {
  appendTimelineArtifact,
  buildLocalCiTimelineArtifact,
} from "./timeline-artifacts";

export interface TrackedPrReadyLocalCiPublicationGateResult {
  ok: boolean;
  record: IssueRunRecord;
}

export async function runTrackedPrReadyLocalCiPublicationGate(args: {
  config: Pick<SupervisorConfig, "repoPath" | "workspacePreparationCommand" | "localCiCommand">;
  stateStore: Pick<StateStore, "touch" | "save">;
  state: SupervisorStateFile;
  record: IssueRunRecord;
  pr: GitHubPullRequest;
  workspacePath: string;
  github: Partial<Pick<GitHubClient, "addIssueComment" | "updateIssueComment">>;
  syncJournal: IssueJournalSync;
  applyFailureSignature: (
    record: IssueRunRecord,
    failureContext: FailureContext | null,
  ) => Pick<IssueRunRecord, "last_failure_signature" | "repeated_failure_signature_count">;
  runWorkspacePreparationCommand?: LocalCiCommandRunner;
  runLocalCiCommand?: LocalCiCommandRunner;
}): Promise<TrackedPrReadyLocalCiPublicationGateResult> {
  const workspacePreparationGate = await runWorkspacePreparationGate({
    config: args.config,
    workspacePath: args.workspacePath,
    gateLabel: `before marking PR #${args.pr.number} ready`,
    runWorkspacePreparationCommand: args.runWorkspacePreparationCommand,
  });
  if (!workspacePreparationGate.ok) {
    const failureContext = workspacePreparationGate.failureContext;
    let record = args.stateStore.touch(args.record, {
      state: "blocked",
      last_error: truncate(failureContext?.summary, 1000),
      last_failure_kind: null,
      last_failure_context: failureContext,
      ...args.applyFailureSignature(args.record, failureContext),
      blocked_reason: "verification",
      ...trackedPrStatusComments.observedTrackedPrHostLocalBlockerPatch({
        pr: args.pr,
        blockerSignature: failureContext?.signature ?? null,
      }),
    });
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
      gateType: "workspace_preparation",
      blockerSignature: failureContext?.signature ?? null,
      failureClass: trackedPrStatusComments.workspacePreparationFailureClass(failureContext?.signature),
      remediationTarget: trackedPrStatusComments.workspacePreparationRemediationTarget(
        trackedPrStatusComments.workspacePreparationFailureClass(failureContext?.signature),
      ),
      summary: failureContext?.summary ?? null,
      details: failureContext?.details,
    });
    return { ok: false, record };
  }

  const localCiGate = await runLocalCiGate({
    config: args.config,
    workspacePath: args.workspacePath,
    gateLabel: `before marking PR #${args.pr.number} ready`,
    runLocalCiCommand: args.runLocalCiCommand,
  });
  if (!localCiGate.ok) {
    const failureContext = localCiGate.failureContext;
    let record = args.stateStore.touch(args.record, {
      state: "blocked",
      latest_local_ci_result: localCiGate.latestResult ?? null,
      timeline_artifacts: localCiGate.latestResult
        ? appendTimelineArtifact(args.record, buildLocalCiTimelineArtifact({
          gate: "local_ci",
          result: localCiGate.latestResult,
          headSha: args.pr.headRefOid ?? null,
        }))
        : args.record.timeline_artifacts,
      last_error: truncate(failureContext?.summary, 1000),
      last_failure_kind: null,
      last_failure_context: failureContext,
      ...args.applyFailureSignature(args.record, failureContext),
      blocked_reason: "verification",
      ...trackedPrStatusComments.observedTrackedPrHostLocalBlockerPatch({
        pr: args.pr,
        blockerSignature: failureContext?.signature ?? null,
      }),
    });
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
      gateType: "local_ci",
      blockerSignature: failureContext?.signature ?? null,
      failureClass: localCiGate.latestResult?.failure_class ?? null,
      remediationTarget: localCiGate.latestResult?.remediation_target ?? null,
      summary: failureContext?.summary ?? localCiGate.latestResult?.summary ?? null,
      details: failureContext?.details,
    });
    return { ok: false, record };
  }

  const record = args.stateStore.touch(args.record, {
    latest_local_ci_result: localCiGate.latestResult ?? null,
    timeline_artifacts: localCiGate.latestResult
      ? appendTimelineArtifact(args.record, buildLocalCiTimelineArtifact({
        gate: "local_ci",
        result: localCiGate.latestResult,
        headSha: args.pr.headRefOid ?? null,
      }))
      : args.record.timeline_artifacts,
    last_observed_host_local_pr_blocker_signature: null,
    last_observed_host_local_pr_blocker_head_sha: null,
  });
  args.state.issues[String(record.issue_number)] = record;
  await args.stateStore.save(args.state);
  await args.syncJournal(record);
  return { ok: true, record };
}
