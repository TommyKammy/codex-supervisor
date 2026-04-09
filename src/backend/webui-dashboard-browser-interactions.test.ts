import assert from "node:assert/strict";
import test from "node:test";
import {
  registerDashboardDomInteractions,
  wireDashboardEventStream,
  type DashboardEventListenerTargetLike,
} from "./webui-dashboard-browser-interactions";

class ListenerTarget implements DashboardEventListenerTargetLike {
  private readonly listeners = new Map<string, Array<(event: unknown) => unknown>>();

  addEventListener(type: string, listener: (event: unknown) => unknown): void {
    const existing = this.listeners.get(type) ?? [];
    existing.push(listener);
    this.listeners.set(type, existing);
  }

  removeEventListener(type: string, listener: (event: unknown) => unknown): void {
    const existing = this.listeners.get(type) ?? [];
    this.listeners.set(
      type,
      existing.filter((candidate) => candidate !== listener),
    );
  }

  async dispatch(type: string, event: Record<string, unknown> = {}): Promise<void> {
    for (const listener of this.listeners.get(type) ?? []) {
      await listener(event);
    }
  }
}

class MockEventSource extends ListenerTarget {
  static instances: MockEventSource[] = [];
  closed = false;

  constructor(readonly url: string) {
    super();
    MockEventSource.instances.push(this);
  }

  close(): void {
    this.closed = true;
  }

  async dispatch(type: string, data: unknown = {}): Promise<void> {
    await super.dispatch(type, {
      type,
      data: typeof data === "string" ? data : JSON.stringify(data),
    });
  }
}

test("registerDashboardDomInteractions wires button and navigation listeners and tears them down", async () => {
  const issueForm = new ListenerTarget();
  const trackedHistoryToggle = new ListenerTarget();
  const navPanelStatus = new ListenerTarget();
  const runOnceButton = new ListenerTarget();
  const requeueButton = new ListenerTarget();
  const pruneWorkspacesButton = new ListenerTarget();
  const resetJsonStateButton = new ListenerTarget();
  const heroPrimaryButton = new ListenerTarget();
  const heroSecondaryButton = new ListenerTarget();
  const heroTertiaryButton = new ListenerTarget();

  let issueSubmitCount = 0;
  let trackedHistoryCount = 0;
  let openDetailsCount = 0;
  let runOnceCount = 0;
  let requeueCount = 0;
  let pruneCount = 0;
  let resetCount = 0;
  let heroPrimaryCount = 0;
  let heroSecondaryCount = 0;
  let heroTertiaryCount = 0;

  const cleanup = registerDashboardDomInteractions({
    elements: {
      issueForm,
      trackedHistoryToggle,
      navPanelStatus,
      runOnceButton,
      requeueButton,
      pruneWorkspacesButton,
      resetJsonStateButton,
      heroPrimaryButton,
      heroSecondaryButton,
      heroTertiaryButton,
    },
    handleIssueSubmit: async () => {
      issueSubmitCount += 1;
    },
    handleTrackedHistoryToggle: () => {
      trackedHistoryCount += 1;
    },
    openDetailsSection: () => {
      openDetailsCount += 1;
    },
    handleRunOnceClick: async () => {
      runOnceCount += 1;
    },
    handleRequeueClick: async () => {
      requeueCount += 1;
    },
    handlePruneWorkspacesClick: async () => {
      pruneCount += 1;
    },
    handleResetJsonStateClick: async () => {
      resetCount += 1;
    },
    handleHeroPrimaryClick: async () => {
      heroPrimaryCount += 1;
    },
    handleHeroSecondaryClick: async () => {
      heroSecondaryCount += 1;
    },
    handleHeroTertiaryClick: () => {
      heroTertiaryCount += 1;
    },
  });

  await issueForm.dispatch("submit", { preventDefault() {} });
  await trackedHistoryToggle.dispatch("click");
  await navPanelStatus.dispatch("click");
  await runOnceButton.dispatch("click");
  await requeueButton.dispatch("click");
  await pruneWorkspacesButton.dispatch("click");
  await resetJsonStateButton.dispatch("click");
  await heroPrimaryButton.dispatch("click");
  await heroSecondaryButton.dispatch("click");
  await heroTertiaryButton.dispatch("click");

  assert.equal(issueSubmitCount, 1);
  assert.equal(trackedHistoryCount, 1);
  assert.equal(openDetailsCount, 1);
  assert.equal(runOnceCount, 1);
  assert.equal(requeueCount, 1);
  assert.equal(pruneCount, 1);
  assert.equal(resetCount, 1);
  assert.equal(heroPrimaryCount, 1);
  assert.equal(heroSecondaryCount, 1);
  assert.equal(heroTertiaryCount, 1);

  cleanup();

  await issueForm.dispatch("submit", { preventDefault() {} });
  await trackedHistoryToggle.dispatch("click");
  await navPanelStatus.dispatch("click");
  await runOnceButton.dispatch("click");

  assert.equal(issueSubmitCount, 1);
  assert.equal(trackedHistoryCount, 1);
  assert.equal(openDetailsCount, 1);
  assert.equal(runOnceCount, 1);
});

