import { GitHubIssue } from "../core/types";
import { parseIssueMetadata } from "./issue-metadata";

interface DependencyIssueLookup {
  getIssue(issueNumber: number): Promise<GitHubIssue>;
}

export async function hydrateDependencyIssueInventory(
  github: DependencyIssueLookup,
  initialIssues: GitHubIssue[],
): Promise<GitHubIssue[]> {
  const issueByNumber = new Map(initialIssues.map((issue) => [issue.number, issue]));
  const pendingIssues = [...initialIssues];

  for (let index = 0; index < pendingIssues.length; index += 1) {
    const issue = pendingIssues[index];
    for (const dependencyNumber of parseIssueMetadata(issue).dependsOn) {
      if (issueByNumber.has(dependencyNumber)) {
        continue;
      }

      let dependencyIssue: GitHubIssue;
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
      pendingIssues.push(dependencyIssue);
    }
  }

  return [...issueByNumber.values()];
}
