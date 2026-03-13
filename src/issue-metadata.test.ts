import test from "node:test";
import assert from "node:assert/strict";
import { findParentIssuesReadyToClose, lintExecutionReadyIssueBody, parseIssueMetadata } from "./issue-metadata";
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

test("parseIssueMetadata accepts both parent issue metadata formats", () => {
  const legacyFormat = createIssue({
    body: "Part of #123",
  });
  const templateFormat = createIssue({
    body: "Part of: #123",
  });

  assert.equal(parseIssueMetadata(legacyFormat).parentIssueNumber, 123);
  assert.equal(parseIssueMetadata(templateFormat).parentIssueNumber, 123);
});

test("findParentIssuesReadyToClose treats both parent metadata formats as the same parent", () => {
  const readyToClose = findParentIssuesReadyToClose([
    createIssue({ number: 123, state: "OPEN" }),
    createIssue({ number: 201, state: "CLOSED", body: "Part of #123" }),
    createIssue({ number: 202, state: "CLOSED", body: "Part of: #123" }),
  ]);

  assert.deepEqual(
    readyToClose.map((candidate) => ({
      parentIssueNumber: candidate.parentIssue.number,
      childIssueNumbers: candidate.childIssues.map((issue) => issue.number),
    })),
    [
      {
        parentIssueNumber: 123,
        childIssueNumbers: [201, 202],
      },
    ],
  );
});

test("parseIssueMetadata accepts both execution order metadata formats", () => {
  const headingFormat = createIssue({
    body: "## Execution order\n2 of 4",
  });
  const singleLineFormat = createIssue({
    body: "Execution order: 3 of 5",
  });

  assert.deepEqual(
    {
      executionOrderIndex: parseIssueMetadata(headingFormat).executionOrderIndex,
      executionOrderTotal: parseIssueMetadata(headingFormat).executionOrderTotal,
    },
    {
      executionOrderIndex: 2,
      executionOrderTotal: 4,
    },
  );
  assert.deepEqual(
    {
      executionOrderIndex: parseIssueMetadata(singleLineFormat).executionOrderIndex,
      executionOrderTotal: parseIssueMetadata(singleLineFormat).executionOrderTotal,
    },
    {
      executionOrderIndex: 3,
      executionOrderTotal: 5,
    },
  );
});

test("lintExecutionReadyIssueBody accepts a complete execution-ready issue body", () => {
  const issue = createIssue({
    body: `## Summary
Add deterministic issue-body linting for execution-ready metadata.

## Scope
- lint execution-ready metadata
- keep output deterministic

Depends on: none
Execution order: 1 of 4

## Acceptance criteria
- valid issues pass linting
- invalid issues report missing metadata

## Verification
- npm test -- src/issue-metadata.test.ts`,
  });

  assert.deepEqual(lintExecutionReadyIssueBody(issue), {
    isExecutionReady: true,
    missingRequired: [],
    missingRecommended: [],
    riskyChangeClasses: [],
    approvedRiskyChangeClasses: [],
  });
});

test("lintExecutionReadyIssueBody reports missing required and recommended metadata deterministically", () => {
  const issue = createIssue({
    body: `## Summary
Add deterministic issue-body linting for execution-ready metadata.`,
  });

  assert.deepEqual(lintExecutionReadyIssueBody(issue), {
    isExecutionReady: false,
    missingRequired: ["scope", "acceptance criteria", "verification"],
    missingRecommended: ["depends on", "execution order"],
    riskyChangeClasses: [],
    approvedRiskyChangeClasses: [],
  });
});

test("lintExecutionReadyIssueBody treats ##Heading without a space as the next section", () => {
  const issue = createIssue({
    body: `## Summary

##Scope
- keep scope content out of summary

## Acceptance criteria
- summary is still missing

## Verification
- npx tsx --test src/issue-metadata.test.ts`,
  });

  assert.deepEqual(lintExecutionReadyIssueBody(issue), {
    isExecutionReady: false,
    missingRequired: ["summary"],
    missingRecommended: ["depends on", "execution order"],
    riskyChangeClasses: [],
    approvedRiskyChangeClasses: [],
  });
});

test("lintExecutionReadyIssueBody requires explicit approval for detected risky auth changes", () => {
  const issue = createIssue({
    title: "Rotate production auth tokens",
    body: `## Summary
Rotate production auth tokens for service-to-service traffic.

## Scope
- update auth token issuance in production

## Acceptance criteria
- production authentication changes are fully implemented

## Verification
- npm test -- src/issue-metadata.test.ts`,
  });

  assert.deepEqual(lintExecutionReadyIssueBody(issue), {
    isExecutionReady: false,
    missingRequired: ["explicit opt-in for auth"],
    missingRecommended: ["depends on", "execution order"],
    riskyChangeClasses: ["auth"],
    approvedRiskyChangeClasses: [],
  });
});

test("lintExecutionReadyIssueBody accepts risky changes with explicit metadata approval", () => {
  const issue = createIssue({
    title: "Update billing webhooks",
    body: `## Summary
Adjust billing webhook handling for invoice retries.

## Scope
- update invoice retry handling

Risky change approval: billing

## Acceptance criteria
- billing retry handling is updated

## Verification
- npm test -- src/issue-metadata.test.ts`,
  });

  assert.deepEqual(lintExecutionReadyIssueBody(issue), {
    isExecutionReady: true,
    missingRequired: [],
    missingRecommended: ["depends on", "execution order"],
    riskyChangeClasses: ["billing"],
    approvedRiskyChangeClasses: ["billing"],
  });
});

test("lintExecutionReadyIssueBody accepts risky changes with explicit approval wording", () => {
  const issue = createIssue({
    title: "Refresh CI workflow cache keys",
    body: `## Summary
Update the GitHub Actions workflow cache keys.

## Scope
- adjust CI workflow cache behavior

This issue is explicitly approved for ci changes.

## Acceptance criteria
- workflow cache behavior is updated

## Verification
- npm test -- src/issue-metadata.test.ts`,
  });

  assert.deepEqual(lintExecutionReadyIssueBody(issue), {
    isExecutionReady: true,
    missingRequired: [],
    missingRecommended: ["depends on", "execution order"],
    riskyChangeClasses: ["ci"],
    approvedRiskyChangeClasses: ["ci"],
  });
});
