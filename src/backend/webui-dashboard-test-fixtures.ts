import assert from "node:assert/strict";
import { setImmediate as waitForTurn } from "node:timers/promises";
import vm from "node:vm";
import { renderSupervisorDashboardHtml } from "./webui-dashboard";
import { renderSupervisorSetupHtml } from "./webui-setup";
import { DASHBOARD_PANEL_REGISTRY } from "./webui-dashboard-panel-layout";

export interface MockResponseLike {
  ok: boolean;
  status?: number;
  headers?: { get(name: string): string | null };
  json(): Promise<unknown>;
  text(): Promise<string>;
}

export interface FetchCall {
  path: string;
  method: string;
  body: string | null;
  headers: Record<string, string> | null;
}

export interface QueuedFetchResponse {
  path: string;
  method?: string;
  body?: string;
  response: MockResponseLike | Promise<MockResponseLike>;
}

export interface Deferred<T> {
  promise: Promise<T>;
  resolve(value: T | PromiseLike<T>): void;
  reject(reason?: unknown): void;
}

interface ManualTimerController {
  setTimeout(callback: () => void, delay?: number): number;
  clearTimeout(id: number): void;
  advanceTime(ms: number): Promise<void>;
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

export class FakeElement {
  readonly children: FakeElement[] = [];
  readonly classList = new FakeClassList(this);
  readonly listeners = new Map<string, Array<(event: unknown) => unknown>>();

  parentElement: FakeElement | null = null;
  hidden = false;
  value = "";
  disabled = false;
  type = "";
  open?: boolean;

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
    this.textContentValue = "";
    this.children.length = 0;
    if (value !== "") {
      this.innerHtmlValue = "";
      throw new Error(
        "FakeElement.innerHTML only supports clearing content; extend the fake DOM before using markup writes.",
      );
    }
    this.innerHtmlValue = value;
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

export class FakeStorage {
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

export class ThrowingStorage extends FakeStorage {
  setItem(): void {
    throw new Error("setItem failed");
  }

