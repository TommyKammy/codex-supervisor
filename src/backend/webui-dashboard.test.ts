import assert from "node:assert/strict";
import { setImmediate as waitForTurn } from "node:timers/promises";
import test from "node:test";
import vm from "node:vm";
import { renderSupervisorDashboardHtml } from "./webui-dashboard";

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

  textContent = "";
  value = "";
  disabled = false;

  private classNameValue = "";
  private innerHtmlValue = "";

  constructor(readonly tagName: string, readonly id: string | null = null) {}

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
    if (value === "") {
      this.children.length = 0;
    }
  }

  syncClassName(value: string): void {
    this.classNameValue = value;
  }

  appendChild(child: FakeElement): FakeElement {
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
      this.elements.set(id, new FakeElement("div", id));
    }
  }

  getElementById(id: string): FakeElement | null {
    return this.elements.get(id) ?? null;
  }

  createElement(tagName: string): FakeElement {
    return new FakeElement(tagName);
  }
}

class MockEventSource {
  readonly listeners = new Map<string, Array<(event: { type: string; data: string }) => unknown>>();

  constructor(readonly url: string) {}

  addEventListener(type: string, listener: (event: { type: string; data: string }) => unknown): void {
    const existing = this.listeners.get(type) ?? [];
    existing.push(listener);
    this.listeners.set(type, existing);
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

function createStatus(args: { selectedIssueNumber?: number | null; includeWhyLines?: boolean } = {}) {
  const selectedIssueNumber = args.selectedIssueNumber ?? null;
  const includeWhyLines = args.includeWhyLines ?? true;
  return {
    activeIssue: null,
    selectionSummary: {
      selectedIssueNumber,
      selectionReason: selectedIssueNumber === null ? "no_runnable_issue" : "selected",
    },
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
    reconciliationWarning: null,
  };
}

function createDoctor() {
  return {
    overallStatus: "pass",
    checks: [{ name: "github_auth", status: "pass", summary: "GitHub auth ok." }],
  };
}

function createExplain(issueNumber: number) {
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
    reasons: ["selected"],
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

function extractDashboardScript(html: string): string {
  const match = html.match(/<script>([\s\S]+)<\/script>/u);
  if (!match) {
    throw new Error("Expected the dashboard HTML to contain an inline script.");
  }
  return match[1];
}

async function flushAsyncWork(turns = 4): Promise<void> {
  for (let index = 0; index < turns; index += 1) {
    await waitForTurn();
  }
}

function createDashboardHarness(queue: QueuedFetchResponse[]) {
  const html = renderSupervisorDashboardHtml();
  const ids = Array.from(html.matchAll(/id="([^"]+)"/gu), (match) => match[1]);
  const document = new FakeDocument(ids);
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
      confirm: () => true,
    },
  };

  vm.runInNewContext(extractDashboardScript(html), context);

  return {
    document,
    fetchCalls,
    remainingFetches: queue,
    async flush(): Promise<void> {
      await flushAsyncWork();
    },
  };
}

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
  assert.ok(runOnceButton);
  assert.ok(commandStatus);
  assert.ok(commandResult);
  assert.ok(statusWarning);

  await runOnceButton.dispatch("click");
  await harness.flush();

  assert.equal(commandStatus.textContent, "run-once complete");
  assert.match(commandResult.textContent, /"command": "run-once"/u);
  assert.match(commandResult.textContent, /"summary": "run-once complete"/u);
  assert.equal(statusWarning.textContent, "/api/status?why=true: Status refresh failed.");
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
