import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { spawnSync, SpawnSyncReturns } from "node:child_process";
import { parseArgs } from "./index";

function runCli(args: string[]): SpawnSyncReturns<string> {
  return spawnSync("npx", ["tsx", "src/index.ts", ...args], {
    cwd: process.cwd(),
    encoding: "utf8",
    env: {
      ...process.env,
      NODE_NO_WARNINGS: "1",
    },
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
    caseId: undefined,
    corpusPath: undefined,
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
    caseId: undefined,
    corpusPath: undefined,
  });
});

test("parseArgs accepts replay-corpus with an explicit corpus root", () => {
  assert.deepEqual(parseArgs(["replay-corpus", "/tmp/replay-corpus"]), {
    command: "replay-corpus",
    configPath: undefined,
    dryRun: false,
    why: false,
    issueNumber: undefined,
    snapshotPath: undefined,
    caseId: undefined,
    corpusPath: "/tmp/replay-corpus",
  });
});

test("parseArgs defaults replay-corpus to the checked-in corpus path", () => {
  assert.deepEqual(parseArgs(["replay-corpus"]), {
    command: "replay-corpus",
    configPath: undefined,
    dryRun: false,
    why: false,
    issueNumber: undefined,
    snapshotPath: undefined,
    caseId: undefined,
    corpusPath: "replay-corpus",
  });
});

test("parseArgs accepts replay-corpus-promote with explicit snapshot, case id, and corpus root", () => {
  assert.deepEqual(parseArgs([
    "replay-corpus-promote",
    "/tmp/decision-cycle-snapshot.json",
    "issue-408-reproducing",
    "/tmp/replay-corpus",
  ]), {
    command: "replay-corpus-promote",
    configPath: undefined,
    dryRun: false,
    why: false,
    issueNumber: undefined,
    snapshotPath: "/tmp/decision-cycle-snapshot.json",
    caseId: "issue-408-reproducing",
    corpusPath: "/tmp/replay-corpus",
  });
});

test("parseArgs defaults replay-corpus-promote to the checked-in corpus path", () => {
  assert.deepEqual(parseArgs([
    "replay-corpus-promote",
    "/tmp/decision-cycle-snapshot.json",
    "issue-408-reproducing",
  ]), {
    command: "replay-corpus-promote",
    configPath: undefined,
    dryRun: false,
    why: false,
    issueNumber: undefined,
    snapshotPath: "/tmp/decision-cycle-snapshot.json",
    caseId: "issue-408-reproducing",
    corpusPath: "replay-corpus",
  });
});

test("parseArgs accepts replay-corpus-promote without an explicit case id so suggestions can be surfaced", () => {
  assert.deepEqual(parseArgs([
    "replay-corpus-promote",
    "/tmp/decision-cycle-snapshot.json",
  ]), {
    command: "replay-corpus-promote",
    configPath: undefined,
    dryRun: false,
    why: false,
    issueNumber: undefined,
    snapshotPath: "/tmp/decision-cycle-snapshot.json",
    caseId: undefined,
    corpusPath: "replay-corpus",
  });
});

test("replay-corpus replays the checked-in corpus without requiring supervisor.config.json", () => {
  const result = runCli(["replay-corpus"]);

  assert.equal(result.status, 0);
  assert.match(result.stdout, /^Replay corpus summary: total=\d+ passed=\d+ failed=0$/m);
});

