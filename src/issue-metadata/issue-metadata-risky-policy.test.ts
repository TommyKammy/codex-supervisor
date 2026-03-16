import test from "node:test";
import assert from "node:assert/strict";
import {
  detectRiskyChangeClasses,
  parseRiskyChangeApprovalList,
} from "./issue-metadata-risky-policy";
import { GitHubIssue } from "../core/types";

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

test("detectRiskyChangeClasses reads risky signals from issue metadata and touches", () => {
  const issue = createIssue({
    title: "Refresh rollout notes",
    body: `## Summary
Document the next release checklist.

## Scope
- keep rollout notes aligned with the current release plan

Touches: .github/workflows/ci.yml, secrets

## Acceptance criteria
- rollout notes mention the current release plan

## Verification
- npm test -- src/issue-metadata/issue-metadata-risky-policy.test.ts`,
  });

  assert.deepEqual(detectRiskyChangeClasses(issue), ["ci", "secrets"]);
});
