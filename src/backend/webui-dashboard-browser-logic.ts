export interface DashboardSelectionSummaryLike {
  selectedIssueNumber?: number | null;
}

export interface DashboardActiveIssueLike {
  issueNumber?: number | null;
  state?: string | null;
  branch?: string | null;
}

export interface DashboardTrackedIssueLike {
  issueNumber: number;
  state?: string | null;
  branch?: string | null;
  prNumber?: number | null;
  blockedReason?: string | null;
}

export interface DashboardRunnableIssueLike {
  issueNumber: number;
  title?: string | null;
  readiness?: string | null;
}

export interface DashboardBlockedIssueLike {
  issueNumber: number;
  title?: string | null;
  blockedBy?: string | null;
}

export interface DashboardCandidateDiscoveryLike {
  fetchWindow?: number | null;
  strategy?: string | null;
  truncated?: boolean | null;
  observedMatchingOpenIssues?: number | null;
  warning?: string | null;
}

export interface DashboardStatusLike {
  selectionSummary?: DashboardSelectionSummaryLike | null;
  activeIssue?: DashboardActiveIssueLike | null;
  trackedIssues?: DashboardTrackedIssueLike[] | null;
  runnableIssues?: DashboardRunnableIssueLike[] | null;
  blockedIssues?: DashboardBlockedIssueLike[] | null;
  detailedStatusLines?: string[] | null;
  readinessLines?: string[] | null;
  whyLines?: string[] | null;
  candidateDiscovery?: DashboardCandidateDiscoveryLike | null;
  candidateDiscoverySummary?: string | null;
  reconciliationWarning?: string | null;
}

export interface DashboardIssueShortcut {
  issueNumber: number;
  label: string;
  detail: string;
}

export function normalizeDashboardPanelOrder<TPanelId extends string>(
  requestedOrder: readonly string[] | null | undefined,
  defaultOrder: readonly TPanelId[],
): TPanelId[] {
  const knownPanelIds = new Set(defaultOrder);
  const normalizedOrder: TPanelId[] = [];

  for (const candidate of Array.isArray(requestedOrder) ? requestedOrder : []) {
    if (!knownPanelIds.has(candidate as TPanelId) || normalizedOrder.includes(candidate as TPanelId)) {
      continue;
    }
    normalizedOrder.push(candidate as TPanelId);
  }

  for (const panelId of defaultOrder) {
    if (!normalizedOrder.includes(panelId)) {
      normalizedOrder.push(panelId);
    }
  }

  return normalizedOrder;
}

export function restoreDashboardPanelOrder<TPanelId extends string>(
  serializedLayout: string | null | undefined,
  defaultOrder: readonly TPanelId[],
): TPanelId[] {
  if (typeof serializedLayout !== "string" || serializedLayout.trim() === "") {
    return normalizeDashboardPanelOrder(null, defaultOrder);
  }

  try {
    const parsed = JSON.parse(serializedLayout) as { order?: readonly string[] | null } | readonly string[] | null;
    if (Array.isArray(parsed)) {
      return normalizeDashboardPanelOrder(parsed, defaultOrder);
    }
    if (parsed && typeof parsed === "object" && "order" in parsed) {
      return normalizeDashboardPanelOrder(parsed.order, defaultOrder);
    }
  } catch {}

  return normalizeDashboardPanelOrder(null, defaultOrder);
}

export function serializeDashboardPanelOrder<TPanelId extends string>(
  currentOrder: readonly string[] | null | undefined,
  defaultOrder: readonly TPanelId[],
): string {
  return JSON.stringify({
    order: normalizeDashboardPanelOrder(currentOrder, defaultOrder),
  });
}

