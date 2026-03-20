import assert from "node:assert/strict";
import test from "node:test";
import { createIssueLintFixture } from "./supervisor-test-helpers";
import { GitHubIssue } from "../core/types";

test("issue lint reports missing required execution-ready sections deterministically", async () => {
  const { loadIssueLintReport } = await createIssueLintFixture();

  const issue: GitHubIssue = {
    number: 103,
    title: "Incomplete issue",
    body: `## Summary
Issue lint should report missing sections.`,
    createdAt: "2026-03-19T00:00:00Z",
    updatedAt: "2026-03-19T00:00:00Z",
    url: "https://example.test/issues/103",
    state: "OPEN",
  };

  const report = await loadIssueLintReport(issue);

  assert.match(report, /^issue=#103$/m);
  assert.match(report, /^execution_ready=no$/m);
  assert.match(report, /^missing_required=scope, acceptance criteria, verification$/m);
  assert.match(report, /^missing_recommended=depends on, execution order$/m);
});

test("issue lint reports malformed and locally inconsistent scheduling metadata", async () => {
  const { loadIssueLintReport } = await createIssueLintFixture();

  const issue: GitHubIssue = {
    number: 104,
    title: "Invalid metadata issue",
    body: `## Summary
Issue lint should report malformed scheduling metadata.

## Scope
- keep the check local to the authored issue

Part of: #104
Depends on: #104, #105, #105, blocked by #oops
Execution order: 3 of 2
Parallelizable: Later

## Acceptance criteria
- invalid metadata is called out clearly

## Verification
- npx tsx --test src/supervisor/supervisor-diagnostics-issue-lint-metadata.test.ts`,
    createdAt: "2026-03-19T00:00:00Z",
    updatedAt: "2026-03-19T00:00:00Z",
    url: "https://example.test/issues/104",
    state: "OPEN",
  };

  const report = await loadIssueLintReport(issue);

  assert.match(report, /^issue=#104$/m);
  assert.match(report, /^metadata_errors=part of references the issue itself; depends on contains malformed references: #oops; depends on references the issue itself; depends on repeats #105; execution order must be N of M with 1 <= N <= M; parallelizable must be Yes or No$/m);
  assert.match(report, /^high_risk_blocking_ambiguity=none$/m);
});

test("issue lint warns when a child issue depends directly on its epic", async () => {
  const { loadIssueLintReport } = await createIssueLintFixture();

  const issue: GitHubIssue = {
    number: 105,
    title: "Child issue depends on epic",
    body: `## Summary
Issue lint should warn when a child issue depends directly on its epic.

## Scope
- keep the check local to the authored issue

Part of: #900
Depends on: #900, #901
Execution order: 2 of 3
Parallelizable: No

## Acceptance criteria
- issue lint warns about the epic dependency pattern

## Verification
- npx tsx --test src/supervisor/supervisor-diagnostics-issue-lint-metadata.test.ts`,
    createdAt: "2026-03-19T00:00:00Z",
    updatedAt: "2026-03-19T00:00:00Z",
    url: "https://example.test/issues/105",
    state: "OPEN",
  };

  const report = await loadIssueLintReport(issue);

  assert.match(report, /^issue=#105$/m);
  assert.match(
    report,
    /^metadata_errors=depends on duplicates parent epic #900; remove it and keep only real blocking issues$/m,
  );
});
