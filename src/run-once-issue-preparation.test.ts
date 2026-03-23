import test from "node:test";
import assert from "node:assert/strict";
import {
  isRestartRunOnce,
  prepareIssueExecutionContext,
} from "./run-once-issue-preparation";
import {
  GitHubIssue,
  GitHubPullRequest,
  IssueRunRecord,
  SupervisorConfig,
  SupervisorStateFile,
  WorkspaceStatus,
} from "./core/types";

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
      generic: { confidenceThreshold: 0.7, minimumSeverity: "low" },
      specialist: { confidenceThreshold: 0.7, minimumSeverity: "low" },
    },
    localReviewPolicy: "block_ready",
    localReviewHighSeverityAction: "retry",
    reviewBotLogins: [],
    humanReviewBlocksMerge: true,
    issueJournalRelativePath: ".codex-supervisor/issue-journal.md",
    issueJournalMaxChars: 6000,
    candidateDiscoveryFetchWindow: 100,
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
    issue_number: 240,
    state: "reproducing",
    branch: "codex/reopen-issue-240",
    pr_number: null,
    workspace: "/tmp/workspaces/issue-240",
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
    last_codex_summary: "previous summary",
    last_recovery_reason: null,
    last_recovery_at: null,
    last_error: "previous error",
    last_failure_kind: "command_error",
    last_failure_context: null,
    last_blocker_signature: null,
    last_failure_signature: null,
    blocked_reason: "handoff_missing",
    processed_review_thread_ids: [],
    processed_review_thread_fingerprints: [],
    updated_at: "2026-03-15T00:00:00Z",
    ...overrides,
  };
}

function createIssue(overrides: Partial<GitHubIssue> = {}): GitHubIssue {
  return {
    number: 240,
    title: "Extract preparation flow",
    body: "",
    createdAt: "2026-03-15T00:00:00Z",
    updatedAt: "2026-03-15T00:00:00Z",
    url: "https://example.test/issues/240",
    state: "OPEN",
    ...overrides,
  };
}

function createWorkspaceStatus(overrides: Partial<WorkspaceStatus> = {}): WorkspaceStatus {
  return {
    branch: "codex/reopen-issue-240",
    headSha: "head-240",
    hasUncommittedChanges: false,
    baseAhead: 0,
    baseBehind: 0,
    remoteBranchExists: false,
    remoteAhead: 0,
    remoteBehind: 0,
    ...overrides,
  };
}

