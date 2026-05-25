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
  LatestLocalCiResult,
  SupervisorConfig,
  SupervisorStateFile,
} from "./core/types";
import { truncate } from "./core/utils";
import { getWorkspaceStatus as getWorkspaceStatusImpl } from "./core/workspace";
import { buildWorkstationLocalPathFailureContext } from "./workstation-local-path-gate";
import * as trackedPrStatusComments from "./tracked-pr-status-comment";
import {
  appendTimelineArtifact,
  buildLocalCiTimelineArtifact,
} from "./timeline-artifacts";

function buildLocalCiResultRecordPatch(args: {
  record: Pick<IssueRunRecord, "timeline_artifacts">;
  latestResult: LatestLocalCiResult | null | undefined;
  headSha: string | null;
}): Pick<IssueRunRecord, "latest_local_ci_result" | "timeline_artifacts"> {
  return {
    latest_local_ci_result: args.latestResult ?? null,
    timeline_artifacts: args.latestResult
      ? appendTimelineArtifact(args.record, buildLocalCiTimelineArtifact({
        gate: "local_ci",
        result: args.latestResult,
        headSha: args.headSha,
      }))
      : args.record.timeline_artifacts,
  };
}

export interface TrackedPrReadyLocalCiPublicationGateResult {
  ok: boolean;
  record: IssueRunRecord;
}

export interface TrackedPrCurrentHeadLocalCiGateResult {
  ok: boolean;
  record: IssueRunRecord;
  failureContext: FailureContext | null;
}

export async function persistTrackedPrHostLocalBlocker(args: {
  stateStore: Pick<StateStore, "touch" | "save">;
  state: SupervisorStateFile;
  record: IssueRunRecord;
  pr: GitHubPullRequest;
  failureContext: FailureContext | null;
  recordPatch?: Partial<IssueRunRecord>;
  blockedReason?: IssueRunRecord["blocked_reason"];
  syncJournal: IssueJournalSync;
  applyFailureSignature: (
    record: IssueRunRecord,
    failureContext: FailureContext | null,
  ) => Pick<IssueRunRecord, "last_failure_signature" | "repeated_failure_signature_count">;
}): Promise<IssueRunRecord> {
  const recordPatch = args.recordPatch ?? {};
  const record = args.stateStore.touch(args.record, {
    ...recordPatch,
    state: recordPatch.state ?? "blocked",
    last_error: recordPatch.last_error ?? truncate(args.failureContext?.summary, 1000),
    last_failure_kind: null,
    last_failure_context: args.failureContext,
    ...args.applyFailureSignature(args.record, args.failureContext),
    blocked_reason: recordPatch.blocked_reason ?? args.blockedReason ?? "verification",
    ...trackedPrStatusComments.observedTrackedPrHostLocalBlockerPatch({
      pr: args.pr,
      blockerSignature: args.failureContext?.signature ?? null,
    }),
  });
  args.state.issues[String(record.issue_number)] = record;
  await args.stateStore.save(args.state);
  await args.syncJournal(record);
  return record;
}

export async function runTrackedPrReadyLocalCiPublicationGate(args: {
  config: Pick<SupervisorConfig, "repoPath" | "workspacePreparationCommand" | "localCiCommand">;
  stateStore: Pick<StateStore, "touch" | "save">;
  state: SupervisorStateFile;
  record: IssueRunRecord;
  pr: GitHubPullRequest;
  workspacePath: string;
  gateLabel?: string;
  github: Partial<Pick<GitHubClient, "addIssueComment" | "updateIssueComment">>;
  syncJournal: IssueJournalSync;
  applyFailureSignature: (
    record: IssueRunRecord,
    failureContext: FailureContext | null,
  ) => Pick<IssueRunRecord, "last_failure_signature" | "repeated_failure_signature_count">;
  runWorkspacePreparationCommand?: LocalCiCommandRunner;
  runLocalCiCommand?: LocalCiCommandRunner;
}): Promise<TrackedPrReadyLocalCiPublicationGateResult> {
  const gateLabel = args.gateLabel ?? `before marking PR #${args.pr.number} ready`;
  const workspacePreparationGate = await runWorkspacePreparationGate({
    config: args.config,
    workspacePath: args.workspacePath,
    gateLabel,
    runWorkspacePreparationCommand: args.runWorkspacePreparationCommand,
  });
  if (!workspacePreparationGate.ok) {
    const failureContext = workspacePreparationGate.failureContext;
    let record = await persistTrackedPrHostLocalBlocker({
      stateStore: args.stateStore,
      state: args.state,
      record: args.record,
      pr: args.pr,
      failureContext,
      syncJournal: args.syncJournal,
      applyFailureSignature: args.applyFailureSignature,
    });
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
    gateLabel,
    runLocalCiCommand: args.runLocalCiCommand,
  });
  if (!localCiGate.ok) {
    const failureContext = localCiGate.failureContext;
    let record = await persistTrackedPrHostLocalBlocker({
      stateStore: args.stateStore,
      state: args.state,
      record: args.record,
      pr: args.pr,
      failureContext,
      recordPatch: {
        ...buildLocalCiResultRecordPatch({
          record: args.record,
          latestResult: localCiGate.latestResult,
          headSha: args.pr.headRefOid ?? null,
        }),
      },
      syncJournal: args.syncJournal,
      applyFailureSignature: args.applyFailureSignature,
    });
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
    ...buildLocalCiResultRecordPatch({
      record: args.record,
      latestResult: localCiGate.latestResult,
      headSha: args.pr.headRefOid ?? null,
    }),
    last_observed_host_local_pr_blocker_signature: null,
    last_observed_host_local_pr_blocker_head_sha: null,
  });
  args.state.issues[String(record.issue_number)] = record;
  await args.stateStore.save(args.state);
  await args.syncJournal(record);
  return { ok: true, record };
}

