import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { StateStore } from "./state-store";
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

async function withTempDir(run: (dir: string) => Promise<void>): Promise<void> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "codex-supervisor-state-store-"));
  try {
    await run(dir);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

test("StateStore json roundtrip preserves the active reservation and retry counters", async () => {
  await withTempDir(async (dir) => {
    const store = new StateStore(path.join(dir, "state.json"), { backend: "json" });
    const state: SupervisorStateFile = {
      activeIssueNumber: 402,
      issues: {
        "402": createRecord(402),
      },
    };

    await store.save(state);
    const loaded = await store.load();

    assert.equal(loaded.activeIssueNumber, 402);
    assert.equal(loaded.issues["402"]?.timeout_retry_count, 1);
    assert.equal(loaded.issues["402"]?.blocked_verification_retry_count, 2);
    assert.equal(loaded.issues["402"]?.repeated_blocker_count, 1);
    assert.equal(loaded.issues["402"]?.repeated_failure_signature_count, 1);
    assert.equal(loaded.issues["402"]?.blocked_reason, "verification");
  });
});

test("StateStore sqlite roundtrip preserves the active reservation and retry counters", async () => {
  await withTempDir(async (dir) => {
    const store = new StateStore(path.join(dir, "state.sqlite"), { backend: "sqlite" });
    const state: SupervisorStateFile = {
      activeIssueNumber: 403,
      issues: {
        "403": createRecord(403, {
          timeout_retry_count: 2,
          blocked_verification_retry_count: 3,
          repeated_blocker_count: 2,
          repeated_failure_signature_count: 2,
        }),
      },
    };

    await store.save(state);
    const loaded = await store.load();

    assert.equal(loaded.activeIssueNumber, 403);
    assert.equal(loaded.issues["403"]?.timeout_retry_count, 2);
    assert.equal(loaded.issues["403"]?.blocked_verification_retry_count, 3);
    assert.equal(loaded.issues["403"]?.repeated_blocker_count, 2);
    assert.equal(loaded.issues["403"]?.repeated_failure_signature_count, 2);
    assert.equal(loaded.issues["403"]?.blocked_reason, "verification");
  });
});

test("StateStore json load captures structured corruption findings for invalid JSON", async () => {
  await withTempDir(async (dir) => {
    const statePath = path.join(dir, "state.json");
    await fs.writeFile(statePath, "{not-json}\n", "utf8");

    const store = new StateStore(statePath, { backend: "json" });
    const loaded = await store.load();

    assert.equal(loaded.activeIssueNumber, null);
    assert.deepEqual(loaded.issues, {});
    assert.equal(loaded.load_findings?.length, 1);
    assert.deepEqual(loaded.load_findings?.[0], {
      backend: "json",
      kind: "parse_error",
      scope: "state_file",
      location: statePath,
      issue_number: null,
      message: loaded.load_findings?.[0]?.message ?? "",
    });
    assert.match(loaded.load_findings?.[0]?.message ?? "", /failed to parse json/i);
  });
});

test("StateStore sqlite load captures structured corruption findings for malformed issue rows", async () => {
  await withTempDir(async (dir) => {
    const statePath = path.join(dir, "state.sqlite");
    const store = new StateStore(statePath, { backend: "sqlite" });

    await store.save({
      activeIssueNumber: 403,
      issues: {
        "403": createRecord(403),
      },
    });

    const { DatabaseSync } = await import("node:sqlite");
    const db = new DatabaseSync(statePath);
    try {
      db.prepare("UPDATE issues SET record_json = ? WHERE issue_number = ?").run("{not-json}", 403);
    } finally {
      db.close();
    }

    const loaded = await store.load();

    assert.equal(loaded.activeIssueNumber, 403);
    assert.deepEqual(loaded.issues, {});
    assert.equal(loaded.load_findings?.length, 1);
    assert.deepEqual(loaded.load_findings?.[0], {
      backend: "sqlite",
      kind: "parse_error",
      scope: "issue_row",
      location: "sqlite issues row 403",
      issue_number: 403,
      message: loaded.load_findings?.[0]?.message ?? "",
    });
    assert.match(loaded.load_findings?.[0]?.message ?? "", /failed to parse json/i);
  });
});
