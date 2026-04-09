import assert from "node:assert/strict";
import test from "node:test";
import {
  createDashboardHarness,
  createDashboardServerFixture,
  createDashboardStatusFixture,
  FakeElement,
  FakeStorage,
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

test("fake elements reject non-empty innerHTML writes after clearing children", () => {
  const element = new FakeElement("div");
  element.appendChild(new FakeElement("span"));

  assert.throws(
    () => {
      element.innerHTML = "<strong>unsupported</strong>";
    },
    /FakeElement\.innerHTML only supports clearing content/u,
  );
  assert.equal(element.children.length, 0);
  assert.equal(element.textContent, "");
  assert.equal(element.innerHTML, "");
});

test("dashboard harness shares browser globals between top-level context and window", async () => {
  const dashboardServer = createDashboardServerFixture();
  const storage = new FakeStorage();
  const harness = createDashboardHarness([...dashboardServer.page()], { localStorage: storage });
  await harness.flush();

  assert.equal(harness.context.localStorage, storage);
  assert.equal(harness.context.window.localStorage, harness.context.localStorage);
  assert.equal(harness.context.window.document, harness.context.document);
  assert.equal(harness.context.window.fetch, harness.context.fetch);
  assert.equal(harness.context.window.EventSource, harness.context.EventSource);
  assert.equal(harness.context.window.setTimeout, harness.context.setTimeout);
  assert.equal(harness.context.window.clearTimeout, harness.context.clearTimeout);
  assert.equal(harness.context.window.prompt, harness.context.prompt);
  assert.equal(harness.context.window.confirm, harness.context.confirm);
  assert.equal(harness.remainingFetches.length, 0);
});