export async function runTrackedPrCurrentHeadLocalCiGate(args: {
  config: Pick<SupervisorConfig, "defaultBranch" | "repoPath" | "workspacePreparationCommand" | "localCiCommand">;
  stateStore: Pick<StateStore, "touch" | "save">;
  state: SupervisorStateFile;
  record: IssueRunRecord;
  pr: GitHubPullRequest;
  workspacePath: string;
  gateLabel: string;
  workspaceHeadMismatchDetail: (localHeadSha: string, prHeadSha: string) => string;
  publishWorkspaceHeadMismatchComment: boolean;
  github: Partial<Pick<GitHubClient, "addIssueComment" | "updateIssueComment">>;
  syncJournal: IssueJournalSync;
  applyFailureSignature: (
    record: IssueRunRecord,
    failureContext: FailureContext | null,
  ) => Pick<IssueRunRecord, "last_failure_signature" | "repeated_failure_signature_count">;
  runWorkspacePreparationCommand?: LocalCiCommandRunner;
  runLocalCiCommand?: LocalCiCommandRunner;
  getWorkspaceStatus?: typeof getWorkspaceStatusImpl;
}): Promise<TrackedPrCurrentHeadLocalCiGateResult> {
  const localCiPublicationGate = await runTrackedPrReadyLocalCiPublicationGate({
    config: args.config,
    stateStore: args.stateStore,
    state: args.state,
    record: args.record,
    pr: args.pr,
    workspacePath: args.workspacePath,
    gateLabel: args.gateLabel,
    github: args.github,
    syncJournal: args.syncJournal,
    applyFailureSignature: args.applyFailureSignature,
    runWorkspacePreparationCommand: args.runWorkspacePreparationCommand,
    runLocalCiCommand: args.runLocalCiCommand,
  });
  let record = localCiPublicationGate.record;
  if (!localCiPublicationGate.ok) {
    return { ok: false, record, failureContext: record.last_failure_context ?? null };
  }

  const getWorkspaceStatus = args.getWorkspaceStatus ?? getWorkspaceStatusImpl;
  const localWorkspaceStatus = await getWorkspaceStatus(args.workspacePath, record.branch, args.config.defaultBranch);
  if (localWorkspaceStatus.headSha !== args.pr.headRefOid) {
    const failureContext = buildWorkstationLocalPathFailureContext({
      gateLabel: args.gateLabel,
      details: [
        args.workspaceHeadMismatchDetail(localWorkspaceStatus.headSha, args.pr.headRefOid),
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
    if (args.publishWorkspaceHeadMismatchComment) {
      record = await trackedPrStatusComments.maybeCommentOnTrackedPrHostLocalBlocker({
        github: args.github,
        stateStore: args.stateStore,
        state: args.state,
        record,
        pr: args.pr,
        syncJournal: args.syncJournal,
        gateType: "workstation_local_path_hygiene",
        blockerSignature: failureContext.signature,
        failureClass: failureContext.signature,
        remediationTarget: "tracked_publishable_content",
        summary: failureContext.summary,
        details: failureContext.details,
      });
    }
    return { ok: false, record, failureContext };
  }

  if (
    record.latest_local_ci_result !== null &&
    record.latest_local_ci_result !== undefined &&
    record.latest_local_ci_result.head_sha !== args.pr.headRefOid
  ) {
    record = args.stateStore.touch(record, {
      latest_local_ci_result: {
        ...record.latest_local_ci_result,
        head_sha: args.pr.headRefOid,
      },
    });
    args.state.issues[String(record.issue_number)] = record;
    await args.stateStore.save(args.state);
    await args.syncJournal(record);
  }

  return { ok: true, record, failureContext: null };
}