test("parseArgs rejects a second command after replay", () => {
  assert.throws(
    () => parseArgs(["replay", "/tmp/decision-cycle-snapshot.json", "run-once"]),
    /Unexpected second command: run-once/,
  );
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

test("replay-corpus-promote promotes a captured snapshot through the dedicated CLI entry path", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "replay-corpus-cli-promote-"));
  const configPath = path.join(tempDir, "supervisor.config.json");
  const corpusPath = path.join(tempDir, "replay-corpus");
  const snapshotPath = path.join(tempDir, "captured-snapshot.json");

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
  await fs.mkdir(path.join(corpusPath, "cases", "review-blocked", "input"), { recursive: true });
  await fs.mkdir(path.join(corpusPath, "cases", "review-blocked", "expected"), { recursive: true });
  await fs.writeFile(path.join(corpusPath, "manifest.json"), JSON.stringify({
    schemaVersion: 1,
    cases: [{ id: "review-blocked", path: "cases/review-blocked" }],
  }));

  const existingSnapshot = {
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
        journal_path: path.join(tempDir, "workspaces", "issue-408", ".codex-supervisor", "issue-journal.md"),
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
        last_head_sha: "head-408",
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
  const promotedSnapshot = {
    ...existingSnapshot,
    capturedAt: "2026-03-18T08:59:03.959Z",
    issue: {
      ...existingSnapshot.issue,
      number: 534,
      title: "Replay corpus promotion through the CLI entry path",
      url: "https://example.test/issues/534",
      updatedAt: "2026-03-18T07:27:52Z",
    },
    local: {
      record: {
        ...existingSnapshot.local.record,
        issue_number: 534,
        state: "planning",
        branch: "codex/issue-534",
        workspace: "/home/tommy/Dev/codex-supervisor-self-worktrees/issue-534",
        journal_path: "/home/tommy/Dev/codex-supervisor-self-worktrees/issue-534/.codex-supervisor/issue-journal.md",
        local_review_summary_path: "/tmp/reviews/promoted-summary.md",
        last_head_sha: "head-534",
        updated_at: "2026-03-18T08:59:03.090Z",
      },
      workspaceStatus: {
        branch: "codex/issue-534",
        headSha: "head-534",
        hasUncommittedChanges: true,
        baseAhead: 0,
        baseBehind: 0,
        remoteBranchExists: false,
        remoteAhead: 0,
        remoteBehind: 0,
      },
    },
  };

  await fs.writeFile(path.join(corpusPath, "cases", "review-blocked", "case.json"), JSON.stringify({
    schemaVersion: 1,
    id: "review-blocked",
    issueNumber: existingSnapshot.issue.number,
    title: existingSnapshot.issue.title,
    capturedAt: existingSnapshot.capturedAt,
  }));
  await fs.writeFile(path.join(corpusPath, "cases", "review-blocked", "input", "snapshot.json"), JSON.stringify(existingSnapshot));
  await fs.writeFile(path.join(corpusPath, "cases", "review-blocked", "expected", "replay-result.json"), JSON.stringify({
    nextState: existingSnapshot.decision.nextState,
    shouldRunCodex: existingSnapshot.decision.shouldRunCodex,
    blockedReason: existingSnapshot.decision.blockedReason,
    failureSignature: null,
  }));
  await fs.writeFile(snapshotPath, JSON.stringify(promotedSnapshot));

  const result = runCli([
    "replay-corpus-promote",
    snapshotPath,
    "issue-534-reproducing",
    corpusPath,
    "--config",
    configPath,
  ]);

  assert.equal(result.status, 0);
  assert.match(result.stdout, /Promoted replay corpus case "issue-534-reproducing" for issue #534\./);
  assert.match(
    result.stdout,
    new RegExp(`Case path: ${escapeRegExp(path.join(corpusPath, "cases", "issue-534-reproducing"))}`),
  );
  assert.match(
    result.stdout,
    /Expected outcome: nextState=reproducing, shouldRunCodex=true, blockedReason=none, failureSignature=none/,
  );
  assert.match(
    result.stdout,
    /Normalization: workspace=>\., journal_path=>\.codex-supervisor\/issue-journal\.md, local_review_summary_path=>none, hasUncommittedChanges=>false/,
  );

  const promotedCase = JSON.parse(
    await fs.readFile(path.join(corpusPath, "cases", "issue-534-reproducing", "case.json"), "utf8"),
  );
  assert.deepEqual(promotedCase, {
    schemaVersion: 1,
    id: "issue-534-reproducing",
    issueNumber: 534,
    title: "Replay corpus promotion through the CLI entry path",
    capturedAt: "2026-03-18T08:59:03.959Z",
  });

  const promotedInput = JSON.parse(
    await fs.readFile(path.join(corpusPath, "cases", "issue-534-reproducing", "input", "snapshot.json"), "utf8"),
  );
  assert.equal(promotedInput.local.record.workspace, ".");
  assert.equal(promotedInput.local.record.journal_path, ".codex-supervisor/issue-journal.md");
  assert.equal(promotedInput.local.record.local_review_summary_path, null);
  assert.equal(promotedInput.local.workspaceStatus.hasUncommittedChanges, false);

  const replayResult = runCli(["replay-corpus", corpusPath, "--config", configPath]);
  assert.equal(replayResult.status, 0);
  assert.match(replayResult.stdout, /Replay corpus summary: total=2 passed=2 failed=0/);
});

test("replay-corpus-promote suggests deterministic case ids when no case id is provided", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "replay-corpus-cli-suggest-"));
  const configPath = path.join(tempDir, "supervisor.config.json");
  const snapshotPath = path.join(tempDir, "captured-snapshot.json");

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
  await fs.writeFile(snapshotPath, JSON.stringify({
    schemaVersion: 1,
    capturedAt: "2026-03-19T00:00:00Z",
    issue: {
      number: 557,
      title: "Replay corpus promotion: suggest normalized case ids during promotion",
      url: "https://example.test/issues/557",
      state: "OPEN",
      updatedAt: "2026-03-19T00:00:00Z",
    },
    local: {
      record: {
        issue_number: 557,
        state: "planning",
        branch: "codex/issue-557",
        pr_number: null,
        workspace: path.join(tempDir, "workspaces", "issue-557"),
        journal_path: path.join(tempDir, "workspaces", "issue-557", ".codex-supervisor", "issue-journal.md"),
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
        last_head_sha: "head-557",
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
        updated_at: "2026-03-19T00:00:00Z",
      },
      workspaceStatus: {
        branch: "codex/issue-557",
        headSha: "head-557",
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

  const result = runCli([
    "replay-corpus-promote",
    snapshotPath,
    "--config",
    configPath,
  ]);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /The replay-corpus-promote command requires an explicit case id to write a new case\./);
  assert.match(result.stderr, /Suggested case ids:/);
  assert.match(result.stderr, /- issue-557-reproducing/);
  assert.match(result.stderr, /- issue-557-replay-corpus-promotion-suggest-normalized-case/);
});

test("replay-corpus-promote surfaces advisory promotion-worthiness hints for high-value snapshots", () => {
  const hintedResult = runCli([
    "replay-corpus-promote",
    path.join(process.cwd(), "replay-corpus", "cases", "stale-head-prevents-merge", "input", "snapshot.json"),
  ]);

  assert.equal(hintedResult.status, 1);
  assert.match(hintedResult.stderr, /Promotion hints:/);
  assert.match(hintedResult.stderr, /- stale-head-safety: tracked head differs from the current PR head/);

  const nonHintedResult = runCli([
    "replay-corpus-promote",
    path.join(process.cwd(), "replay-corpus", "cases", "required-check-pending", "input", "snapshot.json"),
  ]);

  assert.equal(nonHintedResult.status, 1);
  assert.doesNotMatch(nonHintedResult.stderr, /Promotion hints:/);
});

test("replay-corpus-promote keeps the missing-case-id guidance when snapshot suggestions cannot be derived", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "replay-corpus-cli-suggest-malformed-"));
  const snapshotPath = path.join(tempDir, "captured-snapshot.json");

  await fs.writeFile(snapshotPath, JSON.stringify({
    schemaVersion: 1,
    capturedAt: "2026-03-19T00:00:00Z",
    issue: {
      number: 557,
      title: "Replay corpus promotion: suggest normalized case ids during promotion",
      url: "https://example.test/issues/557",
      state: "OPEN",
      updatedAt: "2026-03-19T00:00:00Z",
    },
    local: {
      record: {
        issue_number: 557,
        state: "planning",
        branch: "codex/issue-557",
        pr_number: null,
        workspace: path.join(tempDir, "workspaces", "issue-557"),
        journal_path: path.join(tempDir, "workspaces", "issue-557", ".codex-supervisor", "issue-journal.md"),
        attempt_count: 0,
        implementation_attempt_count: 0,
        repair_attempt_count: 0,
        updated_at: "2026-03-19T00:00:00Z",
      },
      workspaceStatus: {
        branch: "codex/issue-557",
        headSha: "head-557",
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
  }));

  const result = runCli([
    "replay-corpus-promote",
    snapshotPath,
  ]);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /Unable to derive case-id suggestions from the snapshot\. Provide an explicit case id\./);
  assert.match(result.stderr, /The replay-corpus-promote command requires an explicit case id to write a new case\./);
  assert.doesNotMatch(result.stderr, /Suggested case ids:/);
});

