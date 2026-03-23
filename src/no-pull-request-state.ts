import { IssueRunRecord, RunState, WorkspaceStatus } from "./core/types";

export const STALE_STABILIZING_NO_PR_RECOVERY_SIGNATURE = "stale-stabilizing-no-pr-recovery-loop";

export function getStaleStabilizingNoPrRecoveryCount(
  record: Pick<
    IssueRunRecord,
    "last_failure_signature" | "repeated_failure_signature_count" | "stale_stabilizing_no_pr_recovery_count"
  >,
): number {
  if ((record.stale_stabilizing_no_pr_recovery_count ?? 0) > 0) {
    return record.stale_stabilizing_no_pr_recovery_count ?? 0;
  }

  return record.last_failure_signature === STALE_STABILIZING_NO_PR_RECOVERY_SIGNATURE
    ? record.repeated_failure_signature_count
    : 0;
}

export function shouldPreserveNoPrFailureTracking(
  record: Pick<
    IssueRunRecord,
    | "pr_number"
    | "last_failure_context"
    | "last_failure_signature"
    | "repeated_failure_signature_count"
    | "stale_stabilizing_no_pr_recovery_count"
  >,
): boolean {
  return (
    record.pr_number === null &&
    record.last_failure_context?.category === "blocked" &&
    record.last_failure_signature !== null &&
    (record.repeated_failure_signature_count > 0 || getStaleStabilizingNoPrRecoveryCount(record) > 0)
  );
}

export function shouldPreserveStaleStabilizingNoPrRecoveryTracking(
  record: Pick<
    IssueRunRecord,
    | "pr_number"
    | "state"
    | "last_failure_signature"
    | "repeated_failure_signature_count"
    | "stale_stabilizing_no_pr_recovery_count"
  >,
  nextState: RunState,
): boolean {
  return (
    record.pr_number === null &&
    record.state === "stabilizing" &&
    nextState === "stabilizing" &&
    record.last_failure_signature === STALE_STABILIZING_NO_PR_RECOVERY_SIGNATURE &&
    getStaleStabilizingNoPrRecoveryCount(record) > 0
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
