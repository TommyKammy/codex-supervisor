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

test("normalizeState helpers coerce invalid top-level active issue and issues payloads", () => {
  const raw = {
    activeIssueNumber: "7",
    issues: [],
  } as unknown as SupervisorStateFile;

  const loaded = normalizeStateForLoad(raw);
  const saved = normalizeStateForSave(raw);

  assert.equal(loaded.activeIssueNumber, null);
  assert.deepEqual(loaded.issues, {});
  assert.equal(saved.activeIssueNumber, null);
  assert.deepEqual(saved.issues, {});
});

test("normalizeStateForLoad defaults Codex Connector retry bookkeeping", () => {
  const loaded = normalizeStateForLoad({
    activeIssueNumber: null,
    issues: {
      "1976": createRecord(1976),
    },
  } satisfies SupervisorStateFile);

  assert.equal(loaded.issues["1976"]?.codex_connector_review_request_retry_count, 0);
  assert.equal(loaded.issues["1976"]?.codex_connector_review_request_retry_head_sha, null);
  assert.equal(loaded.issues["1976"]?.codex_connector_review_request_last_retried_at, null);
  assert.equal(loaded.issues["1976"]?.codex_connector_review_request_comment_identity_status, null);
  assert.equal(loaded.issues["1976"]?.codex_connector_review_request_comment_database_id, null);
  assert.equal(loaded.issues["1976"]?.codex_connector_review_request_comment_node_id, null);
  assert.equal(loaded.issues["1976"]?.codex_connector_review_request_comment_url, null);
});

test("normalizeStateForLoad defaults and preserves review-loop retry state", () => {
  const loadedWithoutState = normalizeStateForLoad({
    activeIssueNumber: null,
    issues: {
      "2269": createRecord(2269),
    },
  } satisfies SupervisorStateFile);
  const loadedWithState = normalizeStateForLoad({
    activeIssueNumber: null,
    issues: {
      "2270": createRecord(2270, {
        review_loop_retry_state: [
          {
            fingerprint: "pr=116|head=head-a|thread=thread-1|comment=comment-1",
            pr_number: 116,
            head_sha: "head-a",
            thread_id: "thread-1",
            latest_comment_fingerprint: "comment-1",
            attempts: 2,
            first_attempted_at: "2026-06-07T00:01:00Z",
            last_attempted_at: "2026-06-07T00:02:00Z",
          },
        ],
      }),
    },
  } satisfies SupervisorStateFile);

  assert.deepEqual(loadedWithoutState.issues["2269"]?.review_loop_retry_state, []);
  assert.deepEqual(loadedWithState.issues["2270"]?.review_loop_retry_state, [
    {
      fingerprint: "pr=116|head=head-a|thread=thread-1|comment=comment-1",
      pr_number: 116,
      head_sha: "head-a",
      thread_id: "thread-1",
      latest_comment_fingerprint: "comment-1",
      attempts: 2,
      first_attempted_at: "2026-06-07T00:01:00Z",
      last_attempted_at: "2026-06-07T00:02:00Z",
    },
  ]);
});

test("normalizeStateForLoad clamps persisted addressing review strategy fields", () => {
  const loaded = normalizeStateForLoad({
    activeIssueNumber: null,
    issues: {
      "2011": {
        ...createRecord(2011),
        addressing_review_strategy: "root_cause_analysis",
        addressing_review_strategy_reason: "same failure signature repeated",
      },
      "2012": {
        ...createRecord(2012),
        addressing_review_strategy: "skip_root_cause_switch",
        addressing_review_strategy_reason: "should not survive without a valid strategy",
      } as unknown as IssueRunRecord,
      "2013": {
        ...createRecord(2013),
        addressing_review_strategy: "normal_patch",
        addressing_review_strategy_reason: "   ",
      },
    },
  } satisfies SupervisorStateFile);

  assert.equal(loaded.issues["2011"]?.addressing_review_strategy, "root_cause_analysis");
  assert.equal(loaded.issues["2011"]?.addressing_review_strategy_reason, "same failure signature repeated");
  assert.equal(loaded.issues["2012"]?.addressing_review_strategy, null);
  assert.equal(loaded.issues["2012"]?.addressing_review_strategy_reason, null);
  assert.equal(loaded.issues["2013"]?.addressing_review_strategy, "normal_patch");
  assert.equal(loaded.issues["2013"]?.addressing_review_strategy_reason, null);
});
