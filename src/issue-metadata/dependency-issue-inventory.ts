import { GitHubIssue } from "../core/types";
import { parseIssueMetadata, validateIssueMetadataSyntax } from "./issue-metadata";

interface DependencyIssueLookup {
  getIssue(issueNumber: number): Promise<GitHubIssue>;
}

export async function hydrateDependencyIssueInventory(
  github: DependencyIssueLookup,
  initialIssues: GitHubIssue[],
  rootIssues: GitHubIssue[] = initialIssues,
): Promise<GitHubIssue[]> {
  const issueByNumber = new Map(initialIssues.map((issue) => [issue.number, issue]));
  const pendingIssues = [...new Map(rootIssues.map((issue) => [issue.number, issue])).values()];
  const scheduledIssueNumbers = new Set(pendingIssues.map((issue) => issue.number));

  for (let index = 0; index < pendingIssues.length; index += 1) {
    const issue = pendingIssues[index];
    if (issue.state === "CLOSED" || validateIssueMetadataSyntax(issue).length > 0) {
      continue;
    }

    for (const dependencyNumber of parseIssueMetadata(issue).dependsOn) {
      let dependencyIssue = issueByNumber.get(dependencyNumber);
      if (!dependencyIssue) {
        try {
          dependencyIssue = await github.getIssue(dependencyNumber);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          throw new Error(
            `Failed to resolve dependency issue #${dependencyNumber} referenced by issue #${issue.number}; ` +
            `refusing to continue without authoritative dependency state: ${message}`,
            { cause: error },
          );
        }

        if (dependencyIssue.number !== dependencyNumber) {
          throw new Error(
            `Dependency lookup for issue #${dependencyNumber} referenced by issue #${issue.number} ` +
            `returned issue #${dependencyIssue.number}; refusing to continue without authoritative dependency state.`,
          );
        }

        issueByNumber.set(dependencyNumber, dependencyIssue);
      }

      if (!scheduledIssueNumbers.has(dependencyNumber)) {
        scheduledIssueNumbers.add(dependencyNumber);
        pendingIssues.push(dependencyIssue);
      }
    }
  }

  return [...issueByNumber.values()];
}