test("replay-corpus prints a compact all-pass summary", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "replay-corpus-cli-pass-"));
  const configPath = path.join(tempDir, "supervisor.config.json");
  const corpusPath = path.join(tempDir, "replay-corpus");

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
  await fs.mkdir(path.join(corpusPath, "cases", "repro", "input"), { recursive: true });
  await fs.mkdir(path.join(corpusPath, "cases", "repro", "expected"), { recursive: true });
  await fs.writeFile(path.join(corpusPath, "manifest.json"), JSON.stringify({
    schemaVersion: 1,
    cases: [{ id: "repro", path: "cases/repro" }],
  }));
  await fs.writeFile(path.join(corpusPath, "cases", "repro", "case.json"), JSON.stringify({
    schemaVersion: 1,
    id: "repro",
    issueNumber: 408,
    title: "Replay debugging snapshot",
    capturedAt: "2026-03-16T10:07:00Z",
  }));
  await fs.writeFile(path.join(corpusPath, "cases", "repro", "input", "snapshot.json"), JSON.stringify({
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
  await fs.writeFile(path.join(corpusPath, "cases", "repro", "expected", "replay-result.json"), JSON.stringify({
    nextState: "reproducing",
    shouldRunCodex: true,
    blockedReason: null,
    failureSignature: null,
  }));

  const result = runCli(["replay-corpus", corpusPath, "--config", configPath]);

  assert.equal(result.status, 0);
  assert.equal(result.stderr, "");
  assert.match(result.stdout, /Replay corpus summary: total=1 passed=1 failed=0/);
  assert.doesNotMatch(result.stdout, /Mismatch:/);
});

test("replay-corpus prints one compact normalized mismatch line per failing case", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "replay-corpus-cli-fail-"));
  const configPath = path.join(tempDir, "supervisor.config.json");
  const corpusPath = path.join(tempDir, "replay-corpus");

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
  await fs.mkdir(path.join(corpusPath, "cases", "review-blocked", "input"), { recursive: true });
  await fs.mkdir(path.join(corpusPath, "cases", "review-blocked", "expected"), { recursive: true });
  await fs.writeFile(path.join(corpusPath, "manifest.json"), JSON.stringify({
    schemaVersion: 1,
    cases: [{ id: "review-blocked", path: "cases/review-blocked" }],
  }));
  await fs.writeFile(path.join(corpusPath, "cases", "review-blocked", "case.json"), JSON.stringify({
    schemaVersion: 1,
    id: "review-blocked",
    issueNumber: 532,
    title: "Replay corpus example",
    capturedAt: "2026-03-16T10:07:00Z",
  }));
  await fs.writeFile(path.join(corpusPath, "cases", "review-blocked", "input", "snapshot.json"), JSON.stringify({
    schemaVersion: 1,
    capturedAt: "2026-03-16T10:07:00Z",
    issue: {
      number: 532,
      title: "Replay corpus example",
      url: "https://example.test/issues/532",
      state: "OPEN",
      updatedAt: "2026-03-16T10:05:00Z",
    },
    local: {
      record: {
        issue_number: 532,
        state: "addressing_review",
        branch: "codex/issue-532",
        pr_number: 90,
        workspace: path.join(tempDir, "workspaces", "issue-532"),
        journal_path: path.join(tempDir, "workspaces", "issue-532", ".codex-supervisor", "issue-journal.md"),
        review_wait_started_at: "2026-03-16T10:00:00Z",
        review_wait_head_sha: "head-532",
        copilot_review_requested_observed_at: null,
        copilot_review_requested_head_sha: null,
        copilot_review_timed_out_at: null,
        copilot_review_timeout_action: null,
        copilot_review_timeout_reason: null,
        local_review_head_sha: "head-532",
        local_review_blocker_summary: "High severity finding still open.",
        local_review_summary_path: path.join(tempDir, "reviews", "summary.md"),
        local_review_run_at: "2026-03-16T10:03:00Z",
        local_review_max_severity: "high",
        local_review_findings_count: 1,
        local_review_root_cause_count: 1,
        local_review_verified_max_severity: "high",
        local_review_verified_findings_count: 1,
        local_review_recommendation: "changes_requested",
        local_review_degraded: false,
        last_local_review_signature: "local-review:high",
        repeated_local_review_signature_count: 1,
        attempt_count: 3,
        implementation_attempt_count: 2,
        repair_attempt_count: 1,
        timeout_retry_count: 0,
        blocked_verification_retry_count: 0,
        repeated_blocker_count: 0,
        repeated_failure_signature_count: 0,
        last_head_sha: "head-532",
        last_error: "Review still pending.",
        last_failure_kind: null,
        last_failure_context: null,
        last_blocker_signature: null,
        last_failure_signature: "review-pending",
        blocked_reason: null,
        processed_review_thread_ids: ["thread-1@head-532"],
        processed_review_thread_fingerprints: ["thread-1@head-532#comment-1"],
        updated_at: "2026-03-16T10:05:00Z",
      },
      workspaceStatus: {
        branch: "codex/issue-532",
        headSha: "head-532",
        hasUncommittedChanges: false,
        baseAhead: 1,
        baseBehind: 0,
        remoteBranchExists: true,
        remoteAhead: 0,
        remoteBehind: 0,
      },
    },
    github: {
      pullRequest: {
        number: 90,
        title: "Replay corpus example",
        url: "https://example.test/pull/90",
        state: "OPEN",
        createdAt: "2026-03-16T09:15:00Z",
        updatedAt: "2026-03-16T10:06:00Z",
        isDraft: false,
        reviewDecision: "CHANGES_REQUESTED",
        mergeStateStatus: "CLEAN",
        mergeable: "MERGEABLE",
        headRefName: "codex/issue-532",
        headRefOid: "head-532",
        configuredBotTopLevelReviewStrength: "blocking",
        mergedAt: null,
      },
      checks: [{ name: "build", state: "completed", bucket: "pass" }],
      reviewThreads: [{
        id: "thread-1",
        isResolved: false,
        isOutdated: false,
        path: "src/supervisor.ts",
        line: 42,
        comments: {
          nodes: [{
            id: "comment-1",
            body: "Please address this blocking issue.",
            createdAt: "2026-03-16T10:04:00Z",
            url: "https://example.test/pull/90#discussion_r1",
            author: {
              login: "copilot-pull-request-reviewer",
              typeName: "Bot",
            },
          }],
        },
      }],
    },
    decision: {
      nextState: "blocked",
      shouldRunCodex: false,
      blockedReason: "manual_review",
      failureContext: {
        category: "review",
        summary: "Configured review thread remains unresolved.",
        signature: "stalled-bot:thread-1",
        command: null,
        details: ["thread-1"],
        url: "https://example.test/pull/90#discussion_r1",
        updated_at: "2026-03-16T10:04:00Z",
      },
    },
  }));
  await fs.writeFile(path.join(corpusPath, "cases", "review-blocked", "expected", "replay-result.json"), JSON.stringify({
    nextState: "ready_to_merge",
    shouldRunCodex: true,
    blockedReason: null,
    failureSignature: null,
  }));

  const result = runCli(["replay-corpus", corpusPath, "--config", configPath]);

  assert.equal(result.status, 1);
  assert.match(result.stdout, /Replay corpus summary: total=1 passed=0 failed=1/);
  assert.match(
    result.stdout,
    /Mismatch: review-blocked \(issue #532\) expected\(nextState=ready_to_merge, shouldRunCodex=true, blockedReason=none, failureSignature=none\) actual\(nextState=blocked, shouldRunCodex=false, blockedReason=manual_review, failureSignature=stalled-bot:thread-1\)/,
  );
});
