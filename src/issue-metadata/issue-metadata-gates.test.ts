import test from "node:test";
import assert from "node:assert/strict";
import {
  findHighRiskBlockingAmbiguity,
  lintExecutionReadyIssueBody,
} from "./issue-metadata-gates";
import { GitHubIssue } from "../core/types";

function createIssue(overrides: Partial<GitHubIssue> = {}): GitHubIssue {
  return {
    number: 1,
    title: "Issue",
    body: "",
    createdAt: "2026-03-13T00:00:00Z",
    updatedAt: "2026-03-13T00:00:00Z",
    url: "https://example.com/issues/1",
    labels: [],
    state: "OPEN",
    ...overrides,
  };
}

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
- npm test -- src/issue-metadata/issue-metadata-gates.test.ts`,
  });

  assert.deepEqual(lintExecutionReadyIssueBody(issue), {
    isExecutionReady: true,
    missingRequired: [],
    missingRecommended: [],
    riskyChangeClasses: [],
    approvedRiskyChangeClasses: [],
  });
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
- npm test -- src/issue-metadata/issue-metadata-gates.test.ts`,
  });

  assert.deepEqual(findHighRiskBlockingAmbiguity(issue), {
    ambiguityClasses: ["unresolved_choice"],
    riskyChangeClasses: ["auth"],
    reason: "high-risk blocking ambiguity (unresolved_choice) for auth changes",
  });
});

test("findHighRiskBlockingAmbiguity does not treat normal pick/select implementation text as ambiguity", () => {
  const issue = createIssue({
    title: "Refine auth token parsing",
    body: `## Summary
Pick up the auth token from headers and select the role column during permission checks.

## Scope
- update auth header parsing
- select role column values when building the permission map

## Acceptance criteria
- auth token parsing and permissions lookup are implemented

## Verification
- npm test -- src/issue-metadata/issue-metadata-gates.test.ts`,
  });

  assert.equal(findHighRiskBlockingAmbiguity(issue), null);
});
