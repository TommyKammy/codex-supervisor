import { GitHubIssue, SupervisorStateFile } from "../core/types";
import { parseIssueMetadata } from "./issue-metadata-parser";

export { parseIssueMetadata } from "./issue-metadata-parser";
export { validateIssueMetadataSyntax } from "./issue-metadata-validation";
export {
  classifyChangedFile,
  classifyChangedFiles,
  detectDeterministicChangeClasses,
} from "./issue-metadata-change-classification";
export { summarizeChangeRiskDecision } from "./issue-metadata-change-risk-decision";
export {
  findHighRiskBlockingAmbiguity,
  lintExecutionReadyIssueBody,
} from "./issue-metadata-gates";
export type {
  ChangeRiskDecisionSummary,
  ChangeRiskSource,
  ChangeRiskVerificationIntensity,
} from "./issue-metadata-change-risk-decision";
export type {
  ClassifiedChangedFile,
  DeterministicChangeClass,
} from "./issue-metadata-change-classification";
export type { ClarificationBlock, ExecutionReadyLintResult, HighRiskAmbiguityClass } from "./issue-metadata-gates";
export type { RiskyChangeClass } from "./issue-metadata-risky-policy";

export interface IssueMetadata {
  parentIssueNumber: number | null;
  executionOrderIndex: number | null;
  executionOrderTotal: number | null;
  dependsOn: number[];
  parallelGroup: string | null;
  touches: string[];
}

export interface BlockingIssue {
  issue: GitHubIssue;
  reason: string;
}

export interface ParentIssueClosureCandidate {
  parentIssue: GitHubIssue;
  childIssues: GitHubIssue[];
}

export function findBlockingIssue(
  issue: GitHubIssue,
  issues: GitHubIssue[],
  state: SupervisorStateFile,
): BlockingIssue | null {
  const issueByNumber = new Map(issues.map((candidate) => [candidate.number, candidate]));
  const metadata = parseIssueMetadata(issue);
  const executionOrderIndex = metadata.executionOrderIndex;

  for (const dependencyNumber of metadata.dependsOn) {
    const dependencyIssue = issueByNumber.get(dependencyNumber);
    if (!dependencyIssue) {
      continue;
    }

    if (dependencyIssue.state !== "CLOSED") {
      return {
        issue: dependencyIssue,
        reason: `depends on #${dependencyNumber}`,
      };
    }

    const dependencyRecord = state.issues[String(dependencyNumber)];
    if (!dependencyRecord || dependencyRecord.state !== "done") {
      return {
        issue: dependencyIssue,
        reason: `depends on #${dependencyNumber}`,
      };
    }
  }

  if (!metadata.parentIssueNumber || !executionOrderIndex || executionOrderIndex <= 1) {
    return null;
  }

  const predecessors = issues
    .filter((candidate) => candidate.number !== issue.number)
    .map((candidate) => ({
      issue: candidate,
      metadata: parseIssueMetadata(candidate),
    }))
    .filter(
      ({ metadata: candidateMetadata }) =>
        candidateMetadata.parentIssueNumber === metadata.parentIssueNumber &&
        candidateMetadata.executionOrderIndex !== null &&
        candidateMetadata.executionOrderIndex < executionOrderIndex,
    )
    .sort((left, right) => {
      const leftIndex = left.metadata.executionOrderIndex ?? Number.MAX_SAFE_INTEGER;
      const rightIndex = right.metadata.executionOrderIndex ?? Number.MAX_SAFE_INTEGER;
      return leftIndex - rightIndex;
    });

  for (const predecessor of predecessors) {
    if (predecessor.issue.state !== "CLOSED") {
      return {
        issue: predecessor.issue,
        reason: `execution order requires #${predecessor.issue.number} first`,
      };
    }

    const predecessorRecord = state.issues[String(predecessor.issue.number)];
    if (!predecessorRecord || predecessorRecord.state !== "done") {
      return {
        issue: predecessor.issue,
        reason: `execution order requires #${predecessor.issue.number} first`,
      };
    }
  }

  return null;
}

export function findParentIssuesReadyToClose(issues: GitHubIssue[]): ParentIssueClosureCandidate[] {
  const issueByNumber = new Map(issues.map((issue) => [issue.number, issue]));
  const childIssuesByParent = new Map<number, GitHubIssue[]>();

  for (const issue of issues) {
    const metadata = parseIssueMetadata(issue);
    if (!metadata.parentIssueNumber) {
      continue;
    }

    const siblings = childIssuesByParent.get(metadata.parentIssueNumber) ?? [];
    siblings.push(issue);
    childIssuesByParent.set(metadata.parentIssueNumber, siblings);
  }

  return Array.from(childIssuesByParent.entries())
    .map(([parentIssueNumber, childIssues]) => ({
      parentIssue: issueByNumber.get(parentIssueNumber) ?? null,
      childIssues,
    }))
    .filter(
      (
        candidate,
      ): candidate is ParentIssueClosureCandidate => candidate.parentIssue !== null,
    )
    .filter(
      ({ parentIssue, childIssues }) =>
        parentIssue.state === "OPEN" &&
        childIssues.length > 0 &&
        childIssues.every((childIssue) => childIssue.state === "CLOSED"),
    )
    .sort((left, right) => left.parentIssue.number - right.parentIssue.number);
}
