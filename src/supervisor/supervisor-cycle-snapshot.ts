import fs from "node:fs/promises";
import path from "node:path";
import { ensureDir } from "../core/utils";
import {
  FailureContext,
  GitHubIssue,
  GitHubPullRequest,
  IssueRunRecord,
  PullRequestCheck,
  ReviewThread,
  SupervisorConfig,
  WorkspaceStatus,
} from "../core/types";
import { replaySupervisorCycleDecisionSnapshot } from "./supervisor-cycle-replay";

export interface SupervisorCycleDecisionSnapshot {
  schemaVersion: 1;
  capturedAt: string;
  issue: Pick<GitHubIssue, "number" | "title" | "url" | "state" | "updatedAt">;
  local: {
    record: Pick<
      IssueRunRecord,
      | "issue_number"
      | "state"
      | "branch"
      | "pr_number"
      | "workspace"
      | "journal_path"
      | "attempt_count"
      | "implementation_attempt_count"
      | "repair_attempt_count"
      | "timeout_retry_count"
      | "blocked_verification_retry_count"
      | "repeated_blocker_count"
      | "repeated_failure_signature_count"
      | "blocked_reason"
      | "last_error"
      | "last_failure_kind"
      | "last_failure_context"
      | "last_failure_signature"
      | "last_head_sha"
      | "review_wait_started_at"
      | "review_wait_head_sha"
      | "copilot_review_requested_observed_at"
      | "copilot_review_requested_head_sha"
      | "copilot_review_timed_out_at"
      | "copilot_review_timeout_action"
      | "copilot_review_timeout_reason"
      | "local_review_head_sha"
      | "local_review_blocker_summary"
      | "local_review_summary_path"
      | "local_review_run_at"
      | "local_review_max_severity"
      | "local_review_findings_count"
      | "local_review_root_cause_count"
      | "local_review_verified_max_severity"
      | "local_review_verified_findings_count"
      | "local_review_recommendation"
      | "local_review_degraded"
      | "last_local_review_signature"
      | "repeated_local_review_signature_count"
      | "processed_review_thread_ids"
      | "processed_review_thread_fingerprints"
      | "updated_at"
    >;
    workspaceStatus: WorkspaceStatus;
  };
  github: {
    pullRequest: GitHubPullRequest | null;
    checks: PullRequestCheck[];
    reviewThreads: ReviewThread[];
  };
  decision: {
    nextState: IssueRunRecord["state"];
    shouldRunCodex: boolean;
    blockedReason: IssueRunRecord["blocked_reason"];
    failureContext: FailureContext | null;
  };
}

export function supervisorCycleSnapshotPath(workspacePath: string): string {
  return path.join(workspacePath, ".codex-supervisor", "replay", "decision-cycle-snapshot.json");
}

