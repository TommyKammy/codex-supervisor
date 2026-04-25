import { GitHubIssue, IssueRunRecord, SupervisorStateFile } from "../core/types";
import { parseCanonicalEpicChildIssueNumbers, parseIssueMetadata } from "./issue-metadata-parser";

export { parseCanonicalEpicChildIssueNumbers, parseIssueMetadata } from "./issue-metadata-parser";
export { validateIssueMetadataSyntax } from "./issue-metadata-validation";
export {
  classifyChangedFile,
  classifyChangedFiles,
  detectDeterministicChangeClasses,
} from "./issue-metadata-change-classification";
export { summarizeChangeRiskDecision } from "./issue-metadata-change-risk-decision";
export {
  findHighRiskBlockingAmbiguity,
  hasAvailableIssueLabels,
  LABEL_GATED_POLICY_MISSING_LABELS_BLOCKED_BY,
  LABEL_GATED_POLICY_MISSING_LABELS_MESSAGE,
  LABEL_GATED_POLICY_MISSING_LABELS_REPAIR_GUIDANCE,
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

interface DependencyRootBlocker {
  issue: GitHubIssue;
  blockedReason: string;
}

export interface ParentIssueClosureCandidate {
  parentIssue: GitHubIssue;
  childIssues: GitHubIssue[];
}

function resolveParentClosureChildIssues(args: {
  issueByNumber: Map<number, GitHubIssue>;
  parentIssue: GitHubIssue;
  explicitChildIssues: GitHubIssue[];
}): GitHubIssue[] {
  const { issueByNumber, parentIssue, explicitChildIssues } = args;
  const fallbackChildIssueNumbers = parseCanonicalEpicChildIssueNumbers(parentIssue.body);
  if (fallbackChildIssueNumbers.length === 0) {
    return explicitChildIssues;
  }

  const fallbackIncludesAllExplicitChildren = explicitChildIssues.every((childIssue) =>
    fallbackChildIssueNumbers.includes(childIssue.number),
  );
  const fallbackChildIssues = fallbackChildIssueNumbers
    .map((childIssueNumber) => issueByNumber.get(childIssueNumber) ?? null);
  const fallbackIsComplete = fallbackChildIssues.every((childIssue) => childIssue !== null);

  if (
    fallbackIsComplete &&
    (explicitChildIssues.length === 0 || fallbackIncludesAllExplicitChildren)
  ) {
    return fallbackChildIssues.filter((childIssue): childIssue is GitHubIssue => childIssue !== null);
  }

  if (explicitChildIssues.length === 0) {
    return [];
  }

  return explicitChildIssues;
}

export function isRecordDoneForSequencing(record: Pick<
  IssueRunRecord,
  "state" | "local_review_head_sha" | "pre_merge_evaluation_outcome"
> | null | undefined): boolean {
  if (!record || record.state !== "done") {
    return false;
  }

  if (record.local_review_head_sha === null && record.pre_merge_evaluation_outcome == null) {
    return true;
  }

  return (
    record.pre_merge_evaluation_outcome === "mergeable" ||
    record.pre_merge_evaluation_outcome === "follow_up_eligible"
  );
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
        reason: formatBlockingReasonWithRoot(
          `depends on #${dependencyNumber}`,
          findStaleReviewBotDependencyRootBlocker(dependencyIssue, issueByNumber, state),
        ),
      };
    }

    const dependencyRecord = state.issues[String(dependencyNumber)];
    if (!isRecordDoneForSequencing(dependencyRecord)) {
      return {
        issue: dependencyIssue,
        reason: formatBlockingReasonWithRoot(
          `depends on #${dependencyNumber}`,
          findStaleReviewBotDependencyRootBlocker(dependencyIssue, issueByNumber, state),
        ),
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
        reason: formatBlockingReasonWithRoot(
          `execution order requires #${predecessor.issue.number} first`,
          findStaleReviewBotDependencyRootBlocker(predecessor.issue, issueByNumber, state),
        ),
      };
    }

    const predecessorRecord = state.issues[String(predecessor.issue.number)];
    if (!isRecordDoneForSequencing(predecessorRecord)) {
      return {
        issue: predecessor.issue,
        reason: formatBlockingReasonWithRoot(
          `execution order requires #${predecessor.issue.number} first`,
          findStaleReviewBotDependencyRootBlocker(predecessor.issue, issueByNumber, state),
        ),
      };
    }
  }

  return null;
}

