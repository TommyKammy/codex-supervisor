import assert from "node:assert/strict";
import test from "node:test";
import { configuredBotReviewThreads, manualReviewThreads } from "./supervisor-reporting";
import { buildDetailedStatusModel, buildDetailedStatusSummaryLines } from "./supervisor-status-model";
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
      generic: { confidenceThreshold: 0.7, minimumSeverity: "low" },
      specialist: { confidenceThreshold: 0.7, minimumSeverity: "low" },
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
    createdAt: "2026-03-11T14:00:00Z",
    isDraft: false,
    reviewDecision: "REVIEW_REQUIRED",
    mergeStateStatus: "CLEAN",
    mergeable: "MERGEABLE",
    headRefName: "codex/issue-44",
    headRefOid: "deadbeef",
    mergedAt: null,
    ...overrides,
  };
}

test("buildDetailedStatusModel returns the reusable core status lines for an active PR", () => {
  const config = createConfig({
    localReviewPolicy: "block_ready",
    reviewBotLogins: ["chatgpt-codex-connector"],
  });
  const record = createRecord({
    local_review_head_sha: "deadbeef",
    local_review_blocker_summary: "high src/supervisor.ts:210-214 stale artifact context drives the wrong repair path.",
    local_review_max_severity: "high",
    local_review_findings_count: 3,
    local_review_recommendation: "changes_requested",
    local_review_run_at: "2026-03-11T14:05:00Z",
    pr_number: 44,
    state: "pr_open",
    blocked_reason: null,
    last_error: null,
    last_failure_context: null,
  });

  const lines = buildDetailedStatusModel({
    config,
    activeRecord: record,
    latestRecord: null,
    trackedIssueCount: 1,
    pr: createPullRequest({
      copilotReviewState: "not_requested",
      copilotReviewRequestedAt: null,
      copilotReviewArrivedAt: null,
    }),
    checks: [{ name: "build", state: "SUCCESS", bucket: "pass", workflow: "CI" }],
    reviewThreads: [],
    manualReviewThreads,
    configuredBotReviewThreads,
    pendingBotReviewThreads: (innerConfig, innerRecord, innerPr, innerReviewThreads) =>
      configuredBotReviewThreads(innerConfig, innerReviewThreads).filter(
        (thread) =>
          !innerRecord.processed_review_thread_ids.includes(thread.id) &&
          innerRecord.last_head_sha === innerPr.headRefOid,
      ),
    summarizeChecks: (checks) => ({
      allPassing: checks.every((check) => check.bucket === "pass"),
      hasPending: checks.some((check) => check.bucket === "pending" || check.bucket === "cancel"),
      hasFailing: checks.some((check) => check.bucket === "fail"),
    }),
    mergeConflictDetected: (pr) => pr.mergeStateStatus === "DIRTY",
  });

  assert.ok(lines.includes("issue=#366"));
  assert.ok(
    lines.some((line) =>
      /local_review gating=yes policy=block_ready findings=3 .* head=current .* blocker_summary=high src\/supervisor\.ts:210-214 stale artifact context drives the wrong repair path\./.test(
        line,
      ),
    ),
  );
  assert.ok(lines.includes("external_review head=none reviewed_head_sha=none matched=0 near_match=0 missed=0"));
  assert.ok(
    lines.includes(
      "review_bot_profile profile=codex provider=chatgpt-codex-connector reviewers=chatgpt-codex-connector signal_source=review_threads",
    ),
  );
  assert.ok(
    lines.includes(
      "review_bot_diagnostics status=missing_provider_signal observed_review=none expected_reviewers=chatgpt-codex-connector next_check=provider_setup_or_delivery",
    ),
  );
});

