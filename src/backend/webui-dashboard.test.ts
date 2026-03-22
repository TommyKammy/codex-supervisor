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

  value = "";
  disabled = false;

  private classNameValue = "";
  private innerHtmlValue = "";
  private textContentValue = "";

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

function extractDashboardScript(html: string): string {
  const match = html.match(/<script>([\s\S]+)<\/script>/u);
  if (!match) {
    throw new Error("Expected the dashboard HTML to contain an inline script.");
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
  } = {},
) {
  MockEventSource.instances.length = 0;
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
      confirm: options.confirm ?? (() => true),
    },
  };

  vm.runInNewContext(extractDashboardScript(html), context);

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

test("dashboard renders typed tracked and blocked issue context without relying on flat status lines", async () => {
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

  assert.match(statusLines.textContent, /tracked issue #58 \[queued\] branch=codex\/issue-58 pr=#58/u);
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

test("dashboard lets operators inspect typed runnable and blocked issues without manual number entry", async () => {
  const harness = createDashboardHarness([
    {
      path: "/api/status?why=true",
      response: jsonResponse(
        createStatus({
          includeWhyLines: false,
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
  assert.match(timelineText, /active issue #42 -> #77 \(reserved_for_cycle\)/u);
  assert.match(timelineText, /after run-once/u);
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

  const recoveryEntry = findChildByText(operatorTimeline, /recovery for issue #99/u);
  assert.ok(recoveryEntry);
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
