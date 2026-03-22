import {
  buildStatusLines,
  collectIssueShortcuts,
  formatBlockedIssues,
  formatCandidateDiscovery,
  formatRunnableIssues,
  formatTrackedIssues,
  parseSelectedIssueNumber,
} from "./webui-dashboard-browser-logic";

const injectedBrowserLogic = [
  formatTrackedIssues,
  formatRunnableIssues,
  formatBlockedIssues,
  formatCandidateDiscovery,
  buildStatusLines,
  collectIssueShortcuts,
  parseSelectedIssueNumber,
]
  .map((helper) => helper.toString().replace(/__name\([^;]+;\s*/gu, ""))
  .join("\n\n");

export function renderDashboardBrowserScript(): string {
  return `
      ${injectedBrowserLogic}

      const state = {
        selectedIssueNumber: null,
        loadedIssueNumber: null,
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

      function formatKeyValueBlock(entries) {
        return entries
          .filter((entry) => entry[1] !== null && entry[1] !== undefined && entry[1] !== "")
          .map(([label, value]) => label + ": " + value)
          .join("\\n");
      }

      function renderStatus() {
        if (!state.status) {
          return;
        }

        const status = state.status;
        setText(elements.statusReconciliation, status.reconciliationPhase || "steady");
        setText(elements.statusWarning, status.warning ? status.warning.message : "");
        elements.statusWarning?.classList.remove("danger");
        const lines = buildStatusLines(status);
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
        if (elements.issueNumberInput) {
          if (state.loadedIssueNumber) {
            elements.issueNumberInput.value = String(state.loadedIssueNumber);
          } else if (state.selectedIssueNumber) {
            elements.issueNumberInput.value = String(state.selectedIssueNumber);
          }
        }
        if (elements.runOnceButton) {
          elements.runOnceButton.disabled = state.commandInFlight;
        }
        if (elements.requeueButton) {
          elements.requeueButton.disabled =
            state.commandInFlight || state.loadedIssueNumber === null || state.explain === null;
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

        setText(elements.commandStatus, state.commandResult.status || state.commandResult.summary || "Command completed.");
        setCode(elements.commandResult, JSON.stringify(state.commandResult, null, 2));
      }

      function rejectCommand(action, summary, status) {
        state.commandResult = {
          action,
          outcome: "rejected",
          summary,
          status,
        };
        renderCommandResult();
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
        state.selectedIssueNumber = parseSelectedIssueNumber(status);
        renderStatus();
        renderDoctor();
        renderIssueShortcuts();
        renderSelectedIssue();
        markRefresh();
      }

      async function loadIssue(issueNumber) {
        const requestedIssueNumber = issueNumber;
        state.loadedIssueNumber = requestedIssueNumber;
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
          if (state.loadedIssueNumber !== requestedIssueNumber) {
            return;
          }
          state.explain = explain;
          state.issueLint = issueLint;
          renderSelectedIssue();
          renderIssue();
          markRefresh();
        } catch (error) {
          if (state.loadedIssueNumber !== requestedIssueNumber) {
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
            const issueNumberToLoad = state.selectedIssueNumber ?? state.loadedIssueNumber;
            if (issueNumberToLoad !== null) {
              await loadIssue(issueNumberToLoad);
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
            const issueNumberToLoad = state.selectedIssueNumber ?? state.loadedIssueNumber;
            if (issueNumberToLoad !== null) {
              await loadIssue(issueNumberToLoad);
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
          rejectCommand("requeue", "Load an issue successfully before requeueing.", "requeue cancelled");
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
          rejectCommand(
            "prune-orphaned-workspaces",
            "Operator declined confirmation.",
            "prune-orphaned-workspaces cancelled",
          );
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
          rejectCommand(
            "reset-corrupt-json-state",
            "Operator declined confirmation.",
            "reset-corrupt-json-state cancelled",
          );
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
          const issueNumberToLoad = state.selectedIssueNumber ?? state.loadedIssueNumber;
          if (issueNumberToLoad !== null) {
            await loadIssue(issueNumberToLoad);
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
  `;
}