function formatBlockingReasonWithRoot(reason: string, rootBlocker: DependencyRootBlocker | null): string {
  if (rootBlocker === null) {
    return reason;
  }

  return `${reason} root_blocker=#${rootBlocker.issue.number} blocked_reason=${rootBlocker.blockedReason}`;
}

function findStaleReviewBotDependencyRootBlocker(
  issue: GitHubIssue,
  issueByNumber: Map<number, GitHubIssue>,
  state: SupervisorStateFile,
  visited = new Set<number>(),
): DependencyRootBlocker | null {
  if (visited.has(issue.number)) {
    return null;
  }
  visited.add(issue.number);

  const record = state.issues[String(issue.number)];
  if (record?.state === "blocked" && record.blocked_reason === "stale_review_bot") {
    return {
      issue,
      blockedReason: record.blocked_reason,
    };
  }

  const metadata = parseIssueMetadata(issue);
  for (const dependencyNumber of metadata.dependsOn) {
    const dependencyIssue = issueByNumber.get(dependencyNumber);
    if (!dependencyIssue) {
      continue;
    }

    const dependencyRecord = state.issues[String(dependencyNumber)];
    if (dependencyIssue.state !== "CLOSED" || !isRecordDoneForSequencing(dependencyRecord)) {
      const dependencyRoot = findStaleReviewBotDependencyRootBlocker(
        dependencyIssue,
        issueByNumber,
        state,
        visited,
      );
      if (dependencyRoot) {
        return dependencyRoot;
      }
    }
  }

  if (!metadata.parentIssueNumber || !metadata.executionOrderIndex || metadata.executionOrderIndex <= 1) {
    return null;
  }

  const predecessors = [...issueByNumber.values()]
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
    .sort((left, right) => {
      const leftIndex = left.metadata.executionOrderIndex ?? Number.MAX_SAFE_INTEGER;
      const rightIndex = right.metadata.executionOrderIndex ?? Number.MAX_SAFE_INTEGER;
      return leftIndex - rightIndex;
    });

  for (const predecessor of predecessors) {
    const predecessorRecord = state.issues[String(predecessor.issue.number)];
    if (predecessor.issue.state !== "CLOSED" || !isRecordDoneForSequencing(predecessorRecord)) {
      const predecessorRoot = findStaleReviewBotDependencyRootBlocker(
        predecessor.issue,
        issueByNumber,
        state,
        visited,
      );
      if (predecessorRoot) {
        return predecessorRoot;
      }
    }
  }

  return null;
}

export function findParentIssuesReadyToClose(issues: GitHubIssue[]): ParentIssueClosureCandidate[] {
  const issueByNumber = new Map(issues.map((issue) => [issue.number, issue]));
  const explicitChildIssuesByParent = new Map<number, GitHubIssue[]>();

  for (const issue of issues) {
    const metadata = parseIssueMetadata(issue);
    if (!metadata.parentIssueNumber) {
      continue;
    }

    const siblings = explicitChildIssuesByParent.get(metadata.parentIssueNumber) ?? [];
    siblings.push(issue);
    explicitChildIssuesByParent.set(metadata.parentIssueNumber, siblings);
  }

  const candidateParentIssueNumbers = new Set<number>([
    ...explicitChildIssuesByParent.keys(),
    ...issues.map((issue) => issue.number),
  ]);

  return Array.from(candidateParentIssueNumbers)
    .map((parentIssueNumber) => {
      const parentIssue = issueByNumber.get(parentIssueNumber) ?? null;
      if (!parentIssue) {
        return null;
      }

      const explicitChildIssues = explicitChildIssuesByParent.get(parentIssueNumber) ?? [];
      const childIssues = resolveParentClosureChildIssues({
        issueByNumber,
        parentIssue,
        explicitChildIssues,
      });

      return {
        parentIssue,
        childIssues,
      };
    })
    .filter((candidate): candidate is ParentIssueClosureCandidate => candidate !== null)
    .filter(
      ({ parentIssue, childIssues }) =>
        parentIssue.state === "OPEN" &&
        childIssues.length > 0 &&
        childIssues.every((childIssue) => childIssue.state === "CLOSED"),
    )
    .sort((left, right) => left.parentIssue.number - right.parentIssue.number);
}
