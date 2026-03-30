import assert from "node:assert/strict";
import { setImmediate as waitForTurn } from "node:timers/promises";
import test from "node:test";
import vm from "node:vm";
import { renderSupervisorDashboardHtml } from "./webui-dashboard";
import { DASHBOARD_PANEL_REGISTRY } from "./webui-dashboard-panel-layout";
import { WEBUI_MUTATION_AUTH_HEADER, WEBUI_MUTATION_AUTH_STORAGE_KEY } from "./webui-mutation-auth";
import { renderSupervisorSetupHtml } from "./webui-setup";

interface MockResponseLike {
  ok: boolean;
  status?: number;
  headers?: { get(name: string): string | null };
  json(): Promise<unknown>;
  text(): Promise<string>;
}

interface FetchCall {
  path: string;
  method: string;
  body: string | null;
  headers: Record<string, string> | null;
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

interface ManualTimerController {
  setTimeout(callback: () => void, delay?: number): number;
  clearTimeout(id: number): void;
  advanceTime(ms: number): Promise<void>;
}

const SAMPLE_MACOS_WORKSPACE_ROOT = `/${"Users"}/example/dev/work`;

const unavailableManagedRestart = {
  supported: false,
  launcher: null,
  state: "unavailable",
  summary: "Managed restart is unavailable because this WebUI process was not started with explicit launcher-backed restart support.",
};

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

class ThrowingStorage extends FakeStorage {
  setItem(): void {
    throw new Error("setItem failed");
  }

