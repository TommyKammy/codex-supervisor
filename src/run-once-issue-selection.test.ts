import test from "node:test";
import assert from "node:assert/strict";
import { resolveRunnableIssueContext } from "./run-once-issue-selection";
import { GitHubIssue, IssueRunRecord, SupervisorConfig, SupervisorStateFile } from "./core/types";

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

function executionReadyBody(summary: string): string {
  return `## Summary
${summary}

## Scope
- implement the issue

## Acceptance criteria
- the issue can proceed

## Verification
- npm test -- src/run-once-issue-selection.test.ts`;
}

function createTouchStateStore(savedStates: SupervisorStateFile[]) {
  return {
    touch(record: IssueRunRecord, patch: Partial<IssueRunRecord>): IssueRunRecord {
      return {
        ...record,
        ...patch,
        updated_at: record.updated_at,
      };
    },
    async save(state: SupervisorStateFile): Promise<void> {
      savedStates.push(structuredClone(state));
    },
  };
}

function createRecord(issueNumber: number, overrides: Partial<IssueRunRecord> = {}): IssueRunRecord {
  return {
    issue_number: issueNumber,
    state: "queued",
    branch: `codex/reopen-issue-${issueNumber}`,
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
    attempt_count: 0,
    implementation_attempt_count: 0,
    repair_attempt_count: 0,
    timeout_retry_count: 0,
    blocked_verification_retry_count: 0,
    repeated_blocker_count: 0,
    repeated_failure_signature_count: 0,
    last_head_sha: null,
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
    updated_at: "2026-03-15T00:00:00Z",
    ...overrides,
  };
}

test("resolveRunnableIssueContext blocks non-ready issues, syncs journals, and releases the issue lock before restarting", async () => {
  const config = createConfig();
  const issue: GitHubIssue = {
    number: 91,
    title: "Underspecified issue",
    body: `## Summary
Add execution-ready gating.`,
    createdAt: "2026-03-15T00:00:00Z",
    updatedAt: "2026-03-15T00:00:00Z",
    url: "https://example.test/issues/91",
    state: "OPEN",
  };
  const state: SupervisorStateFile = {
    activeIssueNumber: null,
    issues: {},
  };
  const savedStates: SupervisorStateFile[] = [];
  const journalSyncs: IssueRunRecord[] = [];
  let released = false;

  const result = await resolveRunnableIssueContext({
    github: {
      listCandidateIssues: async () => [issue],
      getIssue: async () => issue,
    },
    config,
    stateStore: createTouchStateStore(savedStates),
    state,
    currentRecord: null,
    acquireIssueLock: async () => ({
      acquired: true,
      release: async () => {
        released = true;
      },
    }),
    ensureRecordJournalContext: async (record) => ({
      workspace: record.workspace,
      journal_path: "/tmp/workspaces/issue-91/.codex-supervisor/issue-journal.md",
    }),
    syncIssueJournal: async ({ record }) => {
      journalSyncs.push(record);
    },
  });

  assert.deepEqual(result, { kind: "restart" });
  assert.equal(released, true);
  assert.equal(state.activeIssueNumber, null);
  assert.equal(savedStates.length, 2);
  assert.equal(state.issues["91"]?.state, "blocked");
  assert.equal(state.issues["91"]?.blocked_reason, "requirements");
  assert.match(state.issues["91"]?.last_error ?? "", /missing required execution-ready metadata/i);
  assert.equal(journalSyncs.length, 1);
  assert.equal(journalSyncs[0]?.issue_number, 91);
});

test("resolveRunnableIssueContext keeps the acquired lock attached to a ready issue handoff", async () => {
  const config = createConfig();
  const issue: GitHubIssue = {
    number: 92,
    title: "Ready issue",
    body: executionReadyBody("Ship the ready issue."),
    createdAt: "2026-03-15T00:00:00Z",
    updatedAt: "2026-03-15T00:00:00Z",
    url: "https://example.test/issues/92",
    state: "OPEN",
  };
  const state: SupervisorStateFile = {
    activeIssueNumber: null,
    issues: {},
  };
  const savedStates: SupervisorStateFile[] = [];
  let released = false;
  const issueLock = {
    acquired: true as const,
    release: async () => {
      released = true;
    },
  };

  const result = await resolveRunnableIssueContext({
    github: {
      listCandidateIssues: async () => [issue],
      getIssue: async () => issue,
    },
    config,
    stateStore: createTouchStateStore(savedStates),
    state,
    currentRecord: null,
    acquireIssueLock: async () => issueLock,
  });

  assert.ok(typeof result !== "string");
  assert.equal(result.kind, "ready");
  assert.equal(result.record.issue_number, 92);
  assert.equal(result.issue.number, 92);
  assert.equal(result.issueLock, issueLock);
  assert.equal(released, false);
  assert.equal(state.activeIssueNumber, 92);
  assert.equal(state.issues["92"]?.issue_number, 92);
  assert.equal(savedStates.length, 1);
});