export function applyDashboardPanelDrop<TPanelId extends string>(
  currentOrder: readonly string[] | null | undefined,
  draggedPanelId: TPanelId | null | undefined,
  targetPanelId: TPanelId | null | undefined,
  defaultOrder: readonly TPanelId[],
): TPanelId[] {
  const normalizedOrder = normalizeDashboardPanelOrder(currentOrder, defaultOrder);
  if (!draggedPanelId || !targetPanelId || draggedPanelId === targetPanelId) {
    return normalizedOrder;
  }
  if (!normalizedOrder.includes(draggedPanelId) || !normalizedOrder.includes(targetPanelId)) {
    return normalizedOrder;
  }

  const nextOrder = normalizedOrder.filter((panelId) => panelId !== draggedPanelId);
  const targetIndex = nextOrder.indexOf(targetPanelId);
  if (targetIndex < 0) {
    return normalizedOrder;
  }
  nextOrder.splice(targetIndex, 0, draggedPanelId);
  return nextOrder;
}

export interface DashboardTrackedIssueFormatOptions {
  includeDone?: boolean;
}

export type DashboardConnectionPhase = "connecting" | "open" | "reconnecting";

export type DashboardRefreshPhase = "idle" | "refreshing" | "failed";

interface DashboardTimelineEventLike {
  type?: string | null;
  summary?: string | null;
  message?: string | null;
  issueNumber?: number | null;
  issueNumbers?: Array<number | null> | null;
  previousIssueNumber?: number | null;
  nextIssueNumber?: number | null;
  reason?: string | null;
  detail?: string | null;
  command?: string | null;
  prNumber?: number | null;
  reconciliationPhase?: string | null;
  previousStartedAt?: string | null;
  nextStartedAt?: string | null;
  previousHeadSha?: string | null;
  nextHeadSha?: string | null;
}

export interface DashboardTimelineCommandResultLike {
  action?: string | null;
  command?: string | null;
  outcome?: string | null;
  summary?: string | null;
  status?: string | null;
  issueNumber?: number | null;
  previousState?: string | null;
  nextState?: string | null;
  recoveryReason?: string | null;
  pruned?: Array<unknown> | null;
  skipped?: Array<unknown> | null;
  markerCleared?: boolean | null;
}

export function formatIssueRef(issueNumber: number | null | undefined): string {
  return Number.isInteger(issueNumber) ? "#" + issueNumber : "none";
}

export function humanizeTimelineValue(value: string | null | undefined): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return null;
  }
  return trimmed.replace(/[_-]+/gu, " ");
}

export function parseSelectedIssueNumber(status: DashboardStatusLike | null | undefined): number | null {
  if (status?.selectionSummary && Number.isInteger(status.selectionSummary.selectedIssueNumber)) {
    return status.selectionSummary.selectedIssueNumber ?? null;
  }
  if (status?.activeIssue && Number.isInteger(status.activeIssue.issueNumber)) {
    return status.activeIssue.issueNumber ?? null;
  }
  const candidates = [...(status?.whyLines ?? []), ...(status?.detailedStatusLines ?? [])];
  for (const line of candidates) {
    const match = /selected_issue=#(\d+)/u.exec(line) || /active_issue=#(\d+)/u.exec(line);
    if (match) {
      return Number.parseInt(match[1], 10);
    }
  }
  return null;
}

export function collectTrackedIssues(
  status: DashboardStatusLike | null | undefined,
  options: DashboardTrackedIssueFormatOptions = {},
): DashboardTrackedIssueLike[] {
  const trackedIssues = Array.isArray(status?.trackedIssues) ? status.trackedIssues : [];
  if (options.includeDone) {
    return trackedIssues;
  }
  return trackedIssues.filter((issue) => issue.state?.toLowerCase() !== "done");
}

export function formatTrackedIssues(
  status: DashboardStatusLike | null | undefined,
  options: DashboardTrackedIssueFormatOptions = {},
): string[] {
  return collectTrackedIssues(status, options).map((issue) =>
    "tracked issue #" +
    issue.issueNumber +
    " [" +
    (issue.state ?? "") +
    "] branch=" +
    (issue.branch ?? "") +
    " pr=" +
    (Number.isInteger(issue.prNumber) ? "#" + issue.prNumber : "none") +
    " blocked_reason=" +
    (issue.blockedReason || "none"),
  );
}

export function formatTrackedIssueSummary(status: DashboardStatusLike | null | undefined): string[] {
  const trackedIssues = Array.isArray(status?.trackedIssues) ? status.trackedIssues : [];
  return ["tracked issues=" + trackedIssues.length];
}

