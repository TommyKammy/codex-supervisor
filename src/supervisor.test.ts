import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  Supervisor,
  buildChecksFailureContext,
  formatDetailedStatus,
  localReviewHighSeverityNeedsRetry,
  nextExternalReviewMissPatch,
  inferStateFromPullRequest,
  reconcileRecoverableBlockedIssueStates,
  recoverUnexpectedCodexTurnFailure,
  shouldAutoRetryHandoffMissing,
  summarizeChecks,
} from "./supervisor";
import { GitHubIssue, GitHubPullRequest, IssueRunRecord, PullRequestCheck, ReviewThread, SupervisorConfig, SupervisorStateFile } from "./types";

function createConfig(overrides: Partial<SupervisorConfig> = {}): SupervisorConfig {
  return {
    repoPath: "/tmp/repo",
    repoSlug: "owner/repo",
    defaultBranch: "main",
    workspaceRoot: "/tmp/workspaces",
    stateBackend: "json",
    stateFile: "/tmp/state.json",
    codexBinary: "/usr/bin/codex",
    codexModelStrategy: "inherit",
    codexReasoningEffortByState: {},
    codexReasoningEscalateOnRepeatedFailure: true,
    sharedMemoryFiles: [],
    gsdEnabled: false,
    gsdAutoInstall: false,
    gsdInstallScope: "global",
    gsdPlanningFiles: [],
    localReviewEnabled: false,
    localReviewAutoDetect: true,
    localReviewRoles: [],
    localReviewArtifactDir: "/tmp/reviews",
    localReviewConfidenceThreshold: 0.7,
    localReviewReviewerThresholds: {
      generic: {
        confidenceThreshold: 0.7,
        minimumSeverity: "low",
      },
      specialist: {
        confidenceThreshold: 0.7,
        minimumSeverity: "low",
      },
    },
    localReviewPolicy: "block_ready",
    localReviewHighSeverityAction: "retry",
    reviewBotLogins: [],
    humanReviewBlocksMerge: true,
    issueJournalRelativePath: ".codex-supervisor/issue-journal.md",
    issueJournalMaxChars: 6000,
    skipTitlePrefixes: [],
    branchPrefix: "codex/reopen-issue-",
    pollIntervalSeconds: 60,
    copilotReviewWaitMinutes: 10,
    copilotReviewTimeoutAction: "continue",
    codexExecTimeoutMinutes: 30,
    maxCodexAttemptsPerIssue: 5,
    maxImplementationAttemptsPerIssue: 5,
    maxRepairAttemptsPerIssue: 5,
    timeoutRetryLimit: 2,
    blockedVerificationRetryLimit: 3,
    sameBlockerRepeatLimit: 2,
    sameFailureSignatureRepeatLimit: 3,
    maxDoneWorkspaces: 24,
    cleanupDoneWorkspacesAfterHours: 24,
    mergeMethod: "squash",
    draftPrAfterAttempt: 1,
    ...overrides,
  };
}

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
    updated_at: "2026-03-11T01:50:41.997Z",
    ...overrides,
  };
}

function executionReadyBody(summary: string): string {
  return `## Summary
${summary}

## Scope
- keep the test fixture execution-ready

## Acceptance criteria
- supervisor treats this issue as runnable

## Verification
- npm test -- src/supervisor.test.ts`;
}

function withStubbedDateNow<T>(nowIso: string, run: () => T): T {
  const originalDateNow = Date.now;
  Date.now = () => Date.parse(nowIso);
  try {
    return run();
  } finally {
    Date.now = originalDateNow;
  }
}

function git(args: string[], cwd?: string): string {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: "Codex",
      GIT_AUTHOR_EMAIL: "codex@example.com",
      GIT_COMMITTER_NAME: "Codex",
      GIT_COMMITTER_EMAIL: "codex@example.com",
    },
  }).trim();
}

async function createSupervisorFixture(options: {
  codexScriptLines?: string[];
} = {}): Promise<{
  config: SupervisorConfig;
  repoPath: string;
  stateFile: string;
  workspaceRoot: string;
}> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "codex-supervisor-issue-87-"));
  const remotePath = path.join(root, "remote.git");
  const seedPath = path.join(root, "seed");
  const repoPath = path.join(root, "repo");
  const workspaceRoot = path.join(root, "workspaces");
  const stateFile = path.join(root, "state.json");
  const codexBinary = path.join(root, "fake-codex.sh");

  git(["init", "--bare", remotePath]);
  await fs.mkdir(seedPath, { recursive: true });
  git(["init", "-b", "main"], seedPath);
  await fs.writeFile(path.join(seedPath, "README.md"), "# fixture\n", "utf8");
  git(["add", "README.md"], seedPath);
  git(["commit", "-m", "seed"], seedPath);
  git(["remote", "add", "origin", remotePath], seedPath);
  git(["push", "-u", "origin", "main"], seedPath);
  git(["symbolic-ref", "HEAD", "refs/heads/main"], remotePath);
  git(["clone", remotePath, repoPath]);
  git(["-C", repoPath, "branch", "--set-upstream-to=origin/main", "main"]);

  const codexScriptLines = options.codexScriptLines ?? [
    "#!/bin/sh",
    "set -eu",
    'out=""',
    'while [ "$#" -gt 0 ]; do',
    '  case "$1" in',
    '    -o) out="$2"; shift 2 ;;',
    '    *) shift ;;',
    '  esac',
    "done",
    'printf \'{"type":"thread.started","thread_id":"thread-123"}\\n\'',
    "cat <<'EOF' > \"$out\"",
    "Summary: created a dirty checkpoint",
    "State hint: stabilizing",
    "Blocked reason: none",
    "Tests: not run",
    "Failure signature: none",
    "Next action: inspect the dirty worktree and finish recovery",
    "EOF",
    "printf '\\n- Scratchpad note: codex wrote a dirty change for reproduction.\\n' >> .codex-supervisor/issue-journal.md",
    "printf 'dirty change\\n' >> dirty.txt",
    "exit 0",
    "",
  ];
  await fs.writeFile(codexBinary, codexScriptLines.join("\n"), "utf8");
  await fs.chmod(codexBinary, 0o755);

  return {
    repoPath,
    stateFile,
    workspaceRoot,
    config: createConfig({
      repoPath,
      workspaceRoot,
      stateFile,
      codexBinary,
      issueJournalMaxChars: 12000,
    }),
  };
}

test("shouldAutoRetryHandoffMissing only retries recoverable blocked handoffs", () => {
  const config = createConfig({
    maxImplementationAttemptsPerIssue: 3,
    maxRepairAttemptsPerIssue: 9,
  });

  assert.equal(shouldAutoRetryHandoffMissing(createRecord(), config), true);
  assert.equal(
    shouldAutoRetryHandoffMissing(
      createRecord({
        attempt_count: 8,
        implementation_attempt_count: 2,
        repair_attempt_count: 6,
      }),
      config,
    ),
    true,
  );
  assert.equal(shouldAutoRetryHandoffMissing(createRecord({ pr_number: 12 }), config), false);
  assert.equal(
    shouldAutoRetryHandoffMissing(
      createRecord({ repeated_failure_signature_count: config.sameFailureSignatureRepeatLimit }),
      config,
    ),
    false,
  );
  assert.equal(
    shouldAutoRetryHandoffMissing(
      createRecord({
        attempt_count: config.maxImplementationAttemptsPerIssue + 6,
        implementation_attempt_count: config.maxImplementationAttemptsPerIssue,
        repair_attempt_count: 6,
      }),
      config,
    ),
    false,
  );
});

test("reconcileRecoverableBlockedIssueStates requeues open handoff-missing issues without dropping repeat tracking", async () => {
  const config = createConfig();
  const original = createRecord();
  const state: SupervisorStateFile = {
    activeIssueNumber: null,
    issues: {
      "366": original,
    },
  };
  const issues: GitHubIssue[] = [
    {
      number: 366,
      title: "P3: Add regression coverage",
      body: "",
      createdAt: "2026-03-10T23:25:21Z",
      updatedAt: "2026-03-10T23:25:21Z",
      url: "https://example.test/issues/366",
      state: "OPEN",
    },
  ];

  let saveCalls = 0;
  const stateStore = {
    touch(record: IssueRunRecord, patch: Partial<IssueRunRecord>): IssueRunRecord {
      return {
        ...record,
        ...patch,
        updated_at: "2026-03-11T06:33:08.821Z",
      };
    },
    async save(): Promise<void> {
      saveCalls += 1;
    },
  };

  await reconcileRecoverableBlockedIssueStates(stateStore, state, config, issues);

  const updated = state.issues["366"];
  assert.equal(updated.state, "queued");
  assert.equal(updated.blocked_reason, null);
  assert.equal(updated.last_error, null);
  assert.equal(updated.codex_session_id, null);
  assert.equal(updated.last_failure_signature, "handoff-missing");
  assert.equal(
    updated.last_failure_context?.summary ?? null,
    "Codex completed without updating the issue journal for issue #366.",
  );
  assert.equal(updated.repeated_failure_signature_count, 1);
  assert.equal(saveCalls, 1);
});

test("reconcileRecoverableBlockedIssueStates leaves closed issues blocked", async () => {
  const config = createConfig();
  const original = createRecord();
  const state: SupervisorStateFile = {
    activeIssueNumber: null,
    issues: {
      "366": original,
    },
  };
  const issues: GitHubIssue[] = [
    {
      number: 366,
      title: "P3: Add regression coverage",
      body: "",
      createdAt: "2026-03-10T23:25:21Z",
      updatedAt: "2026-03-10T23:25:21Z",
      url: "https://example.test/issues/366",
      state: "CLOSED",
    },
  ];

  let saveCalls = 0;
  const stateStore = {
    touch(record: IssueRunRecord): IssueRunRecord {
      return record;
    },
    async save(): Promise<void> {
      saveCalls += 1;
    },
  };

  await reconcileRecoverableBlockedIssueStates(stateStore, state, config, issues);

  assert.deepEqual(state.issues["366"], original);
  assert.equal(saveCalls, 0);
});

test("reconcileRecoverableBlockedIssueStates requeues requirements-blocked issues once metadata is execution-ready", async () => {
  const config = createConfig();
  const original = createRecord({
    state: "blocked",
    blocked_reason: "requirements",
    last_error: "Missing required execution-ready metadata: scope, acceptance criteria, verification.",
    last_failure_kind: null,
    last_failure_context: {
      category: "blocked",
      summary: "Issue #366 is not execution-ready because it is missing: scope, acceptance criteria, verification.",
      signature: "requirements:scope|acceptance criteria|verification",
      command: null,
      details: [
        "missing_required=scope, acceptance criteria, verification",
        "missing_recommended=depends on, execution order",
      ],
      url: "https://example.test/issues/366",
      updated_at: "2026-03-11T01:50:41.997Z",
    },
    last_failure_signature: "requirements:scope|acceptance criteria|verification",
    repeated_failure_signature_count: 2,
  });
  const state: SupervisorStateFile = {
    activeIssueNumber: null,
    issues: {
      "366": original,
    },
  };
  const issues: GitHubIssue[] = [
    {
      number: 366,
      title: "P3: Add regression coverage",
      body: executionReadyBody("Add regression coverage."),
      createdAt: "2026-03-10T23:25:21Z",
      updatedAt: "2026-03-10T23:25:21Z",
      url: "https://example.test/issues/366",
      state: "OPEN",
    },
  ];

  let saveCalls = 0;
  const stateStore = {
    touch(record: IssueRunRecord, patch: Partial<IssueRunRecord>): IssueRunRecord {
      return {
        ...record,
        ...patch,
        updated_at: "2026-03-11T06:33:08.821Z",
      };
    },
    async save(): Promise<void> {
      saveCalls += 1;
    },
  };

  const recoveryEvents = await reconcileRecoverableBlockedIssueStates(stateStore, state, config, issues);

  const updated = state.issues["366"];
  assert.equal(updated.state, "queued");
  assert.equal(updated.blocked_reason, null);
  assert.equal(updated.last_error, null);
  assert.equal(updated.last_failure_context, null);
  assert.equal(updated.last_failure_signature, null);
  assert.equal(updated.repeated_failure_signature_count, 0);
  assert.equal(updated.last_recovery_reason, "requirements_recovered: requeued issue #366 after execution-ready metadata was added");
  assert.ok(updated.last_recovery_at);
  assert.equal(saveCalls, 1);
  assert.deepEqual(recoveryEvents.map((event) => event.reason), [
    "requirements_recovered: requeued issue #366 after execution-ready metadata was added",
  ]);
});

test("runOnce recovers when post-codex refresh throws after leaving a dirty worktree", async () => {
  const fixture = await createSupervisorFixture();
  const issueNumber = 87;
  const branch = branchName(fixture.config, issueNumber);
  const state: SupervisorStateFile = {
    activeIssueNumber: issueNumber,
    issues: {
      [String(issueNumber)]: createRecord({
        issue_number: issueNumber,
        state: "stabilizing",
        branch,
        workspace: path.join(fixture.workspaceRoot, `issue-${issueNumber}`),
        journal_path: null,
        attempt_count: 1,
        implementation_attempt_count: 1,
        repair_attempt_count: 0,
        last_error: null,
        last_failure_kind: null,
        last_failure_context: null,
        last_failure_signature: null,
        repeated_failure_signature_count: 0,
        blocked_reason: null,
      }),
    },
  };
  await fs.writeFile(fixture.stateFile, `${JSON.stringify(state, null, 2)}\n`, "utf8");

  const issue: GitHubIssue = {
    number: issueNumber,
    title: "Reproduce dirty worktree recovery",
    body: executionReadyBody("Reproduce dirty worktree recovery."),
    createdAt: "2026-03-13T00:00:00Z",
    updatedAt: "2026-03-13T00:00:00Z",
    url: `https://example.test/issues/${issueNumber}`,
    state: "OPEN",
  };

  let resolveCalls = 0;
  const supervisor = new Supervisor(fixture.config);
  (supervisor as unknown as { github: Record<string, unknown> }).github = {
    authStatus: async () => ({ ok: true, message: null }),
    listAllIssues: async () => [issue],
    listCandidateIssues: async () => [issue],
    getIssue: async () => issue,
    resolvePullRequestForBranch: async () => {
      resolveCalls += 1;
      if (resolveCalls === 1) {
        return null;
      }
      throw new Error("post-turn refresh blew up");
    },
    getChecks: async () => [],
    getUnresolvedReviewThreads: async () => [],
    getPullRequestIfExists: async () => null,
    getMergedPullRequestsClosingIssue: async () => [],
    closeIssue: async () => {
      throw new Error("unexpected closeIssue call");
    },
  };

  const message = await supervisor.runOnce({ dryRun: false });
  assert.match(message, /Recovered from unexpected Codex turn failure/);

  const persisted = JSON.parse(await fs.readFile(fixture.stateFile, "utf8")) as SupervisorStateFile;
  const record = persisted.issues[String(issueNumber)];
  assert.equal(persisted.activeIssueNumber, null);
  assert.equal(record.state, "failed");
  assert.equal(record.last_failure_kind, "command_error");
  assert.match(record.last_error ?? "", /post-turn refresh blew up/);
  assert.equal(record.codex_session_id, "thread-123");
  assert.match(record.last_codex_summary ?? "", /created a dirty checkpoint/);
  assert.equal(record.blocked_reason, null);
  assert.match(record.last_failure_context?.summary ?? "", /Supervisor failed while recovering a Codex turn/);
  assert.deepEqual(record.last_failure_context?.details.slice(0, 4), [
    "previous_state=stabilizing",
    "workspace_dirty=yes",
    `workspace_head=${record.last_head_sha}`,
    "pr_number=none",
  ]);

  const worktreeStatus = git(["-C", path.join(fixture.workspaceRoot, `issue-${issueNumber}`), "status", "--short"]);
  assert.match(worktreeStatus, /dirty\.txt/);

  const issueLockPath = path.join(path.dirname(fixture.stateFile), "locks", "issues", `issue-${issueNumber}.lock`);
  await assert.rejects(fs.access(issueLockPath));
});

