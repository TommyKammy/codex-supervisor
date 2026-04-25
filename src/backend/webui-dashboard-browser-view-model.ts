import type {
  DashboardLoopRuntimeLike,
  DashboardRuntimeRecoverySummaryLike,
  DashboardStatusLike,
  DashboardWorkflowStepLike,
} from "./webui-dashboard-browser-logic";

export interface DashboardWorkflowStep {
  id: "observe" | "triage" | "select" | "execute" | "recover";
  title: string;
  detail: string;
  state: "done" | "current" | "idle" | "current warn" | "warn";
}

export interface DashboardLoopRuntimeSummary {
  modeBadge: string;
  summary: string;
  chipLabel: string;
  chipTone: "ok" | "warn" | "info";
}

export function buildRuntimeRecoverySummaryLines(
  summary: DashboardRuntimeRecoverySummaryLike | null | undefined,
): string[] {
  if (!summary) {
    return [];
  }

  function formatRuntimeTrackedRecord(
    record: NonNullable<DashboardRuntimeRecoverySummaryLike["trackedRecords"]>[number],
  ): string {
    return [
      formatIssueRef(record.issueNumber),
      record.state || "unknown",
      "pr=" + (Number.isInteger(record.prNumber) ? "#" + record.prNumber : "none"),
      "blocked_reason=" + (record.blockedReason || "none"),
    ].join(" ");
  }

  function isRuntimeRecoveryRecord(
    record: unknown,
  ): record is NonNullable<DashboardRuntimeRecoverySummaryLike["trackedRecords"]>[number] {
    return typeof record === "object" && record !== null;
  }

  function isRuntimeRecoverySignal(
    signal: unknown,
  ): signal is NonNullable<DashboardRuntimeRecoverySummaryLike["signals"]>[number] {
    return typeof signal === "object" && signal !== null;
  }

  const lines = [
    ["loop_state", summary.loopState || "unknown"],
    ["lock_confidence", summary.lockConfidence || "none"],
  ].map(([label, value]) => label + ": " + value);

  const trackedRecords = Array.isArray(summary.trackedRecords) ? summary.trackedRecords : [];
  const validTrackedRecords = trackedRecords.filter(isRuntimeRecoveryRecord);
  lines.push(
    "tracked_records: " +
      (validTrackedRecords.length === 0 ? "none" : validTrackedRecords.map(formatRuntimeTrackedRecord).join("; ")),
  );

  const signals = Array.isArray(summary.signals) ? summary.signals : [];
  for (const signal of signals.filter(isRuntimeRecoverySignal)) {
    lines.push("signal: " + (signal.kind || "unknown") + " " + (signal.summary || ""));
  }

  if (summary.recommendation) {
    lines.push(
      "recommendation: " +
        (summary.recommendation.category || "unknown") +
        " source=" +
        (summary.recommendation.source || "unknown") +
        " summary=" +
        (summary.recommendation.summary || ""),
    );
  }

  return lines;
}

function formatIssueRef(issueNumber: number | null | undefined): string {
  return Number.isInteger(issueNumber) ? "#" + issueNumber : "none";
}

function parseSelectedIssueNumber(status: DashboardStatusLike | null | undefined): number | null {
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

export function countCandidateIssues(status: DashboardStatusLike | null | undefined): string {
  const observed = status?.candidateDiscovery?.observedMatchingOpenIssues ?? null;
  return typeof observed === "number" ? String(observed) : "n/a";
}

export function buildWorkflowSteps(status: DashboardStatusLike | null | undefined): DashboardWorkflowStep[] {
  const workflowStepIds = new Set(["observe", "triage", "select", "execute", "recover"]);
  const workflowStepStates = new Set(["done", "current", "idle", "current warn", "warn"]);

  function normalizeWorkflowStep(step: DashboardWorkflowStepLike): DashboardWorkflowStep | null {
    if (
      typeof step.id !== "string" ||
      !workflowStepIds.has(step.id) ||
      typeof step.title !== "string" ||
      step.title.trim() === "" ||
      typeof step.detail !== "string" ||
      step.detail.trim() === "" ||
      typeof step.state !== "string" ||
      !workflowStepStates.has(step.state)
    ) {
      return null;
    }

    return {
      id: step.id,
      title: step.title,
      detail: step.detail,
      state: step.state,
    };
  }

  const serverWorkflowSteps = Array.isArray(status?.workflowSteps) ? status.workflowSteps : [];
  const workflowSteps = serverWorkflowSteps
    .map(normalizeWorkflowStep)
    .filter((step): step is DashboardWorkflowStep => step !== null);
  const hasCompleteServerWorkflow =
    workflowSteps.length === serverWorkflowSteps.length &&
    workflowSteps.length === workflowStepIds.size &&
    new Set(workflowSteps.map((step) => step.id)).size === workflowStepIds.size;
  if (hasCompleteServerWorkflow) {
    return workflowSteps;
  }

  const selectedIssueNumber = parseSelectedIssueNumber(status);
  const runnableCount = Array.isArray(status?.runnableIssues) ? status.runnableIssues.length : 0;
  const blockedCount = Array.isArray(status?.blockedIssues) ? status.blockedIssues.length : 0;
  const trackedCount = Array.isArray(status?.trackedIssues) ? status.trackedIssues.length : 0;
  const candidateDiscovery = status?.candidateDiscovery ?? null;
  const normalizedPhase = typeof status?.reconciliationPhase === "string" ? status.reconciliationPhase.toLowerCase() : "steady";

  let currentStepId: DashboardWorkflowStep["id"] = "observe";
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

  const stepOrder: DashboardWorkflowStep["id"][] = ["observe", "triage", "select", "execute", "recover"];
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
            : "Recovery remains quiet while no active blockers are reported.",
      state: currentIndex === 4 ? "current warn" : blockedCount > 0 && currentStepId !== "recover" ? "warn" : "idle",
    },
  ];
}

