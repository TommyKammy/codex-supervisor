import assert from "node:assert/strict";
import { setImmediate as waitForTurn } from "node:timers/promises";
import test from "node:test";
import vm from "node:vm";
import { renderSupervisorDashboardHtml } from "./webui-dashboard";
import { DASHBOARD_PANEL_REGISTRY } from "./webui-dashboard-panel-layout";
import { renderSupervisorSetupHtml } from "./webui-setup";

interface MockResponseLike {
  ok: boolean;
  json(): Promise<unknown>;
}

interface FetchCall {
  path: string;
  method: string;
  body: string | null;
}

interface QueuedFetchResponse {
  path: string;
  method?: string;
  body?: string;
  response: MockResponseLike | Promise<MockResponseLike>;
}

interface Deferred<T> {
  promise: Promise<T>;
  resolve(value: T | PromiseLike<T>): void;
  reject(reason?: unknown): void;
}

class FakeStorage {
  private readonly entries = new Map<string, string>();

  getItem(key: string): string | null {
    return this.entries.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.entries.set(key, String(value));
  }

  removeItem(key: string): void {
    this.entries.delete(key);
  }

  clear(): void {
    this.entries.clear();
  }
}

class FakeClassList {
  private readonly names = new Set<string>();

  constructor(private readonly owner: FakeElement) {}

  syncFromString(value: string): void {
    this.names.clear();
    for (const name of value.split(/\s+/u).filter(Boolean)) {
      this.names.add(name);
    }
  }

  add(...names: string[]): void {
    for (const name of names) {
      this.names.add(name);
    }
    this.owner.syncClassName(Array.from(this.names).join(" "));
  }

  remove(...names: string[]): void {
    for (const name of names) {
      this.names.delete(name);
    }
    this.owner.syncClassName(Array.from(this.names).join(" "));
  }

  contains(name: string): boolean {
    return this.names.has(name);
  }
}

class FakeElement {
  readonly children: FakeElement[] = [];
  readonly classList = new FakeClassList(this);
  readonly listeners = new Map<string, Array<(event: unknown) => unknown>>();

  parentElement: FakeElement | null = null;
  value = "";
  disabled = false;
  type = "";

  private classNameValue = "";
  private idValue: string | null;
  private innerHtmlValue = "";
  private textContentValue = "";

  constructor(
    readonly tagName: string,
    id: string | null = null,
    private readonly ownerDocument: FakeDocument | null = null,
  ) {
    this.idValue = id;
  }

  get id(): string | null {
    return this.idValue;
  }

  set id(value: string | null) {
    this.ownerDocument?.unregisterElement(this);
    this.idValue = value;
    this.ownerDocument?.registerElement(this);
  }

  get className(): string {
    return this.classNameValue;
  }

  set className(value: string) {
    this.syncClassName(value);
    this.classList.syncFromString(value);
  }

  get innerHTML(): string {
    return this.innerHtmlValue;
  }

  set innerHTML(value: string) {
    this.innerHtmlValue = value;
    this.textContentValue = "";
    if (value === "") {
      this.children.length = 0;
    }
  }

  get textContent(): string {
    if (this.children.length === 0) {
      return this.textContentValue;
    }
    return [this.textContentValue, ...this.children.map((child) => child.textContent)].join("");
  }

  set textContent(value: string) {
    this.textContentValue = value;
    this.innerHtmlValue = "";
    this.children.length = 0;
  }

  syncClassName(value: string): void {
    this.classNameValue = value;
  }

  appendChild(child: FakeElement): FakeElement {
    if (child.parentElement) {
      const previousIndex = child.parentElement.children.indexOf(child);
      if (previousIndex >= 0) {
        child.parentElement.children.splice(previousIndex, 1);
      }
    }
    child.parentElement = this;
    this.children.push(child);
    return child;
  }

  addEventListener(type: string, listener: (event: unknown) => unknown): void {
    const existing = this.listeners.get(type) ?? [];
    existing.push(listener);
    this.listeners.set(type, existing);
  }

  async dispatch(type: string, event: Record<string, unknown> = {}): Promise<void> {
    for (const listener of this.listeners.get(type) ?? []) {
      await listener(event);
    }
  }
}

class FakeDocument {
  private readonly elements = new Map<string, FakeElement>();

  constructor(ids: string[]) {
    for (const id of ids) {
      this.elements.set(id, new FakeElement("div", id, this));
    }
  }

  registerElement(element: FakeElement): void {
    if (element.id) {
      this.elements.set(element.id, element);
    }
  }

  unregisterElement(element: FakeElement): void {
    if (element.id && this.elements.get(element.id) === element) {
      this.elements.delete(element.id);
    }
  }

  getElementById(id: string): FakeElement | null {
    return this.elements.get(id) ?? null;
  }

  createElement(tagName: string): FakeElement {
    return new FakeElement(tagName, null, this);
  }
}

class MockEventSource {
  static instances: MockEventSource[] = [];
  readonly listeners = new Map<string, Array<(event: { type: string; data: string }) => unknown>>();

  constructor(readonly url: string) {
    MockEventSource.instances.push(this);
  }

  addEventListener(type: string, listener: (event: { type: string; data: string }) => unknown): void {
    const existing = this.listeners.get(type) ?? [];
    existing.push(listener);
    this.listeners.set(type, existing);
  }

  async dispatch(type: string, data: unknown = {}): Promise<void> {
    const event = {
      type,
      data: typeof data === "string" ? data : JSON.stringify(data),
    };
    for (const listener of this.listeners.get(type) ?? []) {
      await listener(event);
    }
  }
}