test("runOnce records timeout bookkeeping when Codex exits non-zero", async () => {
  const fixture = await createSupervisorFixture({
    codexScriptLines: [
      "#!/bin/sh",
      "set -eu",
      'out=""',
      'while [ "$#" -gt 0 ]; do',
      '  case "$1" in',
      '    -o) out="$2"; shift 2 ;;',
      '    *) shift ;;',
      '  esac',
      "done",
      'printf \'{"type":"thread.started","thread_id":"thread-timeout"}\\n\'',
      "cat <<'EOF' > \"$out\"",
      "Summary: timed out while running focused verification",
      "State hint: stabilizing",
      "Blocked reason: none",
      "Tests: npm test -- --grep timeout",
      "Failure signature: none",
      "Next action: retry the timed out verification command",
      "EOF",
      "printf 'Command timed out after 1800000ms: codex exec\\n' >&2",
      "exit 1",
      "",
    ],
  });
  const issueNumber = 89;
  const branch = branchName(fixture.config, issueNumber);
  const state: SupervisorStateFile = {
    activeIssueNumber: issueNumber,
    issues: {
      [String(issueNumber)]: createRecord({
        issue_number: issueNumber,
        state: "stabilizing",
        branch,
        workspace: path.join(fixture.workspaceRoot, `issue-${issueNumber}`),
        journal_path: null,
        codex_session_id: null,
        timeout_retry_count: 0,
        blocked_reason: null,
        last_error: null,
        last_failure_kind: null,
        last_failure_context: null,
        last_failure_signature: null,
        repeated_failure_signature_count: 0,
      }),
    },
  };
  await fs.writeFile(fixture.stateFile, `${JSON.stringify(state, null, 2)}\n`, "utf8");

  const issue: GitHubIssue = {
    number: issueNumber,
    title: "Capture timeout failure bookkeeping",
    body: "",
    createdAt: "2026-03-13T00:00:00Z",
    updatedAt: "2026-03-13T00:00:00Z",
    url: `https://example.test/issues/${issueNumber}`,
    state: "OPEN",
  };

  const supervisor = new Supervisor(fixture.config);
  (supervisor as unknown as { github: Record<string, unknown> }).github = {
    authStatus: async () => ({ ok: true, message: null }),
    listAllIssues: async () => [issue],
    listCandidateIssues: async () => [issue],
    getIssue: async () => issue,
    resolvePullRequestForBranch: async () => null,
    getChecks: async () => [],
    getUnresolvedReviewThreads: async () => [],
    getPullRequestIfExists: async () => null,
    getMergedPullRequestsClosingIssue: async () => [],
    closeIssue: async () => {
      throw new Error("unexpected closeIssue call");
    },
    createPullRequest: async () => {
      throw new Error("unexpected createPullRequest call");
    },
  };

  const message = await supervisor.runOnce({ dryRun: false });
  assert.match(message, /Codex turn failed for issue #89\./);

  const persisted = JSON.parse(await fs.readFile(fixture.stateFile, "utf8")) as SupervisorStateFile;
  const record = persisted.issues[String(issueNumber)];
  assert.equal(persisted.activeIssueNumber, issueNumber);
  assert.equal(record.state, "failed");
  assert.equal(record.last_failure_kind, "timeout");
  assert.equal(record.timeout_retry_count, 1);
  assert.equal(record.codex_session_id, "thread-timeout");
  assert.equal(record.blocked_reason, null);
  assert.match(record.last_error ?? "", /Command timed out after 1800000ms: codex exec/);
  assert.match(record.last_failure_context?.summary ?? "", /Codex exited non-zero for issue #89/);
  assert.match(record.last_failure_context?.details[0] ?? "", /Command timed out after 1800000ms: codex exec/);
});

test("recoverUnexpectedCodexTurnFailure preserves dirty recovery context and timeout bookkeeping", async () => {
  const issueNumber = 88;
  const record = createRecord({
    issue_number: issueNumber,
    state: "stabilizing",
    timeout_retry_count: 1,
    codex_session_id: "thread-456",
    last_head_sha: "abc1234",
  });
  const state: SupervisorStateFile = {
    activeIssueNumber: issueNumber,
    issues: {
      [String(issueNumber)]: record,
    },
  };
  let saveCalls = 0;
  let syncedRecord: IssueRunRecord | null = null;
  const stateStore = {
    touch(current: IssueRunRecord, patch: Partial<IssueRunRecord>): IssueRunRecord {
      return { ...current, ...patch, updated_at: "2026-03-13T00:00:00.000Z" };
    },
    async save(): Promise<void> {
      saveCalls += 1;
    },
  };

  const updated = await recoverUnexpectedCodexTurnFailure({
    stateStore: stateStore as unknown as Parameters<typeof recoverUnexpectedCodexTurnFailure>[0]["stateStore"],
    state,
    record,
    issue: {
      number: issueNumber,
      title: "Timeout while recovering dirty worktree",
      body: "",
      createdAt: "2026-03-13T00:00:00Z",
      updatedAt: "2026-03-13T00:00:00Z",
      url: `https://example.test/issues/${issueNumber}`,
      state: "OPEN",
    },
    journalSync: async (nextRecord) => {
      syncedRecord = nextRecord;
    },
    error: new Error("Command timed out after 1800000ms: codex exec resume thread-456"),
    workspaceStatus: {
      hasUncommittedChanges: true,
      headSha: "deadbee",
    },
    pr: {
      number: 55,
      headRefOid: "feed123",
    },
  });

  assert.equal(saveCalls, 1);
  assert.equal(state.activeIssueNumber, null);
  assert.equal(updated.state, "failed");
  assert.equal(updated.last_failure_kind, "timeout");
  assert.equal(updated.timeout_retry_count, 2);
  assert.equal(updated.blocked_reason, null);
  assert.match(updated.last_error ?? "", /Command timed out after 1800000ms/);
  assert.match(updated.last_failure_context?.summary ?? "", /Supervisor failed while recovering a Codex turn/);
  assert.deepEqual(updated.last_failure_context?.details.slice(0, 6), [
    "previous_state=stabilizing",
    "workspace_dirty=yes",
    "workspace_head=deadbee",
    "pr_number=55",
    "pr_head=feed123",
    "codex_session_id=thread-456",
  ]);
  assert.equal(state.issues[String(issueNumber)], updated);
  assert.equal(syncedRecord, updated);
});

test("runOnce dry-run selects an issue and hydrates workspace and PR context before Codex", async () => {
  const fixture = await createSupervisorFixture();
  const issueNumber = 91;
  const branch = branchName(fixture.config, issueNumber);
  const state: SupervisorStateFile = {
    activeIssueNumber: null,
    issues: {},
  };
  await fs.writeFile(fixture.stateFile, `${JSON.stringify(state, null, 2)}\n`, "utf8");

  const issue: GitHubIssue = {
    number: issueNumber,
    title: "Extract supervisor setup helpers",
    body: executionReadyBody("Extract supervisor setup helpers."),
    createdAt: "2026-03-13T00:00:00Z",
    updatedAt: "2026-03-13T00:00:00Z",
    url: `https://example.test/issues/${issueNumber}`,
    state: "OPEN",
  };
  const pr: GitHubPullRequest = {
    number: 112,
    title: "Draft setup refactor",
    url: "https://example.test/pr/112",
    state: "OPEN",
    createdAt: "2026-03-13T00:10:00Z",
    isDraft: true,
    reviewDecision: null,
    mergeStateStatus: "CLEAN",
    mergeable: "MERGEABLE",
    headRefName: branch,
    headRefOid: "head-112",
    mergedAt: null,
  };
  const checks: PullRequestCheck[] = [];
  const reviewThreads: ReviewThread[] = [];

  let resolveCalls = 0;
  let checksCalls = 0;
  let reviewThreadCalls = 0;
  const supervisor = new Supervisor(fixture.config);
  (supervisor as unknown as { github: Record<string, unknown> }).github = {
    authStatus: async () => ({ ok: true, message: null }),
    listAllIssues: async () => [issue],
    listCandidateIssues: async () => [issue],
    getIssue: async () => issue,
    resolvePullRequestForBranch: async (branchName: string, prNumber: number | null) => {
      resolveCalls += 1;
      assert.equal(branchName, branch);
      assert.equal(prNumber, null);
      return pr;
    },
    getChecks: async (prNumber: number) => {
      checksCalls += 1;
      assert.equal(prNumber, pr.number);
      return checks;
    },
    getUnresolvedReviewThreads: async (prNumber: number) => {
      reviewThreadCalls += 1;
      assert.equal(prNumber, pr.number);
      return reviewThreads;
    },
    getPullRequestIfExists: async () => null,
    getMergedPullRequestsClosingIssue: async () => [],
    closeIssue: async () => {
      throw new Error("unexpected closeIssue call");
    },
    createPullRequest: async () => {
      throw new Error("unexpected createPullRequest call");
    },
  };

  const message = await supervisor.runOnce({ dryRun: true });
  assert.match(message, /Dry run: would invoke Codex for issue #91\./);
  assert.match(message, /state=draft_pr/);

  const persisted = JSON.parse(await fs.readFile(fixture.stateFile, "utf8")) as SupervisorStateFile;
  const record = persisted.issues[String(issueNumber)];
  assert.equal(persisted.activeIssueNumber, issueNumber);
  assert.equal(record.issue_number, issueNumber);
  assert.equal(record.branch, branch);
  assert.equal(record.pr_number, pr.number);
  assert.equal(record.state, "draft_pr");
  assert.equal(record.blocked_reason, null);
  assert.equal(record.workspace, path.join(fixture.workspaceRoot, `issue-${issueNumber}`));
  assert.equal(record.journal_path, path.join(record.workspace, ".codex-supervisor", "issue-journal.md"));
  assert.ok(record.last_head_sha);
  await fs.access(record.workspace);
  await fs.access(record.journal_path ?? "");
  assert.equal(resolveCalls, 1);
  assert.equal(checksCalls, 1);
  assert.equal(reviewThreadCalls, 1);
});

test("runOnce returns no matching issue when no runnable candidate is available", async () => {
  const fixture = await createSupervisorFixture();
  const state: SupervisorStateFile = {
    activeIssueNumber: null,
    issues: {},
  };
  await fs.writeFile(fixture.stateFile, `${JSON.stringify(state, null, 2)}\n`, "utf8");

  const supervisor = new Supervisor(fixture.config);
  (supervisor as unknown as { github: Record<string, unknown> }).github = {
    authStatus: async () => ({ ok: true, message: null }),
    listAllIssues: async () => [],
    listCandidateIssues: async () => [],
    getIssue: async () => {
      throw new Error("unexpected getIssue call");
    },
    resolvePullRequestForBranch: async () => {
      throw new Error("unexpected resolvePullRequestForBranch call");
    },
    getChecks: async () => [],
    getUnresolvedReviewThreads: async () => [],
    getPullRequestIfExists: async () => null,
    getMergedPullRequestsClosingIssue: async () => [],
    closeIssue: async () => {
      throw new Error("unexpected closeIssue call");
    },
    createPullRequest: async () => {
      throw new Error("unexpected createPullRequest call");
    },
  };

  const message = await supervisor.runOnce({ dryRun: true });
  assert.equal(message, "No matching open issue found.");

  const persisted = JSON.parse(await fs.readFile(fixture.stateFile, "utf8")) as SupervisorStateFile;
  assert.equal(persisted.activeIssueNumber, null);
  assert.deepEqual(persisted.issues, {});
});

test("runOnce moves a non-ready issue into blocked(requirements) with missing requirements", async () => {
  const fixture = await createSupervisorFixture();
  const issueNumber = 91;
  const state: SupervisorStateFile = {
    activeIssueNumber: null,
    issues: {},
  };
  await fs.writeFile(fixture.stateFile, `${JSON.stringify(state, null, 2)}\n`, "utf8");

  const issue: GitHubIssue = {
    number: issueNumber,
    title: "Underspecified issue",
    body: `## Summary
Add execution-ready gating.`,
    createdAt: "2026-03-13T00:00:00Z",
    updatedAt: "2026-03-13T00:00:00Z",
    url: `https://example.test/issues/${issueNumber}`,
    state: "OPEN",
  };

  const supervisor = new Supervisor(fixture.config);
  (supervisor as unknown as { github: Record<string, unknown> }).github = {
    authStatus: async () => ({ ok: true, message: null }),
    listAllIssues: async () => [issue],
    listCandidateIssues: async () => [issue],
    getIssue: async () => issue,
    resolvePullRequestForBranch: async () => null,
    getChecks: async () => [],
    getUnresolvedReviewThreads: async () => [],
    getPullRequestIfExists: async () => null,
    getMergedPullRequestsClosingIssue: async () => [],
    closeIssue: async () => {
      throw new Error("unexpected closeIssue call");
    },
    createPullRequest: async () => {
      throw new Error("unexpected createPullRequest call");
    },
  };

  const message = await supervisor.runOnce({ dryRun: true });
  assert.equal(message, "No matching open issue found.");

  const persisted = JSON.parse(await fs.readFile(fixture.stateFile, "utf8")) as SupervisorStateFile;
  const record = persisted.issues[String(issueNumber)];
  assert.equal(persisted.activeIssueNumber, null);
  assert.equal(record.state, "blocked");
  assert.equal(record.blocked_reason, "requirements");
  assert.match(
    record.last_error ?? "",
    /missing required execution-ready metadata: scope, acceptance criteria, verification/i,
  );
  assert.equal(record.last_failure_context?.category, "blocked");
  assert.match(
    record.last_failure_context?.summary ?? "",
    /issue #91 is not execution-ready because it is missing: scope, acceptance criteria, verification/i,
  );
  assert.deepEqual(record.last_failure_context?.details ?? [], [
    "missing_required=scope, acceptance criteria, verification",
    "missing_recommended=depends on, execution order",
  ]);
});

test("runOnce proceeds with concrete risky issues when no blocking ambiguity is present", async () => {
  const fixture = await createSupervisorFixture();
  const issueNumber = 94;
  const state: SupervisorStateFile = {
    activeIssueNumber: null,
    issues: {},
  };
  await fs.writeFile(fixture.stateFile, `${JSON.stringify(state, null, 2)}\n`, "utf8");

  const issue: GitHubIssue = {
    number: issueNumber,
    title: "Rotate production auth tokens",
    body: `## Summary
Rotate the production auth token flow for service-to-service requests.

## Scope
- update auth token issuance for production services
- keep rollout audit-friendly

## Acceptance criteria
- production authentication changes are fully implemented

## Verification
- npm test -- src/supervisor.test.ts`,
    createdAt: "2026-03-13T00:00:00Z",
    updatedAt: "2026-03-13T00:00:00Z",
    url: `https://example.test/issues/${issueNumber}`,
    state: "OPEN",
  };

  const supervisor = new Supervisor(fixture.config);
  (supervisor as unknown as { github: Record<string, unknown> }).github = {
    authStatus: async () => ({ ok: true, message: null }),
    listAllIssues: async () => [issue],
    listCandidateIssues: async () => [issue],
    getIssue: async () => issue,
    resolvePullRequestForBranch: async () => null,
    getChecks: async () => [],
    getUnresolvedReviewThreads: async () => [],
    getPullRequestIfExists: async () => null,
    getMergedPullRequestsClosingIssue: async () => [],
    closeIssue: async () => {
      throw new Error("unexpected closeIssue call");
    },
    createPullRequest: async () => {
      throw new Error("unexpected createPullRequest call");
    },
  };

  const message = await supervisor.runOnce({ dryRun: true });
  assert.match(message, /Dry run: would invoke Codex for issue #94\./);

  const persisted = JSON.parse(await fs.readFile(fixture.stateFile, "utf8")) as SupervisorStateFile;
  const record = persisted.issues[String(issueNumber)];
  assert.equal(persisted.activeIssueNumber, issueNumber);
  assert.equal(record.state, "reproducing");
  assert.equal(record.blocked_reason, null);
  assert.equal(record.last_failure_context, null);
});

test("runOnce blocks only explicit high-risk blocking ambiguity", async () => {
  const fixture = await createSupervisorFixture();
  const issueNumber = 95;
  const state: SupervisorStateFile = {
    activeIssueNumber: null,
    issues: {},
  };
  await fs.writeFile(fixture.stateFile, `${JSON.stringify(state, null, 2)}\n`, "utf8");

  const issue: GitHubIssue = {
    number: issueNumber,
    title: "Decide which production auth token flow to keep",
    body: `## Summary
Decide whether to keep the current production auth token flow or replace it before rollout.

## Scope
- choose the production authentication path for service-to-service traffic
- keep rollout audit-friendly

## Acceptance criteria
- the operator confirms which auth flow should ship

## Verification
- npm test -- src/supervisor.test.ts`,
    createdAt: "2026-03-13T00:00:00Z",
    updatedAt: "2026-03-13T00:00:00Z",
    url: `https://example.test/issues/${issueNumber}`,
    state: "OPEN",
  };

  const supervisor = new Supervisor(fixture.config);
  (supervisor as unknown as { github: Record<string, unknown> }).github = {
    authStatus: async () => ({ ok: true, message: null }),
    listAllIssues: async () => [issue],
    listCandidateIssues: async () => [issue],
    getIssue: async () => issue,
    resolvePullRequestForBranch: async () => null,
    getChecks: async () => [],
    getUnresolvedReviewThreads: async () => [],
    getPullRequestIfExists: async () => null,
    getMergedPullRequestsClosingIssue: async () => [],
    closeIssue: async () => {
      throw new Error("unexpected closeIssue call");
    },
    createPullRequest: async () => {
      throw new Error("unexpected createPullRequest call");
    },
  };

  const message = await supervisor.runOnce({ dryRun: true });
  assert.equal(message, "No matching open issue found.");

  const persisted = JSON.parse(await fs.readFile(fixture.stateFile, "utf8")) as SupervisorStateFile;
  const record = persisted.issues[String(issueNumber)];
  assert.equal(persisted.activeIssueNumber, null);
  assert.equal(record.state, "blocked");
  assert.equal(record.blocked_reason, "clarification");
  assert.match(record.last_error ?? "", /manual clarification/i);
  assert.match(record.last_error ?? "", /unresolved_choice/);
  assert.match(record.last_failure_context?.summary ?? "", /requires manual clarification/i);
  assert.deepEqual(record.last_failure_context?.details ?? [], [
    "ambiguity_classes=unresolved_choice",
    "risky_change_classes=auth",
  ]);
  const journal = await fs.readFile(record.journal_path ?? "", "utf8");
  assert.match(journal, /requires manual clarification because high-risk blocking ambiguity/i);
  assert.match(journal, /ambiguity_classes=unresolved_choice/i);
});

test("status shows readiness reasons for runnable, requirements-blocked, and clarification-blocked issues", async () => {
  const fixture = await createSupervisorFixture();
  const state: SupervisorStateFile = {
    activeIssueNumber: null,
    issues: {
      "91": createRecord({
        issue_number: 91,
        state: "done",
        branch: branchName(fixture.config, 91),
        workspace: path.join(fixture.workspaceRoot, "issue-91"),
        journal_path: null,
        blocked_reason: null,
        last_error: null,
      }),
    },
  };
  await fs.writeFile(fixture.stateFile, `${JSON.stringify(state, null, 2)}\n`, "utf8");

  const runnableIssue: GitHubIssue = {
    number: 92,
    title: "Step 2",
    body: `## Summary
Ship the second step.

## Scope
- build on the completed dependency

## Acceptance criteria
- supervisor can explain why this issue is runnable

## Verification
- npm test -- src/supervisor.test.ts

Depends on: #91`,
    createdAt: "2026-03-13T00:05:00Z",
    updatedAt: "2026-03-13T00:05:00Z",
    url: "https://example.test/issues/92",
    state: "OPEN",
  };
  const missingMetadataIssue: GitHubIssue = {
    number: 93,
    title: "Underspecified issue",
    body: `## Summary
Missing execution-ready metadata.`,
    createdAt: "2026-03-13T00:10:00Z",
    updatedAt: "2026-03-13T00:10:00Z",
    url: "https://example.test/issues/93",
    state: "OPEN",
  };
  const clarificationBlockedIssue: GitHubIssue = {
    number: 94,
    title: "Decide which auth path to keep",
    body: `## Summary
Decide whether to keep the current production auth token flow or replace it before rollout.

## Scope
- choose the production authentication path for service-to-service traffic

## Acceptance criteria
- the operator confirms which auth flow should ship

## Verification
- npm test -- src/supervisor.test.ts`,
    createdAt: "2026-03-13T00:15:00Z",
    updatedAt: "2026-03-13T00:15:00Z",
    url: "https://example.test/issues/94",
    state: "OPEN",
  };

  const supervisor = new Supervisor(fixture.config);
  (supervisor as unknown as { github: Record<string, unknown> }).github = {
    listCandidateIssues: async () => [runnableIssue, missingMetadataIssue, clarificationBlockedIssue],
    getPullRequestIfExists: async () => null,
    getChecks: async () => [],
    getUnresolvedReviewThreads: async () => [],
  };

  const status = await supervisor.status();

  assert.match(status, /runnable_issues=#92 ready=execution_ready\+depends_on_satisfied:91/);
  assert.match(
    status,
    /blocked_issues=#93 blocked_by=requirements:scope, acceptance criteria, verification; #94 blocked_by=clarification:unresolved_choice:auth/,
  );
});

test("status marks skipped readiness checks explicitly and uses non-conflicting inner separators", async () => {
  const fixture = await createSupervisorFixture();
  const state: SupervisorStateFile = {
    activeIssueNumber: null,
    issues: {
      "91": createRecord({
        issue_number: 91,
        state: "done",
        branch: branchName(fixture.config, 91),
        workspace: path.join(fixture.workspaceRoot, "issue-91"),
        journal_path: null,
        blocked_reason: null,
        last_error: null,
      }),
      "92": createRecord({
        issue_number: 92,
        state: "done",
        branch: branchName(fixture.config, 92),
        workspace: path.join(fixture.workspaceRoot, "issue-92"),
        journal_path: null,
        blocked_reason: null,
        last_error: null,
      }),
      "93": createRecord({
        issue_number: 93,
        state: "queued",
        branch: branchName(fixture.config, 93),
        workspace: path.join(fixture.workspaceRoot, "issue-93"),
        journal_path: null,
        blocked_reason: null,
        last_error: null,
        attempt_count: 1,
        implementation_attempt_count: 1,
      }),
    },
  };
  await fs.writeFile(fixture.stateFile, `${JSON.stringify(state, null, 2)}\n`, "utf8");

  const predecessorOne: GitHubIssue = {
    number: 91,
    title: "Step 1",
    body: `## Summary
Finish step 1.

## Scope
- start the execution order chain

## Acceptance criteria
- step 1 completes first

## Verification
- npm test -- src/supervisor.test.ts

Part of: #150
Execution order: 1 of 3`,
    createdAt: "2026-03-13T00:00:00Z",
    updatedAt: "2026-03-13T00:00:00Z",
    url: "https://example.test/issues/91",
    state: "CLOSED",
  };
  const predecessorTwo: GitHubIssue = {
    number: 92,
    title: "Step 2",
    body: `## Summary
Finish step 2.

## Scope
- land after step 1

## Acceptance criteria
- step 2 completes after step 1

## Verification
- npm test -- src/supervisor.test.ts

Part of: #150
Execution order: 2 of 3`,
    createdAt: "2026-03-13T00:05:00Z",
    updatedAt: "2026-03-13T00:05:00Z",
    url: "https://example.test/issues/92",
    state: "CLOSED",
  };
  const skippedRequirementsIssue: GitHubIssue = {
    number: 93,
    title: "Step 3",
    body: `## Summary
Existing in-flight issue with missing readiness metadata.

Depends on: #91, #92
Part of: #150
Execution order: 3 of 3`,
    createdAt: "2026-03-13T00:10:00Z",
    updatedAt: "2026-03-13T00:10:00Z",
    url: "https://example.test/issues/93",
    state: "OPEN",
  };

  const supervisor = new Supervisor(fixture.config);
  (supervisor as unknown as { github: Record<string, unknown> }).github = {
    listCandidateIssues: async () => [predecessorOne, predecessorTwo, skippedRequirementsIssue],
    getPullRequestIfExists: async () => null,
    getChecks: async () => [],
    getUnresolvedReviewThreads: async () => [],
  };

  const status = await supervisor.status();

  assert.match(
    status,
    /runnable_issues=#93 ready=requirements_skipped\+depends_on_satisfied:91\|92\+execution_order_satisfied:91\|92/,
  );
});

test("status includes a compact handoff summary for an active blocker", async () => {
  const fixture = await createSupervisorFixture();
  const journalPath = path.join(fixture.workspaceRoot, "issue-92", ".codex-supervisor", "issue-journal.md");
  await fs.mkdir(path.dirname(journalPath), { recursive: true });
  await fs.writeFile(
    journalPath,
    `# Issue #92: Step 2

## Supervisor Snapshot
- Updated at: 2026-03-13T00:20:00Z

## Latest Codex Summary
- None yet.

## Active Failure Context
- None recorded.

## Codex Working Notes
### Current Handoff
- Hypothesis: The status output should summarize the live handoff.
- What changed: Added structured journal fields.
- Current blocker: Waiting on the status formatter to show the blocker and next step.
- Next exact step: Render a compact handoff summary in status output.
- Verification gap: Focused supervisor status test still missing.
- Files touched: src/journal.ts, src/supervisor.ts
- Rollback concern:
- Last focused command: npm test -- --test-name-pattern handoff

### Scratchpad
- Keep this section short.
`,
    "utf8",
  );

  const activeRecord = createRecord({
    issue_number: 92,
    state: "reproducing",
    branch: branchName(fixture.config, 92),
    workspace: path.join(fixture.workspaceRoot, "issue-92"),
    journal_path: journalPath,
    blocked_reason: "verification",
    last_error: null,
  });
  const state: SupervisorStateFile = {
    activeIssueNumber: 92,
    issues: {
      "92": activeRecord,
    },
  };
  await fs.writeFile(fixture.stateFile, `${JSON.stringify(state, null, 2)}\n`, "utf8");

  const supervisor = new Supervisor(fixture.config);
  (supervisor as unknown as { github: Record<string, unknown> }).github = {
    resolvePullRequestForBranch: async () => null,
    getChecks: async () => [],
    getUnresolvedReviewThreads: async () => [],
  };

  const status = await supervisor.status();

  assert.match(
    status,
    /handoff_summary=blocker: Waiting on the status formatter to show the blocker and next step\. \| next: Render a compact handoff summary in status output\./,
  );
});

test("status shows durable guardrail provenance for active committed and runtime guidance", async () => {
  const fixture = await createSupervisorFixture();
  fixture.config.localReviewArtifactDir = path.join(path.dirname(fixture.stateFile), "reviews");

  const issueNumber = 92;
  const branch = branchName(fixture.config, issueNumber);
  git(["checkout", "-b", branch], fixture.repoPath);
  await fs.mkdir(path.join(fixture.repoPath, "src"), { recursive: true });
  await fs.writeFile(
    path.join(fixture.repoPath, "src", "auth.ts"),
    "export function canUpdateRecord(): boolean {\n  return true;\n}\n",
    "utf8",
  );
  git(["add", "src/auth.ts"], fixture.repoPath);
  git(["commit", "-m", "Add auth change"], fixture.repoPath);
  const headSha = git(["rev-parse", "HEAD"], fixture.repoPath);

  await fs.mkdir(path.join(fixture.repoPath, "docs", "shared-memory"), { recursive: true });
  await fs.writeFile(
    path.join(fixture.repoPath, "docs", "shared-memory", "verifier-guardrails.json"),
    `${JSON.stringify({
      version: 1,
      rules: [
        {
          id: "auth-direct-guard",
          title: "Re-check auth guard changes directly",
          file: "src/auth.ts",
          line: 1,
          summary: "Auth guard changes must be re-read directly before dismissing high-severity findings.",
          rationale: "A prior verifier miss cleared an auth fallback without inspecting the guard path itself.",
        },
      ],
    }, null, 2)}\n`,
    "utf8",
  );
  await fs.writeFile(
    path.join(fixture.repoPath, "docs", "shared-memory", "external-review-guardrails.json"),
    `${JSON.stringify({
      version: 1,
      patterns: [
        {
          fingerprint: "committed-auth-guard",
          reviewerLogin: "copilot-pull-request-reviewer",
          file: "src/auth.ts",
          line: 1,
          summary: "Permission checks in auth flows deserve an explicit local-review pass.",
          rationale: "A committed external review miss showed auth guard regressions were previously skipped.",
          sourceArtifactPath: "owner-repo/issue-12/external-review-misses-head-aaaabbbbcccc.json",
          sourceHeadSha: "aaaabbbbccccdddd",
          lastSeenAt: "2026-03-10T00:00:00Z",
        },
      ],
    }, null, 2)}\n`,
    "utf8",
  );

  const artifactDir = path.join(fixture.config.localReviewArtifactDir, "owner-repo", `issue-${issueNumber}`);
  await fs.mkdir(artifactDir, { recursive: true });
  await fs.writeFile(
    path.join(artifactDir, "external-review-misses-head-111122223333.json"),
    `${JSON.stringify({
      issueNumber,
      prNumber: 44,
      branch,
      headSha: "1111222233334444",
      generatedAt: "2026-03-12T00:00:00Z",
      findings: [],
      reusableMissPatterns: [
        {
          fingerprint: "runtime-auth-guard",
          reviewerLogin: "copilot-pull-request-reviewer",
          file: "src/auth.ts",
          line: 2,
          summary: "Runtime artifact keeps auth fallback blind spots active until local review covers them.",
          rationale: "A recent external review still found the fallback path unreviewed locally.",
          sourceArtifactPath: path.join(artifactDir, "external-review-misses-head-111122223333.json"),
          sourceHeadSha: "1111222233334444",
          lastSeenAt: "2026-03-12T00:00:00Z",
        },
      ],
      durableGuardrailCandidates: [],
      regressionTestCandidates: [],
      counts: {
        matched: 0,
        nearMatch: 0,
        missedByLocalReview: 1,
      },
    }, null, 2)}\n`,
    "utf8",
  );

  const activeRecord = createRecord({
    issue_number: issueNumber,
    state: "reproducing",
    branch,
    workspace: fixture.repoPath,
    journal_path: null,
    blocked_reason: null,
    last_error: null,
  });
  const state: SupervisorStateFile = {
    activeIssueNumber: issueNumber,
    issues: {
      [String(issueNumber)]: activeRecord,
    },
  };
  await fs.writeFile(fixture.stateFile, `${JSON.stringify(state, null, 2)}\n`, "utf8");

  const supervisor = new Supervisor(fixture.config);
  (supervisor as unknown as { github: Record<string, unknown> }).github = {
    resolvePullRequestForBranch: async () => ({
      number: 44,
      title: "Auth guard",
      url: "https://example.test/pr/44",
      state: "OPEN",
      createdAt: "2026-03-13T00:00:00Z",
      isDraft: true,
      reviewDecision: null,
      mergeStateStatus: "CLEAN",
      mergeable: "MERGEABLE",
      headRefName: branch,
      headRefOid: headSha,
      mergedAt: null,
    }),
    getChecks: async () => [],
    getUnresolvedReviewThreads: async () => [],
  };

  const status = await supervisor.status();

  assert.match(
    status,
    /durable_guardrails verifier=committed:docs\/shared-memory\/verifier-guardrails\.json#1 external_review=committed:docs\/shared-memory\/external-review-guardrails\.json#1\|runtime:owner-repo\/issue-92\/external-review-misses-head-111122223333\.json#1/,
  );
});

test("status guardrail provenance reflects the merged active external-review winners", async () => {
  const fixture = await createSupervisorFixture();
  fixture.config.localReviewArtifactDir = path.join(path.dirname(fixture.stateFile), "reviews");

  const issueNumber = 92;
  const branch = branchName(fixture.config, issueNumber);
  git(["checkout", "-b", branch], fixture.repoPath);
  await fs.mkdir(path.join(fixture.repoPath, "src"), { recursive: true });
  await fs.writeFile(
    path.join(fixture.repoPath, "src", "auth.ts"),
    "export function canUpdateRecord(): boolean {\n  return true;\n}\n",
    "utf8",
  );
  git(["add", "src/auth.ts"], fixture.repoPath);
  git(["commit", "-m", "Add auth change"], fixture.repoPath);
  const headSha = git(["rev-parse", "HEAD"], fixture.repoPath);

  await fs.mkdir(path.join(fixture.repoPath, "docs", "shared-memory"), { recursive: true });
  await fs.writeFile(
    path.join(fixture.repoPath, "docs", "shared-memory", "external-review-guardrails.json"),
    `${JSON.stringify({
      version: 1,
      patterns: [
        {
          fingerprint: "shared-auth-guard",
          reviewerLogin: "copilot-pull-request-reviewer",
          file: "src/auth.ts",
          line: 1,
          summary: "Committed auth guard guidance.",
          rationale: "Older committed guidance for the same auth blind spot.",
          sourceArtifactPath: "owner-repo/issue-12/external-review-misses-head-aaaabbbbcccc.json",
          sourceHeadSha: "aaaabbbbccccdddd",
          lastSeenAt: "2026-03-10T00:00:00Z",
        },
      ],
    }, null, 2)}\n`,
    "utf8",
  );

  const artifactDir = path.join(fixture.config.localReviewArtifactDir, "owner-repo", `issue-${issueNumber}`);
  await fs.mkdir(artifactDir, { recursive: true });
  await fs.writeFile(
    path.join(artifactDir, "external-review-misses-head-111122223333.json"),
    `${JSON.stringify({
      issueNumber,
      prNumber: 44,
      branch,
      headSha: "1111222233334444",
      generatedAt: "2026-03-12T00:00:00Z",
      findings: [],
      reusableMissPatterns: [
        {
          fingerprint: "shared-auth-guard",
          reviewerLogin: "copilot-pull-request-reviewer",
          file: "src/auth.ts",
          line: 2,
          summary: "Runtime auth guard guidance.",
          rationale: "Newer runtime guidance for the same auth blind spot should win.",
          sourceArtifactPath: path.join(artifactDir, "external-review-misses-head-111122223333.json"),
          sourceHeadSha: "1111222233334444",
          lastSeenAt: "2026-03-12T00:00:00Z",
        },
      ],
      durableGuardrailCandidates: [],
      regressionTestCandidates: [],
      counts: {
        matched: 0,
        nearMatch: 0,
        missedByLocalReview: 1,
      },
    }, null, 2)}\n`,
    "utf8",
  );

  const activeRecord = createRecord({
    issue_number: issueNumber,
    state: "addressing_review",
    branch,
    workspace: fixture.repoPath,
    journal_path: null,
    blocked_reason: null,
    last_error: null,
  });
  const state: SupervisorStateFile = {
    activeIssueNumber: issueNumber,
    issues: {
      [String(issueNumber)]: activeRecord,
    },
  };
  await fs.writeFile(fixture.stateFile, `${JSON.stringify(state, null, 2)}\n`, "utf8");

  const supervisor = new Supervisor(fixture.config);
  (supervisor as unknown as { github: Record<string, unknown> }).github = {
    resolvePullRequestForBranch: async () => ({
      number: 44,
      title: "Auth guard",
      url: "https://example.test/pr/44",
      state: "OPEN",
      createdAt: "2026-03-13T00:00:00Z",
      isDraft: false,
      reviewDecision: null,
      mergeStateStatus: "CLEAN",
      mergeable: "MERGEABLE",
      headRefName: branch,
      headRefOid: headSha,
      mergedAt: null,
    }),
    getChecks: async () => [],
    getUnresolvedReviewThreads: async () => [],
  };

  const status = await supervisor.status();

  assert.match(
    status,
    /durable_guardrails verifier=none external_review=runtime:owner-repo\/issue-92\/external-review-misses-head-111122223333\.json#1/,
  );
  assert.doesNotMatch(status, /external_review=committed:/);
});

test("status omits durable guardrail warnings when the workspace diff cannot be read", async () => {
  const fixture = await createSupervisorFixture();
  const issueNumber = 92;
  const activeRecord = createRecord({
    issue_number: issueNumber,
    state: "addressing_review",
    branch: branchName(fixture.config, issueNumber),
    workspace: path.join(fixture.workspaceRoot, "missing-workspace"),
    journal_path: null,
    blocked_reason: null,
    last_error: null,
  });
  const state: SupervisorStateFile = {
    activeIssueNumber: issueNumber,
    issues: {
      [String(issueNumber)]: activeRecord,
    },
  };
  await fs.writeFile(fixture.stateFile, `${JSON.stringify(state, null, 2)}\n`, "utf8");

  const supervisor = new Supervisor(fixture.config);
  (supervisor as unknown as { github: Record<string, unknown> }).github = {
    resolvePullRequestForBranch: async () => null,
    getChecks: async () => [],
    getUnresolvedReviewThreads: async () => [],
  };

  const status = await supervisor.status();

  assert.doesNotMatch(status, /durable_guardrails /);
  assert.doesNotMatch(status, /status_warning=/);
});

test("status omits handoff summary when the handoff has no actionable blocker or next step", async () => {
  const fixture = await createSupervisorFixture();
  const journalPath = path.join(fixture.workspaceRoot, "issue-92", ".codex-supervisor", "issue-journal.md");
  await fs.mkdir(path.dirname(journalPath), { recursive: true });
  await fs.writeFile(
    journalPath,
    `# Issue #92: Step 2

## Supervisor Snapshot
- Updated at: 2026-03-13T00:20:00Z

## Latest Codex Summary
- None yet.

## Active Failure Context
- None recorded.

## Codex Working Notes
### Current Handoff
- Hypothesis:
- What changed: Added structured journal fields.
- Current blocker: None.
- Next exact step:
- Verification gap: None.
- Files touched: src/journal.ts
- Rollback concern:
- Last focused command: npm test -- --test-name-pattern handoff

### Scratchpad
- Keep this section short.
`,
    "utf8",
  );

  const activeRecord = createRecord({
    issue_number: 92,
    state: "implementing",
    branch: branchName(fixture.config, 92),
    workspace: path.join(fixture.workspaceRoot, "issue-92"),
    journal_path: journalPath,
    blocked_reason: null,
    last_error: null,
  });
  const state: SupervisorStateFile = {
    activeIssueNumber: 92,
    issues: {
      "92": activeRecord,
    },
  };
  await fs.writeFile(fixture.stateFile, `${JSON.stringify(state, null, 2)}\n`, "utf8");

  const supervisor = new Supervisor(fixture.config);
  (supervisor as unknown as { github: Record<string, unknown> }).github = {
    resolvePullRequestForBranch: async () => null,
    getChecks: async () => [],
    getUnresolvedReviewThreads: async () => [],
  };

  const status = await supervisor.status();

  assert.doesNotMatch(status, /handoff_summary=/);
});

test("runOnce still prefers a ready issue over dependency-blocked candidates", async () => {
  const fixture = await createSupervisorFixture();
  const dependencyIssueNumber = 91;
  const blockedIssueNumber = 92;
  const readyIssueNumber = 93;
  const readyBranch = branchName(fixture.config, readyIssueNumber);
  const state: SupervisorStateFile = {
    activeIssueNumber: null,
    issues: {
      [String(dependencyIssueNumber)]: createRecord({
        issue_number: dependencyIssueNumber,
        state: "failed",
        branch: branchName(fixture.config, dependencyIssueNumber),
        workspace: path.join(fixture.workspaceRoot, `issue-${dependencyIssueNumber}`),
        journal_path: null,
        blocked_reason: null,
        last_failure_kind: "command_error",
        last_error: "previous failure",
      }),
    },
  };
  await fs.writeFile(fixture.stateFile, `${JSON.stringify(state, null, 2)}\n`, "utf8");

  const dependencyIssue: GitHubIssue = {
    number: dependencyIssueNumber,
    title: "Step 1",
    body: `## Summary
Do the first step.

## Scope
- implement the dependency

## Acceptance criteria
- dependency lands first

## Verification
- npm test -- src/supervisor.test.ts

Part of: #150
Execution order: 1 of 2`,
    createdAt: "2026-03-13T00:00:00Z",
    updatedAt: "2026-03-13T00:00:00Z",
    url: `https://example.test/issues/${dependencyIssueNumber}`,
    state: "OPEN",
  };
  const dependencyBlockedIssue: GitHubIssue = {
    number: blockedIssueNumber,
    title: "Step 2",
    body: `## Summary
Do the second step.

## Scope
- wait for the first step

## Acceptance criteria
- execution order respected

## Verification
- npm test -- src/supervisor.test.ts

Part of: #150
Execution order: 2 of 2`,
    createdAt: "2026-03-13T00:05:00Z",
    updatedAt: "2026-03-13T00:05:00Z",
    url: `https://example.test/issues/${blockedIssueNumber}`,
    state: "OPEN",
  };
  const readyIssue: GitHubIssue = {
    number: readyIssueNumber,
    title: "Independent ready issue",
    body: `## Summary
Ship the ready issue.

## Scope
- implement the ready issue

## Acceptance criteria
- dry run selects this issue

## Verification
- npm test -- src/supervisor.test.ts`,
    createdAt: "2026-03-13T00:10:00Z",
    updatedAt: "2026-03-13T00:10:00Z",
    url: `https://example.test/issues/${readyIssueNumber}`,
    state: "OPEN",
  };

  const supervisor = new Supervisor(fixture.config);
  (supervisor as unknown as { github: Record<string, unknown> }).github = {
    authStatus: async () => ({ ok: true, message: null }),
    listAllIssues: async () => [dependencyIssue, dependencyBlockedIssue, readyIssue],
    listCandidateIssues: async () => [dependencyIssue, dependencyBlockedIssue, readyIssue],
    getIssue: async (issueNumber: number) => {
      assert.equal(issueNumber, readyIssueNumber);
      return readyIssue;
    },
    resolvePullRequestForBranch: async (branchName: string, prNumber: number | null) => {
      assert.equal(branchName, readyBranch);
      assert.equal(prNumber, null);
      return null;
    },
    getChecks: async () => [],
    getUnresolvedReviewThreads: async () => [],
    getPullRequestIfExists: async () => null,
    getMergedPullRequestsClosingIssue: async () => [],
    closeIssue: async () => {
      throw new Error("unexpected closeIssue call");
    },
    createPullRequest: async () => {
      throw new Error("unexpected createPullRequest call");
    },
  };

  const message = await supervisor.runOnce({ dryRun: true });
  assert.match(message, /Dry run: would invoke Codex for issue #93\./);

  const persisted = JSON.parse(await fs.readFile(fixture.stateFile, "utf8")) as SupervisorStateFile;
  assert.equal(persisted.activeIssueNumber, readyIssueNumber);
  assert.equal(persisted.issues[String(readyIssueNumber)]?.branch, readyBranch);
  assert.equal(persisted.issues[String(blockedIssueNumber)], undefined);
  assert.equal(persisted.issues[String(dependencyIssueNumber)]?.state, "failed");
});

test("runOnce releases the current issue lock before restarting after a merged PR", async () => {
  const fixture = await createSupervisorFixture();
  const mergedIssueNumber = 91;
  const nextIssueNumber = 92;
  const mergedBranch = branchName(fixture.config, mergedIssueNumber);
  const nextBranch = branchName(fixture.config, nextIssueNumber);
  const mergedIssueLockPath = path.join(
    path.dirname(fixture.stateFile),
    "locks",
    "issues",
    `issue-${mergedIssueNumber}.lock`,
  );
  const state: SupervisorStateFile = {
    activeIssueNumber: mergedIssueNumber,
    issues: {
      [String(mergedIssueNumber)]: createRecord({
        issue_number: mergedIssueNumber,
        state: "pr_open",
        branch: mergedBranch,
        workspace: path.join(fixture.workspaceRoot, `issue-${mergedIssueNumber}`),
        journal_path: null,
        pr_number: 191,
        blocked_reason: null,
      }),
    },
  };
  await fs.writeFile(fixture.stateFile, `${JSON.stringify(state, null, 2)}\n`, "utf8");

  const mergedIssue: GitHubIssue = {
    number: mergedIssueNumber,
    title: "Merged PR issue",
    body: executionReadyBody("Merged PR issue."),
    createdAt: "2026-03-13T00:00:00Z",
    updatedAt: "2026-03-13T00:00:00Z",
    url: `https://example.test/issues/${mergedIssueNumber}`,
    state: "OPEN",
  };
  const nextIssue: GitHubIssue = {
    number: nextIssueNumber,
    title: "Next runnable issue",
    body: executionReadyBody("Next runnable issue."),
    createdAt: "2026-03-13T00:05:00Z",
    updatedAt: "2026-03-13T00:05:00Z",
    url: `https://example.test/issues/${nextIssueNumber}`,
    state: "OPEN",
  };
  const mergedPr: GitHubPullRequest = {
    number: 191,
    title: "Merged implementation",
    url: "https://example.test/pr/191",
    state: "MERGED",
    createdAt: "2026-03-13T00:10:00Z",
    isDraft: false,
    reviewDecision: null,
    mergeStateStatus: "CLEAN",
    mergeable: "MERGEABLE",
    headRefName: mergedBranch,
    headRefOid: "merged-head-191",
    mergedAt: "2026-03-13T00:20:00Z",
  };

  let listAllIssuesCalls = 0;
  const supervisor = new Supervisor(fixture.config);
  (supervisor as unknown as { github: Record<string, unknown> }).github = {
    authStatus: async () => ({ ok: true, message: null }),
    listAllIssues: async () => {
      listAllIssuesCalls += 1;
      if (listAllIssuesCalls === 2) {
        await assert.rejects(fs.access(mergedIssueLockPath));
      }
      return [mergedIssue, nextIssue];
    },
    listCandidateIssues: async () => [mergedIssue, nextIssue],
    getIssue: async (issueNumber: number) => (issueNumber === mergedIssueNumber ? mergedIssue : nextIssue),
    resolvePullRequestForBranch: async (branchName: string, prNumber: number | null) => {
      if (branchName === mergedBranch) {
        assert.equal(prNumber, 191);
        return mergedPr;
      }
      assert.equal(branchName, nextBranch);
      assert.equal(prNumber, null);
      return null;
    },
    getChecks: async () => [],
    getUnresolvedReviewThreads: async () => [],
    getPullRequestIfExists: async () => null,
    getMergedPullRequestsClosingIssue: async () => [],
    closeIssue: async () => {
      throw new Error("unexpected closeIssue call");
    },
    createPullRequest: async () => {
      throw new Error("unexpected createPullRequest call");
    },
  };

  const message = await supervisor.runOnce({ dryRun: true });
  assert.match(
    message,
    /recovery issue=#91 reason=merged_pr_convergence: tracked PR #191 merged; marked issue #91 done/,
  );
  assert.match(message, new RegExp(`Dry run: would invoke Codex for issue #${nextIssueNumber}\\.`));

  const persisted = JSON.parse(await fs.readFile(fixture.stateFile, "utf8")) as SupervisorStateFile;
  assert.equal(persisted.activeIssueNumber, nextIssueNumber);
  assert.equal(persisted.issues[String(mergedIssueNumber)]?.state, "done");
  assert.equal(persisted.issues[String(mergedIssueNumber)]?.pr_number, 191);
  assert.equal(persisted.issues[String(mergedIssueNumber)]?.last_head_sha, "merged-head-191");
  assert.equal(persisted.issues[String(nextIssueNumber)]?.branch, nextBranch);
  assert.equal(listAllIssuesCalls, 2);
});

test("runOnce clears a stale active issue reservation before selecting the next runnable issue", async () => {
  const fixture = await createSupervisorFixture();
  const staleIssueNumber = 91;
  const nextIssueNumber = 92;
  const staleBranch = branchName(fixture.config, staleIssueNumber);
  const nextBranch = branchName(fixture.config, nextIssueNumber);
  const state: SupervisorStateFile = {
    activeIssueNumber: staleIssueNumber,
    issues: {
      [String(staleIssueNumber)]: createRecord({
        issue_number: staleIssueNumber,
        state: "implementing",
        branch: staleBranch,
        workspace: path.join(fixture.workspaceRoot, `issue-${staleIssueNumber}`),
        journal_path: null,
        pr_number: null,
        codex_session_id: "stale-session",
        blocked_reason: null,
      }),
    },
  };
  await fs.writeFile(fixture.stateFile, `${JSON.stringify(state, null, 2)}\n`, "utf8");

  const staleIssue: GitHubIssue = {
    number: staleIssueNumber,
    title: "Previously active issue",
    body: executionReadyBody("Previously active issue."),
    createdAt: "2026-03-13T00:00:00Z",
    updatedAt: "2026-03-13T00:00:00Z",
    url: `https://example.test/issues/${staleIssueNumber}`,
    state: "OPEN",
  };
  const nextIssue: GitHubIssue = {
    number: nextIssueNumber,
    title: "Higher-priority runnable issue",
    body: executionReadyBody("Higher-priority runnable issue."),
    createdAt: "2026-03-13T00:05:00Z",
    updatedAt: "2026-03-13T00:05:00Z",
    url: `https://example.test/issues/${nextIssueNumber}`,
    state: "OPEN",
  };

  const supervisor = new Supervisor(fixture.config);
  (supervisor as unknown as { github: Record<string, unknown> }).github = {
    authStatus: async () => ({ ok: true, message: null }),
    listAllIssues: async () => [nextIssue, staleIssue],
    listCandidateIssues: async () => [nextIssue, staleIssue],
    getIssue: async (issueNumber: number) => (issueNumber === nextIssueNumber ? nextIssue : staleIssue),
    resolvePullRequestForBranch: async (branchName: string, prNumber: number | null) => {
      assert.equal(branchName, nextBranch);
      assert.equal(prNumber, null);
      return null;
    },
    getChecks: async () => [],
    getUnresolvedReviewThreads: async () => [],
    getPullRequestIfExists: async () => null,
    getMergedPullRequestsClosingIssue: async () => [],
    closeIssue: async () => {
      throw new Error("unexpected closeIssue call");
    },
    createPullRequest: async () => {
      throw new Error("unexpected createPullRequest call");
    },
  };

  const message = await supervisor.runOnce({ dryRun: true });
  assert.match(
    message,
    /recovery issue=#91 reason=stale_state_cleanup: cleared stale active reservation after issue lock and session lock were missing/,
  );
  assert.match(message, /Dry run: would invoke Codex for issue #92\./);

  const persisted = JSON.parse(await fs.readFile(fixture.stateFile, "utf8")) as SupervisorStateFile;
  assert.equal(persisted.activeIssueNumber, nextIssueNumber);
  assert.equal(persisted.issues[String(staleIssueNumber)]?.state, "implementing");
  assert.equal(persisted.issues[String(staleIssueNumber)]?.codex_session_id, null);
  assert.equal(persisted.issues[String(nextIssueNumber)]?.branch, nextBranch);
});

test("runOnce preserves a live active issue reservation when its issue lock is still owned", async () => {
  const fixture = await createSupervisorFixture();
  const issueNumber = 91;
  const branch = branchName(fixture.config, issueNumber);
  const lockPath = path.join(path.dirname(fixture.stateFile), "locks", "issues", `issue-${issueNumber}.lock`);
  const state: SupervisorStateFile = {
    activeIssueNumber: issueNumber,
    issues: {
      [String(issueNumber)]: createRecord({
        issue_number: issueNumber,
        state: "implementing",
        branch,
        workspace: path.join(fixture.workspaceRoot, `issue-${issueNumber}`),
        journal_path: null,
        pr_number: null,
        codex_session_id: null,
        blocked_reason: null,
      }),
    },
  };
  await fs.writeFile(fixture.stateFile, `${JSON.stringify(state, null, 2)}\n`, "utf8");
  await fs.mkdir(path.dirname(lockPath), { recursive: true });
  await fs.writeFile(
    lockPath,
    `${JSON.stringify({ pid: process.pid, label: `issue-${issueNumber}`, acquired_at: "2026-03-13T00:00:00.000Z" }, null, 2)}\n`,
    "utf8",
  );

  const issue: GitHubIssue = {
    number: issueNumber,
    title: "Still-active issue",
    body: "",
    createdAt: "2026-03-13T00:00:00Z",
    updatedAt: "2026-03-13T00:00:00Z",
    url: `https://example.test/issues/${issueNumber}`,
    state: "OPEN",
  };

  const supervisor = new Supervisor(fixture.config);
  (supervisor as unknown as { github: Record<string, unknown> }).github = {
    authStatus: async () => ({ ok: true, message: null }),
    listAllIssues: async () => [issue],
    listCandidateIssues: async () => [issue],
    getIssue: async () => issue,
    resolvePullRequestForBranch: async () => {
      throw new Error("unexpected resolvePullRequestForBranch call");
    },
    getChecks: async () => [],
    getUnresolvedReviewThreads: async () => [],
    getPullRequestIfExists: async () => null,
    getMergedPullRequestsClosingIssue: async () => [],
    closeIssue: async () => {
      throw new Error("unexpected closeIssue call");
    },
    createPullRequest: async () => {
      throw new Error("unexpected createPullRequest call");
    },
  };

  const message = await supervisor.runOnce({ dryRun: true });
  assert.match(message, /Skipped issue #91: lock held by pid /);

  const persisted = JSON.parse(await fs.readFile(fixture.stateFile, "utf8")) as SupervisorStateFile;
  assert.equal(persisted.activeIssueNumber, issueNumber);
  assert.equal(persisted.issues[String(issueNumber)]?.codex_session_id, null);
});

test("runOnce reconciles inactive merging records whose tracked PR already merged", async () => {
  const fixture = await createSupervisorFixture();
  const mergedIssueNumber = 91;
  const nextIssueNumber = 92;
  const mergedBranch = branchName(fixture.config, mergedIssueNumber);
  const nextBranch = branchName(fixture.config, nextIssueNumber);
  const state: SupervisorStateFile = {
    activeIssueNumber: null,
    issues: {
      [String(mergedIssueNumber)]: createRecord({
        issue_number: mergedIssueNumber,
        state: "merging",
        branch: mergedBranch,
        workspace: path.join(fixture.workspaceRoot, `issue-${mergedIssueNumber}`),
        journal_path: null,
        pr_number: 191,
        blocked_reason: null,
      }),
    },
  };
  await fs.writeFile(fixture.stateFile, `${JSON.stringify(state, null, 2)}\n`, "utf8");

  const nextIssue: GitHubIssue = {
    number: nextIssueNumber,
    title: "Next runnable issue",
    body: executionReadyBody("Next runnable issue."),
    createdAt: "2026-03-13T00:05:00Z",
    updatedAt: "2026-03-13T00:05:00Z",
    url: `https://example.test/issues/${nextIssueNumber}`,
    state: "OPEN",
  };
  const mergedIssue: GitHubIssue = {
    number: mergedIssueNumber,
    title: "Merged implementation issue",
    body: "",
    createdAt: "2026-03-13T00:00:00Z",
    updatedAt: "2026-03-13T00:21:00Z",
    url: `https://example.test/issues/${mergedIssueNumber}`,
    state: "CLOSED",
  };
  const mergedPr: GitHubPullRequest = {
    number: 191,
    title: "Merged implementation",
    url: "https://example.test/pr/191",
    state: "MERGED",
    createdAt: "2026-03-13T00:10:00Z",
    isDraft: false,
    reviewDecision: null,
    mergeStateStatus: "CLEAN",
    mergeable: "MERGEABLE",
    headRefName: mergedBranch,
    headRefOid: "merged-head-191",
    mergedAt: "2026-03-13T00:20:00Z",
  };

  const supervisor = new Supervisor(fixture.config);
  (supervisor as unknown as { github: Record<string, unknown> }).github = {
    authStatus: async () => ({ ok: true, message: null }),
    listAllIssues: async () => [nextIssue],
    listCandidateIssues: async () => [nextIssue],
    getIssue: async (issueNumber: number) => {
      if (issueNumber === mergedIssueNumber) {
        return mergedIssue;
      }
      assert.equal(issueNumber, nextIssueNumber);
      return nextIssue;
    },
    resolvePullRequestForBranch: async (branchName: string, prNumber: number | null) => {
      assert.equal(branchName, nextBranch);
      assert.equal(prNumber, null);
      return null;
    },
    getChecks: async () => [],
    getUnresolvedReviewThreads: async () => [],
    getPullRequestIfExists: async (prNumber: number) => {
      assert.equal(prNumber, 191);
      return mergedPr;
    },
    getMergedPullRequestsClosingIssue: async () => [],
    closeIssue: async () => {
      throw new Error("unexpected closeIssue call");
    },
    createPullRequest: async () => {
      throw new Error("unexpected createPullRequest call");
    },
  };

  const message = await supervisor.runOnce({ dryRun: true });
  assert.match(message, new RegExp(`Dry run: would invoke Codex for issue #${nextIssueNumber}\\.`));

  const persisted = JSON.parse(await fs.readFile(fixture.stateFile, "utf8")) as SupervisorStateFile;
  assert.equal(persisted.activeIssueNumber, nextIssueNumber);
  assert.equal(persisted.issues[String(mergedIssueNumber)]?.state, "done");
  assert.equal(persisted.issues[String(mergedIssueNumber)]?.pr_number, 191);
  assert.equal(persisted.issues[String(mergedIssueNumber)]?.last_head_sha, "merged-head-191");
  assert.equal(persisted.issues[String(nextIssueNumber)]?.branch, nextBranch);
});

test("runOnce marks a clean draft PR ready and enables auto-merge after the turn", async () => {
  const fixture = await createSupervisorFixture();
  const issueNumber = 92;
  const branch = branchName(fixture.config, issueNumber);
  const state: SupervisorStateFile = {
    activeIssueNumber: issueNumber,
    issues: {
      [String(issueNumber)]: createRecord({
        issue_number: issueNumber,
        state: "stabilizing",
        branch,
        workspace: path.join(fixture.workspaceRoot, `issue-${issueNumber}`),
        journal_path: null,
        pr_number: 113,
        blocked_reason: null,
      }),
    },
  };
  await fs.writeFile(fixture.stateFile, `${JSON.stringify(state, null, 2)}\n`, "utf8");

  const issue: GitHubIssue = {
    number: issueNumber,
    title: "Extract post-turn PR transitions",
    body: "",
    createdAt: "2026-03-13T00:00:00Z",
    updatedAt: "2026-03-13T00:00:00Z",
    url: `https://example.test/issues/${issueNumber}`,
    state: "OPEN",
  };
  const draftPr: GitHubPullRequest = {
    number: 113,
    title: "Post-turn transition refactor",
    url: "https://example.test/pr/113",
    state: "OPEN",
    createdAt: "2026-03-13T00:10:00Z",
    isDraft: true,
    reviewDecision: null,
    mergeStateStatus: "CLEAN",
    mergeable: "MERGEABLE",
    headRefName: branch,
    headRefOid: "head-113",
    mergedAt: null,
  };
  const readyPr: GitHubPullRequest = {
    ...draftPr,
    isDraft: false,
  };

  let readyCalls = 0;
  let autoMergeCalls = 0;
  const supervisor = new Supervisor(fixture.config);
  (supervisor as unknown as { executeCodexTurn: typeof supervisor["executeCodexTurn"] }).executeCodexTurn = async (context) => ({
    kind: "completed",
    record: context.record,
    workspaceStatus: context.workspaceStatus,
    pr: context.pr,
    checks: context.checks,
    reviewThreads: context.reviewThreads,
  });
  (supervisor as unknown as { github: Record<string, unknown> }).github = {
    authStatus: async () => ({ ok: true, message: null }),
    listAllIssues: async () => [issue],
    listCandidateIssues: async () => [issue],
    getIssue: async () => issue,
    resolvePullRequestForBranch: async (branchName: string, prNumber: number | null) => {
      assert.equal(branchName, branch);
      assert.equal(prNumber, 113);
      return draftPr;
    },
    getChecks: async (prNumber: number) => {
      assert.equal(prNumber, 113);
      return [];
    },
    getUnresolvedReviewThreads: async (prNumber: number) => {
      assert.equal(prNumber, 113);
      return [];
    },
    getPullRequest: async (prNumber: number) => {
      assert.equal(prNumber, 113);
      return readyCalls === 0 ? draftPr : readyPr;
    },
    markPullRequestReady: async (prNumber: number) => {
      assert.equal(prNumber, 113);
      readyCalls += 1;
    },
    enableAutoMerge: async (prNumber: number, headSha: string) => {
      assert.equal(prNumber, 113);
      assert.equal(headSha, "head-113");
      autoMergeCalls += 1;
    },
    getPullRequestIfExists: async () => null,
    getMergedPullRequestsClosingIssue: async () => [],
    closeIssue: async () => {
      throw new Error("unexpected closeIssue call");
    },
    createPullRequest: async () => {
      throw new Error("unexpected createPullRequest call");
    },
  };

  const message = await supervisor.runOnce({ dryRun: false });
  assert.match(message, /state=merging/);

  const persisted = JSON.parse(await fs.readFile(fixture.stateFile, "utf8")) as SupervisorStateFile;
  const record = persisted.issues[String(issueNumber)];
  assert.equal(record.pr_number, 113);
  assert.equal(record.state, "merging");
  assert.equal(record.last_head_sha, "head-113");
  assert.equal(record.blocked_reason, null);
  assert.equal(readyCalls, 1);
  assert.equal(autoMergeCalls, 1);
});

test("runOnce waits for Copilot propagation after marking a draft PR ready", async () => {
  const fixture = await createSupervisorFixture();
  const issueNumber = 101;
  const branch = branchName(fixture.config, issueNumber);
  const config = createConfig({
    ...fixture.config,
    reviewBotLogins: ["copilot-pull-request-reviewer"],
  });
  const state: SupervisorStateFile = {
    activeIssueNumber: issueNumber,
    issues: {
      [String(issueNumber)]: createRecord({
        issue_number: issueNumber,
        state: "stabilizing",
        branch,
        workspace: path.join(fixture.workspaceRoot, `issue-${issueNumber}`),
        journal_path: null,
        pr_number: 114,
        blocked_reason: null,
      }),
    },
  };
  await fs.writeFile(fixture.stateFile, `${JSON.stringify(state, null, 2)}\n`, "utf8");

  const issue: GitHubIssue = {
    number: issueNumber,
    title: "Honor the refreshed review-wait snapshot after ready for review",
    body: "",
    createdAt: "2026-03-13T00:00:00Z",
    updatedAt: "2026-03-13T00:00:00Z",
    url: `https://example.test/issues/${issueNumber}`,
    state: "OPEN",
  };
  const draftPr: GitHubPullRequest = {
    number: 114,
    title: "Propagate Copilot wait state",
    url: "https://example.test/pr/114",
    state: "OPEN",
    createdAt: "2026-03-13T06:20:00Z",
    isDraft: true,
    reviewDecision: null,
    mergeStateStatus: "CLEAN",
    mergeable: "MERGEABLE",
    headRefName: branch,
    headRefOid: "head-114",
    mergedAt: null,
    copilotReviewState: "not_requested",
    copilotReviewRequestedAt: null,
    copilotReviewArrivedAt: null,
  };
  const postReadyPr: GitHubPullRequest = {
    ...draftPr,
    isDraft: false,
  };
  const checks: PullRequestCheck[] = [{ name: "build", state: "SUCCESS", bucket: "pass", workflow: "CI" }];

  let readyCalls = 0;
  let autoMergeCalls = 0;
  const supervisor = new Supervisor(config);
  (supervisor as unknown as { executeCodexTurn: typeof supervisor["executeCodexTurn"] }).executeCodexTurn = async (context) => ({
    kind: "completed",
    record: context.record,
    workspaceStatus: context.workspaceStatus,
    pr: context.pr,
    checks: context.checks,
    reviewThreads: context.reviewThreads,
  });
  (supervisor as unknown as { github: Record<string, unknown> }).github = {
    authStatus: async () => ({ ok: true, message: null }),
    listAllIssues: async () => [issue],
    listCandidateIssues: async () => [issue],
    getIssue: async () => issue,
    resolvePullRequestForBranch: async (branchName: string, prNumber: number | null) => {
      assert.equal(branchName, branch);
      assert.equal(prNumber, 114);
      return draftPr;
    },
    getChecks: async (prNumber: number) => {
      assert.equal(prNumber, 114);
      return checks;
    },
    getUnresolvedReviewThreads: async (prNumber: number) => {
      assert.equal(prNumber, 114);
      return [];
    },
    getPullRequest: async (prNumber: number) => {
      assert.equal(prNumber, 114);
      return readyCalls === 0 ? draftPr : postReadyPr;
    },
    markPullRequestReady: async (prNumber: number) => {
      assert.equal(prNumber, 114);
      readyCalls += 1;
    },
    enableAutoMerge: async () => {
      autoMergeCalls += 1;
    },
    getPullRequestIfExists: async () => null,
    getMergedPullRequestsClosingIssue: async () => [],
    closeIssue: async () => {
      throw new Error("unexpected closeIssue call");
    },
    createPullRequest: async () => {
      throw new Error("unexpected createPullRequest call");
    },
  };

  const originalDateNow = Date.now;
  Date.now = () => Date.parse("2026-03-13T06:26:22Z");
  try {
    const message = await supervisor.runOnce({ dryRun: false });
    assert.match(message, /state=waiting_ci/);
  } finally {
    Date.now = originalDateNow;
  }

  const persisted = JSON.parse(await fs.readFile(fixture.stateFile, "utf8")) as SupervisorStateFile;
  const record = persisted.issues[String(issueNumber)];
  assert.equal(record.pr_number, 114);
  assert.equal(record.state, "waiting_ci");
  assert.equal(record.last_head_sha, "head-114");
  assert.equal(record.review_wait_head_sha, "head-114");
  assert.ok(record.review_wait_started_at);
  assert.equal(Number.isNaN(Date.parse(record.review_wait_started_at ?? "")), false);
  assert.equal(record.blocked_reason, null);
  assert.equal(readyCalls, 1);
  assert.equal(autoMergeCalls, 0);
});

test("handlePostTurnPullRequestTransitions refreshes PR state after marking ready", async () => {
  const fixture = await createSupervisorFixture();
  const issueNumber = 102;
  const branch = branchName(fixture.config, issueNumber);
  const state: SupervisorStateFile = {
    activeIssueNumber: issueNumber,
    issues: {
      [String(issueNumber)]: createRecord({
        issue_number: issueNumber,
        state: "stabilizing",
        branch,
        workspace: path.join(fixture.workspaceRoot, `issue-${issueNumber}`),
        journal_path: null,
        pr_number: 116,
        blocked_reason: null,
      }),
    },
  };
  await fs.writeFile(fixture.stateFile, `${JSON.stringify(state, null, 2)}\n`, "utf8");

  const issue: GitHubIssue = {
    number: issueNumber,
    title: "Refresh post-ready PR state",
    body: "",
    createdAt: "2026-03-13T00:00:00Z",
    updatedAt: "2026-03-13T00:00:00Z",
    url: `https://example.test/issues/${issueNumber}`,
    state: "OPEN",
  };
  const draftPr: GitHubPullRequest = {
    number: 116,
    title: "Refresh after ready",
    url: "https://example.test/pr/116",
    state: "OPEN",
    createdAt: "2026-03-13T06:20:00Z",
    isDraft: true,
    reviewDecision: null,
    mergeStateStatus: "CLEAN",
    mergeable: "MERGEABLE",
    headRefName: branch,
    headRefOid: "head-116",
    mergedAt: null,
    copilotReviewState: "not_requested",
    copilotReviewRequestedAt: null,
    copilotReviewArrivedAt: null,
  };
  const readyPr: GitHubPullRequest = {
    ...draftPr,
    isDraft: false,
  };
  const initialChecks: PullRequestCheck[] = [{ name: "build", state: "SUCCESS", bucket: "pass", workflow: "CI" }];
  const postReadyChecks: PullRequestCheck[] = [{ name: "build", state: "IN_PROGRESS", bucket: "pending", workflow: "CI" }];

  let readyCalls = 0;
  let snapshotLoads = 0;
  let syncJournalCalls = 0;
  const supervisor = new Supervisor(fixture.config);
  (supervisor as unknown as { loadOpenPullRequestSnapshot: (prNumber: number) => Promise<unknown> }).loadOpenPullRequestSnapshot = async (
    prNumber: number,
  ) => {
    assert.equal(prNumber, 116);
    snapshotLoads += 1;
    return snapshotLoads === 1
      ? { pr: draftPr, checks: initialChecks, reviewThreads: [] }
      : { pr: readyPr, checks: postReadyChecks, reviewThreads: [] };
  };
  (supervisor as unknown as { github: Record<string, unknown> }).github = {
    markPullRequestReady: async (prNumber: number) => {
      assert.equal(prNumber, 116);
      readyCalls += 1;
    },
  };

  const result = await (
    supervisor as unknown as {
      handlePostTurnPullRequestTransitions: (context: {
        state: SupervisorStateFile;
        record: IssueRunRecord;
        issue: GitHubIssue;
        workspacePath: string;
        syncJournal: (record: IssueRunRecord) => Promise<void>;
        memoryArtifacts: { alwaysReadFiles: string[]; onDemandFiles: string[] };
        pr: GitHubPullRequest;
        options: { dryRun: boolean };
      }) => Promise<{
        record: IssueRunRecord;
        pr: GitHubPullRequest;
        checks: PullRequestCheck[];
        reviewThreads: ReviewThread[];
      }>;
    }
  ).handlePostTurnPullRequestTransitions({
    state,
    record: state.issues[String(issueNumber)]!,
    issue,
    workspacePath: path.join(fixture.workspaceRoot, `issue-${issueNumber}`),
    syncJournal: async () => {
      syncJournalCalls += 1;
    },
    memoryArtifacts: { alwaysReadFiles: [], onDemandFiles: [] },
    pr: draftPr,
    options: { dryRun: false },
  });

  assert.equal(result.pr.isDraft, false);
  assert.equal(result.record.state, "waiting_ci");
  assert.equal(result.record.review_wait_head_sha, "head-116");
  assert.ok(result.record.review_wait_started_at);

  assert.equal(readyCalls, 1);
  assert.equal(snapshotLoads, 2);
  assert.equal(syncJournalCalls, 0);
});

test("runOnce records an observed Copilot request time when GitHub omits the request timestamp", async () => {
  const fixture = await createSupervisorFixture();
  const issueNumber = 115;
  const branch = branchName(fixture.config, issueNumber);
  const config = createConfig({
    ...fixture.config,
    reviewBotLogins: ["copilot-pull-request-reviewer"],
  });
  const state: SupervisorStateFile = {
    activeIssueNumber: null,
    issues: {},
  };
  await fs.writeFile(fixture.stateFile, `${JSON.stringify(state, null, 2)}\n`, "utf8");

  const issue: GitHubIssue = {
    number: issueNumber,
    title: "Persist observed Copilot request time",
    body: executionReadyBody("Persist observed Copilot request time."),
    createdAt: "2026-03-13T00:00:00Z",
    updatedAt: "2026-03-13T00:00:00Z",
    url: `https://example.test/issues/${issueNumber}`,
    state: "OPEN",
  };
  const pr: GitHubPullRequest = {
    number: 115,
    title: "Missing Copilot request timestamp",
    url: "https://example.test/pr/115",
    state: "OPEN",
    createdAt: "2026-03-13T06:20:00Z",
    isDraft: false,
    reviewDecision: null,
    mergeStateStatus: "CLEAN",
    mergeable: "MERGEABLE",
    headRefName: branch,
    headRefOid: "head-115",
    mergedAt: null,
    copilotReviewState: "requested",
    copilotReviewRequestedAt: null,
    copilotReviewArrivedAt: null,
  };
  const checks: PullRequestCheck[] = [{ name: "build", state: "SUCCESS", bucket: "pass", workflow: "CI" }];

  const supervisor = new Supervisor(config);
  (supervisor as unknown as { github: Record<string, unknown> }).github = {
    authStatus: async () => ({ ok: true, message: null }),
    listAllIssues: async () => [issue],
    listCandidateIssues: async () => [issue],
    getIssue: async () => issue,
    resolvePullRequestForBranch: async (branchName: string, prNumber: number | null) => {
      assert.equal(branchName, branch);
      assert.equal(prNumber, null);
      return pr;
    },
    getChecks: async (prNumber: number) => {
      assert.equal(prNumber, pr.number);
      return checks;
    },
    getUnresolvedReviewThreads: async (prNumber: number) => {
      assert.equal(prNumber, pr.number);
      return [];
    },
    getPullRequest: async (prNumber: number) => {
      assert.equal(prNumber, pr.number);
      return pr;
    },
    getPullRequestIfExists: async () => null,
    getMergedPullRequestsClosingIssue: async () => [],
    closeIssue: async () => {
      throw new Error("unexpected closeIssue call");
    },
    createPullRequest: async () => {
      throw new Error("unexpected createPullRequest call");
    },
  };

  const originalDateNow = Date.now;
  Date.now = () => Date.parse("2026-03-13T06:26:22Z");
  try {
    const message = await supervisor.runOnce({ dryRun: true });
    assert.match(message, /state=waiting_ci/);
  } finally {
    Date.now = originalDateNow;
  }

  const persisted = JSON.parse(await fs.readFile(fixture.stateFile, "utf8")) as SupervisorStateFile;
  const record = persisted.issues[String(issueNumber)];
  assert.equal(record.state, "waiting_ci");
  assert.equal(record.pr_number, 115);
  assert.equal(record.copilot_review_requested_head_sha, "head-115");
  assert.ok(record.copilot_review_requested_observed_at);
  assert.equal(Number.isNaN(Date.parse(record.copilot_review_requested_observed_at ?? "")), false);
});

function branchName(config: SupervisorConfig, issueNumber: number): string {
  return `${config.branchPrefix}${issueNumber}`;
}

test("summarizeChecks treats cancelled runs as waiting, not failing", () => {
  const checks: PullRequestCheck[] = [
    { name: "build (ubuntu-latest)", state: "CANCELLED", bucket: "cancel", workflow: "CI" },
  ];

  assert.deepEqual(summarizeChecks(checks), {
    allPassing: false,
    hasPending: true,
    hasFailing: false,
  });
});

test("buildChecksFailureContext ignores cancelled runs", () => {
  const pr: GitHubPullRequest = {
    number: 42,
    title: "Test PR",
    url: "https://example.test/pr/42",
    state: "OPEN",
    createdAt: "2026-03-11T14:00:00Z",
    isDraft: false,
    reviewDecision: null,
    mergeStateStatus: "UNSTABLE",
    mergeable: "MERGEABLE",
    headRefName: "codex/issue-42",
    headRefOid: "deadbeef",
    mergedAt: null,
  };

  const checks: PullRequestCheck[] = [
    { name: "build (ubuntu-latest)", state: "CANCELLED", bucket: "cancel", workflow: "CI" },
    { name: "build (macos-latest)", state: "SUCCESS", bucket: "pass", workflow: "CI" },
  ];

  assert.equal(buildChecksFailureContext(pr, checks), null);
});

test("inferStateFromPullRequest routes actionable high local-review retry into local_review_fix", () => {
  const config = createConfig({
    localReviewEnabled: true,
    localReviewPolicy: "block_ready",
    localReviewHighSeverityAction: "retry",
  });
  const record = createRecord({
    state: "draft_pr",
    pr_number: 44,
    local_review_head_sha: "head123",
    local_review_max_severity: "high",
    local_review_verified_max_severity: "high",
    local_review_verified_findings_count: 1,
    local_review_findings_count: 3,
    local_review_recommendation: "changes_requested",
    repeated_local_review_signature_count: 1,
  });
  const pr: GitHubPullRequest = {
    number: 44,
    title: "Test PR",
    url: "https://example.test/pr/44",
    state: "OPEN",
    createdAt: "2026-03-11T00:00:00Z",
    isDraft: true,
    reviewDecision: null,
    mergeStateStatus: "CLEAN",
    headRefName: "codex/issue-38",
    headRefOid: "head123",
  };

  assert.equal(inferStateFromPullRequest(config, record, pr, [], []), "local_review_fix");
});

test("inferStateFromPullRequest does not wait for Copilot when no lifecycle signal exists", () => {
  const config = createConfig({ copilotReviewWaitMinutes: 10 });
  const now = new Date().toISOString();
  const record = createRecord({
    state: "pr_open",
    review_wait_started_at: now,
    review_wait_head_sha: "head123",
  });
  const pr: GitHubPullRequest = {
    number: 44,
    title: "Test PR",
    url: "https://example.test/pr/44",
    state: "OPEN",
    createdAt: now,
    isDraft: false,
    reviewDecision: null,
    mergeStateStatus: "CLEAN",
    mergeable: "MERGEABLE",
    headRefName: "codex/issue-38",
    headRefOid: "head123",
    mergedAt: null,
  };
  const checks: PullRequestCheck[] = [{ name: "build", state: "SUCCESS", bucket: "pass", workflow: "CI" }];

  assert.equal(inferStateFromPullRequest(config, record, pr, checks, []), "ready_to_merge");
});

test("inferStateFromPullRequest waits briefly after ready-for-review for Copilot request propagation", () => {
  withStubbedDateNow("2026-03-13T05:42:40Z", () => {
    const config = createConfig({
      copilotReviewWaitMinutes: 10,
      reviewBotLogins: ["copilot-pull-request-reviewer"],
    });
    const record = createRecord({
      state: "pr_open",
      review_wait_started_at: "2026-03-13T05:42:36Z",
      review_wait_head_sha: "head123",
    });
    const pr: GitHubPullRequest = {
      number: 44,
      title: "Test PR",
      url: "https://example.test/pr/44",
      state: "OPEN",
      createdAt: "2026-03-13T05:40:00Z",
      isDraft: false,
      reviewDecision: null,
      mergeStateStatus: "CLEAN",
      mergeable: "MERGEABLE",
      headRefName: "codex/issue-38",
      headRefOid: "head123",
      mergedAt: null,
      copilotReviewState: "not_requested",
      copilotReviewRequestedAt: null,
      copilotReviewArrivedAt: null,
    };
    const checks: PullRequestCheck[] = [{ name: "build", state: "SUCCESS", bucket: "pass", workflow: "CI" }];

    assert.equal(inferStateFromPullRequest(config, record, pr, checks, []), "waiting_ci");
  });
});

test("inferStateFromPullRequest allows merge after the Copilot propagation grace window expires", () => {
  withStubbedDateNow("2026-03-13T05:42:42Z", () => {
    const config = createConfig({
      copilotReviewWaitMinutes: 10,
      reviewBotLogins: ["copilot-pull-request-reviewer"],
    });
    const record = createRecord({
      state: "pr_open",
      review_wait_started_at: "2026-03-13T05:42:36Z",
      review_wait_head_sha: "head123",
    });
    const pr: GitHubPullRequest = {
      number: 44,
      title: "Test PR",
      url: "https://example.test/pr/44",
      state: "OPEN",
      createdAt: "2026-03-13T05:40:00Z",
      isDraft: false,
      reviewDecision: null,
      mergeStateStatus: "CLEAN",
      mergeable: "MERGEABLE",
      headRefName: "codex/issue-38",
      headRefOid: "head123",
      mergedAt: null,
      copilotReviewState: "not_requested",
      copilotReviewRequestedAt: null,
      copilotReviewArrivedAt: null,
    };
    const checks: PullRequestCheck[] = [{ name: "build", state: "SUCCESS", bucket: "pass", workflow: "CI" }];

    assert.equal(inferStateFromPullRequest(config, record, pr, checks, []), "ready_to_merge");
  });
});

test("inferStateFromPullRequest keeps waiting when Copilot review was explicitly requested", () => {
  withStubbedDateNow("2026-03-11T00:10:00Z", () => {
    const config = createConfig({ copilotReviewWaitMinutes: 10 });
    const requestedAt = "2026-03-11T00:05:00Z";
    const record = createRecord({
      state: "waiting_ci",
      review_wait_started_at: requestedAt,
      review_wait_head_sha: "head123",
    });
    const pr: GitHubPullRequest = {
      number: 44,
      title: "Test PR",
      url: "https://example.test/pr/44",
      state: "OPEN",
      createdAt: "2026-03-11T00:00:00Z",
      isDraft: false,
      reviewDecision: null,
      mergeStateStatus: "CLEAN",
      mergeable: "MERGEABLE",
      headRefName: "codex/issue-38",
      headRefOid: "head123",
      mergedAt: null,
      copilotReviewState: "requested",
      copilotReviewRequestedAt: requestedAt,
      copilotReviewArrivedAt: null,
    };
    const checks: PullRequestCheck[] = [{ name: "build", state: "SUCCESS", bucket: "pass", workflow: "CI" }];

    assert.equal(inferStateFromPullRequest(config, record, pr, checks, []), "waiting_ci");
  });
});

test("inferStateFromPullRequest keeps waiting when a Copilot request was observed on the current head but has not arrived", () => {
  withStubbedDateNow("2026-03-11T00:10:00Z", () => {
    const config = createConfig({ copilotReviewWaitMinutes: 10 });
    const record = createRecord({
      state: "waiting_ci",
      review_wait_started_at: "2026-03-11T00:00:00Z",
      review_wait_head_sha: "head123",
      copilot_review_requested_observed_at: "2026-03-11T00:05:00Z",
      copilot_review_requested_head_sha: "head123",
    });
    const pr: GitHubPullRequest = {
      number: 44,
      title: "Test PR",
      url: "https://example.test/pr/44",
      state: "OPEN",
      createdAt: "2026-03-11T00:00:00Z",
      isDraft: false,
      reviewDecision: null,
      mergeStateStatus: "CLEAN",
      mergeable: "MERGEABLE",
      headRefName: "codex/issue-38",
      headRefOid: "head123",
      mergedAt: null,
      copilotReviewState: "not_requested",
      copilotReviewRequestedAt: null,
      copilotReviewArrivedAt: null,
    };
    const checks: PullRequestCheck[] = [{ name: "build", state: "SUCCESS", bucket: "pass", workflow: "CI" }];

    assert.equal(inferStateFromPullRequest(config, record, pr, checks, []), "waiting_ci");
  });
});

test("inferStateFromPullRequest does not start Copilot timeout from the generic review wait window", () => {
  withStubbedDateNow("2026-03-11T00:30:00Z", () => {
    const config = createConfig({ copilotReviewWaitMinutes: 10, copilotReviewTimeoutAction: "block" });
    const record = createRecord({
      state: "waiting_ci",
      review_wait_started_at: "2026-03-11T00:00:00Z",
      review_wait_head_sha: "head123",
    });
    const pr: GitHubPullRequest = {
      number: 44,
      title: "Test PR",
      url: "https://example.test/pr/44",
      state: "OPEN",
      createdAt: "2026-03-11T00:00:00Z",
      isDraft: false,
      reviewDecision: null,
      mergeStateStatus: "CLEAN",
      mergeable: "MERGEABLE",
      headRefName: "codex/issue-38",
      headRefOid: "head123",
      mergedAt: null,
      copilotReviewState: "requested",
      copilotReviewRequestedAt: null,
      copilotReviewArrivedAt: null,
    };
    const checks: PullRequestCheck[] = [{ name: "build", state: "SUCCESS", bucket: "pass", workflow: "CI" }];

    assert.equal(inferStateFromPullRequest(config, record, pr, checks, []), "waiting_ci");
  });
});

test("inferStateFromPullRequest can time out from the observed Copilot request timestamp when GitHub omits one", () => {
  withStubbedDateNow("2026-03-11T00:30:00Z", () => {
    const config = createConfig({ copilotReviewWaitMinutes: 10, copilotReviewTimeoutAction: "block" });
    const record = createRecord({
      state: "waiting_ci",
      review_wait_started_at: "2026-03-11T00:00:00Z",
      review_wait_head_sha: "head123",
      copilot_review_requested_observed_at: "2026-03-11T00:15:00Z",
      copilot_review_requested_head_sha: "head123",
    });
    const pr: GitHubPullRequest = {
      number: 44,
      title: "Test PR",
      url: "https://example.test/pr/44",
      state: "OPEN",
      createdAt: "2026-03-11T00:00:00Z",
      isDraft: false,
      reviewDecision: null,
      mergeStateStatus: "CLEAN",
      mergeable: "MERGEABLE",
      headRefName: "codex/issue-38",
      headRefOid: "head123",
      mergedAt: null,
      copilotReviewState: "requested",
      copilotReviewRequestedAt: null,
      copilotReviewArrivedAt: null,
    };
    const checks: PullRequestCheck[] = [{ name: "build", state: "SUCCESS", bucket: "pass", workflow: "CI" }];

    assert.equal(inferStateFromPullRequest(config, record, pr, checks, []), "blocked");
  });
});

test("inferStateFromPullRequest times out requested Copilot reviews and continues by default", () => {
  withStubbedDateNow("2026-03-11T00:30:00Z", () => {
    const config = createConfig({ copilotReviewWaitMinutes: 10, copilotReviewTimeoutAction: "continue" });
    const record = createRecord({
      state: "waiting_ci",
      review_wait_started_at: "2026-03-11T00:00:00Z",
      review_wait_head_sha: "head123",
    });
    const pr: GitHubPullRequest = {
      number: 44,
      title: "Test PR",
      url: "https://example.test/pr/44",
      state: "OPEN",
      createdAt: "2026-03-11T00:00:00Z",
      isDraft: false,
      reviewDecision: null,
      mergeStateStatus: "CLEAN",
      mergeable: "MERGEABLE",
      headRefName: "codex/issue-38",
      headRefOid: "head123",
      mergedAt: null,
      copilotReviewState: "requested",
      copilotReviewRequestedAt: "2026-03-11T00:05:00Z",
      copilotReviewArrivedAt: null,
    };
    const checks: PullRequestCheck[] = [{ name: "build", state: "SUCCESS", bucket: "pass", workflow: "CI" }];

    assert.equal(inferStateFromPullRequest(config, record, pr, checks, []), "ready_to_merge");
  });
});

test("inferStateFromPullRequest can block when a requested Copilot review times out", () => {
  withStubbedDateNow("2026-03-11T00:30:00Z", () => {
    const config = createConfig({ copilotReviewWaitMinutes: 10, copilotReviewTimeoutAction: "block" });
    const record = createRecord({
      state: "waiting_ci",
      review_wait_started_at: "2026-03-11T00:00:00Z",
      review_wait_head_sha: "head123",
    });
    const pr: GitHubPullRequest = {
      number: 44,
      title: "Test PR",
      url: "https://example.test/pr/44",
      state: "OPEN",
      createdAt: "2026-03-11T00:00:00Z",
      isDraft: false,
      reviewDecision: null,
      mergeStateStatus: "CLEAN",
      mergeable: "MERGEABLE",
      headRefName: "codex/issue-38",
      headRefOid: "head123",
      mergedAt: null,
      copilotReviewState: "requested",
      copilotReviewRequestedAt: "2026-03-11T00:05:00Z",
      copilotReviewArrivedAt: null,
    };
    const checks: PullRequestCheck[] = [{ name: "build", state: "SUCCESS", bucket: "pass", workflow: "CI" }];

    assert.equal(inferStateFromPullRequest(config, record, pr, checks, []), "blocked");
  });
});

test("inferStateFromPullRequest covers local review policy gating combinations", () => {
  const cases: Array<{
    name: string;
    config: Partial<SupervisorConfig>;
    record: Partial<IssueRunRecord>;
    pr: Partial<GitHubPullRequest>;
    expected: IssueRunRecord["state"];
  }> = [
    {
      name: "block_ready keeps draft PRs in draft_pr when raw findings exist on the current head",
      config: { localReviewEnabled: true, localReviewPolicy: "block_ready", copilotReviewWaitMinutes: 0 },
      record: {
        state: "draft_pr",
        local_review_head_sha: "head123",
        local_review_findings_count: 2,
        local_review_recommendation: "changes_requested",
      },
      pr: { isDraft: true, headRefOid: "head123" },
      expected: "draft_pr",
    },
    {
      name: "block_ready does not block a ready PR after it becomes ready",
      config: { localReviewEnabled: true, localReviewPolicy: "block_ready", copilotReviewWaitMinutes: 0 },
      record: {
        state: "pr_open",
        local_review_head_sha: "head123",
        local_review_findings_count: 2,
        local_review_recommendation: "changes_requested",
      },
      pr: { isDraft: false, headRefOid: "head123" },
      expected: "ready_to_merge",
    },
    {
      name: "block_merge blocks merge for ready PRs with actionable findings on the current head",
      config: { localReviewEnabled: true, localReviewPolicy: "block_merge", copilotReviewWaitMinutes: 0 },
      record: {
        state: "pr_open",
        local_review_head_sha: "head123",
        local_review_findings_count: 2,
        local_review_recommendation: "changes_requested",
      },
      pr: { isDraft: false, headRefOid: "head123" },
      expected: "blocked",
    },
    {
      name: "block_merge stops gating once the review head becomes stale",
      config: { localReviewEnabled: true, localReviewPolicy: "block_merge", copilotReviewWaitMinutes: 0 },
      record: {
        state: "pr_open",
        local_review_head_sha: "oldhead",
        local_review_findings_count: 2,
        local_review_recommendation: "changes_requested",
      },
      pr: { isDraft: false, headRefOid: "newhead" },
      expected: "ready_to_merge",
    },
    {
      name: "advisory never blocks merge for ready PRs with raw findings",
      config: { localReviewEnabled: true, localReviewPolicy: "advisory", copilotReviewWaitMinutes: 0 },
      record: {
        state: "pr_open",
        local_review_head_sha: "head123",
        local_review_findings_count: 2,
        local_review_recommendation: "changes_requested",
      },
      pr: { isDraft: false, headRefOid: "head123" },
      expected: "ready_to_merge",
    },
    {
      name: "retry escalates verifier-confirmed high severity findings into local_review_fix",
      config: {
        localReviewEnabled: true,
        localReviewPolicy: "block_merge",
        localReviewHighSeverityAction: "retry",
        copilotReviewWaitMinutes: 0,
      },
      record: {
        state: "pr_open",
        local_review_head_sha: "head123",
        local_review_findings_count: 3,
        local_review_recommendation: "changes_requested",
        local_review_verified_max_severity: "high",
        local_review_verified_findings_count: 1,
        repeated_local_review_signature_count: 1,
      },
      pr: { isDraft: false, headRefOid: "head123" },
      expected: "local_review_fix",
    },
    {
      name: "blocked escalates verifier-confirmed high severity findings to blocked",
      config: {
        localReviewEnabled: true,
        localReviewPolicy: "block_merge",
        localReviewHighSeverityAction: "blocked",
        copilotReviewWaitMinutes: 0,
      },
      record: {
        state: "pr_open",
        local_review_head_sha: "head123",
        local_review_findings_count: 3,
        local_review_recommendation: "changes_requested",
        local_review_verified_max_severity: "high",
        local_review_verified_findings_count: 1,
      },
      pr: { isDraft: false, headRefOid: "head123" },
      expected: "blocked",
    },
    {
      name: "advisory suppresses high severity retry escalation",
      config: {
        localReviewEnabled: true,
        localReviewPolicy: "advisory",
        localReviewHighSeverityAction: "retry",
        copilotReviewWaitMinutes: 0,
      },
      record: {
        state: "pr_open",
        local_review_head_sha: "head123",
        local_review_findings_count: 3,
        local_review_recommendation: "changes_requested",
        local_review_verified_max_severity: "high",
        local_review_verified_findings_count: 1,
      },
      pr: { isDraft: false, headRefOid: "head123" },
      expected: "ready_to_merge",
    },
  ];

  for (const testCase of cases) {
    const config = createConfig(testCase.config);
    const record = createRecord(testCase.record);
    const pr: GitHubPullRequest = {
      number: 44,
      title: "Test PR",
      url: "https://example.test/pr/44",
      state: "OPEN",
      createdAt: "2026-03-01T00:00:00Z",
      isDraft: false,
      reviewDecision: null,
      mergeStateStatus: "CLEAN",
      mergeable: "MERGEABLE",
      headRefName: "codex/issue-38",
      headRefOid: "head123",
      mergedAt: null,
      ...testCase.pr,
    };

    assert.equal(
      inferStateFromPullRequest(config, record, pr, [], []),
      testCase.expected,
      testCase.name,
    );
  }
});

test("inferStateFromPullRequest blocks stalled identical high local-review retries", () => {
  const config = createConfig({
    localReviewEnabled: true,
    localReviewPolicy: "block_ready",
    localReviewHighSeverityAction: "retry",
    sameFailureSignatureRepeatLimit: 3,
  });
  const record = createRecord({
    state: "draft_pr",
    pr_number: 44,
    local_review_head_sha: "head123",
    local_review_max_severity: "high",
    local_review_verified_max_severity: "high",
    local_review_verified_findings_count: 1,
    local_review_findings_count: 3,
    local_review_recommendation: "changes_requested",
    repeated_local_review_signature_count: 3,
  });
  const pr: GitHubPullRequest = {
    number: 44,
    title: "Test PR",
    url: "https://example.test/pr/44",
    state: "OPEN",
    createdAt: "2026-03-11T00:00:00Z",
    isDraft: true,
    reviewDecision: null,
    mergeStateStatus: "CLEAN",
    headRefName: "codex/issue-38",
    headRefOid: "head123",
  };

  assert.equal(inferStateFromPullRequest(config, record, pr, [], []), "blocked");
});

test("inferStateFromPullRequest does not stall local-review retries when CI adds a fresh signal", () => {
  const config = createConfig({
    localReviewEnabled: true,
    localReviewPolicy: "block_ready",
    localReviewHighSeverityAction: "retry",
    sameFailureSignatureRepeatLimit: 3,
  });
  const record = createRecord({
    state: "local_review_fix",
    pr_number: 44,
    local_review_head_sha: "head123",
    local_review_max_severity: "high",
    local_review_verified_max_severity: "high",
    local_review_verified_findings_count: 1,
    local_review_findings_count: 3,
    local_review_recommendation: "changes_requested",
    repeated_local_review_signature_count: 3,
  });
  const pr: GitHubPullRequest = {
    number: 44,
    title: "Test PR",
    url: "https://example.test/pr/44",
    state: "OPEN",
    createdAt: "2026-03-11T00:00:00Z",
    isDraft: true,
    reviewDecision: null,
    mergeStateStatus: "CLEAN",
    headRefName: "codex/issue-38",
    headRefOid: "head123",
  };
  const checks: PullRequestCheck[] = [{ name: "test", state: "FAILURE", bucket: "fail", workflow: "CI" }];

  assert.equal(inferStateFromPullRequest(config, record, pr, checks, []), "local_review_fix");
});

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

test("formatDetailedStatus shows blocking local review status for current PR head", () => {
  const config = createConfig({ localReviewPolicy: "block_ready" });
  const record = createRecord({
    local_review_head_sha: "deadbeef",
    local_review_blocker_summary: "high src/supervisor.ts:210-214 stale artifact context drives the wrong repair path.",
    local_review_max_severity: "high",
    local_review_findings_count: 3,
    local_review_recommendation: "changes_requested",
    local_review_run_at: "2026-03-11T14:05:00Z",
  });
  const pr: GitHubPullRequest = {
    number: 42,
    title: "Test PR",
    url: "https://example.test/pr/42",
    state: "OPEN",
    createdAt: "2026-03-11T14:00:00Z",
    isDraft: true,
    reviewDecision: null,
    mergeStateStatus: "CLEAN",
    mergeable: "MERGEABLE",
    headRefName: "codex/issue-42",
    headRefOid: "deadbeef",
    mergedAt: null,
  };

  const status = formatDetailedStatus({
    config,
    activeRecord: record,
    latestRecord: record,
    trackedIssueCount: 1,
    pr,
    checks: [],
    reviewThreads: [],
  });

  assert.match(
    status,
    /local_review gating=yes policy=block_ready findings=3 root_causes=0 max_severity=high verified_findings=0 verified_max_severity=none head=current reviewed_head_sha=deadbeef pr_head_sha=deadbeef ran_at=2026-03-11T14:05:00Z blocker_summary=high src\/supervisor\.ts:210-214 stale artifact context drives the wrong repair path\. signature=none repeated=0 stalled=no/,
  );
  assert.doesNotMatch(status, /needs_review_run=/);
  assert.match(status, /external_review head=none reviewed_head_sha=none matched=0 near_match=0 missed=0/);
});

test("formatDetailedStatus shows both raw and compressed local review counts", () => {
  const config = createConfig({ localReviewPolicy: "block_ready" });
  const record = {
    ...createRecord({
      local_review_head_sha: "deadbeef",
      local_review_max_severity: "high",
      local_review_findings_count: 3,
      local_review_root_cause_count: 1,
      local_review_recommendation: "changes_requested",
      local_review_run_at: "2026-03-11T14:05:00Z",
    }),
  };
  const pr: GitHubPullRequest = {
    number: 42,
    title: "Test PR",
    url: "https://example.test/pr/42",
    state: "OPEN",
    createdAt: "2026-03-11T14:00:00Z",
    isDraft: true,
    reviewDecision: null,
    mergeStateStatus: "CLEAN",
    mergeable: "MERGEABLE",
    headRefName: "codex/issue-42",
    headRefOid: "deadbeef",
    mergedAt: null,
  };

  const status = formatDetailedStatus({
    config,
    activeRecord: record,
    latestRecord: record,
    trackedIssueCount: 1,
    pr,
    checks: [],
    reviewThreads: [],
  });

  assert.match(status, /local_review .*findings=3 .*root_causes=1 .*stalled=no/);
});

test("formatDetailedStatus marks stalled local-review repair loops explicitly", () => {
  const config = createConfig({
    localReviewEnabled: true,
    localReviewPolicy: "block_ready",
    localReviewHighSeverityAction: "retry",
    sameFailureSignatureRepeatLimit: 3,
  });
  const record = createRecord({
    state: "blocked",
    blocked_reason: "verification",
    local_review_head_sha: "deadbeef",
    local_review_max_severity: "high",
    local_review_verified_max_severity: "high",
    local_review_verified_findings_count: 1,
    local_review_findings_count: 3,
    local_review_root_cause_count: 1,
    local_review_recommendation: "changes_requested",
    repeated_local_review_signature_count: 3,
  });
  const pr: GitHubPullRequest = {
    number: 42,
    title: "Test PR",
    url: "https://example.test/pr/42",
    state: "OPEN",
    createdAt: "2026-03-11T14:00:00Z",
    isDraft: true,
    reviewDecision: null,
    mergeStateStatus: "CLEAN",
    mergeable: "MERGEABLE",
    headRefName: "codex/issue-42",
    headRefOid: "deadbeef",
    mergedAt: null,
  };

  const status = formatDetailedStatus({
    config,
    activeRecord: record,
    latestRecord: record,
    trackedIssueCount: 1,
    pr,
    checks: [],
    reviewThreads: [],
  });

  assert.match(status, /local_review .* repeated=3 stalled=yes/);
  assert.match(status, /blocked_reason=verification/);
});

test("formatDetailedStatus shows saved external review miss counts for the current PR head", () => {
  const config = createConfig();
  const pr: GitHubPullRequest = {
    number: 22,
    title: "Add review learning",
    url: "https://example.test/pr/22",
    state: "OPEN",
    createdAt: "2026-03-11T14:00:00Z",
    isDraft: false,
    reviewDecision: "CHANGES_REQUESTED",
    mergeStateStatus: "CLEAN",
    headRefName: "codex/issue-58",
    headRefOid: "deadbeef",
  };

  const status = formatDetailedStatus({
    config,
    activeRecord: createRecord({
      pr_number: 22,
      state: "addressing_review",
      external_review_head_sha: "deadbeef",
      external_review_misses_path: "/tmp/reviews/owner-repo/issue-58/external-review-misses-head-deadbeef.json",
      external_review_matched_findings_count: 1,
      external_review_near_match_findings_count: 1,
      external_review_missed_findings_count: 2,
    }),
    latestRecord: null,
    trackedIssueCount: 1,
    pr,
    checks: [],
    reviewThreads: [],
  });

  assert.match(status, /external_review head=current reviewed_head_sha=deadbeef matched=1 near_match=1 missed=2/);
  assert.match(status, /external_review_misses_path=owner-repo\/issue-58\/external-review-misses-head-deadbeef\.json/);
});

test("formatDetailedStatus surfaces not_requested Copilot review lifecycle", () => {
  const config = createConfig({ copilotReviewWaitMinutes: 10 });
  const pr: GitHubPullRequest = {
    number: 22,
    title: "Add review learning",
    url: "https://example.test/pr/22",
    state: "OPEN",
    createdAt: "2026-03-11T14:00:00Z",
    isDraft: false,
    reviewDecision: null,
    mergeStateStatus: "CLEAN",
    headRefName: "codex/issue-58",
    headRefOid: "deadbeef",
  };

  const status = formatDetailedStatus({
    config,
    activeRecord: createRecord({
      pr_number: 22,
      state: "pr_open",
      review_wait_started_at: new Date().toISOString(),
      review_wait_head_sha: "deadbeef",
    }),
    latestRecord: null,
    trackedIssueCount: 1,
    pr,
    checks: [],
    reviewThreads: [],
  });

  assert.match(status, /copilot_review state=not_requested/);
});

test("formatDetailedStatus surfaces unknown Copilot review lifecycle when hydration fails", () => {
  const config = createConfig({ copilotReviewWaitMinutes: 10 });
  const pr: GitHubPullRequest = {
    number: 22,
    title: "Add review learning",
    url: "https://example.test/pr/22",
    state: "OPEN",
    createdAt: "2026-03-11T14:00:00Z",
    isDraft: false,
    reviewDecision: null,
    mergeStateStatus: "CLEAN",
    headRefName: "codex/issue-58",
    headRefOid: "deadbeef",
    copilotReviewState: null,
    copilotReviewRequestedAt: null,
    copilotReviewArrivedAt: null,
  };

  const status = formatDetailedStatus({
    config,
    activeRecord: createRecord({
      pr_number: 22,
      state: "pr_open",
    }),
    latestRecord: null,
    trackedIssueCount: 1,
    pr,
    checks: [],
    reviewThreads: [],
  });

  assert.match(status, /copilot_review state=unknown requested_at=none arrived_at=none/);
});

test("formatDetailedStatus surfaces Copilot review timeout outcome", () => {
  const config = createConfig({ copilotReviewWaitMinutes: 10, copilotReviewTimeoutAction: "continue" });
  const pr: GitHubPullRequest = {
    number: 22,
    title: "Add review learning",
    url: "https://example.test/pr/22",
    state: "OPEN",
    createdAt: "2026-03-11T14:00:00Z",
    isDraft: false,
    reviewDecision: null,
    mergeStateStatus: "CLEAN",
    headRefName: "codex/issue-58",
    headRefOid: "deadbeef",
    copilotReviewState: "requested",
    copilotReviewRequestedAt: "2026-03-11T14:05:00Z",
    copilotReviewArrivedAt: null,
  };

  const status = formatDetailedStatus({
    config,
    activeRecord: createRecord({
      pr_number: 22,
      state: "ready_to_merge",
      copilot_review_timed_out_at: "2026-03-11T14:15:00Z",
      copilot_review_timeout_action: "continue",
      copilot_review_timeout_reason:
        "Requested Copilot review never arrived within 10 minute(s) for head deadbeef.",
    }),
    latestRecord: null,
    trackedIssueCount: 1,
    pr,
    checks: [],
    reviewThreads: [],
  });

  assert.match(status, /copilot_review state=requested requested_at=2026-03-11T14:05:00Z arrived_at=none timed_out_at=2026-03-11T14:15:00Z timeout_action=continue/);
  assert.match(status, /timeout_reason=Requested Copilot review never arrived within 10 minute\(s\) for head deadbeef\./);
});

test("formatDetailedStatus surfaces the latest recovery reason separately from the active issue", () => {
  const config = createConfig();
  const activeRecord = createRecord({
    issue_number: 92,
    state: "implementing",
    branch: "codex/issue-92",
    workspace: "/tmp/workspaces/issue-92",
    blocked_reason: null,
    last_error: null,
    last_failure_kind: null,
    last_failure_context: null,
    last_failure_signature: null,
    codex_session_id: null,
  });
  const latestRecoveryRecord = createRecord({
    issue_number: 91,
    state: "done",
    branch: "codex/issue-91",
    workspace: "/tmp/workspaces/issue-91",
    blocked_reason: null,
    last_error: null,
    last_failure_kind: null,
    last_failure_context: null,
    last_failure_signature: null,
    codex_session_id: null,
    updated_at: "2026-03-13T00:20:00Z",
    last_codex_summary: null,
    last_recovery_reason: "merged_pr_convergence: tracked PR #191 merged; marked issue #91 done",
    last_recovery_at: "2026-03-13T00:20:00Z",
  });

  const status = formatDetailedStatus({
    config,
    activeRecord,
    latestRecord: latestRecoveryRecord,
    latestRecoveryRecord,
    trackedIssueCount: 2,
    pr: null,
    checks: [],
    reviewThreads: [],
  });

  assert.match(
    status,
    /latest_recovery issue=#91 at=2026-03-13T00:20:00Z reason=merged_pr_convergence: tracked PR #191 merged; marked issue #91 done/,
  );
});

test("formatDetailedStatus marks stale local review as non-gating", () => {
  const config = createConfig({ localReviewPolicy: "block_merge" });
  const record = createRecord({
    local_review_head_sha: "oldhead",
    local_review_max_severity: "medium",
    local_review_findings_count: 2,
    local_review_recommendation: "changes_requested",
    local_review_run_at: "2026-03-11T14:05:00Z",
  });
  const pr: GitHubPullRequest = {
    number: 42,
    title: "Test PR",
    url: "https://example.test/pr/42",
    state: "OPEN",
    createdAt: "2026-03-11T14:00:00Z",
    isDraft: false,
    reviewDecision: null,
    mergeStateStatus: "CLEAN",
    mergeable: "MERGEABLE",
    headRefName: "codex/issue-42",
    headRefOid: "newhead",
    mergedAt: null,
  };

  const status = formatDetailedStatus({
    config,
    activeRecord: record,
    latestRecord: record,
    trackedIssueCount: 1,
    pr,
    checks: [],
    reviewThreads: [],
  });

  assert.match(
    status,
    /local_review gating=no policy=block_merge findings=2 root_causes=0 max_severity=medium verified_findings=0 verified_max_severity=none head=stale reviewed_head_sha=oldhead pr_head_sha=newhead ran_at=2026-03-11T14:05:00Z needs_review_run=yes drift=oldhead->newhead/,
  );
});

test("formatDetailedStatus reports unknown local review head status without a PR", () => {
  const config = createConfig({ localReviewPolicy: "block_merge" });
  const record = createRecord({
    local_review_head_sha: "oldhead",
    local_review_max_severity: "medium",
    local_review_findings_count: 2,
    local_review_recommendation: "changes_requested",
    local_review_run_at: "2026-03-11T14:05:00Z",
  });

  const status = formatDetailedStatus({
    config,
    activeRecord: record,
    latestRecord: record,
    trackedIssueCount: 1,
    pr: null,
    checks: [],
    reviewThreads: [],
  });

  assert.match(
    status,
    /local_review gating=no policy=block_merge findings=2 root_causes=0 max_severity=medium verified_findings=0 verified_max_severity=none head=unknown reviewed_head_sha=oldhead pr_head_sha=unknown ran_at=2026-03-11T14:05:00Z/,
  );
});

test("formatDetailedStatus reports none local review head status with current PR head", () => {
  const config = createConfig({ localReviewPolicy: "block_merge" });
  const record = createRecord({
    local_review_head_sha: null,
    local_review_run_at: null,
  });
  const pr: GitHubPullRequest = {
    number: 42,
    title: "Test PR",
    url: "https://example.test/pr/42",
    state: "OPEN",
    createdAt: "2026-03-11T14:00:00Z",
    isDraft: false,
    reviewDecision: null,
    mergeStateStatus: "CLEAN",
    mergeable: "MERGEABLE",
    headRefName: "codex/issue-42",
    headRefOid: "newhead",
    mergedAt: null,
  };

  const status = formatDetailedStatus({
    config,
    activeRecord: record,
    latestRecord: record,
    trackedIssueCount: 1,
    pr,
    checks: [],
    reviewThreads: [],
  });

  assert.match(
    status,
    /local_review gating=no policy=block_merge findings=0 root_causes=0 max_severity=none verified_findings=0 verified_max_severity=none head=none reviewed_head_sha=none pr_head_sha=newhead ran_at=none/,
  );
  assert.doesNotMatch(status, /blocker_summary=/);
});

test("localReviewHighSeverityNeedsRetry only escalates verifier-confirmed high findings", () => {
  const config = createConfig({ localReviewPolicy: "block_ready", localReviewHighSeverityAction: "retry" });
  const pr: GitHubPullRequest = {
    number: 42,
    title: "Test PR",
    url: "https://example.test/pr/42",
    state: "OPEN",
    createdAt: "2026-03-11T14:00:00Z",
    isDraft: true,
    reviewDecision: null,
    mergeStateStatus: "CLEAN",
    mergeable: "MERGEABLE",
    headRefName: "codex/issue-42",
    headRefOid: "deadbeef",
    mergedAt: null,
  };

  assert.equal(
    localReviewHighSeverityNeedsRetry(
      config,
      {
        local_review_head_sha: "deadbeef",
        local_review_verified_max_severity: "none",
      },
      pr,
    ),
    false,
  );

  assert.equal(
    localReviewHighSeverityNeedsRetry(
      config,
      {
        local_review_head_sha: "deadbeef",
        local_review_verified_max_severity: "high",
      },
      pr,
    ),
    true,
  );
});
