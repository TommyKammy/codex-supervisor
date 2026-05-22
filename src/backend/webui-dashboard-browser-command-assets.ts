export function renderDashboardBrowserCommandScript(): string {
  return `      function renderCommandResult() {
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
        setText(elements.issueHistorySummary, "Loading issue history...");
        setText(elements.issueHistoryLines, "Loading typed issue timeline...");
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
          renderIssueHistoryLoadError(state.issueLoadError);
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

      void bootstrap();`;
}
