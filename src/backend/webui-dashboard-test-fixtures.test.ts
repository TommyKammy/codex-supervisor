import assert from "node:assert/strict";
import test from "node:test";
import {
  createDashboardHarness,
  createDashboardServerFixture,
  createDashboardStatusFixture,
} from "./webui-dashboard-test-fixtures";

test("dashboard server fixture builders queue page and selected-issue responses in fetch order", async () => {
  const dashboardServer = createDashboardServerFixture();
  const harness = createDashboardHarness([
    ...dashboardServer.page({
      status: createDashboardStatusFixture({ selectedIssueNumber: 42 }),
    }),
    ...dashboardServer.issue(42),
  ]);
  await harness.flush();

  const selectedIssueBadge = harness.document.getElementById("selected-issue-badge");
  const issueSummary = harness.document.getElementById("issue-summary");
  assert.ok(selectedIssueBadge);
  assert.ok(issueSummary);

  assert.equal(selectedIssueBadge.textContent, "#42");
  assert.match(issueSummary.textContent, /#42 Issue 42/u);
  assert.equal(harness.remainingFetches.length, 0);
});