export function buildSupervisorCycleDecisionSnapshot(args: {
  config: SupervisorConfig;
  capturedAt: string;
  issue: GitHubIssue;
  record: IssueRunRecord;
  workspaceStatus: WorkspaceStatus;
  pr: GitHubPullRequest | null;
  checks: PullRequestCheck[];
  reviewThreads: ReviewThread[];
}): SupervisorCycleDecisionSnapshot {
  const { config, capturedAt, issue, record, workspaceStatus, pr, checks, reviewThreads } = args;
  const replay = replaySupervisorCycleDecisionSnapshot({
    schemaVersion: 1,
    capturedAt,
    issue: {
      number: issue.number,
      title: issue.title,
      url: issue.url,
      state: issue.state,
      updatedAt: issue.updatedAt,
    },
    local: {
      record: {
        issue_number: record.issue_number,
        state: record.state,
        branch: record.branch,
        pr_number: record.pr_number,
        workspace: record.workspace,
        journal_path: record.journal_path,
        attempt_count: record.attempt_count,
        implementation_attempt_count: record.implementation_attempt_count,
        repair_attempt_count: record.repair_attempt_count,
        timeout_retry_count: record.timeout_retry_count,
        blocked_verification_retry_count: record.blocked_verification_retry_count,
        repeated_blocker_count: record.repeated_blocker_count,
        repeated_failure_signature_count: record.repeated_failure_signature_count,
        blocked_reason: record.blocked_reason,
        last_error: record.last_error,
        last_failure_kind: record.last_failure_kind,
        last_failure_context: record.last_failure_context,
        last_failure_signature: record.last_failure_signature,
        last_head_sha: record.last_head_sha,
        review_wait_started_at: record.review_wait_started_at,
        review_wait_head_sha: record.review_wait_head_sha,
        copilot_review_requested_observed_at: record.copilot_review_requested_observed_at,
        copilot_review_requested_head_sha: record.copilot_review_requested_head_sha,
        copilot_review_timed_out_at: record.copilot_review_timed_out_at,
        copilot_review_timeout_action: record.copilot_review_timeout_action,
        copilot_review_timeout_reason: record.copilot_review_timeout_reason,
        local_review_head_sha: record.local_review_head_sha,
        local_review_blocker_summary: record.local_review_blocker_summary,
        local_review_summary_path: record.local_review_summary_path,
        local_review_run_at: record.local_review_run_at,
        local_review_max_severity: record.local_review_max_severity,
        local_review_findings_count: record.local_review_findings_count,
        local_review_root_cause_count: record.local_review_root_cause_count,
        local_review_verified_max_severity: record.local_review_verified_max_severity,
        local_review_verified_findings_count: record.local_review_verified_findings_count,
        local_review_recommendation: record.local_review_recommendation,
        local_review_degraded: record.local_review_degraded,
        last_local_review_signature: record.last_local_review_signature,
        repeated_local_review_signature_count: record.repeated_local_review_signature_count,
        processed_review_thread_ids: [...record.processed_review_thread_ids],
        processed_review_thread_fingerprints: [...record.processed_review_thread_fingerprints],
        updated_at: record.updated_at,
      },
      workspaceStatus,
    },
    github: {
      pullRequest: pr,
      checks,
      reviewThreads,
    },
    decision: {
      nextState: record.state,
      shouldRunCodex: false,
      blockedReason: null,
      failureContext: null,
    },
  }, config);

  return {
    schemaVersion: 1,
    capturedAt,
    issue: {
      number: issue.number,
      title: issue.title,
      url: issue.url,
      state: issue.state,
      updatedAt: issue.updatedAt,
    },
    local: {
      record: {
        issue_number: record.issue_number,
        state: record.state,
        branch: record.branch,
        pr_number: record.pr_number,
        workspace: record.workspace,
        journal_path: record.journal_path,
        attempt_count: record.attempt_count,
        implementation_attempt_count: record.implementation_attempt_count,
        repair_attempt_count: record.repair_attempt_count,
        timeout_retry_count: record.timeout_retry_count,
        blocked_verification_retry_count: record.blocked_verification_retry_count,
        repeated_blocker_count: record.repeated_blocker_count,
        repeated_failure_signature_count: record.repeated_failure_signature_count,
        blocked_reason: record.blocked_reason,
        last_error: record.last_error,
        last_failure_kind: record.last_failure_kind,
        last_failure_context: record.last_failure_context,
        last_failure_signature: record.last_failure_signature,
        last_head_sha: record.last_head_sha,
        review_wait_started_at: record.review_wait_started_at,
        review_wait_head_sha: record.review_wait_head_sha,
        copilot_review_requested_observed_at: record.copilot_review_requested_observed_at,
        copilot_review_requested_head_sha: record.copilot_review_requested_head_sha,
        copilot_review_timed_out_at: record.copilot_review_timed_out_at,
        copilot_review_timeout_action: record.copilot_review_timeout_action,
        copilot_review_timeout_reason: record.copilot_review_timeout_reason,
        local_review_head_sha: record.local_review_head_sha,
        local_review_blocker_summary: record.local_review_blocker_summary,
        local_review_summary_path: record.local_review_summary_path,
        local_review_run_at: record.local_review_run_at,
        local_review_max_severity: record.local_review_max_severity,
        local_review_findings_count: record.local_review_findings_count,
        local_review_root_cause_count: record.local_review_root_cause_count,
        local_review_verified_max_severity: record.local_review_verified_max_severity,
        local_review_verified_findings_count: record.local_review_verified_findings_count,
        local_review_recommendation: record.local_review_recommendation,
        local_review_degraded: record.local_review_degraded,
        last_local_review_signature: record.last_local_review_signature,
        repeated_local_review_signature_count: record.repeated_local_review_signature_count,
        processed_review_thread_ids: [...record.processed_review_thread_ids],
        processed_review_thread_fingerprints: [...record.processed_review_thread_fingerprints],
        updated_at: record.updated_at,
      },
      workspaceStatus,
    },
    github: {
      pullRequest: pr,
      checks,
      reviewThreads,
    },
    decision: replay.replayedDecision,
  };
}

export async function writeSupervisorCycleDecisionSnapshot(args: {
  config: SupervisorConfig;
  capturedAt: string;
  issue: GitHubIssue;
  record: IssueRunRecord;
  workspacePath: string;
  workspaceStatus: WorkspaceStatus;
  pr: GitHubPullRequest | null;
  checks: PullRequestCheck[];
  reviewThreads: ReviewThread[];
}): Promise<string> {
  const snapshotPath = supervisorCycleSnapshotPath(args.workspacePath);
  await ensureDir(path.dirname(snapshotPath));
  const snapshot = buildSupervisorCycleDecisionSnapshot(args);
  await fs.writeFile(snapshotPath, `${JSON.stringify(snapshot, null, 2)}\n`, "utf8");
  return snapshotPath;
}
