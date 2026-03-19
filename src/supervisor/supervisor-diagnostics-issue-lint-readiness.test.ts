import assert from "node:assert/strict";
import test from "node:test";
import {
  createIssueLintFixture,
  executionReadyBody,
} from "./supervisor-test-helpers";
import { GitHubIssue } from "../core/types";

test("issue lint reports a complete execution-ready issue as clean", async () => {
  const { loadIssueLintReport } = await createIssueLintFixture();

  const issue: GitHubIssue = {
    number: 102,
    title: "Execution-ready issue",
    body: `${executionReadyBody("Issue lint should accept an execution-ready issue.")}

Part of: #200
Depends on: none
Execution order: 1 of 4
Parallelizable: No`,
    createdAt: "2026-03-19T00:00:00Z",
    updatedAt: "2026-03-19T00:00:00Z",
    url: "https://example.test/issues/102",
    state: "OPEN",
  };

  const report = await loadIssueLintReport(issue);

  assert.match(report, /^issue=#102$/m);
  assert.match(report, /^execution_ready=yes$/m);
  assert.match(report, /^missing_required=none$/m);
  assert.match(report, /^missing_recommended=none$/m);
  assert.match(report, /^metadata_errors=none$/m);
  assert.match(report, /^high_risk_blocking_ambiguity=none$/m);
});

test("issue lint does not flag concrete risky work as blocking ambiguity", async () => {
  const { loadIssueLintReport } = await createIssueLintFixture();

  const issue: GitHubIssue = {
    number: 106,
    title: "Rotate production auth tokens",
    body: `## Summary
Rotate the production auth token flow for service-to-service requests.

## Scope
- update auth token issuance for production services
- keep rollout audit-friendly

## Acceptance criteria
- production authentication changes are fully implemented

## Verification
- npm test -- src/supervisor/supervisor-diagnostics-issue-lint-readiness.test.ts`,
    createdAt: "2026-03-19T00:00:00Z",
    updatedAt: "2026-03-19T00:00:00Z",
    url: "https://example.test/issues/106",
    state: "OPEN",
  };

  const report = await loadIssueLintReport(issue);

  assert.match(report, /^issue=#106$/m);
  assert.match(report, /^execution_ready=yes$/m);
  assert.match(report, /^high_risk_blocking_ambiguity=none$/m);
});
