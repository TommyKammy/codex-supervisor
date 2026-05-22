import type { GitHubIssue } from "../core/types";
import type { IssueMetadata } from "./issue-metadata";
import type { RiskyChangeClass } from "./issue-metadata-risky-policy";
import {
  countExecutionOrderDeclarations,
  getSingleMetadataLineValue,
  ISSUE_METADATA_FIELDS,
  ISSUE_METADATA_PATTERNS,
} from "./issue-metadata-contract";

const CHILD_ISSUE_BULLET_PATTERN = /^\s*-\s+#(\d+)\s*$/;

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
  const touchesValue = getSingleMetadataLineValue(body, ISSUE_METADATA_FIELDS.touches);
  return touchesValue ? parseList(touchesValue) : [];
}

export function parseExecutionOrder(
  body: string,
): { executionOrderIndex: number; executionOrderTotal: number } | null {
  if (countExecutionOrderDeclarations(body) !== 1) {
    return null;
  }

  const headingMatch = body.match(ISSUE_METADATA_PATTERNS.executionOrderHeadingValue);
  if (headingMatch) {
    return {
      executionOrderIndex: Number(headingMatch[1]),
      executionOrderTotal: Number(headingMatch[2]),
    };
  }

  const singleLineMatch = body.match(ISSUE_METADATA_PATTERNS.executionOrderLineValue);
  if (!singleLineMatch) {
    return null;
  }

  return {
    executionOrderIndex: Number(singleLineMatch[1]),
    executionOrderTotal: Number(singleLineMatch[2]),
  };
}

export function parseIssueMetadata(issue: GitHubIssue): IssueMetadata {
  const parentMatch = issue.body.match(ISSUE_METADATA_PATTERNS.partOfParseLine);
  const dependsOnValue = getSingleMetadataLineValue(issue.body, ISSUE_METADATA_FIELDS.dependsOn);
  const parallelGroupValue = getSingleMetadataLineValue(issue.body, ISSUE_METADATA_FIELDS.parallelGroup);
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
