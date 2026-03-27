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
    title: "Execution-ready codex issue",
    labels: [{ name: "codex" }],
    body: `${executionReadyBody("Issue lint should accept an execution-ready issue.")}

Depends on: none
Execution order: 1 of 1
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
