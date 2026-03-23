import assert from "node:assert/strict";
import test from "node:test";
import {
  inferStateWithoutPullRequest,
  shouldPreserveNoPrFailureTracking,
  shouldPreserveStaleStabilizingNoPrRecoveryTracking,
} from "./no-pull-request-state";
import { IssueRunRecord, WorkspaceStatus } from "./core/types";

function createRecord(overrides: Partial<IssueRunRecord> = {}): IssueRunRecord {
  return {
    issue_number: 366,
    state: "blocked",
    branch: "codex/reopen-issue-366",
    pr_number: null,
    workspace: "/tmp/workspaces/issue-366",
    journal_path: "/tmp/workspaces/issue-366/.codex-supervisor/issue-journal.md",
    review_wait_started_at: null,
    review_wait_head_sha: null,
    copilot_review_requested_observed_at: null,
    copilot_review_requested_head_sha: null,
    copilot_review_timed_out_at: null,
    copilot_review_timeout_action: null,
    copilot_review_timeout_reason: null,
    codex_session_id: "session-1",
    local_review_head_sha: null,
    local_review_blocker_summary: null,
    local_review_summary_path: null,
    local_review_run_at: null,
    local_review_max_severity: null,
    local_review_findings_count: 0,
    local_review_root_cause_count: 0,
    local_review_verified_max_severity: null,
    local_review_verified_findings_count: 0,
    local_review_recommendation: null,
    local_review_degraded: false,
    last_local_review_signature: null,
    repeated_local_review_signature_count: 0,
    external_review_head_sha: null,
    external_review_misses_path: null,
    external_review_matched_findings_count: 0,
    external_review_near_match_findings_count: 0,
    external_review_missed_findings_count: 0,
    attempt_count: 2,
    implementation_attempt_count: 2,
    repair_attempt_count: 0,
    timeout_retry_count: 0,
    blocked_verification_retry_count: 0,
    repeated_blocker_count: 0,
    repeated_failure_signature_count: 1,
    stale_stabilizing_no_pr_recovery_count: 0,
    last_head_sha: "abcdef1",
    last_codex_summary: null,
    last_recovery_reason: null,
    last_recovery_at: null,
    last_error: "Codex completed without updating the issue journal for issue #366.",
    last_failure_kind: null,
    last_failure_context: {
      category: "blocked",
      summary: "Codex completed without updating the issue journal for issue #366.",
      signature: "handoff-missing",
      command: null,
      details: ["Update the Codex Working Notes section before ending the turn."],
      url: null,
      updated_at: "2026-03-11T01:50:41.997Z",
    },
    last_blocker_signature: null,
    last_failure_signature: "handoff-missing",
    blocked_reason: "handoff_missing",
    processed_review_thread_ids: [],
    processed_review_thread_fingerprints: [],
    updated_at: "2026-03-11T01:50:41.997Z",
    ...overrides,
  };
}

function createWorkspaceStatus(overrides: Partial<WorkspaceStatus> = {}): WorkspaceStatus {
  return {
    branch: "codex/reopen-issue-366",
    headSha: "abcdef1",
    hasUncommittedChanges: false,
    baseAhead: 0,
    baseBehind: 0,
    remoteBranchExists: true,
    remoteAhead: 0,
    remoteBehind: 0,
    ...overrides,
  };
}

test("inferStateWithoutPullRequest preserves no-PR state policy branches", () => {
  const cases = [
    {
      name: "keeps zero-attempt runs in reproducing",
      record: createRecord({ implementation_attempt_count: 0, state: "stabilizing" }),
      workspaceStatus: createWorkspaceStatus({ baseAhead: 1 }),
      expected: "reproducing",
    },
    {
      name: "promotes a clean checkpoint branch to draft_pr",
      record: createRecord({ state: "implementing" }),
      workspaceStatus: createWorkspaceStatus({ baseAhead: 1 }),
      expected: "draft_pr",
    },
    {
      name: "keeps planning and reproducing states in reproducing without a clean checkpoint",
      record: createRecord({ state: "planning" }),
      workspaceStatus: createWorkspaceStatus({ hasUncommittedChanges: true, baseAhead: 1 }),
      expected: "reproducing",
    },
    {
      name: "falls back to stabilizing after implementation without a clean checkpoint",
      record: createRecord({ state: "implementing" }),
      workspaceStatus: createWorkspaceStatus({ hasUncommittedChanges: true, remoteAhead: 1 }),
      expected: "stabilizing",
    },
  ] as const;

  for (const testCase of cases) {
    assert.equal(
      inferStateWithoutPullRequest(testCase.record, testCase.workspaceStatus),
      testCase.expected,
      testCase.name,
    );
  }
});

test("shouldPreserveNoPrFailureTracking only keeps repeated blocked no-PR failures", () => {
  assert.equal(shouldPreserveNoPrFailureTracking(createRecord()), true);
  assert.equal(
    shouldPreserveNoPrFailureTracking(createRecord({ repeated_failure_signature_count: 0 })),
    false,
  );
  assert.equal(
    shouldPreserveNoPrFailureTracking(createRecord({ last_failure_signature: null })),
    false,
  );
  assert.equal(
    shouldPreserveNoPrFailureTracking(
      createRecord({
        last_failure_context: {
          category: "manual",
          summary: "Needs manual follow-up.",
          signature: "manual-follow-up",
          command: null,
          details: [],
          url: null,
          updated_at: "2026-03-11T01:50:41.997Z",
        },
      }),
    ),
    false,
  );
  assert.equal(shouldPreserveNoPrFailureTracking(createRecord({ pr_number: 123 })), false);
});

test("shouldPreserveStaleStabilizingNoPrRecoveryTracking only keeps stale stabilizing no-PR retries", () => {
  assert.equal(
    shouldPreserveStaleStabilizingNoPrRecoveryTracking(
      createRecord({
        state: "stabilizing",
        last_failure_signature: "stale-stabilizing-no-pr-recovery-loop",
      }),
      "stabilizing",
    ),
    true,
  );
  assert.equal(
    shouldPreserveStaleStabilizingNoPrRecoveryTracking(
      createRecord({
        state: "stabilizing",
        last_failure_signature: "handoff-missing",
      }),
      "stabilizing",
    ),
    false,
  );
  assert.equal(
    shouldPreserveStaleStabilizingNoPrRecoveryTracking(
      createRecord({
        state: "stabilizing",
        last_failure_signature: "stale-stabilizing-no-pr-recovery-loop",
      }),
      "draft_pr",
    ),
    false,
  );
  assert.equal(
    shouldPreserveStaleStabilizingNoPrRecoveryTracking(
      createRecord({
        state: "implementing",
        last_failure_signature: "stale-stabilizing-no-pr-recovery-loop",
      }),
      "stabilizing",
    ),
    false,
  );
});
