import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  formatNoRunnableIssueFoundMessage,
  resolveRunnableIssueContext,
} from "./run-once-issue-selection";
import {
  GitHubIssue,
  GitHubPullRequest,
  IssueRunRecord,
  PullRequestCheck,
  ReviewThread,
  SupervisorConfig,
  SupervisorStateFile,
} from "./core/types";
import {
  buildRequirementsBlockerIssueComment,
  syncRequirementsBlockerIssueComment,
} from "./requirements-blocker-issue-comment";

test("run-once issue selection does not consume external orchestration handoff authority", async () => {
  const source = await fs.readFile(path.join(process.cwd(), "src", "run-once-issue-selection.ts"), "utf8");

  assert.doesNotMatch(source, /decision-kernel-v2/u);
  assert.doesNotMatch(source, /evaluateDecisionKernelV2/u);
  assert.doesNotMatch(source, /buildDecisionKernelV2ExplainDto/u);
  assert.doesNotMatch(source, /pr_lifecycle_action_taking/u);
  assert.doesNotMatch(source, /external_handoff/u);
  assert.doesNotMatch(source, /mutation_authority/u);
  assert.doesNotMatch(source, /v2_routing/u);
  assert.doesNotMatch(source, /externalOrchestrationHandoff/u);
  assert.doesNotMatch(source, /routingCategory/u);
  assert.doesNotMatch(source, /mutationAuthority/u);
});

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
    labels: [],
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

test("resolveRunnableIssueContext normalizes cross-host workspace and journal hints onto the local canonical workspace", async () => {
  const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), "run-once-selection-host-paths-"));
  const config = createConfig({
    workspaceRoot,
    issueJournalRelativePath: ".codex-supervisor/issues/{issueNumber}/issue-journal.md",
  });
  const issueNumber = 91;
  const canonicalWorkspace = path.join(workspaceRoot, `issue-${issueNumber}`);
  await fs.mkdir(canonicalWorkspace, { recursive: true });
  await fs.writeFile(path.join(canonicalWorkspace, ".git"), "gitdir: /tmp/fake\n");

  const issue: GitHubIssue = {
    number: issueNumber,
    title: "Underspecified issue",
    body: "## Summary\nMissing the rest.",
    createdAt: "2026-03-15T00:00:00Z",
    updatedAt: "2026-03-15T00:00:00Z",
    url: "https://example.test/issues/91",
    labels: [],
    state: "OPEN",
  };
  const staleWorkspace = "/tmp/other-host/issue-91";
  const staleJournalPath = `${staleWorkspace}/.codex-supervisor/issue-journal.md`;
  const currentRecord = createRecord(issueNumber, {
    workspace: staleWorkspace,
    journal_path: staleJournalPath,
  });
  const state: SupervisorStateFile = {
    activeIssueNumber: issueNumber,
    issues: {
      [String(issueNumber)]: currentRecord,
    },
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
    currentRecord,
    acquireIssueLock: async () => ({
      acquired: true,
      release: async () => {},
    }),
    syncIssueJournal: async () => {},
  });

  assert.deepEqual(result, { kind: "restart" });
  assert.equal(savedStates.length, 1);
  assert.equal(state.issues[String(issueNumber)]?.workspace, canonicalWorkspace);
  assert.equal(
    state.issues[String(issueNumber)]?.journal_path,
    path.join(canonicalWorkspace, ".codex-supervisor", "issues", "91", "issue-journal.md"),
  );
});

