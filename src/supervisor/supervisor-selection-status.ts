import { GitHubClient } from "../github";
import {
  findBlockingIssue,
  findHighRiskBlockingAmbiguity,
  lintExecutionReadyIssueBody,
  parseIssueMetadata,
} from "../issue-metadata";
import {
  formatExecutionReadyMissingFields,
  isEligibleForSelection,
  shouldEnforceExecutionReady,
} from "./supervisor-execution-policy";
import { GitHubIssue, SupervisorConfig, SupervisorStateFile } from "../core/types";
export type { ActiveIssueStatusSnapshot } from "./supervisor-selection-active-status";
export { loadActiveIssueStatusSnapshot } from "./supervisor-selection-active-status";
export type { ExplainIssueGitHub } from "./supervisor-selection-issue-explain";
export {
  buildIssueExplainSummary,
  buildNonRunnableLocalStateReasons,
  formatSelectionReason,
} from "./supervisor-selection-issue-explain";
export type { IssueLintGitHub } from "./supervisor-selection-issue-lint";
export { buildIssueLintSummary } from "./supervisor-selection-issue-lint";
export type { SupervisorStatusRecords } from "./supervisor-selection-status-records";
export { summarizeSupervisorStatusRecords } from "./supervisor-selection-status-records";
import { formatSelectionReason } from "./supervisor-selection-issue-explain";

type ReadinessSummaryGitHub = Pick<GitHubClient, "listCandidateIssues">;
type SelectionWhyGitHub = Pick<GitHubClient, "listAllIssues" | "listCandidateIssues">;

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

export async function buildSelectionWhySummary(
  github: SelectionWhyGitHub,
  config: SupervisorConfig,
  state: SupervisorStateFile,
): Promise<string[]> {
  const candidateIssues = await github.listCandidateIssues();
  const issues = await github.listAllIssues();

  for (const issue of candidateIssues) {
    if (config.skipTitlePrefixes.some((prefix) => issue.title.startsWith(prefix))) {
      continue;
    }

    const existing = state.issues[String(issue.number)];
    const readiness = lintExecutionReadyIssueBody(issue);
    if (shouldEnforceExecutionReady(existing) && !readiness.isExecutionReady) {
      continue;
    }

    if (findHighRiskBlockingAmbiguity(issue)) {
      continue;
    }

    if (findBlockingIssue(issue, issues, state)) {
      continue;
    }

    if (!isEligibleForSelection(existing, config)) {
      continue;
    }

    return [
      `selected_issue=#${issue.number}`,
      `selection_reason=${formatSelectionReason(issue, issues, state, existing, readiness.isExecutionReady, config)}`,
    ];
  }

  return ["selected_issue=none", "selection_reason=no_runnable_issue"];
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
