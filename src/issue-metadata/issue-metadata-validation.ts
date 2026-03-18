import type { GitHubIssue } from "../core/types";
import { parseExecutionOrder, parseIssueMetadata } from "./issue-metadata-parser";

function uniqueNumbers(values: number[]): number[] {
  return Array.from(new Set(values)).sort((left, right) => left - right);
}

function normalizeMalformedDependencyToken(token: string): string {
  const trimmed = token.trim();
  if (trimmed.length === 0) {
    return trimmed;
  }

  const hashReference = trimmed.match(/#[^\s,]+/);
  return hashReference ? hashReference[0] : trimmed;
}

export function validateIssueMetadataSyntax(issue: Pick<GitHubIssue, "number" | "body">): string[] {
  const errors: string[] = [];
  const metadata = parseIssueMetadata(issue as GitHubIssue);

  const partOfLine = issue.body.match(/^\s*Part of\b.*$/im)?.[0] ?? null;
  if (partOfLine) {
    const validPartOf = /^\s*Part of:?\s+#(\d+)\s*$/i.test(partOfLine);
    if (!validPartOf) {
      errors.push("part of must reference a single issue as #<number>");
    } else if (metadata.parentIssueNumber === issue.number) {
      errors.push("part of references the issue itself");
    }
  }

  const dependsOnLine = issue.body.match(/^\s*Depends on:\s*(.+)\s*$/im)?.[1] ?? null;
  if (dependsOnLine) {
    const dependencyTokens = dependsOnLine
      .split(",")
      .map((token) => token.trim())
      .filter((token) => token.length > 0);
    const parsedDependencyNumbers = dependencyTokens
      .map((token) => token.match(/^#([1-9]\d*)$/)?.[1] ?? null)
      .filter((value): value is string => value !== null)
      .map((value) => Number(value));
    const malformedDependencies = dependencyTokens
      .filter((token) => !/^none$/i.test(token) && !/^#([1-9]\d*)$/.test(token))
      .map(normalizeMalformedDependencyToken);

    if (malformedDependencies.length > 0) {
      errors.push(`depends on contains malformed references: ${Array.from(new Set(malformedDependencies)).join(", ")}`);
    }

    if (metadata.dependsOn.includes(issue.number)) {
      errors.push("depends on references the issue itself");
    }

    const repeatedDependencies = uniqueNumbers(
      parsedDependencyNumbers.filter(
        (dependencyNumber, index, dependencies) => dependencies.indexOf(dependencyNumber) !== index,
      ),
    );
    repeatedDependencies.forEach((dependencyNumber) => {
      errors.push(`depends on repeats #${dependencyNumber}`);
    });
  }

  const hasExecutionOrderLine = /^\s*Execution order:\s*.+$/im.test(issue.body);
  const hasExecutionOrderHeading = /^\s*##\s*Execution order\s*$/im.test(issue.body);
  const executionOrder = parseExecutionOrder(issue.body);
  if (hasExecutionOrderLine || hasExecutionOrderHeading) {
    if (
      executionOrder === null ||
      executionOrder.executionOrderIndex < 1 ||
      executionOrder.executionOrderTotal < 1 ||
      executionOrder.executionOrderIndex > executionOrder.executionOrderTotal
    ) {
      errors.push("execution order must be N of M with 1 <= N <= M");
    }
  }

  const parallelizableValue = issue.body.match(/^\s*Parallelizable:\s*(.+)\s*$/im)?.[1] ?? null;
  if (parallelizableValue && !/^(?:yes|no)$/i.test(parallelizableValue.trim())) {
    errors.push("parallelizable must be Yes or No");
  }

  return errors;
}
