import test from "node:test";
import assert from "node:assert/strict";
import {
  findHighRiskBlockingAmbiguity,
  findParentIssuesReadyToClose,
  lintExecutionReadyIssueBody,
  parseIssueMetadata,
  validateIssueMetadataSyntax,
} from "./issue-metadata";
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

test("validateIssueMetadataSyntax stays quiet for valid dependency and sequencing metadata", () => {
  const issue = createIssue({
    number: 55,
    body: `Part of: #123
Depends on: none
Execution order: 1 of 4
Parallelizable: No`,
  });

  assert.deepEqual(validateIssueMetadataSyntax(issue), []);
});

test("validateIssueMetadataSyntax reports malformed and self-inconsistent scheduling metadata", () => {
  const issue = createIssue({
    number: 55,
    body: `Part of: #55
Depends on: #55, #77, #77, blocked by #oops
Execution order: 4 of 2
Parallelizable: Later`,
  });

  assert.deepEqual(validateIssueMetadataSyntax(issue), [
    "part of references the issue itself",
    "depends on contains malformed references: #oops",
    "depends on references the issue itself",
    "depends on repeats #77",
    "execution order must be N of M with 1 <= N <= M",
    "parallelizable must be Yes or No",
  ]);
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
- npm test -- src/issue-metadata/issue-metadata.test.ts`,
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

test("lintExecutionReadyIssueBody recommends explicit scope boundaries and verification targets", () => {
  const issue = createIssue({
    body: `## Summary
Improve execution-ready issue guidance.

## Scope
- make the change

## Acceptance criteria
- issue guidance is updated

## Verification
- run tests`,
  });

  assert.deepEqual(lintExecutionReadyIssueBody(issue), {
    isExecutionReady: true,
    missingRequired: [],
    missingRecommended: ["depends on", "execution order", "scope boundary", "verification target"],
    riskyChangeClasses: [],
    approvedRiskyChangeClasses: [],
  });
});

test("lintExecutionReadyIssueBody keeps recommending scope boundaries for multi-bullet in-scope lists", () => {
  const issue = createIssue({
    body: `## Summary
Improve execution-ready issue guidance.

## Scope
- update the template wording
- adjust the lint guidance text

## Acceptance criteria
- issue guidance is updated

## Verification
- \`npx tsx --test src/issue-metadata/issue-metadata.test.ts\``,
  });

  assert.deepEqual(lintExecutionReadyIssueBody(issue), {
    isExecutionReady: true,
    missingRequired: [],
    missingRecommended: ["depends on", "execution order", "scope boundary"],
    riskyChangeClasses: [],
    approvedRiskyChangeClasses: [],
  });
});

