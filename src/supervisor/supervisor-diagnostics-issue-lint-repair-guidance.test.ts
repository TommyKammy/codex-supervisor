import assert from "node:assert/strict";
import test from "node:test";
import { createIssueLintFixture } from "./supervisor-test-helpers";
import { GitHubIssue } from "../core/types";

test("issue lint reports repair guidance for missing required execution-ready sections", async () => {
  const { loadIssueLintReport } = await createIssueLintFixture();

  const issue: GitHubIssue = {
    number: 103,
    title: "Incomplete issue",
    body: `## Summary
Issue lint should report missing sections.`,
    createdAt: "2026-03-19T00:00:00Z",
    updatedAt: "2026-03-19T00:00:00Z",
    url: "https://example.test/issues/103",
    labels: [],
    state: "OPEN",
  };

  const report = await loadIssueLintReport(issue);

  assert.match(report, /^issue=#103$/m);
  assert.match(report, /^execution_ready=no$/m);
  assert.match(report, /^missing_required=scope, acceptance criteria, verification$/m);
  assert.match(report, /^missing_recommended=depends on, execution order$/m);
  assert.match(
    report,
    /^repair_guidance_1=Add a `## Scope` section with bullet points describing the in-scope work\.$/m,
  );
  assert.match(
    report,
    /^repair_guidance_2=Add a `## Acceptance criteria` section listing the observable completion checks\.$/m,
  );
  assert.match(
    report,
    /^repair_guidance_3=Add a `## Verification` section with the exact command, test file, or manual check to run\.$/m,
  );
});

test("issue lint reports repair guidance for malformed scheduling metadata", async () => {
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
- npx tsx --test src/supervisor/supervisor-diagnostics-issue-lint-repair-guidance.test.ts`,
    createdAt: "2026-03-19T00:00:00Z",
    updatedAt: "2026-03-19T00:00:00Z",
    url: "https://example.test/issues/104",
    labels: [],
    state: "OPEN",
  };

  const report = await loadIssueLintReport(issue);

  assert.match(report, /^issue=#104$/m);
  assert.match(
    report,
    /^repair_guidance_1=Replace invalid scheduling metadata with valid `Part of: #<number>`, `Depends on: none|#<number>`, `Execution order: N of M`, and `Parallelizable: Yes|No` lines\.$/m,
  );
});
