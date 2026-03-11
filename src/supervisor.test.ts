import test from "node:test";
import assert from "node:assert/strict";
import { reconcileRecoverableBlockedIssueStates, shouldAutoRetryHandoffMissing } from "./supervisor";
import { GitHubIssue, IssueRunRecord, SupervisorConfig, SupervisorStateFile } from "./types";

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
    reviewBotLogins: [],
    humanReviewBlocksMerge: true,
    issueJournalRelativePath: ".codex-supervisor/issue-journal.md",
    issueJournalMaxChars: 6000,
    skipTitlePrefixes: [],
    branchPrefix: "codex/reopen-issue-",
    pollIntervalSeconds: 60,
    copilotReviewWaitMinutes: 10,
    codexExecTimeoutMinutes: 30,
    maxCodexAttemptsPerIssue: 5,
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
    codex_session_id: "session-1",
    local_review_head_sha: null,
    local_review_summary_path: null,
    local_review_run_at: null,
    local_review_max_severity: null,
    local_review_findings_count: 0,
    local_review_recommendation: null,
    local_review_degraded: false,
    attempt_count: 2,
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

test("shouldAutoRetryHandoffMissing only retries recoverable blocked handoffs", () => {
  const config = createConfig();

  assert.equal(shouldAutoRetryHandoffMissing(createRecord(), config), true);
  assert.equal(shouldAutoRetryHandoffMissing(createRecord({ pr_number: 12 }), config), false);
  assert.equal(
    shouldAutoRetryHandoffMissing(
      createRecord({ repeated_failure_signature_count: config.sameFailureSignatureRepeatLimit }),
      config,
    ),
    false,
  );
  assert.equal(
    shouldAutoRetryHandoffMissing(createRecord({ attempt_count: config.maxCodexAttemptsPerIssue }), config),
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
