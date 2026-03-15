import { GitHubClient } from "./github";
import {
  findBlockingIssue,
  findHighRiskBlockingAmbiguity,
  lintExecutionReadyIssueBody,
  parseIssueMetadata,
} from "./issue-metadata";
import { readIssueJournal, summarizeIssueJournalHandoff } from "./journal";
import {
  formatExecutionReadyMissingFields,
  isEligibleForSelection,
  shouldEnforceExecutionReady,
} from "./supervisor-execution-policy";
import { buildDurableGuardrailStatusLine } from "./supervisor-status-rendering";
import {
  GitHubIssue,
  GitHubPullRequest,
  IssueRunRecord,
  PullRequestCheck,
  ReviewThread,
  SupervisorConfig,
  SupervisorStateFile,
} from "./types";

type ReadinessSummaryGitHub = Pick<GitHubClient, "listCandidateIssues">;
type ActiveStatusGitHub = Pick<
  GitHubClient,
  "resolvePullRequestForBranch" | "getChecks" | "getUnresolvedReviewThreads"
>;

export interface SupervisorStatusRecords {
  activeRecord: IssueRunRecord | null;
  latestRecord: IssueRunRecord | null;
  latestRecoveryRecord: IssueRunRecord | null;
  trackedIssueCount: number;
}

export interface ActiveIssueStatusSnapshot {
  pr: GitHubPullRequest | null;
  checks: PullRequestCheck[];
  reviewThreads: ReviewThread[];
  handoffSummary: string | null;
  durableGuardrailSummary: string | null;
  warningMessage: string | null;
}

function isOpenPullRequest(pr: GitHubPullRequest | null): pr is GitHubPullRequest {
  return pr !== null && pr.state === "OPEN" && !pr.mergedAt;
}

export function summarizeSupervisorStatusRecords(state: SupervisorStateFile): SupervisorStatusRecords {
  const activeRecord =
    state.activeIssueNumber !== null ? state.issues[String(state.activeIssueNumber)] ?? null : null;
  let latestRecord: IssueRunRecord | null = null;
  let latestRecoveryRecord: IssueRunRecord | null = null;

  for (const record of Object.values(state.issues)) {
    if (latestRecord === null || record.updated_at.localeCompare(latestRecord.updated_at) > 0) {
      latestRecord = record;
    }
    if (
      record.last_recovery_reason &&
      record.last_recovery_at &&
      (latestRecoveryRecord === null ||
        record.last_recovery_at.localeCompare(latestRecoveryRecord.last_recovery_at ?? "") > 0)
    ) {
      latestRecoveryRecord = record;
    }
  }

  return {
    activeRecord,
    latestRecord,
    latestRecoveryRecord,
    trackedIssueCount: Object.keys(state.issues).length,
  };
}

export async function loadActiveIssueStatusSnapshot(args: {
  github: ActiveStatusGitHub;
  config: SupervisorConfig;
  activeRecord: IssueRunRecord;
}): Promise<ActiveIssueStatusSnapshot> {
  let handoffSummary: string | null = null;
  if (args.activeRecord.journal_path) {
    handoffSummary = summarizeIssueJournalHandoff(await readIssueJournal(args.activeRecord.journal_path));
  }
  let pr: GitHubPullRequest | null = null;
  let checks: PullRequestCheck[] = [];
  let reviewThreads: ReviewThread[] = [];
  let durableGuardrailSummary: string | null = null;
  let warningMessage: string | null = null;

  try {
    pr = await args.github.resolvePullRequestForBranch(args.activeRecord.branch, args.activeRecord.pr_number);
    checks = isOpenPullRequest(pr) ? await args.github.getChecks(pr.number) : [];
    reviewThreads = isOpenPullRequest(pr) ? await args.github.getUnresolvedReviewThreads(pr.number) : [];
    durableGuardrailSummary = await buildDurableGuardrailStatusLine({
      config: args.config,
      activeRecord: args.activeRecord,
      pr,
    });
  } catch (error) {
    warningMessage = error instanceof Error ? error.message : String(error);
  }

  return {
    pr,
    checks,
    reviewThreads,
    handoffSummary,
    durableGuardrailSummary,
    warningMessage,
  };
}

