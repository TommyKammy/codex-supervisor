export type SupervisorDashboardWorkflowStepId = "observe" | "triage" | "select" | "execute" | "recover";

export interface SupervisorDashboardWorkflowStepDto {
  id: SupervisorDashboardWorkflowStepId;
  title: string;
  detail: string;
  state: "done" | "current" | "idle" | "current warn" | "warn";
}

function formatIssueRef(issueNumber: number | null | undefined): string {
  return isPositiveIssueNumber(issueNumber) ? "#" + issueNumber : "none";
}

function isPositiveIssueNumber(issueNumber: number | null | undefined): issueNumber is number {
  return typeof issueNumber === "number" && Number.isInteger(issueNumber) && issueNumber > 0;
}

export function buildSupervisorDashboardWorkflowSteps(args: {
  selectedIssueNumber: number | null;
  runnableIssueCount: number;
  blockedIssueCount: number;
  trackedIssueCount: number;
  hasCandidateDiscovery: boolean;
  reconciliationPhase: string | null;
}): SupervisorDashboardWorkflowStepDto[] {
  const normalizedPhase = typeof args.reconciliationPhase === "string" ? args.reconciliationPhase.toLowerCase() : "steady";
  const selectedIssueNumber = isPositiveIssueNumber(args.selectedIssueNumber) ? args.selectedIssueNumber : null;

  let currentStepId: SupervisorDashboardWorkflowStepId = "observe";
  let currentDetail = "Supervisor is watching the queue and waiting for the next actionable signal.";

  if (selectedIssueNumber !== null) {
    currentStepId = "execute";
    currentDetail = "Issue " + formatIssueRef(selectedIssueNumber) + " is the current active focus.";
  } else if (args.blockedIssueCount > 0 && args.runnableIssueCount === 0) {
    currentStepId = "recover";
    currentDetail = "No runnable issue is available, so the supervisor is waiting on recovery or unblock work.";
  } else if (args.runnableIssueCount > 0) {
    currentStepId = "select";
    currentDetail = "Runnable candidates are available and ready for selection.";
  } else if (
    args.trackedIssueCount > 0 ||
    args.hasCandidateDiscovery ||
    /discover|scan|triage|queue|reconcile|refresh/u.test(normalizedPhase)
  ) {
    currentStepId = "triage";
    currentDetail = "Tracked work and queue signals are being reconciled before an issue is selected.";
  }

  const stepOrder: SupervisorDashboardWorkflowStepId[] = ["observe", "triage", "select", "execute", "recover"];
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
          : args.trackedIssueCount > 0
            ? String(args.trackedIssueCount) + " tracked issues remain in the working set."
            : "Queue discovery and reconciliation determine the next candidate.",
      state: currentIndex > 1 ? "done" : currentIndex === 1 ? "current" : "idle",
    },
    {
      id: "select",
      title: "Select",
      detail:
        currentStepId === "select"
          ? currentDetail
          : args.runnableIssueCount > 0
            ? String(args.runnableIssueCount) + " runnable issue(s) are available."
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
          : args.blockedIssueCount > 0
            ? String(args.blockedIssueCount) + " blocked issue(s) need unblock or recovery."
            : "Recovery remains quiet while no active blockers are reported.",
      state: currentIndex === 4 ? "current warn" : args.blockedIssueCount > 0 && currentStepId !== "recover" ? "warn" : "idle",
    },
  ];
}