export function formatTrackedHistorySummary(
  status: DashboardStatusLike | null | undefined,
  options: DashboardTrackedIssueFormatOptions = {},
): string {
  const totalTrackedIssues = Array.isArray(status?.trackedIssues) ? status.trackedIssues.length : 0;
  const visibleTrackedIssues = collectTrackedIssues(status, options).length;
  return "showing " + visibleTrackedIssues + " of " + totalTrackedIssues + " tracked issues";
}

export function formatRunnableIssues(status: DashboardStatusLike | null | undefined): string[] {
  const runnableIssues = Array.isArray(status?.runnableIssues) ? status.runnableIssues : [];
  return runnableIssues.map((issue) =>
    "runnable issue #" + issue.issueNumber + " " + (issue.title ?? "") + " ready=" + (issue.readiness ?? ""),
  );
}

export function formatBlockedIssues(status: DashboardStatusLike | null | undefined): string[] {
  const blockedIssues = Array.isArray(status?.blockedIssues) ? status.blockedIssues : [];
  return blockedIssues.map((issue) =>
    "blocked issue #" + issue.issueNumber + " " + (issue.title ?? "") + " blocked_by=" + (issue.blockedBy ?? ""),
  );
}

export function formatCandidateDiscovery(status: DashboardStatusLike | null | undefined): string[] {
  if (status?.candidateDiscovery) {
    const summary = status.candidateDiscovery;
    return [
      "candidate discovery fetch_window=" +
        (summary.fetchWindow ?? "") +
        " strategy=" +
        (summary.strategy ?? "") +
        " truncated=" +
        (summary.truncated ? "yes" : "no") +
        " observed_matching_open_issues=" +
        (summary.observedMatchingOpenIssues === null ? "unknown" : (summary.observedMatchingOpenIssues ?? "")),
      ...(summary.warning ? [summary.warning] : []),
    ];
  }

  return status?.candidateDiscoverySummary ? [status.candidateDiscoverySummary] : [];
}

export function buildStatusLines(status: DashboardStatusLike | null | undefined): string[] {
  return [
    ...formatTrackedIssueSummary(status),
    ...formatRunnableIssues(status),
    ...formatBlockedIssues(status),
    ...(status?.detailedStatusLines ?? []),
    ...(status?.readinessLines ?? []),
    ...(status?.whyLines ?? []),
    ...formatCandidateDiscovery(status),
    ...(status?.reconciliationWarning ? [status.reconciliationWarning] : []),
  ];
}