test("resolveRunnableIssueContext creates one machine-managed requirements blocker comment for a standalone issue", async () => {
  const config = createConfig();
  const issue: GitHubIssue = {
    number: 191,
    title: "Standalone metadata blocker",
    body: `## Summary
Add execution-ready gating.`,
    createdAt: "2026-03-15T00:00:00Z",
    updatedAt: "2026-03-15T00:00:00Z",
    url: "https://example.test/issues/191",
    labels: [{ name: "codex" }],
    state: "OPEN",
  };
  const state: SupervisorStateFile = {
    activeIssueNumber: null,
    issues: {},
  };
  const savedStates: SupervisorStateFile[] = [];
  const addedComments: Array<{ issueNumber: number; body: string }> = [];
  const updatedComments: Array<{ commentId: number; body: string }> = [];

  const result = await resolveRunnableIssueContext({
    github: {
      listCandidateIssues: async () => [issue],
      getIssue: async () => issue,
      getIssueComments: async () => [],
      addIssueComment: async (issueNumber, body) => {
        addedComments.push({ issueNumber, body });
      },
      updateIssueComment: async (commentId, body) => {
        updatedComments.push({ commentId, body });
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
    ensureRecordJournalContext: async (record) => ({
      workspace: record.workspace,
      journal_path: `/tmp/workspaces/issue-${record.issue_number}/.codex-supervisor/issue-journal.md`,
    }),
  });

  assert.deepEqual(result, { kind: "restart" });
  assert.equal(addedComments.length, 1);
  assert.equal(updatedComments.length, 0);
  assert.equal(addedComments[0]?.issueNumber, 191);
  assert.match(
    addedComments[0]?.body ?? "",
    /missing required fields: `scope`, `acceptance criteria`, `verification`, `depends on`, `parallelizable`, `execution order`/i,
  );
  assert.match(addedComments[0]?.body ?? "", /omit `Part of:`/i);
  assert.match(addedComments[0]?.body ?? "", /Depends on: none/);
  assert.match(addedComments[0]?.body ?? "", /Parallelizable: No/);
  assert.match(addedComments[0]?.body ?? "", /## Execution order[\s\S]*1 of 1/);
  assert.doesNotMatch(addedComments[0]?.body ?? "", /Part of: none/i);
});

test("resolveRunnableIssueContext selects manual-review tracked PR when Codex current-head review request is eligible", async () => {
  const config = createConfig({
    reviewBotLogins: ["chatgpt-codex-connector"],
    configuredBotInitialGraceWaitSeconds: 0,
    configuredBotCurrentHeadSignalTimeoutMinutes: 10,
    configuredBotCurrentHeadSignalTimeoutAction: "request_review_comment",
  });
  const issueNumber = 2072;
  const prNumber = 177;
  const branch = "codex/issue-2072";
  const headSha = "head-2072-current";
  const issue: GitHubIssue = {
    number: issueNumber,
    title: "Codex Connector request eligible manual review recovery",
    body: executionReadyBody("Request current-head Codex review when stale manual review residue is request eligible."),
    createdAt: "2026-05-22T00:00:00Z",
    updatedAt: "2026-05-22T00:00:00Z",
    url: `https://example.test/issues/${issueNumber}`,
    labels: [],
    state: "OPEN",
  };
  const record = createRecord(issueNumber, {
    state: "blocked",
    branch,
    pr_number: prNumber,
    blocked_reason: "manual_review",
    last_head_sha: headSha,
    review_wait_started_at: "2026-05-22T00:00:00Z",
    review_wait_head_sha: headSha,
    copilot_review_timed_out_at: "2026-05-22T00:10:00.000Z",
    copilot_review_timeout_action: "request_review_comment",
    codex_connector_review_requested_observed_at: null,
    codex_connector_review_requested_head_sha: null,
    provider_success_head_sha: "head-2072-stale",
    provider_success_observed_at: "2026-05-21T23:50:00Z",
  });
  const state: SupervisorStateFile = {
    activeIssueNumber: null,
    issues: {
      [String(issueNumber)]: record,
    },
  };
  const pr: GitHubPullRequest = {
    number: prNumber,
    title: "Tracked PR",
    url: `https://example.test/pr/${prNumber}`,
    state: "OPEN",
    createdAt: "2026-05-22T00:00:00Z",
    isDraft: false,
    reviewDecision: null,
    mergeStateStatus: "BLOCKED",
    mergeable: "MERGEABLE",
    headRefName: branch,
    headRefOid: headSha,
    mergedAt: null,
    currentHeadCiGreenAt: "2026-05-22T00:00:00Z",
    configuredBotLatestReviewedCommitSha: "head-2072-stale",
    configuredBotCurrentHeadObservedAt: null,
    codexConnectorReviewRequestedAt: null,
    codexConnectorReviewRequestedHeadSha: null,
  };
  const checks: PullRequestCheck[] = [{ name: "build", state: "SUCCESS", bucket: "pass", workflow: "CI" }];

  const result = await resolveRunnableIssueContext({
    github: {
      listCandidateIssues: async () => [issue],
      getIssue: async () => issue,
      getPullRequestIfExists: async () => pr,
      getChecks: async () => checks,
      getUnresolvedReviewThreads: async () => [],
    },
    config,
    stateStore: createTouchStateStore([]),
    state,
    currentRecord: null,
    acquireIssueLock: async () => ({
      acquired: true,
      release: async () => {},
    }),
    ensureRecordJournalContext: async (selectedRecord) => ({
      workspace: selectedRecord.workspace,
      journal_path: "/tmp/workspaces/issue-2072/.codex-supervisor/issue-journal.md",
    }),
    syncIssueJournal: async () => {},
  });

  assert.notEqual(typeof result, "string");
  if (typeof result !== "string") {
    assert.equal(result.kind, "ready");
    if (result.kind === "ready") {
      assert.equal(result.record.issue_number, issueNumber);
      await result.issueLock.release();
    }
  }
});

test("resolveRunnableIssueContext discovers omitted stale tracked PR recovery and keeps downstream work blocked", async () => {
  const config = createConfig({
    reviewBotLogins: ["chatgpt-codex-connector"],
    configuredBotInitialGraceWaitSeconds: 0,
    configuredBotCurrentHeadSignalTimeoutMinutes: 10,
    configuredBotCurrentHeadSignalTimeoutAction: "request_review_comment",
  });
  const staleIssueNumber = 281;
  const downstreamIssueNumber = 282;
  const prNumber = 289;
  const branch = "codex/issue-281";
  const headSha = "head-281-current";
  const staleIssue: GitHubIssue = {
    number: staleIssueNumber,
    title: "Recover stale tracked PR",
    body: executionReadyBody("Request current-head Codex review for a stale tracked PR blocker."),
    createdAt: "2026-05-22T00:00:00Z",
    updatedAt: "2026-05-22T00:00:00Z",
    url: `https://example.test/issues/${staleIssueNumber}`,
    labels: [],
    state: "OPEN",
  };
  const downstreamIssue: GitHubIssue = {
    number: downstreamIssueNumber,
    title: "Downstream candidate",
    body: `${executionReadyBody("Wait for the stale tracked PR recovery root before continuing.")}

Depends on: #${staleIssueNumber}
Parallelizable: No

## Execution order
1 of 1`,
    createdAt: "2026-05-22T00:00:00Z",
    updatedAt: "2026-05-22T00:00:00Z",
    url: `https://example.test/issues/${downstreamIssueNumber}`,
    labels: [],
    state: "OPEN",
  };
  const staleRecord = createRecord(staleIssueNumber, {
    state: "blocked",
    branch,
    pr_number: prNumber,
    blocked_reason: "manual_review",
    last_head_sha: headSha,
    review_wait_started_at: "2026-05-22T00:00:00Z",
    review_wait_head_sha: headSha,
    copilot_review_timed_out_at: "2026-05-22T00:10:00.000Z",
    copilot_review_timeout_action: "request_review_comment",
    codex_connector_review_requested_observed_at: null,
    codex_connector_review_requested_head_sha: null,
    provider_success_head_sha: "head-281-stale",
    provider_success_observed_at: "2026-05-21T23:50:00Z",
  });
  const downstreamRecord = createRecord(downstreamIssueNumber);
  const state: SupervisorStateFile = {
    activeIssueNumber: null,
    issues: {
      [String(staleIssueNumber)]: staleRecord,
      [String(downstreamIssueNumber)]: downstreamRecord,
    },
  };
  const pr: GitHubPullRequest = {
    number: prNumber,
    title: "Tracked PR",
    url: `https://example.test/pr/${prNumber}`,
    state: "OPEN",
    createdAt: "2026-05-22T00:00:00Z",
    isDraft: false,
    reviewDecision: null,
    mergeStateStatus: "BLOCKED",
    mergeable: "MERGEABLE",
    headRefName: branch,
    headRefOid: headSha,
    mergedAt: null,
    currentHeadCiGreenAt: "2026-05-22T00:00:00Z",
    configuredBotLatestReviewedCommitSha: "head-281-stale",
    configuredBotCurrentHeadObservedAt: null,
    codexConnectorReviewRequestedAt: null,
    codexConnectorReviewRequestedHeadSha: null,
  };
  const checks: PullRequestCheck[] = [{ name: "build", state: "SUCCESS", bucket: "pass", workflow: "CI" }];

  const result = await resolveRunnableIssueContext({
    github: {
      listCandidateIssues: async () => [downstreamIssue],
      getIssue: async (issueNumber) =>
        issueNumber === staleIssueNumber ? staleIssue : downstreamIssue,
      getPullRequestIfExists: async () => pr,
      getChecks: async () => checks,
      getUnresolvedReviewThreads: async () => [],
    },
    config,
    stateStore: createTouchStateStore([]),
    state,
    currentRecord: null,
    acquireIssueLock: async () => ({
      acquired: true,
      release: async () => {},
    }),
    ensureRecordJournalContext: async (selectedRecord) => ({
      workspace: selectedRecord.workspace,
      journal_path: `/tmp/workspaces/issue-${selectedRecord.issue_number}/.codex-supervisor/issue-journal.md`,
    }),
    syncIssueJournal: async () => {},
  });

  assert.notEqual(typeof result, "string");
  if (typeof result !== "string") {
    assert.equal(result.kind, "ready");
    if (result.kind === "ready") {
      assert.equal(result.record.issue_number, staleIssueNumber);
      assert.equal(state.activeIssueNumber, staleIssueNumber);
      await result.issueLock.release();
    }
  }
});

test("resolveRunnableIssueContext keeps omitted non-actionable tracked PR blocker in active dependency checks", async () => {
  const config = createConfig({
    reviewBotLogins: ["chatgpt-codex-connector"],
    configuredBotInitialGraceWaitSeconds: 0,
    configuredBotCurrentHeadSignalTimeoutMinutes: 10,
    configuredBotCurrentHeadSignalTimeoutAction: "request_review_comment",
  });
  const staleIssueNumber = 281;
  const downstreamIssueNumber = 282;
  const prNumber = 289;
  const branch = "codex/issue-281";
  const headSha = "head-281-current";
  const staleIssue: GitHubIssue = {
    number: staleIssueNumber,
    title: "Recover stale tracked PR",
    body: executionReadyBody("Request current-head Codex review for a stale tracked PR blocker."),
    createdAt: "2026-05-22T00:00:00Z",
    updatedAt: "2026-05-22T00:00:00Z",
    url: `https://example.test/issues/${staleIssueNumber}`,
    labels: [],
    state: "OPEN",
  };
  const downstreamIssue: GitHubIssue = {
    number: downstreamIssueNumber,
    title: "Active downstream candidate",
    body: `${executionReadyBody("Do not run before the stale tracked PR recovery root.")}

Depends on: #${staleIssueNumber}
Parallelizable: No

## Execution order
1 of 1`,
    createdAt: "2026-05-22T00:00:00Z",
    updatedAt: "2026-05-22T00:00:00Z",
    url: `https://example.test/issues/${downstreamIssueNumber}`,
    labels: [],
    state: "OPEN",
  };
  const staleRecord = createRecord(staleIssueNumber, {
    state: "blocked",
    branch,
    pr_number: prNumber,
    blocked_reason: "manual_review",
    last_head_sha: headSha,
    review_wait_started_at: "2026-05-22T00:00:00Z",
    review_wait_head_sha: headSha,
    copilot_review_timed_out_at: "2026-05-22T00:10:00.000Z",
    copilot_review_timeout_action: "request_review_comment",
    codex_connector_review_requested_observed_at: null,
    codex_connector_review_requested_head_sha: null,
    provider_success_head_sha: "head-281-stale",
    provider_success_observed_at: "2026-05-21T23:50:00Z",
  });
  const downstreamRecord = createRecord(downstreamIssueNumber, {
    state: "queued",
  });
  const state: SupervisorStateFile = {
    activeIssueNumber: downstreamIssueNumber,
    issues: {
      [String(staleIssueNumber)]: staleRecord,
      [String(downstreamIssueNumber)]: downstreamRecord,
    },
  };
  const pr: GitHubPullRequest = {
    number: prNumber,
    title: "Tracked PR",
    url: `https://example.test/pr/${prNumber}`,
    state: "OPEN",
    createdAt: "2026-05-22T00:00:00Z",
    isDraft: false,
    reviewDecision: null,
    mergeStateStatus: "BLOCKED",
    mergeable: "MERGEABLE",
    headRefName: branch,
    headRefOid: headSha,
    mergedAt: null,
    currentHeadCiGreenAt: null,
    configuredBotLatestReviewedCommitSha: "head-281-stale",
    configuredBotCurrentHeadObservedAt: null,
    codexConnectorReviewRequestedAt: null,
    codexConnectorReviewRequestedHeadSha: null,
  };
  const checks: PullRequestCheck[] = [{ name: "build", state: "PENDING", bucket: "pending", workflow: "CI" }];
  const savedStates: SupervisorStateFile[] = [];

  const result = await resolveRunnableIssueContext({
    github: {
      listCandidateIssues: async () => [downstreamIssue],
      getIssue: async (issueNumber) =>
        issueNumber === staleIssueNumber ? staleIssue : downstreamIssue,
      getPullRequestIfExists: async () => pr,
      getChecks: async () => checks,
      getUnresolvedReviewThreads: async () => [],
    },
    config,
    stateStore: createTouchStateStore(savedStates),
    state,
    currentRecord: downstreamRecord,
    acquireIssueLock: async () => ({
      acquired: true,
      release: async () => {},
    }),
    ensureRecordJournalContext: async (selectedRecord) => ({
      workspace: selectedRecord.workspace,
      journal_path: `/tmp/workspaces/issue-${selectedRecord.issue_number}/.codex-supervisor/issue-journal.md`,
    }),
    syncIssueJournal: async () => {},
  });

  assert.deepEqual(result, { kind: "restart" });
  assert.equal(state.activeIssueNumber, null);
  assert.match(state.issues[String(downstreamIssueNumber)]?.last_error ?? "", /depends on #281/);
  assert.equal(savedStates.length, 1);
});

test("resolveRunnableIssueContext fails closed when omitted tracked PR blocker fetch fails", async () => {
  const config = createConfig({
    reviewBotLogins: ["chatgpt-codex-connector"],
    configuredBotInitialGraceWaitSeconds: 0,
    configuredBotCurrentHeadSignalTimeoutMinutes: 10,
    configuredBotCurrentHeadSignalTimeoutAction: "request_review_comment",
  });
  const staleIssueNumber = 281;
  const downstreamIssueNumber = 282;
  const prNumber = 289;
  const branch = "codex/issue-281";
  const downstreamIssue: GitHubIssue = {
    number: downstreamIssueNumber,
    title: "Active downstream candidate",
    body: `${executionReadyBody("Do not run before the stale tracked PR recovery root.")}

Depends on: #${staleIssueNumber}
Parallelizable: No

## Execution order
1 of 1`,
    createdAt: "2026-05-22T00:05:00Z",
    updatedAt: "2026-05-22T00:05:00Z",
    url: `https://example.test/issues/${downstreamIssueNumber}`,
    labels: [],
    state: "OPEN",
  };
  const staleRecord = createRecord(staleIssueNumber, {
    state: "blocked",
    branch,
    pr_number: prNumber,
    blocked_reason: "manual_review",
    last_head_sha: "head-281-current",
    review_wait_started_at: "2026-05-22T00:00:00Z",
    review_wait_head_sha: "head-281-current",
    copilot_review_timed_out_at: "2026-05-22T00:10:00.000Z",
    copilot_review_timeout_action: "request_review_comment",
  });
  const downstreamRecord = createRecord(downstreamIssueNumber, {
    state: "queued",
  });
  const state: SupervisorStateFile = {
    activeIssueNumber: downstreamIssueNumber,
    issues: {
      [String(staleIssueNumber)]: staleRecord,
      [String(downstreamIssueNumber)]: downstreamRecord,
    },
  };
  let lockAcquired = false;

  await assert.rejects(
    resolveRunnableIssueContext({
      github: {
        listCandidateIssues: async () => [downstreamIssue],
        getIssue: async (issueNumber) => {
          if (issueNumber === staleIssueNumber) {
            throw new Error("GitHub rate limit");
          }
          return downstreamIssue;
        },
        getPullRequestIfExists: async () => {
          throw new Error("unexpected PR fetch");
        },
        getChecks: async () => {
          throw new Error("unexpected checks fetch");
        },
        getUnresolvedReviewThreads: async () => {
          throw new Error("unexpected review thread fetch");
        },
      },
      config,
      stateStore: createTouchStateStore([]),
      state,
      currentRecord: downstreamRecord,
      acquireIssueLock: async () => {
        lockAcquired = true;
        return {
          acquired: true,
          release: async () => {},
        };
      },
      ensureRecordJournalContext: async (selectedRecord) => ({
        workspace: selectedRecord.workspace,
        journal_path: `/tmp/workspaces/issue-${selectedRecord.issue_number}/.codex-supervisor/issue-journal.md`,
      }),
      syncIssueJournal: async () => {},
    }),
    /Failed to fetch recoverable tracked PR issue #281/,
  );
  assert.equal(lockAcquired, true);
});

test("resolveRunnableIssueContext normalizes label filters for direct stale tracked PR recovery", async () => {
  const config = createConfig({
    issueLabel: "codex",
    reviewBotLogins: ["chatgpt-codex-connector"],
    configuredBotInitialGraceWaitSeconds: 0,
    configuredBotCurrentHeadSignalTimeoutMinutes: 10,
    configuredBotCurrentHeadSignalTimeoutAction: "request_review_comment",
  });
  const issueNumber = 281;
  const prNumber = 289;
  const branch = "codex/issue-281";
  const headSha = "head-281-current";
  const issue: GitHubIssue = {
    number: issueNumber,
    title: "Case-varied label stale tracked PR",
    body: executionReadyBody("Recover when GitHub label casing differs from config casing."),
    createdAt: "2026-05-22T00:00:00Z",
    updatedAt: "2026-05-22T00:00:00Z",
    url: `https://example.test/issues/${issueNumber}`,
    labels: [{ name: "Codex" }],
    state: "OPEN",
  };
  const record = createRecord(issueNumber, {
    state: "blocked",
    branch,
    pr_number: prNumber,
    blocked_reason: "manual_review",
    last_head_sha: headSha,
    review_wait_started_at: "2026-05-22T00:00:00Z",
    review_wait_head_sha: headSha,
    copilot_review_timed_out_at: "2026-05-22T00:10:00.000Z",
    copilot_review_timeout_action: "request_review_comment",
    codex_connector_review_requested_observed_at: null,
    codex_connector_review_requested_head_sha: null,
    provider_success_head_sha: "head-281-stale",
    provider_success_observed_at: "2026-05-21T23:50:00Z",
  });
  const state: SupervisorStateFile = {
    activeIssueNumber: null,
    issues: {
      [String(issueNumber)]: record,
    },
  };
  const pr: GitHubPullRequest = {
    number: prNumber,
    title: "Tracked PR",
    url: `https://example.test/pr/${prNumber}`,
    state: "OPEN",
    createdAt: "2026-05-22T00:00:00Z",
    isDraft: false,
    reviewDecision: null,
    mergeStateStatus: "BLOCKED",
    mergeable: "MERGEABLE",
    headRefName: branch,
    headRefOid: headSha,
    mergedAt: null,
    currentHeadCiGreenAt: "2026-05-22T00:00:00Z",
    configuredBotLatestReviewedCommitSha: "head-281-stale",
    configuredBotCurrentHeadObservedAt: null,
    codexConnectorReviewRequestedAt: null,
    codexConnectorReviewRequestedHeadSha: null,
  };
  const checks: PullRequestCheck[] = [{ name: "build", state: "SUCCESS", bucket: "pass", workflow: "CI" }];

  const result = await resolveRunnableIssueContext({
    github: {
      listCandidateIssues: async () => [],
      getIssue: async () => issue,
      getPullRequestIfExists: async () => pr,
      getChecks: async () => checks,
      getUnresolvedReviewThreads: async () => [],
    },
    config,
    stateStore: createTouchStateStore([]),
    state,
    currentRecord: null,
    acquireIssueLock: async () => ({
      acquired: true,
      release: async () => {},
    }),
    ensureRecordJournalContext: async (selectedRecord) => ({
      workspace: selectedRecord.workspace,
      journal_path: `/tmp/workspaces/issue-${selectedRecord.issue_number}/.codex-supervisor/issue-journal.md`,
    }),
    syncIssueJournal: async () => {},
  });

  assert.notEqual(typeof result, "string");
  if (typeof result !== "string") {
    assert.equal(result.kind, "ready");
    if (result.kind === "ready") {
      assert.equal(result.record.issue_number, issueNumber);
      await result.issueLock.release();
    }
  }
});

test("resolveRunnableIssueContext orders recovered stale tracked PRs with normal candidates", async () => {
  const config = createConfig({
    reviewBotLogins: ["chatgpt-codex-connector"],
    configuredBotInitialGraceWaitSeconds: 0,
    configuredBotCurrentHeadSignalTimeoutMinutes: 10,
    configuredBotCurrentHeadSignalTimeoutAction: "request_review_comment",
  });
  const issueNumber = 281;
  const laterIssueNumber = 400;
  const prNumber = 289;
  const branch = "codex/issue-281";
  const headSha = "head-281-current";
  const staleIssue: GitHubIssue = {
    number: issueNumber,
    title: "Older stale tracked PR",
    body: executionReadyBody("Recover before later normal candidates."),
    createdAt: "2026-05-22T00:00:00Z",
    updatedAt: "2026-05-22T00:00:00Z",
    url: `https://example.test/issues/${issueNumber}`,
    labels: [],
    state: "OPEN",
  };
  const laterIssue: GitHubIssue = {
    number: laterIssueNumber,
    title: "Later normal candidate",
    body: executionReadyBody("A normal candidate that should keep candidate ordering."),
    createdAt: "2026-05-22T00:05:00Z",
    updatedAt: "2026-05-22T00:05:00Z",
    url: `https://example.test/issues/${laterIssueNumber}`,
    labels: [],
    state: "OPEN",
  };
  const staleRecord = createRecord(issueNumber, {
    state: "blocked",
    branch,
    pr_number: prNumber,
    blocked_reason: "manual_review",
    last_head_sha: headSha,
    review_wait_started_at: "2026-05-22T00:00:00Z",
    review_wait_head_sha: headSha,
    copilot_review_timed_out_at: "2026-05-22T00:10:00.000Z",
    copilot_review_timeout_action: "request_review_comment",
    codex_connector_review_requested_observed_at: null,
    codex_connector_review_requested_head_sha: null,
    provider_success_head_sha: "head-281-stale",
    provider_success_observed_at: "2026-05-21T23:50:00Z",
  });
  const state: SupervisorStateFile = {
    activeIssueNumber: null,
    issues: {
      [String(issueNumber)]: staleRecord,
    },
  };
  const pr: GitHubPullRequest = {
    number: prNumber,
    title: "Tracked PR",
    url: `https://example.test/pr/${prNumber}`,
    state: "OPEN",
    createdAt: "2026-05-22T00:00:00Z",
    isDraft: false,
    reviewDecision: null,
    mergeStateStatus: "BLOCKED",
    mergeable: "MERGEABLE",
    headRefName: branch,
    headRefOid: headSha,
    mergedAt: null,
    currentHeadCiGreenAt: "2026-05-22T00:00:00Z",
    configuredBotLatestReviewedCommitSha: "head-281-stale",
    configuredBotCurrentHeadObservedAt: null,
    codexConnectorReviewRequestedAt: null,
    codexConnectorReviewRequestedHeadSha: null,
  };
  const checks: PullRequestCheck[] = [{ name: "build", state: "SUCCESS", bucket: "pass", workflow: "CI" }];

  const result = await resolveRunnableIssueContext({
    github: {
      listCandidateIssues: async () => [laterIssue],
      getIssue: async (selectedIssueNumber) =>
        selectedIssueNumber === issueNumber ? staleIssue : laterIssue,
      getPullRequestIfExists: async () => pr,
      getChecks: async () => checks,
      getUnresolvedReviewThreads: async () => [],
    },
    config,
    stateStore: createTouchStateStore([]),
    state,
    currentRecord: null,
    acquireIssueLock: async () => ({
      acquired: true,
      release: async () => {},
    }),
    ensureRecordJournalContext: async (selectedRecord) => ({
      workspace: selectedRecord.workspace,
      journal_path: `/tmp/workspaces/issue-${selectedRecord.issue_number}/.codex-supervisor/issue-journal.md`,
    }),
    syncIssueJournal: async () => {},
  });

  assert.notEqual(typeof result, "string");
  if (typeof result !== "string") {
    assert.equal(result.kind, "ready");
    if (result.kind === "ready") {
      assert.equal(result.record.issue_number, issueNumber);
      await result.issueLock.release();
    }
  }
});

test("resolveRunnableIssueContext skips direct stale tracked PR recovery when filters cannot be verified", async () => {
  const baseConfig = {
    reviewBotLogins: ["chatgpt-codex-connector"],
    configuredBotInitialGraceWaitSeconds: 0,
    configuredBotCurrentHeadSignalTimeoutMinutes: 10,
    configuredBotCurrentHeadSignalTimeoutAction: "request_review_comment" as const,
  };
  const issueNumber = 281;
  const prNumber = 289;
  const branch = "codex/issue-281";
  const headSha = "head-281-current";
  const record = createRecord(issueNumber, {
    state: "blocked",
    branch,
    pr_number: prNumber,
    blocked_reason: "manual_review",
    last_head_sha: headSha,
    review_wait_started_at: "2026-05-22T00:00:00Z",
    review_wait_head_sha: headSha,
    copilot_review_timed_out_at: "2026-05-22T00:10:00.000Z",
    copilot_review_timeout_action: "request_review_comment",
    codex_connector_review_requested_observed_at: null,
    codex_connector_review_requested_head_sha: null,
    provider_success_head_sha: "head-281-stale",
    provider_success_observed_at: "2026-05-21T23:50:00Z",
  });
  const pr: GitHubPullRequest = {
    number: prNumber,
    title: "Tracked PR",
    url: `https://example.test/pr/${prNumber}`,
    state: "OPEN",
    createdAt: "2026-05-22T00:00:00Z",
    isDraft: false,
    reviewDecision: null,
    mergeStateStatus: "BLOCKED",
    mergeable: "MERGEABLE",
    headRefName: branch,
    headRefOid: headSha,
    mergedAt: null,
    currentHeadCiGreenAt: "2026-05-22T00:00:00Z",
    configuredBotLatestReviewedCommitSha: "head-281-stale",
    configuredBotCurrentHeadObservedAt: null,
    codexConnectorReviewRequestedAt: null,
    codexConnectorReviewRequestedHeadSha: null,
  };
  const checks: PullRequestCheck[] = [{ name: "build", state: "SUCCESS", bucket: "pass", workflow: "CI" }];
  const scenarios: Array<{ name: string; config: SupervisorConfig; issue: GitHubIssue }> = [
    {
      name: "missing configured issue label",
      config: createConfig({ ...baseConfig, issueLabel: "codex" }),
      issue: {
        number: issueNumber,
        title: "Unlabeled stale tracked PR",
        body: executionReadyBody("Do not recover without the configured runnable label."),
        createdAt: "2026-05-22T00:00:00Z",
        updatedAt: "2026-05-22T00:00:00Z",
        url: `https://example.test/issues/${issueNumber}`,
        labels: [],
        state: "OPEN",
      },
    },
    {
      name: "issueSearch configured",
      config: createConfig({ ...baseConfig, issueSearch: "label:codex" }),
      issue: {
        number: issueNumber,
        title: "Search-filtered stale tracked PR",
        body: executionReadyBody("Do not recover direct issues when issueSearch cannot be verified."),
        createdAt: "2026-05-22T00:00:00Z",
        updatedAt: "2026-05-22T00:00:00Z",
        url: `https://example.test/issues/${issueNumber}`,
        labels: [{ name: "codex" }],
        state: "OPEN",
      },
    },
  ];

  for (const scenario of scenarios) {
    const state: SupervisorStateFile = {
      activeIssueNumber: null,
      issues: {
        [String(issueNumber)]: record,
      },
    };
    const savedStates: SupervisorStateFile[] = [];

    const result = await resolveRunnableIssueContext({
      github: {
        listCandidateIssues: async () => [],
        getIssue: async () => scenario.issue,
        getPullRequestIfExists: async () => pr,
        getChecks: async () => checks,
        getUnresolvedReviewThreads: async () => [],
      },
      config: scenario.config,
      stateStore: createTouchStateStore(savedStates),
      state,
      currentRecord: null,
    });

    assert.equal(result, "No matching open issue found.", scenario.name);
    assert.equal(state.activeIssueNumber, null, scenario.name);
  }
});

test("resolveRunnableIssueContext selects stale-review-bot tracked PR when Codex current-head review request is eligible", async () => {
  const config = createConfig({
    reviewBotLogins: ["chatgpt-codex-connector"],
    configuredBotInitialGraceWaitSeconds: 0,
    configuredBotCurrentHeadSignalTimeoutMinutes: 10,
    configuredBotCurrentHeadSignalTimeoutAction: "request_review_comment",
  });
  const issueNumber = 2096;
  const prNumber = 179;
  const branch = "codex/issue-2096";
  const headSha = "head-2096-current";
  const threadId = "thread-stale-review-bot-current-head";
  const commentId = "comment-stale-review-bot-current-head";
  const issue: GitHubIssue = {
    number: issueNumber,
    title: "Codex Connector request eligible stale review bot recovery",
    body: executionReadyBody("Request current-head Codex review when stale review bot residue is request eligible."),
    createdAt: "2026-05-22T00:00:00Z",
    updatedAt: "2026-05-22T00:00:00Z",
    url: `https://example.test/issues/${issueNumber}`,
    labels: [],
    state: "OPEN",
  };
  const record = createRecord(issueNumber, {
    state: "blocked",
    branch,
    pr_number: prNumber,
    blocked_reason: "stale_review_bot",
    last_head_sha: headSha,
    copilot_review_timed_out_at: "2026-05-22T00:10:00.000Z",
    copilot_review_timeout_action: "request_review_comment",
    codex_connector_review_requested_observed_at: null,
    codex_connector_review_requested_head_sha: null,
    provider_success_head_sha: "head-2096-stale",
    provider_success_observed_at: "2026-05-21T23:50:00Z",
    processed_review_thread_ids: [`${threadId}@${headSha}`],
    processed_review_thread_fingerprints: [`${threadId}@${headSha}#${commentId}`],
  });
  const state: SupervisorStateFile = {
    activeIssueNumber: null,
    issues: {
      [String(issueNumber)]: record,
    },
  };
  const pr: GitHubPullRequest = {
    number: prNumber,
    title: "Tracked PR",
    url: `https://example.test/pr/${prNumber}`,
    state: "OPEN",
    createdAt: "2026-05-22T00:00:00Z",
    isDraft: false,
    reviewDecision: null,
    mergeStateStatus: "BLOCKED",
    mergeable: "MERGEABLE",
    headRefName: branch,
    headRefOid: headSha,
    mergedAt: null,
    currentHeadCiGreenAt: "2026-05-22T00:00:00Z",
    configuredBotLatestReviewedCommitSha: "head-2096-stale",
    configuredBotCurrentHeadObservedAt: null,
    codexConnectorReviewRequestedAt: null,
    codexConnectorReviewRequestedHeadSha: null,
  };
  const checks: PullRequestCheck[] = [{ name: "build", state: "SUCCESS", bucket: "pass", workflow: "CI" }];
  const reviewThreads = [
    {
      id: threadId,
      isResolved: false,
      isOutdated: true,
      path: "src/review-policy.ts",
      line: 12,
      comments: {
        nodes: [
          {
            id: commentId,
            body: "P2: metadata-only stale configured-bot finding.",
            createdAt: "2026-05-21T23:55:00Z",
            url: `https://example.test/pr/${prNumber}#discussion_${threadId}`,
            author: {
              login: "chatgpt-codex-connector",
              typeName: "Bot",
            },
          },
        ],
      },
    },
  ];

  const result = await resolveRunnableIssueContext({
    github: {
      listCandidateIssues: async () => [issue],
      getIssue: async () => issue,
      getPullRequestIfExists: async () => pr,
      getChecks: async () => checks,
      getUnresolvedReviewThreads: async () => reviewThreads,
    },
    config,
    stateStore: createTouchStateStore([]),
    state,
    currentRecord: null,
    acquireIssueLock: async () => ({
      acquired: true,
      release: async () => {},
    }),
    ensureRecordJournalContext: async (selectedRecord) => ({
      workspace: selectedRecord.workspace,
      journal_path: "/tmp/workspaces/issue-2096/.codex-supervisor/issue-journal.md",
    }),
    syncIssueJournal: async () => {},
  });

  assert.notEqual(typeof result, "string");
  if (typeof result !== "string") {
    assert.equal(result.kind, "ready");
    if (result.kind === "ready") {
      assert.equal(result.record.issue_number, issueNumber);
      await result.issueLock.release();
    }
  }
});

test("resolveRunnableIssueContext selects stale review-commit residue without timeout metadata", async () => {
  const config = createConfig({
    reviewBotLogins: ["chatgpt-codex-connector"],
    configuredBotInitialGraceWaitSeconds: 0,
    configuredBotCurrentHeadSignalTimeoutMinutes: 10,
    configuredBotCurrentHeadSignalTimeoutAction: "request_review_comment",
  });
  const issueNumber = 2199;
  const prNumber = 2200;
  const branch = "codex/issue-2199";
  const headSha = "7d2a6e42f0a28a176463bda1c2cff4001e6aeb5a";
  const staleReviewHead = "707f0eb2b95722c1c60bc3773a17a272957d775c";
  const issue: GitHubIssue = {
    number: issueNumber,
    title: "Recover stale Codex review residue",
    body: executionReadyBody("Request current-head Codex review for stale review-commit residue."),
    createdAt: "2026-05-26T22:00:00Z",
    updatedAt: "2026-05-26T22:00:00Z",
    url: `https://example.test/issues/${issueNumber}`,
    labels: [],
    state: "OPEN",
  };
  const record = createRecord(issueNumber, {
    state: "blocked",
    branch,
    pr_number: prNumber,
    blocked_reason: "manual_review",
    last_head_sha: headSha,
    review_wait_started_at: "2026-05-26T22:00:00Z",
    review_wait_head_sha: headSha,
    codex_connector_review_requested_observed_at: null,
    codex_connector_review_requested_head_sha: null,
    last_tracked_pr_progress_summary: "suppressed_same_head_same_review_thread_blocker",
    last_tracked_pr_repeat_failure_decision: "stop_no_progress",
  });
  const state: SupervisorStateFile = {
    activeIssueNumber: null,
    issues: {
      [String(issueNumber)]: record,
    },
  };
  const pr: GitHubPullRequest = {
    number: prNumber,
    title: "Tracked PR",
    url: `https://example.test/pr/${prNumber}`,
    state: "OPEN",
    createdAt: "2026-05-26T22:00:00Z",
    isDraft: false,
    reviewDecision: null,
    mergeStateStatus: "BLOCKED",
    mergeable: "MERGEABLE",
    headRefName: branch,
    headRefOid: headSha,
    mergedAt: null,
    currentHeadCiGreenAt: "2026-05-26T22:00:00Z",
    configuredBotLatestReviewedCommitSha: staleReviewHead,
    configuredBotCurrentHeadObservedAt: null,
    codexConnectorReviewRequestedAt: null,
    codexConnectorReviewRequestedHeadSha: null,
  };
  const checks: PullRequestCheck[] = [{ name: "build", state: "SUCCESS", bucket: "pass", workflow: "CI" }];
  const reviewThreads: ReviewThread[] = [
    {
      id: "thread-stale-review-commit",
      isResolved: false,
      isOutdated: false,
      path: "src/codex-connector-review-request-decision.ts",
      line: 284,
      comments: {
        nodes: [
          {
            id: "comment-stale-review-commit",
            body: "P1: Verify the repair on the current head.",
            createdAt: "2026-05-26T21:55:00Z",
            url: `https://example.test/pr/${prNumber}#discussion_r2199`,
            author: {
              login: "chatgpt-codex-connector",
              typeName: "Bot",
            },
          },
        ],
      },
    },
    {
      id: "thread-soft-p3",
      isResolved: false,
      isOutdated: false,
      path: "src/codex-connector-review-request-decision.ts",
      line: 294,
      comments: {
        nodes: [
          {
            id: "comment-soft-p3",
            body: "P3: Consider clarifying this retry note in a follow-up.",
            createdAt: "2026-05-26T21:56:00Z",
            url: `https://example.test/pr/${prNumber}#discussion_soft_p3`,
            author: {
              login: "chatgpt-codex-connector",
              typeName: "Bot",
            },
          },
        ],
      },
    },
  ];

  const result = await resolveRunnableIssueContext({
    github: {
      listCandidateIssues: async () => [issue],
      getIssue: async () => issue,
      getPullRequestIfExists: async () => pr,
      getChecks: async () => checks,
      getUnresolvedReviewThreads: async () => reviewThreads,
    },
    config,
    stateStore: createTouchStateStore([]),
    state,
    currentRecord: null,
    acquireIssueLock: async () => ({
      acquired: true,
      release: async () => {},
    }),
    ensureRecordJournalContext: async (selectedRecord) => ({
      workspace: selectedRecord.workspace,
      journal_path: "/tmp/workspaces/issue-2199/.codex-supervisor/issue-journal.md",
    }),
    syncIssueJournal: async () => {},
  });

  assert.notEqual(typeof result, "string");
  if (typeof result !== "string") {
    assert.equal(result.kind, "ready");
    if (result.kind === "ready") {
      assert.equal(result.record.issue_number, issueNumber);
      await result.issueLock.release();
    }
  }
});

test("resolveRunnableIssueContext skips manual-review Codex request recovery when GitHub recovery data fails", async () => {
  const config = createConfig({
    reviewBotLogins: ["chatgpt-codex-connector"],
    configuredBotInitialGraceWaitSeconds: 0,
    configuredBotCurrentHeadSignalTimeoutMinutes: 10,
    configuredBotCurrentHeadSignalTimeoutAction: "request_review_comment",
  });
  const issueNumber = 2072;
  const prNumber = 177;
  const issue: GitHubIssue = {
    number: issueNumber,
    title: "Codex Connector request eligible manual review recovery",
    body: executionReadyBody("Request current-head Codex review when stale manual review residue is request eligible."),
    createdAt: "2026-05-22T00:00:00Z",
    updatedAt: "2026-05-22T00:00:00Z",
    url: `https://example.test/issues/${issueNumber}`,
    labels: [],
    state: "OPEN",
  };
  const record = createRecord(issueNumber, {
    state: "blocked",
    branch: "codex/issue-2072",
    pr_number: prNumber,
    blocked_reason: "manual_review",
    last_head_sha: "head-2072-current",
    review_wait_started_at: "2026-05-22T00:00:00Z",
    review_wait_head_sha: "head-2072-current",
    copilot_review_timed_out_at: "2026-05-22T00:10:00.000Z",
    copilot_review_timeout_action: "request_review_comment",
    codex_connector_review_requested_observed_at: null,
    codex_connector_review_requested_head_sha: null,
    provider_success_head_sha: "head-2072-stale",
    provider_success_observed_at: "2026-05-21T23:50:00Z",
  });
  const state: SupervisorStateFile = {
    activeIssueNumber: null,
    issues: {
      [String(issueNumber)]: record,
    },
  };
  const savedStates: SupervisorStateFile[] = [];

  const result = await resolveRunnableIssueContext({
    github: {
      listCandidateIssues: async () => [issue],
      getIssue: async () => issue,
      getPullRequestIfExists: async () => {
        throw new Error("GitHub PR fetch failed");
      },
      getChecks: async () => {
        throw new Error("unexpected getChecks call");
      },
      getUnresolvedReviewThreads: async () => {
        throw new Error("unexpected getUnresolvedReviewThreads call");
      },
    },
    config,
    stateStore: createTouchStateStore(savedStates),
    state,
    currentRecord: null,
  });

  assert.equal(result, "No matching open issue found.");
  assert.equal(savedStates.length, 1);
  assert.equal(state.activeIssueNumber, null);
});

test("buildRequirementsBlockerIssueComment uses sequenced-child guidance without inventing a parent dependency", () => {
  const issue: GitHubIssue = {
    number: 193,
    title: "Sequenced metadata blocker",
    body: `## Summary
Repair sequenced child metadata guidance.

## Scope
- verify the canonical blocker guidance

## Acceptance criteria
- sequenced repairs explain the predecessor dependency shape

## Verification
- npx tsx --test src/run-once-issue-selection.test.ts

Depends on: none
Parallelizable: No

## Execution order
2 of 3`,
    createdAt: "2026-03-15T00:00:00Z",
    updatedAt: "2026-03-15T00:00:00Z",
    url: "https://example.test/issues/193",
    labels: [{ name: "codex" }],
    state: "OPEN",
  };

  const body = buildRequirementsBlockerIssueComment(issue);

  assert.match(body, /Canonical sequenced-child repair:/);
  assert.match(body, /Part of: #<number>/);
  assert.match(body, /Depends on: #<previous-issue-number>.*Depends on: none/s);
  assert.match(body, /## Execution order[\s\S]*2 of 3/);
  assert.doesNotMatch(body, /parent epic.*Depends on:/i);
});

test("syncRequirementsBlockerIssueComment dedupes identical blocker comments and updates the sticky comment when the blocker changes", async () => {
  const firstIssue: GitHubIssue = {
    number: 192,
    title: "Requirements blocker dedupe",
    body: `## Summary
Add execution-ready gating.`,
    createdAt: "2026-03-15T00:00:00Z",
    updatedAt: "2026-03-15T00:00:00Z",
    url: "https://example.test/issues/192",
    labels: [{ name: "codex" }],
    state: "OPEN",
  };
  const changedIssue: GitHubIssue = {
    ...firstIssue,
    body: `## Summary
Repair duplicated scheduling metadata.

## Scope
- keep diagnostics explicit

## Acceptance criteria
- duplicated metadata is blocked clearly

## Verification
- npm test -- src/run-once-issue-selection.test.ts

Depends on: none
Depends on: #190
Parallelizable: No`,
    updatedAt: "2026-03-15T00:05:00Z",
  };
  const addedComments: Array<{ issueNumber: number; body: string }> = [];
  const updatedComments: Array<{ commentId: number; body: string }> = [];
  let commentBody = "";

  const github = {
    getIssueComments: async () =>
      commentBody === ""
        ? []
        : [{
          id: "comment-192",
          databaseId: 501,
          body: commentBody,
          createdAt: "2026-03-15T00:01:00Z",
          url: "https://example.test/issues/192#issuecomment-501",
          author: { login: "codex-supervisor", typeName: "Bot" },
          viewerDidAuthor: true,
        }],
    addIssueComment: async (issueNumber: number, body: string) => {
      addedComments.push({ issueNumber, body });
      commentBody = body;
    },
    updateIssueComment: async (commentId: number, body: string) => {
      updatedComments.push({ commentId, body });
      commentBody = body;
    },
  };

  await syncRequirementsBlockerIssueComment(github as never, firstIssue);
  await syncRequirementsBlockerIssueComment(github as never, firstIssue);
  await syncRequirementsBlockerIssueComment(github as never, changedIssue);

  assert.equal(addedComments.length, 1);
  assert.equal(updatedComments.length, 1);
  assert.equal(updatedComments[0]?.commentId, 501);
  assert.match(updatedComments[0]?.body ?? "", /metadata errors:/i);
  assert.match(updatedComments[0]?.body ?? "", /depends on must appear exactly once/i);
});

test("syncRequirementsBlockerIssueComment still dedupes authored sticky comments when databaseId is missing", async () => {
  const issue: GitHubIssue = {
    number: 194,
    title: "Requirements blocker dedupe without database id",
    body: `## Summary
Add execution-ready gating.`,
    createdAt: "2026-03-15T00:00:00Z",
    updatedAt: "2026-03-15T00:00:00Z",
    url: "https://example.test/issues/194",
    labels: [{ name: "codex" }],
    state: "OPEN",
  };
  const changedIssue: GitHubIssue = {
    ...issue,
    body: `${issue.body}

## Scope
- keep the sticky comment machine-managed`,
    updatedAt: "2026-03-15T00:05:00Z",
  };
  const addedComments: Array<{ issueNumber: number; body: string }> = [];
  const updatedComments: Array<{ commentId: number; body: string }> = [];
  let commentBody = "";

  const github = {
    getIssueComments: async () =>
      commentBody === ""
        ? []
        : [{
          id: "comment-194",
          databaseId: null,
          body: commentBody,
          createdAt: "2026-03-15T00:01:00Z",
          url: "https://example.test/issues/194#issuecomment-null",
          author: { login: "codex-supervisor", typeName: "Bot" },
          viewerDidAuthor: true,
        }],
    addIssueComment: async (issueNumber: number, body: string) => {
      addedComments.push({ issueNumber, body });
      commentBody = body;
    },
    updateIssueComment: async (commentId: number, body: string) => {
      updatedComments.push({ commentId, body });
      commentBody = body;
    },
  };

  await syncRequirementsBlockerIssueComment(github as never, issue);
  await syncRequirementsBlockerIssueComment(github as never, issue);
  await syncRequirementsBlockerIssueComment(github as never, changedIssue);

  assert.equal(addedComments.length, 1);
  assert.equal(updatedComments.length, 0);
});

test("resolveRunnableIssueContext treats requirements blocker comment sync as best effort", async () => {
  const config = createConfig();
  const issue: GitHubIssue = {
    number: 195,
    title: "Best-effort blocker comment sync",
    body: `## Summary
Add execution-ready gating.`,
    createdAt: "2026-03-15T00:00:00Z",
    updatedAt: "2026-03-15T00:00:00Z",
    url: "https://example.test/issues/195",
    labels: [{ name: "codex" }],
    state: "OPEN",
  };
  const state: SupervisorStateFile = {
    activeIssueNumber: null,
    issues: {},
  };
  const savedStates: SupervisorStateFile[] = [];
  const warnings: string[] = [];
  const originalWarn = console.warn;
  console.warn = (message?: unknown, ...args: unknown[]) => {
    warnings.push([message, ...args].map((value) => String(value)).join(" "));
  };

  try {
    const result = await resolveRunnableIssueContext({
      github: {
        listCandidateIssues: async () => [issue],
        getIssue: async () => issue,
        addIssueComment: async () => {},
        getIssueComments: async () => {
          throw new Error("comment sync offline");
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
      ensureRecordJournalContext: async (record) => ({
        workspace: record.workspace,
        journal_path: `/tmp/workspaces/issue-${record.issue_number}/.codex-supervisor/issue-journal.md`,
      }),
      syncIssueJournal: async () => {},
    });

    assert.deepEqual(result, { kind: "restart" });
  } finally {
    console.warn = originalWarn;
  }

  assert.equal(savedStates.length, 2);
  assert.equal(state.issues["195"]?.state, "blocked");
  assert.equal(state.issues["195"]?.blocked_reason, "requirements");
  assert.equal(warnings.length, 1);
  assert.match(warnings[0] ?? "", /Failed to sync requirements blocker issue comment for issue #195/i);
  assert.match(warnings[0] ?? "", /comment sync offline/i);
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
    labels: [],
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

test("formatNoRunnableIssueFoundMessage distinguishes blocked preserved partial work from an empty backlog", () => {
  const genericState: SupervisorStateFile = {
    activeIssueNumber: null,
    issues: {},
  };
  assert.equal(formatNoRunnableIssueFoundMessage(genericState), "No matching open issue found.");

  const blockedState: SupervisorStateFile = {
    activeIssueNumber: null,
    issues: {
      "145": createRecord(145, {
        state: "blocked",
        blocked_reason: "manual_review",
        updated_at: "2026-04-12T00:10:00Z",
        last_failure_context: {
          category: "manual",
          summary: "Issue #145 needs manual review because preserved partial work is waiting in the workspace.",
          signature: "manual-review-preserved-partial-work",
          command: null,
          details: [
            "preserved_partial_work=yes",
            "tracked_files=feature.txt|src/workflow.ts",
          ],
          url: "https://example.test/issues/145",
          updated_at: "2026-04-12T00:10:00Z",
        },
      }),
    },
  };

  assert.equal(
    formatNoRunnableIssueFoundMessage(blockedState),
    "No runnable issue is available. Latest blocked issue #145 is waiting on manual review with preserved partial work.",
  );
});

test("resolveRunnableIssueContext blocks safer-mode autonomous execution without the trusted-input label", async () => {
  const config = createConfig({
    trustMode: "untrusted_or_mixed",
    executionSafetyMode: "operator_gated",
  });
  const issue: GitHubIssue = {
    number: 94,
    title: "Safer-mode trust gate",
    body: executionReadyBody("Do not autonomously execute untrusted GitHub-authored input."),
    createdAt: "2026-03-15T00:00:00Z",
    updatedAt: "2026-03-15T00:00:00Z",
    url: "https://example.test/issues/94",
    labels: [],
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
      journal_path: "/tmp/workspaces/issue-94/.codex-supervisor/issue-journal.md",
    }),
    syncIssueJournal: async ({ record }) => {
      journalSyncs.push(record);
    },
  });

  assert.deepEqual(result, { kind: "restart" });
  assert.equal(released, true);
  assert.equal(state.activeIssueNumber, null);
  assert.equal(state.issues["94"]?.state, "blocked");
  assert.equal(state.issues["94"]?.blocked_reason, "permissions");
  assert.equal(state.issues["94"]?.last_failure_signature, "autonomous-trust-gate");
  assert.match(state.issues["94"]?.last_error ?? "", /Autonomous execution blocked for issue #94/);
  assert.match(state.issues["94"]?.last_error ?? "", /GitHub-authored issue or review input is untrusted/i);
  assert.equal(journalSyncs.length, 1);
  assert.equal(savedStates.length, 2);
});

test("resolveRunnableIssueContext allows safer-mode execution when the issue has the trusted-input label", async () => {
  const config = createConfig({
    trustMode: "untrusted_or_mixed",
    executionSafetyMode: "operator_gated",
  });
  const issue: GitHubIssue = {
    number: 95,
    title: "Trusted-input override",
    body: executionReadyBody("Allow this issue to run in safer mode."),
    createdAt: "2026-03-15T00:00:00Z",
    updatedAt: "2026-03-15T00:00:00Z",
    url: "https://example.test/issues/95",
    state: "OPEN",
    labels: [{ name: "trusted-input" }],
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
  assert.equal(result.record.issue_number, 95);
  assert.equal(result.issue.number, 95);
  assert.equal(released, false);
  assert.equal(state.activeIssueNumber, 95);
  assert.equal(state.issues["95"]?.state, "queued");
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
    labels: [],
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
    labels: [],
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
    labels: [],
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
    labels: [],
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
    labels: [],
    state: "OPEN",
  };
  const otherIssue: GitHubIssue = {
    number: 93,
    title: "Another ready issue",
    body: executionReadyBody("This issue should not be claimed in the same cycle."),
    createdAt: "2026-03-15T00:05:00Z",
    updatedAt: "2026-03-15T00:05:00Z",
    url: "https://example.test/issues/93",
    labels: [],
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

test("resolveRunnableIssueContext blocks retry attempts that still have invalid issue metadata", async () => {
  const config = createConfig();
  const issue: GitHubIssue = {
    number: 98,
    title: "Retry issue with invalid issue metadata",
    body: `${executionReadyBody("Repair the issue only after valid issue metadata is restored.")}

Part of: #98
Depends on: none
Execution order: 1 of 1
Parallelizable: No`,
    createdAt: "2026-03-15T00:00:00Z",
    updatedAt: "2026-03-15T00:00:00Z",
    url: "https://example.test/issues/98",
    labels: [{ name: "codex" }],
    state: "OPEN",
  };
  const state: SupervisorStateFile = {
    activeIssueNumber: 98,
    issues: {
      "98": createRecord(98, {
        attempt_count: 1,
        implementation_attempt_count: 1,
      }),
    },
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
    currentRecord: state.issues["98"] ?? null,
    acquireIssueLock: async () => ({
      acquired: true,
      release: async () => {
        released = true;
      },
    }),
    ensureRecordJournalContext: async (record) => ({
      workspace: record.workspace,
      journal_path: "/tmp/workspaces/issue-98/.codex-supervisor/issue-journal.md",
    }),
    syncIssueJournal: async ({ record }) => {
      journalSyncs.push(record);
    },
  });

  assert.deepEqual(result, { kind: "restart" });
  assert.equal(released, true);
  assert.equal(state.activeIssueNumber, null);
  assert.equal(savedStates.length, 1);
  assert.equal(state.issues["98"]?.state, "blocked");
  assert.equal(state.issues["98"]?.blocked_reason, "requirements");
  assert.match(state.issues["98"]?.last_error ?? "", /invalid issue metadata/i);
  assert.match(state.issues["98"]?.last_error ?? "", /part of references the issue itself/i);
  assert.equal(journalSyncs.length, 1);
  assert.equal(journalSyncs[0]?.issue_number, 98);
});

test("resolveRunnableIssueContext blocks degraded active issues with invalid scheduling metadata before targeted dependency reads", async () => {
  const config = createConfig();
  const issue: GitHubIssue = {
    number: 99,
    title: "Degraded active issue with invalid scheduling metadata",
    body: `${executionReadyBody("Stay blocked until duplicate scheduling metadata is repaired.")}

Depends on: none
Depends on: #95
Parallelizable: No`,
    createdAt: "2026-03-15T00:00:00Z",
    updatedAt: "2026-03-15T00:00:00Z",
    url: "https://example.test/issues/99",
    labels: [{ name: "codex" }],
    state: "OPEN",
  };
  const state: SupervisorStateFile = {
    activeIssueNumber: 99,
    inventory_refresh_failure: {
      source: "gh issue list",
      message: "Failed to parse JSON from gh issue list.",
      recorded_at: "2026-03-26T00:00:00Z",
    },
    issues: {
      "99": createRecord(99, {
        attempt_count: 1,
        implementation_attempt_count: 1,
      }),
    },
  };
  const savedStates: SupervisorStateFile[] = [];
  const requestedIssueNumbers: number[] = [];
  let released = false;

  const result = await resolveRunnableIssueContext({
    github: {
      listCandidateIssues: async () => {
        throw new Error("unexpected broad candidate inventory read");
      },
      getIssue: async (issueNumber) => {
        requestedIssueNumbers.push(issueNumber);
        return issue;
      },
    },
    config,
    stateStore: createTouchStateStore(savedStates),
    state,
    currentRecord: state.issues["99"] ?? null,
    acquireIssueLock: async () => ({
      acquired: true,
      release: async () => {
        released = true;
      },
    }),
    ensureRecordJournalContext: async (record) => ({
      workspace: record.workspace,
      journal_path: "/tmp/workspaces/issue-99/.codex-supervisor/issue-journal.md",
    }),
  });

  assert.deepEqual(result, { kind: "restart" });
  assert.equal(released, true);
  assert.deepEqual(requestedIssueNumbers, [99]);
  assert.equal(state.activeIssueNumber, null);
  assert.equal(state.issues["99"]?.state, "blocked");
  assert.equal(state.issues["99"]?.blocked_reason, "requirements");
  assert.match(state.issues["99"]?.last_error ?? "", /invalid issue metadata/i);
  assert.match(state.issues["99"]?.last_error ?? "", /depends on must appear exactly once/i);
  assert.equal(savedStates.length, 1);
});

test("resolveRunnableIssueContext uses targeted dependency reads instead of broad candidate inventory when full inventory refresh is degraded", async () => {
  const config = createConfig();
  const issue: GitHubIssue = {
    number: 96,
    title: "Constrained active issue",
    body: `## Summary
Continue only after the dependency closes.

## Scope
- resume the active tracked issue safely

## Acceptance criteria
- degrade safely

## Verification
- npm test -- src/run-once-issue-selection.test.ts

Depends on: #95`,
    createdAt: "2026-03-15T00:00:00Z",
    updatedAt: "2026-03-15T00:00:00Z",
    url: "https://example.test/issues/96",
    labels: [],
    state: "OPEN",
  };
  const dependencyIssue: GitHubIssue = {
    number: 95,
    title: "Dependency issue",
    body: executionReadyBody("Close me first."),
    createdAt: "2026-03-15T00:00:00Z",
    updatedAt: "2026-03-15T00:00:00Z",
    url: "https://example.test/issues/95",
    labels: [],
    state: "CLOSED",
  };
  const state: SupervisorStateFile = {
    activeIssueNumber: 96,
    inventory_refresh_failure: {
      source: "gh issue list",
      message: "Failed to parse JSON from gh issue list.",
      recorded_at: "2026-03-26T00:00:00Z",
    },
    issues: {
      "95": createRecord(95, { state: "done" }),
      "96": createRecord(96),
    },
  };
  const savedStates: SupervisorStateFile[] = [];
  const requestedIssueNumbers: number[] = [];
  let listCandidateIssuesCalls = 0;

  const result = await resolveRunnableIssueContext({
    github: {
      listCandidateIssues: async () => {
        listCandidateIssuesCalls += 1;
        throw new Error("unexpected broad candidate inventory read");
      },
      getIssue: async (issueNumber) => {
        requestedIssueNumbers.push(issueNumber);
        return issueNumber === 95 ? dependencyIssue : issue;
      },
    },
    config,
    stateStore: createTouchStateStore(savedStates),
    state,
    currentRecord: state.issues["96"] ?? null,
    acquireIssueLock: async () => ({
      acquired: true,
      release: async () => {},
    }),
  });

  assert.ok(typeof result !== "string");
  assert.equal(result.kind, "ready");
  assert.equal(result.record.issue_number, 96);
  assert.deepEqual(requestedIssueNumbers, [96, 95]);
  assert.equal(listCandidateIssuesCalls, 0);
  assert.equal(savedStates.length, 0);
});

test("resolveRunnableIssueContext requeues degraded active issues that still require broad execution-order inventory", async () => {
  const config = createConfig();
  const issue: GitHubIssue = {
    number: 97,
    title: "Execution-order constrained issue",
    body: `## Summary
Do not continue me while broad inventory is degraded.

## Scope
- stay safely paused

## Acceptance criteria
- execution order does not rely on cached backlog ordering

## Verification
- npm test -- src/run-once-issue-selection.test.ts

Part of: #150
Execution order: 2 of 3`,
    createdAt: "2026-03-15T00:00:00Z",
    updatedAt: "2026-03-15T00:00:00Z",
    url: "https://example.test/issues/97",
    labels: [],
    state: "OPEN",
  };
  const state: SupervisorStateFile = {
    activeIssueNumber: 97,
    inventory_refresh_failure: {
      source: "gh issue list",
      message: "Failed to parse JSON from gh issue list.",
      recorded_at: "2026-03-26T00:00:00Z",
    },
    issues: {
      "97": createRecord(97),
    },
  };
  const savedStates: SupervisorStateFile[] = [];
  let released = false;
  let listCandidateIssuesCalls = 0;

  const result = await resolveRunnableIssueContext({
    github: {
      listCandidateIssues: async () => {
        listCandidateIssuesCalls += 1;
        throw new Error("unexpected broad candidate inventory read");
      },
      getIssue: async () => issue,
    },
    config,
    stateStore: createTouchStateStore(savedStates),
    state,
    currentRecord: state.issues["97"] ?? null,
    acquireIssueLock: async () => ({
      acquired: true,
      release: async () => {
        released = true;
      },
    }),
  });

  assert.deepEqual(result, { kind: "restart" });
  assert.equal(released, true);
  assert.equal(listCandidateIssuesCalls, 0);
  assert.equal(state.activeIssueNumber, null);
  assert.equal(state.issues["97"]?.state, "queued");
  assert.match(
    state.issues["97"]?.last_error ?? "",
    /Full inventory refresh is degraded, so execution-order gating for issue #97 requires broad inventory and cannot continue safely/,
  );
  assert.equal(savedStates.length, 1);
});

test("resolveRunnableIssueContext requeues active issues after repeated transient refresh failures even when a fresh snapshot exists", async () => {
  const config = createConfig();
  const issue: GitHubIssue = {
    number: 96,
    title: "Constrained active issue",
    body: `## Summary
Continue only after the dependency closes.

## Scope
- resume the active tracked issue safely

## Acceptance criteria
- degrade safely

## Verification
- npm test -- src/run-once-issue-selection.test.ts

Depends on: #95`,
    createdAt: "2026-03-15T00:00:00Z",
    updatedAt: "2026-03-15T00:00:00Z",
    url: "https://example.test/issues/96",
    labels: [],
    state: "OPEN",
  };
  const state: SupervisorStateFile = {
    activeIssueNumber: 96,
    inventory_refresh_failure: {
      source: "gh issue list",
      message:
        'Transient GitHub CLI failure after 3 attempts: gh issue list --repo owner/repo\nCommand failed: gh issue list --repo owner/repo\nexitCode=1\nPost "https://api.github.com/graphql": read tcp 127.0.0.1:12345->140.82.112.6:443: read: connection reset by peer',
      recorded_at: "2026-03-26T00:10:00Z",
    },
    last_successful_inventory_snapshot: {
      source: "gh issue list",
      recorded_at: new Date(Date.now() - 5 * 60 * 1000).toISOString(),
      issue_count: 2,
      issues: [
        {
          number: 95,
          title: "Dependency issue",
          body: executionReadyBody("Close me first."),
          createdAt: "2026-03-15T00:00:00Z",
          updatedAt: "2026-03-15T00:00:00Z",
          url: "https://example.test/issues/95",
          labels: [],
          state: "CLOSED",
        },
        issue,
      ],
    },
    issues: {
      "95": createRecord(95, { state: "done" }),
      "96": createRecord(96),
    },
  };
  const savedStates: SupervisorStateFile[] = [];
  let released = false;
  let getIssueCalls = 0;

  const result = await resolveRunnableIssueContext({
    github: {
      listCandidateIssues: async () => {
        throw new Error("unexpected broad candidate inventory read");
      },
      getIssue: async () => {
        getIssueCalls += 1;
        return issue;
      },
    },
    config,
    stateStore: createTouchStateStore(savedStates),
    state,
    currentRecord: state.issues["96"] ?? null,
    acquireIssueLock: async () => ({
      acquired: true,
      release: async () => {
        released = true;
      },
    }),
  });

  assert.deepEqual(result, { kind: "restart" });
  assert.equal(released, true);
  assert.equal(getIssueCalls, 0);
  assert.equal(state.activeIssueNumber, null);
  assert.equal(state.issues["96"]?.state, "queued");
  assert.match(
    state.issues["96"]?.last_error ?? "",
    /Full inventory refresh is degraded and bounded continuation is no longer allowed for issue #96/,
  );
  assert.equal(savedStates.length, 1);
});

test("resolveRunnableIssueContext keeps tracked PR lifecycle states during repeated transient refresh failures", async () => {
  const config = createConfig();
  const issue: GitHubIssue = {
    number: 96,
    title: "Tracked PR issue",
    body: executionReadyBody("Continue the tracked PR lifecycle without broad inventory."),
    createdAt: "2026-03-15T00:00:00Z",
    updatedAt: "2026-03-15T00:00:00Z",
    url: "https://example.test/issues/96",
    labels: [],
    state: "OPEN",
  };
  const state: SupervisorStateFile = {
    activeIssueNumber: 96,
    inventory_refresh_failure: {
      source: "gh issue list",
      message:
        'Transient GitHub CLI failure after 3 attempts: gh issue list --repo owner/repo\nCommand failed: gh issue list --repo owner/repo\nexitCode=1\nPost "https://api.github.com/graphql": read tcp 127.0.0.1:12345->140.82.112.6:443: read: connection reset by peer',
      recorded_at: "2026-03-26T00:10:00Z",
    },
    last_successful_inventory_snapshot: {
      source: "gh issue list",
      recorded_at: new Date(Date.now() - 5 * 60 * 1000).toISOString(),
      issue_count: 1,
      issues: [issue],
    },
    issues: {
      "96": createRecord(96, {
        state: "waiting_ci",
        pr_number: 170,
      }),
    },
  };
  const savedStates: SupervisorStateFile[] = [];
  let released = false;
  let getIssueCalls = 0;

  const result = await resolveRunnableIssueContext({
    github: {
      listCandidateIssues: async () => {
        throw new Error("unexpected broad candidate inventory read");
      },
      getIssue: async () => {
        getIssueCalls += 1;
        return issue;
      },
    },
    config,
    stateStore: createTouchStateStore(savedStates),
    state,
    currentRecord: state.issues["96"] ?? null,
    acquireIssueLock: async () => ({
      acquired: true,
      release: async () => {
        released = true;
      },
    }),
  });

  assert.ok(typeof result !== "string");
  assert.equal(result.kind, "ready");
  assert.equal(result.record.issue_number, 96);
  assert.equal(result.record.state, "waiting_ci");
  assert.equal(result.record.pr_number, 170);
  assert.equal(getIssueCalls, 1);
  assert.equal(released, false);
  assert.equal(state.activeIssueNumber, 96);
  assert.equal(state.issues["96"]?.state, "waiting_ci");
  assert.equal(state.issues["96"]?.pr_number, 170);
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
    labels: [],
    state: "OPEN",
  };
  const closedIssue: GitHubIssue = {
    ...selectedIssue,
    labels: [],
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
    labels: [],
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
    labels: [],
    state: "OPEN",
  };
  const readyIssue: GitHubIssue = {
    number: 93,
    title: "Independent ready issue",
    body: executionReadyBody("Ship the ready issue."),
    createdAt: "2026-03-15T00:10:00Z",
    updatedAt: "2026-03-15T00:10:00Z",
    url: "https://example.test/issues/93",
    labels: [],
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