test("resolveRunnableIssueContext does not persist a new active reservation when the issue lock is busy", async () => {
  const config = createConfig();
  const issue: GitHubIssue = {
    number: 93,
    title: "Ready issue",
    body: executionReadyBody("Ship the ready issue."),
    createdAt: "2026-03-15T00:00:00Z",
    updatedAt: "2026-03-15T00:00:00Z",
    url: "https://example.test/issues/93",
    state: "OPEN",
  };
  const state: SupervisorStateFile = {
    activeIssueNumber: null,
    issues: {},
  };
  const savedStates: SupervisorStateFile[] = [];

  const result = await resolveRunnableIssueContext({
    github: {
      listCandidateIssues: async () => [issue],
      getIssue: async () => issue,
    },
    config,
    stateStore: createTouchStateStore(savedStates),
    state,
    currentRecord: null,
    acquireIssueLock: async () => ({
      acquired: false,
      reason: "lock held by pid 123 for issue-93",
      release: async () => {},
    }),
  });

  assert.equal(result, "Skipped issue #93: lock held by pid 123 for issue-93.");
  assert.equal(state.activeIssueNumber, null);
  assert.deepEqual(state.issues, {});
  assert.equal(savedStates.length, 0);
});

test("resolveRunnableIssueContext emits typed active-issue and loop-skip events", async () => {
  const config = createConfig();
  const issue: GitHubIssue = {
    number: 93,
    title: "Ready issue",
    body: executionReadyBody("Ship the ready issue."),
    createdAt: "2026-03-15T00:00:00Z",
    updatedAt: "2026-03-15T00:00:00Z",
    url: "https://example.test/issues/93",
    state: "OPEN",
  };
  const emitted: unknown[] = [];

  const readyState: SupervisorStateFile = {
    activeIssueNumber: null,
    issues: {},
  };
  await resolveRunnableIssueContext({
    github: {
      listCandidateIssues: async () => [issue],
      getIssue: async () => issue,
    },
    config,
    stateStore: createTouchStateStore([]),
    state: readyState,
    currentRecord: null,
    emitEvent: (event) => {
      emitted.push(event);
    },
    acquireIssueLock: async () => ({
      acquired: true,
      release: async () => {},
    }),
  });

  const skippedState: SupervisorStateFile = {
    activeIssueNumber: null,
    issues: {},
  };
  await resolveRunnableIssueContext({
    github: {
      listCandidateIssues: async () => [issue],
      getIssue: async () => issue,
    },
    config,
    stateStore: createTouchStateStore([]),
    state: skippedState,
    currentRecord: null,
    emitEvent: (event) => {
      emitted.push(event);
    },
    acquireIssueLock: async () => ({
      acquired: false,
      reason: "lock held by pid 123 for issue-93",
      release: async () => {},
    }),
  });

  assert.deepEqual(
    emitted.map((event) => ({ ...(event as Record<string, unknown>), at: "normalized" })),
    [
    {
      type: "supervisor.active_issue.changed",
      family: "active_issue",
      issueNumber: 93,
      previousIssueNumber: null,
      nextIssueNumber: 93,
      reason: "reserved_for_cycle",
      at: "normalized",
    },
    {
      type: "supervisor.loop.skipped",
      family: "loop_skip",
      issueNumber: 93,
      reason: "issue_lock_unavailable",
      detail: "lock held by pid 123 for issue-93",
      at: "normalized",
    },
    ],
  );
});

