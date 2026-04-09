export interface DashboardEventListenerTargetLike<Event = unknown> {
  addEventListener(type: string, listener: (event: Event) => unknown): void;
  removeEventListener?(type: string, listener: (event: Event) => unknown): void;
}

export interface DashboardEventSourceLike<Event = { type: string; data: string }>
  extends DashboardEventListenerTargetLike<Event> {
  close?(): void;
}

export interface DashboardEventSourceConstructorLike<Event = { type: string; data: string }> {
  new (url: string): DashboardEventSourceLike<Event>;
}

export interface DashboardEventStreamStateLike {
  connectionPhase: string;
  selectedIssueNumber: number | null;
  loadedIssueNumber: number | null;
}

export interface DashboardEventStreamArgs<Event = { type: string; data: string }> {
  EventSourceCtor: DashboardEventSourceConstructorLike<Event>;
  knownEventTypes: string[];
  state: DashboardEventStreamStateLike;
  renderLiveState(): void;
  pushEvent(event: unknown): void;
  pushTimeline(entry: {
    kind: string;
    at: string;
    summary: string;
    detail: string;
    commandLabel: string | null;
  }): void;
  describeTimelineEvent(event: unknown): string;
  correlationLabelForEvent(event: unknown): string | null;
  refreshStatusAndDoctor(): Promise<void>;
  loadIssue(issueNumber: number): Promise<void>;
  reportRefreshError(error: unknown): void;
}

export interface DashboardDomElementsLike {
  issueForm?: DashboardEventListenerTargetLike | null;
  trackedHistoryToggle?: DashboardEventListenerTargetLike | null;
  navOverviewHeading?: DashboardEventListenerTargetLike | null;
  navPanelStatus?: DashboardEventListenerTargetLike | null;
  navPanelDoctor?: DashboardEventListenerTargetLike | null;
  navPanelIssueDetails?: DashboardEventListenerTargetLike | null;
  navPanelTrackedHistory?: DashboardEventListenerTargetLike | null;
  navPanelOperatorActions?: DashboardEventListenerTargetLike | null;
  navPanelLiveEvents?: DashboardEventListenerTargetLike | null;
  navPanelOperatorTimeline?: DashboardEventListenerTargetLike | null;
  runOnceButton?: DashboardEventListenerTargetLike | null;
  requeueButton?: DashboardEventListenerTargetLike | null;
  pruneWorkspacesButton?: DashboardEventListenerTargetLike | null;
  resetJsonStateButton?: DashboardEventListenerTargetLike | null;
  heroPrimaryButton?: DashboardEventListenerTargetLike | null;
  heroSecondaryButton?: DashboardEventListenerTargetLike | null;
  heroTertiaryButton?: DashboardEventListenerTargetLike | null;
}

export interface DashboardDomInteractionArgs {
  elements: DashboardDomElementsLike;
  handleIssueSubmit(event: unknown): Promise<void>;
  handleTrackedHistoryToggle(): void;
  openDetailsSection(): void;
  handleRunOnceClick(): Promise<void>;
  handleRequeueClick(): Promise<void>;
  handlePruneWorkspacesClick(): Promise<void>;
  handleResetJsonStateClick(): Promise<void>;
  handleHeroPrimaryClick(): Promise<void>;
  handleHeroSecondaryClick(): Promise<void>;
  handleHeroTertiaryClick(): void;
}

export function wireDashboardEventStream(args: DashboardEventStreamArgs): () => void {
  const source = new args.EventSourceCtor("/api/events");
  args.state.connectionPhase = "connecting";
  args.renderLiveState();

  function onOpen() {
    args.state.connectionPhase = "open";
    args.renderLiveState();
  }

  function onError() {
    args.state.connectionPhase = "reconnecting";
    args.renderLiveState();
  }

  async function onEvent(rawEvent: { type: string; data: string }) {
    let parsed: Record<string, unknown> = {
      type: rawEvent.type,
      family: "event",
      at: new Date().toISOString(),
      raw: rawEvent.data,
    };
    try {
      parsed = JSON.parse(rawEvent.data);
    } catch {}
    args.pushEvent(parsed);
    args.pushTimeline({
      kind: "event",
      at: typeof parsed.at === "string" ? parsed.at : new Date().toISOString(),
      summary: args.describeTimelineEvent(parsed),
      detail: JSON.stringify(parsed, null, 2),
      commandLabel: args.correlationLabelForEvent(parsed),
    });
    try {
      await args.refreshStatusAndDoctor();
      const issueNumberToLoad = args.state.selectedIssueNumber ?? args.state.loadedIssueNumber;
      if (issueNumberToLoad !== null) {
        await args.loadIssue(issueNumberToLoad);
      }
    } catch (error) {
      args.reportRefreshError(error);
    }
  }

  source.addEventListener("open", onOpen);
  source.addEventListener("error", onError);
  for (const eventType of args.knownEventTypes) {
    source.addEventListener(eventType, onEvent);
  }

  return () => {
    source.removeEventListener?.("open", onOpen);
    source.removeEventListener?.("error", onError);
    for (const eventType of args.knownEventTypes) {
      source.removeEventListener?.(eventType, onEvent);
    }
    source.close?.();
  };
}

export function registerDashboardDomInteractions(args: DashboardDomInteractionArgs): () => void {
  const cleanups: Array<() => void> = [];

  function listen(
    target: DashboardEventListenerTargetLike | null | undefined,
    type: string,
    listener: (event: unknown) => unknown,
  ) {
    if (!target) {
      return;
    }
    target.addEventListener(type, listener);
    cleanups.push(() => {
      target.removeEventListener?.(type, listener);
    });
  }

  listen(args.elements.issueForm, "submit", args.handleIssueSubmit);
  listen(args.elements.trackedHistoryToggle, "click", () => {
    args.handleTrackedHistoryToggle();
  });

  for (const navigationLink of [
    args.elements.navOverviewHeading,
    args.elements.navPanelStatus,
    args.elements.navPanelDoctor,
    args.elements.navPanelIssueDetails,
    args.elements.navPanelTrackedHistory,
    args.elements.navPanelOperatorActions,
    args.elements.navPanelLiveEvents,
    args.elements.navPanelOperatorTimeline,
  ]) {
    listen(navigationLink, "click", () => {
      args.openDetailsSection();
    });
  }

  listen(args.elements.runOnceButton, "click", args.handleRunOnceClick);
  listen(args.elements.requeueButton, "click", args.handleRequeueClick);
  listen(args.elements.pruneWorkspacesButton, "click", args.handlePruneWorkspacesClick);
  listen(args.elements.resetJsonStateButton, "click", args.handleResetJsonStateClick);
  listen(args.elements.heroPrimaryButton, "click", args.handleHeroPrimaryClick);
  listen(args.elements.heroSecondaryButton, "click", args.handleHeroSecondaryClick);
  listen(args.elements.heroTertiaryButton, "click", () => {
    args.handleHeroTertiaryClick();
  });

  return () => {
    while (cleanups.length > 0) {
      const cleanup = cleanups.pop();
      cleanup?.();
    }
  };
}
