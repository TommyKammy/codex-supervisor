import { buildBrowserLocalCiStatusLines } from "./webui-browser-script-helpers";

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
  timelineArtifacts?: DashboardTimelineArtifactLike[] | null;
}

export interface DashboardTimelineArtifactLike {
  type?: string | null;
  gate?: string | null;
  command?: string | null;
  head_sha?: string | null;
  outcome?: string | null;
  remediation_target?: string | null;
  next_action?: string | null;
  summary?: string | null;
  recorded_at?: string | null;
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

export interface DashboardLoopRuntimeLike {
  state?: "running" | "off" | "unknown" | null;
  hostMode?: "tmux" | "direct" | "unknown" | null;
  markerPath?: string | null;
  configPath?: string | null;
  stateFile?: string | null;
  pid?: number | null;
  startedAt?: string | null;
  ownershipConfidence?: "none" | "live_lock" | "stale_lock" | "ambiguous_owner" | "duplicate_suspected" | null;
  detail?: string | null;
  recoveryGuidance?: string | null;
  duplicateLoopDiagnostic?: {
    kind?: string | null;
    status?: string | null;
    matchingProcessCount?: number | null;
    matchingPids?: number[] | null;
    configPath?: string | null;
    stateFile?: string | null;
    recoveryGuidance?: string | null;
  } | null;
}

export interface DashboardRuntimeRecoverySummaryLike {
  loopState?: string | null;
  lockConfidence?: string | null;
  trackedRecords?: Array<{
    issueNumber?: number | null;
    state?: string | null;
    prNumber?: number | null;
    blockedReason?: string | null;
  }> | null;
  signals?: Array<{
    kind?: string | null;
    summary?: string | null;
  }> | null;
  recommendation?: {
    category?: string | null;
    source?: string | null;
    summary?: string | null;
  } | null;
}

export interface DashboardWorkflowStepLike {
  id?: "observe" | "triage" | "select" | "execute" | "recover" | null;
  title?: string | null;
  detail?: string | null;
  state?: "done" | "current" | "idle" | "current warn" | "warn" | null;
}

export interface DashboardInventoryStatusLike {
  mode?: "healthy" | "degraded" | null;
  posture?:
    | "fresh_full_inventory"
    | "targeted_degraded_reconciliation"
    | "bounded_snapshot_selection"
    | "diagnostics_only_snapshot"
    | "blocked"
    | null;
  recoveryState?: "healthy" | "partially_degraded" | "blocked" | null;
  selectionBlocked?: boolean | null;
  summary?: string | null;
  recoveryGuidance?: string | null;
  recoveryActions?: string[] | null;
  lastSuccessfulFullRefreshAt?: string | null;
  failure?: {
    source?: string | null;
    message?: string | null;
    recordedAt?: string | null;
    classification?: string | null;
  } | null;
}

export interface DashboardLocalCiContractLike {
  configured?: boolean | null;
  command?: string | null;
  recommendedCommand?: string | null;
  source?: "config" | "repo_script_candidate" | null;
  summary?: string | null;
}

export interface DashboardStatusLike {
  selectionSummary?: DashboardSelectionSummaryLike | null;
  activeIssue?: DashboardActiveIssueLike | null;
  trackedIssues?: DashboardTrackedIssueLike[] | null;
  runnableIssues?: DashboardRunnableIssueLike[] | null;
  blockedIssues?: DashboardBlockedIssueLike[] | null;
  workflowSteps?: DashboardWorkflowStepLike[] | null;
  detailedStatusLines?: string[] | null;
  readinessLines?: string[] | null;
  whyLines?: string[] | null;
  candidateDiscovery?: DashboardCandidateDiscoveryLike | null;
  candidateDiscoverySummary?: string | null;
  localCiContract?: DashboardLocalCiContractLike | null;
  inventoryStatus?: DashboardInventoryStatusLike | null;
  reconciliationWarning?: string | null;
  reconciliationPhase?: string | null;
  loopRuntime?: DashboardLoopRuntimeLike | null;
  runtimeRecoverySummary?: DashboardRuntimeRecoverySummaryLike | null;
  warning?: { message?: string | null } | null;
}

export function describeLoopOffTrackedWorkRestartActionTitle(): string {
  return "Restart the supported loop host";
}

export function describeLoopOffTrackedWorkRestartExpectation(): string {
  return "Restart the supported loop host; expect loop_runtime state=running before tracked work advances.";
}

export function describeLoopOffTrackedWorkRestartGuidance(loopOffTrackedWorkBlocker: string): string {
  return loopOffTrackedWorkBlocker + " " + describeLoopOffTrackedWorkRestartExpectation();
}

export function describeLoopOffTrackedWorkBlocker(status: DashboardStatusLike | null | undefined): string | null {
  if (status?.loopRuntime?.state !== "off") {
    return null;
  }

  const activeTrackedIssues = collectTrackedIssues(status).filter((issue) => {
    const normalized = issue.state?.toLowerCase();
    return Boolean(normalized) && normalized !== "done" && normalized !== "blocked" && normalized !== "failed";
  });
  if (activeTrackedIssues.length === 0) {
    return null;
  }

  const firstTrackedIssue = [...activeTrackedIssues].sort((left, right) => left.issueNumber - right.issueNumber)[0];
  return activeTrackedIssues.length === 1
    ? "Tracked work is active for " + formatIssueRef(firstTrackedIssue.issueNumber) + ", but the supervisor loop is off."
    : "Tracked work is active for " + activeTrackedIssues.length + " issues, but the supervisor loop is off.";
}

export interface DashboardDoctorCheckLike {
  name?: string | null;
  status?: string | null;
  summary?: string | null;
}

export interface DashboardDoctorDecisionLike {
  action?: string | null;
  summary?: string | null;
}

export interface DashboardDoctorTierItemLike {
  source?: string | null;
  detail?: string | null;
}

export interface DashboardDoctorLike {
  overallStatus?: string | null;
  checks?: DashboardDoctorCheckLike[] | null;
  decisionSummary?: DashboardDoctorDecisionLike | null;
  diagnosticTiers?: Record<string, DashboardDoctorTierItemLike[] | null | undefined> | null;
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

export interface DashboardOverviewSummary {
  headline: string;
  detail: string;
  tone: "ok" | "warn" | "fail" | "info";
}

export interface DashboardNextIssueSummary {
  issueNumber: number | null;
  title: string;
  detail: string;
  stateLabel: string;
}

export interface DashboardNextStateSummary {
  title: string;
  detail: string;
}

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

export interface DashboardIssueRetryContextLike {
  timeoutRetryCount?: number | null;
  blockedVerificationRetryCount?: number | null;
  repeatedBlockerCount?: number | null;
  repeatedFailureSignatureCount?: number | null;
  lastFailureSignature?: string | null;
}

export interface DashboardIssueRepeatedRecoveryLike {
  kind?: string | null;
  repeatCount?: number | null;
  repeatLimit?: number | null;
  status?: string | null;
  action?: string | null;
  lastFailureSignature?: string | null;
}

export interface DashboardIssuePhaseChangeLike {
  at?: string | null;
  from?: string | null;
  to?: string | null;
  reason?: string | null;
  source?: string | null;
}

export interface DashboardIssueActivityContextLike {
  retryContext?: DashboardIssueRetryContextLike | null;
  repeatedRecovery?: DashboardIssueRepeatedRecoveryLike | null;
  recentPhaseChanges?: DashboardIssuePhaseChangeLike[] | null;
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
    ...buildBrowserLocalCiStatusLines(status?.localCiContract ?? null),
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

export function buildOverviewSummary(args: {
  status: DashboardStatusLike | null | undefined;
  doctor: DashboardDoctorLike | null | undefined;
  connectionPhase: DashboardConnectionPhase;
  refreshPhase: DashboardRefreshPhase;
  hasSuccessfulRefresh: boolean;
}): DashboardOverviewSummary {
  const selectedIssueNumber = parseSelectedIssueNumber(args.status);
  const runnableIssues = Array.isArray(args.status?.runnableIssues) ? args.status.runnableIssues : [];
  const blockedIssues = Array.isArray(args.status?.blockedIssues) ? args.status.blockedIssues : [];
  const inventoryStatus = args.status?.inventoryStatus ?? null;
  const doctorStatus = typeof args.doctor?.overallStatus === "string" ? args.doctor.overallStatus.toLowerCase() : "";
  const loopOffTrackedWorkBlocker = describeLoopOffTrackedWorkBlocker(args.status);

  if (!args.hasSuccessfulRefresh) {
    return {
      headline: "Loading supervisor status",
      detail: "The dashboard is collecting the current state. This may take a few seconds.",
      tone: "info",
    };
  }

  if (args.refreshPhase === "failed" || args.connectionPhase === "reconnecting") {
    return {
      headline: "Status needs attention",
      detail: "The dashboard is showing stale data while it retries the latest refresh.",
      tone: "warn",
    };
  }

  if (doctorStatus === "fail") {
    return {
      headline: "Environment checks need attention",
      detail: "A required dependency is failing, so supervisor actions may not be safe yet.",
      tone: "fail",
    };
  }

  if (loopOffTrackedWorkBlocker) {
    return {
      headline: "Tracked work is waiting for the loop",
      detail: describeLoopOffTrackedWorkRestartGuidance(loopOffTrackedWorkBlocker),
      tone: "warn",
    };
  }

  if (inventoryStatus?.mode === "degraded") {
    const lastRefresh = inventoryStatus.lastSuccessfulFullRefreshAt;
    const detail =
      inventoryStatus.posture === "targeted_degraded_reconciliation"
        ? "Tracked PR reconciliation can continue while new queue selection stays blocked."
        : inventoryStatus.posture === "bounded_snapshot_selection"
          ? "Using a fresh last-known-good snapshot" +
            (lastRefresh ? " from " + lastRefresh : "") +
            " while bounded selection can continue."
          : inventoryStatus.posture === "diagnostics_only_snapshot"
          ? "Using last-known-good snapshot support" +
            (lastRefresh ? " from " + lastRefresh : "") +
            " while new selection stays blocked."
          : inventoryStatus.summary || "Queue reconciliation is degraded until a fresh full inventory refresh succeeds.";
    return {
      headline: "Inventory refresh is degraded",
      detail,
      tone: inventoryStatus.recoveryState === "blocked" ? "fail" : "warn",
    };
  }

  if (selectedIssueNumber !== null) {
    return {
      headline: "A focused issue is ready to inspect",
      detail: "Issue " + formatIssueRef(selectedIssueNumber) + " is the current dashboard focus.",
      tone: "ok",
    };
  }

  if (runnableIssues.length > 0) {
    return {
      headline: "Runnable work is available",
      detail: "The supervisor has ready work and can advance on the next safe cycle.",
      tone: "ok",
    };
  }

  if (blockedIssues.length > 0) {
    return {
      headline: "Work is currently blocked",
      detail: "No runnable issue is available right now, so the queue needs unblock or recovery work.",
      tone: "warn",
    };
  }

  return {
    headline: "Supervisor is idle",
    detail: "No selected issue or runnable work is currently surfaced in the dashboard.",
    tone: "info",
  };
}

export function buildNextIssueSummary(status: DashboardStatusLike | null | undefined): DashboardNextIssueSummary {
  const selectedIssueNumber = parseSelectedIssueNumber(status);
  const runnableIssues = Array.isArray(status?.runnableIssues) ? status.runnableIssues : [];
  const blockedIssues = Array.isArray(status?.blockedIssues) ? status.blockedIssues : [];
  const selectedRunnableIssue =
    selectedIssueNumber === null ? null : runnableIssues.find((issue) => issue.issueNumber === selectedIssueNumber);

  if (selectedIssueNumber !== null) {
    return {
      issueNumber: selectedIssueNumber,
      title: selectedRunnableIssue?.title || "Selected issue",
      detail: "This is the issue currently surfaced by the supervisor selection logic.",
      stateLabel: "Selected issue",
    };
  }

  if (runnableIssues.length > 0) {
    return {
      issueNumber: runnableIssues[0].issueNumber,
      title: runnableIssues[0].title || "Runnable issue",
      detail: "This is the next runnable issue available to the supervisor.",
      stateLabel: "Next runnable issue",
    };
  }

  if (blockedIssues.length > 0) {
    return {
      issueNumber: blockedIssues[0].issueNumber,
      title: blockedIssues[0].title || "Blocked issue",
      detail: "No runnable issue is available, so the queue is waiting on a blocker.",
      stateLabel: "Blocked issue",
    };
  }

  return {
    issueNumber: null,
    title: "No issue is selected yet",
    detail: "When the supervisor surfaces a selected or runnable issue, it will appear here first.",
    stateLabel: "Next issue",
  };
}

export function buildPrimaryActionSummary(args: {
  status: DashboardStatusLike | null | undefined;
  doctor: DashboardDoctorLike | null | undefined;
  connectionPhase: DashboardConnectionPhase;
  refreshPhase: DashboardRefreshPhase;
  hasSuccessfulRefresh: boolean;
}): DashboardNextStateSummary {
  const selectedIssueNumber = parseSelectedIssueNumber(args.status);
  const blockedCount = Array.isArray(args.status?.blockedIssues) ? args.status.blockedIssues.length : 0;
  const runnableCount = Array.isArray(args.status?.runnableIssues) ? args.status.runnableIssues.length : 0;
  const doctorStatus = typeof args.doctor?.overallStatus === "string" ? args.doctor.overallStatus.toLowerCase() : "";
  const loopOffTrackedWorkBlocker = describeLoopOffTrackedWorkBlocker(args.status);

  if (!args.hasSuccessfulRefresh) {
    return {
      title: "Wait for the first refresh",
      detail: "Let the dashboard finish loading before relying on the next supervisor state.",
    };
  }

  if (args.refreshPhase === "failed" || args.connectionPhase === "reconnecting") {
    return {
      title: "Recover dashboard freshness",
      detail: "Wait for a healthy refresh before relying on the next supervisor state shown here.",
    };
  }

  if (doctorStatus === "fail") {
    return {
      title: "Resolve environment checks",
      detail: "A required dependency is failing, so the supervisor should not advance until checks recover.",
    };
  }

  if (loopOffTrackedWorkBlocker) {
    return {
      title: describeLoopOffTrackedWorkRestartActionTitle(),
      detail: describeLoopOffTrackedWorkRestartGuidance(loopOffTrackedWorkBlocker),
    };
  }

  if (selectedIssueNumber !== null) {
    return {
      title: "Execute the selected issue",
      detail: "The next supervisor state will keep working on " + formatIssueRef(selectedIssueNumber) + ".",
    };
  }

  if (blockedCount > 0 && runnableCount === 0) {
    return {
      title: "Recover blocked work",
      detail: "The queue has blockers and no runnable issue, so the next supervisor state is recovery-oriented.",
    };
  }

  if (runnableCount > 0) {
    return {
      title: "Select the next runnable issue",
      detail: "The queue has runnable work, so the next supervisor state is issue selection.",
    };
  }

  return {
    title: "Observe and refresh",
    detail: "The queue is quiet right now, so the next supervisor state is observation and refresh.",
  };
}

export function buildAttentionItems(args: {
  status: DashboardStatusLike | null | undefined;
  doctor: DashboardDoctorLike | null | undefined;
  connectionPhase: DashboardConnectionPhase;
  refreshPhase: DashboardRefreshPhase;
  hasSuccessfulRefresh: boolean;
}): string[] {
  const items: string[] = [];
  const blockedIssues = Array.isArray(args.status?.blockedIssues) ? args.status.blockedIssues : [];
  const runnableIssues = Array.isArray(args.status?.runnableIssues) ? args.status.runnableIssues : [];
  const inventoryStatus = args.status?.inventoryStatus ?? null;
  const doctorChecks = Array.isArray(args.doctor?.checks) ? args.doctor.checks : [];
  const doctorDecision = args.doctor?.decisionSummary ?? null;
  const statusWarning = args.status?.warning?.message ?? null;
  const reconciliationWarning = args.status?.reconciliationWarning ?? null;
  const loopOffTrackedWorkBlocker = describeLoopOffTrackedWorkBlocker(args.status);
  const failingChecks = doctorChecks.filter((check) => {
    const value = typeof check.status === "string" ? check.status.toLowerCase() : "";
    return value === "fail" || value === "warn";
  });

  if (!args.hasSuccessfulRefresh) {
    items.push("The first refresh is still in progress.");
  }

  if (args.connectionPhase === "reconnecting") {
    items.push("The live connection is reconnecting.");
  }

  if (args.refreshPhase === "failed") {
    items.push("The last refresh failed, so some details may be stale.");
  }

  if (inventoryStatus?.mode === "degraded") {
    items.push("Inventory posture: " + (inventoryStatus.posture ?? "degraded").replace(/_/gu, " ") + ".");
    if (inventoryStatus.lastSuccessfulFullRefreshAt) {
      items.push("Last successful full refresh: " + inventoryStatus.lastSuccessfulFullRefreshAt + ".");
    }
    if (inventoryStatus.recoveryGuidance) {
      items.push("Recovery: " + inventoryStatus.recoveryGuidance);
    }
  }

  if (loopOffTrackedWorkBlocker) {
    items.push(describeLoopOffTrackedWorkRestartGuidance(loopOffTrackedWorkBlocker));
  }

  if (blockedIssues.length > 0) {
    items.push(String(blockedIssues.length) + " blocked issue(s) are waiting on follow-up work.");
  }

  if (runnableIssues.length > 0) {
    items.push(String(runnableIssues.length) + " runnable issue(s) are available.");
  }

  if (
    doctorDecision &&
    (doctorDecision.action === "stop" || doctorDecision.action === "maintenance") &&
    typeof doctorDecision.summary === "string" &&
    doctorDecision.summary.trim().length > 0
  ) {
    items.push("Doctor decision: " + doctorDecision.summary);
  } else {
    for (const check of failingChecks.slice(0, 3)) {
      items.push((check.name || "check") + ": " + (check.summary || check.status || "needs attention"));
    }
  }

  if (statusWarning) {
    items.push(statusWarning);
  }

  if (reconciliationWarning && reconciliationWarning !== statusWarning) {
    items.push(reconciliationWarning);
  }

  if (items.length === 0) {
    items.push("No immediate attention items are reported.");
  }

  return items;
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
  const issueNumber = result?.issueNumber;
  if (action === "requeue" && Number.isInteger(issueNumber)) {
    const transition =
      result?.previousState || result?.nextState
        ? " " + (result?.previousState ?? "unknown") + " -> " + (result?.nextState ?? "unknown")
        : "";
    const reason = humanizeTimelineValue(result?.recoveryReason);
    return "requeue issue " + formatIssueRef(issueNumber) + transition + (reason ? " (" + reason + ")" : "");
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

export function formatRetryContextSummary(activityContext: DashboardIssueActivityContextLike | null | undefined): string | null {
  const retryContext = activityContext?.retryContext;
  if (!retryContext) {
    return null;
  }

  const parts: string[] = [];
  if ((retryContext.timeoutRetryCount ?? 0) > 0) {
    parts.push("timeout=" + retryContext.timeoutRetryCount);
  }
  if ((retryContext.blockedVerificationRetryCount ?? 0) > 0) {
    parts.push("verification=" + retryContext.blockedVerificationRetryCount);
  }
  if ((retryContext.repeatedBlockerCount ?? 0) > 1) {
    parts.push("same_blocker=" + retryContext.repeatedBlockerCount);
  }
  if ((retryContext.repeatedFailureSignatureCount ?? 0) > 1) {
    parts.push("same_failure_signature=" + retryContext.repeatedFailureSignatureCount);
  }
  if (retryContext.lastFailureSignature) {
    parts.push("last_failure_signature=" + retryContext.lastFailureSignature);
  }

  return parts.length > 0 ? parts.join(" ") : null;
}

export function formatRecoveryLoopSummary(activityContext: DashboardIssueActivityContextLike | null | undefined): string | null {
  const repeatedRecovery = activityContext?.repeatedRecovery;
  if (!repeatedRecovery) {
    return null;
  }

  const parts = [];
  if (repeatedRecovery.kind) {
    parts.push("kind=" + repeatedRecovery.kind);
  }
  if (Number.isInteger(repeatedRecovery.repeatCount) && Number.isInteger(repeatedRecovery.repeatLimit)) {
    parts.push("repeat_count=" + repeatedRecovery.repeatCount + "/" + repeatedRecovery.repeatLimit);
  }
  if (repeatedRecovery.status) {
    parts.push("status=" + repeatedRecovery.status);
  }
  if (repeatedRecovery.lastFailureSignature) {
    parts.push("last_failure_signature=" + repeatedRecovery.lastFailureSignature);
  }
  if (repeatedRecovery.action) {
    parts.push("action=" + repeatedRecovery.action);
  }

  return parts.length > 0 ? parts.join(" ") : null;
}

export function formatRecentPhaseChanges(activityContext: DashboardIssueActivityContextLike | null | undefined): string | null {
  const phaseChanges = Array.isArray(activityContext?.recentPhaseChanges) ? activityContext.recentPhaseChanges : [];
  if (phaseChanges.length === 0) {
    return null;
  }

  return phaseChanges
    .map((change) =>
      [
        change.at ? "at=" + change.at : null,
        change.from && change.to ? "phase_change=" + change.from + "->" + change.to : null,
        change.reason ? "reason=" + change.reason : null,
        change.source ? "source=" + change.source : null,
      ]
        .filter((part): part is string => part !== null)
        .join(" "),
    )
    .filter((part) => part.length > 0)
    .join(" | ");
}
