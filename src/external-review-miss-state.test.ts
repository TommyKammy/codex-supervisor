import assert from "node:assert/strict";
import test from "node:test";
import { nextExternalReviewMissPatch, syncExternalReviewMissState } from "./external-review-miss-state";
import { type ExternalReviewMissContext } from "./external-review-misses";
import { type IssueRunRecord, type SupervisorStateFile } from "./types";

function createRecord(overrides: Partial<IssueRunRecord> = {}): IssueRunRecord {
  return {
    issue_number: 102,
    state: "addressing_review",
    branch: "codex/issue-102",
    pr_number: 116,
    workspace: "/tmp/workspaces/issue-102",
    journal_path: "/tmp/workspaces/issue-102/.codex-supervisor/issue-journal.md",
    review_wait_started_at: null,
    review_wait_head_sha: null,
    copilot_review_requested_observed_at: null,
    copilot_review_requested_head_sha: null,
    copilot_review_timed_out_at: null,
    copilot_review_timeout_action: null,
    copilot_review_timeout_reason: null,
    codex_session_id: null,
    local_review_head_sha: "deadbeef",
    local_review_blocker_summary: null,
    local_review_summary_path: "/tmp/reviews/local-review.json",
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
    attempt_count: 1,
    implementation_attempt_count: 1,
    repair_attempt_count: 0,
    timeout_retry_count: 0,
    blocked_verification_retry_count: 0,
    repeated_blocker_count: 0,
    repeated_failure_signature_count: 0,
    last_head_sha: "deadbeef",
    last_codex_summary: null,
    last_recovery_reason: null,
    last_recovery_at: null,
    last_error: null,
    last_failure_kind: null,
    last_failure_context: null,
    last_blocker_signature: null,
    last_failure_signature: null,
    blocked_reason: null,
    processed_review_thread_ids: [],
    processed_review_thread_fingerprints: [],
    updated_at: "2026-03-15T10:15:47.932Z",
    ...overrides,
  };
}

function createState(record: IssueRunRecord): SupervisorStateFile {
  return {
    activeIssueNumber: record.issue_number,
    issues: {
      [String(record.issue_number)]: record,
    },
  };
}

function createContext(overrides: Partial<ExternalReviewMissContext> = {}): ExternalReviewMissContext {
  return {
    artifactPath: "/tmp/reviews/external-review-misses-head-deadbeef.json",
    matchedCount: 1,
    nearMatchCount: 2,
    missedCount: 3,
    missedFindings: [],
    regressionTestCandidates: [],
    ...overrides,
  };
}

test("nextExternalReviewMissPatch preserves same-head artifacts when no new miss artifact was written", () => {
  const patch = nextExternalReviewMissPatch(
    createRecord({
      external_review_head_sha: "deadbeef",
      external_review_misses_path: "/tmp/reviews/external-review-misses-head-deadbeef.json",
      external_review_matched_findings_count: 1,
      external_review_near_match_findings_count: 1,
      external_review_missed_findings_count: 2,
    }),
    {
      headRefOid: "deadbeef",
    },
    null,
  );

  assert.deepEqual(patch, {});
});

test("nextExternalReviewMissPatch clears stale artifacts when the PR head changes", () => {
  const patch = nextExternalReviewMissPatch(
    createRecord({
      external_review_head_sha: "oldhead",
      external_review_misses_path: "/tmp/reviews/external-review-misses-head-oldhead.json",
      external_review_matched_findings_count: 1,
      external_review_near_match_findings_count: 1,
      external_review_missed_findings_count: 2,
    }),
    {
      headRefOid: "newhead",
    },
    null,
  );

  assert.deepEqual(patch, {
    external_review_head_sha: null,
    external_review_misses_path: null,
    external_review_matched_findings_count: 0,
    external_review_near_match_findings_count: 0,
    external_review_missed_findings_count: 0,
  });
});

test("syncExternalReviewMissState persists artifact counters and journal updates when a miss artifact is written", async () => {
  const originalRecord = createRecord();
  const state = createState(originalRecord);
  const savedStates: SupervisorStateFile[] = [];
  const journaledRecords: IssueRunRecord[] = [];

  const record = await syncExternalReviewMissState({
    stateStore: {
      touch(currentRecord, patch) {
        return { ...currentRecord, ...patch };
      },
      async save(nextState) {
        savedStates.push(nextState);
      },
    },
    state,
    record: originalRecord,
    pr: { headRefOid: "deadbeef" },
    context: createContext(),
    syncJournal: async (nextRecord) => {
      journaledRecords.push(nextRecord);
    },
  });

  assert.equal(record.external_review_head_sha, "deadbeef");
  assert.equal(record.external_review_misses_path, "/tmp/reviews/external-review-misses-head-deadbeef.json");
  assert.equal(record.external_review_matched_findings_count, 1);
  assert.equal(record.external_review_near_match_findings_count, 2);
  assert.equal(record.external_review_missed_findings_count, 3);
  assert.equal(state.issues["102"], record);
  assert.equal(savedStates.length, 1);
  assert.deepEqual(journaledRecords, [record]);
});
