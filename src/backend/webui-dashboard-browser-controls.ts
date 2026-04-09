import type { BrowserFetchLike, BrowserHostLike } from "./webui-browser-script-helpers";

export interface DashboardControlStateLike {
  selectedIssueNumber: number | null;
  loadedIssueNumber: number | null;
  explain: { issueNumber: number } | null;
  status?: unknown;
  commandInFlight: boolean;
  commandCorrelation: unknown;
  commandResult: unknown;
}

export interface DashboardControlElementsLike {
  commandStatus?: { textContent: string } | null;
}

export interface DashboardCommandArgs {
  label: string;
  path: string;
  body: unknown;
  issueNumber?: number;
}

export interface DashboardControlLayerArgs {
  postMutationJsonWithAuthImpl(
    fetchImpl: BrowserFetchLike,
    host: BrowserHostLike,
    path: string,
    body: unknown,
    options: {
      mutationAuthStorageKey: string;
      mutationAuthHeader: string;
      fallbackBody?: string;
    },
  ): Promise<unknown>;
  fetchImpl: BrowserFetchLike;
  host: BrowserHostLike;
  mutationAuthStorageKey: string;
  mutationAuthHeader: string;
  state: DashboardControlStateLike;
  elements: DashboardControlElementsLike;
  openDetailsSection(): void;
  openFocusedIssueDetails(): Promise<void>;
  refreshStatusAndDoctor(): Promise<void>;
  loadIssue(issueNumber: number): Promise<void>;
  rejectCommand(label: string, guidance: string, summary: string): void;
  reportRefreshError(error: unknown): void;
  renderSelectedIssue(): void;
  renderCommandResult(): void;
  setText(element: { textContent: string } | null | undefined, value: string): void;
  buildInFlightCommandResult(label: string): unknown;
  addCommandGuidance(result: unknown, guidance: string): unknown;
  setCommandCorrelation(label: string, issueNumbers: Array<number | null | undefined>): void;
  pushTimeline(entry: {
    kind: string;
    at: string;
    summary: string;
    detail: string;
    commandLabel: string | null;
  }): void;
  describeTimelineCommandResult(result: unknown): string;
  extendCommandCorrelation(issueNumber: number | null): void;
  describeCommandSelectionChange(previousIssueNumber: number | null, nextIssueNumber: number | null): string;
  formatIssueRef(issueNumber: number | null): string;
  buildNextIssueSummary(status: unknown): unknown;
  getHeroPrimaryActionConfig(nextIssue: unknown): { mode: string };
  getHeroSecondaryActionConfig(nextIssue: unknown): { mode: string; hidden?: boolean };
}

