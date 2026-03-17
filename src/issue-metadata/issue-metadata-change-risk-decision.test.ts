import test from "node:test";
import assert from "node:assert/strict";
import { summarizeChangeRiskDecision } from "./issue-metadata-change-risk-decision";
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

test("summarizeChangeRiskDecision gives issue metadata precedence when it drives a higher verification bar", () => {
  const decision = summarizeChangeRiskDecision({
    issue: createIssue({
      title: "Refresh auth docs",
      body: `## Summary
Document the auth flow.

## Scope
- update the operator guide

Risky changes approved: auth
`,
    }),
    changedFiles: ["docs/auth-flow.md", "src/auth-flow.test.ts"],
  });

  assert.deepEqual(decision, {
    riskyChangeClasses: ["auth"],
    approvedRiskyChangeClasses: ["auth"],
    deterministicChangeClasses: ["docs", "tests"],
    issueMetadataIntensity: "strong",
    changedFilesIntensity: "focused",
    verificationIntensity: "strong",
    higherRiskSource: "issue_metadata",
  });
});

test("summarizeChangeRiskDecision records explicit tie precedence when both sources are equally strong", () => {
  const decision = summarizeChangeRiskDecision({
    issue: createIssue({
      title: "Tighten CI approval handling",
      body: `## Summary
Adjust CI approval handling.

## Scope
- update workflow expectations
`,
    }),
    changedFiles: [".github/workflows/ci.yml"],
  });

  assert.deepEqual(decision, {
    riskyChangeClasses: ["ci"],
    approvedRiskyChangeClasses: [],
    deterministicChangeClasses: ["workflow"],
    issueMetadataIntensity: "strong",
    changedFilesIntensity: "strong",
    verificationIntensity: "strong",
    higherRiskSource: "issue_metadata",
  });
});

test("summarizeChangeRiskDecision keeps deterministic changed files as the driver when issue metadata is not risky", () => {
  const decision = summarizeChangeRiskDecision({
    issue: createIssue({
      title: "Update deployment runbook",
      body: `## Summary
Refresh the rollout steps.

## Scope
- keep the docs aligned
`,
    }),
    changedFiles: ["infra/k8s/deployment.yaml", "docs/runbook.md"],
  });

  assert.deepEqual(decision, {
    riskyChangeClasses: [],
    approvedRiskyChangeClasses: [],
    deterministicChangeClasses: ["docs", "infrastructure"],
    issueMetadataIntensity: "none",
    changedFilesIntensity: "strong",
    verificationIntensity: "strong",
    higherRiskSource: "changed_files",
  });
});