export function collectIssueShortcuts(status: DashboardStatusLike | null | undefined): DashboardIssueShortcut[] {
  const shortcuts: DashboardIssueShortcut[] = [];
  const seenIssueNumbers = new Set<number>();

  function pushShortcut(issueNumber: number | null | undefined, label: string, detail: string): void {
    if (typeof issueNumber !== "number" || !Number.isInteger(issueNumber) || seenIssueNumbers.has(issueNumber)) {
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
    pushShortcut(issue.issueNumber, "runnable " + (issue.readiness ?? ""), [issue.title].filter(Boolean).join(" "));
  }

  for (const issue of Array.isArray(status?.blockedIssues) ? status.blockedIssues : []) {
    pushShortcut(issue.issueNumber, "blocked " + (issue.blockedBy ?? ""), [issue.title].filter(Boolean).join(" "));
  }

  for (const issue of collectTrackedIssues(status)) {
    pushShortcut(
      issue.issueNumber,
      "tracked " + (issue.state ?? ""),
      [issue.branch, Number.isInteger(issue.prNumber) ? "pr=#" + issue.prNumber : "pr=none"].filter(Boolean).join(" "),
    );
  }

  return shortcuts;
}

export function describeConnectionHealth(phase: DashboardConnectionPhase): string {
  if (phase === "open") {
    return "connected";
  }
  return phase;
}

export function describeFreshnessState(args: {
  connectionPhase: DashboardConnectionPhase;
  refreshPhase: DashboardRefreshPhase;
  hasSuccessfulRefresh: boolean;
}): string {
  if (!args.hasSuccessfulRefresh) {
    return "awaiting refresh";
  }
  if (args.refreshPhase === "failed" || args.connectionPhase === "reconnecting") {
    return "stale";
  }
  if (args.refreshPhase === "refreshing") {
    return "refreshing";
  }
  return "fresh";
}

export function describeCommandSelectionChange(
  previousIssueNumber: number | null | undefined,
  nextIssueNumber: number | null | undefined,
): string {
  const previousRef = formatIssueRef(previousIssueNumber);
  const nextRef = formatIssueRef(nextIssueNumber);
  if (previousRef === nextRef) {
    return "selected issue unchanged (" + nextRef + ")";
  }
  return "selected issue " + previousRef + " -> " + nextRef;
}

export function collectTimelineEventIssueNumbers(event: DashboardTimelineEventLike | null | undefined): number[] {
  const issueNumbers: number[] = [];
  for (const candidate of [
    ...(Array.isArray(event?.issueNumbers) ? event.issueNumbers : []),
    event?.issueNumber,
    event?.previousIssueNumber,
    event?.nextIssueNumber,
  ]) {
    if (typeof candidate !== "number" || !Number.isInteger(candidate) || issueNumbers.includes(candidate)) {
      continue;
    }
    issueNumbers.push(candidate);
  }
  return issueNumbers;
}

export function describeTimelineEvent(event: DashboardTimelineEventLike | null | undefined): string {
  switch (event?.type) {
    case "supervisor.active_issue.changed":
      return (
        "active issue " +
        (humanizeTimelineValue(event.reason) ?? "changed") +
        ": " +
        formatIssueRef(event.previousIssueNumber) +
        " -> " +
        formatIssueRef(event.nextIssueNumber)
      );
    case "supervisor.recovery": {
      const reason = humanizeTimelineValue(event.reason) ?? "updated";
      return "recovery issue " + formatIssueRef(event.issueNumber) + ": " + reason;
    }
    case "supervisor.loop.skipped":
      return (
        "loop skipped: " +
        (humanizeTimelineValue(event.reason) ?? "unknown") +
        " (" +
        (event.detail ?? "no detail") +
        ")"
      );
    case "supervisor.run_lock.blocked": {
      const phaseSuffix = humanizeTimelineValue(event.reconciliationPhase);
      return (
        (event.command ?? "command") +
        " blocked: " +
        (event.reason ?? "unknown reason") +
        (phaseSuffix ? " during " + phaseSuffix : "")
      );
    }
    case "supervisor.review_wait.changed":
      return (
        "review wait " +
        (humanizeTimelineValue(event.reason) ?? "updated") +
        " for issue " +
        formatIssueRef(event.issueNumber) +
        " PR " +
        formatIssueRef(event.prNumber) +
        (event.previousHeadSha !== event.nextHeadSha && event.nextHeadSha ? " on " + event.nextHeadSha.slice(0, 7) : "")
      );
    default: {
      const label = [event?.summary, event?.message, event?.type].find(
        (value): value is string => typeof value === "string" && value.trim().length > 0,
      );
      return label?.trim() ?? "event";
    }
  }
}

export function describeTimelineCommandResult(result: DashboardTimelineCommandResultLike | null | undefined): string {
  const action = result?.action ?? result?.command ?? "command";
  if (action === "requeue" && Number.isInteger(result?.issueNumber)) {
    const transition =
      result?.previousState || result?.nextState
        ? " " + (result?.previousState ?? "unknown") + " -> " + (result?.nextState ?? "unknown")
        : "";
    const reason = humanizeTimelineValue(result?.recoveryReason);
    return "requeue issue " + formatIssueRef(result.issueNumber) + transition + (reason ? " (" + reason + ")" : "");
  }
  if (action === "prune-orphaned-workspaces") {
    const pruned = Array.isArray(result?.pruned) ? result.pruned.length : 0;
    const skipped = Array.isArray(result?.skipped) ? result.skipped.length : 0;
    return "prune orphaned workspaces: pruned " + pruned + ", skipped " + skipped;
  }
  if (action === "reset-corrupt-json-state") {
    return result?.markerCleared === false ? "reset corrupt JSON state: no marker present" : "reset corrupt JSON state";
  }
  return result?.status ?? result?.summary ?? action;
}
