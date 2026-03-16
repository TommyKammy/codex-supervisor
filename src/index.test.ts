import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { spawnSync, SpawnSyncReturns } from "node:child_process";
import { parseArgs } from "./index";

function runCli(args: string[]): SpawnSyncReturns<string> {
  return spawnSync(process.execPath, [path.join(process.cwd(), "node_modules", "tsx", "dist", "cli.mjs"), "src/index.ts", ...args], {
    cwd: process.cwd(),
    encoding: "utf8",
  });
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

test("explain rejects malformed issue numbers", () => {
  for (const token of ["12abc", "1.5", "1e2"]) {
    const result = runCli(["explain", token]);

    assert.equal(result.status, 1);
    assert.match(result.stderr, new RegExp(`Unknown argument: ${escapeRegExp(token)}`));
  }
});

test("parseArgs accepts doctor as a command", () => {
  assert.deepEqual(parseArgs(["doctor"]), {
    command: "doctor",
    configPath: undefined,
    dryRun: false,
    why: false,
    issueNumber: undefined,
    snapshotPath: undefined,
  });
});

test("parseArgs accepts replay with a snapshot path", () => {
  assert.deepEqual(parseArgs(["replay", "/tmp/decision-cycle-snapshot.json"]), {
    command: "replay",
    configPath: undefined,
    dryRun: false,
    why: false,
    issueNumber: undefined,
    snapshotPath: "/tmp/decision-cycle-snapshot.json",
  });
});

test("replay re-runs a saved snapshot through the CLI entry path", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "replay-cli-"));
  const configPath = path.join(tempDir, "supervisor.config.json");
  const snapshotPath = path.join(tempDir, "decision-cycle-snapshot.json");

  await fs.writeFile(configPath, JSON.stringify({
    repoPath: tempDir,
    repoSlug: "owner/repo",
    defaultBranch: "main",
    workspaceRoot: path.join(tempDir, "workspaces"),
    stateBackend: "json",
    stateFile: path.join(tempDir, "state.json"),
    codexBinary: "/usr/bin/codex",
    reviewBotLogins: ["copilot-pull-request-reviewer"],
    branchPrefix: "codex/reopen-issue-",
  }));
  await fs.writeFile(snapshotPath, JSON.stringify({
    schemaVersion: 1,
    capturedAt: "2026-03-16T10:07:00Z",
    issue: {
      number: 408,
      title: "Replay debugging snapshot",
      url: "https://example.test/issues/408",
      state: "OPEN",
      updatedAt: "2026-03-16T10:05:00Z",
    },
    local: {
      record: {
        issue_number: 408,
        state: "reproducing",
        branch: "codex/reopen-issue-408",
        pr_number: null,
        workspace: path.join(tempDir, "workspaces", "issue-408"),
        journal_path: null,
        attempt_count: 0,
        implementation_attempt_count: 0,
        repair_attempt_count: 0,
        blocked_reason: null,
        last_error: null,
        last_failure_signature: null,
        last_head_sha: null,
        review_wait_started_at: null,
        review_wait_head_sha: null,
        copilot_review_requested_observed_at: null,
        copilot_review_requested_head_sha: null,
        copilot_review_timed_out_at: null,
        copilot_review_timeout_action: null,
        copilot_review_timeout_reason: null,
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
        processed_review_thread_ids: [],
        processed_review_thread_fingerprints: [],
        updated_at: "2026-03-16T10:05:00Z",
      },
      workspaceStatus: {
        branch: "codex/reopen-issue-408",
        headSha: "head-408",
        hasUncommittedChanges: false,
        baseAhead: 0,
        baseBehind: 0,
        remoteBranchExists: false,
        remoteAhead: 0,
        remoteBehind: 0,
      },
    },
    github: {
      pullRequest: null,
      checks: [],
      reviewThreads: [],
    },
    decision: {
      nextState: "reproducing",
      shouldRunCodex: true,
      blockedReason: null,
      failureContext: null,
    },
  }));

  const result = runCli(["replay", snapshotPath, "--config", configPath]);

  assert.equal(result.status, 0);
  assert.match(result.stdout, /replayed_next_state=reproducing/);
  assert.match(result.stdout, /decision_match=yes/);
});
