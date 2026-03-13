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

async function createSupervisorFixture(): Promise<{
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
  git(["clone", remotePath, repoPath]);
  git(["-C", repoPath, "branch", "--set-upstream-to=origin/main", "main"]);

  await fs.writeFile(
    codexBinary,
    [
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
    ].join("\n"),
    "utf8",
  );
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
    body: "",
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
    body: "",
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
    /local_review gating=yes policy=block_ready findings=3 root_causes=0 max_severity=high verified_findings=0 verified_max_severity=none head=current reviewed_head_sha=deadbeef pr_head_sha=deadbeef ran_at=2026-03-11T14:05:00Z signature=none repeated=0 stalled=no/,
  );
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
    /local_review gating=no policy=block_merge findings=2 root_causes=0 max_severity=medium verified_findings=0 verified_max_severity=none head=stale reviewed_head_sha=oldhead pr_head_sha=newhead ran_at=2026-03-11T14:05:00Z/,
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
