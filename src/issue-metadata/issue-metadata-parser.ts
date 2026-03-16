import type { GitHubIssue } from "../core/types";
import type { IssueMetadata } from "./issue-metadata";
import type { RiskyChangeClass } from "./issue-metadata-risky-policy";

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

export function parseTouchesList(body: string): string[] {
  const touchesMatch = body.match(/^\s*Touches:\s*(.+)\s*$/im);
  return touchesMatch ? parseList(touchesMatch[1]) : [];
}

export function parseExecutionOrder(
  body: string,
): { executionOrderIndex: number; executionOrderTotal: number } | null {
  const headingMatch = body.match(
    /^\s*##\s*Execution order\s*$[\r\n]+^\s*(\d+)\s+of\s+(\d+)\s*$/im,
  );
  if (headingMatch) {
    return {
      executionOrderIndex: Number(headingMatch[1]),
      executionOrderTotal: Number(headingMatch[2]),
    };
  }

  const singleLineMatch = body.match(/^\s*Execution order:\s*(\d+)\s+of\s+(\d+)\s*$/im);
  if (!singleLineMatch) {
    return null;
  }

  return {
    executionOrderIndex: Number(singleLineMatch[1]),
    executionOrderTotal: Number(singleLineMatch[2]),
  };
}

export function parseIssueMetadata(issue: GitHubIssue): IssueMetadata {
  const parentMatch = issue.body.match(/^\s*Part of:?\s+#(\d+)\s*$/im);
  const dependsOnMatch = issue.body.match(/^\s*Depends on:\s*(.+)\s*$/im);
  const parallelGroupMatch = issue.body.match(/^\s*Parallel group:\s*(.+)\s*$/im);
  const executionOrder = parseExecutionOrder(issue.body);

  return {
    parentIssueNumber: parentMatch ? Number(parentMatch[1]) : null,
    executionOrderIndex: executionOrder?.executionOrderIndex ?? null,
    executionOrderTotal: executionOrder?.executionOrderTotal ?? null,
    dependsOn: dependsOnMatch ? parseIssueNumberList(dependsOnMatch[1]) : [],
    parallelGroup: parallelGroupMatch ? parallelGroupMatch[1].trim() : null,
    touches: parseTouchesList(issue.body),
  };
}
