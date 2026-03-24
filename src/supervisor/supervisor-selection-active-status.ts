import { readIssueJournal, summarizeIssueJournalHandoff } from "../core/journal";
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
import { maybeBuildIssueActivityContext, type SupervisorIssueActivityContextDto } from "./supervisor-operator-activity-context";
import { loadPreMergeEvaluationDto } from "./supervisor-pre-merge-evaluation";

export interface ActiveStatusGitHub {
  resolvePullRequestForBranch(branchName: string, pullRequestNumber?: number | null): Promise<GitHubPullRequest | null>;
  getChecks(pullRequestNumber: number): Promise<PullRequestCheck[]>;
  getUnresolvedReviewThreads(pullRequestNumber: number): Promise<ReviewThread[]>;
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
  localReviewRoutingSummary: string | null;
  changeClassesSummary: string | null;
  verificationPolicySummary: string | null;
  durableGuardrailSummary: string | null;
  externalReviewFollowUpSummary: string | null;
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
  let verificationPolicySummary: string | null = null;
  let durableGuardrailSummary: string | null = null;
  let externalReviewFollowUpSummary: string | null = null;
  let executionMetricsSummaryLines: string[] = [];
  let warningMessage: string | null = null;
  let preMergeEvaluation = null;

  if (args.activeRecord.journal_path) {
    try {
      handoffSummary = summarizeIssueJournalHandoff(await readIssueJournal(args.activeRecord.journal_path));
    } catch (error) {
      warningMessage = error instanceof Error ? error.message : String(error);
    }
  }

  try {
    const changedFiles = await loadStatusChangedFiles(args.config, args.activeRecord.workspace);
    const issue = args.github.getIssue
      ? await args.github.getIssue(args.activeRecord.issue_number)
      : null;
    pr = await args.github.resolvePullRequestForBranch(args.activeRecord.branch, args.activeRecord.pr_number);
    checks = isOpenPullRequest(pr) ? await args.github.getChecks(pr.number) : [];
    reviewThreads = isOpenPullRequest(pr) ? await args.github.getUnresolvedReviewThreads(pr.number) : [];
    localReviewRoutingSummary = await buildLocalReviewRoutingStatusLine({
      config: args.config,
      activeRecord: args.activeRecord,
    });
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
    localReviewRoutingSummary,
    changeClassesSummary,
    verificationPolicySummary,
    durableGuardrailSummary,
    externalReviewFollowUpSummary,
    executionMetricsSummaryLines,
    warningMessage,
  };
}