  removeItem(): void {
    throw new Error("removeItem failed");
  }
}

export class MockEventSource {
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

export function createDeferred<T>(): Deferred<T> {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

export function jsonResponse(body: unknown, statusCode = 200): MockResponseLike {
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

export function textResponse(body: string, statusCode = 200, contentType = "text/plain; charset=utf-8"): MockResponseLike {
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

export function createDashboardStatusFixture(args: {
  selectedIssueNumber?: number | null;
  includeWhyLines?: boolean;
  detailedStatusLines?: string[];
  localCiContract?: {
    configured: boolean;
    command: string | null;
    recommendedCommand?: string | null;
    source: "config" | "repo_script_candidate" | "dismissed_repo_script_candidate";
    summary: string;
  } | null;
  loopRuntime?: {
    state: "running" | "off" | "unknown";
    hostMode?: "tmux" | "direct" | "unknown";
    markerPath?: string | null;
    configPath?: string | null;
    stateFile?: string | null;
    pid: number | null;
    startedAt: string | null;
    ownershipConfidence?: "none" | "live_lock" | "stale_lock" | "ambiguous_owner" | "duplicate_suspected" | null;
    detail: string | null;
    recoveryGuidance?: string | null;
    duplicateLoopDiagnostic?: {
      kind: string;
      status: string;
      matchingProcessCount: number;
      matchingPids: number[];
      configPath: string;
      stateFile: string;
      recoveryGuidance?: string | null;
    };
  } | null;
  runtimeRecoverySummary?: {
    loopState: string;
    lockConfidence: string;
    trackedRecords: Array<{
      issueNumber: number;
      state: string;
      prNumber: number | null;
      blockedReason: string | null;
    }>;
    signals: Array<{
      kind: string;
      summary: string;
    }>;
    recommendation: {
      category: string;
      source: string;
      summary: string;
    } | null;
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
  warning?: {
    message: string;
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
        hostMode: "unknown",
        markerPath: "none",
        configPath: null,
        stateFile: "none",
        pid: null,
        startedAt: null,
        ownershipConfidence: "none",
        detail: null,
      },
    runtimeRecoverySummary: args.runtimeRecoverySummary ?? null,
    reconciliationPhase: null,
    warning: args.warning ?? null,
    detailedStatusLines: args.detailedStatusLines ?? [],
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

export function createDashboardDoctorFixture() {
  return {
    overallStatus: "pass",
    decisionSummary: {
      action: "continue",
      summary: "No active risk or maintenance blocker was detected; continue normal supervisor operation.",
    },
    diagnosticTiers: {
      active_risk: [],
      maintenance: [],
      informational: [],
    },
    checks: [{ name: "github_auth", status: "pass", summary: "GitHub auth ok." }],
  };
}

export function createDashboardExplainFixture(issueNumber: number, overrides: Record<string, unknown> = {}) {
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

export function createDashboardIssueLintFixture(issueNumber: number) {
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

function normalizeQueuedResponse(
  response: MockResponseLike | Promise<MockResponseLike> | unknown,
  statusCode = 200,
): MockResponseLike | Promise<MockResponseLike> {
  if (
    response instanceof Promise ||
    (typeof response === "object" && response !== null && "json" in response && "text" in response)
  ) {
    return response as MockResponseLike | Promise<MockResponseLike>;
  }
  return jsonResponse(response, statusCode);
}

export function createDashboardServerFixture() {
  return {
    page(args: {
      status?: ReturnType<typeof createDashboardStatusFixture> | MockResponseLike | Promise<MockResponseLike>;
      doctor?: ReturnType<typeof createDashboardDoctorFixture> | MockResponseLike | Promise<MockResponseLike>;
      statusCode?: number;
      doctorStatusCode?: number;
    } = {}): QueuedFetchResponse[] {
      return [
        {
          path: "/api/status?why=true",
          response: normalizeQueuedResponse(args.status ?? createDashboardStatusFixture(), args.statusCode),
        },
        {
          path: "/api/doctor",
          response: normalizeQueuedResponse(args.doctor ?? createDashboardDoctorFixture(), args.doctorStatusCode),
        },
      ];
    },
    issue(
      issueNumber: number,
      args: {
        explain?: ReturnType<typeof createDashboardExplainFixture> | MockResponseLike | Promise<MockResponseLike>;
        issueLint?: ReturnType<typeof createDashboardIssueLintFixture> | MockResponseLike | Promise<MockResponseLike>;
        explainStatusCode?: number;
        issueLintStatusCode?: number;
      } = {},
    ): QueuedFetchResponse[] {
      return [
        {
          path: `/api/issues/${issueNumber}/explain`,
          response: normalizeQueuedResponse(
            args.explain ?? createDashboardExplainFixture(issueNumber),
            args.explainStatusCode,
          ),
        },
        {
          path: `/api/issues/${issueNumber}/issue-lint`,
          response: normalizeQueuedResponse(
            args.issueLint ?? createDashboardIssueLintFixture(issueNumber),
            args.issueLintStatusCode,
          ),
        },
      ];
    },
    command(
      path: string,
      result: MockResponseLike | Promise<MockResponseLike> | unknown,
      args: { method?: string; body?: string; statusCode?: number } = {},
    ): QueuedFetchResponse {
      return {
        path,
        method: args.method ?? "POST",
        body: args.body,
        response: normalizeQueuedResponse(result, args.statusCode),
      };
    },
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

export function createDashboardHarness(
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

export function createSetupHarness(
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

  const localStorage = options.localStorage ?? new FakeStorage();
  const prompt = options.prompt ?? (() => null);
  const confirm = options.confirm ?? (() => true);
  const setTimeoutFn = options.manualTimers?.setTimeout ?? setTimeout;
  const clearTimeoutFn = options.manualTimers?.clearTimeout ?? clearTimeout;
  const window = {
    confirm,
    prompt,
    document,
    EventSource: MockEventSource,
    fetch,
    setTimeout: setTimeoutFn,
    clearTimeout: clearTimeoutFn,
    localStorage,
  };
  const context = {
    console,
    Date,
    document: window.document,
    EventSource: window.EventSource,
    fetch: window.fetch,
    setTimeout: window.setTimeout,
    clearTimeout: window.clearTimeout,
    confirm: window.confirm,
    prompt: window.prompt,
    window,
    localStorage: window.localStorage,
  };

  vm.runInNewContext(extractInlineScript(html), context);

  return {
    context,
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