function createDeferred<T>(): Deferred<T> {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function jsonResponse(body: unknown, statusCode = 200): MockResponseLike {
  return {
    ok: statusCode >= 200 && statusCode < 300,
    async json(): Promise<unknown> {
      return body;
    },
  };
}

function createStatus(args: {
  selectedIssueNumber?: number | null;
  includeWhyLines?: boolean;
  trackedIssues?: Array<{
    issueNumber: number;
    state: string;
    branch: string;
    prNumber: number | null;
    blockedReason: string | null;
  }>;
  blockedIssues?: Array<{
    issueNumber: number;
    title: string;
    blockedBy: string;
  }>;
  runnableIssues?: Array<{
    issueNumber: number;
    title: string;
    readiness: string;
  }>;
  candidateDiscovery?: {
    fetchWindow: number;
    strategy: string;
    truncated: boolean;
    observedMatchingOpenIssues: number | null;
    warning: string | null;
  } | null;
} = {}) {
  const selectedIssueNumber = args.selectedIssueNumber ?? null;
  const includeWhyLines = args.includeWhyLines ?? true;
  return {
    activeIssue: null,
    selectionSummary: {
      selectedIssueNumber,
      selectionReason: selectedIssueNumber === null ? "no_runnable_issue" : "selected",
    },
    trackedIssues: args.trackedIssues ?? [],
    runnableIssues: args.runnableIssues ?? [],
    blockedIssues: args.blockedIssues ?? [],
    reconciliationPhase: null,
    warning: null,
    detailedStatusLines: [],
    readinessLines: [],
    whyLines: includeWhyLines
      ? selectedIssueNumber === null
        ? ["selected_issue=none"]
        : [`selected_issue=#${selectedIssueNumber}`]
      : [],
    candidateDiscoverySummary: null,
    candidateDiscovery: args.candidateDiscovery ?? null,
    reconciliationWarning: null,
  };
}

function createDoctor() {
  return {
    overallStatus: "pass",
    checks: [{ name: "github_auth", status: "pass", summary: "GitHub auth ok." }],
  };
}

function createExplain(issueNumber: number, overrides: Record<string, unknown> = {}) {
  return {
    issueNumber,
    title: "Issue " + issueNumber,
    state: "queued",
    blockedReason: "none",
    runnable: true,
    selectionReason: "selected",
    failureSummary: null,
    lastError: null,
    changeRiskLines: [],
    externalReviewFollowUpSummary: null,
    latestRecoverySummary: null,
    activityContext: null,
    reasons: ["selected"],
    ...overrides,
  };
}

function createIssueLint(issueNumber: number) {
  return {
    issueNumber,
    title: "Issue " + issueNumber,
    executionReady: true,
    missingRequired: [],
    missingRecommended: [],
    metadataErrors: [],
    highRiskBlockingAmbiguity: null,
    repairGuidance: [],
  };
}

function extractInlineScript(html: string): string {
  const match = html.match(/<script>([\s\S]+)<\/script>/u);
  if (!match) {
    throw new Error("Expected the HTML to contain an inline script.");
  }
  return match[1];
}

async function flushAsyncWork(turns = 8): Promise<void> {
  for (let index = 0; index < turns; index += 1) {
    await waitForTurn();
  }
}

function createDashboardHarness(
  queue: QueuedFetchResponse[],
  options: {
    confirm?: () => boolean;
    localStorage?: FakeStorage;
  } = {},
) {
  MockEventSource.instances.length = 0;
  const html = renderSupervisorDashboardHtml();
  return createHtmlHarness(html, queue, options);
}

function createSetupHarness(queue: QueuedFetchResponse[]) {
  const html = renderSupervisorSetupHtml();
  return createHtmlHarness(html, queue);
}

function createHtmlHarness(
  html: string,
  queue: QueuedFetchResponse[],
  options: {
    confirm?: () => boolean;
    localStorage?: FakeStorage;
  } = {},
) {
  MockEventSource.instances.length = 0;
  const ids = Array.from(html.matchAll(/id="([^"]+)"/gu), (match) => match[1]);
  const document = new FakeDocument(ids);
  const overviewGrid = document.getElementById("overview-grid");
  const detailsGrid = document.getElementById("details-grid");
  if (overviewGrid && detailsGrid) {
    for (const panel of DASHBOARD_PANEL_REGISTRY) {
      const panelElement = document.getElementById("panel-" + panel.id);
      if (!panelElement) {
        continue;
      }
      if (panel.section === "overview") {
        overviewGrid.appendChild(panelElement);
        continue;
      }
      detailsGrid.appendChild(panelElement);
    }
  }
  const fetchCalls: FetchCall[] = [];

  const fetch = async (path: string, init?: { method?: string; body?: string }): Promise<MockResponseLike> => {
    const next = queue.shift();
    assert.ok(next, `Unexpected fetch for ${path}`);
    assert.equal(path, next.path);
    assert.equal(init?.method ?? "GET", next.method ?? "GET");
    if (next.body !== undefined) {
      assert.equal(init?.body ?? null, next.body);
    }
    fetchCalls.push({
      path,
      method: init?.method ?? "GET",
      body: init?.body ?? null,
    });
    return await next.response;
  };

  const context = {
    console,
    Date,
    document,
    EventSource: MockEventSource,
    fetch,
    window: {
      confirm: options.confirm ?? (() => true),
      localStorage: options.localStorage ?? new FakeStorage(),
    },
    localStorage: options.localStorage ?? new FakeStorage(),
  };

  vm.runInNewContext(extractInlineScript(html), context);

  return {
    document,
    fetchCalls,
    remainingFetches: queue,
    get eventSource(): MockEventSource | null {
      return MockEventSource.instances[0] ?? null;
    },
    async flush(): Promise<void> {
      await flushAsyncWork();
    },
  };
}

function findChildByText(element: FakeElement, pattern: RegExp): FakeElement | undefined {
  return element.children.find((child) => pattern.test(child.textContent));
}

function joinChildText(element: FakeElement): string {
  return element.children.map((child) => child.textContent).join("\n");
}

function childIds(element: FakeElement): string[] {
  return element.children.map((child) => child.id ?? "");
}

test("dashboard shell renders panels from the typed default layout in the current order", () => {
  const html = renderSupervisorDashboardHtml();

  assert.match(
    html,
    /data-panel-id="status"[\s\S]*data-panel-id="doctor"[\s\S]*data-panel-id="issue-details"[\s\S]*data-panel-id="tracked-history"[\s\S]*data-panel-id="operator-actions"[\s\S]*data-panel-id="live-events"[\s\S]*data-panel-id="operator-timeline"/u,
  );
});

test("dashboard page frames the hero and both panel groups with labeled section chrome", () => {
  const html = renderSupervisorDashboardHtml();

  assert.match(html, /<section class="hero"[\s\S]*<p class="hero-eyebrow">Supervisor workspace<\/p>/u);
  assert.match(html, /<div class="hero-body">[\s\S]*<div class="hero-copy">[\s\S]*<div class="hero-summary">/u);
  assert.match(
    html,
    /id="dashboard-panel-reorder-hint" class="visually-hidden"[\s\S]*Space to pick up a panel[\s\S]*id="dashboard-panel-reorder-status" class="visually-hidden" role="status" aria-live="polite"/u,
  );
  assert.match(
    html,
    /<section class="dashboard-section" aria-labelledby="overview-heading">[\s\S]*<p class="section-kicker">Dashboard lane<\/p>[\s\S]*<h2 id="overview-heading">Overview<\/h2>[\s\S]*<div id="overview-grid" class="grid" aria-label="overview" data-panel-grid="overview">/u,
  );
  assert.match(
    html,
    /<section class="dashboard-section" aria-labelledby="details-heading">[\s\S]*<p class="section-kicker">Dashboard lane<\/p>[\s\S]*<h2 id="details-heading">Operator details<\/h2>[\s\S]*<div id="details-grid" class="grid" aria-label="details" data-panel-grid="details">/u,
  );
});

test("dashboard panel registry exposes a shared shell structure for every panel", () => {
  for (const panel of DASHBOARD_PANEL_REGISTRY) {
    assert.match(panel.markup, /<article id="panel-[^"]+" class="panel" data-panel-id="[^"]+" data-panel-section="[^"]+">[\s\S]*<div class="panel-shell">/u);
    assert.match(
      panel.markup,
      /<div class="panel-header">[\s\S]*<div class="panel-drag-slot">[\s\S]*<button[\s\S]*id="panel-drag-[^"]+"[\s\S]*class="panel-drag-handle"[\s\S]*draggable="true"[\s\S]*aria-label="Reorder [^"]+ panel"[\s\S]*aria-describedby="dashboard-panel-reorder-hint"[\s\S]*aria-keyshortcuts="Space Enter ArrowUp ArrowDown Escape"/u,
    );
    assert.match(panel.markup, /<div class="panel-heading">[\s\S]*<h2>[\s\S]+<\/h2>[\s\S]*<p class="panel-subtitle">[\s\S]+<\/p>/u);
    assert.match(panel.markup, /<div class="panel-body/u);
  }
});

test("dashboard page includes reduced-motion-safe drag polish styles", () => {
  const html = renderSupervisorDashboardHtml();

  assert.match(html, /\.panel\.drop-target \{/u);
  assert.match(html, /\.panel-drag-handle:focus-visible \{/u);
  assert.match(html, /@media \(prefers-reduced-motion: reduce\) \{[\s\S]*transition-duration: 0\.01ms/u);
});

test("dashboard page uses a neutral shell palette instead of the earlier warm dashboard treatment", () => {
  const html = renderSupervisorDashboardHtml();

  assert.match(html, /--bg: #f4f7fb;/u);
  assert.match(html, /--bg-accent: #e3ebf5;/u);
  assert.match(html, /--surface-muted: #f6f9fc;/u);
  assert.match(html, /--accent: #4a5fb4;/u);
  assert.match(
    html,
    /body \{[\s\S]*radial-gradient\(circle at top left, rgba\(74, 95, 180, 0\.09\), transparent 34%\),[\s\S]*radial-gradient\(circle at top right, rgba\(42, 122, 140, 0\.08\), transparent 28%\),[\s\S]*linear-gradient\(180deg, var\(--bg\) 0%, #edf3f9 100%\);/u,
  );
  assert.match(
    html,
    /\.panel-header \{[\s\S]*background: linear-gradient\(180deg, rgba\(249, 251, 255, 0\.94\), rgba\(244, 248, 252, 0\.82\)\);/u,
  );
  assert.doesNotMatch(html, /rgba\(160, 103, 18, 0\.08\)|236, 231, 223|250, 247, 242/u);
});

test("dashboard reorders panels through drag handles without touching backend fetch flow", async () => {
  const harness = createDashboardHarness([
    { path: "/api/status?why=true", response: jsonResponse(createStatus()) },
    { path: "/api/doctor", response: jsonResponse(createDoctor()) },
  ]);
  await harness.flush();

  const overviewGrid = harness.document.getElementById("overview-grid");
  const detailsGrid = harness.document.getElementById("details-grid");
  const operatorTimelineHandle = harness.document.getElementById("panel-drag-operator-timeline");
  const trackedHistoryPanel = harness.document.getElementById("panel-tracked-history");
  const operatorTimelinePanel = harness.document.getElementById("panel-operator-timeline");
  const panelReorderStatus = harness.document.getElementById("dashboard-panel-reorder-status");
  assert.ok(overviewGrid);
  assert.ok(detailsGrid);
  assert.ok(operatorTimelineHandle);
  assert.ok(trackedHistoryPanel);
  assert.ok(operatorTimelinePanel);
  assert.ok(panelReorderStatus);

  assert.deepEqual(childIds(overviewGrid), ["panel-status", "panel-doctor"]);
  assert.deepEqual(childIds(detailsGrid), [
    "panel-issue-details",
    "panel-tracked-history",
    "panel-operator-actions",
    "panel-live-events",
    "panel-operator-timeline",
  ]);

  const dataTransfer = {
    effectAllowed: "",
    dropEffect: "",
    setData() {},
  };

  await operatorTimelineHandle.dispatch("dragstart", { dataTransfer });
  await trackedHistoryPanel.dispatch("dragover", {
    dataTransfer,
    preventDefault() {},
  });
  await trackedHistoryPanel.dispatch("drop", {
    dataTransfer,
    preventDefault() {},
  });
  await operatorTimelineHandle.dispatch("dragend");
  await harness.flush();

  assert.deepEqual(childIds(detailsGrid), [
    "panel-issue-details",
    "panel-operator-timeline",
    "panel-tracked-history",
    "panel-operator-actions",
    "panel-live-events",
  ]);
  assert.equal(operatorTimelinePanel.classList.contains("drag-active"), false);
  assert.equal(panelReorderStatus.textContent, "Moved operator timeline panel before tracked history.");
  assert.deepEqual(
    harness.fetchCalls.map((call) => call.path),
    ["/api/status?why=true", "/api/doctor"],
  );
  assert.equal(harness.remainingFetches.length, 0);
});

test("dashboard restores a reordered panel layout from browser storage after reload", async () => {
  const localStorage = new FakeStorage();
  const firstHarness = createDashboardHarness(
    [
      { path: "/api/status?why=true", response: jsonResponse(createStatus()) },
      { path: "/api/doctor", response: jsonResponse(createDoctor()) },
    ],
    { localStorage },
  );
  await firstHarness.flush();

  const operatorTimelineHandle = firstHarness.document.getElementById("panel-drag-operator-timeline");
  const trackedHistoryPanel = firstHarness.document.getElementById("panel-tracked-history");
  const detailsGrid = firstHarness.document.getElementById("details-grid");
  assert.ok(operatorTimelineHandle);
  assert.ok(trackedHistoryPanel);
  assert.ok(detailsGrid);

  const dataTransfer = {
    effectAllowed: "",
    dropEffect: "",
    setData() {},
  };

  await operatorTimelineHandle.dispatch("dragstart", { dataTransfer });
  await trackedHistoryPanel.dispatch("dragover", {
    dataTransfer,
    preventDefault() {},
  });
  await trackedHistoryPanel.dispatch("drop", {
    dataTransfer,
    preventDefault() {},
  });
  await firstHarness.flush();

  assert.deepEqual(childIds(detailsGrid), [
    "panel-issue-details",
    "panel-operator-timeline",
    "panel-tracked-history",
    "panel-operator-actions",
    "panel-live-events",
  ]);

  const secondHarness = createDashboardHarness(
    [
      { path: "/api/status?why=true", response: jsonResponse(createStatus()) },
      { path: "/api/doctor", response: jsonResponse(createDoctor()) },
    ],
    { localStorage },
  );
  await secondHarness.flush();

  const reloadedDetailsGrid = secondHarness.document.getElementById("details-grid");
  assert.ok(reloadedDetailsGrid);
  assert.deepEqual(childIds(reloadedDetailsGrid), [
    "panel-issue-details",
    "panel-operator-timeline",
    "panel-tracked-history",
    "panel-operator-actions",
    "panel-live-events",
  ]);
});

test("dashboard ignores cross-lane panel drops and keeps the current layout", async () => {
  const harness = createDashboardHarness([
    { path: "/api/status?why=true", response: jsonResponse(createStatus()) },
    { path: "/api/doctor", response: jsonResponse(createDoctor()) },
  ]);
  await harness.flush();

  const overviewGrid = harness.document.getElementById("overview-grid");
  const detailsGrid = harness.document.getElementById("details-grid");
  const statusPanel = harness.document.getElementById("panel-status");
  const operatorTimelineHandle = harness.document.getElementById("panel-drag-operator-timeline");
  const operatorTimelinePanel = harness.document.getElementById("panel-operator-timeline");
  const panelReorderStatus = harness.document.getElementById("dashboard-panel-reorder-status");
  assert.ok(overviewGrid);
  assert.ok(detailsGrid);
  assert.ok(statusPanel);
  assert.ok(operatorTimelineHandle);
  assert.ok(operatorTimelinePanel);
  assert.ok(panelReorderStatus);

  const dataTransfer = {
    effectAllowed: "",
    dropEffect: "",
    setData() {},
  };

  await operatorTimelineHandle.dispatch("dragstart", { dataTransfer });
  await statusPanel.dispatch("dragover", {
    dataTransfer,
    preventDefault() {},
  });
  await statusPanel.dispatch("drop", {
    dataTransfer,
    preventDefault() {},
  });
  await operatorTimelineHandle.dispatch("dragend");
  await harness.flush();

  assert.deepEqual(childIds(overviewGrid), ["panel-status", "panel-doctor"]);
  assert.deepEqual(childIds(detailsGrid), [
    "panel-issue-details",
    "panel-tracked-history",
    "panel-operator-actions",
    "panel-live-events",
    "panel-operator-timeline",
  ]);
  assert.equal(operatorTimelinePanel.classList.contains("drag-active"), false);
  assert.equal(panelReorderStatus.textContent, "Panel reorder cancelled.");
  assert.deepEqual(
    harness.fetchCalls.map((call) => call.path),
    ["/api/status?why=true", "/api/doctor"],
  );
  assert.equal(harness.remainingFetches.length, 0);
});

test("dashboard supports keyboard panel reordering with visible drop-target feedback", async () => {
  const harness = createDashboardHarness([
    { path: "/api/status?why=true", response: jsonResponse(createStatus()) },
    { path: "/api/doctor", response: jsonResponse(createDoctor()) },
  ]);
  await harness.flush();

  const detailsGrid = harness.document.getElementById("details-grid");
  const operatorActionsHandle = harness.document.getElementById("panel-drag-operator-actions");
  const operatorActionsPanel = harness.document.getElementById("panel-operator-actions");
  const trackedHistoryPanel = harness.document.getElementById("panel-tracked-history");
  assert.ok(detailsGrid);
  assert.ok(operatorActionsHandle);
  assert.ok(operatorActionsPanel);
  assert.ok(trackedHistoryPanel);

  await operatorActionsHandle.dispatch("keydown", {
    key: " ",
    preventDefault() {},
  });
  await operatorActionsHandle.dispatch("keydown", {
    key: "ArrowUp",
    preventDefault() {},
  });

  assert.equal(operatorActionsPanel.classList.contains("drag-active"), true);
  assert.equal(trackedHistoryPanel.classList.contains("drop-target"), true);

  await operatorActionsHandle.dispatch("keydown", {
    key: "Enter",
    preventDefault() {},
  });
  await harness.flush();

  assert.deepEqual(childIds(detailsGrid), [
    "panel-issue-details",
    "panel-operator-actions",
    "panel-tracked-history",
    "panel-live-events",
    "panel-operator-timeline",
  ]);
  assert.equal(operatorActionsPanel.classList.contains("drag-active"), false);
  assert.equal(trackedHistoryPanel.classList.contains("drop-target"), false);
  assert.deepEqual(
    harness.fetchCalls.map((call) => call.path),
    ["/api/status?why=true", "/api/doctor"],
  );
});

test("dashboard moves a keyboard-dragged panel down one slot on the first ArrowDown", async () => {
  const harness = createDashboardHarness([
    { path: "/api/status?why=true", response: jsonResponse(createStatus()) },
    { path: "/api/doctor", response: jsonResponse(createDoctor()) },
  ]);
  await harness.flush();

  const detailsGrid = harness.document.getElementById("details-grid");
  const operatorActionsHandle = harness.document.getElementById("panel-drag-operator-actions");
  const operatorActionsPanel = harness.document.getElementById("panel-operator-actions");
  const operatorTimelinePanel = harness.document.getElementById("panel-operator-timeline");
  const liveEventsPanel = harness.document.getElementById("panel-live-events");
  assert.ok(detailsGrid);
  assert.ok(operatorActionsHandle);
  assert.ok(operatorActionsPanel);
  assert.ok(operatorTimelinePanel);
  assert.ok(liveEventsPanel);

  await operatorActionsHandle.dispatch("keydown", {
    key: " ",
    preventDefault() {},
  });
  await operatorActionsHandle.dispatch("keydown", {
    key: "ArrowDown",
    preventDefault() {},
  });

  assert.equal(operatorActionsPanel.classList.contains("drag-active"), true);
  assert.equal(operatorTimelinePanel.classList.contains("drop-target"), true);
  assert.equal(liveEventsPanel.classList.contains("drop-target"), false);

  await operatorActionsHandle.dispatch("keydown", {
    key: "Enter",
    preventDefault() {},
  });
  await harness.flush();

  assert.deepEqual(childIds(detailsGrid), [
    "panel-issue-details",
    "panel-tracked-history",
    "panel-live-events",
    "panel-operator-actions",
    "panel-operator-timeline",
  ]);
  assert.equal(operatorActionsPanel.classList.contains("drag-active"), false);
  assert.equal(operatorTimelinePanel.classList.contains("drop-target"), false);
});

test("dashboard pointer dragstart clears stale keyboard drag state before activating the new panel", async () => {
  const harness = createDashboardHarness([
    { path: "/api/status?why=true", response: jsonResponse(createStatus()) },
    { path: "/api/doctor", response: jsonResponse(createDoctor()) },
  ]);
  await harness.flush();

  const operatorActionsHandle = harness.document.getElementById("panel-drag-operator-actions");
  const operatorTimelineHandle = harness.document.getElementById("panel-drag-operator-timeline");
  const operatorActionsPanel = harness.document.getElementById("panel-operator-actions");
  const operatorTimelinePanel = harness.document.getElementById("panel-operator-timeline");
  const trackedHistoryPanel = harness.document.getElementById("panel-tracked-history");
  const panelReorderStatus = harness.document.getElementById("dashboard-panel-reorder-status");
  assert.ok(operatorActionsHandle);
  assert.ok(operatorTimelineHandle);
  assert.ok(operatorActionsPanel);
  assert.ok(operatorTimelinePanel);
  assert.ok(trackedHistoryPanel);
  assert.ok(panelReorderStatus);

  await operatorActionsHandle.dispatch("keydown", {
    key: " ",
    preventDefault() {},
  });
  await operatorActionsHandle.dispatch("keydown", {
    key: "ArrowUp",
    preventDefault() {},
  });

  const dataTransfer = {
    effectAllowed: "",
    dropEffect: "",
    setData() {},
  };
  await operatorTimelineHandle.dispatch("dragstart", { dataTransfer });

  assert.equal(operatorActionsPanel.classList.contains("drag-active"), false);
  assert.equal(trackedHistoryPanel.classList.contains("drop-target"), false);
  assert.equal(operatorTimelinePanel.classList.contains("drag-active"), true);
  assert.equal(panelReorderStatus.textContent, "Dragging operator timeline panel.");
});

test("dashboard keeps requeue disabled until the selected issue finishes loading", async () => {
  const explainResponse = createDeferred<MockResponseLike>();
  const issueLintResponse = createDeferred<MockResponseLike>();
  const harness = createDashboardHarness([
    { path: "/api/status?why=true", response: jsonResponse(createStatus()) },
    { path: "/api/doctor", response: jsonResponse(createDoctor()) },
    { path: "/api/issues/42/explain", response: explainResponse.promise },
    { path: "/api/issues/42/issue-lint", response: issueLintResponse.promise },
  ]);
  await harness.flush();

  const issueNumberInput = harness.document.getElementById("issue-number-input");
  const issueForm = harness.document.getElementById("issue-form");
  const requeueButton = harness.document.getElementById("requeue-button");
  assert.ok(issueNumberInput);
  assert.ok(issueForm);
  assert.ok(requeueButton);

  issueNumberInput.value = "42";
  const submitPromise = issueForm.dispatch("submit", {
    preventDefault() {},
  });
  await harness.flush();
  assert.equal(requeueButton.disabled, true);

  explainResponse.resolve(jsonResponse(createExplain(42)));
  issueLintResponse.resolve(jsonResponse(createIssueLint(42)));
  await submitPromise;
  await harness.flush();

  assert.equal(requeueButton.disabled, false);
  assert.equal(harness.remainingFetches.length, 0);
});

test("dashboard derives the selected issue from typed status fields without parsing why lines", async () => {
  const harness = createDashboardHarness([
    { path: "/api/status?why=true", response: jsonResponse(createStatus({ selectedIssueNumber: 42, includeWhyLines: false })) },
    { path: "/api/doctor", response: jsonResponse(createDoctor()) },
  ]);
  await harness.flush();

  const selectedIssueBadge = harness.document.getElementById("selected-issue-badge");
  const issueNumberInput = harness.document.getElementById("issue-number-input");
  assert.ok(selectedIssueBadge);
  assert.ok(issueNumberInput);

  assert.equal(selectedIssueBadge.textContent, "#42");
  assert.equal(issueNumberInput.value, "42");
  assert.equal(harness.remainingFetches.length, 0);
});

test("dashboard keeps Summary focused on current state and only shows tracked issue count", async () => {
  const harness = createDashboardHarness([
    {
      path: "/api/status?why=true",
      response: jsonResponse(
        createStatus({
          includeWhyLines: false,
          trackedIssues: [
            {
              issueNumber: 58,
              state: "queued",
              branch: "codex/issue-58",
              prNumber: 58,
              blockedReason: null,
            },
          ],
          blockedIssues: [
            {
              issueNumber: 93,
              title: "Underspecified issue",
              blockedBy: "requirements:scope, acceptance criteria, verification",
            },
          ],
          candidateDiscovery: {
            fetchWindow: 250,
            strategy: "paginated",
            truncated: true,
            observedMatchingOpenIssues: 251,
            warning: "Candidate discovery may be truncated.",
          },
        }),
      ),
    },
    { path: "/api/doctor", response: jsonResponse(createDoctor()) },
  ]);
  await harness.flush();

  const statusLines = harness.document.getElementById("status-lines");
  assert.ok(statusLines);

  assert.match(statusLines.textContent, /tracked issues=1/u);
  assert.doesNotMatch(statusLines.textContent, /tracked issue #58 \[queued\] branch=codex\/issue-58 pr=#58/u);
  assert.match(
    statusLines.textContent,
    /blocked issue #93 Underspecified issue blocked_by=requirements:scope, acceptance criteria, verification/u,
  );
  assert.match(
    statusLines.textContent,
    /candidate discovery fetch_window=250 strategy=paginated truncated=yes observed_matching_open_issues=251/u,
  );
  assert.equal(harness.remainingFetches.length, 0);
});

test("dashboard moves tracked history into a dedicated panel with non-done default and reveal toggle", async () => {
  const harness = createDashboardHarness([
    {
      path: "/api/status?why=true",
      response: jsonResponse(
        createStatus({
          includeWhyLines: false,
          trackedIssues: [
            {
              issueNumber: 58,
              state: "queued",
              branch: "codex/issue-58",
              prNumber: 58,
              blockedReason: "requirements:verification",
            },
            {
              issueNumber: 12,
              state: "done",
              branch: "codex/issue-12",
              prNumber: 12,
              blockedReason: null,
            },
          ],
        }),
      ),
    },
    { path: "/api/doctor", response: jsonResponse(createDoctor()) },
  ]);
  await harness.flush();

  const statusLines = harness.document.getElementById("status-lines");
  const trackedHistoryLines = harness.document.getElementById("tracked-history-lines");
  const trackedHistorySummary = harness.document.getElementById("tracked-history-summary");
  const trackedHistoryToggle = harness.document.getElementById("tracked-history-toggle");
  assert.ok(statusLines);
  assert.ok(trackedHistoryLines);
  assert.ok(trackedHistorySummary);
  assert.ok(trackedHistoryToggle);

  assert.match(statusLines.textContent, /tracked issues=2/u);
  assert.doesNotMatch(statusLines.textContent, /tracked issue #58/u);
  assert.match(trackedHistorySummary.textContent, /showing 1 of 2 tracked issues/u);
  assert.match(
    trackedHistoryLines.textContent,
    /tracked issue #58 \[queued\] branch=codex\/issue-58 pr=#58 blocked_reason=requirements:verification/u,
  );
  assert.doesNotMatch(trackedHistoryLines.textContent, /tracked issue #12 \[done\]/u);
  assert.match(trackedHistoryToggle.textContent, /Show done issues/u);

  await trackedHistoryToggle.dispatch("click");
  await harness.flush();

  assert.match(trackedHistorySummary.textContent, /showing 2 of 2 tracked issues/u);
  assert.match(trackedHistoryLines.textContent, /tracked issue #12 \[done\] branch=codex\/issue-12 pr=#12/u);
  assert.match(trackedHistoryToggle.textContent, /Hide done issues/u);
  assert.equal(harness.remainingFetches.length, 0);
});

test("dashboard lets operators inspect typed runnable and blocked issues without manual number entry", async () => {
  const harness = createDashboardHarness([
    {
      path: "/api/status?why=true",
      response: jsonResponse(
        createStatus({
          includeWhyLines: false,
          trackedIssues: [
            {
              issueNumber: 12,
              state: "done",
              branch: "codex/issue-12",
              prNumber: 12,
              blockedReason: null,
            },
          ],
          runnableIssues: [
            {
              issueNumber: 77,
              title: "Ready for inspection",
              readiness: "ready",
            },
          ],
          blockedIssues: [
            {
              issueNumber: 93,
              title: "Needs scope repair",
              blockedBy: "requirements:scope, verification",
            },
          ],
        }),
      ),
    },
    { path: "/api/doctor", response: jsonResponse(createDoctor()) },
    { path: "/api/issues/93/explain", response: jsonResponse(createExplain(93)) },
    { path: "/api/issues/93/issue-lint", response: jsonResponse(createIssueLint(93)) },
  ]);
  await harness.flush();

  const issueShortcuts = harness.document.getElementById("issue-shortcuts");
  const issueSummary = harness.document.getElementById("issue-summary");
  assert.ok(issueShortcuts);
  assert.ok(issueSummary);

  assert.equal(issueShortcuts.children.length, 2);
  assert.match(joinChildText(issueShortcuts), /#77 runnable ready Ready for inspection/u);
  assert.match(joinChildText(issueShortcuts), /#93 blocked requirements:scope, verification Needs scope repair/u);
  assert.doesNotMatch(joinChildText(issueShortcuts), /#12 tracked done codex\/issue-12 pr=#12/u);

  const blockedIssueButton = findChildByText(issueShortcuts, /#93 blocked/u);
  assert.ok(blockedIssueButton);

  await blockedIssueButton.dispatch("click");
  await harness.flush();

  assert.match(issueSummary.textContent, /#93 Issue 93/u);
  assert.equal(harness.remainingFetches.length, 0);
});

test("dashboard keeps requeue disabled after an issue load fails", async () => {
  const harness = createDashboardHarness([
    { path: "/api/status?why=true", response: jsonResponse(createStatus()) },
    { path: "/api/doctor", response: jsonResponse(createDoctor()) },
    { path: "/api/issues/42/explain", response: jsonResponse({ error: "Explain failed." }, 500) },
    { path: "/api/issues/42/issue-lint", response: jsonResponse(createIssueLint(42)) },
  ]);
  await harness.flush();

  const issueNumberInput = harness.document.getElementById("issue-number-input");
  const issueForm = harness.document.getElementById("issue-form");
  const issueSummary = harness.document.getElementById("issue-summary");
  const requeueButton = harness.document.getElementById("requeue-button");
  assert.ok(issueNumberInput);
  assert.ok(issueForm);
  assert.ok(issueSummary);
  assert.ok(requeueButton);

  issueNumberInput.value = "42";
  await issueForm.dispatch("submit", {
    preventDefault() {},
  });
  await harness.flush();

  assert.equal(requeueButton.disabled, true);
  assert.match(issueSummary.textContent, /Explain failed/u);
  assert.equal(harness.remainingFetches.length, 0);
});

test("dashboard renders typed issue activity context without scraping legacy summary lines", async () => {
  const harness = createDashboardHarness([
    { path: "/api/status?why=true", response: jsonResponse(createStatus()) },
    { path: "/api/doctor", response: jsonResponse(createDoctor()) },
    {
      path: "/api/issues/42/explain",
      response: jsonResponse(
        createExplain(42, {
          externalReviewFollowUpSummary: null,
          latestRecoverySummary: "legacy recovery line that should only be used as fallback",
          activityContext: {
            handoffSummary: "blocker: wait for typed dashboard issue detail rendering",
            localReviewRoutingSummary: null,
            changeClassesSummary: null,
            verificationPolicySummary: "verification_policy intensity=standard driver=changed_files:backend",
            durableGuardrailSummary: "durable_guardrails verifier=committed:.codex/verifier-guardrails.json#1 external_review=none",
            externalReviewFollowUpSummary: "external_review_follow_up unresolved=2 actions=durable_guardrail:1|regression_test:1",
            latestRecovery: {
              issueNumber: 42,
              at: "2026-03-22T00:00:00Z",
              reason: "tracked_pr_head_advanced",
              detail: "resumed issue #42 after tracked PR #42 advanced",
            },
            localReviewSummaryPath: null,
            externalReviewMissesPath: null,
            reviewWaits: [
              {
                kind: "configured_bot_initial_grace_wait",
                status: "active",
                provider: "coderabbit",
                pauseReason: "awaiting_initial_provider_activity",
                recentObservation: "required_checks_green",
                observedAt: "2099-01-01T00:00:30.000Z",
                configuredWaitSeconds: 90,
                waitUntil: "2099-01-01T00:02:00.000Z",
              },
            ],
          },
        }),
      ),
    },
    { path: "/api/issues/42/issue-lint", response: jsonResponse(createIssueLint(42)) },
  ]);
  await harness.flush();

  const issueNumberInput = harness.document.getElementById("issue-number-input");
  const issueForm = harness.document.getElementById("issue-form");
  const issueExplain = harness.document.getElementById("issue-explain");
  assert.ok(issueNumberInput);
  assert.ok(issueForm);
  assert.ok(issueExplain);

  issueNumberInput.value = "42";
  await issueForm.dispatch("submit", {
    preventDefault() {},
  });
  await harness.flush();

  assert.match(issueExplain.textContent, /handoff_summary: blocker: wait for typed dashboard issue detail rendering/u);
  assert.match(issueExplain.textContent, /verification_policy: verification_policy intensity=standard driver=changed_files:backend/u);
  assert.match(issueExplain.textContent, /durable_guardrails: durable_guardrails verifier=committed:.codex\/verifier-guardrails\.json#1 external_review=none/u);
  assert.match(issueExplain.textContent, /follow_up: external_review_follow_up unresolved=2 actions=durable_guardrail:1\|regression_test:1/u);
  assert.match(issueExplain.textContent, /latest_recovery: issue=#42 at=2026-03-22T00:00:00Z reason=tracked_pr_head_advanced detail=resumed issue #42 after tracked PR #42 advanced/u);
  assert.doesNotMatch(issueExplain.textContent, /legacy recovery line that should only be used as fallback/u);
  assert.match(issueExplain.textContent, /Review waitswaits: configured_bot_initial_grace_wait status=active provider=coderabbit/u);
  assert.equal(harness.remainingFetches.length, 0);
});

test("dashboard renders typed issue detail sections for operator context", async () => {
  const harness = createDashboardHarness([
    { path: "/api/status?why=true", response: jsonResponse(createStatus()) },
    { path: "/api/doctor", response: jsonResponse(createDoctor()) },
    {
      path: "/api/issues/42/explain",
      response: jsonResponse(
        createExplain(42, {
          state: "blocked",
          blockedReason: "manual_review",
          runnable: false,
          selectionReason: null,
          reasons: [
            "manual_block manual_review",
            "local_state blocked",
          ],
          failureSummary: "Latest verification failed while waiting for review feedback.",
          lastError: "review status remained unresolved after retry window",
          changeRiskLines: [
            "change_classes backend|tests",
            "verification_policy intensity=standard driver=changed_files:backend",
          ],
          externalReviewFollowUpSummary: null,
          latestRecoverySummary: "legacy recovery line that should only be used as fallback",
          activityContext: {
            handoffSummary: "blocker: wait for typed dashboard issue detail rendering",
            localReviewRoutingSummary: "local_review_routing path=.codex/reviews/issue-42.md follow_up=required",
            changeClassesSummary: "change_classes backend|tests",
            verificationPolicySummary: "verification_policy intensity=standard driver=changed_files:backend",
            durableGuardrailSummary:
              "durable_guardrails verifier=committed:.codex/verifier-guardrails.json#1 external_review=none",
            externalReviewFollowUpSummary:
              "external_review_follow_up unresolved=2 actions=durable_guardrail:1|regression_test:1",
            latestRecovery: {
              issueNumber: 42,
              at: "2026-03-22T00:00:00Z",
              reason: "tracked_pr_head_advanced",
              detail: "resumed issue #42 after tracked PR #42 advanced",
            },
            localReviewSummaryPath: ".codex/reviews/issue-42.md",
            externalReviewMissesPath: ".codex/reviews/issue-42-misses.json",
            reviewWaits: [
              {
                kind: "configured_bot_initial_grace_wait",
                status: "active",
                provider: "coderabbit",
                pauseReason: "awaiting_initial_provider_activity",
                recentObservation: "required_checks_green",
                observedAt: "2099-01-01T00:00:30.000Z",
                configuredWaitSeconds: 90,
                waitUntil: "2099-01-01T00:02:00.000Z",
              },
            ],
          },
        }),
      ),
    },
    { path: "/api/issues/42/issue-lint", response: jsonResponse(createIssueLint(42)) },
  ]);
  await harness.flush();

  const issueNumberInput = harness.document.getElementById("issue-number-input");
  const issueForm = harness.document.getElementById("issue-form");
  const issueExplain = harness.document.getElementById("issue-explain");
  assert.ok(issueNumberInput);
  assert.ok(issueForm);
  assert.ok(issueExplain);

  issueNumberInput.value = "42";
  await issueForm.dispatch("submit", {
    preventDefault() {},
  });
  await harness.flush();

  assert.equal(issueExplain.children.length >= 4, true);
  assert.match(joinChildText(issueExplain), /Selection context/i);
  assert.match(joinChildText(issueExplain), /Review waits/i);
  assert.match(joinChildText(issueExplain), /Latest recovery/i);
  assert.match(joinChildText(issueExplain), /Recent failure/i);

  const reviewWaitSection = findChildByText(issueExplain, /Review waits/i);
  const latestRecoverySection = findChildByText(issueExplain, /Latest recovery/i);
  const selectionContextSection = findChildByText(issueExplain, /Selection context/i);
  assert.ok(reviewWaitSection);
  assert.ok(latestRecoverySection);
  assert.ok(selectionContextSection);
  assert.match(reviewWaitSection.textContent, /coderabbit/u);
  assert.match(latestRecoverySection.textContent, /tracked_pr_head_advanced/u);
  assert.doesNotMatch(latestRecoverySection.textContent, /legacy recovery line that should only be used as fallback/u);
  assert.match(selectionContextSection.textContent, /manual_review/u);
  assert.match(selectionContextSection.textContent, /local_state blocked/u);
  assert.equal(harness.remainingFetches.length, 0);
});

test("dashboard preserves a successful command result when the refresh step fails", async () => {
  const harness = createDashboardHarness([
    { path: "/api/status?why=true", response: jsonResponse(createStatus()) },
    { path: "/api/doctor", response: jsonResponse(createDoctor()) },
    {
      path: "/api/commands/run-once",
      method: "POST",
      body: JSON.stringify({ dryRun: false }),
      response: jsonResponse({
        command: "run-once",
        dryRun: false,
        summary: "run-once complete",
      }),
    },
    { path: "/api/status?why=true", response: jsonResponse({ error: "Status refresh failed." }, 500) },
    { path: "/api/doctor", response: jsonResponse(createDoctor()) },
  ]);
  await harness.flush();

  const runOnceButton = harness.document.getElementById("run-once-button");
  const commandStatus = harness.document.getElementById("command-status");
  const commandResult = harness.document.getElementById("command-result");
  const statusWarning = harness.document.getElementById("status-warning");
  const refreshState = harness.document.getElementById("refresh-state");
  const freshnessState = harness.document.getElementById("freshness-state");
  assert.ok(runOnceButton);
  assert.ok(commandStatus);
  assert.ok(commandResult);
  assert.ok(statusWarning);
  assert.ok(refreshState);
  assert.ok(freshnessState);

  await runOnceButton.dispatch("click");
  await harness.flush();

  assert.equal(commandStatus.textContent, "run-once complete");
  assert.match(commandResult.textContent, /"command": "run-once"/u);
  assert.match(commandResult.textContent, /"summary": "run-once complete"/u);
  assert.match(
    commandResult.textContent,
    /"guidance": "Command completed, but the dashboard refresh failed\. Use the warning above before relying on the visible state\."/u,
  );
  assert.equal(statusWarning.textContent, "/api/status?why=true: Status refresh failed.");
  assert.equal(refreshState.textContent, "failed");
  assert.equal(freshnessState.textContent, "stale");
  assert.equal(harness.remainingFetches.length, 0);
});

test("dashboard shows an in-flight safe command state until the command resolves", async () => {
  const runOnceResponse = createDeferred<MockResponseLike>();
  const harness = createDashboardHarness([
    { path: "/api/status?why=true", response: jsonResponse(createStatus()) },
    { path: "/api/doctor", response: jsonResponse(createDoctor()) },
    {
      path: "/api/commands/run-once",
      method: "POST",
      body: JSON.stringify({ dryRun: false }),
      response: runOnceResponse.promise,
    },
    { path: "/api/status?why=true", response: jsonResponse(createStatus()) },
    { path: "/api/doctor", response: jsonResponse(createDoctor()) },
  ]);
  await harness.flush();

  const runOnceButton = harness.document.getElementById("run-once-button");
  const pruneButton = harness.document.getElementById("prune-workspaces-button");
  const resetButton = harness.document.getElementById("reset-json-state-button");
  const commandStatus = harness.document.getElementById("command-status");
  const commandResult = harness.document.getElementById("command-result");
  assert.ok(runOnceButton);
  assert.ok(pruneButton);
  assert.ok(resetButton);
  assert.ok(commandStatus);
  assert.ok(commandResult);

  const clickPromise = runOnceButton.dispatch("click");
  await harness.flush();

  assert.equal(runOnceButton.disabled, true);
  assert.equal(pruneButton.disabled, true);
  assert.equal(resetButton.disabled, true);
  assert.equal(commandStatus.textContent, "Running run-once...");
  assert.match(commandResult.textContent, /"outcome": "in_progress"/u);
  assert.match(commandResult.textContent, /"summary": "Waiting for run-once to finish\."/u);
  assert.match(
    commandResult.textContent,
    /"guidance": "The dashboard will refresh automatically after the command finishes\."/u,
  );

  runOnceResponse.resolve(
    jsonResponse({
      command: "run-once",
      dryRun: false,
      summary: "run-once complete",
    }),
  );
  await clickPromise;
  await harness.flush();

  assert.equal(commandStatus.textContent, "run-once complete");
  assert.equal(runOnceButton.disabled, false);
  assert.equal(pruneButton.disabled, false);
  assert.equal(resetButton.disabled, false);
  assert.equal(harness.remainingFetches.length, 0);
});

test("dashboard makes live connection and freshness state explicit during SSE reconnects", async () => {
  const harness = createDashboardHarness([
    { path: "/api/status?why=true", response: jsonResponse(createStatus()) },
    { path: "/api/doctor", response: jsonResponse(createDoctor()) },
  ]);
  await harness.flush();

  const connectionState = harness.document.getElementById("connection-state");
  const refreshState = harness.document.getElementById("refresh-state");
  const freshnessState = harness.document.getElementById("freshness-state");
  assert.ok(connectionState);
  assert.ok(refreshState);
  assert.ok(freshnessState);
  assert.ok(harness.eventSource);

  assert.equal(connectionState.textContent, "connecting");
  assert.equal(refreshState.textContent, "idle");
  assert.equal(freshnessState.textContent, "fresh");

  await harness.eventSource.dispatch("open");
  await harness.flush();
  assert.equal(connectionState.textContent, "connected");
  assert.equal(freshnessState.textContent, "fresh");

  await harness.eventSource.dispatch("error");
  await harness.flush();
  assert.equal(connectionState.textContent, "reconnecting");
  assert.equal(freshnessState.textContent, "stale");
  assert.equal(harness.remainingFetches.length, 0);
});

test("dashboard reports a rejected safe command when the operator declines confirmation", async () => {
  const harness = createDashboardHarness(
    [
      { path: "/api/status?why=true", response: jsonResponse(createStatus()) },
      { path: "/api/doctor", response: jsonResponse(createDoctor()) },
    ],
    {
      confirm: () => false,
    },
  );
  await harness.flush();

  const pruneButton = harness.document.getElementById("prune-workspaces-button");
  const commandStatus = harness.document.getElementById("command-status");
  const commandResult = harness.document.getElementById("command-result");
  assert.ok(pruneButton);
  assert.ok(commandStatus);
  assert.ok(commandResult);

  await pruneButton.dispatch("click");
  await harness.flush();

  assert.equal(commandStatus.textContent, "prune-orphaned-workspaces cancelled");
  assert.match(commandResult.textContent, /"outcome": "rejected"/u);
  assert.match(commandResult.textContent, /"summary": "Operator declined confirmation\."/u);
  assert.match(
    commandResult.textContent,
    /"guidance": "No changes were made\. Review the confirmation or prerequisites and retry when ready\."/u,
  );
  assert.equal(harness.fetchCalls.filter((call) => call.path === "/api/commands/prune-orphaned-workspaces").length, 0);
  assert.equal(harness.remainingFetches.length, 0);
});

test("dashboard reports a rejected requeue command before issue details load", async () => {
  const harness = createDashboardHarness([
    { path: "/api/status?why=true", response: jsonResponse(createStatus()) },
    { path: "/api/doctor", response: jsonResponse(createDoctor()) },
  ]);
  await harness.flush();

  const requeueButton = harness.document.getElementById("requeue-button");
  const commandStatus = harness.document.getElementById("command-status");
  const commandResult = harness.document.getElementById("command-result");
  assert.ok(requeueButton);
  assert.ok(commandStatus);
  assert.ok(commandResult);

  await requeueButton.dispatch("click");
  await harness.flush();

  assert.equal(commandStatus.textContent, "requeue cancelled");
  assert.match(commandResult.textContent, /"outcome": "rejected"/u);
  assert.match(commandResult.textContent, /"summary": "Load an issue successfully before requeueing\."/u);
  assert.equal(harness.fetchCalls.filter((call) => call.path === "/api/commands/requeue").length, 0);
  assert.equal(harness.remainingFetches.length, 0);
});

test("dashboard adopts the refreshed selected issue after a command-triggered status change", async () => {
  const harness = createDashboardHarness([
    { path: "/api/status?why=true", response: jsonResponse(createStatus({ selectedIssueNumber: 42 })) },
    { path: "/api/doctor", response: jsonResponse(createDoctor()) },
    { path: "/api/issues/42/explain", response: jsonResponse(createExplain(42)) },
    { path: "/api/issues/42/issue-lint", response: jsonResponse(createIssueLint(42)) },
    {
      path: "/api/commands/run-once",
      method: "POST",
      body: JSON.stringify({ dryRun: false }),
      response: jsonResponse({
        command: "run-once",
        dryRun: false,
        summary: "run-once complete",
      }),
    },
    { path: "/api/status?why=true", response: jsonResponse(createStatus({ selectedIssueNumber: 77 })) },
    { path: "/api/doctor", response: jsonResponse(createDoctor()) },
    { path: "/api/issues/77/explain", response: jsonResponse(createExplain(77)) },
    { path: "/api/issues/77/issue-lint", response: jsonResponse(createIssueLint(77)) },
  ]);
  await harness.flush();

  const runOnceButton = harness.document.getElementById("run-once-button");
  const selectedIssueBadge = harness.document.getElementById("selected-issue-badge");
  const issueNumberInput = harness.document.getElementById("issue-number-input");
  const issueSummary = harness.document.getElementById("issue-summary");
  assert.ok(runOnceButton);
  assert.ok(selectedIssueBadge);
  assert.ok(issueNumberInput);
  assert.ok(issueSummary);

  assert.equal(selectedIssueBadge.textContent, "#42");
  assert.equal(issueNumberInput.value, "42");
  assert.match(issueSummary.textContent, /#42 Issue 42/u);

  await runOnceButton.dispatch("click");
  await harness.flush();

  assert.equal(selectedIssueBadge.textContent, "#77");
  assert.equal(issueNumberInput.value, "77");
  assert.match(issueSummary.textContent, /#77 Issue 77/u);
  assert.equal(harness.remainingFetches.length, 0);
});

test("dashboard correlates command results and subsequent supervisor events in one operator timeline", async () => {
  const harness = createDashboardHarness([
    { path: "/api/status?why=true", response: jsonResponse(createStatus({ selectedIssueNumber: 42 })) },
    { path: "/api/doctor", response: jsonResponse(createDoctor()) },
    { path: "/api/issues/42/explain", response: jsonResponse(createExplain(42)) },
    { path: "/api/issues/42/issue-lint", response: jsonResponse(createIssueLint(42)) },
    {
      path: "/api/commands/run-once",
      method: "POST",
      body: JSON.stringify({ dryRun: false }),
      response: jsonResponse({
        command: "run-once",
        dryRun: false,
        summary: "run-once complete",
      }),
    },
    { path: "/api/status?why=true", response: jsonResponse(createStatus({ selectedIssueNumber: 77 })) },
    { path: "/api/doctor", response: jsonResponse(createDoctor()) },
    { path: "/api/issues/77/explain", response: jsonResponse(createExplain(77)) },
    { path: "/api/issues/77/issue-lint", response: jsonResponse(createIssueLint(77)) },
    { path: "/api/status?why=true", response: jsonResponse(createStatus({ selectedIssueNumber: 77 })) },
    { path: "/api/doctor", response: jsonResponse(createDoctor()) },
    { path: "/api/issues/77/explain", response: jsonResponse(createExplain(77)) },
    { path: "/api/issues/77/issue-lint", response: jsonResponse(createIssueLint(77)) },
  ]);
  await harness.flush();

  const runOnceButton = harness.document.getElementById("run-once-button");
  const operatorTimeline = harness.document.getElementById("operator-timeline");
  assert.ok(runOnceButton);
  assert.ok(operatorTimeline);
  assert.ok(harness.eventSource);

  await runOnceButton.dispatch("click");
  await harness.flush();

  assert.match(joinChildText(operatorTimeline), /run-once complete/u);
  assert.match(joinChildText(operatorTimeline), /selected issue #42 -> #77/u);

  await harness.eventSource.dispatch("supervisor.active_issue.changed", {
    type: "supervisor.active_issue.changed",
    family: "active_issue",
    issueNumber: 77,
    previousIssueNumber: 42,
    nextIssueNumber: 77,
    reason: "reserved_for_cycle",
    at: "2026-03-22T00:01:00.000Z",
  });
  await harness.flush();

  const timelineText = joinChildText(operatorTimeline);
  assert.match(timelineText, /active issue reserved for cycle: #42 -> #77/u);
  assert.match(timelineText, /after run-once/u);
  assert.equal(harness.remainingFetches.length, 0);
});

test("dashboard enriches requeue commands with typed recovery and refresh context in the operator timeline", async () => {
  const harness = createDashboardHarness([
    { path: "/api/status?why=true", response: jsonResponse(createStatus({ selectedIssueNumber: 42 })) },
    { path: "/api/doctor", response: jsonResponse(createDoctor()) },
    { path: "/api/issues/42/explain", response: jsonResponse(createExplain(42, { state: "blocked" })) },
    { path: "/api/issues/42/issue-lint", response: jsonResponse(createIssueLint(42)) },
    {
      path: "/api/commands/requeue",
      method: "POST",
      body: JSON.stringify({ issueNumber: 42 }),
      response: jsonResponse({
        action: "requeue",
        issueNumber: 42,
        outcome: "mutated",
        summary: "Requeued issue #42.",
        previousState: "blocked",
        previousRecordSnapshot: null,
        nextState: "queued",
        recoveryReason: "operator_requested",
      }),
    },
    { path: "/api/status?why=true", response: jsonResponse(createStatus({ selectedIssueNumber: 42 })) },
    { path: "/api/doctor", response: jsonResponse(createDoctor()) },
    { path: "/api/issues/42/explain", response: jsonResponse(createExplain(42, { state: "queued" })) },
    { path: "/api/issues/42/issue-lint", response: jsonResponse(createIssueLint(42)) },
    { path: "/api/status?why=true", response: jsonResponse(createStatus({ selectedIssueNumber: 42 })) },
    { path: "/api/doctor", response: jsonResponse(createDoctor()) },
    { path: "/api/issues/42/explain", response: jsonResponse(createExplain(42, { state: "queued" })) },
    { path: "/api/issues/42/issue-lint", response: jsonResponse(createIssueLint(42)) },
  ]);
  await harness.flush();

  const requeueButton = harness.document.getElementById("requeue-button");
  const operatorTimeline = harness.document.getElementById("operator-timeline");
  assert.ok(requeueButton);
  assert.ok(operatorTimeline);
  assert.ok(harness.eventSource);

  await requeueButton.dispatch("click");
  await harness.flush();

  const timelineText = joinChildText(operatorTimeline);
  assert.match(timelineText, /requeue issue #42 blocked -> queued \(operator requested\)/u);
  assert.match(timelineText, /selected issue unchanged \(#42\)/u);

  await harness.eventSource.dispatch("supervisor.recovery", {
    type: "supervisor.recovery",
    family: "recovery",
    issueNumber: 42,
    reason: "operator_requested",
    at: "2026-03-22T00:02:00.000Z",
  });
  await harness.flush();

  assert.match(joinChildText(operatorTimeline), /recovery issue #42: operator requested/u);
  assert.match(joinChildText(operatorTimeline), /after requeue/u);
  assert.equal(harness.remainingFetches.length, 0);
});

test("setup shell loads typed setup readiness without mixing in dashboard status endpoints", async () => {
  const harness = createSetupHarness([
    {
      path: "/api/setup-readiness",
      response: jsonResponse({
        kind: "setup_readiness",
        ready: false,
        overallStatus: "missing",
        configPath: "/tmp/supervisor.config.json",
        fields: [
          {
            key: "repoPath",
            label: "Repository path",
            state: "configured",
            value: "/tmp/repo",
            message: "Repository path is configured.",
            required: true,
            metadata: {
              source: "config",
              editable: true,
              valueType: "directory_path",
            },
          },
          {
            key: "reviewProvider",
            label: "Review provider",
            state: "missing",
            value: null,
            message: "Configure at least one review provider before first-run setup is complete.",
            required: true,
            metadata: {
              source: "config",
              editable: true,
              valueType: "review_provider",
            },
          },
          {
            key: "sessionName",
            label: "Session name",
            state: "missing",
            value: null,
            message: "Session name is optional.",
            required: false,
          },
        ],
        blockers: [
          {
            code: "missing_review_provider",
            message: "Configure at least one review provider before first-run setup is complete.",
            fieldKeys: ["reviewProvider"],
            remediation: {
              kind: "configure_review_provider",
              summary: "Configure at least one review provider before first-run setup is complete.",
              fieldKeys: ["reviewProvider"],
            },
          },
        ],
        hostReadiness: {
          overallStatus: "pass",
          checks: [{
            name: "github_auth",
            status: "pass",
            summary: "GitHub auth ok.",
            details: ["Authenticated as octocat."],
          }],
        },
        providerPosture: {
          profile: "none",
          provider: "none",
          reviewers: [],
          signalSource: "none",
          configured: false,
          summary: "No review provider is configured.",
        },
        trustPosture: {
          trustMode: "trusted_repo_and_authors",
          executionSafetyMode: "unsandboxed_autonomous",
          warning: "Unsandboxed autonomous execution assumes trusted GitHub-authored inputs.",
          summary: "Trusted inputs with unsandboxed autonomous execution.",
        },
      }),
    },
  ]);
  await harness.flush();

  assert.deepEqual(
    harness.fetchCalls.map((call) => call.path),
    ["/api/setup-readiness"],
  );
  assert.match(harness.document.getElementById("setup-overall-caption")?.textContent ?? "", /Resolve blockers before relying on steady-state dashboard actions\./u);
  assert.match(harness.document.getElementById("setup-summary")?.textContent ?? "", /Config path: \/tmp\/supervisor\.config\.json/u);
  assert.match(harness.document.getElementById("setup-blocker-summary")?.textContent ?? "", /1 blocking condition needs attention before first-run setup is complete\./u);
  assert.match(harness.document.getElementById("setup-blockers")?.textContent ?? "", /Configure at least one review provider before first-run setup is complete\./u);
  assert.match(harness.document.getElementById("setup-blockers")?.textContent ?? "", /Blocker code: missing review provider/u);
  assert.match(harness.document.getElementById("setup-blockers")?.textContent ?? "", /Suggested remediation: Configure at least one review provider before first-run setup is complete\./u);
  assert.match(harness.document.getElementById("setup-field-summary")?.textContent ?? "", /1 of 2 required setup fields configured\./u);
  assert.match(harness.document.getElementById("setup-fields")?.textContent ?? "", /Repository path \[Configured\].*Current value: \/tmp\/repo.*Type: directory path.*Repository path is configured\./u);
  assert.match(harness.document.getElementById("setup-fields")?.textContent ?? "", /Review provider \[Missing\].*Current value: Unset.*Type: review provider.*Configure at least one review provider before first-run setup is complete\./u);
  assert.match(harness.document.getElementById("setup-fields")?.textContent ?? "", /Session name \[Missing\].*Current value: Unset.*Required: no \| Source: unknown \| Type: unknown.*Session name is optional\./u);
  assert.match(harness.document.getElementById("setup-host-summary")?.textContent ?? "", /Overall host readiness: Pass across 1 check\./u);
  assert.match(harness.document.getElementById("setup-host-checks")?.textContent ?? "", /Github Auth \[Pass\].*GitHub auth ok\..*Detail: Authenticated as octocat\./u);
  assert.match(harness.document.getElementById("setup-provider-posture")?.textContent ?? "", /No review provider is configured\./u);
  assert.match(harness.document.getElementById("setup-provider-details")?.textContent ?? "", /Provider profile: None.*Signal source: none.*Configured reviewers: none.*Configured: no/u);
  assert.match(harness.document.getElementById("setup-trust-details")?.textContent ?? "", /Trust mode: Trusted Repo And Authors.*Execution safety: Unsandboxed Autonomous.*Warning: Unsandboxed autonomous execution assumes trusted GitHub-authored inputs\./u);
  assert.equal(harness.remainingFetches.length, 0);
});

test("setup shell saves through the narrow setup config API and revalidates readiness after the write", async () => {
  const setupConfigResponse = createDeferred<MockResponseLike>();
  const setupReadinessRefreshResponse = createDeferred<MockResponseLike>();
  const harness = createSetupHarness([
    {
      path: "/api/setup-readiness",
      response: jsonResponse({
        kind: "setup_readiness",
        ready: false,
        overallStatus: "missing",
        configPath: "/tmp/supervisor.config.json",
        fields: [
          {
            key: "repoPath",
            label: "Repository path",
            state: "missing",
            value: null,
            message: "Repository path is required before first-run setup is complete.",
            required: true,
            metadata: {
              source: "config",
              editable: true,
              valueType: "directory_path",
            },
          },
          {
            key: "reviewProvider",
            label: "Review provider",
            state: "missing",
            value: null,
            message: "Configure at least one review provider before first-run setup is complete.",
            required: true,
            metadata: {
              source: "config",
              editable: true,
              valueType: "review_provider",
            },
          },
        ],
        blockers: [
          {
            code: "missing_repo_path",
            message: "Repository path is required before first-run setup is complete.",
            fieldKeys: ["repoPath"],
            remediation: {
              kind: "edit_config",
              summary: "Set repoPath in the supervisor config.",
              fieldKeys: ["repoPath"],
            },
          },
          {
            code: "missing_review_provider",
            message: "Configure at least one review provider before first-run setup is complete.",
            fieldKeys: ["reviewProvider"],
            remediation: {
              kind: "configure_review_provider",
              summary: "Configure at least one review provider before first-run setup is complete.",
              fieldKeys: ["reviewProvider"],
            },
          },
        ],
        hostReadiness: {
          overallStatus: "pass",
          checks: [],
        },
        providerPosture: {
          profile: "none",
          provider: "none",
          reviewers: [],
          signalSource: "none",
          configured: false,
          summary: "No review provider is configured.",
        },
        trustPosture: {
          trustMode: "trusted_repo_and_authors",
          executionSafetyMode: "unsandboxed_autonomous",
          warning: null,
          summary: "Trusted inputs with unsandboxed autonomous execution.",
        },
      }),
    },
    {
      path: "/api/setup-config",
      method: "POST",
      body: JSON.stringify({
        changes: {
          repoPath: "/tmp/repo",
          reviewProvider: "codex",
        },
      }),
      response: setupConfigResponse.promise,
    },
    {
      path: "/api/setup-readiness",
      response: setupReadinessRefreshResponse.promise,
    },
  ]);
  await harness.flush();

  const repoPathInput = harness.document.getElementById("setup-input-repoPath");
  const reviewProviderInput = harness.document.getElementById("setup-input-reviewProvider");
  const setupForm = harness.document.getElementById("setup-form");
  const saveButton = harness.document.getElementById("setup-save-button");
  const saveStatus = harness.document.getElementById("setup-save-status");
  assert.ok(repoPathInput);
  assert.ok(reviewProviderInput);
  assert.ok(setupForm);
  assert.ok(saveButton);
  assert.ok(saveStatus);

  repoPathInput.value = "/tmp/repo";
  reviewProviderInput.value = "codex";
  const submitPromise = setupForm.dispatch("submit", {
    preventDefault() {},
  });
  await harness.flush();

  assert.equal(saveButton.disabled, true);
  assert.match(saveStatus.textContent, /Saving setup changes\.\.\./u);

  setupConfigResponse.resolve(jsonResponse({
    kind: "setup_config_update",
    configPath: "/tmp/supervisor.config.json",
    backupPath: null,
    updatedFields: ["repoPath", "reviewProvider"],
    document: {
      repoPath: "/tmp/repo",
      reviewBotLogins: ["chatgpt-codex-connector"],
    },
    readiness: {
      kind: "setup_readiness",
      ready: false,
      overallStatus: "missing",
      configPath: "/tmp/supervisor.config.json",
      fields: [],
      blockers: [],
      hostReadiness: { overallStatus: "pass", checks: [] },
      providerPosture: {
        profile: "codex",
        provider: "codex",
        reviewers: ["chatgpt-codex-connector"],
        signalSource: "review_bot_logins",
        configured: true,
        summary: "Codex Connector is configured.",
      },
      trustPosture: {
        trustMode: "trusted_repo_and_authors",
        executionSafetyMode: "unsandboxed_autonomous",
        warning: null,
        summary: "Trusted inputs with unsandboxed autonomous execution.",
      },
    },
  }));
  await harness.flush();

  assert.equal(saveButton.disabled, true);
  assert.match(saveStatus.textContent, /Revalidating setup readiness\.\.\./u);

  setupReadinessRefreshResponse.resolve(jsonResponse({
    kind: "setup_readiness",
    ready: true,
    overallStatus: "configured",
    configPath: "/tmp/supervisor.config.json",
    fields: [
      {
        key: "repoPath",
        label: "Repository path",
        state: "configured",
        value: "/tmp/repo",
        message: "Repository path is configured.",
        required: true,
        metadata: {
          source: "config",
          editable: true,
          valueType: "directory_path",
        },
      },
      {
        key: "reviewProvider",
        label: "Review provider",
        state: "configured",
        value: "chatgpt-codex-connector",
        message: "Review provider posture is configured.",
        required: true,
        metadata: {
          source: "config",
          editable: true,
          valueType: "review_provider",
        },
      },
    ],
    blockers: [],
    hostReadiness: {
      overallStatus: "pass",
      checks: [],
    },
    providerPosture: {
      profile: "codex",
      provider: "codex",
      reviewers: ["chatgpt-codex-connector"],
      signalSource: "review_bot_logins",
      configured: true,
      summary: "Codex Connector is configured.",
    },
    trustPosture: {
      trustMode: "trusted_repo_and_authors",
      executionSafetyMode: "unsandboxed_autonomous",
      warning: null,
      summary: "Trusted inputs with unsandboxed autonomous execution.",
    },
  }));

  await submitPromise;
  await harness.flush();

  assert.deepEqual(
    harness.fetchCalls.map((call) => ({ path: call.path, method: call.method, body: call.body })),
    [
      { path: "/api/setup-readiness", method: "GET", body: null },
      {
        path: "/api/setup-config",
        method: "POST",
        body: JSON.stringify({
          changes: {
            repoPath: "/tmp/repo",
            reviewProvider: "codex",
          },
        }),
      },
      { path: "/api/setup-readiness", method: "GET", body: null },
    ],
  );
  assert.equal(saveButton.disabled, false);
  assert.match(saveStatus.textContent, /Saved 2 setup fields\./u);
  assert.match(harness.document.getElementById("setup-overall-status")?.textContent ?? "", /configured/u);
  assert.match(harness.document.getElementById("setup-blocker-summary")?.textContent ?? "", /No blocking setup conditions remain\./u);
  assert.equal(harness.remainingFetches.length, 0);
});

test("dashboard leaves unrelated later supervisor events unlabeled in the operator timeline", async () => {
  const harness = createDashboardHarness([
    { path: "/api/status?why=true", response: jsonResponse(createStatus({ selectedIssueNumber: 42 })) },
    { path: "/api/doctor", response: jsonResponse(createDoctor()) },
    { path: "/api/issues/42/explain", response: jsonResponse(createExplain(42)) },
    { path: "/api/issues/42/issue-lint", response: jsonResponse(createIssueLint(42)) },
    {
      path: "/api/commands/run-once",
      method: "POST",
      body: JSON.stringify({ dryRun: false }),
      response: jsonResponse({
        command: "run-once",
        dryRun: false,
        summary: "run-once complete",
      }),
    },
    { path: "/api/status?why=true", response: jsonResponse(createStatus({ selectedIssueNumber: 77 })) },
    { path: "/api/doctor", response: jsonResponse(createDoctor()) },
    { path: "/api/issues/77/explain", response: jsonResponse(createExplain(77)) },
    { path: "/api/issues/77/issue-lint", response: jsonResponse(createIssueLint(77)) },
    { path: "/api/status?why=true", response: jsonResponse(createStatus({ selectedIssueNumber: 77 })) },
    { path: "/api/doctor", response: jsonResponse(createDoctor()) },
    { path: "/api/issues/77/explain", response: jsonResponse(createExplain(77)) },
    { path: "/api/issues/77/issue-lint", response: jsonResponse(createIssueLint(77)) },
  ]);
  await harness.flush();

  const runOnceButton = harness.document.getElementById("run-once-button");
  const operatorTimeline = harness.document.getElementById("operator-timeline");
  assert.ok(runOnceButton);
  assert.ok(operatorTimeline);
  assert.ok(harness.eventSource);

  await runOnceButton.dispatch("click");
  await harness.flush();

  await harness.eventSource.dispatch("supervisor.recovery", {
    type: "supervisor.recovery",
    family: "recovery",
    issueNumber: 99,
    reason: "operator_requeue",
    at: "2026-03-22T00:02:00.000Z",
  });
  await harness.flush();

  const recoveryEntry = findChildByText(operatorTimeline, /recovery issue #99: operator requeue/u);
  assert.ok(recoveryEntry);
  assert.match(recoveryEntry.textContent, /recovery issue #99: operator requeue/u);
  assert.doesNotMatch(recoveryEntry.textContent, /after run-once/u);
  assert.equal(harness.remainingFetches.length, 0);
});

test("dashboard prevents duplicate command posts while a command is already in flight", async () => {
  const commandResponse = createDeferred<MockResponseLike>();
  const harness = createDashboardHarness([
    { path: "/api/status?why=true", response: jsonResponse(createStatus()) },
    { path: "/api/doctor", response: jsonResponse(createDoctor()) },
    {
      path: "/api/commands/run-once",
      method: "POST",
      body: JSON.stringify({ dryRun: false }),
      response: commandResponse.promise,
    },
    { path: "/api/status?why=true", response: jsonResponse(createStatus()) },
    { path: "/api/doctor", response: jsonResponse(createDoctor()) },
  ]);
  await harness.flush();

  const runOnceButton = harness.document.getElementById("run-once-button");
  const requeueButton = harness.document.getElementById("requeue-button");
  const pruneButton = harness.document.getElementById("prune-workspaces-button");
  const resetButton = harness.document.getElementById("reset-json-state-button");
  assert.ok(runOnceButton);
  assert.ok(requeueButton);
  assert.ok(pruneButton);
  assert.ok(resetButton);

  const firstClick = runOnceButton.dispatch("click");
  await harness.flush();
  assert.equal(runOnceButton.disabled, true);
  assert.equal(requeueButton.disabled, true);
  assert.equal(pruneButton.disabled, true);
  assert.equal(resetButton.disabled, true);

  await runOnceButton.dispatch("click");
  const commandPostsInFlight = harness.fetchCalls.filter((call) => call.path === "/api/commands/run-once");
  assert.equal(commandPostsInFlight.length, 1);

  commandResponse.resolve(
    jsonResponse({
      command: "run-once",
      dryRun: false,
      summary: "run-once complete",
    }),
  );
  await firstClick;
  await harness.flush();

  assert.equal(runOnceButton.disabled, false);
  assert.equal(pruneButton.disabled, false);
  assert.equal(resetButton.disabled, false);
  assert.equal(requeueButton.disabled, true);
  assert.equal(harness.remainingFetches.length, 0);
});