test("resolveRunnableIssueContext skips Epic issues and selects a runnable child issue", async () => {
  const config = createConfig({
    skipTitlePrefixes: ["Epic:"],
  });
  const epicIssue: GitHubIssue = {
    number: 93,
    title: "Epic: Scheduler policy rollout",
    body: executionReadyBody("Track the scheduler workstream."),
    createdAt: "2026-03-15T00:00:00Z",
    updatedAt: "2026-03-15T00:00:00Z",
    url: "https://example.test/issues/93",
    state: "OPEN",
  };
  const childIssue: GitHubIssue = {
    number: 94,
    title: "Implement Epic child issue",
    body: `${executionReadyBody("Ship the runnable child implementation.")}

Part of: #93`,
    createdAt: "2026-03-15T00:05:00Z",
    updatedAt: "2026-03-15T00:05:00Z",
    url: "https://example.test/issues/94",
    state: "OPEN",
  };
  const state: SupervisorStateFile = {
    activeIssueNumber: null,
    issues: {},
  };
  const savedStates: SupervisorStateFile[] = [];

  const result = await resolveRunnableIssueContext({
    github: {
      listCandidateIssues: async () => [epicIssue, childIssue],
      getIssue: async (issueNumber) => (issueNumber === epicIssue.number ? epicIssue : childIssue),
    },
    config,
    stateStore: createTouchStateStore(savedStates),
    state,
    currentRecord: null,
    acquireIssueLock: async () => ({
      acquired: true,
      release: async () => {},
    }),
  });

  assert.ok(typeof result !== "string");
  assert.equal(result.kind, "ready");
  assert.equal(result.issue.number, 94);
  assert.equal(state.activeIssueNumber, 94);
  assert.equal(savedStates.length, 1);
});

test("resolveRunnableIssueContext reuses the current reserved issue instead of claiming another candidate in the same cycle", async () => {
  const config = createConfig();
  const currentIssue: GitHubIssue = {
    number: 92,
    title: "Already reserved issue",
    body: executionReadyBody("Keep working on the already reserved issue."),
    createdAt: "2026-03-15T00:00:00Z",
    updatedAt: "2026-03-15T00:00:00Z",
    url: "https://example.test/issues/92",
    state: "OPEN",
  };
  const otherIssue: GitHubIssue = {
    number: 93,
    title: "Another ready issue",
    body: executionReadyBody("This issue should not be claimed in the same cycle."),
    createdAt: "2026-03-15T00:05:00Z",
    updatedAt: "2026-03-15T00:05:00Z",
    url: "https://example.test/issues/93",
    state: "OPEN",
  };
  const state: SupervisorStateFile = {
    activeIssueNumber: 92,
    issues: {
      "92": createRecord(92, {
        state: "queued",
        blocked_reason: "verification",
        blocked_verification_retry_count: 1,
        last_error: "Auto-retrying after verification failure (1/3). Previous blocker: verification still failing",
      }),
    },
  };
  const savedStates: SupervisorStateFile[] = [];
  const requestedIssueNumbers: number[] = [];

  const result = await resolveRunnableIssueContext({
    github: {
      listCandidateIssues: async () => [otherIssue],
      getIssue: async (issueNumber) => {
        requestedIssueNumbers.push(issueNumber);
        return issueNumber === currentIssue.number ? currentIssue : otherIssue;
      },
    },
    config,
    stateStore: createTouchStateStore(savedStates),
    state,
    currentRecord: state.issues["92"] ?? null,
    acquireIssueLock: async () => ({
      acquired: true,
      release: async () => {},
    }),
  });

  assert.ok(typeof result !== "string");
  assert.equal(result.kind, "ready");
  assert.equal(result.record.issue_number, 92);
  assert.equal(result.issue.number, 92);
  assert.deepEqual(requestedIssueNumbers, [92]);
  assert.equal(state.activeIssueNumber, 92);
  assert.deepEqual(Object.keys(state.issues), ["92"]);
  assert.equal(savedStates.length, 0);
});

