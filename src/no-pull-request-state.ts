import { IssueRunRecord, RunState, WorkspaceStatus } from "./types";

export function shouldPreserveNoPrFailureTracking(
  record: Pick<
    IssueRunRecord,
    "pr_number" | "last_failure_context" | "last_failure_signature" | "repeated_failure_signature_count"
  >,
): boolean {
  return (
    record.pr_number === null &&
    record.last_failure_context?.category === "blocked" &&
    record.last_failure_signature !== null &&
    record.repeated_failure_signature_count > 0
  );
}

export function inferStateWithoutPullRequest(
  record: IssueRunRecord,
  workspaceStatus: WorkspaceStatus,
): RunState {
  const branchHasCheckpoint = workspaceStatus.baseAhead > 0 || workspaceStatus.remoteAhead > 0;
  if (record.implementation_attempt_count === 0) {
    return "reproducing";
  }

  if (branchHasCheckpoint && !workspaceStatus.hasUncommittedChanges) {
    return "draft_pr";
  }

  if (record.state === "planning" || record.state === "reproducing") {
    return "reproducing";
  }

  return "stabilizing";
}
