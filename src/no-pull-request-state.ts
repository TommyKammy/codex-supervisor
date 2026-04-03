import { IssueRunRecord, RunState, SupervisorConfig, WorkspaceStatus } from "./core/types";

export const STALE_STABILIZING_NO_PR_RECOVERY_SIGNATURE = "stale-stabilizing-no-pr-recovery-loop";

export function getStaleStabilizingNoPrRecoveryCount(
  record: Pick<
    IssueRunRecord,
    "last_failure_signature" | "repeated_failure_signature_count" | "stale_stabilizing_no_pr_recovery_count"
  >,
): number {
  if (record.last_failure_signature !== STALE_STABILIZING_NO_PR_RECOVERY_SIGNATURE) {
    return 0;
  }

  if ((record.stale_stabilizing_no_pr_recovery_count ?? 0) > 0) {
    return record.stale_stabilizing_no_pr_recovery_count ?? 0;
  }

  return record.repeated_failure_signature_count;
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
    (record.state === "queued" || record.state === "stabilizing") &&
    nextState === "stabilizing" &&
    record.last_failure_signature === STALE_STABILIZING_NO_PR_RECOVERY_SIGNATURE &&
    getStaleStabilizingNoPrRecoveryCount(record) > 0
  );
}

export function buildStaleStabilizingNoPrRecoveryWarningLine(
  record: Pick<
    IssueRunRecord,
    | "issue_number"
    | "state"
    | "blocked_reason"
    | "last_failure_signature"
    | "repeated_failure_signature_count"
    | "stale_stabilizing_no_pr_recovery_count"
  >,
  config: Pick<SupervisorConfig, "sameFailureSignatureRepeatLimit">,
): string | null {
  const repeatedCount = getStaleStabilizingNoPrRecoveryCount(record);
  if (repeatedCount <= 0) {
    return null;
  }

  const repeatLimit = Math.max(config.sameFailureSignatureRepeatLimit, 1);
  const status =
    record.blocked_reason === "manual_review" || repeatedCount >= repeatLimit
      ? "manual_review_required"
      : "retrying";

  return [
    "stale_recovery_warning",
    `issue=#${record.issue_number}`,
    `status=${status}`,
    `state=${record.state}`,
    `repeat_count=${repeatedCount}/${repeatLimit}`,
    "tracked_pr=none",
    "action=confirm_whether_the_change_already_landed_or_retarget_the_issue_manually",
  ].join(" ");
}

export function hasStaleStabilizingNoPrRecoveryBudgetRemaining(
  record: Pick<
    IssueRunRecord,
    | "pr_number"
    | "state"
    | "last_failure_signature"
    | "repeated_failure_signature_count"
    | "stale_stabilizing_no_pr_recovery_count"
  >,
  config: Pick<SupervisorConfig, "sameFailureSignatureRepeatLimit">,
): boolean {
  if (record.pr_number !== null || record.state !== "queued") {
    return false;
  }

  const repeatedCount = getStaleStabilizingNoPrRecoveryCount(record);
  if (repeatedCount <= 0) {
    return false;
  }

  return repeatedCount < Math.max(config.sameFailureSignatureRepeatLimit, 1);
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
