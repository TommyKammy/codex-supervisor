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
    const validPartOf = /^\s*Part of:?\s+#([1-9]\d*)\s*$/i.test(partOfLine);
    if (!validPartOf) {
      errors.push("part of must reference a single issue as #<number>");
    } else if (metadata.parentIssueNumber === issue.number) {
      errors.push("part of references the issue itself");
    }
  }

  const dependsOnMatch = issue.body.match(/^\s*Depends on:[^\S\r\n]*(.*)$/im);
  if (dependsOnMatch) {
    const dependsOnLine = dependsOnMatch[1].trim();
    if (dependsOnLine.length === 0) {
      errors.push("depends on must be none or comma-separated #<number> references");
    } else {
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

      if (
        metadata.parentIssueNumber !== null &&
        metadata.parentIssueNumber !== issue.number &&
        metadata.dependsOn.includes(metadata.parentIssueNumber)
      ) {
        errors.push(
          `depends on duplicates parent epic #${metadata.parentIssueNumber}; remove it and keep only real blocking issues`,
        );
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
  }

  const hasExecutionOrderLine = /^\s*Execution order:[^\r\n]*$/im.test(issue.body);
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

  const parallelizableMatch = issue.body.match(/^\s*Parallelizable:[^\S\r\n]*(.*)$/im);
  if (parallelizableMatch && !/^(?:yes|no)$/i.test(parallelizableMatch[1].trim())) {
    errors.push("parallelizable must be Yes or No");
  }

  return errors;
}
