import { inspectTrackedIssueHostDiagnostics, summarizeIssueJournalHandoff } from "../core/journal";
import {
  GitHubIssue,
  GitHubPullRequest,
  IssueRunRecord,
  PullRequestCheck,
  ReviewThread,
  SupervisorConfig,
} from "../core/types";

import {
  loadExecutionMetricsSummaryLines,
} from "./execution-metrics-debugging";
import {
  buildChangeClassesStatusLine,
  buildDurableGuardrailStatusLine,
  buildExternalReviewFollowUpStatusLine,
  buildLocalReviewRoutingStatusLine,
  buildVerificationPolicyStatusLine,
  loadStatusChangedFiles,
} from "./supervisor-status-rendering";
import { buildCodexModelPolicySnapshot, renderStatusCodexModelPolicyLines } from "../codex/codex-model-policy";
import { maybeBuildIssueActivityContext, type SupervisorIssueActivityContextDto } from "./supervisor-operator-activity-context";
import { loadPreMergeEvaluationDto } from "./supervisor-pre-merge-evaluation";

export interface ActiveStatusGitHub {
  resolvePullRequestForBranch(branchName: string, pullRequestNumber?: number | null): Promise<GitHubPullRequest | null>;
  getChecks(pullRequestNumber: number): Promise<PullRequestCheck[]>;
  getUnresolvedReviewThreads(
    pullRequestNumber: number,
    options?: { purpose?: "status" | "action"; headSha?: string | null; reviewSurfaceVersion?: string | null },
  ): Promise<ReviewThread[]>;
}

export interface ActiveStatusIssueGitHub {
  getIssue(issueNumber: number): Promise<GitHubIssue>;
}

export interface ActiveIssueStatusSnapshot {
  pr: GitHubPullRequest | null;
  checks: PullRequestCheck[];
  reviewThreads: ReviewThread[];
  activityContext: SupervisorIssueActivityContextDto | null;
  handoffSummary: string | null;
  codexModelPolicySummaryLines: string[];
  localReviewRoutingSummary: string | null;
  changeClassesSummary: string | null;
  verificationPolicySummary: string | null;
  durableGuardrailSummary: string | null;
  externalReviewFollowUpSummary: string | null;
  hostPathSummary: string | null;
  journalStateSummary: string | null;
  executionMetricsSummaryLines: string[];
  warningMessage: string | null;
}

function isOpenPullRequest(pr: GitHubPullRequest | null): pr is GitHubPullRequest {
  return pr !== null && pr.state === "OPEN" && !pr.mergedAt;
}

export async function loadActiveIssueStatusSnapshot(args: {
  github: ActiveStatusGitHub & Partial<ActiveStatusIssueGitHub>;
  config: SupervisorConfig;
  activeRecord: IssueRunRecord;
}): Promise<ActiveIssueStatusSnapshot> {
  let handoffSummary: string | null = null;
  let pr: GitHubPullRequest | null = null;
  let checks: PullRequestCheck[] = [];
  let reviewThreads: ReviewThread[] = [];
  let changeClassesSummary: string | null = null;
  let localReviewRoutingSummary: string | null = null;
  let codexModelPolicySummaryLines: string[] = [];
  let verificationPolicySummary: string | null = null;
  let durableGuardrailSummary: string | null = null;
  let externalReviewFollowUpSummary: string | null = null;
  let hostPathSummary: string | null = null;
  let journalStateSummary: string | null = null;
  let executionMetricsSummaryLines: string[] = [];
  let warningMessage: string | null = null;
  let preMergeEvaluation = null;

  try {
    const hostDiagnostics = await inspectTrackedIssueHostDiagnostics(args.config, args.activeRecord);
    if (hostDiagnostics.guidance !== null) {
      hostPathSummary = [
        "issue_host_paths",
        `issue=#${args.activeRecord.issue_number}`,
        `workspace=${hostDiagnostics.workspaceStatus}`,
        `journal_path=${hostDiagnostics.journalPathStatus}`,
        `guidance=${hostDiagnostics.guidance}`,
      ].join(" ");
      if (hostDiagnostics.journalStatus !== "current") {
        journalStateSummary = [
          "issue_journal_state",
          `issue=#${args.activeRecord.issue_number}`,
          `status=${hostDiagnostics.journalStatus}`,
          `guidance=${hostDiagnostics.guidance}`,
          `detail=${hostDiagnostics.journalStatus === "rehydrated" ? "prior_local_only_handoff_unavailable" : "resolved_local_journal_missing"}`,
        ].join(" ");
      }
    }
    if (hostDiagnostics.journalContent !== null) {
      handoffSummary = summarizeIssueJournalHandoff(hostDiagnostics.journalContent);
    }
  } catch (error) {
    warningMessage = error instanceof Error ? error.message : String(error);
  }

  try {
    const changedFiles = await loadStatusChangedFiles(args.config, args.activeRecord.workspace);
    const issue = args.github.getIssue
      ? await args.github.getIssue(args.activeRecord.issue_number)
      : null;
    pr = await args.github.resolvePullRequestForBranch(args.activeRecord.branch, args.activeRecord.pr_number);
    checks = isOpenPullRequest(pr) ? await args.github.getChecks(pr.number) : [];
    reviewThreads = isOpenPullRequest(pr)
      ? await args.github.getUnresolvedReviewThreads(pr.number, {
          purpose: "status",
          headSha: pr.headRefOid,
          reviewSurfaceVersion: pr.updatedAt ?? pr.createdAt,
        })
      : [];
    localReviewRoutingSummary = await buildLocalReviewRoutingStatusLine({
      config: args.config,
      activeRecord: args.activeRecord,
    });
    codexModelPolicySummaryLines = renderStatusCodexModelPolicyLines(
      await buildCodexModelPolicySnapshot({
        config: args.config,
        activeState: args.activeRecord.state,
        activeRecord: args.activeRecord,
      }),
    );
    changeClassesSummary = buildChangeClassesStatusLine(changedFiles);
    verificationPolicySummary = buildVerificationPolicyStatusLine({ issue, changedFiles });
    durableGuardrailSummary = await buildDurableGuardrailStatusLine({
      config: args.config,
      activeRecord: args.activeRecord,
      pr,
      changedFiles,
    });
    externalReviewFollowUpSummary = await buildExternalReviewFollowUpStatusLine({
      activeRecord: args.activeRecord,
      currentHeadSha: pr?.headRefOid ?? args.activeRecord.last_head_sha,
    });
    preMergeEvaluation = await loadPreMergeEvaluationDto({
      config: args.config,
      record: args.activeRecord,
      pr,
    });
    executionMetricsSummaryLines = await loadExecutionMetricsSummaryLines(args.activeRecord.workspace);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    warningMessage = warningMessage ? `${warningMessage}; ${message}` : message;
  }

  return {
    pr,
    checks,
    reviewThreads,
    activityContext: maybeBuildIssueActivityContext({
      config: args.config,
      record: args.activeRecord,
      pr,
      handoffSummary,
      localReviewRoutingSummary,
      changeClassesSummary,
      verificationPolicySummary,
      durableGuardrailSummary,
      externalReviewFollowUpSummary,
      preMergeEvaluation,
    }),
    handoffSummary,
    codexModelPolicySummaryLines,
    localReviewRoutingSummary,
    changeClassesSummary,
    verificationPolicySummary,
    durableGuardrailSummary,
    externalReviewFollowUpSummary,
    hostPathSummary,
    journalStateSummary,
    executionMetricsSummaryLines,
    warningMessage,
  };
}
