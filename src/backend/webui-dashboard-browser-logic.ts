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
}

export function formatIssueRef(issueNumber: number | null | undefined): string {
  return Number.isInteger(issueNumber) ? "#" + issueNumber : "none";
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

export function formatTrackedIssues(status: DashboardStatusLike | null | undefined): string[] {
  const trackedIssues = Array.isArray(status?.trackedIssues) ? status.trackedIssues : [];
  return trackedIssues.map((issue) =>
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
    ...formatTrackedIssues(status),
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

  for (const issue of Array.isArray(status?.trackedIssues) ? status.trackedIssues : []) {
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
        formatIssueRef(event.previousIssueNumber) +
        " -> " +
        formatIssueRef(event.nextIssueNumber) +
        " (" +
        (event.reason ?? "changed") +
        ")"
      );
    case "supervisor.recovery":
      return "recovery for issue " + formatIssueRef(event.issueNumber) + ": " + (event.reason ?? "updated");
    case "supervisor.loop.skipped":
      return "loop skipped (" + (event.reason ?? "unknown") + "): " + (event.detail ?? "no detail");
    case "supervisor.run_lock.blocked":
      return (event.command ?? "command") + " blocked: " + (event.reason ?? "unknown reason");
    case "supervisor.review_wait.changed":
      return (
        "review wait " +
        (event.reason ?? "updated") +
        " for issue " +
        formatIssueRef(event.issueNumber) +
        " PR " +
        formatIssueRef(event.prNumber)
      );
    default: {
      const label = [event?.summary, event?.message, event?.type].find(
        (value): value is string => typeof value === "string" && value.trim().length > 0,
      );
      return label?.trim() ?? "event";
    }
  }
}