test("wireDashboardEventStream refreshes and reloads the selected issue and supports teardown", async () => {
  MockEventSource.instances.length = 0;
  const pushedEvents: unknown[] = [];
  const pushedTimeline: string[] = [];
  const loadedIssues: number[] = [];
  const state = {
    connectionPhase: "idle",
    selectedIssueNumber: 42,
    loadedIssueNumber: null,
  };
  let renderLiveStateCount = 0;
  let refreshCount = 0;
  let reportedRefreshError = 0;

  const cleanup = wireDashboardEventStream({
    EventSourceCtor: MockEventSource as unknown as new (url: string) => {
      addEventListener(type: string, listener: (event: { type: string; data: string }) => unknown): void;
      removeEventListener(type: string, listener: (event: { type: string; data: string }) => unknown): void;
      close(): void;
    },
    knownEventTypes: ["supervisor.recovery"],
    state,
    renderLiveState: () => {
      renderLiveStateCount += 1;
    },
    pushEvent: (event) => {
      pushedEvents.push(event);
    },
    pushTimeline: (entry) => {
      pushedTimeline.push(`${entry.kind}:${entry.summary}:${entry.commandLabel ?? "none"}`);
    },
    describeTimelineEvent: (event) =>
      typeof event === "object" && event !== null && "type" in event ? String(event.type) : "unknown",
    correlationLabelForEvent: () => "run-once",
    refreshStatusAndDoctor: async () => {
      refreshCount += 1;
    },
    loadIssue: async (issueNumber) => {
      loadedIssues.push(issueNumber);
    },
    reportRefreshError: () => {
      reportedRefreshError += 1;
    },
  });

  const source = MockEventSource.instances[0];
  assert.ok(source);
  assert.equal(source.url, "/api/events");
  assert.equal(state.connectionPhase, "connecting");

  await source.dispatch("open");
  assert.equal(state.connectionPhase, "open");

  await source.dispatch("supervisor.recovery", {
    type: "supervisor.recovery",
    at: "2026-04-09T00:00:00.000Z",
  });

  assert.equal(refreshCount, 1);
  assert.deepEqual(loadedIssues, [42]);
  assert.equal(pushedEvents.length, 1);
  assert.deepEqual(pushedEvents[0], {
    type: "supervisor.recovery",
    at: "2026-04-09T00:00:00.000Z",
  });
  assert.deepEqual(pushedTimeline, ["event:supervisor.recovery:run-once"]);
  assert.equal(reportedRefreshError, 0);

  cleanup();
  assert.equal(source.closed, true);

  await source.dispatch("error");
  await source.dispatch("supervisor.recovery", {
    type: "supervisor.recovery",
    at: "2026-04-09T00:00:01.000Z",
  });

  assert.equal(state.connectionPhase, "open");
  assert.equal(refreshCount, 1);
  assert.equal(renderLiveStateCount, 2);
});