test("buildDetailedStatusModel explains why an active CodeRabbit settled wait is pausing merge progression", () => {
  const originalNow = Date.now;
  Date.now = () => Date.parse("2026-03-16T00:00:03.000Z");

  try {
    const lines = buildDetailedStatusModel({
      config: createConfig({
        reviewBotLogins: ["coderabbitai", "coderabbitai[bot]"],
      }),
      activeRecord: createRecord({
        pr_number: 44,
        state: "waiting_ci",
        blocked_reason: null,
        last_error: null,
      }),
      latestRecord: null,
      trackedIssueCount: 1,
      pr: createPullRequest({
        configuredBotCurrentHeadObservedAt: "2026-03-16T00:00:00.000Z",
      }),
      checks: [{ name: "build", state: "SUCCESS", bucket: "pass", workflow: "CI" }],
      reviewThreads: [],
      manualReviewThreads,
      configuredBotReviewThreads,
      pendingBotReviewThreads: (innerConfig, innerRecord, innerPr, innerReviewThreads) =>
        configuredBotReviewThreads(innerConfig, innerReviewThreads).filter(
          (thread) =>
            !innerRecord.processed_review_thread_ids.includes(thread.id) &&
            innerRecord.last_head_sha === innerPr.headRefOid,
        ),
      summarizeChecks: (checks) => ({
        allPassing: checks.every((check) => check.bucket === "pass"),
        hasPending: checks.some((check) => check.bucket === "pending" || check.bucket === "cancel"),
        hasFailing: checks.some((check) => check.bucket === "fail"),
      }),
      mergeConflictDetected: (pr) => pr.mergeStateStatus === "DIRTY",
    });

    assert.ok(
      lines.includes(
        "configured_bot_settled_wait status=active provider=coderabbit pause_reason=recent_current_head_observation recent_observation=current_head_activity observed_at=2026-03-16T00:00:00.000Z configured_wait_seconds=5 wait_until=2026-03-16T00:00:05.000Z",
      ),
    );
  } finally {
    Date.now = originalNow;
  }
});

test("buildDetailedStatusModel explains why an active CodeRabbit initial grace wait is pausing merge progression", () => {
  const originalNow = Date.now;
  Date.now = () => Date.parse("2026-03-16T00:01:00.000Z");

  try {
    const lines = buildDetailedStatusModel({
      config: createConfig({
        reviewBotLogins: ["coderabbitai", "coderabbitai[bot]"],
        configuredBotInitialGraceWaitSeconds: 90,
      }),
      activeRecord: createRecord({
        pr_number: 44,
        state: "waiting_ci",
        blocked_reason: null,
        last_error: null,
      }),
      latestRecord: null,
      trackedIssueCount: 1,
      pr: createPullRequest({
        currentHeadCiGreenAt: "2026-03-16T00:00:00.000Z",
        configuredBotCurrentHeadObservedAt: null,
      }),
      checks: [{ name: "build", state: "SUCCESS", bucket: "pass", workflow: "CI" }],
      reviewThreads: [],
      manualReviewThreads,
      configuredBotReviewThreads,
      pendingBotReviewThreads: (innerConfig, innerRecord, innerPr, innerReviewThreads) =>
        configuredBotReviewThreads(innerConfig, innerReviewThreads).filter(
          (thread) =>
            !innerRecord.processed_review_thread_ids.includes(thread.id) &&
            innerRecord.last_head_sha === innerPr.headRefOid,
        ),
      summarizeChecks: (checks) => ({
        allPassing: checks.every((check) => check.bucket === "pass"),
        hasPending: checks.some((check) => check.bucket === "pending" || check.bucket === "cancel"),
        hasFailing: checks.some((check) => check.bucket === "fail"),
      }),
      mergeConflictDetected: (pr) => pr.mergeStateStatus === "DIRTY",
    });

    assert.ok(
      lines.includes(
        "configured_bot_initial_grace_wait status=active provider=coderabbit pause_reason=awaiting_initial_provider_activity recent_observation=required_checks_green observed_at=2026-03-16T00:00:00.000Z configured_wait_seconds=90 wait_until=2026-03-16T00:01:30.000Z",
      ),
    );
  } finally {
    Date.now = originalNow;
  }
});