export function metricClass(status: string | null | undefined): "ok" | "warn" | "fail" | "" {
  if (status === "pass") return "ok";
  if (status === "warn") return "warn";
  if (status === "fail") return "fail";
  return "";
}

export function formatKeyValueBlock(entries: Array<[string, string | null | undefined]>): string {
  return entries
    .filter((entry) => entry[1] !== null && entry[1] !== undefined && entry[1] !== "")
    .map(([label, value]) => label + ": " + value)
    .join("\n");
}

export function liveBadgeClass(tone: string | null | undefined): "ok" | "warn" | "fail" | "" {
  if (tone === "ok") return "ok";
  if (tone === "warn") return "warn";
  if (tone === "fail") return "fail";
  return "";
}

export function formatRefreshTime(timestamp: string | null): string {
  return timestamp === null ? "never" : new Date(timestamp).toLocaleTimeString();
}

export function describeLoopRuntime(loopRuntime: DashboardLoopRuntimeLike | null | undefined): DashboardLoopRuntimeSummary {
  const runtimeState = typeof loopRuntime?.state === "string" ? loopRuntime.state : "unknown";
  const hostMode = typeof loopRuntime?.hostMode === "string" ? loopRuntime.hostMode : "unknown";
  const ownershipConfidence =
    typeof loopRuntime?.ownershipConfidence === "string" ? loopRuntime.ownershipConfidence : "none";
  const duplicateDiagnostic = loopRuntime?.duplicateLoopDiagnostic ?? null;
  const recoveryGuidance =
    typeof loopRuntime?.recoveryGuidance === "string" && loopRuntime.recoveryGuidance.trim() !== ""
      ? loopRuntime.recoveryGuidance
      : typeof duplicateDiagnostic?.recoveryGuidance === "string" && duplicateDiagnostic.recoveryGuidance.trim() !== ""
        ? duplicateDiagnostic.recoveryGuidance
        : null;
  function appendRecoveryGuidance(summary: string): string {
    return recoveryGuidance === null ? summary : summary + ". " + recoveryGuidance;
  }
  const hasDuplicateSignal =
    ownershipConfidence === "duplicate_suspected" ||
    duplicateDiagnostic?.kind === "duplicate_loop_processes" ||
    duplicateDiagnostic?.status === "duplicate";
  if (hasDuplicateSignal) {
    const matchingProcessCount =
      typeof duplicateDiagnostic?.matchingProcessCount === "number" ? duplicateDiagnostic.matchingProcessCount : null;
    return {
      modeBadge: "Mode: web + loop ambiguous",
      summary: appendRecoveryGuidance(matchingProcessCount === null
        ? "Loop runtime ownership is ambiguous"
        : "Loop runtime ownership is ambiguous: " + String(matchingProcessCount) + " matching loop processes"),
      chipLabel: "loop ownership ambiguous",
      chipTone: "warn",
    };
  }
  if (ownershipConfidence === "stale_lock") {
    return {
      modeBadge: "Mode: web only (stale loop marker)",
      summary: "Loop mode is off, but a stale runtime marker was found",
      chipLabel: "stale loop marker",
      chipTone: "warn",
    };
  }
  if (ownershipConfidence === "ambiguous_owner") {
    return {
      modeBadge: "Mode: local WebUI",
      summary: appendRecoveryGuidance("Loop runtime marker ownership is ambiguous"),
      chipLabel: "loop marker ambiguous",
      chipTone: "warn",
    };
  }
  if (runtimeState === "running") {
    if (hostMode === "tmux") {
      return {
        modeBadge: "Mode: web + loop running (tmux)",
        summary: "Loop mode is running on this host via tmux",
        chipLabel: "loop running via tmux",
        chipTone: "ok",
      };
    }

    return {
      modeBadge: `Mode: web + loop running (${hostMode})`,
      summary: hostMode === "direct"
        ? "Loop mode is running on this host directly"
        : "Loop mode is running on this host with unknown host metadata",
      chipLabel: hostMode === "direct" ? "loop running directly" : "loop running with unknown host",
      chipTone: "warn",
    };
  }
  if (runtimeState === "off") {
    return {
      modeBadge: "Mode: web only (loop off)",
      summary: "Loop mode is off on this host",
      chipLabel: "loop off",
      chipTone: "ok",
    };
  }
  return {
    modeBadge: "Mode: local WebUI",
    summary: "Loop status is unavailable on this host",
    chipLabel: "loop unknown",
    chipTone: "info",
  };
}
