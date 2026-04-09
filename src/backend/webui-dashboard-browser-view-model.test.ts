import assert from "node:assert/strict";
import test from "node:test";
import {
  buildWorkflowSteps,
  countCandidateIssues,
  describeLoopRuntime,
  formatRefreshTime,
} from "./webui-dashboard-browser-view-model";

test("buildWorkflowSteps marks execute as current when a selected issue is present", () => {
  assert.deepEqual(buildWorkflowSteps({ selectionSummary: { selectedIssueNumber: 42 } }), [
    {
      id: "observe",
      title: "Observe",
      detail: "Connection and freshness checks keep the workspace current.",
      state: "done",
    },
    {
      id: "triage",
      title: "Triage",
      detail: "Queue discovery and reconciliation determine the next candidate.",
      state: "done",
    },
    {
      id: "select",
      title: "Select",
      detail: "No runnable issue is currently waiting for handoff.",
      state: "done",
    },
    {
      id: "execute",
      title: "Execute",
      detail: "Issue #42 is the current active focus.",
      state: "current",
    },
    {
      id: "recover",
      title: "Recover",
      detail: "Recovery remains quiet while runnable work is available.",
      state: "idle",
    },
  ]);
});

test("buildWorkflowSteps surfaces recover as the current step when only blocked issues remain", () => {
  assert.deepEqual(
    buildWorkflowSteps({
      blockedIssues: [{ issueNumber: 93, title: "Needs scope repair", blockedBy: "requirements:scope" }],
    }).map((step) => step.state),
    ["done", "done", "done", "done", "current warn"],
  );
});

test("describeLoopRuntime summarizes running, off, and unknown states", () => {
  assert.deepEqual(describeLoopRuntime({ state: "running" }), {
    modeBadge: "Mode: web + loop running",
    summary: "Loop mode is running on this host",
    chipLabel: "loop running",
    chipTone: "ok",
  });

  assert.deepEqual(describeLoopRuntime({ state: "off" }), {
    modeBadge: "Mode: web only (loop off)",
    summary: "Loop mode is off on this host",
    chipLabel: "loop off",
    chipTone: "ok",
  });

  assert.deepEqual(describeLoopRuntime(null), {
    modeBadge: "Mode: local WebUI",
    summary: "Loop status is unavailable on this host",
    chipLabel: "loop unknown",
    chipTone: "info",
  });
});

test("countCandidateIssues and formatRefreshTime handle missing values predictably", () => {
  assert.equal(countCandidateIssues({ candidateDiscovery: { observedMatchingOpenIssues: 251 } }), "251");
  assert.equal(countCandidateIssues({ candidateDiscovery: { observedMatchingOpenIssues: null } }), "n/a");
  assert.equal(countCandidateIssues({}), "n/a");

  assert.equal(formatRefreshTime(null), "never");
  assert.equal(formatRefreshTime("2026-03-25T01:02:03.000Z"), new Date("2026-03-25T01:02:03.000Z").toLocaleTimeString());
});