  removeItem(): void {
    throw new Error("removeItem failed");
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
  hidden = false;
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

  constructor(
    elements: Array<{
      tagName: string;
      id: string;
      hidden: boolean;
      disabled: boolean;
    }>,
  ) {
    for (const element of elements) {
      const fakeElement = new FakeElement(element.tagName, element.id, this);
      fakeElement.hidden = element.hidden;
      fakeElement.disabled = element.disabled;
      this.elements.set(element.id, fakeElement);
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
  const normalizedBody = typeof body === "string" ? body : JSON.stringify(body);
  return {
    ok: statusCode >= 200 && statusCode < 300,
    status: statusCode,
    headers: {
      get(name: string): string | null {
        return name.toLowerCase() === "content-type" ? "application/json; charset=utf-8" : null;
      },
    },
    async json(): Promise<unknown> {
      return body;
    },
    async text(): Promise<string> {
      return normalizedBody;
    },
  };
}

function textResponse(body: string, statusCode = 200, contentType = "text/plain; charset=utf-8"): MockResponseLike {
  return {
    ok: statusCode >= 200 && statusCode < 300,
    status: statusCode,
    headers: {
      get(name: string): string | null {
        return name.toLowerCase() === "content-type" ? contentType : null;
      },
    },
    async json(): Promise<unknown> {
      return JSON.parse(body);
    },
    async text(): Promise<string> {
      return body;
    },
  };
}

function createManualTimerController(): ManualTimerController {
  let now = 0;
  let nextId = 1;
  const timers = new Map<number, { runAt: number; callback: () => void }>();

  const runDueTimers = async () => {
    while (true) {
      const dueTimers = Array.from(timers.entries())
        .filter(([, timer]) => timer.runAt <= now)
        .sort((left, right) => left[1].runAt - right[1].runAt || left[0] - right[0]);
      if (dueTimers.length === 0) {
        return;
      }
      for (const [id, timer] of dueTimers) {
        if (!timers.delete(id)) {
          continue;
        }
        timer.callback();
        await flushAsyncWork();
      }
    }
  };

  return {
    setTimeout(callback: () => void, delay = 0): number {
      const id = nextId;
      nextId += 1;
      timers.set(id, {
        runAt: now + Math.max(0, Number(delay) || 0),
        callback,
      });
      return id;
    },
    clearTimeout(id: number): void {
      timers.delete(id);
    },
    async advanceTime(ms: number): Promise<void> {
      now += Math.max(0, Number(ms) || 0);
      await runDueTimers();
    },
  };
}

function createStatus(args: {
  selectedIssueNumber?: number | null;
  includeWhyLines?: boolean;
  localCiContract?: {
    configured: boolean;
    command: string | null;
    recommendedCommand?: string | null;
    source: "config" | "repo_script_candidate";
    summary: string;
  } | null;
  loopRuntime?: {
    state: "running" | "off" | "unknown";
    pid: number | null;
    startedAt: string | null;
    detail: string | null;
  } | null;
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
    loopRuntime:
      args.loopRuntime ?? {
        state: "off",
        pid: null,
        startedAt: null,
        detail: null,
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
    localCiContract: args.localCiContract ?? null,
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
    prompt?: () => string | null;
  } = {},
) {
  MockEventSource.instances.length = 0;
  const html = renderSupervisorDashboardHtml();
  return createHtmlHarness(html, queue, options);
}

function createSetupHarness(
  queue: QueuedFetchResponse[],
  options: {
    localStorage?: FakeStorage;
    prompt?: () => string | null;
  } = {},
) {
  const html = renderSupervisorSetupHtml();
  return createHtmlHarness(html, queue, { manualTimers: createManualTimerController(), ...options });
}

function createHtmlHarness(
  html: string,
  queue: QueuedFetchResponse[],
  options: {
    confirm?: () => boolean;
    localStorage?: FakeStorage;
    prompt?: () => string | null;
    manualTimers?: ManualTimerController;
  } = {},
) {
  MockEventSource.instances.length = 0;
  const elementDescriptors = Array.from(
    html.matchAll(/<([a-z0-9-]+)([^>]*)\sid="([^"]+)"([^>]*)>/giu),
    (match) => {
      const attributes = `${match[2]} ${match[4]}`;
      return {
        tagName: match[1],
        id: match[3],
        hidden: /\bhidden\b/iu.test(attributes),
        disabled: /\bdisabled\b/iu.test(attributes),
      };
    },
  );
  const document = new FakeDocument(elementDescriptors);
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

  const fetch = async (
    path: string,
    init?: { method?: string; body?: string; headers?: Record<string, string> },
  ): Promise<MockResponseLike> => {
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
      headers: init?.headers ?? null,
    });
    return await next.response;
  };

  const context = {
    console,
    Date,
    document,
    EventSource: MockEventSource,
    fetch,
    setTimeout: options.manualTimers?.setTimeout ?? setTimeout,
    clearTimeout: options.manualTimers?.clearTimeout ?? clearTimeout,
    window: {
      confirm: options.confirm ?? (() => true),
      localStorage: options.localStorage ?? new FakeStorage(),
      prompt: options.prompt ?? (() => null),
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
    async advanceTime(ms: number): Promise<void> {
      await options.manualTimers?.advanceTime(ms);
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

test("dashboard page frames a summary-first shell and a collapsible details area", () => {
  const html = renderSupervisorDashboardHtml();

  assert.match(
    html,
    /<main class="page-shell" data-dashboard-root>[\s\S]*<header class="masthead">[\s\S]*id="summary-top"[\s\S]*codex-supervisor[\s\S]*id="repo-slug-value"[\s\S]*id="connection-state-pill"[\s\S]*id="last-refresh-pill"[\s\S]*<div class="app-layout">[\s\S]*<aside class="side-nav">/u,
  );
  assert.match(html, /<aside class="side-nav">[\s\S]*id="nav-panel-operator-actions"[\s\S]*Operator timeline/u);
  assert.match(html, /id="loop-mode-badge"/u);
  assert.match(
    html,
    /<section class="focus-hero" aria-labelledby="selected-issue-heading">[\s\S]*id="focus-breadcrumb"[\s\S]*id="selected-issue-heading"[\s\S]*id="hero-badge-row"[\s\S]*id="hero-primary-button"[\s\S]*id="hero-secondary-button"[\s\S]*id="hero-tertiary-button"[\s\S]*id="overview-warning"[\s\S]*id="overview-headline"[\s\S]*id="primary-action-title"[\s\S]*id="selected-issue-badge"[\s\S]*id="attention-list"/u,
  );
  assert.match(html, /id="loop-state-summary"/u);
  assert.match(html, /id="selected-issue-summary-metrics"[\s\S]*id="selected-issue-summary-notes"/u);
  assert.match(
    html,
    /<details id="details-disclosure" class="details-disclosure">[\s\S]*<div class="details-body">[\s\S]*<h2 id="overview-heading">Advanced queue context<\/h2>[\s\S]*<div id="overview-grid" class="overview-grid" aria-label="overview" data-panel-grid="overview">/u,
  );
  assert.match(
    html,
    /<h2 id="details-heading">Detailed operator view<\/h2>[\s\S]*<div id="details-grid" class="details-grid" aria-label="details" data-panel-grid="details">/u,
  );
  assert.match(html, /<footer class="dashboard-footer">[\s\S]*id="repo-path-value"[\s\S]*id="workspace-root-value"/u);
});

test("setup page reuses the dashboard-grade admin shell with stable setup sections", () => {
  const html = renderSupervisorSetupHtml();

  assert.match(
    html,
    /<main class="page-shell" data-setup-root>[\s\S]*<header class="masthead">[\s\S]*First-run setup[\s\S]*<div class="app-layout">[\s\S]*<aside class="side-nav">/u,
  );
  assert.match(
    html,
    /<aside class="side-nav">[\s\S]*href="#setup-progress"[\s\S]*href="#setup-guided-config"[\s\S]*href="#setup-diagnostics"/u,
  );
  assert.match(
    html,
    /id="setup-progress"[\s\S]*id="setup-readiness-card"[\s\S]*id="setup-blockers-card"[\s\S]*id="setup-guided-config"[\s\S]*id="setup-diagnostics"[\s\S]*id="setup-host-checks-card"/u,
  );
  assert.match(html, /<footer class="dashboard-footer">[\s\S]*id="repo-path-value"[\s\S]*id="workspace-root-value"/u);
});

test("dashboard page renders repository identity from setup readiness data", () => {
  const html = renderSupervisorDashboardHtml({
    kind: "setup_readiness",
    ready: true,
    overallStatus: "configured",
    configPath: "/tmp/supervisor.config.json",
    fields: [
      {
        key: "repoSlug",
        label: "Repository slug",
        state: "configured",
        value: "owner/<repo>\"",
        message: "Repository slug is configured.",
        required: true,
        metadata: { source: "config", editable: true, valueType: "repo_slug" },
      },
      {
        key: "repoPath",
        label: "Repository path",
        state: "configured",
        value: "/Users/<example>/dev/\"repo",
        message: "Repository path is configured.",
        required: true,
        metadata: { source: "config", editable: true, valueType: "directory_path" },
      },
      {
        key: "workspaceRoot",
        label: "Workspace root",
        state: "configured",
        value: `${SAMPLE_MACOS_WORKSPACE_ROOT}"trees`,
        message: "Workspace root is configured.",
        required: true,
        metadata: { source: "config", editable: true, valueType: "directory_path" },
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
      reviewers: ["codex"],
      signalSource: "reviewBotLogins",
      configured: true,
      summary: "Review provider posture uses codex via reviewBotLogins.",
    },
    trustPosture: {
      trustMode: "trusted_repo_and_authors",
      executionSafetyMode: "unsandboxed_autonomous",
      warning: null,
      summary: "Trusted inputs with unsandboxed autonomous execution.",
    },
  });

  assert.match(html, /id="repo-slug-value" class="masthead-repo">owner\/&lt;repo&gt;&quot;</u);
  assert.match(html, /id="repo-path-value" class="context-path">\/Users\/&lt;example&gt;\/dev\/&quot;repo</u);
  assert.match(html, /id="workspace-root-value" class="context-path">\/Users\/example\/dev\/work&quot;trees</u);
});

test("dashboard page renders sidebar links from the panel registry", () => {
  const html = renderSupervisorDashboardHtml();

  for (const panel of DASHBOARD_PANEL_REGISTRY) {
    assert.match(html, new RegExp(`id="nav-panel-${panel.id}"`, "u"));
    const expectedLabel = panel.title.replace(/\b([a-z])/gu, (match) => match.toUpperCase());
    assert.match(html, new RegExp(`>${expectedLabel}<`, "u"));
  }
});

test("dashboard panel registry exposes a shared shell structure for every panel", () => {
  for (const panel of DASHBOARD_PANEL_REGISTRY) {
    assert.match(panel.markup, /<article id="panel-[^"]+" class="panel" data-panel-id="[^"]+" data-panel-section="[^"]+">[\s\S]*<div class="panel-shell">/u);
    assert.match(panel.markup, /<div class="panel-header">[\s\S]*<div class="panel-header-main">[\s\S]*<div class="panel-heading">/u);
    assert.match(panel.markup, /<div class="panel-heading">[\s\S]*<h2>[\s\S]+<\/h2>[\s\S]*<p class="panel-subtitle">[\s\S]+<\/p>/u);
    assert.match(panel.markup, /<div class="panel-body/u);
    assert.doesNotMatch(panel.markup, /panel-drag-|panel-drag-handle|panel-drag-slot/u);
  }
});

test("dashboard page includes reduced-motion-safe fixed-layout styles", () => {
  const html = renderSupervisorDashboardHtml();

  assert.match(html, /\.overview-grid \{/u);
  assert.match(html, /\.details-grid \{/u);
  assert.match(html, /@media \(prefers-reduced-motion: reduce\) \{[\s\S]*transition-duration: 0\.01ms/u);
});

test("dashboard page uses a clean summary-first palette and retains the fixed details layout", () => {
  const html = renderSupervisorDashboardHtml();

  assert.match(html, /--accent: #1abb9c;/u);
  assert.match(html, /--muted: #5f7288;/u);
  assert.match(html, /--text: #233647;/u);
  assert.match(html, /\.focus-hero \{[\s\S]*display: grid;[\s\S]*gap: 20px;/u);
  assert.match(html, /\.masthead \{[\s\S]*border-bottom: 1px solid/u);
  assert.match(html, /\.side-nav-card \{[\s\S]*border-right: 1px solid/u);
  assert.match(html, /#panel-issue-details \{[\s\S]*grid-column: span 7;/u);
  assert.match(html, /#panel-tracked-history \{[\s\S]*grid-column: span 5;/u);
});

test("dashboard keeps the fixed panel layout without any drag affordances", async () => {
  const html = renderSupervisorDashboardHtml();

  assert.match(
    html,
    /<div id="overview-grid" class="overview-grid" aria-label="overview" data-panel-grid="overview">[\s\S]*data-panel-id="status"[\s\S]*data-panel-id="doctor"[\s\S]*<\/div>/u,
  );
  assert.match(
    html,
    /<div id="details-grid" class="details-grid" aria-label="details" data-panel-grid="details">[\s\S]*data-panel-id="issue-details"[\s\S]*data-panel-id="tracked-history"[\s\S]*data-panel-id="operator-actions"[\s\S]*data-panel-id="live-events"[\s\S]*data-panel-id="operator-timeline"[\s\S]*<\/div>/u,
  );
  assert.doesNotMatch(html, /panel-drag-|dashboard-panel-reorder|drag-active|drop-target/u);
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
  const statusWorkflow = harness.document.getElementById("status-workflow");
  assert.ok(selectedIssueBadge);
  assert.ok(issueNumberInput);
  assert.ok(statusWorkflow);

  assert.equal(selectedIssueBadge.textContent, "#42");
  assert.equal(issueNumberInput.value, "42");
  assert.match(statusWorkflow.textContent, /Execute/u);
  assert.match(statusWorkflow.textContent, /#42/u);
  assert.equal(harness.remainingFetches.length, 0);
});

test("dashboard does not claim loop mode is off while typed runtime status reports the loop is running", async () => {
  const harness = createDashboardHarness([
    {
      path: "/api/status?why=true",
      response: jsonResponse(
        createStatus({
          selectedIssueNumber: 42,
          loopRuntime: {
            state: "running",
            pid: 4242,
            startedAt: "2026-03-25T00:00:00.000Z",
            detail: "pid 4242",
          },
        }),
      ),
    },
    { path: "/api/doctor", response: jsonResponse(createDoctor()) },
  ]);
  await harness.flush();

  const loopModeBadge = harness.document.getElementById("loop-mode-badge");
  const loopStateSummary = harness.document.getElementById("loop-state-summary");
  assert.ok(loopModeBadge);
  assert.ok(loopStateSummary);

  assert.match(loopModeBadge.textContent, /loop running/u);
  assert.doesNotMatch(loopModeBadge.textContent, /loop off/u);
  assert.match(loopStateSummary.textContent, /Loop mode is running on this host/u);
  assert.equal(harness.remainingFetches.length, 0);
});

test("dashboard renders the loop-off presentation only when typed runtime status reports loop off", async () => {
  const harness = createDashboardHarness([
    {
      path: "/api/status?why=true",
      response: jsonResponse(
        createStatus({
          loopRuntime: {
            state: "off",
            pid: null,
            startedAt: null,
            detail: null,
          },
        }),
      ),
    },
    { path: "/api/doctor", response: jsonResponse(createDoctor()) },
  ]);
  await harness.flush();

  const loopModeBadge = harness.document.getElementById("loop-mode-badge");
  const loopStateSummary = harness.document.getElementById("loop-state-summary");
  assert.ok(loopModeBadge);
  assert.ok(loopStateSummary);

  assert.match(loopModeBadge.textContent, /loop off/u);
  assert.match(loopStateSummary.textContent, /Loop mode is off on this host/u);
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

test("dashboard status panel surfaces advisory local CI posture without reopening setup", async () => {
  const harness = createDashboardHarness([
    {
      path: "/api/status?why=true",
      response: jsonResponse(
        createStatus({
          includeWhyLines: false,
          localCiContract: {
            configured: false,
            command: null,
            recommendedCommand: "npm run verify:supervisor-pre-pr",
            source: "repo_script_candidate",
            summary:
              "Repo-owned local CI candidate exists but localCiCommand is unset. Recommended command: npm run verify:supervisor-pre-pr.",
          },
        }),
      ),
    },
    { path: "/api/doctor", response: jsonResponse(createDoctor()) },
  ]);
  await harness.flush();

  const statusLines = harness.document.getElementById("status-lines");
  assert.ok(statusLines);
  assert.match(
    statusLines.textContent,
    /local ci configured=no source=repo script candidate command=none recommended command=npm run verify:supervisor-pre-pr/u,
  );
  assert.match(
    statusLines.textContent,
    /Repo-owned local CI candidate exists but localCiCommand is unset\. Recommended command: npm run verify:supervisor-pre-pr\./u,
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
  assert.match(trackedHistoryLines.textContent, /#58/u);
  assert.match(trackedHistoryLines.textContent, /queued/u);
  assert.match(trackedHistoryLines.textContent, /pr #58/u);
  assert.match(trackedHistoryLines.textContent, /requirements:verification/u);
  assert.doesNotMatch(trackedHistoryLines.textContent, /codex\/issue-58/u);
  assert.doesNotMatch(trackedHistoryLines.textContent, /#12/u);
  assert.match(trackedHistoryToggle.textContent, /Show done issues/u);

  await trackedHistoryToggle.dispatch("click");
  await harness.flush();

  assert.match(trackedHistorySummary.textContent, /showing 2 of 2 tracked issues/u);
  assert.match(trackedHistoryLines.textContent, /#12/u);
  assert.match(trackedHistoryLines.textContent, /done/u);
  assert.match(trackedHistoryLines.textContent, /pr #12/u);
  assert.doesNotMatch(trackedHistoryLines.textContent, /codex\/issue-12/u);
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
  assert.match(joinChildText(issueShortcuts), /#77runnable ready • Ready for inspection/u);
  assert.match(joinChildText(issueShortcuts), /#93blocked requirements:scope, verification • Needs scope repair/u);
  assert.doesNotMatch(joinChildText(issueShortcuts), /#12 tracked done codex\/issue-12 pr=#12/u);

  const blockedIssueButton = findChildByText(issueShortcuts, /#93blocked/u);
  assert.ok(blockedIssueButton);

  await blockedIssueButton.dispatch("click");
  await harness.flush();

  assert.match(issueSummary.textContent, /#93 Issue 93/u);
  assert.equal(harness.remainingFetches.length, 0);
});

test("dashboard folds current state into hero badges and action buttons", async () => {
  const harness = createDashboardHarness([
    {
      path: "/api/status?why=true",
      response: jsonResponse(
        createStatus({
          selectedIssueNumber: 42,
          runnableIssues: [{ issueNumber: 42, title: "Ready issue", readiness: "execution_ready" }],
        }),
      ),
    },
    { path: "/api/doctor", response: jsonResponse(createDoctor()) },
    { path: "/api/issues/42/explain", response: jsonResponse(createExplain(42)) },
    { path: "/api/issues/42/issue-lint", response: jsonResponse(createIssueLint(42)) },
  ]);
  await harness.flush();

  const heroBadgeRow = harness.document.getElementById("hero-badge-row");
  const heroPrimaryButton = harness.document.getElementById("hero-primary-button");
  const heroSecondaryButton = harness.document.getElementById("hero-secondary-button");
  assert.ok(heroBadgeRow);
  assert.ok(heroPrimaryButton);
  assert.ok(heroSecondaryButton);

  const badgeText = joinChildText(heroBadgeRow);
  assert.match(badgeText, /Runnable/u);
  assert.match(badgeText, /Checks: ready/u);
  assert.match(badgeText, /Recovery: quiet/u);
  assert.match(badgeText, /Loop mode: off/u);
  assert.match(badgeText, /fresh/u);
  assert.match(badgeText, /idle/u);
  assert.match(heroPrimaryButton.textContent, /Open Issue Details/u);
  assert.equal(heroSecondaryButton.textContent, "");
  assert.equal(heroSecondaryButton.classList.contains("is-hidden"), true);
});

test("dashboard avoids duplicate queue hero actions when no issue is focused", async () => {
  const harness = createDashboardHarness([
    { path: "/api/status?why=true", response: jsonResponse(createStatus()) },
    { path: "/api/doctor", response: jsonResponse(createDoctor()) },
  ]);
  await harness.flush();

  const heroPrimaryButton = harness.document.getElementById("hero-primary-button");
  const heroSecondaryButton = harness.document.getElementById("hero-secondary-button");
  assert.ok(heroPrimaryButton);
  assert.ok(heroSecondaryButton);

  assert.match(heroPrimaryButton.textContent, /Open Queue Details/u);
  assert.doesNotMatch(heroSecondaryButton.textContent, /Open Queue Details/u);
});

test("dashboard hero issue-details action loads focused issue details when needed", async () => {
  const harness = createDashboardHarness([
    {
      path: "/api/status?why=true",
      response: jsonResponse(
        createStatus({
          runnableIssues: [{ issueNumber: 42, title: "Ready issue", readiness: "execution_ready" }],
        }),
      ),
    },
    { path: "/api/doctor", response: jsonResponse(createDoctor()) },
    { path: "/api/issues/42/explain", response: jsonResponse(createExplain(42)) },
    { path: "/api/issues/42/issue-lint", response: jsonResponse(createIssueLint(42)) },
  ]);
  await harness.flush();

  const heroPrimaryButton = harness.document.getElementById("hero-primary-button");
  const heroSecondaryButton = harness.document.getElementById("hero-secondary-button");
  const issueSummary = harness.document.getElementById("issue-summary");
  assert.ok(heroPrimaryButton);
  assert.ok(heroSecondaryButton);
  assert.ok(issueSummary);
  assert.equal(heroSecondaryButton.textContent, "");
  assert.equal(heroSecondaryButton.classList.contains("is-hidden"), true);

  await heroPrimaryButton.dispatch("click");
  await harness.flush();

  assert.match(issueSummary.textContent, /#42 Issue 42/u);
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
  const selectedIssueHeading = harness.document.getElementById("selected-issue-heading");
  const selectedIssueDetail = harness.document.getElementById("selected-issue-detail");
  assert.ok(issueNumberInput);
  assert.ok(issueForm);
  assert.ok(issueSummary);
  assert.ok(requeueButton);
  assert.ok(selectedIssueHeading);
  assert.ok(selectedIssueDetail);

  issueNumberInput.value = "42";
  await issueForm.dispatch("submit", {
    preventDefault() {},
  });
  await harness.flush();

  assert.equal(requeueButton.disabled, true);
  assert.match(issueSummary.textContent, /Explain failed/u);
  assert.match(selectedIssueHeading.textContent, /#42 could not load/u);
  assert.match(selectedIssueDetail.textContent, /Explain failed/u);
  assert.equal(harness.remainingFetches.length, 0);
});

test("dashboard opens the details disclosure when a sidebar detail link is selected", async () => {
  const harness = createDashboardHarness([
    { path: "/api/status?why=true", response: jsonResponse(createStatus()) },
    { path: "/api/doctor", response: jsonResponse(createDoctor()) },
  ]);
  await harness.flush();

  const detailsDisclosure = harness.document.getElementById("details-disclosure") as FakeElement & { open?: boolean };
  const navPanelOperatorActions = harness.document.getElementById("nav-panel-operator-actions");
  assert.ok(detailsDisclosure);
  assert.ok(navPanelOperatorActions);
  assert.equal(detailsDisclosure.open, undefined);

  await navPanelOperatorActions.dispatch("click");

  assert.equal(detailsDisclosure.open, true);
});

test("dashboard next state prefers stale-data recovery over stale selected issue guidance", async () => {
  const harness = createDashboardHarness([
    {
      path: "/api/status?why=true",
      response: jsonResponse(
        createStatus({
          selectedIssueNumber: 42,
          runnableIssues: [{ issueNumber: 42, title: "Ready issue", readiness: "execution_ready" }],
        }),
      ),
    },
    { path: "/api/doctor", response: jsonResponse(createDoctor()) },
  ]);
  await harness.flush();

  const primaryActionTitle = harness.document.getElementById("primary-action-title");
  const heroPrimaryButton = harness.document.getElementById("hero-primary-button");
  const eventSource = MockEventSource.instances[0];
  assert.ok(primaryActionTitle);
  assert.ok(heroPrimaryButton);
  assert.ok(eventSource);
  assert.match(primaryActionTitle.textContent, /Execute the selected issue/u);
  assert.match(heroPrimaryButton.textContent, /Open Issue Details/u);

  await eventSource.dispatch("error");

  assert.match(primaryActionTitle.textContent, /Recover dashboard freshness/u);
  assert.match(heroPrimaryButton.textContent, /Refresh Dashboard/u);
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

test("dashboard surfaces typed retry risk, recovery-loop context, and phase changes in a dedicated detail section", async () => {
  const harness = createDashboardHarness([
    { path: "/api/status?why=true", response: jsonResponse(createStatus()) },
    { path: "/api/doctor", response: jsonResponse(createDoctor()) },
    {
      path: "/api/issues/42/explain",
      response: jsonResponse(
        createExplain(42, {
          latestRecoverySummary: "legacy recovery line that should only be used as fallback",
          activityContext: {
            handoffSummary: null,
            localReviewRoutingSummary: null,
            changeClassesSummary: "change_classes backend|tests",
            verificationPolicySummary: null,
            durableGuardrailSummary: null,
            externalReviewFollowUpSummary: null,
            latestRecovery: {
              issueNumber: 42,
              at: "2026-03-22T00:00:00Z",
              reason: "tracked_pr_head_advanced",
              detail: "resumed issue #42 from blocked to addressing_review after tracked PR #42 advanced",
            },
            retryContext: {
              timeoutRetryCount: 2,
              blockedVerificationRetryCount: 1,
              repeatedBlockerCount: 3,
              repeatedFailureSignatureCount: 4,
              lastFailureSignature: "tracked-pr-refresh-loop",
            },
            repeatedRecovery: {
              kind: "stale_stabilizing_no_pr",
              repeatCount: 2,
              repeatLimit: 3,
              status: "retrying",
              action: "confirm_whether_the_change_already_landed_or_retarget_the_issue_manually",
              lastFailureSignature: "stale-stabilizing-no-pr-recovery-loop",
            },
            recentPhaseChanges: [
              {
                at: "2026-03-22T00:00:00Z",
                from: "blocked",
                to: "addressing_review",
                reason: "tracked_pr_head_advanced",
                source: "recovery",
              },
            ],
            localReviewSummaryPath: null,
            externalReviewMissesPath: null,
            reviewWaits: [],
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

  const retryRecoverySection = findChildByText(issueExplain, /Retry and recovery/i);
  assert.ok(retryRecoverySection);
  assert.match(
    retryRecoverySection.textContent,
    /retry_summary: timeout=2 verification=1 same_blocker=3 same_failure_signature=4 last_failure_signature=tracked-pr-refresh-loop/u,
  );
  assert.match(
    retryRecoverySection.textContent,
    /recovery_loop: kind=stale_stabilizing_no_pr repeat_count=2\/3 status=retrying last_failure_signature=stale-stabilizing-no-pr-recovery-loop action=confirm_whether_the_change_already_landed_or_retarget_the_issue_manually/u,
  );
  assert.match(
    retryRecoverySection.textContent,
    /recent_phase_changes: at=2026-03-22T00:00:00Z phase_change=blocked->addressing_review reason=tracked_pr_head_advanced source=recovery/u,
  );
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
  const statusWarning = harness.document.getElementById("overview-warning");
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

test("dashboard retries a mutation command after prompting for the local mutation token", async () => {
  const storage = new FakeStorage();
  const harness = createDashboardHarness(
    [
      { path: "/api/status?why=true", response: jsonResponse(createStatus()) },
      { path: "/api/doctor", response: jsonResponse(createDoctor()) },
      {
        path: "/api/commands/run-once",
        method: "POST",
        body: JSON.stringify({ dryRun: false }),
        response: jsonResponse({ error: "Mutation auth required." }, 401),
      },
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
      { path: "/api/status?why=true", response: jsonResponse(createStatus()) },
      { path: "/api/doctor", response: jsonResponse(createDoctor()) },
    ],
    {
      localStorage: storage,
      prompt: () => "prompted-secret",
    },
  );
  await harness.flush();

  const runOnceButton = harness.document.getElementById("run-once-button");
  const commandStatus = harness.document.getElementById("command-status");
  assert.ok(runOnceButton);
  assert.ok(commandStatus);

  await runOnceButton.dispatch("click");
  await harness.flush();

  assert.equal(storage.getItem(WEBUI_MUTATION_AUTH_STORAGE_KEY), "prompted-secret");
  assert.equal(harness.fetchCalls[2]?.headers?.[WEBUI_MUTATION_AUTH_HEADER], undefined);
  assert.equal(harness.fetchCalls[3]?.headers?.[WEBUI_MUTATION_AUTH_HEADER], "prompted-secret");
  assert.equal(commandStatus.textContent, "run-once complete");
  assert.equal(harness.remainingFetches.length, 0);
});

test("dashboard surfaces non-JSON mutation failures without throwing a parse error", async () => {
  const harness = createDashboardHarness([
    { path: "/api/status?why=true", response: jsonResponse(createStatus()) },
    { path: "/api/doctor", response: jsonResponse(createDoctor()) },
    {
      path: "/api/commands/run-once",
      method: "POST",
      body: JSON.stringify({ dryRun: false }),
      response: textResponse("proxy failure", 502),
    },
  ]);
  await harness.flush();

  const runOnceButton = harness.document.getElementById("run-once-button");
  const commandResult = harness.document.getElementById("command-result");
  assert.ok(runOnceButton);
  assert.ok(commandResult);

  await runOnceButton.dispatch("click");
  await harness.flush();

  assert.match(commandResult.textContent, /"summary": "\/api\/commands\/run-once: proxy failure"/u);
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
        managedRestart: unavailableManagedRestart,
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
        localCiContract: {
          configured: false,
          command: null,
          source: "config",
          summary: "No repo-owned local CI contract is configured.",
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
  assert.match(harness.document.getElementById("setup-local-ci-summary")?.textContent ?? "", /No repo-owned local CI contract is configured\./u);
  assert.match(
    harness.document.getElementById("setup-local-ci-details")?.textContent ?? "",
    /Configured: no.*Command: none.*If the repo does not declare this contract, codex-supervisor falls back to the issue's ## Verification guidance and operator workflow.*When configured local CI fails, PR publication or ready-for-review promotion stays blocked until the repo-owned command passes again\./u,
  );
  assert.equal(harness.remainingFetches.length, 0);
});

test("setup shell highlights a repo-owned local CI candidate when localCiCommand is unset", async () => {
  const harness = createSetupHarness([
    {
      path: "/api/setup-readiness",
      response: jsonResponse({
        kind: "setup_readiness",
        managedRestart: unavailableManagedRestart,
        ready: true,
        overallStatus: "configured",
        configPath: "/tmp/supervisor.config.json",
        fields: [
          {
            key: "localCiCommand",
            label: "Local CI command",
            state: "missing",
            value: null,
            message: "Local CI command is optional until you opt in to the repo-owned contract.",
            required: false,
            metadata: {
              source: "config",
              editable: true,
              valueType: "text",
            },
          },
        ],
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
        localCiContract: {
          configured: false,
          command: null,
          recommendedCommand: "npm run verify:pre-pr",
          source: "repo_script_candidate",
          summary:
            "Repo-owned local CI candidate exists but localCiCommand is unset. Recommended command: npm run verify:pre-pr.",
        },
      }),
    },
  ]);
  await harness.flush();

  assert.match(
    harness.document.getElementById("setup-local-ci-summary")?.textContent ?? "",
    /Repo-owned local CI candidate exists but localCiCommand is unset\. Recommended command: npm run verify:pre-pr\./u,
  );
  assert.match(
    harness.document.getElementById("setup-local-ci-details")?.textContent ?? "",
    /Configured: no.*Command: none.*Source: repo script candidate.*Recommended command: npm run verify:pre-pr.*This repo already defines a repo-owned local CI entrypoint, but codex-supervisor will not run it until localCiCommand is configured.*This warning is advisory only; first-run setup readiness and blocker semantics stay unchanged until you opt in by configuring localCiCommand\./u,
  );
  assert.equal(harness.document.getElementById("setup-input-localCiCommand")?.value, "");
  const adoptButton = harness.document.getElementById("setup-local-ci-adopt-recommended");
  assert.ok(adoptButton);
  assert.equal(adoptButton.hidden, false);
  assert.equal(adoptButton.disabled, false);
  assert.equal(harness.remainingFetches.length, 0);
});

test("setup shell lets operators adopt the recommended local CI command and save it", async () => {
  const setupConfigResponse = createDeferred<MockResponseLike>();
  const setupReadinessRefreshResponse = createDeferred<MockResponseLike>();
  const harness = createSetupHarness([
    {
      path: "/api/setup-readiness",
      response: jsonResponse({
        kind: "setup_readiness",
        managedRestart: unavailableManagedRestart,
        ready: true,
        overallStatus: "configured",
        configPath: "/tmp/supervisor.config.json",
        fields: [
          {
            key: "localCiCommand",
            label: "Local CI command",
            state: "missing",
            value: null,
            message: "Local CI command is optional until you opt in to the repo-owned contract.",
            required: false,
            metadata: {
              source: "config",
              editable: true,
              valueType: "text",
            },
          },
        ],
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
        localCiContract: {
          configured: false,
          command: null,
          recommendedCommand: "npm run verify:pre-pr",
          source: "repo_script_candidate",
          summary:
            "Repo-owned local CI candidate exists but localCiCommand is unset. Recommended command: npm run verify:pre-pr.",
        },
      }),
    },
    {
      path: "/api/setup-config",
      method: "POST",
      body: JSON.stringify({
        changes: {
          localCiCommand: "npm run verify:pre-pr",
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

  const adoptButton = harness.document.getElementById("setup-local-ci-adopt-recommended");
  const localCiInput = harness.document.getElementById("setup-input-localCiCommand");
  const setupForm = harness.document.getElementById("setup-form");
  const saveStatus = harness.document.getElementById("setup-save-status");
  assert.ok(adoptButton);
  assert.ok(localCiInput);
  assert.ok(setupForm);
  assert.ok(saveStatus);
  assert.equal(adoptButton.hidden, false);
  assert.equal(adoptButton.disabled, false);

  await adoptButton.dispatch("click");
  assert.equal(localCiInput.value, "npm run verify:pre-pr");

  const submitPromise = setupForm.dispatch("submit", { preventDefault() {} });
  await harness.flush();
  assert.match(saveStatus.textContent ?? "", /Saving setup changes\.\.\./u);

  setupConfigResponse.resolve(jsonResponse({
    kind: "setup_config_update",
    managedRestart: unavailableManagedRestart,
    configPath: "/tmp/supervisor.config.json",
    backupPath: null,
    updatedFields: ["localCiCommand"],
    restartRequired: true,
    restartScope: "supervisor",
    restartTriggeredByFields: ["localCiCommand"],
    document: {
      localCiCommand: "npm run verify:pre-pr",
    },
    readiness: {
      kind: "setup_readiness",
      managedRestart: unavailableManagedRestart,
      ready: true,
      overallStatus: "configured",
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
      localCiContract: {
        configured: true,
        command: "npm run verify:pre-pr",
        source: "config",
        summary: "Repo-owned local CI contract is configured.",
      },
    },
  }));
  await harness.flush();

  setupReadinessRefreshResponse.resolve(jsonResponse({
    kind: "setup_readiness",
    managedRestart: unavailableManagedRestart,
    ready: true,
    overallStatus: "configured",
    configPath: "/tmp/supervisor.config.json",
    fields: [
      {
        key: "localCiCommand",
        label: "Local CI command",
        state: "configured",
        value: "npm run verify:pre-pr",
        message: "Local CI command is configured.",
        required: false,
        metadata: {
          source: "config",
          editable: true,
          valueType: "text",
        },
      },
    ],
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
    localCiContract: {
      configured: true,
      command: "npm run verify:pre-pr",
      source: "config",
      summary: "Repo-owned local CI contract is configured.",
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
            localCiCommand: "npm run verify:pre-pr",
          },
        }),
      },
      { path: "/api/setup-readiness", method: "GET", body: null },
    ],
  );
  assert.match(saveStatus.textContent ?? "", /Saved 1 setup field\./u);
  assert.match(harness.document.getElementById("setup-local-ci-summary")?.textContent ?? "", /Repo-owned local CI contract is configured\./u);
  assert.match(
    harness.document.getElementById("setup-local-ci-details")?.textContent ?? "",
    /Configured: yes.*Command: npm run verify:pre-pr.*Source: config.*This repo-owned command is the canonical local verification step before PR publication or update\./u,
  );
});

test("setup shell saves through the narrow setup config API and revalidates readiness after the write", async () => {
  const setupConfigResponse = createDeferred<MockResponseLike>();
  const setupReadinessRefreshResponse = createDeferred<MockResponseLike>();
  const harness = createSetupHarness([
    {
      path: "/api/setup-readiness",
      response: jsonResponse({
        kind: "setup_readiness",
        managedRestart: unavailableManagedRestart,
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
        localCiContract: {
          configured: false,
          command: null,
          source: "config",
          summary: "No repo-owned local CI contract is configured.",
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
  const restartStatus = harness.document.getElementById("setup-restart-status");
  const restartDetails = harness.document.getElementById("setup-restart-details");
  assert.ok(repoPathInput);
  assert.ok(reviewProviderInput);
  assert.ok(setupForm);
  assert.ok(saveButton);
  assert.ok(saveStatus);
  assert.ok(restartStatus);
  assert.ok(restartDetails);

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
    managedRestart: unavailableManagedRestart,
    configPath: "/tmp/supervisor.config.json",
    backupPath: null,
    updatedFields: ["repoPath", "reviewProvider"],
    restartRequired: true,
    restartScope: "supervisor",
    restartTriggeredByFields: ["repoPath", "reviewProvider"],
    document: {
      repoPath: "/tmp/repo",
      reviewBotLogins: ["chatgpt-codex-connector"],
    },
    readiness: {
      kind: "setup_readiness",
      managedRestart: unavailableManagedRestart,
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
      localCiContract: {
        configured: true,
        command: "npm run ci:local",
        source: "config",
        summary: "Repo-owned local CI contract is configured.",
      },
    },
  }));
  await harness.flush();

  assert.equal(saveButton.disabled, true);
  assert.match(saveStatus.textContent, /Revalidating setup readiness\.\.\./u);

  setupReadinessRefreshResponse.resolve(jsonResponse({
    kind: "setup_readiness",
    managedRestart: unavailableManagedRestart,
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
    localCiContract: {
      configured: true,
      command: "npm run ci:local",
      source: "config",
      summary: "Repo-owned local CI contract is configured.",
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
  assert.match(restartStatus.textContent ?? "", /Restart required/u);
  assert.match(
    restartDetails.textContent ?? "",
    /Saved changes to repoPath, reviewProvider require a supervisor restart before they take effect\..*Restart now is unavailable for this unmanaged WebUI session\..*Restart the supervisor manually and then refresh this page\./u,
  );
  assert.match(harness.document.getElementById("setup-overall-status")?.textContent ?? "", /configured/u);
  assert.match(harness.document.getElementById("setup-blocker-summary")?.textContent ?? "", /No blocking setup conditions remain\./u);
  assert.match(harness.document.getElementById("setup-local-ci-summary")?.textContent ?? "", /Repo-owned local CI contract is configured\./u);
  assert.match(
    harness.document.getElementById("setup-local-ci-details")?.textContent ?? "",
    /Configured: yes.*Command: npm run ci:local.*Source: config.*This repo-owned command is the canonical local verification step before PR publication or update.*When configured local CI fails, PR publication or ready-for-review promotion stays blocked until the repo-owned command passes again\./u,
  );
  assert.equal(harness.remainingFetches.length, 0);
});

test("setup shell clears localCiCommand and revalidates back to the advisory recommendation state", async () => {
  const setupConfigResponse = createDeferred<MockResponseLike>();
  const setupReadinessRefreshResponse = createDeferred<MockResponseLike>();
  const harness = createSetupHarness([
    {
      path: "/api/setup-readiness",
      response: jsonResponse({
        kind: "setup_readiness",
        managedRestart: unavailableManagedRestart,
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
          {
            key: "localCiCommand",
            label: "Local CI command",
            state: "configured",
            value: "npm run ci:local",
            message: "Local CI command is configured.",
            required: false,
            metadata: {
              source: "config",
              editable: true,
              valueType: "text",
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
        localCiContract: {
          configured: true,
          command: "npm run ci:local",
          source: "config",
          summary: "Repo-owned local CI contract is configured.",
        },
      }),
    },
    {
      path: "/api/setup-config",
      method: "POST",
      body: JSON.stringify({
        changes: {
          repoPath: "/tmp/repo",
          localCiCommand: null,
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

  const localCiInput = harness.document.getElementById("setup-input-localCiCommand");
  const setupForm = harness.document.getElementById("setup-form");
  const saveButton = harness.document.getElementById("setup-save-button");
  const saveStatus = harness.document.getElementById("setup-save-status");
  assert.ok(localCiInput);
  assert.ok(setupForm);
  assert.ok(saveButton);
  assert.ok(saveStatus);

  localCiInput.value = "";
  const submitPromise = setupForm.dispatch("submit", {
    preventDefault() {},
  });
  await harness.flush();

  assert.equal(saveButton.disabled, true);
  assert.match(saveStatus.textContent, /Saving setup changes\.\.\./u);

  setupConfigResponse.resolve(jsonResponse({
    kind: "setup_config_update",
    managedRestart: unavailableManagedRestart,
    configPath: "/tmp/supervisor.config.json",
    backupPath: null,
    updatedFields: ["repoPath", "localCiCommand", "reviewProvider"],
    restartRequired: true,
    restartScope: "supervisor",
    restartTriggeredByFields: ["localCiCommand"],
    document: {
      repoPath: "/tmp/repo",
      reviewBotLogins: ["chatgpt-codex-connector"],
    },
    readiness: {
      kind: "setup_readiness",
      managedRestart: unavailableManagedRestart,
      ready: true,
      overallStatus: "configured",
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
      localCiContract: {
        configured: false,
        command: null,
        recommendedCommand: "npm run verify:pre-pr",
        source: "repo_script_candidate",
        summary:
          "Repo-owned local CI candidate exists but localCiCommand is unset. Recommended command: npm run verify:pre-pr.",
      },
    },
  }));
  await harness.flush();

  assert.match(saveStatus.textContent, /Revalidating setup readiness\.\.\./u);

  setupReadinessRefreshResponse.resolve(jsonResponse({
    kind: "setup_readiness",
    managedRestart: unavailableManagedRestart,
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
      {
        key: "localCiCommand",
        label: "Local CI command",
        state: "missing",
        value: null,
        message: "Local CI command is optional.",
        required: false,
        metadata: {
          source: "config",
          editable: true,
          valueType: "text",
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
    localCiContract: {
      configured: false,
      command: null,
      recommendedCommand: "npm run verify:pre-pr",
      source: "repo_script_candidate",
      summary:
        "Repo-owned local CI candidate exists but localCiCommand is unset. Recommended command: npm run verify:pre-pr.",
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
            localCiCommand: null,
            reviewProvider: "codex",
          },
        }),
      },
      { path: "/api/setup-readiness", method: "GET", body: null },
    ],
  );
  assert.equal(saveButton.disabled, false);
  assert.match(saveStatus.textContent ?? "", /Saved 3 setup fields\./u);
  assert.match(harness.document.getElementById("setup-local-ci-summary")?.textContent ?? "", /Repo-owned local CI candidate exists but localCiCommand is unset\. Recommended command: npm run verify:pre-pr\./u);
  assert.match(
    harness.document.getElementById("setup-local-ci-details")?.textContent ?? "",
    /Configured: no.*Command: none.*Source: repo script candidate.*Recommended command: npm run verify:pre-pr.*This repo already defines a repo-owned local CI entrypoint, but codex-supervisor will not run it until localCiCommand is configured\./u,
  );
  assert.equal(harness.remainingFetches.length, 0);
});

test("setup shell retries an authenticated save even when token storage is unavailable", async () => {
  const storage = new ThrowingStorage();
  const harness = createSetupHarness(
    [
      {
        path: "/api/setup-readiness",
        response: jsonResponse({
          kind: "setup_readiness",
          managedRestart: unavailableManagedRestart,
          ready: false,
          overallStatus: "missing",
          configPath: "/tmp/supervisor.config.json",
          fields: [
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
          blockers: [],
          hostReadiness: { overallStatus: "pass", checks: [] },
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
          localCiContract: {
            configured: false,
            command: null,
            source: "config",
            summary: "No repo-owned local CI contract is configured.",
          },
        }),
      },
      {
        path: "/api/setup-config",
        method: "POST",
        body: JSON.stringify({
          changes: {
            reviewProvider: "codex",
          },
        }),
        response: jsonResponse({ error: "Mutation auth required." }, 401),
      },
      {
        path: "/api/setup-config",
        method: "POST",
        body: JSON.stringify({
          changes: {
            reviewProvider: "codex",
          },
        }),
        response: jsonResponse({
          kind: "setup_config_update",
          managedRestart: unavailableManagedRestart,
          configPath: "/tmp/supervisor.config.json",
          backupPath: null,
          updatedFields: ["reviewProvider"],
          restartRequired: false,
          restartScope: null,
          restartTriggeredByFields: [],
          document: {
            reviewBotLogins: ["chatgpt-codex-connector"],
          },
          readiness: {
            kind: "setup_readiness",
            managedRestart: unavailableManagedRestart,
            ready: true,
            overallStatus: "configured",
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
            localCiContract: {
              configured: false,
              command: null,
              source: "config",
              summary: "No repo-owned local CI contract is configured.",
            },
          },
        }),
      },
      {
        path: "/api/setup-readiness",
        response: jsonResponse({
          kind: "setup_readiness",
          managedRestart: unavailableManagedRestart,
          ready: true,
          overallStatus: "configured",
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
          localCiContract: {
            configured: false,
            command: null,
            source: "config",
            summary: "No repo-owned local CI contract is configured.",
          },
        }),
      },
    ],
    {
      localStorage: storage,
      prompt: () => "prompted-secret",
    },
  );
  await harness.flush();

  const reviewProviderInput = harness.document.getElementById("setup-input-reviewProvider");
  const setupForm = harness.document.getElementById("setup-form");
  const saveStatus = harness.document.getElementById("setup-save-status");
  assert.ok(reviewProviderInput);
  assert.ok(setupForm);
  assert.ok(saveStatus);

  reviewProviderInput.value = "codex";
  const submitPromise = setupForm.dispatch("submit", { preventDefault() {} });
  await submitPromise;
  await harness.flush();

  assert.equal(harness.fetchCalls[1]?.headers?.[WEBUI_MUTATION_AUTH_HEADER], undefined);
  assert.equal(harness.fetchCalls[2]?.headers?.[WEBUI_MUTATION_AUTH_HEADER], "prompted-secret");
  assert.match(saveStatus.textContent ?? "", /Saved 1 setup field\./u);
  assert.equal(harness.remainingFetches.length, 0);
});

test("setup shell does not prompt for a fresh token after the final 401 response", async () => {
  let promptCount = 0;
  const harness = createSetupHarness(
    [
      {
        path: "/api/setup-readiness",
        response: jsonResponse({
          kind: "setup_readiness",
          managedRestart: unavailableManagedRestart,
          ready: false,
          overallStatus: "missing",
          configPath: "/tmp/supervisor.config.json",
          fields: [
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
          blockers: [],
          hostReadiness: { overallStatus: "pass", checks: [] },
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
          localCiContract: {
            configured: false,
            command: null,
            source: "config",
            summary: "No repo-owned local CI contract is configured.",
          },
        }),
      },
      {
        path: "/api/setup-config",
        method: "POST",
        body: JSON.stringify({
          changes: {
            reviewProvider: "codex",
          },
        }),
        response: jsonResponse({ error: "Mutation auth required." }, 401),
      },
      {
        path: "/api/setup-config",
        method: "POST",
        body: JSON.stringify({
          changes: {
            reviewProvider: "codex",
          },
        }),
        response: jsonResponse({ error: "Mutation auth required." }, 401),
      },
    ],
    {
      prompt: () => {
        promptCount += 1;
        return "prompted-secret";
      },
    },
  );
  await harness.flush();

  const reviewProviderInput = harness.document.getElementById("setup-input-reviewProvider");
  const setupForm = harness.document.getElementById("setup-form");
  const saveStatus = harness.document.getElementById("setup-save-status");
  assert.ok(reviewProviderInput);
  assert.ok(setupForm);
  assert.ok(saveStatus);

  reviewProviderInput.value = "codex";
  const submitPromise = setupForm.dispatch("submit", { preventDefault() {} });
  await submitPromise;
  await harness.flush();

  assert.equal(promptCount, 1);
  assert.match(saveStatus.textContent ?? "", /Setup save failed: \/api\/setup-config: Mutation auth required\./u);
  assert.equal(harness.remainingFetches.length, 0);
});

test("setup shell distinguishes saved changes that are already effective", async () => {
  const setupConfigResponse = createDeferred<MockResponseLike>();
  const setupReadinessRefreshResponse = createDeferred<MockResponseLike>();
  const harness = createSetupHarness([
    {
      path: "/api/setup-readiness",
      response: jsonResponse({
        kind: "setup_readiness",
        managedRestart: unavailableManagedRestart,
        ready: true,
        overallStatus: "configured",
        configPath: "/tmp/supervisor.config.json",
        fields: [
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
        localCiContract: {
          configured: true,
          command: "npm run ci:local",
          source: "config",
          summary: "Repo-owned local CI contract is configured.",
        },
      }),
    },
    {
      path: "/api/setup-config",
      method: "POST",
      body: JSON.stringify({
        changes: {
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

  const reviewProviderInput = harness.document.getElementById("setup-input-reviewProvider");
  const setupForm = harness.document.getElementById("setup-form");
  const restartStatus = harness.document.getElementById("setup-restart-status");
  const restartDetails = harness.document.getElementById("setup-restart-details");
  assert.ok(reviewProviderInput);
  assert.ok(setupForm);
  assert.ok(restartStatus);
  assert.ok(restartDetails);

  reviewProviderInput.value = "codex";
  const submitPromise = setupForm.dispatch("submit", {
    preventDefault() {},
  });
  await harness.flush();

  setupConfigResponse.resolve(jsonResponse({
    kind: "setup_config_update",
    managedRestart: unavailableManagedRestart,
    configPath: "/tmp/supervisor.config.json",
    backupPath: null,
    updatedFields: ["reviewProvider"],
    restartRequired: false,
    restartScope: null,
    restartTriggeredByFields: [],
    document: {
      reviewBotLogins: ["chatgpt-codex-connector"],
    },
    readiness: {
      kind: "setup_readiness",
      managedRestart: unavailableManagedRestart,
      ready: true,
      overallStatus: "configured",
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
      localCiContract: {
        configured: true,
        command: "npm run ci:local",
        source: "config",
        summary: "Repo-owned local CI contract is configured.",
      },
    },
  }));
  await harness.flush();

  setupReadinessRefreshResponse.resolve(jsonResponse({
    kind: "setup_readiness",
    managedRestart: unavailableManagedRestart,
    ready: true,
    overallStatus: "configured",
    configPath: "/tmp/supervisor.config.json",
    fields: [
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
    localCiContract: {
      configured: true,
      command: "npm run ci:local",
      source: "config",
      summary: "Repo-owned local CI contract is configured.",
    },
  }));

  await submitPromise;
  await harness.flush();

  assert.match(restartStatus.textContent ?? "", /Saved and effective/u);
  assert.match(
    restartDetails.textContent ?? "",
    /Saved changes to reviewProvider are already effective\..*No supervisor restart is required for this save\./u,
  );
  assert.equal(harness.remainingFetches.length, 0);
});

test("setup shell enables launcher-managed restart only when the runtime capability is available", async () => {
  const setupConfigResponse = createDeferred<MockResponseLike>();
  const setupReadinessRefreshResponse = createDeferred<MockResponseLike>();
  const managedRestartResponse = createDeferred<MockResponseLike>();
  const reconnectedReadinessResponse = createDeferred<MockResponseLike>();
  const harness = createSetupHarness([
    {
      path: "/api/setup-readiness",
      response: jsonResponse({
        kind: "setup_readiness",
        managedRestart: {
          supported: true,
          launcher: "systemd",
          state: "ready",
          summary: "Managed restart is available through the systemd launcher.",
        },
        ready: false,
        overallStatus: "missing",
        configPath: "/tmp/supervisor.config.json",
        fields: [
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
        blockers: [],
        hostReadiness: { overallStatus: "pass", checks: [] },
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
        localCiContract: {
          configured: false,
          command: null,
          source: "config",
          summary: "No repo-owned local CI contract is configured.",
        },
      }),
    },
    {
      path: "/api/setup-config",
      method: "POST",
      body: JSON.stringify({
        changes: {
          reviewProvider: "codex",
        },
      }),
      response: setupConfigResponse.promise,
    },
    {
      path: "/api/setup-readiness",
      response: setupReadinessRefreshResponse.promise,
    },
    {
      path: "/api/commands/managed-restart",
      method: "POST",
      body: JSON.stringify({}),
      response: managedRestartResponse.promise,
    },
    {
      path: "/api/setup-readiness",
      response: reconnectedReadinessResponse.promise,
    },
  ]);
  await harness.flush();

  const reviewProviderInput = harness.document.getElementById("setup-input-reviewProvider");
  const setupForm = harness.document.getElementById("setup-form");
  const restartButton = harness.document.getElementById("setup-restart-button");
  const restartGuidance = harness.document.getElementById("setup-restart-guidance");
  assert.ok(reviewProviderInput);
  assert.ok(setupForm);
  assert.ok(restartButton);
  assert.ok(restartGuidance);

  reviewProviderInput.value = "codex";
  const submitPromise = setupForm.dispatch("submit", { preventDefault() {} });
  await harness.flush();

  setupConfigResponse.resolve(jsonResponse({
    kind: "setup_config_update",
    managedRestart: {
      supported: true,
      launcher: "systemd",
      state: "ready",
      summary: "Managed restart is available through the systemd launcher.",
    },
    configPath: "/tmp/supervisor.config.json",
    backupPath: null,
    updatedFields: ["reviewProvider"],
    restartRequired: true,
    restartScope: "supervisor",
    restartTriggeredByFields: ["reviewProvider"],
    document: {
      reviewBotLogins: ["chatgpt-codex-connector"],
    },
    readiness: {
      kind: "setup_readiness",
      managedRestart: {
        supported: true,
        launcher: "systemd",
        state: "ready",
        summary: "Managed restart is available through the systemd launcher.",
      },
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
      localCiContract: {
        configured: false,
        command: null,
        source: "config",
        summary: "No repo-owned local CI contract is configured.",
      },
    },
  }));
  await harness.flush();

  setupReadinessRefreshResponse.resolve(jsonResponse({
    kind: "setup_readiness",
    managedRestart: {
      supported: true,
      launcher: "systemd",
      state: "ready",
      summary: "Managed restart is available through the systemd launcher.",
    },
    ready: true,
    overallStatus: "configured",
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
    localCiContract: {
      configured: false,
      command: null,
      source: "config",
      summary: "No repo-owned local CI contract is configured.",
    },
  }));

  await submitPromise;
  await harness.flush();

  assert.equal(restartButton.disabled, false);
  assert.match(restartGuidance.textContent ?? "", /Managed restart is available through the systemd launcher\./u);

  const restartPromise = restartButton.dispatch("click");
  await harness.flush();
  managedRestartResponse.resolve(jsonResponse({
    command: "managed-restart",
    accepted: true,
    summary: "Managed restart requested through the systemd launcher. The worker is reconnecting while this WebUI shell stays available.",
  }));
  await restartPromise;
  await harness.flush();

  reconnectedReadinessResponse.resolve(jsonResponse({
    kind: "setup_readiness",
    managedRestart: {
      supported: true,
      launcher: "systemd",
      state: "ready",
      summary: "Managed restart is available through the systemd launcher.",
    },
    ready: true,
    overallStatus: "configured",
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
    localCiContract: {
      configured: false,
      command: null,
      source: "config",
      summary: "No repo-owned local CI contract is configured.",
    },
  }));
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
            reviewProvider: "codex",
          },
        }),
      },
      { path: "/api/setup-readiness", method: "GET", body: null },
      { path: "/api/commands/managed-restart", method: "POST", body: JSON.stringify({}) },
      { path: "/api/setup-readiness", method: "GET", body: null },
    ],
  );
  assert.match(
    restartGuidance.textContent ?? "",
    /Managed restart is available through the systemd launcher\./u,
  );
  assert.equal(restartButton.disabled, true);
  assert.equal(harness.remainingFetches.length, 0);
});

test("setup shell refreshes readiness after launcher-managed restart until the worker reconnects", async () => {
  const setupConfigResponse = createDeferred<MockResponseLike>();
  const setupReadinessRefreshResponse = createDeferred<MockResponseLike>();
  const managedRestartResponse = createDeferred<MockResponseLike>();
  const reconnectingReadinessResponse = createDeferred<MockResponseLike>();
  const unavailableReadinessResponse = createDeferred<MockResponseLike>();
  const reconnectedReadinessResponse = createDeferred<MockResponseLike>();
  const harness = createSetupHarness([
    {
      path: "/api/setup-readiness",
      response: jsonResponse({
        kind: "setup_readiness",
        managedRestart: {
          supported: true,
          launcher: "systemd",
          state: "ready",
          summary: "Managed restart is available through the systemd launcher.",
        },
        ready: false,
        overallStatus: "missing",
        configPath: "/tmp/supervisor.config.json",
        fields: [
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
        blockers: [],
        hostReadiness: { overallStatus: "pass", checks: [] },
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
        localCiContract: {
          configured: false,
          command: null,
          source: "config",
          summary: "No repo-owned local CI contract is configured.",
        },
      }),
    },
    {
      path: "/api/setup-config",
      method: "POST",
      body: JSON.stringify({
        changes: {
          reviewProvider: "codex",
        },
      }),
      response: setupConfigResponse.promise,
    },
    {
      path: "/api/setup-readiness",
      response: setupReadinessRefreshResponse.promise,
    },
    {
      path: "/api/commands/managed-restart",
      method: "POST",
      body: JSON.stringify({}),
      response: managedRestartResponse.promise,
    },
    {
      path: "/api/setup-readiness",
      response: reconnectingReadinessResponse.promise,
    },
    {
      path: "/api/setup-readiness",
      response: unavailableReadinessResponse.promise,
    },
    {
      path: "/api/setup-readiness",
      response: reconnectedReadinessResponse.promise,
    },
  ]);
  await harness.flush();

  const reviewProviderInput = harness.document.getElementById("setup-input-reviewProvider");
  const setupForm = harness.document.getElementById("setup-form");
  const restartButton = harness.document.getElementById("setup-restart-button");
  const restartStatus = harness.document.getElementById("setup-restart-status");
  const restartDetails = harness.document.getElementById("setup-restart-details");
  const restartGuidance = harness.document.getElementById("setup-restart-guidance");
  assert.ok(reviewProviderInput);
  assert.ok(setupForm);
  assert.ok(restartButton);
  assert.ok(restartStatus);
  assert.ok(restartDetails);
  assert.ok(restartGuidance);

  reviewProviderInput.value = "codex";
  const submitPromise = setupForm.dispatch("submit", { preventDefault() {} });
  await harness.flush();

  setupConfigResponse.resolve(jsonResponse({
    kind: "setup_config_update",
    managedRestart: {
      supported: true,
      launcher: "systemd",
      state: "ready",
      summary: "Managed restart is available through the systemd launcher.",
    },
    configPath: "/tmp/supervisor.config.json",
    backupPath: null,
    updatedFields: ["reviewProvider"],
    restartRequired: true,
    restartScope: "supervisor",
    restartTriggeredByFields: ["reviewProvider"],
    document: {
      reviewBotLogins: ["chatgpt-codex-connector"],
    },
    readiness: {
      kind: "setup_readiness",
      managedRestart: {
        supported: true,
        launcher: "systemd",
        state: "ready",
        summary: "Managed restart is available through the systemd launcher.",
      },
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
      localCiContract: {
        configured: false,
        command: null,
        source: "config",
        summary: "No repo-owned local CI contract is configured.",
      },
    },
  }));
  await harness.flush();

  setupReadinessRefreshResponse.resolve(jsonResponse({
    kind: "setup_readiness",
    managedRestart: {
      supported: true,
      launcher: "systemd",
      state: "ready",
      summary: "Managed restart is available through the systemd launcher.",
    },
    ready: true,
    overallStatus: "configured",
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
    localCiContract: {
      configured: false,
      command: null,
      source: "config",
      summary: "No repo-owned local CI contract is configured.",
    },
  }));

  await submitPromise;
  await harness.flush();

  const restartPromise = restartButton.dispatch("click");
  await harness.flush();
  managedRestartResponse.resolve(jsonResponse({
    command: "managed-restart",
    accepted: true,
    summary: "Managed restart requested through the systemd launcher. The worker is reconnecting while this WebUI shell stays available.",
  }));
  await restartPromise;
  await harness.flush();

  reconnectingReadinessResponse.resolve(jsonResponse({
    kind: "setup_readiness",
    managedRestart: {
      supported: true,
      launcher: "systemd",
      state: "reconnecting",
      summary: "Managed restart is reconnecting the worker through the systemd launcher while this WebUI shell stays available.",
    },
    ready: true,
    overallStatus: "configured",
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
    localCiContract: {
      configured: false,
      command: null,
      source: "config",
      summary: "No repo-owned local CI contract is configured.",
    },
  }));
  await harness.flush();

  assert.match(restartStatus.textContent ?? "", /Restart required/u);
  assert.match(restartGuidance.textContent ?? "", /reconnecting the worker/u);

  await harness.advanceTime(50);

  unavailableReadinessResponse.resolve(jsonResponse({
    kind: "setup_readiness",
    managedRestart: {
      supported: false,
      launcher: null,
      state: "unavailable",
      summary: "Managed restart is temporarily unavailable while the worker is still reconnecting.",
    },
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
    localCiContract: {
      configured: false,
      command: null,
      source: "config",
      summary: "No repo-owned local CI contract is configured.",
    },
  }));
  await harness.flush();

  assert.match(restartStatus.textContent ?? "", /Restart required/u);
  assert.match(restartGuidance.textContent ?? "", /temporarily unavailable while the worker is still reconnecting/u);

  await harness.advanceTime(100);

  reconnectedReadinessResponse.resolve(jsonResponse({
    kind: "setup_readiness",
    managedRestart: {
      supported: true,
      launcher: "systemd",
      state: "ready",
      summary: "Managed restart is available through the systemd launcher.",
    },
    ready: true,
    overallStatus: "configured",
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
    localCiContract: {
      configured: false,
      command: null,
      source: "config",
      summary: "No repo-owned local CI contract is configured.",
    },
  }));
  await harness.flush();

  assert.match(restartStatus.textContent ?? "", /Saved and effective/u);
  assert.match(
    restartDetails.textContent ?? "",
    /Saved changes to reviewProvider are already effective\..*No supervisor restart is required for this save\./u,
  );
  assert.match(restartGuidance.textContent ?? "", /Managed restart is available through the systemd launcher\./u);
  assert.deepEqual(
    harness.fetchCalls.map((call) => ({ path: call.path, method: call.method, body: call.body })),
    [
      { path: "/api/setup-readiness", method: "GET", body: null },
      {
        path: "/api/setup-config",
        method: "POST",
        body: JSON.stringify({
          changes: {
            reviewProvider: "codex",
          },
        }),
      },
      { path: "/api/setup-readiness", method: "GET", body: null },
      { path: "/api/commands/managed-restart", method: "POST", body: JSON.stringify({}) },
      { path: "/api/setup-readiness", method: "GET", body: null },
      { path: "/api/setup-readiness", method: "GET", body: null },
      { path: "/api/setup-readiness", method: "GET", body: null },
    ],
  );
  assert.equal(harness.remainingFetches.length, 0);
});

test("setup shell backs off reconnect polling after repeated readiness failures", async () => {
  const setupConfigResponse = createDeferred<MockResponseLike>();
  const setupReadinessRefreshResponse = createDeferred<MockResponseLike>();
  const managedRestartResponse = createDeferred<MockResponseLike>();
  const harness = createSetupHarness([
    {
      path: "/api/setup-readiness",
      response: jsonResponse({
        kind: "setup_readiness",
        managedRestart: {
          supported: true,
          launcher: "systemd",
          state: "ready",
          summary: "Managed restart is available through the systemd launcher.",
        },
        ready: false,
        overallStatus: "missing",
        configPath: "/tmp/supervisor.config.json",
        fields: [
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
        blockers: [],
        hostReadiness: { overallStatus: "pass", checks: [] },
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
        localCiContract: {
          configured: false,
          command: null,
          source: "config",
          summary: "No repo-owned local CI contract is configured.",
        },
      }),
    },
    {
      path: "/api/setup-config",
      method: "POST",
      body: JSON.stringify({
        changes: {
          reviewProvider: "codex",
        },
      }),
      response: setupConfigResponse.promise,
    },
    {
      path: "/api/setup-readiness",
      response: setupReadinessRefreshResponse.promise,
    },
    {
      path: "/api/commands/managed-restart",
      method: "POST",
      body: JSON.stringify({}),
      response: managedRestartResponse.promise,
    },
    {
      path: "/api/setup-readiness",
      response: jsonResponse({ error: "setup reconnect attempt 1 failed" }, 503),
    },
    {
      path: "/api/setup-readiness",
      response: jsonResponse({ error: "setup reconnect attempt 2 failed" }, 503),
    },
    {
      path: "/api/setup-readiness",
      response: jsonResponse({ error: "setup reconnect attempt 3 failed" }, 503),
    },
    {
      path: "/api/setup-readiness",
      response: jsonResponse({ error: "setup reconnect attempt 4 failed" }, 503),
    },
  ]);
  await harness.flush();

  const reviewProviderInput = harness.document.getElementById("setup-input-reviewProvider");
  const setupForm = harness.document.getElementById("setup-form");
  const restartButton = harness.document.getElementById("setup-restart-button");
  const restartGuidance = harness.document.getElementById("setup-restart-guidance");
  assert.ok(reviewProviderInput);
  assert.ok(setupForm);
  assert.ok(restartButton);
  assert.ok(restartGuidance);

  reviewProviderInput.value = "codex";
  const submitPromise = setupForm.dispatch("submit", { preventDefault() {} });
  await harness.flush();

  setupConfigResponse.resolve(jsonResponse({
    kind: "setup_config_update",
    managedRestart: {
      supported: true,
      launcher: "systemd",
      state: "ready",
      summary: "Managed restart is available through the systemd launcher.",
    },
    configPath: "/tmp/supervisor.config.json",
    backupPath: null,
    updatedFields: ["reviewProvider"],
    restartRequired: true,
    restartScope: "supervisor",
    restartTriggeredByFields: ["reviewProvider"],
    document: {
      reviewBotLogins: ["chatgpt-codex-connector"],
    },
    readiness: {
      kind: "setup_readiness",
      managedRestart: {
        supported: true,
        launcher: "systemd",
        state: "ready",
        summary: "Managed restart is available through the systemd launcher.",
      },
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
      localCiContract: {
        configured: false,
        command: null,
        source: "config",
        summary: "No repo-owned local CI contract is configured.",
      },
    },
  }));
  await harness.flush();

  setupReadinessRefreshResponse.resolve(jsonResponse({
    kind: "setup_readiness",
    managedRestart: {
      supported: true,
      launcher: "systemd",
      state: "ready",
      summary: "Managed restart is available through the systemd launcher.",
    },
    ready: true,
    overallStatus: "configured",
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
    localCiContract: {
      configured: false,
      command: null,
      source: "config",
      summary: "No repo-owned local CI contract is configured.",
    },
  }));
  await submitPromise;
  await harness.flush();

  const restartPromise = restartButton.dispatch("click");
  await harness.flush();
  managedRestartResponse.resolve(jsonResponse({
    command: "managed-restart",
    accepted: true,
    summary: "Managed restart requested through the systemd launcher. The worker is reconnecting while this WebUI shell stays available.",
  }));
  await restartPromise;
  await harness.flush();

  assert.equal(harness.fetchCalls.filter((call) => call.path === "/api/setup-readiness").length, 3);
  assert.match(restartGuidance.textContent ?? "", /setup reconnect attempt 1 failed/u);

  await harness.advanceTime(49);
  assert.equal(harness.fetchCalls.filter((call) => call.path === "/api/setup-readiness").length, 3);

  await harness.advanceTime(1);
  assert.equal(harness.fetchCalls.filter((call) => call.path === "/api/setup-readiness").length, 4);
  assert.match(restartGuidance.textContent ?? "", /setup reconnect attempt 2 failed/u);

  await harness.advanceTime(99);
  assert.equal(harness.fetchCalls.filter((call) => call.path === "/api/setup-readiness").length, 4);

  await harness.advanceTime(1);
  assert.equal(harness.fetchCalls.filter((call) => call.path === "/api/setup-readiness").length, 5);
  assert.match(restartGuidance.textContent ?? "", /setup reconnect attempt 3 failed/u);
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
