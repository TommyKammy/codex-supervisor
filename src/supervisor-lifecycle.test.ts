import assert from "node:assert/strict";
import test from "node:test";
import { derivePullRequestLifecycleSnapshot, shouldRunCodex } from "./supervisor-lifecycle";
import { GitHubPullRequest, IssueRunRecord, PullRequestCheck, ReviewThread, SupervisorConfig } from "./types";

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
    pr_number: 44,
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
    repeated_failure_signature_count: 0,
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
    headRefName: "codex/issue-38",
    headRefOid: "head123",
    mergedAt: null,
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

test("derivePullRequestLifecycleSnapshot applies review-bot lifecycle patches before inferring blocked timeout state", () => {
  withStubbedDateNow("2026-03-13T00:20:00Z", () => {
    const config = createConfig({
      reviewBotLogins: ["copilot-pull-request-reviewer"],
      copilotReviewWaitMinutes: 10,
      copilotReviewTimeoutAction: "block",
    });
    const record = createRecord({ state: "waiting_ci" });
    const pr = createPullRequest({
      copilotReviewState: "requested",
      copilotReviewRequestedAt: "2026-03-13T00:00:00Z",
      copilotReviewArrivedAt: null,
    });
    const checks: PullRequestCheck[] = [{ name: "build", state: "SUCCESS", bucket: "pass", workflow: "CI" }];
    const reviewThreads: ReviewThread[] = [];

    const snapshot = derivePullRequestLifecycleSnapshot(config, record, pr, checks, reviewThreads);

    assert.equal(snapshot.nextState, "blocked");
    assert.deepEqual(snapshot.copilotRequestObservationPatch, {
      copilot_review_requested_observed_at: "2026-03-13T00:00:00Z",
      copilot_review_requested_head_sha: "head123",
    });
    assert.deepEqual(snapshot.copilotTimeoutPatch, {
      copilot_review_timed_out_at: "2026-03-13T00:10:00.000Z",
      copilot_review_timeout_action: "block",
      copilot_review_timeout_reason:
        "Requested Copilot review never arrived within 10 minute(s) for head head123.",
    });
    assert.equal(snapshot.failureContext?.signature, "review-bot-timeout:head123:block");
    assert.equal(snapshot.recordForState.copilot_review_timeout_action, "block");
  });
});

test("shouldRunCodex only returns true for actionable supervisor states", () => {
  const config = createConfig();
  const checks: PullRequestCheck[] = [{ name: "build", state: "SUCCESS", bucket: "pass", workflow: "CI" }];
  const reviewThreads: ReviewThread[] = [];

  assert.equal(shouldRunCodex(createRecord({ state: "queued", pr_number: null }), null, [], [], config), true);
  assert.equal(
    shouldRunCodex(createRecord({ state: "draft_pr" }), createPullRequest({ isDraft: true }), checks, reviewThreads, config),
    true,
  );
  assert.equal(
    shouldRunCodex(createRecord({ state: "waiting_ci" }), createPullRequest(), checks, reviewThreads, config),
    false,
  );
  assert.equal(
    shouldRunCodex(
      createRecord({ state: "repairing_ci" }),
      createPullRequest({ mergeStateStatus: "CLEAN" }),
      [{ name: "build", state: "FAILURE", bucket: "fail", workflow: "CI" }],
      reviewThreads,
      config,
    ),
    true,
  );
});
