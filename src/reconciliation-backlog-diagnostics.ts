import type { SupervisorStateFile } from "./core/types";

function formatIssueCursor(issueNumber: number | null): string {
  return issueNumber === null ? "none" : `#${issueNumber}`;
}

export function buildTrackedMergedButOpenBacklogDiagnosticLine(
  state: Pick<SupervisorStateFile, "issues" | "reconciliation_state">,
  prefix = "reconciliation_backlog",
): string | null {
  const trackedRecords = Object.values(state.issues).filter((record) => record.pr_number !== null);
  if (trackedRecords.length === 0) {
    return null;
  }

  const historicalDoneRecords = trackedRecords.filter((record) => record.state === "done").length;
  if (historicalDoneRecords === 0) {
    return null;
  }

  const recoverableRecords = trackedRecords.length - historicalDoneRecords;
  const resumeAfterIssue = state.reconciliation_state?.tracked_merged_but_open_last_processed_issue_number ?? null;

  return [
    prefix,
    "phase=tracked_merged_but_open_issues",
    `resume_after_issue=${formatIssueCursor(resumeAfterIssue)}`,
    `historical_done_records=${historicalDoneRecords}`,
    `recoverable_records=${recoverableRecords}`,
    `tracked_records=${trackedRecords.length}`,
  ].join(" ");
}