export async function buildReadinessSummary(
  github: ReadinessSummaryGitHub,
  config: SupervisorConfig,
  state: SupervisorStateFile,
): Promise<string[]> {
  const issues = await github.listCandidateIssues();
  const runnable: string[] = [];
  const blocked: string[] = [];

  for (const issue of issues) {
    if (config.skipTitlePrefixes.some((prefix) => issue.title.startsWith(prefix))) {
      continue;
    }

    const existing = state.issues[String(issue.number)];
    const readiness = lintExecutionReadyIssueBody(issue);
    if (shouldEnforceExecutionReady(existing) && !readiness.isExecutionReady) {
      blocked.push(
        `#${issue.number} blocked_by=requirements:${formatExecutionReadyMissingFields(readiness.missingRequired)}`,
      );
      continue;
    }

    const clarificationBlock = findHighRiskBlockingAmbiguity(issue);
    if (clarificationBlock) {
      blocked.push(
        `#${issue.number} blocked_by=clarification:${clarificationBlock.ambiguityClasses.join("|")}:${clarificationBlock.riskyChangeClasses.join("|")}`,
      );
      continue;
    }

    const blockingIssue = findBlockingIssue(issue, issues, state);
    if (blockingIssue) {
      blocked.push(`#${issue.number} blocked_by=${blockingIssue.reason}`);
      continue;
    }

    if (!isEligibleForSelection(existing, config)) {
      blocked.push(`#${issue.number} blocked_by=local_state:${existing?.state ?? "unknown"}`);
      continue;
    }

    runnable.push(`#${issue.number} ready=${formatRunnableReadinessReason(issue, issues, state, readiness.isExecutionReady)}`);
  }

  return [
    `runnable_issues=${runnable.length > 0 ? runnable.join(",") : "none"}`,
    `blocked_issues=${blocked.length > 0 ? blocked.join("; ") : "none"}`,
  ];
}

function formatRunnableReadinessReason(
  issue: GitHubIssue,
  issues: GitHubIssue[],
  state: SupervisorStateFile,
  isExecutionReady: boolean,
): string {
  const metadata = parseIssueMetadata(issue);
  const reasons = [isExecutionReady ? "execution_ready" : "requirements_skipped"];

  if (metadata.dependsOn.length > 0) {
    const satisfiedDependencies = metadata.dependsOn.filter(
      (dependencyNumber) => state.issues[String(dependencyNumber)]?.state === "done",
    );

    if (satisfiedDependencies.length > 0) {
      reasons.push(`depends_on_satisfied:${satisfiedDependencies.join("|")}`);
    }
  }

  if (
    metadata.parentIssueNumber !== null &&
    metadata.executionOrderIndex !== null &&
    metadata.executionOrderIndex > 1
  ) {
    const clearedPredecessors = issues
      .filter((candidate) => candidate.number !== issue.number)
      .map((candidate) => ({
        issue: candidate,
        metadata: parseIssueMetadata(candidate),
      }))
      .filter(
        ({ metadata: candidateMetadata }) =>
          candidateMetadata.parentIssueNumber === metadata.parentIssueNumber &&
          candidateMetadata.executionOrderIndex !== null &&
          candidateMetadata.executionOrderIndex < metadata.executionOrderIndex!,
      )
      .sort(
        (left, right) =>
          (left.metadata.executionOrderIndex ?? Number.MAX_SAFE_INTEGER) -
          (right.metadata.executionOrderIndex ?? Number.MAX_SAFE_INTEGER),
      )
      .map(({ issue: predecessorIssue }) => predecessorIssue.number)
      .filter((predecessorNumber) => state.issues[String(predecessorNumber)]?.state === "done");

    if (clearedPredecessors.length > 0) {
      reasons.push(`execution_order_satisfied:${clearedPredecessors.join("|")}`);
    }
  }

  return reasons.join("+");
}