function createPullRequest(overrides: Partial<GitHubPullRequest> = {}): GitHubPullRequest {
  return {
    number: 240,
    title: "Extract preparation flow",
    url: "https://example.test/pr/240",
    state: "OPEN",
    createdAt: "2026-03-15T00:10:00Z",
    isDraft: true,
    reviewDecision: null,
    mergeStateStatus: "CLEAN",
    mergeable: "MERGEABLE",
    headRefName: "codex/reopen-issue-240",
    headRefOid: "pr-head-240",
    mergedAt: null,
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

test("prepareIssueExecutionContext prepares workspace, journal, memory, and head state", async () => {
  const record = createRecord();
  const state = createState(record);
  const config = createConfig();
  const issue = createIssue();
  const workspaceStatus = createWorkspaceStatus({ headSha: "workspace-head-240" });
  const saveSnapshots: SupervisorStateFile[] = [];
  const touchedRecords: IssueRunRecord[] = [];
  const resolvePurposes: Array<"status" | "action" | undefined> = [];
  const replaySnapshots: Array<{
    pr: GitHubPullRequest | null;
    checks: { name: string; state: string; bucket: string }[];
    recordState: IssueRunRecord["state"];
    workspaceHead: string;
  }> = [];

  const result = await prepareIssueExecutionContext({
    github: {
      resolvePullRequestForBranch: async (_branch, _prNumber, options) => {
        resolvePurposes.push(options?.purpose);
        return null;
      },
      getChecks: async () => [],
      getUnresolvedReviewThreads: async () => [],
      createPullRequest: async () => {
        throw new Error("unexpected createPullRequest call");
      },
    },
    config,
    stateStore: {
      touch(currentRecord, patch) {
        const nextRecord = { ...currentRecord, ...patch };
        touchedRecords.push(nextRecord);
        return nextRecord;
      },
      async save(currentState) {
        saveSnapshots.push(JSON.parse(JSON.stringify(currentState)));
      },
    },
    state,
    record,
    issue,
    options: { dryRun: true },
    ensureWorkspace: async () => "/tmp/workspaces/issue-240",
    syncIssueJournal: async ({ journalPath, record: currentRecord }) => {
      assert.equal(journalPath, "/tmp/workspaces/issue-240/.codex-supervisor/issue-journal.md");
      assert.equal(currentRecord.state, "planning");
    },
    syncMemoryArtifacts: async ({ workspacePath, journalPath }) => {
      assert.equal(workspacePath, "/tmp/workspaces/issue-240");
      assert.equal(journalPath, "/tmp/workspaces/issue-240/.codex-supervisor/issue-journal.md");
      return {
        contextIndexPath: "/tmp/context-index.md",
        agentsPath: "/tmp/AGENTS.generated.md",
        alwaysReadFiles: ["/tmp/AGENTS.generated.md", "/tmp/context-index.md", journalPath],
        onDemandFiles: [],
      };
    },
    getWorkspaceStatus: async () => workspaceStatus,
    writeSupervisorCycleDecisionSnapshot: async ({ pr, checks, record: snapshotRecord, workspaceStatus: snapshotWorkspaceStatus }) => {
      replaySnapshots.push({
        pr,
        checks,
        recordState: snapshotRecord.state,
        workspaceHead: snapshotWorkspaceStatus.headSha,
      });
      return "/tmp/workspaces/issue-240/.codex-supervisor/replay/decision-cycle-snapshot.json";
    },
  });

  assert.equal(typeof result, "object");
  assert.ok(result && !isRestartRunOnce(result) && typeof result !== "string");
  assert.equal(result.record.state, "planning");
  assert.equal(result.record.last_head_sha, "workspace-head-240");
  assert.equal(result.previousCodexSummary, "previous summary");
  assert.equal(result.previousError, "previous error");
  assert.equal(result.workspacePath, "/tmp/workspaces/issue-240");
  assert.equal(result.journalPath, "/tmp/workspaces/issue-240/.codex-supervisor/issue-journal.md");
  assert.equal(result.pr, null);
  assert.deepEqual(resolvePurposes, ["action"]);
  assert.equal(saveSnapshots.length, 2);
  assert.equal(saveSnapshots[0]?.issues["240"]?.journal_path, "/tmp/workspaces/issue-240/.codex-supervisor/issue-journal.md");
  assert.equal(saveSnapshots[1]?.issues["240"]?.last_head_sha, "workspace-head-240");
  assert.equal(touchedRecords.at(-1)?.last_head_sha, "workspace-head-240");
  assert.deepEqual(replaySnapshots, [
    {
      pr: null,
      checks: [],
      recordState: "planning",
      workspaceHead: "workspace-head-240",
    },
  ]);
});

test("prepareIssueExecutionContext records the workspace restore source for later diagnostics", async () => {
  const record = createRecord();
  const state = createState(record);
  const workspaceStatus = createWorkspaceStatus({ headSha: "workspace-head-240" });

  const result = await prepareIssueExecutionContext({
    github: {
      resolvePullRequestForBranch: async () => null,
      getChecks: async () => [],
      getUnresolvedReviewThreads: async () => [],
      createPullRequest: async () => {
        throw new Error("unexpected createPullRequest call");
      },
    },
    config: createConfig(),
    stateStore: {
      touch(currentRecord, patch) {
        return { ...currentRecord, ...patch };
      },
      async save() {},
    },
    state,
    record,
    issue: createIssue(),
    options: { dryRun: true },
    ensureWorkspace: async () => ({
      workspacePath: "/tmp/workspaces/issue-240",
      restore: {
        source: "local_branch",
        ref: "codex/reopen-issue-240",
      },
    }),
    syncIssueJournal: async () => {},
    syncMemoryArtifacts: async () => ({
      contextIndexPath: "/tmp/context-index.md",
      agentsPath: "/tmp/AGENTS.generated.md",
      alwaysReadFiles: [],
      onDemandFiles: [],
    }),
    getWorkspaceStatus: async () => workspaceStatus,
    writeSupervisorCycleDecisionSnapshot: async () => "/tmp/workspaces/issue-240/.codex-supervisor/replay/decision-cycle-snapshot.json",
  });

  assert.ok(result && !isRestartRunOnce(result) && typeof result !== "string");
  assert.equal(result.record.workspace_restore_source, "local_branch");
  assert.equal(result.record.workspace_restore_ref, "codex/reopen-issue-240");
  assert.equal(result.workspaceStatus.restoreSource, "local_branch");
  assert.equal(result.workspaceStatus.restoreRef, "codex/reopen-issue-240");
});

test("prepareIssueExecutionContext preserves last_error for repeated no-PR failure tracking", async () => {
  const staleNoPrSummary =
    "Issue #240 re-entered stale stabilizing recovery without a tracked PR; the supervisor will retry while the repeat count remains below 3.";
  const record = createRecord({
    state: "stabilizing",
    pr_number: null,
    last_error: staleNoPrSummary,
    last_failure_context: {
      category: "blocked",
      summary: staleNoPrSummary,
      signature: "stale-stabilizing-no-pr-recovery-loop",
      command: null,
      details: ["state=stabilizing", "tracked_pr=none"],
      url: null,
      updated_at: "2026-03-15T00:00:00Z",
    },
    last_failure_signature: "stale-stabilizing-no-pr-recovery-loop",
    repeated_failure_signature_count: 1,
  });
  const state = createState(record);

  const result = await prepareIssueExecutionContext({
    github: {
      resolvePullRequestForBranch: async () => null,
      getChecks: async () => [],
      getUnresolvedReviewThreads: async () => [],
      createPullRequest: async () => {
        throw new Error("unexpected createPullRequest call");
      },
    },
    config: createConfig(),
    stateStore: {
      touch(currentRecord, patch) {
        return { ...currentRecord, ...patch };
      },
      async save() {},
    },
    state,
    record,
    issue: createIssue(),
    options: { dryRun: true },
    ensureWorkspace: async () => "/tmp/workspaces/issue-240",
    syncIssueJournal: async () => {},
    syncMemoryArtifacts: async () => ({
      contextIndexPath: "/tmp/context-index.md",
      agentsPath: "/tmp/AGENTS.generated.md",
      alwaysReadFiles: [],
      onDemandFiles: [],
    }),
    getWorkspaceStatus: async () => createWorkspaceStatus(),
    writeSupervisorCycleDecisionSnapshot: async () => "/tmp/workspaces/issue-240/.codex-supervisor/replay/decision-cycle-snapshot.json",
  });

  assert.ok(result && !isRestartRunOnce(result) && typeof result !== "string");
  assert.equal(result.record.last_error, staleNoPrSummary);
  assert.equal(state.issues["240"]?.last_error, staleNoPrSummary);
});

test("prepareIssueExecutionContext preserves restore metadata after refreshing workspace status", async () => {
  const record = createRecord();
  const state = createState(record);
  const statusReads = [
    createWorkspaceStatus({
      headSha: "workspace-head-before-push",
      remoteBranchExists: true,
      remoteAhead: 2,
    }),
    createWorkspaceStatus({
      headSha: "workspace-head-after-push",
      remoteBranchExists: true,
      remoteAhead: 0,
    }),
  ];
  const pushCalls: Array<{ workspacePath: string; branch: string; remoteBranchExists: boolean }> = [];
  const replaySnapshots: WorkspaceStatus[] = [];

  const result = await prepareIssueExecutionContext({
    github: {
      resolvePullRequestForBranch: async () => null,
      getChecks: async () => [],
      getUnresolvedReviewThreads: async () => [],
      createPullRequest: async () => {
        throw new Error("unexpected createPullRequest call");
      },
    },
    config: createConfig(),
    stateStore: {
      touch(currentRecord, patch) {
        return { ...currentRecord, ...patch };
      },
      async save() {},
    },
    state,
    record,
    issue: createIssue(),
    options: { dryRun: true },
    ensureWorkspace: async () => ({
      workspacePath: "/tmp/workspaces/issue-240",
      restore: {
        source: "local_branch",
        ref: "codex/reopen-issue-240",
      },
    }),
    syncIssueJournal: async () => {},
    syncMemoryArtifacts: async () => ({
      contextIndexPath: "/tmp/context-index.md",
      agentsPath: "/tmp/AGENTS.generated.md",
      alwaysReadFiles: [],
      onDemandFiles: [],
    }),
    getWorkspaceStatus: async () => {
      const nextStatus = statusReads.shift();
      assert.ok(nextStatus, "expected workspace status fixture");
      return nextStatus;
    },
    pushBranch: async (workspacePath, branch, remoteBranchExists) => {
      pushCalls.push({ workspacePath, branch, remoteBranchExists });
    },
    writeSupervisorCycleDecisionSnapshot: async ({ workspaceStatus }) => {
      replaySnapshots.push(workspaceStatus);
      return "/tmp/workspaces/issue-240/.codex-supervisor/replay/decision-cycle-snapshot.json";
    },
  });

  assert.ok(result && !isRestartRunOnce(result) && typeof result !== "string");
  assert.deepEqual(pushCalls, [
    {
      workspacePath: "/tmp/workspaces/issue-240",
      branch: "codex/reopen-issue-240",
      remoteBranchExists: true,
    },
  ]);
  assert.equal(result.workspaceStatus.headSha, "workspace-head-after-push");
  assert.equal(result.workspaceStatus.restoreSource, "local_branch");
  assert.equal(result.workspaceStatus.restoreRef, "codex/reopen-issue-240");
  assert.equal(replaySnapshots[0]?.restoreSource, "local_branch");
  assert.equal(replaySnapshots[0]?.restoreRef, "codex/reopen-issue-240");
});

test("prepareIssueExecutionContext restarts when a tracked PR already merged", async () => {
  const record = createRecord({
    implementation_attempt_count: 2,
    pr_number: 191,
    state: "pr_open",
  });
  const state = createState(record);
  const issue = createIssue();
  const mergedPr = createPullRequest({
    number: 191,
    state: "MERGED",
    isDraft: false,
    headRefOid: "merged-head-191",
    mergedAt: "2026-03-15T00:20:00Z",
  });

  const result = await prepareIssueExecutionContext({
    github: {
      resolvePullRequestForBranch: async () => mergedPr,
      getChecks: async () => {
        throw new Error("unexpected getChecks call");
      },
      getUnresolvedReviewThreads: async () => {
        throw new Error("unexpected getUnresolvedReviewThreads call");
      },
      createPullRequest: async () => {
        throw new Error("unexpected createPullRequest call");
      },
    },
    config: createConfig(),
    stateStore: {
      touch(currentRecord, patch) {
        return { ...currentRecord, ...patch };
      },
      async save() {},
    },
    state,
    record,
    issue,
    options: { dryRun: true },
    ensureWorkspace: async () => "/tmp/workspaces/issue-240",
    syncIssueJournal: async () => {},
    syncMemoryArtifacts: async () => ({
      contextIndexPath: "/tmp/context-index.md",
      agentsPath: "/tmp/AGENTS.generated.md",
      alwaysReadFiles: [],
      onDemandFiles: [],
    }),
    getWorkspaceStatus: async () => createWorkspaceStatus(),
    now: () => "2026-03-15T00:30:00Z",
  });

  assert.ok(isRestartRunOnce(result));
  assert.equal(result.recoveryEvents?.[0]?.reason, "merged_pr_convergence: tracked PR #191 merged; marked issue #240 done");
  assert.equal(state.activeIssueNumber, null);
  assert.equal(state.issues["240"]?.state, "done");
  assert.equal(state.issues["240"]?.pr_number, 191);
  assert.equal(state.issues["240"]?.last_head_sha, "merged-head-191");
});

test("prepareIssueExecutionContext blocks and syncs the journal when a tracked PR was closed", async () => {
  const record = createRecord({
    implementation_attempt_count: 2,
    pr_number: 44,
    state: "pr_open",
    last_failure_signature: "old",
    repeated_failure_signature_count: 2,
  });
  const state = createState(record);
  const issue = createIssue();
  const closedPr = createPullRequest({
    number: 44,
    state: "CLOSED",
    headRefOid: "closed-head-44",
  });
  const journalSyncs: string[] = [];

  const result = await prepareIssueExecutionContext({
    github: {
      resolvePullRequestForBranch: async () => closedPr,
      getChecks: async () => {
        throw new Error("unexpected getChecks call");
      },
      getUnresolvedReviewThreads: async () => {
        throw new Error("unexpected getUnresolvedReviewThreads call");
      },
      createPullRequest: async () => {
        throw new Error("unexpected createPullRequest call");
      },
    },
    config: createConfig(),
    stateStore: {
      touch(currentRecord, patch) {
        return { ...currentRecord, ...patch };
      },
      async save() {},
    },
    state,
    record,
    issue,
    options: { dryRun: true },
    ensureWorkspace: async () => "/tmp/workspaces/issue-240",
    syncIssueJournal: async ({ record: currentRecord }) => {
      journalSyncs.push(`${currentRecord.state}:${currentRecord.blocked_reason}`);
    },
    syncMemoryArtifacts: async () => ({
      contextIndexPath: "/tmp/context-index.md",
      agentsPath: "/tmp/AGENTS.generated.md",
      alwaysReadFiles: [],
      onDemandFiles: [],
    }),
    getWorkspaceStatus: async () => createWorkspaceStatus(),
    now: () => "2026-03-15T00:30:00Z",
  });

  assert.equal(result, "Issue #240 blocked because PR #44 was closed without merge.");
  assert.deepEqual(journalSyncs, ["pr_open:null", "blocked:manual_pr_closed"]);
  assert.equal(state.activeIssueNumber, null);
  assert.equal(state.issues["240"]?.state, "blocked");
  assert.equal(state.issues["240"]?.blocked_reason, "manual_pr_closed");
  assert.match(state.issues["240"]?.last_error ?? "", /PR #44 was closed without merge/);
  assert.equal(state.issues["240"]?.repeated_failure_signature_count, 1);
});

test("prepareIssueExecutionContext creates a draft PR after checkpointed workspace hydration", async () => {
  const record = createRecord({
    implementation_attempt_count: 2,
    state: "stabilizing",
  });
  const state = createState(record);
  const issue = createIssue();
  const workspaceStatus = createWorkspaceStatus({
    baseAhead: 2,
    remoteBranchExists: true,
    remoteAhead: 0,
  });
  const draftPr = createPullRequest({ number: 113, headRefOid: "draft-pr-head-113" });
  const pushCalls: Array<{ workspacePath: string; branch: string; remoteBranchExists: boolean }> = [];

  const result = await prepareIssueExecutionContext({
    github: {
      resolvePullRequestForBranch: async () => null,
      getChecks: async (prNumber: number) => {
        assert.equal(prNumber, 113);
        return [];
      },
      getUnresolvedReviewThreads: async (prNumber: number) => {
        assert.equal(prNumber, 113);
        return [];
      },
      createPullRequest: async (currentIssue, currentRecord, options) => {
        assert.equal(currentIssue.number, 240);
        assert.equal(currentRecord.issue_number, 240);
        assert.deepEqual(options, { draft: true });
        return draftPr;
      },
    },
    config: createConfig({ draftPrAfterAttempt: 1 }),
    stateStore: {
      touch(currentRecord, patch) {
        return { ...currentRecord, ...patch };
      },
      async save() {},
    },
    state,
    record,
    issue,
    options: { dryRun: false },
    ensureWorkspace: async () => "/tmp/workspaces/issue-240",
    syncIssueJournal: async () => {},
    syncMemoryArtifacts: async () => ({
      contextIndexPath: "/tmp/context-index.md",
      agentsPath: "/tmp/AGENTS.generated.md",
      alwaysReadFiles: [],
      onDemandFiles: [],
    }),
    getWorkspaceStatus: async () => workspaceStatus,
    pushBranch: async (workspacePath, branch, remoteBranchExists) => {
      pushCalls.push({ workspacePath, branch, remoteBranchExists });
    },
  });

  assert.equal(typeof result, "object");
  assert.ok(result && !isRestartRunOnce(result) && typeof result !== "string");
  assert.equal(result.pr?.number, 113);
  assert.deepEqual(pushCalls, [
    {
      workspacePath: "/tmp/workspaces/issue-240",
      branch: "codex/reopen-issue-240",
      remoteBranchExists: true,
    },
  ]);
});
