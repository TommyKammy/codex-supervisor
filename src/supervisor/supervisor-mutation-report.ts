import type { IssueRunRecord, JsonCorruptStateResetResult, RunState } from "../core/types";

export type SupervisorRecoveryAction = "requeue";
export type SupervisorOrphanPruneAction = "prune-orphaned-workspaces";

export type SupervisorMutationRecordSnapshotDto = Pick<
  IssueRunRecord,
  | "state"
  | "pr_number"
  | "codex_session_id"
  | "blocked_reason"
  | "last_error"
  | "last_failure_kind"
  | "last_failure_context"
  | "last_blocker_signature"
  | "last_failure_signature"
  | "timeout_retry_count"
  | "blocked_verification_retry_count"
  | "repeated_blocker_count"
  | "repeated_failure_signature_count"
  | "review_wait_started_at"
  | "review_wait_head_sha"
  | "copilot_review_requested_observed_at"
  | "copilot_review_requested_head_sha"
  | "copilot_review_timed_out_at"
  | "copilot_review_timeout_action"
  | "copilot_review_timeout_reason"
  | "local_review_blocker_summary"
>;

export interface SupervisorMutationResultDto {
  action: SupervisorRecoveryAction;
  issueNumber: number;
  outcome: "mutated" | "rejected";
  summary: string;
  previousState: RunState | null;
  previousRecordSnapshot: SupervisorMutationRecordSnapshotDto | null;
  nextState: RunState | null;
  recoveryReason: string | null;
}

export interface PrunedOrphanedWorkspaceResultDto {
  issueNumber: number;
  workspaceName: string;
  workspacePath: string;
  branch: string;
  modifiedAt: string | null;
  reason: string;
}

export interface SkippedOrphanedWorkspaceResultDto {
  issueNumber: number;
  workspaceName: string;
  workspacePath: string;
  branch: string | null;
  modifiedAt: string | null;
  eligibility: "locked" | "recent" | "unsafe_target";
  reason: string;
}

export interface SupervisorOrphanPruneResultDto {
  action: SupervisorOrphanPruneAction;
  outcome: "completed" | "rejected";
  summary: string;
  pruned: PrunedOrphanedWorkspaceResultDto[];
  skipped: SkippedOrphanedWorkspaceResultDto[];
}

export function buildSupervisorMutationRecordSnapshot(
  record: IssueRunRecord,
): SupervisorMutationRecordSnapshotDto {
  return {
    state: record.state,
    pr_number: record.pr_number,
    codex_session_id: record.codex_session_id,
    blocked_reason: record.blocked_reason,
    last_error: record.last_error,
    last_failure_kind: record.last_failure_kind,
    last_failure_context: record.last_failure_context
      ? {
        ...record.last_failure_context,
        details: [...record.last_failure_context.details],
      }
      : null,
    last_blocker_signature: record.last_blocker_signature,
    last_failure_signature: record.last_failure_signature,
    timeout_retry_count: record.timeout_retry_count,
    blocked_verification_retry_count: record.blocked_verification_retry_count,
    repeated_blocker_count: record.repeated_blocker_count,
    repeated_failure_signature_count: record.repeated_failure_signature_count,
    review_wait_started_at: record.review_wait_started_at,
    review_wait_head_sha: record.review_wait_head_sha,
    copilot_review_requested_observed_at: record.copilot_review_requested_observed_at,
    copilot_review_requested_head_sha: record.copilot_review_requested_head_sha,
    copilot_review_timed_out_at: record.copilot_review_timed_out_at,
    copilot_review_timeout_action: record.copilot_review_timeout_action,
    copilot_review_timeout_reason: record.copilot_review_timeout_reason,
    local_review_blocker_summary: record.local_review_blocker_summary,
  };
}

export function renderSupervisorMutationResultDto(dto: SupervisorMutationResultDto): string {
  return JSON.stringify(dto);
}

export function renderSupervisorOrphanPruneResultDto(dto: SupervisorOrphanPruneResultDto): string {
  return JSON.stringify(dto);
}

export function renderJsonCorruptStateResetResultDto(dto: JsonCorruptStateResetResult): string {
  return JSON.stringify(dto);
}
