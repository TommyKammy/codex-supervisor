import test from "node:test";
import assert from "node:assert/strict";
import { inferFailureContext } from "./supervisor-failure-context";
import { GitHubPullRequest, IssueRunRecord, PullRequestCheck, ReviewThread, SupervisorConfig } from "../core/types";

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
    last_error: null,
    last_failure_kind: null,
    last_failure_context: null,
    last_blocker_signature: null,
    last_failure_signature: null,
    blocked_reason: null,
    processed_review_thread_ids: [],
    processed_review_thread_fingerprints: [],
    updated_at: "2026-03-11T01:50:41.997Z",
    ...overrides,
  };
}

function createPullRequest(overrides: Partial<GitHubPullRequest> = {}): GitHubPullRequest {
  return {
    number: 44,
    title: "Test PR",
    url: "https://example.test/pr/44",
    state: "OPEN",
    createdAt: "2026-03-11T00:00:00Z",
    isDraft: false,
    reviewDecision: null,
    mergeStateStatus: "CLEAN",
    mergeable: "MERGEABLE",
    headRefName: "codex/issue-44",
    headRefOid: "head123",
    mergedAt: null,
    ...overrides,
  };
}

function createReviewThread(overrides: Partial<ReviewThread> = {}): ReviewThread {
  return {
    id: "thread-1",
    isResolved: false,
    isOutdated: false,
    path: "src/file.ts",
    line: 12,
    comments: {
      nodes: [
        {
          id: "comment-1",
          body: "Please address this.",
          createdAt: "2026-03-11T00:00:00Z",
          url: "https://example.test/pr/44#discussion_r1",
          author: {
            login: "copilot-pull-request-reviewer",
            typeName: "Bot",
          },
        },
      ],
    },
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

test("inferFailureContext prefers failing checks over later blockers", () => {
  const config = createConfig({
    reviewBotLogins: ["copilot-pull-request-reviewer"],
    copilotReviewTimeoutAction: "block",
  });
  const pr = createPullRequest({
    copilotReviewState: "requested",
    copilotReviewRequestedAt: "2026-03-11T00:00:00Z",
  });
  const record = createRecord({
    copilot_review_requested_observed_at: "2026-03-11T00:00:00Z",
    copilot_review_requested_head_sha: pr.headRefOid,
  });
  const checks: PullRequestCheck[] = [{ name: "build", state: "FAILURE", bucket: "fail", workflow: "CI" }];

  const context = withStubbedDateNow("2026-03-11T00:20:00Z", () =>
    inferFailureContext(config, record, pr, checks, [createReviewThread()]),
  );

  assert.equal(context?.category, "checks");
  assert.equal(context?.summary, "PR #44 has failing checks.");
});

test("inferFailureContext returns timeout context before review blockers", () => {
  const config = createConfig({
    reviewBotLogins: ["copilot-pull-request-reviewer"],
    copilotReviewTimeoutAction: "block",
  });
  const pr = createPullRequest({
    reviewDecision: "CHANGES_REQUESTED",
    copilotReviewState: "requested",
    copilotReviewRequestedAt: "2026-03-11T00:00:00Z",
  });
  const record = createRecord({
    copilot_review_requested_observed_at: "2026-03-11T00:00:00Z",
    copilot_review_requested_head_sha: pr.headRefOid,
  });

  const context = withStubbedDateNow("2026-03-11T00:20:00Z", () =>
    inferFailureContext(config, record, pr, [], [createReviewThread()]),
  );

  assert.equal(context?.category, "blocked");
  assert.match(context?.summary ?? "", /timed out/);
});

test("inferFailureContext returns automated review blocker context", () => {
  const config = createConfig({
    reviewBotLogins: ["copilot-pull-request-reviewer"],
    humanReviewBlocksMerge: false,
  });
  const pr = createPullRequest({ reviewDecision: "CHANGES_REQUESTED" });

  const context = inferFailureContext(config, createRecord(), pr, [], [createReviewThread()]);

  assert.equal(context?.category, "review");
  assert.equal(context?.summary, "1 unresolved automated review thread(s) remain.");
});

test("inferFailureContext returns local review blocker context", () => {
  const config = createConfig({
    localReviewPolicy: "block_ready",
    localReviewHighSeverityAction: "blocked",
  });
  const pr = createPullRequest();
  const record = createRecord({
    local_review_head_sha: pr.headRefOid,
    local_review_findings_count: 2,
    local_review_root_cause_count: 1,
    local_review_max_severity: "high",
    local_review_verified_findings_count: 1,
    local_review_verified_max_severity: "high",
    local_review_recommendation: "changes_requested",
  });

  const context = inferFailureContext(config, record, pr, [], []);

  assert.equal(context?.category, "blocked");
  assert.match(context?.summary ?? "", /Local review found 2 actionable finding/);
});

test("inferFailureContext returns degraded local review blocker context for current-head draft PRs", () => {
  const config = createConfig({
    localReviewEnabled: true,
    localReviewPolicy: "block_merge",
  });
  const pr = createPullRequest({
    isDraft: true,
  });
  const record = createRecord({
    local_review_head_sha: pr.headRefOid,
    local_review_findings_count: 1,
    local_review_root_cause_count: 1,
    local_review_max_severity: "medium",
    local_review_verified_findings_count: 0,
    local_review_verified_max_severity: null,
    local_review_recommendation: "changes_requested",
    local_review_degraded: true,
  });

  const context = inferFailureContext(config, record, pr, [], []);

  assert.equal(context?.category, "blocked");
  assert.equal(context?.summary, "Local review completed in a degraded state.");
  assert.match(context?.signature ?? "", /:degraded$/);
});

test("inferFailureContext reports missing current-head local review explicitly instead of a synthetic clean review summary", () => {
  const config = createConfig({
    localReviewEnabled: true,
    localReviewPolicy: "block_merge",
    trackedPrCurrentHeadLocalReviewRequired: false,
  });
  const pr = createPullRequest({ headRefOid: "head-new", isDraft: false });
  const record = createRecord({
    state: "blocked",
    blocked_reason: "verification",
    local_review_head_sha: null,
    local_review_findings_count: 0,
    local_review_root_cause_count: 0,
    local_review_recommendation: null,
    pre_merge_evaluation_outcome: null,
  });

  const context = inferFailureContext(config, record, pr, [], []);

  assert.equal(context?.category, "blocked");
  assert.equal(context?.summary, "Current PR head is still waiting for a local review run.");
  assert.equal(context?.signature, "local-review-missing:head-new");
  assert.deepEqual(context?.details, [
    "reviewed_head_sha=none",
    "pr_head_sha=head-new",
    "status=missing",
    "summary=awaiting_local_review",
  ]);
});

test("inferFailureContext reports stale current-head local review explicitly instead of a synthetic clean review summary", () => {
  const config = createConfig({
    localReviewEnabled: true,
    localReviewPolicy: "block_merge",
    trackedPrCurrentHeadLocalReviewRequired: false,
  });
  const pr = createPullRequest({ headRefOid: "head-new", isDraft: false });
  const record = createRecord({
    state: "blocked",
    blocked_reason: "verification",
    local_review_head_sha: "head-old",
    local_review_findings_count: 0,
    local_review_root_cause_count: 0,
    local_review_recommendation: "ready",
    pre_merge_evaluation_outcome: "mergeable",
  });

  const context = inferFailureContext(config, record, pr, [], []);

  assert.equal(context?.category, "blocked");
  assert.equal(context?.summary, "Current PR head is still waiting for a fresh local review run.");
  assert.equal(context?.signature, "local-review-stale:head-old:head-new");
  assert.deepEqual(context?.details, [
    "reviewed_head_sha=head-old",
    "pr_head_sha=head-new",
    "status=stale",
    "summary=awaiting_local_review",
  ]);
});

test("inferFailureContext keeps unresolved manual review ahead of pending current-head local review", () => {
  const config = createConfig({
    localReviewEnabled: true,
    localReviewPolicy: "block_merge",
    trackedPrCurrentHeadLocalReviewRequired: false,
    humanReviewBlocksMerge: true,
  });
  const pr = createPullRequest({ headRefOid: "head-new", isDraft: false });
  const record = createRecord({
    state: "blocked",
    blocked_reason: "verification",
    local_review_head_sha: null,
  });
  const manualThread = createReviewThread({
    id: "manual-thread-1",
    comments: {
      nodes: [
        {
          id: "manual-comment-1",
          body: "Please resolve this before merge.",
          createdAt: "2026-03-11T00:00:00Z",
          url: "https://example.test/pr/44#discussion_r2",
          author: {
            login: "teammate",
            typeName: "User",
          },
        },
      ],
    },
  });

  const context = inferFailureContext(config, record, pr, [], [manualThread]);

  assert.equal(context?.category, "manual");
  assert.equal(context?.summary, "1 unresolved manual or unconfigured review thread(s) require human attention.");
  assert.match(context?.signature ?? "", /^manual:manual-thread-1$/);
});

test("inferFailureContext keeps unresolved configured bot review ahead of pending current-head local review", () => {
  const config = createConfig({
    localReviewEnabled: true,
    localReviewPolicy: "block_merge",
    trackedPrCurrentHeadLocalReviewRequired: false,
    reviewBotLogins: ["copilot-pull-request-reviewer"],
    humanReviewBlocksMerge: false,
  });
  const pr = createPullRequest({ headRefOid: "head-new", isDraft: false });
  const record = createRecord({
    state: "blocked",
    blocked_reason: "verification",
    local_review_head_sha: null,
  });

  const context = inferFailureContext(config, record, pr, [], [createReviewThread({ id: "bot-thread-1" })]);

  assert.equal(context?.category, "review");
  assert.equal(context?.summary, "1 unresolved automated review thread(s) remain.");
  assert.equal(context?.signature, "bot-thread-1");
});

test("inferFailureContext keeps merge conflicts ahead of pending current-head local review", () => {
  const config = createConfig({
    localReviewEnabled: true,
    localReviewPolicy: "block_merge",
    trackedPrCurrentHeadLocalReviewRequired: false,
  });
  const pr = createPullRequest({
    headRefOid: "head-new",
    isDraft: false,
    mergeStateStatus: "DIRTY",
    mergeable: "CONFLICTING",
  });
  const record = createRecord({
    state: "blocked",
    blocked_reason: "verification",
    local_review_head_sha: null,
  });

  const context = inferFailureContext(config, record, pr, [], []);

  assert.equal(context?.category, "conflict");
  assert.equal(context?.summary, "PR #44 has merge conflicts and needs a base-branch integration pass.");
  assert.equal(context?.signature, "dirty:head-new");
});

test("inferFailureContext returns merge conflict context when no earlier blocker applies", () => {
  const context = inferFailureContext(
    createConfig(),
    createRecord(),
    createPullRequest({ mergeStateStatus: "DIRTY", mergeable: "CONFLICTING" }),
    [],
    [],
  );

  assert.equal(context?.category, "conflict");
  assert.equal(context?.summary, "PR #44 has merge conflicts and needs a base-branch integration pass.");
});
