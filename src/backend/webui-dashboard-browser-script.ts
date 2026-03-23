import {
  applyDashboardPanelDrop,
  buildStatusLines,
  collectTrackedIssues,
  collectIssueShortcuts,
  describeCommandSelectionChange,
  formatBlockedIssues,
  formatCandidateDiscovery,
  formatIssueRef,
  formatRunnableIssues,
  formatTrackedHistorySummary,
  formatTrackedIssueSummary,
  formatTrackedIssues,
  describeConnectionHealth,
  describeFreshnessState,
  describeTimelineEvent,
  collectTimelineEventIssueNumbers,
  normalizeDashboardPanelOrder,
  parseSelectedIssueNumber,
  restoreDashboardPanelOrder,
  serializeDashboardPanelOrder,
} from "./webui-dashboard-browser-logic";
import { DASHBOARD_PANEL_REGISTRY } from "./webui-dashboard-panel-layout";

const injectedBrowserLogic = [
  normalizeDashboardPanelOrder,
  applyDashboardPanelDrop,
  collectTrackedIssues,
  formatTrackedIssues,
  formatTrackedHistorySummary,
  formatTrackedIssueSummary,
  formatRunnableIssues,
  formatBlockedIssues,
  formatCandidateDiscovery,
  formatIssueRef,
  buildStatusLines,
  collectIssueShortcuts,
  describeCommandSelectionChange,
  describeConnectionHealth,
  describeFreshnessState,
  describeTimelineEvent,
  collectTimelineEventIssueNumbers,
  parseSelectedIssueNumber,
  restoreDashboardPanelOrder,
  serializeDashboardPanelOrder,
]
  .map((helper) => helper.toString().replace(/__name\([^;]+;\s*/gu, ""))
  .join("\n\n");

export function renderDashboardBrowserScript(): string {
  const dashboardPanelIds = DASHBOARD_PANEL_REGISTRY.map((panel) => panel.id);
  const dashboardPanelSections = Object.fromEntries(DASHBOARD_PANEL_REGISTRY.map((panel) => [panel.id, panel.section]));
  return `
      ${injectedBrowserLogic}

      const DASHBOARD_PANEL_IDS = ${JSON.stringify(dashboardPanelIds)};
      const DASHBOARD_PANEL_SECTIONS = ${JSON.stringify(dashboardPanelSections)};
      const DASHBOARD_PANEL_LAYOUT_STORAGE_KEY = "codex-supervisor.dashboard.panel-layout";

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
        panelLayout: {
          order: restoreDashboardPanelOrder(readDashboardPanelLayoutStorage(), DASHBOARD_PANEL_IDS),
        },
        draggedPanelId: null,
        dropTargetPanelId: null,
        pointerDrag: null,
      };

      const elements = {
        connectionState: document.getElementById("connection-state"),
        freshnessState: document.getElementById("freshness-state"),
        refreshState: document.getElementById("refresh-state"),
        selectedIssueBadge: document.getElementById("selected-issue-badge"),
        lastRefreshBadge: document.getElementById("last-refresh-badge"),
        statusReconciliation: document.getElementById("status-reconciliation"),
        statusLines: document.getElementById("status-lines"),
        statusWarning: document.getElementById("status-warning"),
        trackedHistorySummary: document.getElementById("tracked-history-summary"),
        trackedHistoryLines: document.getElementById("tracked-history-lines"),
        trackedHistoryToggle: document.getElementById("tracked-history-toggle"),
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
        operatorTimeline: document.getElementById("operator-timeline"),
        eventList: document.getElementById("event-list"),
        overviewGrid: document.getElementById("overview-grid"),
        detailsGrid: document.getElementById("details-grid"),
        panelReorderStatus: document.getElementById("dashboard-panel-reorder-status"),
        panels: Object.fromEntries(
          DASHBOARD_PANEL_IDS.map((panelId) => [panelId, document.getElementById("panel-" + panelId)]),
        ),
        dragHandles: Object.fromEntries(
          DASHBOARD_PANEL_IDS.map((panelId) => [panelId, document.getElementById("panel-drag-" + panelId)]),
        ),
      };

      const knownEventTypes = [
        "supervisor.recovery",
        "supervisor.active_issue.changed",
        "supervisor.loop.skipped",
        "supervisor.run_lock.blocked",
        "supervisor.review_wait.changed",
      ];

      const COMMAND_CORRELATION_WINDOW_MS = 15000;

      function readDashboardPanelLayoutStorage() {
        try {
          return window.localStorage?.getItem(DASHBOARD_PANEL_LAYOUT_STORAGE_KEY) ?? null;
        } catch {
          return null;
        }
      }

      function persistDashboardPanelLayout() {
        try {
          window.localStorage?.setItem(
            DASHBOARD_PANEL_LAYOUT_STORAGE_KEY,
            serializeDashboardPanelOrder(state.panelLayout.order, DASHBOARD_PANEL_IDS),
          );
        } catch {}
      }

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
        element.className = liveBadgeClass(tone);
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

      function clearDragState() {
        const draggedPanel = state.draggedPanelId === null ? null : elements.panels[state.draggedPanelId];
        const dropTargetPanel = state.dropTargetPanelId === null ? null : elements.panels[state.dropTargetPanelId];
        draggedPanel?.classList.remove("drag-active");
        dropTargetPanel?.classList.remove("drop-target");
        state.draggedPanelId = null;
        state.dropTargetPanelId = null;
      }

      function canDropPanelOnTarget(draggedPanelId, targetPanelId) {
        if (draggedPanelId === null || draggedPanelId === targetPanelId) {
          return false;
        }

        const normalizedOrder = normalizeDashboardPanelOrder(state.panelLayout.order, DASHBOARD_PANEL_IDS);
        const draggedIndex = normalizedOrder.indexOf(draggedPanelId);
        const targetIndex = normalizedOrder.indexOf(targetPanelId);
        if (draggedIndex === -1 || targetIndex === -1) {
          return false;
        }

        return DASHBOARD_PANEL_SECTIONS[normalizedOrder[draggedIndex]] === DASHBOARD_PANEL_SECTIONS[normalizedOrder[targetIndex]];
      }

      function announcePanelReorderStatus(message) {
        setText(elements.panelReorderStatus, message);
      }

      function setDropTargetPanel(panelId) {
        if (state.dropTargetPanelId === panelId) {
          return;
        }
        const previousTarget = state.dropTargetPanelId === null ? null : elements.panels[state.dropTargetPanelId];
        previousTarget?.classList.remove("drop-target");
        state.dropTargetPanelId = panelId;
        const nextTarget = panelId === null ? null : elements.panels[panelId];
        nextTarget?.classList.add("drop-target");
      }

      function getKeyboardDropCandidates(draggedPanelId) {
        const normalizedOrder = normalizeDashboardPanelOrder(state.panelLayout.order, DASHBOARD_PANEL_IDS);
        const draggedSection = DASHBOARD_PANEL_SECTIONS[draggedPanelId];
        return normalizedOrder.filter(
          (panelId) => panelId !== draggedPanelId && DASHBOARD_PANEL_SECTIONS[panelId] === draggedSection,
        );
      }

      function panelIdFromElement(element) {
        if (!(element instanceof Element)) {
          return null;
        }
        const panel = element.closest("[data-panel-id]");
        if (!(panel instanceof HTMLElement)) {
          return null;
        }
        const panelId = panel.dataset.panelId || null;
        return panelId && panelId in elements.panels ? panelId : null;
      }

      function getPointerDropTarget(clientX, clientY) {
        const hoveredPanelId = panelIdFromElement(document.elementFromPoint(clientX, clientY));
        return canDropPanelOnTarget(state.draggedPanelId, hoveredPanelId) ? hoveredPanelId : null;
      }

      function moveKeyboardDropTarget(draggedPanelId, direction) {
        const candidates = getKeyboardDropCandidates(draggedPanelId);
        if (candidates.length === 0) {
          return null;
        }

        if (state.dropTargetPanelId && candidates.includes(state.dropTargetPanelId)) {
          const currentIndex = candidates.indexOf(state.dropTargetPanelId);
          const nextIndex = Math.max(0, Math.min(candidates.length - 1, currentIndex + direction));
          return candidates[nextIndex];
        }

        const normalizedOrder = normalizeDashboardPanelOrder(state.panelLayout.order, DASHBOARD_PANEL_IDS);
        const draggedIndex = normalizedOrder.indexOf(draggedPanelId);
        if (draggedIndex === -1) {
          return candidates[0];
        }

        const draggedPeers = normalizedOrder.filter(
          (panelId) => panelId !== draggedPanelId && DASHBOARD_PANEL_SECTIONS[panelId] === DASHBOARD_PANEL_SECTIONS[draggedPanelId],
        );
        if (direction < 0) {
          const previousPeer = [...draggedPeers].reverse().find((panelId) => normalizedOrder.indexOf(panelId) < draggedIndex);
          return previousPeer ?? candidates[0];
        }

        const nextPeer = draggedPeers.find((panelId) => normalizedOrder.indexOf(panelId) > draggedIndex);
        if (!nextPeer) {
          return candidates[candidates.length - 1];
        }

        const nextPeerIndex = candidates.indexOf(nextPeer);
        return candidates[Math.min(candidates.length - 1, nextPeerIndex + 1)] ?? candidates[candidates.length - 1];
      }

      function startKeyboardPanelDrag(panelId) {
        state.draggedPanelId = panelId;
        elements.panels[panelId]?.classList.add("drag-active");
        setDropTargetPanel(null);
        announcePanelReorderStatus(
          "Picked up " + panelId.replace(/-/g, " ") + " panel. Use arrow keys to choose a drop target, Enter to drop, and Escape to cancel.",
        );
      }

      function commitPanelDrop(targetPanelId) {
        if (!canDropPanelOnTarget(state.draggedPanelId, targetPanelId)) {
          clearDragState();
          announcePanelReorderStatus("Panel reorder cancelled.");
          return;
        }

        state.panelLayout.order = applyDashboardPanelDrop(
          state.panelLayout.order,
          state.draggedPanelId,
          targetPanelId,
          DASHBOARD_PANEL_IDS,
        );
        renderPanelLayout();
        const draggedPanelId = state.draggedPanelId;
        clearDragState();
        announcePanelReorderStatus(
          "Moved " + String(draggedPanelId).replace(/-/g, " ") + " panel before " + targetPanelId.replace(/-/g, " ") + ".",
        );
      }

      function startPointerPanelDrag(panelId) {
        clearDragState();
        state.draggedPanelId = panelId;
        elements.panels[panelId]?.classList.add("drag-active");
        setDropTargetPanel(null);
        announcePanelReorderStatus("Dragging " + panelId.replace(/-/g, " ") + " panel.");
      }

      function finishPointerPanelDrag(panelId, cancelled) {
        const activePointerDrag = state.pointerDrag;
        if (!activePointerDrag || activePointerDrag.panelId !== panelId) {
          return;
        }

        const dragHandle = elements.dragHandles[panelId];
        if (dragHandle) {
          dragHandle.draggable = true;
          if (
            typeof dragHandle.hasPointerCapture === "function" &&
            typeof dragHandle.releasePointerCapture === "function" &&
            activePointerDrag.pointerId !== null &&
            dragHandle.hasPointerCapture(activePointerDrag.pointerId)
          ) {
            dragHandle.releasePointerCapture(activePointerDrag.pointerId);
          }
        }

        state.pointerDrag = null;
        if (!activePointerDrag.active) {
          return;
        }

        if (cancelled) {
          clearDragState();
          announcePanelReorderStatus("Panel reorder cancelled.");
          return;
        }

        commitPanelDrop(state.dropTargetPanelId);
      }

      function renderPanelLayout() {
        state.panelLayout.order = normalizeDashboardPanelOrder(state.panelLayout.order, DASHBOARD_PANEL_IDS);
        persistDashboardPanelLayout();

        const overviewPanels = [];
        const detailPanels = [];
        for (const panelId of state.panelLayout.order) {
          const panel = elements.panels[panelId];
          if (!panel) {
            continue;
          }
          if (DASHBOARD_PANEL_SECTIONS[panelId] === "overview") {
            overviewPanels.push(panel);
            continue;
          }
          detailPanels.push(panel);
        }

        for (const panel of overviewPanels) {
          elements.overviewGrid?.appendChild(panel);
        }
        for (const panel of detailPanels) {
          elements.detailsGrid?.appendChild(panel);
        }
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
        setText(elements.statusReconciliation, status.reconciliationPhase || "steady");
        setText(elements.statusWarning, status.warning ? status.warning.message : "");
        elements.statusWarning?.classList.remove("danger");
        const lines = buildStatusLines(status);
        setCode(elements.statusLines, lines.length > 0 ? lines : ["No status lines reported."]);
        renderTrackedHistory();
      }

      function renderTrackedHistory() {
        const trackedHistoryLines = formatTrackedIssues(state.status, {
          includeDone: state.showDoneTrackedIssues,
        });
        setText(
          elements.trackedHistorySummary,
          formatTrackedHistorySummary(state.status, {
            includeDone: state.showDoneTrackedIssues,
          }),
        );
        setCode(
          elements.trackedHistoryLines,
          trackedHistoryLines.length > 0
            ? trackedHistoryLines
            : [
                state.showDoneTrackedIssues
                  ? "No tracked issues reported."
                  : "No non-done tracked issues. Show done issues to inspect older history.",
              ],
        );
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
        renderIssueExplainDetails(explain);

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

          const body = document.createElement("div");
          body.textContent = JSON.stringify(event, null, 2);

          card.appendChild(meta);
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
          card.className = "event-item";

          const meta = document.createElement("div");
          meta.className = "event-meta";
          meta.textContent = [entry.kind, entry.commandLabel ? "after " + entry.commandLabel : "", entry.at || ""]
            .filter(Boolean)
            .join(" | ");

          const body = document.createElement("div");
          body.textContent = [entry.summary, entry.detail].filter(Boolean).join("\\n");

          card.appendChild(meta);
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
            summary: state.commandResult.status || state.commandResult.summary || args.label,
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
              detail: "Refreshed /api/status and /api/doctor after " + args.label + ".",
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

      function wirePanelDragAndDrop() {
        for (const panelId of DASHBOARD_PANEL_IDS) {
          const panel = elements.panels[panelId];
          const dragHandle = elements.dragHandles[panelId];
          if (!panel || !dragHandle) {
            continue;
          }

          dragHandle.addEventListener("dragstart", (event) => {
            if (state.pointerDrag?.panelId === panelId) {
              event.preventDefault();
              return;
            }
            clearDragState();
            state.draggedPanelId = panelId;
            panel.classList.add("drag-active");
            setDropTargetPanel(null);
            announcePanelReorderStatus("Dragging " + panelId.replace(/-/g, " ") + " panel.");
            if (event.dataTransfer) {
              event.dataTransfer.effectAllowed = "move";
              event.dataTransfer.setData("text/plain", panelId);
            }
          });

          dragHandle.addEventListener("dragend", () => {
            const shouldAnnounceFinished = state.draggedPanelId === panelId;
            clearDragState();
            if (shouldAnnounceFinished) {
              announcePanelReorderStatus("Panel reorder finished.");
            }
          });

          dragHandle.addEventListener("pointerdown", (event) => {
            if (!event.isPrimary || event.button !== 0) {
              return;
            }
            state.pointerDrag = {
              panelId,
              pointerId: event.pointerId ?? null,
              startX: event.clientX ?? 0,
              startY: event.clientY ?? 0,
              active: false,
            };
            dragHandle.draggable = false;
            if (typeof dragHandle.setPointerCapture === "function" && event.pointerId !== undefined) {
              dragHandle.setPointerCapture(event.pointerId);
            }
          });

          dragHandle.addEventListener("pointermove", (event) => {
            const activePointerDrag = state.pointerDrag;
            if (!activePointerDrag || activePointerDrag.panelId !== panelId) {
              return;
            }
            const clientX = event.clientX ?? activePointerDrag.startX;
            const clientY = event.clientY ?? activePointerDrag.startY;
            if (!activePointerDrag.active) {
              const deltaX = clientX - activePointerDrag.startX;
              const deltaY = clientY - activePointerDrag.startY;
              if (Math.hypot(deltaX, deltaY) < 6) {
                return;
              }
              activePointerDrag.active = true;
              startPointerPanelDrag(panelId);
            }

            setDropTargetPanel(getPointerDropTarget(clientX, clientY));
            event.preventDefault();
          });

          dragHandle.addEventListener("pointerup", (event) => {
            const activePointerDrag = state.pointerDrag;
            if (!activePointerDrag || activePointerDrag.panelId !== panelId) {
              return;
            }
            finishPointerPanelDrag(panelId, false);
            event.preventDefault();
          });

          dragHandle.addEventListener("pointercancel", () => {
            finishPointerPanelDrag(panelId, true);
          });

          dragHandle.addEventListener("lostpointercapture", () => {
            finishPointerPanelDrag(panelId, true);
          });

          dragHandle.addEventListener("keydown", (event) => {
            const key = event.key;
            if (key === " " || key === "Enter") {
              event.preventDefault();
              if (state.draggedPanelId !== panelId) {
                clearDragState();
                startKeyboardPanelDrag(panelId);
                return;
              }
              commitPanelDrop(state.dropTargetPanelId);
              return;
            }

            if (key === "Escape" && state.draggedPanelId === panelId) {
              event.preventDefault();
              clearDragState();
              announcePanelReorderStatus("Panel reorder cancelled.");
              return;
            }

            if ((key === "ArrowUp" || key === "ArrowDown") && state.draggedPanelId === panelId) {
              event.preventDefault();
              const nextTarget = moveKeyboardDropTarget(panelId, key === "ArrowUp" ? -1 : 1);
              setDropTargetPanel(nextTarget);
              if (nextTarget) {
                announcePanelReorderStatus(
                  "Drop target " + nextTarget.replace(/-/g, " ") + ". Press Enter to move the panel.",
                );
              }
            }
          });

          panel.addEventListener("dragover", (event) => {
            if (!canDropPanelOnTarget(state.draggedPanelId, panelId)) {
              return;
            }
            event.preventDefault();
            setDropTargetPanel(panelId);
            if (event.dataTransfer) {
              event.dataTransfer.dropEffect = "move";
            }
          });

          panel.addEventListener("dragleave", (event) => {
            if (event.target !== panel) {
              return;
            }
            if (state.dropTargetPanelId === panelId) {
              setDropTargetPanel(null);
            }
          });

          panel.addEventListener("drop", (event) => {
            if (state.draggedPanelId === null) {
              return;
            }
            if (!canDropPanelOnTarget(state.draggedPanelId, panelId)) {
              clearDragState();
              announcePanelReorderStatus("Panel reorder cancelled.");
              return;
            }
            event.preventDefault();
            commitPanelDrop(panelId);
          });
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
        renderPanelLayout();
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
        wirePanelDragAndDrop();
        wireEvents();
        renderEvents();
        renderOperatorTimeline();
      }

      void bootstrap();
  `;
}
