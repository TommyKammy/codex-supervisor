import test from "node:test";
import assert from "node:assert/strict";
import { normalizeStateForLoad, normalizeStateForSave } from "./state-store-normalization";
import { IssueRunRecord, SupervisorStateFile } from "./types";

function createRecord(issueNumber: number, overrides: Partial<IssueRunRecord> = {}): IssueRunRecord {
  return {
    issue_number: issueNumber,
    state: "blocked",
    branch: `codex/issue-${issueNumber}`,
    pr_number: null,
    workspace: `/tmp/workspaces/issue-${issueNumber}`,
    journal_path: null,
    review_wait_started_at: null,
    review_wait_head_sha: null,
    copilot_review_requested_observed_at: null,
    copilot_review_requested_head_sha: null,
    copilot_review_timed_out_at: null,
    copilot_review_timeout_action: null,
    copilot_review_timeout_reason: null,
    codex_session_id: null,
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
    timeout_retry_count: 1,
    blocked_verification_retry_count: 2,
    repeated_blocker_count: 1,
    repeated_failure_signature_count: 1,
    last_head_sha: "deadbee",
    last_codex_summary: "previous summary",
    last_recovery_reason: null,
    last_recovery_at: null,
    last_error: "verification still failing",
    last_failure_kind: "command_error",
    last_failure_context: null,
    last_blocker_signature: "verification:deadbee",
    last_failure_signature: "verification:deadbee",
    blocked_reason: "verification",
    processed_review_thread_ids: [],
    processed_review_thread_fingerprints: [],
    updated_at: "2026-03-16T00:00:00Z",
    ...overrides,
  };
}

test("normalizeStateForLoad realigns snapshot issue_count with normalized entries", () => {
  const lastSuccessfulInventorySnapshot = {
    source: "gh issue list",
    recorded_at: "2026-03-26T00:05:00Z",
    issue_count: 2,
    issues: [
      {
        number: 91,
        title: "Valid snapshot issue",
        body: "Preserve the valid issue.",
        createdAt: "2026-03-26T00:00:00Z",
        updatedAt: "2026-03-26T00:00:00Z",
        url: "https://example.test/issues/91",
        state: "OPEN",
      },
      {
        number: 92,
        body: "Missing a title so normalization should drop this entry.",
        createdAt: "2026-03-26T00:01:00Z",
        updatedAt: "2026-03-26T00:01:00Z",
        url: "https://example.test/issues/92",
      },
    ],
  } as unknown as SupervisorStateFile["last_successful_inventory_snapshot"];
  const loaded = normalizeStateForLoad({
    activeIssueNumber: null,
    issues: {},
    last_successful_inventory_snapshot: lastSuccessfulInventorySnapshot,
  });

  assert.equal(loaded.last_successful_inventory_snapshot?.issue_count, 1);
  assert.deepEqual(loaded.last_successful_inventory_snapshot?.issues, [{
    number: 91,
    title: "Valid snapshot issue",
    body: "Preserve the valid issue.",
    createdAt: "2026-03-26T00:00:00Z",
    updatedAt: "2026-03-26T00:00:00Z",
    url: "https://example.test/issues/91",
    state: "OPEN",
  }]);
});

test("normalizeStateForSave canonicalizes legacy inventory artifact paths", () => {
  const saved = normalizeStateForSave({
    activeIssueNumber: null,
    issues: {
      "402": createRecord(402),
    },
    inventory_refresh_failure: {
      source: "gh issue list",
      message: "Failed to load full issue inventory.",
      recorded_at: "2026-03-28T07:16:21.409Z",
      diagnostics: [
        {
          transport: "primary",
          source: "gh issue list",
          message: "legacy artifact only",
          artifact_path: "/tmp/inventory-refresh-failures/legacy-preview.json",
        },
      ],
    },
  } satisfies SupervisorStateFile);

  assert.equal(saved.inventory_refresh_failure?.diagnostics?.[0]?.artifact_path, undefined);
  assert.equal(
    saved.inventory_refresh_failure?.diagnostics?.[0]?.preview_artifact_path,
    "/tmp/inventory-refresh-failures/legacy-preview.json",
  );
});
