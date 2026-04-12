import type { DashboardLoopRuntimeLike, DashboardStatusLike } from "./webui-dashboard-browser-logic";

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
            : "Recovery remains quiet while runnable work is available.",
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
