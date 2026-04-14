import type { GitHubIssue } from "../core/types";
import type { IssueMetadata } from "./issue-metadata";
import type { RiskyChangeClass } from "./issue-metadata-risky-policy";

const PART_OF_LINE_PATTERN = /^\s*(?:-\s+)?Part of:?\s+#(\d+)\s*$/im;
const CHILD_ISSUE_BULLET_PATTERN = /^\s*-\s+#(\d+)\s*$/;

function escapeRegExp(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
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

export function parseTouchesList(body: string): string[] {
  const touchesMatch = body.match(/^\s*Touches:\s*(.+)\s*$/im);
  return touchesMatch ? parseList(touchesMatch[1]) : [];
}

export function countMetadataLineDeclarations(body: string, fieldName: string): number {
  return [
    ...body.matchAll(new RegExp(`^\\s*${escapeRegExp(fieldName)}:[^\\r\\n]*$`, "gim")),
  ].length;
}

export function getSingleMetadataLineValue(body: string, fieldName: string): string | null {
  const matches = [
    ...body.matchAll(new RegExp(`^\\s*${escapeRegExp(fieldName)}:[^\\S\\r\\n]*(.*)$`, "gim")),
  ];
  if (matches.length !== 1) {
    return null;
  }

  return matches[0][1].trim();
}

export function countExecutionOrderDeclarations(body: string): number {
  return [
    ...body.matchAll(/^\s*Execution order:[^\r\n]*$/gim),
    ...body.matchAll(/^\s*##\s*Execution order\s*$[\r\n]+^[^\r\n]*$/gim),
  ].length;
}

export function parseExecutionOrder(
  body: string,
): { executionOrderIndex: number; executionOrderTotal: number } | null {
  if (countExecutionOrderDeclarations(body) !== 1) {
    return null;
  }

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
  const parentMatch = issue.body.match(PART_OF_LINE_PATTERN);
  const dependsOnValue = getSingleMetadataLineValue(issue.body, "Depends on");
  const parallelGroupValue = getSingleMetadataLineValue(issue.body, "Parallel group");
  const executionOrder = parseExecutionOrder(issue.body);

  return {
    parentIssueNumber: parentMatch ? Number(parentMatch[1]) : null,
    executionOrderIndex: executionOrder?.executionOrderIndex ?? null,
    executionOrderTotal: executionOrder?.executionOrderTotal ?? null,
    dependsOn: dependsOnValue ? parseIssueNumberList(dependsOnValue) : [],
    parallelGroup: parallelGroupValue ? parallelGroupValue : null,
    touches: parseTouchesList(issue.body),
  };
}

export function parseCanonicalEpicChildIssueNumbers(body: string): number[] {
  const lines = body.split(/\r?\n/);
  const headerIndex = lines.findIndex((line) => /^\s*##\s*Child issues\s*$/i.test(line));
  if (headerIndex === -1) {
    return [];
  }

  const issueNumbers: number[] = [];
  for (const rawLine of lines.slice(headerIndex + 1)) {
    const line = rawLine.trim();
    if (!line) {
      if (issueNumbers.length > 0) {
        break;
      }
      continue;
    }

    if (/^##\s+/i.test(line)) {
      break;
    }

    const match = line.match(CHILD_ISSUE_BULLET_PATTERN);
    if (!match) {
      return [];
    }

    issueNumbers.push(Number(match[1]));
  }

  if (issueNumbers.length === 0) {
    return [];
  }

  return Array.from(new Set(issueNumbers));
}
