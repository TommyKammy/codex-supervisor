import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import type { CliOptions } from "../core/types";
import { handleReplayCommand } from "./replay-command";
import {
  createCliIoBuffer,
  handleReplayCorpusCommand,
  handleReplayCorpusPromoteCommand,
} from "./replay-corpus-command";

async function writeConfig(tempDir: string): Promise<string> {
  const configPath = path.join(tempDir, "supervisor.config.json");
  await fs.writeFile(configPath, JSON.stringify({
    repoPath: tempDir,
    repoSlug: "owner/repo",
    defaultBranch: "main",
    workspaceRoot: path.join(tempDir, "workspaces"),
    stateBackend: "json",
    stateFile: path.join(tempDir, "state.json"),
    codexBinary: "/usr/bin/codex",
    reviewBotLogins: ["copilot-pull-request-reviewer"],
    branchPrefix: "codex/issue-",
  }));
  return configPath;
}

function createReplaySnapshot(tempDir: string): Record<string, unknown> {
  return {
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
        branch: "codex/issue-408",
        pr_number: null,
        workspace: path.join(tempDir, "workspaces", "issue-408"),
        journal_path: null,
        attempt_count: 0,
        implementation_attempt_count: 0,
        repair_attempt_count: 0,
        timeout_retry_count: 0,
        blocked_verification_retry_count: 0,
        repeated_blocker_count: 0,
        repeated_failure_signature_count: 0,
        blocked_reason: null,
        last_error: null,
        last_failure_kind: null,
        last_failure_context: null,
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
        branch: "codex/issue-408",
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
  };
}

test("handleReplayCommand formats the replay result through the handler boundary", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "replay-handler-"));
  const configPath = await writeConfig(tempDir);
  const snapshotPath = path.join(tempDir, "decision-cycle-snapshot.json");
  await fs.writeFile(snapshotPath, JSON.stringify(createReplaySnapshot(tempDir)));

  const output = await handleReplayCommand({
    configPath,
    snapshotPath,
  });

  assert.match(output, /replayed_next_state=reproducing/);
  assert.match(output, /decision_match=yes/);
});

test("handleReplayCorpusCommand keeps the checked-in corpus default and success exit semantics", async () => {
  const io = createCliIoBuffer();

  await handleReplayCorpusCommand({
    configPath: undefined,
  }, io);

  assert.equal(io.exitCode, undefined);
  assert.deepEqual(io.stderr, []);
  assert.match(io.stdout.join("\n"), /^Replay corpus summary: total=\d+ passed=\d+ failed=0$/m);
});

test("handleReplayCorpusPromoteCommand preserves missing-case-id stderr guidance and exit code", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "replay-promote-handler-"));
  const snapshotPath = path.join(tempDir, "captured-snapshot.json");
  const configPath = await writeConfig(tempDir);
  const io = createCliIoBuffer();
  const snapshot = {
    ...createReplaySnapshot(tempDir),
    issue: {
      number: 557,
      title: "Replay corpus promotion suggest normalized case",
      url: "https://example.test/issues/557",
      state: "OPEN",
      updatedAt: "2026-03-18T07:27:52Z",
    },
  };
  await fs.writeFile(snapshotPath, JSON.stringify(snapshot));

  const options: CliOptions = {
    command: "replay-corpus-promote",
    configPath,
    snapshotPath,
    issueNumber: undefined,
    dryRun: false,
    why: false,
    issueLintSuggest: false,
    corpusPath: "replay-corpus",
    caseId: undefined,
  };

  await handleReplayCorpusPromoteCommand(options, io);

  assert.equal(io.exitCode, 1);
  assert.match(io.stderr.join("\n"), /The replay-corpus-promote command requires an explicit case id to write a new case\./);
  assert.match(io.stderr.join("\n"), /Suggested case ids:/);
  assert.match(io.stderr.join("\n"), /- issue-557-replay-corpus-promotion-suggest-normalized-case/);
});

test("handleReplayCorpusPromoteCommand prints missing-case-id guidance before any config loading", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "replay-promote-handler-configless-"));
  const snapshotPath = path.join(tempDir, "captured-snapshot.json");
  const io = createCliIoBuffer();
  const snapshot = {
    ...createReplaySnapshot(tempDir),
    issue: {
      number: 616,
      title: "Replay corpus promote guidance bypasses config loading",
      url: "https://example.test/issues/616",
      state: "OPEN",
      updatedAt: "2026-03-19T04:46:50Z",
    },
  };
  await fs.writeFile(snapshotPath, JSON.stringify(snapshot));

  const options: CliOptions = {
    command: "replay-corpus-promote",
    configPath: path.join(tempDir, "missing-supervisor.config.json"),
    snapshotPath,
    issueNumber: undefined,
    dryRun: false,
    why: false,
    issueLintSuggest: false,
    corpusPath: undefined,
    caseId: undefined,
  };

  await handleReplayCorpusPromoteCommand(options, io);

  assert.equal(io.exitCode, 1);
  assert.match(io.stderr.join("\n"), /The replay-corpus-promote command requires an explicit case id to write a new case\./);
  assert.match(io.stderr.join("\n"), /Suggested case ids:/);
  assert.match(io.stderr.join("\n"), /- issue-616-replay-corpus-promote-guidance-bypasses-config/);
});
