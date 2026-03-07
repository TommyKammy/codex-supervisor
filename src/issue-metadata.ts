import { GitHubIssue, SupervisorStateFile } from "./types";

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

function parseIssueNumberList(input: string): number[] {
  return Array.from(
    new Set(
      [...input.matchAll(/#(\d+)/g)]
        .map((match) => Number(match[1]))
        .filter((value) => Number.isInteger(value) && value > 0),
    ),
  );
}

function parseList(input: string): string[] {
  return input
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
}

export function parseIssueMetadata(issue: GitHubIssue): IssueMetadata {
  const parentMatch = issue.body.match(/^\s*Part of #(\d+)\s*$/im);
  const orderMatch = issue.body.match(/^\s*##\s*Execution order\s*$[\r\n]+^\s*(\d+)\s+of\s+(\d+)\s*$/im);
  const dependsOnMatch = issue.body.match(/^\s*Depends on:\s*(.+)\s*$/im);
  const parallelGroupMatch = issue.body.match(/^\s*Parallel group:\s*(.+)\s*$/im);
  const touchesMatch = issue.body.match(/^\s*Touches:\s*(.+)\s*$/im);

  return {
    parentIssueNumber: parentMatch ? Number(parentMatch[1]) : null,
    executionOrderIndex: orderMatch ? Number(orderMatch[1]) : null,
    executionOrderTotal: orderMatch ? Number(orderMatch[2]) : null,
    dependsOn: dependsOnMatch ? parseIssueNumberList(dependsOnMatch[1]) : [],
    parallelGroup: parallelGroupMatch ? parallelGroupMatch[1].trim() : null,
    touches: touchesMatch ? parseList(touchesMatch[1]) : [],
  };
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