test("lintExecutionReadyIssueBody accepts mixed generic and concrete verification steps", () => {
  const issue = createIssue({
    body: `## Summary
Improve execution-ready issue guidance.

## Scope
- update the template wording
- keep the issue body concise

## Acceptance criteria
- issue guidance is updated

## Verification
- run tests
- \`npx tsx --test src/issue-metadata/issue-metadata.test.ts\``,
  });

  assert.deepEqual(lintExecutionReadyIssueBody(issue), {
    isExecutionReady: true,
    missingRequired: [],
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
- npx tsx --test src/issue-metadata/issue-metadata.test.ts`,
  });

  assert.deepEqual(lintExecutionReadyIssueBody(issue), {
    isExecutionReady: false,
    missingRequired: ["summary"],
    missingRecommended: ["depends on", "execution order"],
    riskyChangeClasses: [],
    approvedRiskyChangeClasses: [],
  });
});

test("lintExecutionReadyIssueBody keeps concrete risky auth work execution-ready without special opt-in", () => {
  const issue = createIssue({
    title: "Rotate production auth tokens",
    body: `## Summary
Rotate production auth tokens for service-to-service traffic.

## Scope
- update auth token issuance in production

## Acceptance criteria
- production authentication changes are fully implemented

## Verification
- npm test -- src/issue-metadata/issue-metadata.test.ts`,
  });

  assert.deepEqual(lintExecutionReadyIssueBody(issue), {
    isExecutionReady: true,
    missingRequired: [],
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
- npm test -- src/issue-metadata/issue-metadata.test.ts`,
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
- npm test -- src/issue-metadata/issue-metadata.test.ts`,
  });

  assert.deepEqual(lintExecutionReadyIssueBody(issue), {
    isExecutionReady: true,
    missingRequired: [],
    missingRecommended: ["depends on", "execution order"],
    riskyChangeClasses: ["ci"],
    approvedRiskyChangeClasses: ["ci"],
  });
});

test("lintExecutionReadyIssueBody does not treat generic workflow prose as CI work", () => {
  const issue = createIssue({
    title: "Clarify operator handoff language",
    body: `## Summary
Document CLI-first workflows for operator handoffs.

## Scope
- clarify CLI-first workflows in docs

## Acceptance criteria
- issue prose mentioning workflows alone remains execution-ready

## Verification
- npm test -- src/issue-metadata/issue-metadata.test.ts`,
  });

  assert.deepEqual(lintExecutionReadyIssueBody(issue), {
    isExecutionReady: true,
    missingRequired: [],
    missingRecommended: ["depends on", "execution order"],
    riskyChangeClasses: [],
    approvedRiskyChangeClasses: [],
  });
});

test("lintExecutionReadyIssueBody detects CI work from .github/workflows paths", () => {
  const issue = createIssue({
    title: "Adjust cache restore behavior",
    body: `## Summary
Update .github/workflows/ci.yml to use narrower cache restore keys.

## Scope
- edit the workflow file for cache restore behavior

## Acceptance criteria
- GitHub workflow path changes still require CI opt-in

## Verification
- npm test -- src/issue-metadata/issue-metadata.test.ts`,
  });

  assert.deepEqual(lintExecutionReadyIssueBody(issue), {
    isExecutionReady: true,
    missingRequired: [],
    missingRecommended: ["depends on", "execution order"],
    riskyChangeClasses: ["ci"],
    approvedRiskyChangeClasses: [],
  });
});

test("lintExecutionReadyIssueBody detects CI work from uppercase .GITHUB/WORKFLOWS paths", () => {
  const issue = createIssue({
    title: "Adjust workflow cache restore behavior",
    body: `## Summary
Update .GITHUB/WORKFLOWS/CI.YML to use narrower cache restore keys.

## Scope
- edit the workflow file path reference in issue prose

## Acceptance criteria
- mixed-case GitHub workflow paths still require CI opt-in

## Verification
- npm test -- src/issue-metadata/issue-metadata.test.ts`,
  });

  assert.deepEqual(lintExecutionReadyIssueBody(issue), {
    isExecutionReady: true,
    missingRequired: [],
    missingRecommended: ["depends on", "execution order"],
    riskyChangeClasses: ["ci"],
    approvedRiskyChangeClasses: [],
  });
});

test("lintExecutionReadyIssueBody detects risky changes from Touches metadata", () => {
  const issue = createIssue({
    title: "Update rollout notes",
    body: `## Summary
Update rollout notes for the next deploy.

## Scope
- refresh the deployment notes

Touches: secrets

## Acceptance criteria
- rollout notes are refreshed

## Verification
- npm test -- src/issue-metadata/issue-metadata.test.ts`,
  });

  assert.deepEqual(lintExecutionReadyIssueBody(issue), {
    isExecutionReady: true,
    missingRequired: [],
    missingRecommended: ["depends on", "execution order"],
    riskyChangeClasses: ["secrets"],
    approvedRiskyChangeClasses: [],
  });
});

test("findHighRiskBlockingAmbiguity ignores concrete risky issues without unresolved-risk language", () => {
  const issue = createIssue({
    title: "Rotate production auth tokens",
    body: `## Summary
Rotate production auth tokens for service-to-service traffic.

## Scope
- update auth token issuance in production

## Acceptance criteria
- production authentication changes are fully implemented

## Verification
- npm test -- src/issue-metadata/issue-metadata.test.ts`,
  });

  assert.equal(findHighRiskBlockingAmbiguity(issue), null);
});

test("findHighRiskBlockingAmbiguity blocks unresolved choices in risky auth work", () => {
  const issue = createIssue({
    title: "Decide which production auth token flow to keep",
    body: `## Summary
Decide whether to keep the current production auth token flow or replace it before rollout.

## Scope
- choose the production authentication path for service-to-service traffic

## Acceptance criteria
- the operator confirms which auth flow should ship

## Verification
- npm test -- src/issue-metadata/issue-metadata.test.ts`,
  });

  assert.deepEqual(findHighRiskBlockingAmbiguity(issue), {
    ambiguityClasses: ["unresolved_choice"],
    riskyChangeClasses: ["auth"],
    reason: "high-risk blocking ambiguity (unresolved_choice) for auth changes",
  });
});