test("buildDetailedStatusModel explains when CodeRabbit is re-waiting after a draft skip and ready-for-review", () => {
  const originalNow = Date.now;
  Date.now = () => Date.parse("2026-03-16T00:00:45.000Z");

  try {
    const lines = buildDetailedStatusModel({
      config: createConfig({
        reviewBotLogins: ["coderabbitai", "coderabbitai[bot]"],
        configuredBotInitialGraceWaitSeconds: 90,
      }),
      activeRecord: createRecord({
        pr_number: 44,
        state: "waiting_ci",
        review_wait_started_at: "2026-03-16T00:00:30.000Z",
        review_wait_head_sha: "deadbeef",
        blocked_reason: null,
        last_error: null,
      }),
      latestRecord: null,
      trackedIssueCount: 1,
      pr: createPullRequest({
        currentHeadCiGreenAt: "2026-03-16T00:00:00.000Z",
        configuredBotCurrentHeadObservedAt: null,
        configuredBotDraftSkipAt: "2026-03-15T23:59:00.000Z",
      }),
      checks: [{ name: "build", state: "SUCCESS", bucket: "pass", workflow: "CI" }],
      reviewThreads: [],
      manualReviewThreads,
      configuredBotReviewThreads,
      pendingBotReviewThreads: (innerConfig, innerRecord, innerPr, innerReviewThreads) =>
        configuredBotReviewThreads(innerConfig, innerReviewThreads).filter(
          (thread) =>
            !innerRecord.processed_review_thread_ids.includes(thread.id) &&
            innerRecord.last_head_sha === innerPr.headRefOid,
        ),
      summarizeChecks: (checks) => ({
        allPassing: checks.every((check) => check.bucket === "pass"),
        hasPending: checks.some((check) => check.bucket === "pending" || check.bucket === "cancel"),
        hasFailing: checks.some((check) => check.bucket === "fail"),
      }),
      mergeConflictDetected: (pr) => pr.mergeStateStatus === "DIRTY",
    });

    assert.ok(
      lines.includes(
        "configured_bot_initial_grace_wait status=active provider=coderabbit pause_reason=awaiting_fresh_provider_review_after_draft_skip recent_observation=ready_for_review_reopened_wait observed_at=2026-03-16T00:00:30.000Z configured_wait_seconds=90 wait_until=2026-03-16T00:02:00.000Z",
      ),
    );
  } finally {
    Date.now = originalNow;
  }
});

test("buildDetailedStatusSummaryLines shapes optional summaries and artifact paths", () => {
  const config = createConfig({
    localReviewArtifactDir: "/tmp/reviews",
  });
  const activeRecord = createRecord({
    local_review_summary_path: "/tmp/reviews/owner-repo/issue-58/local-review-summary.md",
    external_review_misses_path: "/tmp/reviews/owner-repo/issue-58/external-review-misses-head-deadbeef.json",
  });
  const latestRecoveryRecord = createRecord({
    issue_number: 91,
    state: "done",
    branch: "codex/issue-91",
    workspace: "/tmp/workspaces/issue-91",
    updated_at: "2026-03-13T00:20:00Z",
    last_codex_summary: null,
    last_recovery_reason: "merged_pr_convergence: tracked PR #191 merged; marked issue #91 done",
    last_recovery_at: "2026-03-13T00:20:00Z",
  });

  assert.deepEqual(
    buildDetailedStatusSummaryLines({
      config,
      activeRecord,
      latestRecoveryRecord,
      handoffSummary: "blocked\nneeds reproduction",
      changeClassesSummary: "change_classes=backend, docs, tests",
      durableGuardrailSummary: "durable_guardrails verifier=committed:.codex/verifier-guardrails.json#1 external_review=none",
      externalReviewFollowUpSummary: "external_review_follow_up unresolved=2 actions=durable_guardrail:1|regression_test:1",
    }),
    [
      "handoff_summary=blocked\\nneeds reproduction",
      "change_classes=backend, docs, tests",
      "durable_guardrails verifier=committed:.codex/verifier-guardrails.json#1 external_review=none",
      "external_review_follow_up unresolved=2 actions=durable_guardrail:1|regression_test:1",
      "latest_recovery issue=#91 at=2026-03-13T00:20:00Z reason=merged_pr_convergence detail=tracked PR #191 merged; marked issue #91 done",
      "local_review_summary_path=owner-repo/issue-58/local-review-summary.md",
      "external_review_misses_path=owner-repo/issue-58/external-review-misses-head-deadbeef.json",
    ],
  );
});

