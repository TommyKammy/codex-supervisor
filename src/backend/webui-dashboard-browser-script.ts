import {
  buildStatusLines,
  collectTrackedIssues,
  collectIssueShortcuts,
  describeCommandSelectionChange,
  formatBlockedIssues,
  formatCandidateDiscovery,
  formatIssueRef,
  formatRecentPhaseChanges,
  formatRecoveryLoopSummary,
  formatRetryContextSummary,
  formatRunnableIssues,
  formatTrackedHistorySummary,
  formatTrackedIssueSummary,
  formatTrackedIssues,
  describeConnectionHealth,
  describeFreshnessState,
  describeTimelineCommandResult,
  describeTimelineEvent,
  collectTimelineEventIssueNumbers,
  humanizeTimelineValue,
  parseSelectedIssueNumber,
} from "./webui-dashboard-browser-logic";

const injectedBrowserLogic = [
  collectTrackedIssues,
  formatTrackedIssues,
  formatTrackedHistorySummary,
  formatTrackedIssueSummary,
  formatRunnableIssues,
  formatBlockedIssues,
  formatCandidateDiscovery,
  formatIssueRef,
  formatRetryContextSummary,
  formatRecoveryLoopSummary,
  formatRecentPhaseChanges,
  buildStatusLines,
  collectIssueShortcuts,
  describeCommandSelectionChange,
  describeConnectionHealth,
  describeFreshnessState,
  humanizeTimelineValue,
  describeTimelineCommandResult,
  describeTimelineEvent,
  collectTimelineEventIssueNumbers,
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
        timelineEntries: [],
        commandCorrelation: null,
        connectionPhase: "connecting",
        refreshPhase: "idle",
        hasSuccessfulRefresh: false,
        lastRefreshAt: null,
        showDoneTrackedIssues: false,
      };

      const elements = {
        connectionState: document.getElementById("connection-state"),
        freshnessState: document.getElementById("freshness-state"),
        refreshState: document.getElementById("refresh-state"),
        selectedIssueBadge: document.getElementById("selected-issue-badge"),
        lastRefreshBadge: document.getElementById("last-refresh-badge"),
        statusReconciliation: document.getElementById("status-reconciliation"),
        statusMetrics: document.getElementById("status-metrics"),
        statusWorkflow: document.getElementById("status-workflow"),
        statusLines: document.getElementById("status-lines"),
        statusWarning: document.getElementById("status-warning"),
        trackedHistorySummary: document.getElementById("tracked-history-summary"),
        trackedHistoryLines: document.getElementById("tracked-history-lines"),
        trackedHistoryToggle: document.getElementById("tracked-history-toggle"),
        doctorOverall: document.getElementById("doctor-overall"),
        doctorChecks: document.getElementById("doctor-checks"),
        issueSummary: document.getElementById("issue-summary"),
        issueMetrics: document.getElementById("issue-metrics"),
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
        operatorTimeline: document.getElementById("operator-timeline"),
        eventList: document.getElementById("event-list"),
      };

      const knownEventTypes = [
        "supervisor.recovery",
        "supervisor.active_issue.changed",
        "supervisor.loop.skipped",
        "supervisor.run_lock.blocked",
        "supervisor.review_wait.changed",
      ];

      const COMMAND_CORRELATION_WINDOW_MS = 15000;

      function setText(element, value) {
        if (element) {
          element.innerHTML = "";
          element.textContent = value;
        }
      }

      function setCode(element, lines) {
        if (element) {
          element.innerHTML = "";
          element.textContent = Array.isArray(lines) ? lines.join("\\n") : String(lines);
        }
      }

      function appendChip(container, label, tone) {
        if (!container) {
          return;
        }
        const chip = document.createElement("span");
        chip.className = "chip " + (tone || "info");
        chip.textContent = label;
        container.appendChild(chip);
      }

      function toneForStatus(value) {
        const normalized = typeof value === "string" ? value.toLowerCase() : "";
        if (["pass", "connected", "fresh", "ready", "runnable", "completed", "done", "open"].includes(normalized)) {
          return "ok";
        }
        if (["warn", "refreshing", "queued", "blocked", "stale", "reconnecting", "in_progress"].includes(normalized)) {
          return "warn";
        }
        if (["fail", "failed", "rejected", "error"].includes(normalized)) {
          return "fail";
        }
        return "info";
      }

      function buildEmptyState(icon, title, detail) {
        const state = document.createElement("div");
        state.className = "empty-state";

        const iconElement = document.createElement("span");
        iconElement.className = "empty-icon";
        iconElement.textContent = icon;

        const titleElement = document.createElement("strong");
        titleElement.textContent = title;

        const detailElement = document.createElement("span");
        detailElement.className = "hint";
        detailElement.textContent = detail;

        state.appendChild(iconElement);
        state.appendChild(titleElement);
        state.appendChild(detailElement);
        return state;
      }

      function appendMetricTile(container, label, value, tone, detail) {
        if (!container) {
          return;
        }
        const tile = document.createElement("div");
        tile.className = "metric-tile";

        const labelElement = document.createElement("span");
        labelElement.className = "metric-tile-label";
        labelElement.textContent = label;

        const valueElement = document.createElement("strong");
        valueElement.className = ["metric-tile-value", tone || ""].filter(Boolean).join(" ");
        valueElement.textContent = value;

        tile.appendChild(labelElement);
        tile.appendChild(valueElement);

        if (detail) {
          const detailElement = document.createElement("span");
          detailElement.className = "metric-tile-detail";
          detailElement.textContent = detail;
          tile.appendChild(detailElement);
        }

        container.appendChild(tile);
      }

      function appendTextCard(container, className, text) {
        if (!container) {
          return;
        }
        const card = document.createElement("div");
        card.className = className;
        card.textContent = text;
        container.appendChild(card);
      }

      function countCandidateIssues(status) {
        const observed = status && status.candidateDiscovery ? status.candidateDiscovery.observedMatchingOpenIssues : null;
        return typeof observed === "number" ? String(observed) : "n/a";
      }

      function buildWorkflowSteps(status) {
        const selectedIssueNumber = parseSelectedIssueNumber(status);
        const runnableCount = Array.isArray(status && status.runnableIssues) ? status.runnableIssues.length : 0;
        const blockedCount = Array.isArray(status && status.blockedIssues) ? status.blockedIssues.length : 0;
        const trackedCount = Array.isArray(status && status.trackedIssues) ? status.trackedIssues.length : 0;
        const candidateDiscovery = status && status.candidateDiscovery ? status.candidateDiscovery : null;
        const normalizedPhase =
          status && typeof status.reconciliationPhase === "string" ? status.reconciliationPhase.toLowerCase() : "steady";

        let currentStepId = "observe";
        let currentDetail = "Supervisor is watching the queue and waiting for the next actionable signal.";

        if (selectedIssueNumber !== null) {
          currentStepId = "execute";
          currentDetail = "Issue " + formatIssueRef(selectedIssueNumber) + " is the current active focus.";
        } else if (blockedCount > 0 && runnableCount === 0) {
          currentStepId = "recover";
          currentDetail = "No runnable issue is available, so the supervisor is waiting on recovery or unblock work.";
        } else if (runnableCount > 0) {
          currentStepId = "select";
          currentDetail = "Runnable candidates are available and ready for selection.";
        } else if (trackedCount > 0 || candidateDiscovery || /discover|scan|triage|queue|reconcile|refresh/u.test(normalizedPhase)) {
          currentStepId = "triage";
          currentDetail = "Tracked work and queue signals are being reconciled before an issue is selected.";
        }

        const stepOrder = ["observe", "triage", "select", "execute", "recover"];
        const currentIndex = stepOrder.indexOf(currentStepId);

        return [
          {
            id: "observe",
            title: "Observe",
            detail: currentStepId === "observe" ? currentDetail : "Connection and freshness checks keep the workspace current.",
            state: currentIndex > 0 ? "done" : currentIndex === 0 ? "current" : "idle",
          },
          {
            id: "triage",
            title: "Triage",
            detail:
              currentStepId === "triage"
                ? currentDetail
                : trackedCount > 0
                  ? String(trackedCount) + " tracked issues remain in the working set."
                  : "Queue discovery and reconciliation determine the next candidate.",
            state: currentIndex > 1 ? "done" : currentIndex === 1 ? "current" : "idle",
          },
          {
            id: "select",
            title: "Select",
            detail:
              currentStepId === "select"
                ? currentDetail
                : runnableCount > 0
                  ? String(runnableCount) + " runnable issue(s) are available."
                  : "No runnable issue is currently waiting for handoff.",
            state: currentIndex > 2 ? "done" : currentIndex === 2 ? "current" : "idle",
          },
          {
            id: "execute",
            title: "Execute",
            detail:
              currentStepId === "execute"
                ? currentDetail
                : selectedIssueNumber !== null
                  ? "Selected issue is " + formatIssueRef(selectedIssueNumber) + "."
                  : "No active issue is currently executing.",
            state: currentIndex > 3 ? "done" : currentIndex === 3 ? "current" : "idle",
          },
          {
            id: "recover",
            title: "Recover",
            detail:
              currentStepId === "recover"
                ? currentDetail
                : blockedCount > 0
                  ? String(blockedCount) + " blocked issue(s) need unblock or recovery."
                  : "Recovery remains quiet while runnable work is available.",
            state:
              currentIndex === 4 ? "current warn" : blockedCount > 0 && currentStepId !== "recover" ? "warn" : "idle",
          },
        ];
      }

      function renderWorkflow(status) {
        if (!elements.statusWorkflow) {
          return;
        }
        elements.statusWorkflow.innerHTML = "";
        const steps = buildWorkflowSteps(status);
        for (const step of steps) {
          const article = document.createElement("article");
          article.className = "workflow-step " + step.state;

          const dot = document.createElement("span");
          dot.className = "workflow-dot";

          const copy = document.createElement("div");
          copy.className = "workflow-copy";

          const title = document.createElement("strong");
          title.textContent = step.title;

          const detail = document.createElement("span");
          detail.textContent = step.detail;

          copy.appendChild(title);
          copy.appendChild(detail);
          article.appendChild(dot);
          article.appendChild(copy);
          elements.statusWorkflow.appendChild(article);
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

      function liveBadgeClass(tone) {
        if (tone === "ok") return "ok";
        if (tone === "warn") return "warn";
        if (tone === "fail") return "fail";
        return "";
      }

      function setLiveBadgeState(element, label, tone) {
        if (!element) {
          return;
        }
        setText(element, label);
        const toneClass = liveBadgeClass(tone);
        element.className = ["live-value", toneClass].filter(Boolean).join(" ");
      }

      function formatRefreshTime(timestamp) {
        return timestamp === null ? "never" : new Date(timestamp).toLocaleTimeString();
      }

      function renderLiveState() {
        const connectionLabel = describeConnectionHealth(state.connectionPhase);
        const connectionTone =
          state.connectionPhase === "open" ? "ok" : state.connectionPhase === "reconnecting" ? "warn" : "";
        const freshnessLabel = describeFreshnessState({
          connectionPhase: state.connectionPhase,
          refreshPhase: state.refreshPhase,
          hasSuccessfulRefresh: state.hasSuccessfulRefresh,
        });
        const freshnessTone = freshnessLabel === "fresh" ? "ok" : freshnessLabel === "stale" ? "warn" : "";
        const refreshTone =
          state.refreshPhase === "failed" ? "fail" : state.refreshPhase === "refreshing" ? "warn" : "";

        setLiveBadgeState(elements.connectionState, connectionLabel, connectionTone);
        setLiveBadgeState(elements.freshnessState, freshnessLabel, freshnessTone);
        setLiveBadgeState(elements.refreshState, state.refreshPhase, refreshTone);
        setText(elements.lastRefreshBadge, formatRefreshTime(state.lastRefreshAt));
      }

      function formatLatestRecovery(activityContext, fallbackSummary) {
        const latestRecovery = activityContext && activityContext.latestRecovery;
        if (latestRecovery) {
          return (
            "issue=#" +
            latestRecovery.issueNumber +
            " at=" +
            latestRecovery.at +
            " reason=" +
            latestRecovery.reason +
            (latestRecovery.detail ? " detail=" + latestRecovery.detail : "")
          );
        }
        if (fallbackSummary) {
          return fallbackSummary;
        }
        return "none";
      }

      function formatReviewWaits(activityContext) {
        const reviewWaits = activityContext && Array.isArray(activityContext.reviewWaits) ? activityContext.reviewWaits : [];
        if (reviewWaits.length === 0) {
          return "none";
        }
        return reviewWaits
          .map((reviewWait) =>
            reviewWait.kind +
            " status=" +
            reviewWait.status +
            " provider=" +
            reviewWait.provider +
            " pause_reason=" +
            reviewWait.pauseReason +
            " recent_observation=" +
            reviewWait.recentObservation +
            " observed_at=" +
            (reviewWait.observedAt || "none") +
            " configured_wait_seconds=" +
            (reviewWait.configuredWaitSeconds === null ? "none" : reviewWait.configuredWaitSeconds) +
            " wait_until=" +
            (reviewWait.waitUntil || "none")
          )
          .join(" | ");
      }

      function buildDetailItems(pairs) {
        return pairs.filter((pair) => pair[1] !== null && pair[1] !== undefined && pair[1] !== "" && pair[1] !== "none");
      }

      function appendDetailSection(container, title, pairs) {
        const items = buildDetailItems(pairs);
        if (!container || items.length === 0) {
          return;
        }

        const card = document.createElement("section");
        card.className = "detail-card";

        const heading = document.createElement("h3");
        heading.textContent = title;
        card.appendChild(heading);

        const list = document.createElement("div");
        list.className = "detail-list";
        for (const pair of items) {
          const row = document.createElement("div");
          row.className = "detail-item";
          row.textContent = pair[0] + ": " + pair[1];
          list.appendChild(row);
        }

        card.appendChild(list);
        container.appendChild(card);
      }

      function renderIssueExplainDetails(explain) {
        if (!elements.issueExplain) {
          return;
        }

        const activityContext = explain.activityContext || null;
        elements.issueExplain.innerHTML = "";
        elements.issueExplain.className = "detail-grid";

        appendDetailSection(elements.issueExplain, "Selection context", [
          ["state", explain.state],
          ["blocked_reason", explain.blockedReason],
          ["runnable", explain.runnable ? "yes" : "no"],
          ["selection_reason", explain.selectionReason || "none"],
          ["reasons", (explain.reasons || []).join(" | ") || "none"],
        ]);

        appendDetailSection(elements.issueExplain, "Operator activity", [
          ["handoff_summary", activityContext ? activityContext.handoffSummary || "none" : "none"],
          ["local_review_routing", activityContext ? activityContext.localReviewRoutingSummary || "none" : "none"],
          ["verification_policy", activityContext ? activityContext.verificationPolicySummary || "none" : "none"],
          ["durable_guardrails", activityContext ? activityContext.durableGuardrailSummary || "none" : "none"],
          [
            "follow_up",
            explain.externalReviewFollowUpSummary ||
              (activityContext ? activityContext.externalReviewFollowUpSummary || "none" : "none"),
          ],
          ["change_risk", (explain.changeRiskLines || []).join(" | ") || "none"],
        ]);

        appendDetailSection(elements.issueExplain, "Review waits", [
          ["waits", formatReviewWaits(activityContext)],
          ["local_review_summary_path", activityContext ? activityContext.localReviewSummaryPath || "none" : "none"],
          ["external_review_misses_path", activityContext ? activityContext.externalReviewMissesPath || "none" : "none"],
        ]);

        appendDetailSection(elements.issueExplain, "Latest recovery", [
          ["latest_recovery", formatLatestRecovery(activityContext, explain.latestRecoverySummary)],
        ]);

        appendDetailSection(elements.issueExplain, "Retry and recovery", [
          ["retry_summary", formatRetryContextSummary(activityContext) || "none"],
          ["recovery_loop", formatRecoveryLoopSummary(activityContext) || "none"],
          ["recent_phase_changes", formatRecentPhaseChanges(activityContext) || "none"],
        ]);

        appendDetailSection(elements.issueExplain, "Recent failure", [
          ["failure_summary", explain.failureSummary || "none"],
          ["last_error", explain.lastError || "none"],
        ]);

        if (elements.issueExplain.children.length === 0) {
          elements.issueExplain.className = "detail-stack";
          const emptyState = document.createElement("div");
          emptyState.className = "detail-empty";
          emptyState.textContent = "No typed issue detail context reported.";
          elements.issueExplain.appendChild(emptyState);
        }
      }

      function renderStatus() {
        if (!state.status) {
          return;
        }

        const status = state.status;
        const reconciliationPhase = status.reconciliationPhase || "steady";
        setText(elements.statusReconciliation, reconciliationPhase);
        elements.statusReconciliation.className = "metric " + metricClass(reconciliationPhase);
        setText(elements.statusWarning, status.warning ? status.warning.message : "");
        elements.statusWarning?.classList.remove("danger");
        if (elements.statusMetrics) {
          elements.statusMetrics.innerHTML = "";
          appendMetricTile(
            elements.statusMetrics,
            "tracked",
            String((status.trackedIssues || []).length),
            (status.trackedIssues || []).length > 0 ? "info" : "",
            "issues with supervisor worktrees",
          );
          appendMetricTile(
            elements.statusMetrics,
            "runnable",
            String((status.runnableIssues || []).length),
            (status.runnableIssues || []).length > 0 ? "ok" : "",
            "ready candidates surfaced by the supervisor",
          );
          appendMetricTile(
            elements.statusMetrics,
            "blocked",
            String((status.blockedIssues || []).length),
            (status.blockedIssues || []).length > 0 ? "warn" : "",
            "issues waiting on scope or verification",
          );
          appendMetricTile(
            elements.statusMetrics,
            "candidates",
            countCandidateIssues(status),
            status.candidateDiscovery && status.candidateDiscovery.warning ? "warn" : "",
            status.selectionSummary && status.selectionSummary.selectedIssueNumber
              ? "selected " + formatIssueRef(status.selectionSummary.selectedIssueNumber)
              : "no active issue selected",
          );
        }
        renderWorkflow(status);
        if (elements.statusLines) {
          const lines = buildStatusLines(status);
          elements.statusLines.innerHTML = "";
          const summaryLines = lines.length > 0 ? lines : ["No status lines reported."];
          for (const line of summaryLines) {
            appendTextCard(elements.statusLines, "status-line", line);
          }
        }
        renderTrackedHistory();
      }

      function renderTrackedHistory() {
        const trackedIssues = collectTrackedIssues(state.status, {
          includeDone: state.showDoneTrackedIssues,
        });
        setText(
          elements.trackedHistorySummary,
          formatTrackedHistorySummary(state.status, {
            includeDone: state.showDoneTrackedIssues,
          }),
        );
        if (elements.trackedHistoryLines) {
          elements.trackedHistoryLines.innerHTML = "";
          if (trackedIssues.length === 0) {
            elements.trackedHistoryLines.appendChild(
              buildEmptyState(
                "◎",
                state.showDoneTrackedIssues ? "No tracked issues reported" : "No active tracked issues",
                state.showDoneTrackedIssues
                  ? "Tracked items will appear here after supervisor activity."
                  : "Show done issues to inspect older queue history.",
              ),
            );
          } else {
            for (const trackedIssue of trackedIssues) {
              const card = document.createElement("article");
              card.className = "history-card";

              const header = document.createElement("div");
              header.className = "history-card-header";

              const issueNumber = document.createElement("strong");
              issueNumber.className = "history-number";
              issueNumber.textContent = "#" + trackedIssue.issueNumber;
              header.appendChild(issueNumber);

              const chips = document.createElement("div");
              chips.className = "chip-row";
              appendChip(chips, trackedIssue.state, toneForStatus(trackedIssue.state));
              if (trackedIssue.prNumber !== null && trackedIssue.prNumber !== undefined) {
                appendChip(chips, "pr #" + trackedIssue.prNumber, "info");
              }
              if (trackedIssue.blockedReason) {
                appendChip(chips, trackedIssue.blockedReason, "warn");
              }
              header.appendChild(chips);

              const meta = document.createElement("p");
              meta.className = "history-meta";
              meta.textContent =
                trackedIssue.state === "done"
                  ? "Completed tracked issue kept for operator history."
                  : "Tracked issue remains active in the supervisor queue.";

              card.appendChild(header);
              card.appendChild(meta);
              elements.trackedHistoryLines.appendChild(card);
            }
          }
        }
        if (elements.trackedHistoryToggle) {
          elements.trackedHistoryToggle.textContent = state.showDoneTrackedIssues ? "Hide done issues" : "Show done issues";
        }
      }

      function renderDoctor() {
        if (!state.doctor) {
          return;
        }

        const doctor = state.doctor;
        if (elements.doctorOverall) {
          setText(elements.doctorOverall, doctor.overallStatus);
          elements.doctorOverall.className = "metric " + metricClass(doctor.overallStatus);
        }
        const checks = doctor.checks || [];
        if (!elements.doctorChecks) {
          return;
        }
        elements.doctorChecks.innerHTML = "";
        for (const check of checks) {
          const item = document.createElement("li");
          const summary = document.createElement("div");
          summary.textContent = check.name + " " + check.summary;
          item.appendChild(summary);

          const chips = document.createElement("div");
          chips.className = "chip-row";
          appendChip(chips, check.status, toneForStatus(check.status));
          item.appendChild(chips);
          elements.doctorChecks.appendChild(item);
        }
      }

      function renderIssue() {
        if (!state.explain) {
          setText(elements.issueSummary, "No issue loaded.");
          if (elements.issueMetrics) {
            elements.issueMetrics.innerHTML = "";
            elements.issueMetrics.appendChild(buildEmptyState("#", "No issue metrics yet", "Load an issue to inspect status, selection, and lint posture."));
          }
          if (elements.issueLint) {
            elements.issueLint.innerHTML = "";
            elements.issueLint.appendChild(buildEmptyState("!", "No lint posture yet", "Issue lint will appear after an issue is loaded."));
          }
          return;
        }

        const explain = state.explain;
        setText(
          elements.issueSummary,
          "#" + explain.issueNumber + " " + explain.title + " | runnable=" + (explain.runnable ? "yes" : "no"),
        );
        if (elements.issueMetrics) {
          elements.issueMetrics.innerHTML = "";
          appendMetricTile(
            elements.issueMetrics,
            "state",
            explain.state || "unknown",
            toneForStatus(explain.state),
            explain.blockedReason && explain.blockedReason !== "none" ? explain.blockedReason : "current issue posture",
          );
          appendMetricTile(
            elements.issueMetrics,
            "runnable",
            explain.runnable ? "yes" : "no",
            explain.runnable ? "ok" : "warn",
            "selection reason: " + (explain.selectionReason || "none"),
          );
          appendMetricTile(
            elements.issueMetrics,
            "reasons",
            String((explain.reasons || []).length),
            (explain.reasons || []).length > 0 ? "info" : "",
            (explain.reasons || []).join(" | ") || "no explain reasons",
          );
          appendMetricTile(
            elements.issueMetrics,
            "recovery",
            explain.latestRecoverySummary ? "recent" : "quiet",
            explain.latestRecoverySummary ? "warn" : "ok",
            explain.latestRecoverySummary || explain.failureSummary || "no recent recovery or failure summary",
          );
        }
        renderIssueExplainDetails(explain);

        if (elements.issueLint) {
          elements.issueLint.innerHTML = "";
        }
        if (state.issueLint && elements.issueLint) {
          const lint = state.issueLint;
          appendMetricTile(
            elements.issueLint,
            "execution ready",
            lint.executionReady ? "yes" : "no",
            lint.executionReady ? "ok" : "warn",
            lint.highRiskBlockingAmbiguity || "typed issue lint posture",
          );
          appendMetricTile(
            elements.issueLint,
            "required gaps",
            String((lint.missingRequired || []).length),
            (lint.missingRequired || []).length > 0 ? "warn" : "ok",
            (lint.missingRequired || []).join(" | ") || "none",
          );
          appendMetricTile(
            elements.issueLint,
            "recommended gaps",
            String((lint.missingRecommended || []).length),
            (lint.missingRecommended || []).length > 0 ? "info" : "ok",
            (lint.missingRecommended || []).join(" | ") || "none",
          );
          appendMetricTile(
            elements.issueLint,
            "repair guidance",
            String((lint.repairGuidance || []).length),
            (lint.repairGuidance || []).length > 0 ? "warn" : "ok",
            (lint.repairGuidance || []).join(" | ") || "none",
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
          elements.issueShortcuts.appendChild(
            buildEmptyState("?", "No issue shortcuts yet", "Runnable or blocked issues will surface here."),
          );
          return;
        }

        for (const shortcut of shortcuts) {
          const button = document.createElement("button");
          button.className = "shortcut-button";
          const title = document.createElement("strong");
          title.textContent = "#" + shortcut.issueNumber;
          const detail = document.createElement("span");
          detail.textContent = shortcut.label + (shortcut.detail ? " • " + shortcut.detail : "");
          button.appendChild(title);
          button.appendChild(detail);
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
        if (!elements.eventList) {
          return;
        }
        elements.eventList.innerHTML = "";
        const events = state.events.length > 0 ? state.events : [{ type: "idle", at: "", summary: "Waiting for live events…" }];
        for (const event of events) {
          const card = document.createElement("div");
          card.className = "event-item";

          const meta = document.createElement("div");
          meta.className = "event-meta";
          meta.textContent = [event.type, event.family || "", event.at || ""].filter(Boolean).join(" | ");

          const summary = document.createElement("p");
          summary.className = "event-summary";
          summary.textContent = describeTimelineEvent(event);

          const chips = document.createElement("div");
          chips.className = "chip-row";
          appendChip(chips, event.type || "event", toneForStatus(event.type));
          if (event.family) {
            appendChip(chips, event.family, "info");
          }

          const body = document.createElement("p");
          body.className = "event-detail";
          body.textContent = JSON.stringify(event, null, 2);

          card.appendChild(meta);
          card.appendChild(summary);
          card.appendChild(chips);
          card.appendChild(body);
          elements.eventList.appendChild(card);
        }
      }

      function renderOperatorTimeline() {
        if (!elements.operatorTimeline) {
          return;
        }
        elements.operatorTimeline.innerHTML = "";
        const entries =
          state.timelineEntries.length > 0
            ? state.timelineEntries
            : [
                {
                  kind: "idle",
                  at: "",
                  summary: "Waiting for operator activity…",
                  detail: "Run a safe command or wait for live supervisor events.",
                  commandLabel: null,
                },
              ];
        for (const entry of entries) {
          const card = document.createElement("div");
          card.className = "event-item timeline-item";

          const dot = document.createElement("span");
          dot.className = "timeline-dot " + entry.kind;
          dot.textContent = entry.kind === "command" ? "C" : entry.kind === "refresh" ? "R" : "E";

          const meta = document.createElement("div");
          meta.className = "event-meta";
          meta.textContent = [entry.kind, entry.commandLabel ? "after " + entry.commandLabel : "", entry.at || ""]
            .filter(Boolean)
            .join(" | ");

          const summary = document.createElement("p");
          summary.className = "event-summary";
          summary.textContent = entry.summary || "Timeline event";

          const chips = document.createElement("div");
          chips.className = "chip-row";
          appendChip(chips, entry.kind, toneForStatus(entry.kind));
          if (entry.commandLabel) {
            appendChip(chips, "after " + entry.commandLabel, "info");
          }

          const body = document.createElement("p");
          body.className = "event-detail";
          body.textContent = entry.detail || "";

          card.appendChild(dot);
          card.appendChild(meta);
          card.appendChild(summary);
          card.appendChild(chips);
          card.appendChild(body);
          elements.operatorTimeline.appendChild(card);
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

      function buildInFlightCommandResult(label) {
        return {
          action: label,
          outcome: "in_progress",
          status: "Running " + label + "...",
          summary: "Waiting for " + label + " to finish.",
          guidance: "The dashboard will refresh automatically after the command finishes.",
        };
      }

      function addCommandGuidance(commandResult, guidance) {
        if (!commandResult || typeof commandResult !== "object") {
          return {
            guidance,
          };
        }
        return {
          ...commandResult,
          guidance,
        };
      }

      function pushTimeline(entry) {
        state.timelineEntries.unshift(entry);
        state.timelineEntries = state.timelineEntries.slice(0, 40);
        renderOperatorTimeline();
      }

      function normalizeCommandIssueNumbers(candidates) {
        const issueNumbers = [];
        for (const candidate of candidates) {
          if (typeof candidate !== "number" || !Number.isInteger(candidate) || issueNumbers.includes(candidate)) {
            continue;
          }
          issueNumbers.push(candidate);
        }
        return issueNumbers;
      }

      function getActiveCommandCorrelation() {
        if (!state.commandCorrelation) {
          return null;
        }
        if (Date.now() >= state.commandCorrelation.expiresAt) {
          state.commandCorrelation = null;
          return null;
        }
        return state.commandCorrelation;
      }

      function setCommandCorrelation(label, issueNumbers) {
        const normalizedIssueNumbers = normalizeCommandIssueNumbers(issueNumbers);
        state.commandCorrelation =
          normalizedIssueNumbers.length === 0
            ? null
            : {
                label,
                issueNumbers: normalizedIssueNumbers,
                expiresAt: Date.now() + COMMAND_CORRELATION_WINDOW_MS,
              };
      }

      function extendCommandCorrelation(issueNumber) {
        const commandCorrelation = getActiveCommandCorrelation();
        if (!commandCorrelation || typeof issueNumber !== "number" || !Number.isInteger(issueNumber)) {
          return;
        }
        if (commandCorrelation.issueNumbers.includes(issueNumber)) {
          return;
        }
        state.commandCorrelation = {
          label: commandCorrelation.label,
          issueNumbers: commandCorrelation.issueNumbers.concat(issueNumber),
          expiresAt: commandCorrelation.expiresAt,
        };
      }

      function correlationLabelForEvent(event) {
        const commandCorrelation = getActiveCommandCorrelation();
        if (!commandCorrelation) {
          return null;
        }
        const eventIssueNumbers = collectTimelineEventIssueNumbers(event);
        if (eventIssueNumbers.length === 0) {
          return null;
        }
        return eventIssueNumbers.some((issueNumber) => commandCorrelation.issueNumbers.includes(issueNumber))
          ? commandCorrelation.label
          : null;
      }

      function rejectCommand(action, summary, status) {
        state.commandResult = {
          action,
          outcome: "rejected",
          summary,
          status,
          guidance: "No changes were made. Review the confirmation or prerequisites and retry when ready.",
        };
        state.commandCorrelation = null;
        pushTimeline({
          kind: "command",
          at: new Date().toISOString(),
          summary: status || summary || action,
          detail: JSON.stringify(state.commandResult, null, 2),
          commandLabel: null,
        });
        renderCommandResult();
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
        state.refreshPhase = "refreshing";
        renderLiveState();
        try {
          const [status, doctor] = await Promise.all([
            readJson("/api/status?why=true"),
            readJson("/api/doctor"),
          ]);
          state.status = status;
          state.doctor = doctor;
          state.selectedIssueNumber = parseSelectedIssueNumber(status);
          state.refreshPhase = "idle";
          state.hasSuccessfulRefresh = true;
          state.lastRefreshAt = Date.now();
          renderStatus();
          renderDoctor();
          renderIssueShortcuts();
          renderSelectedIssue();
          renderLiveState();
        } catch (error) {
          state.refreshPhase = "failed";
          renderLiveState();
          throw error;
        }
      }

      async function loadIssue(issueNumber) {
        const requestedIssueNumber = issueNumber;
        state.loadedIssueNumber = requestedIssueNumber;
        state.explain = null;
        state.issueLint = null;
        renderSelectedIssue();
        setText(elements.issueSummary, "Loading issue...");
        setText(elements.issueExplain, "Loading /api/issues/" + requestedIssueNumber + "/explain...");
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
        const previousSelectedIssueNumber = state.selectedIssueNumber;
        state.commandResult = buildInFlightCommandResult(args.label);
        renderCommandResult();
        try {
          const result = await postCommand(args.path, args.body);
          state.commandResult = addCommandGuidance(
            result,
            "Status refreshed automatically after completion. Review the operator timeline for follow-up context.",
          );
          setCommandCorrelation(args.label, [args.issueNumber, previousSelectedIssueNumber]);
          pushTimeline({
            kind: "command",
            at: new Date().toISOString(),
            summary: describeTimelineCommandResult(state.commandResult),
            detail: JSON.stringify(state.commandResult, null, 2),
            commandLabel: null,
          });
          renderCommandResult();
          try {
            await refreshStatusAndDoctor();
            extendCommandCorrelation(state.selectedIssueNumber);
            pushTimeline({
              kind: "refresh",
              at: new Date().toISOString(),
              summary: describeCommandSelectionChange(previousSelectedIssueNumber, state.selectedIssueNumber),
              detail:
                "Refreshed /api/status and /api/doctor after " +
                args.label +
                ". Follow-up issue: " +
                formatIssueRef(state.selectedIssueNumber) +
                ".",
              commandLabel: args.label,
            });
            const issueNumberToLoad = state.selectedIssueNumber ?? state.loadedIssueNumber;
            if (issueNumberToLoad !== null) {
              await loadIssue(issueNumberToLoad);
            }
          } catch (error) {
            state.commandResult = addCommandGuidance(
              state.commandResult,
              "Command completed, but the dashboard refresh failed. Use the warning above before relying on the visible state.",
            );
            renderCommandResult();
            reportRefreshError(error);
          }
        } catch (error) {
          setText(elements.commandStatus, previousStatus || "Command failed.");
          state.commandCorrelation = null;
          state.commandResult = {
            action: args.label,
            outcome: "rejected",
            summary: error instanceof Error ? error.message : String(error),
            guidance: "No dashboard refresh was attempted because the command request failed.",
          };
          pushTimeline({
            kind: "command",
            at: new Date().toISOString(),
            summary: state.commandResult.summary || "Command failed.",
            detail: JSON.stringify(state.commandResult, null, 2),
            commandLabel: null,
          });
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
        state.connectionPhase = "connecting";
        renderLiveState();

        source.addEventListener("open", () => {
          state.connectionPhase = "open";
          renderLiveState();
        });

        source.addEventListener("error", () => {
          state.connectionPhase = "reconnecting";
          renderLiveState();
        });

        const onEvent = async (rawEvent) => {
          let parsed = { type: rawEvent.type, family: "event", at: new Date().toISOString(), raw: rawEvent.data };
          try {
            parsed = JSON.parse(rawEvent.data);
          } catch {}
          pushEvent(parsed);
          pushTimeline({
            kind: "event",
            at: parsed.at || new Date().toISOString(),
            summary: describeTimelineEvent(parsed),
            detail: JSON.stringify(parsed, null, 2),
            commandLabel: correlationLabelForEvent(parsed),
          });
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

      elements.trackedHistoryToggle?.addEventListener("click", () => {
        state.showDoneTrackedIssues = !state.showDoneTrackedIssues;
        renderTrackedHistory();
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
          issueNumber: state.explain.issueNumber,
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
        renderLiveState();
        try {
          await refreshStatusAndDoctor();
          const issueNumberToLoad = state.selectedIssueNumber ?? state.loadedIssueNumber;
          if (issueNumberToLoad !== null) {
            await loadIssue(issueNumberToLoad);
          }
        } catch (error) {
          reportRefreshError(error);
        }

        renderCommandResult();
        wireEvents();
        renderEvents();
        renderOperatorTimeline();
      }

      void bootstrap();
  `;
}
