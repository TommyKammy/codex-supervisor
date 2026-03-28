import type { GitHubIssue } from "../core/types";
import {
  countExecutionOrderDeclarations,
  countMetadataLineDeclarations,
  getSingleMetadataLineValue,
  parseExecutionOrder,
  parseIssueMetadata,
} from "./issue-metadata-parser";

const PART_OF_LINE_PATTERN = /^\s*(?:-\s+)?Part of\b.*$/im;
const VALID_PART_OF_LINE_PATTERN = /^\s*(?:-\s+)?Part of:?\s+#([1-9]\d*)\s*$/i;

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

  const partOfLine = issue.body.match(PART_OF_LINE_PATTERN)?.[0] ?? null;
  if (partOfLine) {
    const validPartOf = VALID_PART_OF_LINE_PATTERN.test(partOfLine);
    if (!validPartOf) {
      errors.push("part of must reference a single issue as #<number>");
    } else if (metadata.parentIssueNumber === issue.number) {
      errors.push("part of references the issue itself");
    }
  }

  const dependsOnDeclarationCount = countMetadataLineDeclarations(issue.body, "Depends on");
  const dependsOnLine = getSingleMetadataLineValue(issue.body, "Depends on");
  if (dependsOnDeclarationCount > 1) {
    errors.push("depends on must appear exactly once");
  } else if (dependsOnLine !== null) {
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

  const executionOrderDeclarationCount = countExecutionOrderDeclarations(issue.body);
  const executionOrder = parseExecutionOrder(issue.body);
  if (executionOrderDeclarationCount > 1) {
    errors.push("execution order must appear exactly once");
  } else if (executionOrderDeclarationCount === 1) {
    if (
      executionOrder === null ||
      executionOrder.executionOrderIndex < 1 ||
      executionOrder.executionOrderTotal < 1 ||
      executionOrder.executionOrderIndex > executionOrder.executionOrderTotal
    ) {
      errors.push("execution order must be N of M with 1 <= N <= M");
    }
  }

  const parallelizableDeclarationCount = countMetadataLineDeclarations(issue.body, "Parallelizable");
  const parallelizableValue = getSingleMetadataLineValue(issue.body, "Parallelizable");
  if (parallelizableDeclarationCount > 1) {
    errors.push("parallelizable must appear exactly once");
  } else if (parallelizableValue !== null && !/^(?:yes|no)$/i.test(parallelizableValue)) {
    errors.push("parallelizable must be Yes or No");
  }

  return errors;
}