test("buildDetailedStatusModel sanitizes failure context summary before emitting it", () => {
  const lines = buildDetailedStatusModel({
    config: createConfig(),
    activeRecord: createRecord({
      last_error: null,
      last_failure_context: {
        category: "blocked",
        summary: "first line\nsecond line",
        signature: "two-line-summary",
        command: null,
        details: [],
        url: null,
        updated_at: "2026-03-11T01:50:41.997Z",
      },
    }),
    latestRecord: null,
    trackedIssueCount: 1,
    pr: null,
    checks: [],
    reviewThreads: [],
    manualReviewThreads,
    configuredBotReviewThreads,
    pendingBotReviewThreads: () => [],
    summarizeChecks: () => ({ allPassing: true, hasPending: false, hasFailing: false }),
    mergeConflictDetected: (pr) => pr.mergeStateStatus === "DIRTY",
  });

  assert.ok(lines.includes("failure_context category=blocked summary=first line\\nsecond line"));
});

test("buildDetailedStatusModel counts only unresolved configured bot threads in status fields", () => {
  const config = createConfig({
    reviewBotLogins: ["coderabbitai[bot]"],
  });
  const pr = createPullRequest({
    reviewDecision: "CHANGES_REQUESTED",
    headRefName: "codex/issue-38",
    copilotReviewState: "arrived",
    copilotReviewRequestedAt: "2026-03-11T14:05:00Z",
    copilotReviewArrivedAt: "2026-03-11T14:06:00Z",
    configuredBotTopLevelReviewStrength: "nitpick_only",
    configuredBotTopLevelReviewSubmittedAt: "2026-03-11T14:06:00Z",
  });
  const resolvedBotThread: ReviewThread = {
    id: "thread-1",
    isResolved: true,
    isOutdated: false,
    path: "src/file.ts",
    line: 12,
    comments: {
      nodes: [
        {
          id: "comment-1",
          body: "Resolved.",
          createdAt: "2026-03-11T00:00:00Z",
          url: "https://example.test/pr/44#discussion_r1",
          author: {
            login: "coderabbitai[bot]",
            typeName: "Bot",
          },
        },
      ],
    },
  };

  const lines = buildDetailedStatusModel({
    config,
    activeRecord: createRecord({
      pr_number: 44,
      state: "ready_to_merge",
      last_error: null,
      last_failure_context: null,
    }),
    latestRecord: null,
    trackedIssueCount: 1,
    pr,
    checks: [{ name: "build", state: "SUCCESS", bucket: "pass", workflow: "CI" }],
    reviewThreads: [resolvedBotThread],
    manualReviewThreads,
    configuredBotReviewThreads,
    pendingBotReviewThreads: () => [],
    summarizeChecks: () => ({ allPassing: true, hasPending: false, hasFailing: false }),
    mergeConflictDetected: (pr) => pr.mergeStateStatus === "DIRTY",
  });

  assert.ok(
    lines.includes(
      "configured_bot_top_level_review strength=nitpick_only submitted_at=2026-03-11T14:06:00Z effect=softened",
    ),
  );
  assert.ok(lines.includes("review_threads bot_pending=0 bot_unresolved=0 manual=0"));
});
