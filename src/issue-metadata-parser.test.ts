import test from "node:test";
import assert from "node:assert/strict";
import {
  parseIssueMetadata,
  parseRiskyChangeApprovalList,
} from "./issue-metadata-parser";
import { GitHubIssue } from "./types";

function createIssue(overrides: Partial<GitHubIssue> = {}): GitHubIssue {
  return {
    number: 1,
    title: "Issue",
    body: "",
    createdAt: "2026-03-13T00:00:00Z",
    updatedAt: "2026-03-13T00:00:00Z",
    url: "https://example.com/issues/1",
    state: "OPEN",
    ...overrides,
  };
}

test("parseIssueMetadata preserves dependency and normalization behavior", () => {
  const issue = createIssue({
    body: `Part of: #123
Depends on: #45, #67, #45, ignored, #0
Parallel group: parser-refactor
Touches: src/issue-metadata.ts, src/supervisor.ts

## Execution order
2 of 3`,
  });

  assert.deepEqual(parseIssueMetadata(issue), {
    parentIssueNumber: 123,
    executionOrderIndex: 2,
    executionOrderTotal: 3,
    dependsOn: [45, 67],
    parallelGroup: "parser-refactor",
    touches: ["src/issue-metadata.ts", "src/supervisor.ts"],
  });
});

test("parseRiskyChangeApprovalList preserves approval aliases and normalization", () => {
  const body = `Risky changes approved: billing, unknown, Billing
Risky change opt-in: ci

This issue explicitly authorize auth changes.
This issue explicitly approved for secrets changes.`;

  assert.deepEqual(parseRiskyChangeApprovalList(body), [
    "auth",
    "billing",
    "ci",
    "secrets",
  ]);
});
