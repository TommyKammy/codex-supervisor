import {
  buildAttentionItems,
  buildNextIssueSummary,
  buildOverviewSummary,
  buildPrimaryActionSummary,
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
import {
  buildWorkflowSteps,
  countCandidateIssues,
  describeLoopRuntime,
  formatKeyValueBlock,
  formatRefreshTime,
  liveBadgeClass,
  metricClass,
} from "./webui-dashboard-browser-view-model";
import {
  buildIssueExplainSections,
  formatLatestRecovery,
  formatReviewWaits,
} from "./webui-dashboard-browser-issue-details";
import {
  createDashboardControlLayer,
} from "./webui-dashboard-browser-controls";
import {
  registerDashboardDomInteractions,
  wireDashboardEventStream,
} from "./webui-dashboard-browser-interactions";
import { WEBUI_MUTATION_AUTH_HEADER, WEBUI_MUTATION_AUTH_STORAGE_KEY } from "./webui-mutation-auth";
import {
  formatBrowserToken,
  normalizeBrowserLocalCiContract,
  buildBrowserLocalCiStatusLines,
  buildMutationHeaders,
  postMutationJsonWithAuth,
  promptForMutationAuthToken,
  readMutationResponsePayload,
  readStoredMutationAuthToken,
  writeStoredMutationAuthToken,
} from "./webui-browser-script-helpers";

const injectedBrowserLogic = [
  formatBrowserToken,
  normalizeBrowserLocalCiContract,
  buildBrowserLocalCiStatusLines,
  readStoredMutationAuthToken,
  writeStoredMutationAuthToken,
  promptForMutationAuthToken,
  buildMutationHeaders,
  readMutationResponsePayload,
  postMutationJsonWithAuth,
  createDashboardControlLayer,
  registerDashboardDomInteractions,
  wireDashboardEventStream,
  buildOverviewSummary,
  buildNextIssueSummary,
  buildPrimaryActionSummary,
  buildAttentionItems,
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
  collectIssueShortcuts,
  describeCommandSelectionChange,
  describeConnectionHealth,
  describeFreshnessState,
  humanizeTimelineValue,
  describeTimelineCommandResult,
  describeTimelineEvent,
  collectTimelineEventIssueNumbers,
  parseSelectedIssueNumber,
  countCandidateIssues,
  buildWorkflowSteps,
  metricClass,
  formatKeyValueBlock,
  liveBadgeClass,
  formatRefreshTime,
  describeLoopRuntime,
  formatLatestRecovery,
  formatReviewWaits,
  buildIssueExplainSections,
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
        issueLoadError: null,
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
        connectionStatePill: document.getElementById("connection-state-pill"),
        freshnessState: document.getElementById("freshness-state"),
        refreshState: document.getElementById("refresh-state"),
        selectedIssueBadge: document.getElementById("selected-issue-badge"),
        lastRefreshBadge: document.getElementById("last-refresh-badge"),
        lastRefreshPill: document.getElementById("last-refresh-pill"),
        loopModeBadge: document.getElementById("loop-mode-badge"),
        loopStateSummary: document.getElementById("loop-state-summary"),
        overviewHeadline: document.getElementById("overview-headline"),
        overviewDetail: document.getElementById("overview-detail"),
        overviewWarning: document.getElementById("overview-warning"),
        nextIssueTitle: document.getElementById("next-issue-title"),
        nextIssueDetail: document.getElementById("next-issue-detail"),
        primaryActionTitle: document.getElementById("primary-action-title"),
        primaryActionDetail: document.getElementById("primary-action-detail"),
        attentionList: document.getElementById("attention-list"),
        focusBreadcrumb: document.getElementById("focus-breadcrumb"),
        heroBadgeRow: document.getElementById("hero-badge-row"),
        heroReason: document.getElementById("hero-reason"),
        heroPrimaryButton: document.getElementById("hero-primary-button"),
        heroSecondaryButton: document.getElementById("hero-secondary-button"),
        heroTertiaryButton: document.getElementById("hero-tertiary-button"),
        selectedIssueHeading: document.getElementById("selected-issue-heading"),
        selectedIssueDetail: document.getElementById("selected-issue-detail"),
        selectedIssueSummaryMetrics: document.getElementById("selected-issue-summary-metrics"),
        selectedIssueSummaryNotes: document.getElementById("selected-issue-summary-notes"),
        detailsDisclosure: document.getElementById("details-disclosure"),
        navOverviewHeading: document.getElementById("nav-overview-heading"),
        navPanelStatus: document.getElementById("nav-panel-status"),
        navPanelDoctor: document.getElementById("nav-panel-doctor"),
        navPanelIssueDetails: document.getElementById("nav-panel-issue-details"),
        navPanelTrackedHistory: document.getElementById("nav-panel-tracked-history"),
        navPanelOperatorActions: document.getElementById("nav-panel-operator-actions"),
        navPanelLiveEvents: document.getElementById("nav-panel-live-events"),
        navPanelOperatorTimeline: document.getElementById("nav-panel-operator-timeline"),
        statusReconciliation: document.getElementById("status-reconciliation"),
        statusLoopChip: document.getElementById("status-loop-chip"),
        statusMetrics: document.getElementById("status-metrics"),
        statusWorkflow: document.getElementById("status-workflow"),
        statusLines: document.getElementById("status-lines"),
        statusPanelWarning: document.getElementById("status-panel-warning"),
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
      const mutationAuthStorageKey = ${JSON.stringify(WEBUI_MUTATION_AUTH_STORAGE_KEY)};
      const mutationAuthHeader = ${JSON.stringify(WEBUI_MUTATION_AUTH_HEADER)};

      function buildStatusLines(status) {
        return [
          ...formatTrackedIssueSummary(status),
          ...formatRunnableIssues(status),
          ...formatBlockedIssues(status),
          ...(status?.detailedStatusLines ?? []),
          ...(status?.readinessLines ?? []),
          ...(status?.whyLines ?? []),
          ...formatCandidateDiscovery(status),
          ...buildBrowserLocalCiStatusLines(status?.localCiContract ?? null),
          ...(status?.reconciliationWarning ? [status.reconciliationWarning] : []),
        ];
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

      function setLiveBadgeState(element, label, tone) {
        if (!element) {
          return;
        }
        setText(element, label);
        const toneClass = liveBadgeClass(tone);
        element.className = ["live-value", toneClass].filter(Boolean).join(" ");
      }

      function setPillState(element, label, tone, baseClassName) {
        if (!element) {
          return;
        }
        setText(element, label);
        element.className = [baseClassName, tone || "info"].filter(Boolean).join(" ");
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
        setPillState(elements.connectionStatePill, "Connection: " + connectionLabel, connectionTone, "topbar-pill");
        setLiveBadgeState(elements.freshnessState, freshnessLabel, freshnessTone);
        setPillState(elements.freshnessState, freshnessLabel, freshnessTone, "summary-pill");
        setPillState(elements.refreshState, state.refreshPhase, refreshTone, "summary-pill");
        setText(elements.lastRefreshBadge, formatRefreshTime(state.lastRefreshAt));
        setPillState(elements.lastRefreshPill, "Last updated: " + formatRefreshTime(state.lastRefreshAt), "", "topbar-pill");
        renderOverviewSummary();
        renderPrimaryActionSummary();
        renderAttentionSummary();
        renderHeroSummary();
      }

      function renderLoopRuntime(status) {
        const loopRuntime = describeLoopRuntime(status && status.loopRuntime);
        setPillState(elements.loopModeBadge, loopRuntime.modeBadge, loopRuntime.chipTone, "topbar-pill");
        setPillState(elements.loopStateSummary, loopRuntime.summary, loopRuntime.chipTone, "summary-pill");
        if (elements.statusLoopChip) {
          setText(elements.statusLoopChip, loopRuntime.chipLabel);
          elements.statusLoopChip.className = "chip " + loopRuntime.chipTone;
        }
      }

      function renderOverviewSummary() {
        const overview = buildOverviewSummary({
          status: state.status,
          doctor: state.doctor,
          connectionPhase: state.connectionPhase,
          refreshPhase: state.refreshPhase,
          hasSuccessfulRefresh: state.hasSuccessfulRefresh,
        });
        setText(elements.overviewHeadline, overview.headline);
        if (elements.overviewHeadline) {
          elements.overviewHeadline.className = ["summary-headline", overview.tone].filter(Boolean).join(" ");
        }
        setText(elements.overviewDetail, overview.detail);
      }

      function setWarningMessage(message, tone) {
        const targets = [elements.overviewWarning, elements.statusPanelWarning];
        for (const target of targets) {
          if (!target) {
            continue;
          }
          setText(target, message);
          target.classList.remove("danger");
          if (tone === "fail") {
            target.classList.add("danger");
          }
        }
      }

      function renderNextIssueSummary() {
        const nextIssue = buildNextIssueSummary(state.status);
        setText(elements.selectedIssueBadge, nextIssue.issueNumber === null ? "none" : formatIssueRef(nextIssue.issueNumber));
        setText(elements.nextIssueTitle, nextIssue.title);
        setText(elements.nextIssueDetail, nextIssue.detail);
      }

      function readLoopBadgeLabel(status) {
        const loopRuntime = describeLoopRuntime(status && status.loopRuntime);
        if (loopRuntime.chipLabel === "loop running") {
          return "Loop mode: running";
        }
        if (loopRuntime.chipLabel === "loop off") {
          return "Loop mode: off";
        }
        return "Loop mode: unknown";
      }

      function readTrackedIssue(issueNumber) {
        const trackedIssues = Array.isArray(state.status && state.status.trackedIssues) ? state.status.trackedIssues : [];
        return trackedIssues.find((trackedIssue) => trackedIssue.issueNumber === issueNumber) || null;
      }

      function hasHeroIssueFocus(nextIssue) {
        return (state.explain && typeof state.explain.issueNumber === "number") || nextIssue.issueNumber !== null;
      }

      function getHeroPrimaryActionConfig(nextIssue) {
        const doctorStatus = typeof state.doctor?.overallStatus === "string" ? state.doctor.overallStatus.toLowerCase() : "";
        const needsFreshRefresh =
          !state.hasSuccessfulRefresh || state.refreshPhase === "failed" || state.connectionPhase === "reconnecting";

        if (needsFreshRefresh) {
          return { mode: "refresh", label: "Refresh Dashboard" };
        }
        if (doctorStatus === "fail") {
          return { mode: "doctor", label: "Open Environment Checks" };
        }
        if (hasHeroIssueFocus(nextIssue)) {
          return { mode: "issue", label: "Open Issue Details" };
        }
        return { mode: "queue", label: "Open Queue Details" };
      }

      function getHeroSecondaryActionConfig(nextIssue) {
        const primaryActionConfig = getHeroPrimaryActionConfig(nextIssue);
        if (hasHeroIssueFocus(nextIssue) || primaryActionConfig.mode === "queue") {
          return { mode: "queue", label: "", hidden: true };
        }
        return { mode: "queue", label: "Open Queue Details", hidden: false };
      }

      function setButtonVisibility(element, hidden) {
        if (!element) {
          return;
        }
        if (hidden) {
          element.classList.add("is-hidden");
          return;
        }
        element.classList.remove("is-hidden");
      }

      function getFocusedIssueNumber() {
        const nextIssue = buildNextIssueSummary(state.status);
        return state.selectedIssueNumber ?? nextIssue.issueNumber ?? state.loadedIssueNumber;
      }

      function renderPrimaryActionSummary() {
        const action = buildPrimaryActionSummary({
          status: state.status,
          doctor: state.doctor,
          connectionPhase: state.connectionPhase,
          refreshPhase: state.refreshPhase,
          hasSuccessfulRefresh: state.hasSuccessfulRefresh,
        });
        setText(elements.primaryActionTitle, action.title);
        setText(elements.primaryActionDetail, action.detail);
      }

      function renderAttentionSummary() {
        if (!elements.attentionList) {
          return;
        }
        const items = buildAttentionItems({
          status: state.status,
          doctor: state.doctor,
          connectionPhase: state.connectionPhase,
          refreshPhase: state.refreshPhase,
          hasSuccessfulRefresh: state.hasSuccessfulRefresh,
        });
        elements.attentionList.innerHTML = "";
        for (const item of items) {
          const entry = document.createElement("li");
          entry.textContent = item;
          elements.attentionList.appendChild(entry);
        }
      }

      function renderHeroSummary() {
        const nextIssue = buildNextIssueSummary(state.status);
        const overview = buildOverviewSummary({
          status: state.status,
          doctor: state.doctor,
          connectionPhase: state.connectionPhase,
          refreshPhase: state.refreshPhase,
          hasSuccessfulRefresh: state.hasSuccessfulRefresh,
        });
        const action = buildPrimaryActionSummary({
          status: state.status,
          doctor: state.doctor,
          connectionPhase: state.connectionPhase,
          refreshPhase: state.refreshPhase,
          hasSuccessfulRefresh: state.hasSuccessfulRefresh,
        });
        const attentionItems = buildAttentionItems({
          status: state.status,
          doctor: state.doctor,
          connectionPhase: state.connectionPhase,
          refreshPhase: state.refreshPhase,
          hasSuccessfulRefresh: state.hasSuccessfulRefresh,
        });
        const freshnessLabel = describeFreshnessState({
          connectionPhase: state.connectionPhase,
          refreshPhase: state.refreshPhase,
          hasSuccessfulRefresh: state.hasSuccessfulRefresh,
        });
        const explain = state.explain;
        const lint = state.issueLint;
        const primaryActionConfig = getHeroPrimaryActionConfig(nextIssue);
        const secondaryActionConfig = getHeroSecondaryActionConfig(nextIssue);

        if (elements.focusBreadcrumb) {
          const breadcrumb = state.issueLoadError
            ? "Current Focus > Load failed"
            : explain
              ? "Current Focus > Issue " + formatIssueRef(explain.issueNumber)
              : nextIssue.issueNumber !== null
                ? "Current Focus > " + nextIssue.stateLabel + " " + formatIssueRef(nextIssue.issueNumber)
                : "Current Focus > Waiting for an issue";
          setText(elements.focusBreadcrumb, breadcrumb);
        }

        if (elements.heroReason) {
          const reason =
            explain && Array.isArray(explain.reasons) && explain.reasons.length > 0
              ? explain.reasons.join(" | ")
              : attentionItems[0] || "No immediate attention items are reported.";
          setText(elements.heroReason, "Reason: " + reason);
        }

        if (elements.heroBadgeRow) {
          elements.heroBadgeRow.innerHTML = "";

          if (state.issueLoadError) {
            appendChip(elements.heroBadgeRow, "Load failed", "fail");
            appendChip(elements.heroBadgeRow, "Checks: unavailable", "warn");
          } else if (explain) {
            const trackedIssue = readTrackedIssue(explain.issueNumber);
            appendChip(elements.heroBadgeRow, trackedIssue ? trackedIssue.state : "untracked", trackedIssue ? toneForStatus(trackedIssue.state) : "info");
            appendChip(elements.heroBadgeRow, explain.runnable ? "Runnable" : "Needs review", explain.runnable ? "ok" : "warn");
            appendChip(
              elements.heroBadgeRow,
              "Checks: " + (lint ? (lint.executionReady ? "ready" : "needs review") : "loading"),
              lint ? (lint.executionReady ? "ok" : "warn") : "info",
            );
            appendChip(
              elements.heroBadgeRow,
              "Recovery: " + (explain.latestRecoverySummary ? "recent" : "quiet"),
              explain.latestRecoverySummary ? "warn" : "ok",
            );
            appendChip(elements.heroBadgeRow, readLoopBadgeLabel(state.status), "info");
            appendChip(elements.heroBadgeRow, freshnessLabel, toneForStatus(freshnessLabel));
            appendChip(elements.heroBadgeRow, state.refreshPhase, toneForStatus(state.refreshPhase));
          } else if (nextIssue.issueNumber !== null) {
            appendChip(elements.heroBadgeRow, nextIssue.stateLabel, nextIssue.stateLabel === "Blocked issue" ? "warn" : "info");
            appendChip(elements.heroBadgeRow, "Checks: pending", "info");
            appendChip(elements.heroBadgeRow, "Recovery: quiet", "ok");
            appendChip(elements.heroBadgeRow, readLoopBadgeLabel(state.status), "info");
            appendChip(elements.heroBadgeRow, freshnessLabel, toneForStatus(freshnessLabel));
            appendChip(elements.heroBadgeRow, state.refreshPhase, toneForStatus(state.refreshPhase));
          } else {
            appendChip(elements.heroBadgeRow, "Waiting for focus", "info");
            appendChip(elements.heroBadgeRow, readLoopBadgeLabel(state.status), "info");
            appendChip(elements.heroBadgeRow, freshnessLabel, toneForStatus(freshnessLabel));
            appendChip(elements.heroBadgeRow, state.refreshPhase, toneForStatus(state.refreshPhase));
          }
        }

        if (elements.overviewWarning) {
          const heroWarning =
            state.issueLoadError ||
            (state.status && state.status.warning ? state.status.warning.message : "") ||
            overview.detail;
          setText(elements.overviewWarning, heroWarning);
        }

        if (elements.heroPrimaryButton) {
          setText(elements.heroPrimaryButton, primaryActionConfig.label);
        }

        if (elements.heroSecondaryButton) {
          setButtonVisibility(elements.heroSecondaryButton, secondaryActionConfig.hidden === true);
          setText(elements.heroSecondaryButton, secondaryActionConfig.label);
        }

        if (elements.heroTertiaryButton) {
          setText(elements.heroTertiaryButton, "More Actions");
        }
      }

      function renderSelectedIssueSummary() {
        if (!elements.selectedIssueHeading || !elements.selectedIssueDetail) {
          return;
        }

        const nextIssue = buildNextIssueSummary(state.status);
        const explain = state.explain;
        const lint = state.issueLint;

        if (elements.selectedIssueSummaryMetrics) {
          elements.selectedIssueSummaryMetrics.innerHTML = "";
        }
        if (elements.selectedIssueSummaryNotes) {
          elements.selectedIssueSummaryNotes.innerHTML = "";
        }

        if (state.issueLoadError) {
          const failedIssueLabel =
            typeof state.loadedIssueNumber === "number" ? formatIssueRef(state.loadedIssueNumber) : "Requested issue";
          setText(elements.selectedIssueHeading, failedIssueLabel + " could not load");
          setText(elements.selectedIssueDetail, state.issueLoadError);
          appendMetricTile(
            elements.selectedIssueSummaryMetrics,
            "Load state",
            "failed",
            "fail",
            "The issue summary could not be loaded from the backend.",
          );
          appendDetailSection(elements.selectedIssueSummaryNotes, "What to do next", [
            ["retry", "Load the issue again after the backend error is resolved."],
            ["requeue", "Requeue stays disabled until the issue details load successfully."],
          ]);
          renderHeroSummary();
          return;
        }

        if (explain) {
          setText(elements.selectedIssueHeading, formatIssueRef(explain.issueNumber) + " " + explain.title);
          setText(
            elements.selectedIssueDetail,
            explain.runnable
              ? "This issue is ready to inspect in more detail below."
              : "This issue is loaded for inspection and may still need follow-up before it is runnable.",
          );
          appendMetricTile(
            elements.selectedIssueSummaryMetrics,
            "State",
            explain.state || "unknown",
            toneForStatus(explain.state),
            explain.blockedReason && explain.blockedReason !== "none" ? explain.blockedReason : "current issue posture",
          );
          appendMetricTile(
            elements.selectedIssueSummaryMetrics,
            "Runnable",
            explain.runnable ? "yes" : "no",
            explain.runnable ? "ok" : "warn",
            "Selection reason: " + (explain.selectionReason || "none"),
          );
          appendMetricTile(
            elements.selectedIssueSummaryMetrics,
            "Checks",
            lint ? (lint.executionReady ? "ready" : "needs review") : "loading",
            lint ? (lint.executionReady ? "ok" : "warn") : "info",
            lint
              ? (lint.highRiskBlockingAmbiguity || "Issue checks loaded.")
              : "Issue checks will appear after the current issue finishes loading.",
          );
          appendMetricTile(
            elements.selectedIssueSummaryMetrics,
            "Recent recovery",
            explain.latestRecoverySummary ? "recent" : "quiet",
            explain.latestRecoverySummary ? "warn" : "ok",
            explain.latestRecoverySummary || explain.failureSummary || "No recent recovery summary.",
          );

          appendDetailSection(elements.selectedIssueSummaryNotes, "Quick notes", [
            ["blocked reason", explain.blockedReason],
            ["reasons", (explain.reasons || []).join(" | ") || "none"],
            ["repair guidance", lint ? (lint.repairGuidance || []).join(" | ") || "none" : "loading"],
          ]);
          renderHeroSummary();
          return;
        }

        if (nextIssue.issueNumber !== null) {
          setText(elements.selectedIssueHeading, nextIssue.stateLabel + " " + formatIssueRef(nextIssue.issueNumber));
          setText(elements.selectedIssueDetail, nextIssue.title);
          appendMetricTile(
            elements.selectedIssueSummaryMetrics,
            "Issue",
            formatIssueRef(nextIssue.issueNumber),
            "info",
            nextIssue.detail,
          );
          appendDetailSection(elements.selectedIssueSummaryNotes, "What this means", [["next step", nextIssue.detail]]);
          renderHeroSummary();
          return;
        }

        setText(elements.selectedIssueHeading, "No issue loaded");
        setText(
          elements.selectedIssueDetail,
          "The selected or next runnable issue will appear here with a short summary.",
        );
        if (elements.selectedIssueSummaryMetrics) {
          elements.selectedIssueSummaryMetrics.appendChild(
            buildEmptyState("#", "No issue summary yet", "Run one cycle or load an issue from the details section."),
          );
        }
        appendDetailSection(elements.selectedIssueSummaryNotes, "What to expect", [
          ["summary", "This area highlights the selected issue, readiness, blockers, and recent context."],
        ]);
        renderHeroSummary();
      }

      function appendDetailSection(container, title, pairs) {
        const items = pairs.filter((pair) => pair[1] !== null && pair[1] !== undefined && pair[1] !== "" && pair[1] !== "none");
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

        elements.issueExplain.innerHTML = "";
        elements.issueExplain.className = "detail-grid";

        for (const section of buildIssueExplainSections(explain, {
          formatRetryContextSummary,
          formatRecoveryLoopSummary,
          formatRecentPhaseChanges,
        })) {
          appendDetailSection(elements.issueExplain, section.title, section.items);
        }

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
        renderLoopRuntime(status);
        renderOverviewSummary();
        renderNextIssueSummary();
        renderPrimaryActionSummary();
        renderAttentionSummary();
        const reconciliationPhase = status.reconciliationPhase || "steady";
        setText(elements.statusReconciliation, reconciliationPhase);
        elements.statusReconciliation.className = "metric " + metricClass(reconciliationPhase);
        setWarningMessage(status.warning ? status.warning.message : "", "");
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
        renderSelectedIssueSummary();
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
        renderOverviewSummary();
        renderAttentionSummary();
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
          renderSelectedIssueSummary();
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
        renderSelectedIssueSummary();
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
        renderNextIssueSummary();
        renderPrimaryActionSummary();
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

      function openDetailsSection() {
        if (elements.detailsDisclosure) {
          elements.detailsDisclosure.open = true;
        }
      }

      async function openFocusedIssueDetails() {
        openDetailsSection();
        const issueNumberToLoad = getFocusedIssueNumber();
        if (issueNumberToLoad === null) {
          return;
        }
        const shouldLoadIssue =
          state.loadedIssueNumber !== issueNumberToLoad || state.explain === null || state.issueLoadError !== null;
        if (!shouldLoadIssue) {
          return;
        }
        try {
          await loadIssue(issueNumberToLoad);
        } catch (error) {
          setText(elements.issueSummary, error instanceof Error ? error.message : String(error));
        }
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
        setWarningMessage(message, "fail");
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
        state.issueLoadError = null;
        renderSelectedIssue();
        setText(elements.issueSummary, "Loading issue...");
        setText(elements.issueExplain, "Loading /api/issues/" + requestedIssueNumber + "/explain...");
        setCode(elements.issueLint, "Loading /api/issues/" + requestedIssueNumber + "/issue-lint...");
        setText(elements.selectedIssueHeading, "Loading issue " + formatIssueRef(requestedIssueNumber));
        setText(elements.selectedIssueDetail, "The dashboard is loading the detailed summary for this issue.");
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
          state.issueLoadError = null;
          renderSelectedIssue();
          renderIssue();
        } catch (error) {
          if (state.loadedIssueNumber !== requestedIssueNumber) {
            return;
          }
          state.issueLoadError = error instanceof Error ? error.message : String(error);
          renderSelectedIssue();
          renderSelectedIssueSummary();
          throw error;
        }
      }

      function pushEvent(event) {
        state.events.unshift(event);
        state.events = state.events.slice(0, 40);
        renderEvents();
      }

      async function handleIssueSubmit(event) {
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
      }

      function handleTrackedHistoryToggle() {
        state.showDoneTrackedIssues = !state.showDoneTrackedIssues;
        renderTrackedHistory();
      }

      const controls = createDashboardControlLayer({
        postMutationJsonWithAuthImpl: postMutationJsonWithAuth,
        fetchImpl: fetch,
        host: window,
        mutationAuthStorageKey,
        mutationAuthHeader,
        state,
        elements,
        openDetailsSection,
        openFocusedIssueDetails,
        refreshStatusAndDoctor,
        loadIssue,
        rejectCommand,
        reportRefreshError,
        renderSelectedIssue,
        renderCommandResult,
        setText,
        buildInFlightCommandResult,
        addCommandGuidance,
        setCommandCorrelation,
        pushTimeline,
        describeTimelineCommandResult,
        extendCommandCorrelation,
        describeCommandSelectionChange,
        formatIssueRef,
        buildNextIssueSummary,
        getHeroPrimaryActionConfig,
        getHeroSecondaryActionConfig,
      });

      registerDashboardDomInteractions({
        elements,
        handleIssueSubmit,
        handleTrackedHistoryToggle,
        openDetailsSection,
        handleRunOnceClick: controls.handleRunOnceClick,
        handleRequeueClick: controls.handleRequeueClick,
        handlePruneWorkspacesClick: async () =>
          controls.handlePruneWorkspacesClick(() => window.confirm("Confirm prune of orphaned workspaces?")),
        handleResetJsonStateClick: async () =>
          controls.handleResetJsonStateClick(() => window.confirm("Confirm reset of the corrupt JSON state marker?")),
        handleHeroPrimaryClick: controls.handleHeroPrimaryClick,
        handleHeroSecondaryClick: controls.handleHeroSecondaryClick,
        handleHeroTertiaryClick: controls.handleHeroTertiaryClick,
      });

      async function bootstrap() {
        renderLiveState();
        renderOverviewSummary();
        renderNextIssueSummary();
        renderPrimaryActionSummary();
        renderAttentionSummary();
        renderSelectedIssueSummary();
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
        wireDashboardEventStream({
          EventSourceCtor: EventSource,
          knownEventTypes,
          state,
          renderLiveState,
          pushEvent,
          pushTimeline,
          describeTimelineEvent,
          correlationLabelForEvent,
          refreshStatusAndDoctor,
          loadIssue,
          reportRefreshError,
        });
        renderEvents();
        renderOperatorTimeline();
      }

      void bootstrap();
  `;
}