test("resolveRunnableIssueContext restarts closed issues instead of handing them off as ready", async () => {
  const config = createConfig();
  const selectedIssue: GitHubIssue = {
    number: 94,
    title: "Ready issue",
    body: executionReadyBody("Ship the ready issue."),
    createdAt: "2026-03-15T00:00:00Z",
    updatedAt: "2026-03-15T00:00:00Z",
    url: "https://example.test/issues/94",
    state: "OPEN",
  };
  const closedIssue: GitHubIssue = {
    ...selectedIssue,
    state: "CLOSED",
  };
  const state: SupervisorStateFile = {
    activeIssueNumber: null,
    issues: {},
  };
  const savedStates: SupervisorStateFile[] = [];
  let released = false;

  const result = await resolveRunnableIssueContext({
    github: {
      listCandidateIssues: async () => [selectedIssue],
      getIssue: async () => closedIssue,
    },
    config,
    stateStore: createTouchStateStore(savedStates),
    state,
    currentRecord: null,
    acquireIssueLock: async () => ({
      acquired: true,
      release: async () => {
        released = true;
      },
    }),
  });

  assert.deepEqual(result, { kind: "restart" });
  assert.equal(released, true);
  assert.equal(state.activeIssueNumber, null);
  assert.equal(state.issues["94"]?.state, "done");
  assert.equal(savedStates.length, 2);
});

test("resolveRunnableIssueContext skips dependency-blocked candidates and reserves the next ready issue", async () => {
  const config = createConfig();
  const dependencyIssue: GitHubIssue = {
    number: 91,
    title: "Step 1",
    body: `## Summary
Do the first step.

## Scope
- implement the dependency

## Acceptance criteria
- dependency lands first

## Verification
- npm test -- src/run-once-issue-selection.test.ts

Part of: #150
Execution order: 1 of 2`,
    createdAt: "2026-03-15T00:00:00Z",
    updatedAt: "2026-03-15T00:00:00Z",
    url: "https://example.test/issues/91",
    state: "OPEN",
  };
  const blockedIssue: GitHubIssue = {
    number: 92,
    title: "Step 2",
    body: `## Summary
Do the second step.

## Scope
- wait for the first step

## Acceptance criteria
- execution order respected

## Verification
- npm test -- src/run-once-issue-selection.test.ts

Part of: #150
Execution order: 2 of 2`,
    createdAt: "2026-03-15T00:05:00Z",
    updatedAt: "2026-03-15T00:05:00Z",
    url: "https://example.test/issues/92",
    state: "OPEN",
  };
  const readyIssue: GitHubIssue = {
    number: 93,
    title: "Independent ready issue",
    body: executionReadyBody("Ship the ready issue."),
    createdAt: "2026-03-15T00:10:00Z",
    updatedAt: "2026-03-15T00:10:00Z",
    url: "https://example.test/issues/93",
    state: "OPEN",
  };
  const state: SupervisorStateFile = {
    activeIssueNumber: null,
    issues: {
      "91": {
        issue_number: 91,
        state: "failed",
        branch: "codex/reopen-issue-91",
        pr_number: null,
        workspace: "/tmp/workspaces/issue-91",
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
        attempt_count: 1,
        implementation_attempt_count: 1,
        repair_attempt_count: 0,
        timeout_retry_count: 0,
        blocked_verification_retry_count: 0,
        repeated_blocker_count: 0,
        repeated_failure_signature_count: 0,
        last_head_sha: null,
        last_codex_summary: null,
        last_recovery_reason: null,
        last_recovery_at: null,
        last_error: "previous failure",
        last_failure_kind: "command_error",
        last_failure_context: null,
        last_blocker_signature: null,
        last_failure_signature: null,
        blocked_reason: null,
        processed_review_thread_ids: [],
        processed_review_thread_fingerprints: [],
        updated_at: "2026-03-15T00:00:00Z",
      },
    },
  };
  const savedStates: SupervisorStateFile[] = [];
  const requestedIssueNumbers: number[] = [];

  const result = await resolveRunnableIssueContext({
    github: {
      listCandidateIssues: async () => [dependencyIssue, blockedIssue, readyIssue],
      getIssue: async (issueNumber) => {
        requestedIssueNumbers.push(issueNumber);
        return readyIssue;
      },
    },
    config,
    stateStore: createTouchStateStore(savedStates),
    state,
    currentRecord: null,
    acquireIssueLock: async () => ({
      acquired: true,
      release: async () => {},
    }),
  });

  assert.ok(typeof result !== "string");
  assert.equal(result.kind, "ready");
  assert.equal(result.record.issue_number, 93);
  assert.deepEqual(requestedIssueNumbers, [93]);
  assert.equal(state.activeIssueNumber, 93);
  assert.equal(state.issues["92"], undefined);
  assert.equal(savedStates.length, 1);
});
