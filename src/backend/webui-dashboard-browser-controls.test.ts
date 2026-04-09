import assert from "node:assert/strict";
import test from "node:test";
import { createDashboardControlLayer } from "./webui-dashboard-browser-controls";
import { postMutationJsonWithAuth } from "./webui-browser-script-helpers";

test("createDashboardControlLayer dispatches run-once through the mutation helper and refresh flow", async () => {
  const fetchCalls: Array<{ path: string; method: string; body?: string; headers: Record<string, string> }> = [];
  const timeline: string[] = [];
  const state = {
    selectedIssueNumber: 7,
    loadedIssueNumber: null,
    explain: null,
    status: { phase: "queued" },
    commandInFlight: false,
    commandCorrelation: null,
    commandResult: null,
  };
  let openDetailsCount = 0;
  let renderSelectedIssueCount = 0;
  let renderCommandResultCount = 0;
  let refreshCount = 0;
  const loadedIssues: number[] = [];

  const controls = createDashboardControlLayer({
    postMutationJsonWithAuthImpl: postMutationJsonWithAuth,
    fetchImpl: async (path, init) => {
      fetchCalls.push({ path, method: init.method, body: init.body, headers: init.headers });
      return {
        ok: true,
        status: 200,
        headers: {
          get(name: string): string | null {
            return name.toLowerCase() === "content-type" ? "application/json; charset=utf-8" : null;
          },
        },
        async text(): Promise<string> {
          return JSON.stringify({
            command: "run-once",
            dryRun: false,
            summary: "run-once complete",
          });
        },
      };
    },
    host: { localStorage: null, prompt: () => null },
    mutationAuthStorageKey: "mutation-token",
    mutationAuthHeader: "x-test-auth",
    state,
    elements: { commandStatus: { textContent: "" } },
    openDetailsSection: () => {
      openDetailsCount += 1;
    },
    openFocusedIssueDetails: async () => {},
    refreshStatusAndDoctor: async () => {
      refreshCount += 1;
      state.selectedIssueNumber = 11;
    },
    loadIssue: async (issueNumber) => {
      loadedIssues.push(issueNumber);
    },
    rejectCommand: () => {
      throw new Error("rejectCommand should not be called");
    },
    reportRefreshError: () => {
      throw new Error("reportRefreshError should not be called");
    },
    renderSelectedIssue: () => {
      renderSelectedIssueCount += 1;
    },
    renderCommandResult: () => {
      renderCommandResultCount += 1;
    },
    setText: (element, value) => {
      if (element) {
        element.textContent = value;
      }
    },
    buildInFlightCommandResult: (label) => ({ action: label, outcome: "in_progress" }),
    addCommandGuidance: (result, guidance) => ({ ...(result as Record<string, unknown>), guidance }),
    setCommandCorrelation: () => {},
    pushTimeline: (entry) => {
      timeline.push(`${entry.kind}:${entry.summary}`);
    },
    describeTimelineCommandResult: (result) =>
      typeof result === "object" && result !== null && "command" in result ? String(result.command) : "unknown",
    extendCommandCorrelation: () => {},
    describeCommandSelectionChange: (previousIssueNumber, nextIssueNumber) =>
      `${previousIssueNumber ?? "none"}->${nextIssueNumber ?? "none"}`,
    formatIssueRef: (issueNumber) => (issueNumber === null ? "none" : `#${issueNumber}`),
    buildNextIssueSummary: () => ({}),
    getHeroPrimaryActionConfig: () => ({ mode: "details" }),
    getHeroSecondaryActionConfig: () => ({ mode: "details", hidden: false }),
  });

  await controls.handleRunOnceClick();

  assert.equal(openDetailsCount, 1);
  assert.deepEqual(fetchCalls, [
    {
      path: "/api/commands/run-once",
      method: "POST",
      body: JSON.stringify({ dryRun: false }),
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
    },
  ]);
  assert.equal(refreshCount, 1);
  assert.deepEqual(loadedIssues, [11]);
  assert.match(timeline[0] ?? "", /^command:/u);
  assert.match(timeline[1] ?? "", /^refresh:/u);
  assert.equal(state.commandInFlight, false);
  assert.equal(renderSelectedIssueCount, 2);
  assert.equal(renderCommandResultCount, 2);
});

test("createDashboardControlLayer rejects requeue before issue details are loaded", async () => {
  const rejected: Array<{ label: string; guidance: string; summary: string }> = [];
  const controls = createDashboardControlLayer({
    postMutationJsonWithAuthImpl: postMutationJsonWithAuth,
    fetchImpl: async () => {
      throw new Error("fetch should not be called");
    },
    host: { localStorage: null, prompt: () => null },
    mutationAuthStorageKey: "mutation-token",
    mutationAuthHeader: "x-test-auth",
    state: {
      selectedIssueNumber: null,
      loadedIssueNumber: null,
      explain: null,
      status: null,
      commandInFlight: false,
      commandCorrelation: null,
      commandResult: null,
    },
    elements: {},
    openDetailsSection: () => {},
    openFocusedIssueDetails: async () => {},
    refreshStatusAndDoctor: async () => {},
    loadIssue: async () => {},
    rejectCommand: (label, guidance, summary) => {
      rejected.push({ label, guidance, summary });
    },
    reportRefreshError: () => {},
    renderSelectedIssue: () => {},
    renderCommandResult: () => {},
    setText: () => {},
    buildInFlightCommandResult: () => ({}),
    addCommandGuidance: (result) => result,
    setCommandCorrelation: () => {},
    pushTimeline: () => {},
    describeTimelineCommandResult: () => "",
    extendCommandCorrelation: () => {},
    describeCommandSelectionChange: () => "",
    formatIssueRef: () => "none",
    buildNextIssueSummary: () => ({}),
    getHeroPrimaryActionConfig: () => ({ mode: "details" }),
    getHeroSecondaryActionConfig: () => ({ mode: "details", hidden: false }),
  });

  await controls.handleRequeueClick();

  assert.deepEqual(rejected, [
    {
      label: "requeue",
      guidance: "Load an issue successfully before requeueing.",
      summary: "requeue cancelled",
    },
  ]);
});
