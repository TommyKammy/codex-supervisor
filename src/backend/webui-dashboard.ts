export function renderSupervisorDashboardHtml(): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>codex-supervisor operator dashboard</title>
    <style>
      :root {
        color-scheme: light;
        --bg: #f4efe5;
        --bg-accent: #e7dcc8;
        --panel: rgba(255, 252, 246, 0.92);
        --panel-strong: #fffaf1;
        --border: rgba(48, 41, 30, 0.14);
        --text: #1f1a14;
        --muted: #655b4d;
        --danger: #a33a2b;
        --warn: #a06712;
        --ok: #24613d;
        --accent: #0f6c78;
        --accent-strong: #0b4d56;
        --shadow: 0 18px 50px rgba(62, 43, 18, 0.12);
        font-family: "IBM Plex Sans", "Avenir Next", "Segoe UI", sans-serif;
      }

      * {
        box-sizing: border-box;
      }

      body {
        margin: 0;
        min-height: 100vh;
        color: var(--text);
        background:
          radial-gradient(circle at top left, rgba(15, 108, 120, 0.16), transparent 35%),
          radial-gradient(circle at top right, rgba(160, 103, 18, 0.14), transparent 32%),
          linear-gradient(180deg, var(--bg) 0%, #f8f4ec 100%);
      }

      .shell {
        width: min(1200px, calc(100vw - 32px));
        margin: 0 auto;
        padding: 28px 0 40px;
      }

      .hero {
        display: grid;
        gap: 16px;
        padding: 28px;
        border: 1px solid var(--border);
        border-radius: 24px;
        background:
          linear-gradient(135deg, rgba(255, 255, 255, 0.9), rgba(247, 239, 222, 0.92)),
          linear-gradient(135deg, rgba(15, 108, 120, 0.05), rgba(160, 103, 18, 0.06));
        box-shadow: var(--shadow);
      }

      .hero h1 {
        margin: 0;
        font-family: "Iowan Old Style", "Palatino Linotype", serif;
        font-size: clamp(2rem, 4vw, 3.5rem);
        line-height: 0.96;
        letter-spacing: -0.04em;
      }

      .hero p {
        margin: 0;
        max-width: 70ch;
        color: var(--muted);
        font-size: 1rem;
      }

      .hero-bar {
        display: flex;
        flex-wrap: wrap;
        gap: 10px;
        align-items: center;
      }

      .badge {
        display: inline-flex;
        align-items: center;
        gap: 8px;
        padding: 8px 12px;
        border-radius: 999px;
        border: 1px solid var(--border);
        background: rgba(255, 255, 255, 0.75);
        color: var(--muted);
        font-size: 0.9rem;
      }

      .badge strong {
        color: var(--text);
      }

      .grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
        gap: 16px;
        margin-top: 18px;
      }

      .panel {
        border: 1px solid var(--border);
        border-radius: 20px;
        background: var(--panel);
        box-shadow: var(--shadow);
        overflow: hidden;
      }

      .panel-header {
        display: flex;
        justify-content: space-between;
        gap: 12px;
        align-items: center;
        padding: 18px 20px 10px;
      }

      .panel-header h2 {
        margin: 0;
        font-size: 1rem;
        text-transform: uppercase;
        letter-spacing: 0.08em;
      }

      .panel-body {
        padding: 0 20px 20px;
      }

      .metric {
        font-size: 1.8rem;
        font-weight: 700;
      }

      .metric.ok {
        color: var(--ok);
      }

      .metric.warn {
        color: var(--warn);
      }

      .metric.fail {
        color: var(--danger);
      }

      .stack {
        display: grid;
        gap: 10px;
      }

      .row {
        display: grid;
        gap: 6px;
      }

      .row-label {
        color: var(--muted);
        font-size: 0.85rem;
        text-transform: uppercase;
        letter-spacing: 0.08em;
      }

      .list {
        margin: 0;
        padding-left: 18px;
      }

      .list li + li {
        margin-top: 6px;
      }

      .code,
      pre {
        margin: 0;
        border-radius: 14px;
        padding: 14px;
        background: rgba(31, 26, 20, 0.94);
        color: #f5ede1;
        overflow: auto;
        font: 0.87rem/1.55 "Iosevka Term", "SFMono-Regular", monospace;
      }

      .toolbar {
        display: flex;
        flex-wrap: wrap;
        gap: 10px;
        align-items: center;
      }

      .shortcut-list {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
        gap: 10px;
      }

      .shortcut-button {
        width: 100%;
        padding: 12px 14px;
        border-radius: 14px;
        border: 1px solid var(--border);
        background: rgba(255, 255, 255, 0.78);
        color: var(--text);
        font: inherit;
        text-align: left;
        cursor: pointer;
      }

      .shortcut-button:hover {
        border-color: rgba(15, 108, 120, 0.35);
        background: rgba(255, 255, 255, 0.92);
      }

      .toolbar input {
        min-width: 180px;
        padding: 12px 14px;
        border-radius: 12px;
        border: 1px solid var(--border);
        background: var(--panel-strong);
        color: var(--text);
        font: inherit;
      }

      .toolbar button {
        padding: 12px 16px;
        border: 0;
        border-radius: 12px;
        background: linear-gradient(135deg, var(--accent), var(--accent-strong));
        color: white;
        font: inherit;
        cursor: pointer;
      }

      .toolbar button:hover {
        filter: brightness(1.04);
      }

      .toolbar button:disabled {
        cursor: not-allowed;
        filter: grayscale(0.2);
        opacity: 0.6;
      }

      .action-grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
        gap: 12px;
      }

      .action-card {
        display: grid;
        gap: 8px;
        padding: 14px;
        border-radius: 16px;
        border: 1px solid var(--border);
        background: rgba(255, 255, 255, 0.7);
      }

      .action-card strong {
        font-size: 1rem;
      }

      .action-card p {
        margin: 0;
        color: var(--muted);
        font-size: 0.92rem;
      }

      .action-card button {
        justify-self: start;
      }

      .event-list {
        display: grid;
        gap: 10px;
      }

      .event-item {
        padding: 12px 14px;
        border-radius: 14px;
        background: rgba(255, 255, 255, 0.58);
        border: 1px solid rgba(48, 41, 30, 0.1);
      }

      .event-meta {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
        color: var(--muted);
        font-size: 0.82rem;
        margin-bottom: 6px;
      }

      .hint {
        color: var(--muted);
      }

      .danger {
        color: var(--danger);
      }

      @media (max-width: 720px) {
        .shell {
          width: min(100vw - 20px, 1200px);
          padding-top: 20px;
        }

        .hero {
          padding: 22px;
        }

        .panel-header,
        .panel-body {
          padding-left: 16px;
          padding-right: 16px;
        }
      }
    </style>
  </head>
  <body>
    <main class="shell" data-dashboard-root>
      <section class="hero">
        <div>
          <h1>Operator dashboard</h1>
          <p>
            Supervisor status and safe command transport backed by JSON endpoints and the live SSE stream.
            The command surface stays limited to existing operator-safe mutations.
          </p>
        </div>
        <div class="hero-bar">
          <div class="badge">connection <strong id="connection-state">connecting</strong></div>
          <div class="badge">selected issue <strong id="selected-issue-badge">none</strong></div>
          <div class="badge">last refresh <strong id="last-refresh-badge">pending</strong></div>
        </div>
      </section>

      <section class="grid" aria-label="overview">
        <article class="panel">
          <div class="panel-header">
            <h2>Status</h2>
            <span id="status-warning" class="hint"></span>
          </div>
          <div class="panel-body stack">
            <div class="metric" id="status-reconciliation">loading</div>
            <div class="row">
              <div class="row-label">Summary</div>
              <pre id="status-lines" class="code">Loading /api/status?why=true…</pre>
            </div>
          </div>
        </article>

        <article class="panel">
          <div class="panel-header">
            <h2>Doctor</h2>
            <span id="doctor-overall" class="metric">…</span>
          </div>
          <div class="panel-body stack">
            <div class="row">
              <div class="row-label">Checks</div>
              <ul id="doctor-checks" class="list">
                <li>Loading /api/doctor…</li>
              </ul>
            </div>
          </div>
        </article>
      </section>

      <section class="grid" aria-label="details">
        <article class="panel">
          <div class="panel-header">
            <h2>Issue details</h2>
            <span id="issue-summary" class="hint">No issue loaded.</span>
          </div>
          <div class="panel-body stack">
            <div class="row">
              <div class="row-label">Typed issue shortcuts</div>
              <div id="issue-shortcuts" class="shortcut-list">
                <div class="hint">Waiting for typed issue context…</div>
              </div>
            </div>
            <form id="issue-form" class="toolbar">
              <input id="issue-number-input" type="number" min="1" step="1" inputmode="numeric" placeholder="Issue number">
              <button type="submit">Load issue details</button>
            </form>
            <div class="row">
              <div class="row-label">Explain</div>
              <pre id="issue-explain" class="code">Choose an issue number to load /api/issues/:issueNumber/explain.</pre>
            </div>
            <div class="row">
              <div class="row-label">Issue lint</div>
              <pre id="issue-lint" class="code">Issue lint appears here after a selection.</pre>
            </div>
          </div>
        </article>

        <article class="panel">
          <div class="panel-header">
            <h2>Operator actions</h2>
            <span id="command-status" class="hint">No command run yet.</span>
          </div>
          <div class="panel-body stack">
            <div class="action-grid">
              <div class="action-card">
                <strong>Run once</strong>
                <p>Trigger one safe supervisor cycle through <code>/api/commands/run-once</code>.</p>
                <button type="button" id="run-once-button">Run once</button>
              </div>
              <div class="action-card">
                <strong>Requeue issue</strong>
                <p>Requeue the selected issue only after issue details are loaded.</p>
                <button type="button" id="requeue-button">Requeue selected issue</button>
              </div>
              <div class="action-card">
                <strong>Prune orphaned workspaces</strong>
                <p>Requires confirm before calling <code>/api/commands/prune-orphaned-workspaces</code>.</p>
                <button type="button" id="prune-workspaces-button">Confirm and prune</button>
              </div>
              <div class="action-card">
                <strong>Reset corrupt JSON state</strong>
                <p>Requires confirm before calling <code>/api/commands/reset-corrupt-json-state</code>.</p>
                <button type="button" id="reset-json-state-button">Confirm and reset</button>
              </div>
            </div>
            <div class="row">
              <div class="row-label">Command result</div>
              <pre id="command-result" class="code">Structured command result JSON appears here.</pre>
            </div>
          </div>
        </article>

        <article class="panel">
          <div class="panel-header">
            <h2>Live events</h2>
            <span class="hint">SSE from /api/events</span>
          </div>
          <div class="panel-body">
            <div id="event-list" class="event-list">
              <div class="event-item">Waiting for live events…</div>
            </div>
          </div>
        </article>
      </section>
    </main>

    <script>
      const state = {
        selectedIssueNumber: null,
        status: null,
        doctor: null,
        explain: null,
        issueLint: null,
        commandInFlight: false,
        commandResult: null,
        events: [],
      };

      const elements = {
        connectionState: document.getElementById("connection-state"),
        selectedIssueBadge: document.getElementById("selected-issue-badge"),
        lastRefreshBadge: document.getElementById("last-refresh-badge"),
        statusReconciliation: document.getElementById("status-reconciliation"),
        statusLines: document.getElementById("status-lines"),
        statusWarning: document.getElementById("status-warning"),
        doctorOverall: document.getElementById("doctor-overall"),
        doctorChecks: document.getElementById("doctor-checks"),
        issueSummary: document.getElementById("issue-summary"),
        issueShortcuts: document.getElementById("issue-shortcuts"),
        issueExplain: document.getElementById("issue-explain"),
        issueLint: document.getElementById("issue-lint"),
        issueForm: document.getElementById("issue-form"),
        issueNumberInput: document.getElementById("issue-number-input"),
        commandStatus: document.getElementById("command-status"),
        commandResult: document.getElementById("command-result"),
        runOnceButton: document.getElementById("run-once-button"),
        requeueButton: document.getElementById("requeue-button"),
        pruneWorkspacesButton: document.getElementById("prune-workspaces-button"),
        resetJsonStateButton: document.getElementById("reset-json-state-button"),
        eventList: document.getElementById("event-list"),
      };

      const knownEventTypes = [
        "supervisor.recovery",
        "supervisor.active_issue.changed",
        "supervisor.loop.skipped",
        "supervisor.run_lock.blocked",
        "supervisor.review_wait.changed",
      ];

      function setText(element, value) {
        if (element) {
          element.textContent = value;
        }
      }

      function setCode(element, lines) {
        if (element) {
          element.textContent = Array.isArray(lines) ? lines.join("\\n") : String(lines);
        }
      }

      function metricClass(status) {
        if (status === "pass") return "ok";
        if (status === "warn") return "warn";
        if (status === "fail") return "fail";
        return "";
      }

      function parseSelectedIssueNumber(status) {
        if (status?.selectionSummary && Number.isInteger(status.selectionSummary.selectedIssueNumber)) {
          return status.selectionSummary.selectedIssueNumber;
        }
        if (status?.activeIssue && Number.isInteger(status.activeIssue.issueNumber)) {
          return status.activeIssue.issueNumber;
        }
        const candidates = []
          .concat(status?.whyLines || [])
          .concat(status?.detailedStatusLines || []);
        for (const line of candidates) {
          const match = /selected_issue=#(\\d+)/u.exec(line) || /active_issue=#(\\d+)/u.exec(line);
          if (match) {
            return Number.parseInt(match[1], 10);
          }
        }
        return null;
      }

      function formatKeyValueBlock(entries) {
        return entries
          .filter((entry) => entry[1] !== null && entry[1] !== undefined && entry[1] !== "")
          .map(([label, value]) => label + ": " + value)
          .join("\\n");
      }

      function formatTrackedIssues(status) {
        const trackedIssues = Array.isArray(status?.trackedIssues) ? status.trackedIssues : [];
        return trackedIssues.map((issue) =>
          "tracked issue #" +
          issue.issueNumber +
          " [" +
          issue.state +
          "] branch=" +
          issue.branch +
          " pr=" +
          (Number.isInteger(issue.prNumber) ? "#" + issue.prNumber : "none") +
          " blocked_reason=" +
          (issue.blockedReason || "none")
        );
      }

      function formatRunnableIssues(status) {
        const runnableIssues = Array.isArray(status?.runnableIssues) ? status.runnableIssues : [];
        return runnableIssues.map((issue) =>
          "runnable issue #" + issue.issueNumber + " " + issue.title + " ready=" + issue.readiness
        );
      }

      function formatBlockedIssues(status) {
        const blockedIssues = Array.isArray(status?.blockedIssues) ? status.blockedIssues : [];
        return blockedIssues.map((issue) =>
          "blocked issue #" + issue.issueNumber + " " + issue.title + " blocked_by=" + issue.blockedBy
        );
      }

      function formatCandidateDiscovery(status) {
        if (status?.candidateDiscovery) {
          const summary = status.candidateDiscovery;
          return [
            "candidate discovery fetch_window=" +
              summary.fetchWindow +
              " strategy=" +
              summary.strategy +
              " truncated=" +
              (summary.truncated ? "yes" : "no") +
              " observed_matching_open_issues=" +
              (summary.observedMatchingOpenIssues === null ? "unknown" : summary.observedMatchingOpenIssues),
            ...(summary.warning ? [summary.warning] : []),
          ];
        }

        return status?.candidateDiscoverySummary ? [status.candidateDiscoverySummary] : [];
      }

      function collectIssueShortcuts(status) {
        const shortcuts = [];
        const seenIssueNumbers = new Set();

        function pushShortcut(issueNumber, label, detail) {
          if (!Number.isInteger(issueNumber) || seenIssueNumbers.has(issueNumber)) {
            return;
          }
          seenIssueNumbers.add(issueNumber);
          shortcuts.push({
            issueNumber,
            label,
            detail,
          });
        }

        if (status?.activeIssue) {
          pushShortcut(
            status.activeIssue.issueNumber,
            "active",
            [status.activeIssue.state, status.activeIssue.branch].filter(Boolean).join(" "),
          );
        }

        for (const issue of Array.isArray(status?.runnableIssues) ? status.runnableIssues : []) {
          pushShortcut(issue.issueNumber, "runnable " + issue.readiness, [issue.title].filter(Boolean).join(" "));
        }

        for (const issue of Array.isArray(status?.blockedIssues) ? status.blockedIssues : []) {
          pushShortcut(issue.issueNumber, "blocked " + issue.blockedBy, [issue.title].filter(Boolean).join(" "));
        }

        for (const issue of Array.isArray(status?.trackedIssues) ? status.trackedIssues : []) {
          pushShortcut(
            issue.issueNumber,
            "tracked " + issue.state,
            [issue.branch, Number.isInteger(issue.prNumber) ? "pr=#" + issue.prNumber : "pr=none"]
              .filter(Boolean)
              .join(" "),
          );
        }

        return shortcuts;
      }

      function renderStatus() {
        if (!state.status) {
          return;
        }

        const status = state.status;
        setText(elements.statusReconciliation, status.reconciliationPhase || "steady");
        setText(elements.statusWarning, status.warning ? status.warning.message : "");
        elements.statusWarning?.classList.remove("danger");
        const lines = []
          .concat(formatTrackedIssues(status))
          .concat(formatRunnableIssues(status))
          .concat(formatBlockedIssues(status))
          .concat(status.detailedStatusLines || [])
          .concat(status.readinessLines || [])
          .concat(status.whyLines || [])
          .concat(formatCandidateDiscovery(status))
          .concat(status.reconciliationWarning ? [status.reconciliationWarning] : []);
        setCode(elements.statusLines, lines.length > 0 ? lines : ["No status lines reported."]);
      }

      function renderDoctor() {
        if (!state.doctor) {
          return;
        }

        const doctor = state.doctor;
        setText(elements.doctorOverall, doctor.overallStatus);
        elements.doctorOverall.className = "metric " + metricClass(doctor.overallStatus);
        const checks = doctor.checks || [];
        elements.doctorChecks.innerHTML = "";
        for (const check of checks) {
          const item = document.createElement("li");
          item.textContent = check.name + " [" + check.status + "] " + check.summary;
          elements.doctorChecks.appendChild(item);
        }
      }

      function renderIssue() {
        if (!state.explain) {
          setText(elements.issueSummary, "No issue loaded.");
          return;
        }

        const explain = state.explain;
        setText(
          elements.issueSummary,
          "#" + explain.issueNumber + " " + explain.title + " | runnable=" + (explain.runnable ? "yes" : "no"),
        );
        setCode(
          elements.issueExplain,
          formatKeyValueBlock([
            ["title", explain.title],
            ["state", explain.state],
            ["blocked_reason", explain.blockedReason],
            ["selection_reason", explain.selectionReason || "none"],
            ["failure_summary", explain.failureSummary || "none"],
            ["last_error", explain.lastError || "none"],
            ["change_risk", (explain.changeRiskLines || []).join(" | ") || "none"],
            ["follow_up", explain.externalReviewFollowUpSummary || "none"],
            ["latest_recovery", explain.latestRecoverySummary || "none"],
            ["reasons", (explain.reasons || []).join(" | ") || "none"],
          ]),
        );

        if (state.issueLint) {
          const lint = state.issueLint;
          setCode(
            elements.issueLint,
            formatKeyValueBlock([
              ["execution_ready", lint.executionReady ? "yes" : "no"],
              ["missing_required", (lint.missingRequired || []).join(" | ") || "none"],
              ["missing_recommended", (lint.missingRecommended || []).join(" | ") || "none"],
              ["metadata_errors", (lint.metadataErrors || []).join(" | ") || "none"],
              ["high_risk_blocking_ambiguity", lint.highRiskBlockingAmbiguity || "none"],
              ["repair_guidance", (lint.repairGuidance || []).join(" | ") || "none"],
            ]),
          );
        }
      }

      function renderIssueShortcuts() {
        if (!elements.issueShortcuts) {
          return;
        }

        const shortcuts = collectIssueShortcuts(state.status);
        elements.issueShortcuts.innerHTML = "";

        if (shortcuts.length === 0) {
          const emptyState = document.createElement("div");
          emptyState.className = "hint";
          emptyState.textContent = "No typed issue shortcuts reported.";
          elements.issueShortcuts.appendChild(emptyState);
          return;
        }

        for (const shortcut of shortcuts) {
          const button = document.createElement("button");
          button.className = "shortcut-button";
          button.textContent =
            "#" + shortcut.issueNumber + " " + shortcut.label + (shortcut.detail ? " " + shortcut.detail : "");
          button.addEventListener("click", async () => {
            try {
              await loadIssue(shortcut.issueNumber);
            } catch (error) {
              setText(elements.issueSummary, error instanceof Error ? error.message : String(error));
            }
          });
          elements.issueShortcuts.appendChild(button);
        }
      }

      function renderEvents() {
        elements.eventList.innerHTML = "";
        const events = state.events.length > 0 ? state.events : [{ type: "idle", at: "", summary: "Waiting for live events…" }];
        for (const event of events) {
          const card = document.createElement("div");
          card.className = "event-item";

          const meta = document.createElement("div");
          meta.className = "event-meta";
          meta.textContent = [event.type, event.family || "", event.at || ""].filter(Boolean).join(" | ");

          const body = document.createElement("div");
          body.textContent = JSON.stringify(event, null, 2);

          card.appendChild(meta);
          card.appendChild(body);
          elements.eventList.appendChild(card);
        }
      }

      function renderSelectedIssue() {
        setText(elements.selectedIssueBadge, state.selectedIssueNumber ? "#" + state.selectedIssueNumber : "none");
        if (state.selectedIssueNumber && elements.issueNumberInput) {
          elements.issueNumberInput.value = String(state.selectedIssueNumber);
        }
        if (elements.runOnceButton) {
          elements.runOnceButton.disabled = state.commandInFlight;
        }
        if (elements.requeueButton) {
          elements.requeueButton.disabled =
            state.commandInFlight || state.selectedIssueNumber === null || state.explain === null;
        }
        if (elements.pruneWorkspacesButton) {
          elements.pruneWorkspacesButton.disabled = state.commandInFlight;
        }
        if (elements.resetJsonStateButton) {
          elements.resetJsonStateButton.disabled = state.commandInFlight;
        }
      }

      function renderCommandResult() {
        if (!state.commandResult) {
          setText(elements.commandStatus, "No command run yet.");
          setCode(elements.commandResult, "Structured command result JSON appears here.");
          return;
        }

        setText(elements.commandStatus, state.commandResult.summary || "Command completed.");
        setCode(elements.commandResult, JSON.stringify(state.commandResult, null, 2));
      }

      function markRefresh() {
        setText(elements.lastRefreshBadge, new Date().toLocaleTimeString());
      }

      function reportRefreshError(error) {
        const message = error instanceof Error ? error.message : String(error);
        setText(elements.statusWarning, message);
        elements.statusWarning?.classList.add("danger");
        pushEvent({
          type: "dashboard.refresh.error",
          family: "dashboard",
          at: new Date().toISOString(),
          message,
        });
      }

      async function readJson(path) {
        const response = await fetch(path, { headers: { Accept: "application/json" } });
        if (!response.ok) {
          let message = "Request failed";
          try {
            const body = await response.json();
            message = body.error || message;
          } catch {}
          throw new Error(path + ": " + message);
        }
        return response.json();
      }

      async function refreshStatusAndDoctor() {
        const [status, doctor] = await Promise.all([
          readJson("/api/status?why=true"),
          readJson("/api/doctor"),
        ]);
        state.status = status;
        state.doctor = doctor;
        const inferredIssueNumber = parseSelectedIssueNumber(status);
        if (inferredIssueNumber !== null && state.selectedIssueNumber === null) {
          state.selectedIssueNumber = inferredIssueNumber;
        }
        renderStatus();
        renderDoctor();
        renderIssueShortcuts();
        renderSelectedIssue();
        markRefresh();
      }

      async function loadIssue(issueNumber) {
        const requestedIssueNumber = issueNumber;
        state.selectedIssueNumber = requestedIssueNumber;
        state.explain = null;
        state.issueLint = null;
        renderSelectedIssue();
        setText(elements.issueSummary, "Loading issue...");
        setCode(elements.issueExplain, "Loading /api/issues/" + requestedIssueNumber + "/explain...");
        setCode(elements.issueLint, "Loading /api/issues/" + requestedIssueNumber + "/issue-lint...");
        try {
          const [explain, issueLint] = await Promise.all([
            readJson("/api/issues/" + requestedIssueNumber + "/explain"),
            readJson("/api/issues/" + requestedIssueNumber + "/issue-lint"),
          ]);
          if (state.selectedIssueNumber !== requestedIssueNumber) {
            return;
          }
          state.explain = explain;
          state.issueLint = issueLint;
          renderSelectedIssue();
          renderIssue();
          markRefresh();
        } catch (error) {
          if (state.selectedIssueNumber !== requestedIssueNumber) {
            return;
          }
          throw error;
        }
      }

      async function postCommand(path, body) {
        const response = await fetch(path, {
          method: "POST",
          headers: {
            Accept: "application/json",
            "Content-Type": "application/json",
          },
          body: body ? JSON.stringify(body) : "{}",
        });

        const payload = await response.json();
        if (!response.ok) {
          const message =
            payload && typeof payload === "object" && "error" in payload ? payload.error : "Request failed";
          throw new Error(path + ": " + message);
        }

        return payload;
      }

      async function runCommand(args) {
        const previousStatus = elements.commandStatus ? elements.commandStatus.textContent : "";
        setText(elements.commandStatus, "Running " + args.label + "...");
        try {
          const result = await postCommand(args.path, args.body);
          state.commandResult = result;
          renderCommandResult();
          try {
            await refreshStatusAndDoctor();
            if (state.selectedIssueNumber !== null) {
              await loadIssue(state.selectedIssueNumber);
            }
          } catch (error) {
            reportRefreshError(error);
          }
        } catch (error) {
          setText(elements.commandStatus, previousStatus || "Command failed.");
          state.commandResult = {
            action: args.label,
            outcome: "rejected",
            summary: error instanceof Error ? error.message : String(error),
          };
          renderCommandResult();
        }
      }

      function pushEvent(event) {
        state.events.unshift(event);
        state.events = state.events.slice(0, 40);
        renderEvents();
      }

      async function runCommandWithLock(args) {
        if (state.commandInFlight) {
          return;
        }

        state.commandInFlight = true;
        renderSelectedIssue();
        try {
          await runCommand(args);
        } finally {
          state.commandInFlight = false;
          renderSelectedIssue();
        }
      }

      function wireEvents() {
        const source = new EventSource("/api/events");
        setText(elements.connectionState, "connecting");

        source.addEventListener("open", () => {
          setText(elements.connectionState, "open");
        });

        source.addEventListener("error", () => {
          setText(elements.connectionState, "reconnecting");
        });

        const onEvent = async (rawEvent) => {
          let parsed = { type: rawEvent.type, family: "event", at: new Date().toISOString(), raw: rawEvent.data };
          try {
            parsed = JSON.parse(rawEvent.data);
          } catch {}
          pushEvent(parsed);
          try {
            await refreshStatusAndDoctor();
            if (state.selectedIssueNumber !== null) {
              await loadIssue(state.selectedIssueNumber);
            }
          } catch (error) {
            reportRefreshError(error);
          }
        };

        for (const eventType of knownEventTypes) {
          source.addEventListener(eventType, onEvent);
        }
      }

      elements.issueForm?.addEventListener("submit", async (event) => {
        event.preventDefault();
        const parsed = Number.parseInt(elements.issueNumberInput?.value || "", 10);
        if (!Number.isInteger(parsed) || parsed <= 0) {
          setText(elements.issueSummary, "Enter a positive issue number.");
          return;
        }

        try {
          await loadIssue(parsed);
        } catch (error) {
          setText(elements.issueSummary, error instanceof Error ? error.message : String(error));
        }
      });

      elements.runOnceButton?.addEventListener("click", async () => {
        await runCommandWithLock({
          label: "run-once",
          path: "/api/commands/run-once",
          body: { dryRun: false },
        });
      });

      elements.requeueButton?.addEventListener("click", async () => {
        if (state.explain === null) {
          state.commandResult = {
            action: "requeue",
            outcome: "rejected",
            summary: "Load an issue successfully before requeueing.",
          };
          renderCommandResult();
          return;
        }

        await runCommandWithLock({
          label: "requeue",
          path: "/api/commands/requeue",
          body: { issueNumber: state.explain.issueNumber },
        });
      });

      elements.pruneWorkspacesButton?.addEventListener("click", async () => {
        if (!window.confirm("Confirm prune of orphaned workspaces?")) {
          return;
        }

        await runCommandWithLock({
          label: "prune-orphaned-workspaces",
          path: "/api/commands/prune-orphaned-workspaces",
          body: {},
        });
      });

      elements.resetJsonStateButton?.addEventListener("click", async () => {
        if (!window.confirm("Confirm reset of the corrupt JSON state marker?")) {
          return;
        }

        await runCommandWithLock({
          label: "reset-corrupt-json-state",
          path: "/api/commands/reset-corrupt-json-state",
          body: {},
        });
      });

      async function bootstrap() {
        try {
          await refreshStatusAndDoctor();
          if (state.selectedIssueNumber !== null) {
            await loadIssue(state.selectedIssueNumber);
          }
        } catch (error) {
          setText(elements.statusWarning, error instanceof Error ? error.message : String(error));
          elements.statusWarning?.classList.add("danger");
        }

        renderCommandResult();
        wireEvents();
        renderEvents();
      }

      void bootstrap();
    </script>
  </body>
</html>`;
}
