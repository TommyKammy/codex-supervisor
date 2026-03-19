import assert from "node:assert/strict";
import test from "node:test";
import {
  createIssueLintFixture,
} from "./supervisor-test-helpers";
import { GitHubIssue } from "../core/types";

test("issue lint reports high-risk blocking ambiguity distinctly", async () => {
  const { loadIssueLintReport } = await createIssueLintFixture();

  const issue: GitHubIssue = {
    number: 107,
    title: "Decide which production auth token flow to keep",
    body: `## Summary
Decide whether to keep the current production auth token flow or replace it before rollout.

## Scope
- choose the production authentication path for service-to-service traffic
- keep rollout audit-friendly

## Acceptance criteria
- the operator confirms which auth flow should ship

## Verification
- npm test -- src/supervisor/supervisor-diagnostics-issue-lint.test.ts`,
    createdAt: "2026-03-19T00:00:00Z",
    updatedAt: "2026-03-19T00:00:00Z",
    url: "https://example.test/issues/107",
    state: "OPEN",
  };

  const report = await loadIssueLintReport(issue);

  assert.match(report, /^issue=#107$/m);
  assert.match(report, /^execution_ready=yes$/m);
  assert.match(
    report,
    /^high_risk_blocking_ambiguity=high-risk blocking ambiguity \(unresolved_choice\) for auth changes$/m,
  );
  assert.match(
    report,
    /^repair_guidance_1=Rewrite the issue to pick one auth path, remove the unresolved choice, and state the approved outcome explicitly\.$/m,
  );
});