export function createDashboardControlLayer(args: DashboardControlLayerArgs) {
  async function postCommand(path: string, body: unknown): Promise<unknown> {
    return await args.postMutationJsonWithAuthImpl(args.fetchImpl, args.host, path, body, {
      mutationAuthStorageKey: args.mutationAuthStorageKey,
      mutationAuthHeader: args.mutationAuthHeader,
      fallbackBody: "{}",
    });
  }

  async function runCommand(commandArgs: DashboardCommandArgs): Promise<void> {
    const previousStatus = args.elements.commandStatus ? args.elements.commandStatus.textContent : "";
    const previousSelectedIssueNumber = args.state.selectedIssueNumber;
    args.state.commandResult = args.buildInFlightCommandResult(commandArgs.label);
    args.renderCommandResult();
    try {
      const result = await postCommand(commandArgs.path, commandArgs.body);
      args.state.commandResult = args.addCommandGuidance(
        result,
        "Status refreshed automatically after completion. Review the operator timeline for follow-up context.",
      );
      args.setCommandCorrelation(commandArgs.label, [commandArgs.issueNumber, previousSelectedIssueNumber]);
      args.pushTimeline({
        kind: "command",
        at: new Date().toISOString(),
        summary: args.describeTimelineCommandResult(args.state.commandResult),
        detail: JSON.stringify(args.state.commandResult, null, 2),
        commandLabel: null,
      });
      args.renderCommandResult();
      try {
        await args.refreshStatusAndDoctor();
        args.extendCommandCorrelation(args.state.selectedIssueNumber);
        args.pushTimeline({
          kind: "refresh",
          at: new Date().toISOString(),
          summary: args.describeCommandSelectionChange(previousSelectedIssueNumber, args.state.selectedIssueNumber),
          detail:
            "Refreshed /api/status and /api/doctor after " +
            commandArgs.label +
            ". Follow-up issue: " +
            args.formatIssueRef(args.state.selectedIssueNumber) +
            ".",
          commandLabel: commandArgs.label,
        });
        const issueNumberToLoad = args.state.selectedIssueNumber ?? args.state.loadedIssueNumber;
        if (issueNumberToLoad !== null) {
          await args.loadIssue(issueNumberToLoad);
        }
      } catch (error) {
        args.state.commandResult = args.addCommandGuidance(
          args.state.commandResult,
          "Command completed, but the dashboard refresh failed. Use the warning above before relying on the visible state.",
        );
        args.renderCommandResult();
        args.reportRefreshError(error);
      }
    } catch (error) {
      args.setText(args.elements.commandStatus, previousStatus || "Command failed.");
      args.state.commandCorrelation = null;
      args.state.commandResult = {
        action: commandArgs.label,
        outcome: "rejected",
        summary: error instanceof Error ? error.message : String(error),
        guidance: "No dashboard refresh was attempted because the command request failed.",
      };
      args.pushTimeline({
        kind: "command",
        at: new Date().toISOString(),
        summary:
          typeof args.state.commandResult === "object" &&
          args.state.commandResult !== null &&
          "summary" in args.state.commandResult &&
          typeof args.state.commandResult.summary === "string"
            ? args.state.commandResult.summary
            : "Command failed.",
        detail: JSON.stringify(args.state.commandResult, null, 2),
        commandLabel: null,
      });
      args.renderCommandResult();
    }
  }

  async function runCommandWithLock(commandArgs: DashboardCommandArgs): Promise<void> {
    if (args.state.commandInFlight) {
      return;
    }

    args.state.commandInFlight = true;
    args.renderSelectedIssue();
    try {
      await runCommand(commandArgs);
    } finally {
      args.state.commandInFlight = false;
      args.renderSelectedIssue();
    }
  }

  async function handleRunOnceClick(): Promise<void> {
    args.openDetailsSection();
    await runCommandWithLock({
      label: "run-once",
      path: "/api/commands/run-once",
      body: { dryRun: false },
    });
  }

  async function handleRequeueClick(): Promise<void> {
    if (args.state.explain === null) {
      args.rejectCommand("requeue", "Load an issue successfully before requeueing.", "requeue cancelled");
      return;
    }

    await runCommandWithLock({
      label: "requeue",
      path: "/api/commands/requeue",
      issueNumber: args.state.explain.issueNumber,
      body: { issueNumber: args.state.explain.issueNumber },
    });
  }

  async function handlePruneWorkspacesClick(confirmImpl: () => boolean): Promise<void> {
    if (!confirmImpl()) {
      args.rejectCommand(
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
  }

  async function handleResetJsonStateClick(confirmImpl: () => boolean): Promise<void> {
    if (!confirmImpl()) {
      args.rejectCommand(
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
  }

  async function handleHeroPrimaryClick(): Promise<void> {
    const nextIssue = args.buildNextIssueSummary(args.state.status);
    const primaryActionConfig = args.getHeroPrimaryActionConfig(nextIssue);
    if (primaryActionConfig.mode === "refresh") {
      try {
        await args.refreshStatusAndDoctor();
      } catch (error) {
        args.reportRefreshError(error);
      }
      return;
    }

    if (primaryActionConfig.mode === "issue") {
      await args.openFocusedIssueDetails();
      return;
    }

    args.openDetailsSection();
  }

  async function handleHeroSecondaryClick(): Promise<void> {
    const nextIssue = args.buildNextIssueSummary(args.state.status);
    const secondaryActionConfig = args.getHeroSecondaryActionConfig(nextIssue);
    if (secondaryActionConfig.hidden) {
      return;
    }
    if (secondaryActionConfig.mode === "issue") {
      await args.openFocusedIssueDetails();
      return;
    }
    args.openDetailsSection();
  }

  function handleHeroTertiaryClick(): void {
    args.openDetailsSection();
  }

  return {
    postCommand,
    runCommand,
    runCommandWithLock,
    handleRunOnceClick,
    handleRequeueClick,
    handlePruneWorkspacesClick,
    handleResetJsonStateClick,
    handleHeroPrimaryClick,
    handleHeroSecondaryClick,
    handleHeroTertiaryClick,
  };
}
