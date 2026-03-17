import test from "node:test";
import assert from "node:assert/strict";
import {
  configuredBotSettledWaitWindow,
  configuredBotRateLimitWaitWindow,
  configuredBotTopLevelReviewEffect,
  configuredReviewStatusLabel,
  inferReviewBotProfile,
  reviewBotDiagnostics,
} from "./supervisor-status-review-bot";
import { GitHubPullRequest, IssueRunRecord, ReviewThread, SupervisorConfig } from "../core/types";

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
    issue_number: 340,
    state: "reproducing",
    branch: "codex/issue-340",
    pr_number: 340,
    workspace: "/tmp/workspaces/issue-340",
    journal_path: "/tmp/workspaces/issue-340/.codex-supervisor/issue-journal.md",
    review_wait_started_at: null,
    review_wait_head_sha: null,
    copilot_review_requested_observed_at: null,
    copilot_review_requested_head_sha: null,
    copilot_review_timed_out_at: null,
    copilot_review_timeout_action: null,
    copilot_review_timeout_reason: null,
    codex_session_id: "session-340",
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
    implementation_attempt_count: 0,
    repair_attempt_count: 0,
    timeout_retry_count: 0,
    blocked_verification_retry_count: 0,
    repeated_blocker_count: 0,
    repeated_failure_signature_count: 0,
    last_head_sha: "head-sha",
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
    updated_at: "2026-03-16T00:00:00Z",
    ...overrides,
  };
}

function createPr(overrides: Partial<GitHubPullRequest> = {}): GitHubPullRequest {
  return {
    number: 340,
    title: "Refactor status helpers",
    url: "https://example.test/pr/340",
    state: "OPEN",
    createdAt: "2026-03-16T00:00:00Z",
    isDraft: false,
    reviewDecision: null,
    mergeStateStatus: "CLEAN",
    mergeable: "MERGEABLE",
    headRefName: "codex/issue-340",
    headRefOid: "head-sha",
    ...overrides,
  };
}

function createThread(overrides: Partial<ReviewThread> = {}): ReviewThread {
  return {
    id: "thread-1",
    isResolved: false,
    isOutdated: false,
    path: "src/file.ts",
    line: 1,
    comments: { nodes: [] },
    ...overrides,
  };
}

const configuredBotReviewThreads = (_config: SupervisorConfig, reviewThreads: ReviewThread[]): ReviewThread[] =>
  reviewThreads;

test("inferReviewBotProfile identifies configured provider patterns", () => {
  assert.deepEqual(inferReviewBotProfile(createConfig()), {
    profile: "none",
    provider: "none",
    reviewers: [],
    signalSource: "none",
  });

  assert.deepEqual(inferReviewBotProfile(createConfig({ reviewBotLogins: ["copilot-pull-request-reviewer"] })), {
    profile: "copilot",
    provider: "copilot-pull-request-reviewer",
    reviewers: ["copilot-pull-request-reviewer"],
    signalSource: "copilot_lifecycle",
  });

  assert.deepEqual(
    inferReviewBotProfile(createConfig({ reviewBotLogins: ["CodeRabbitAI", "coderabbitai[bot]"] })),
    {
      profile: "coderabbit",
      provider: "coderabbitai",
      reviewers: ["coderabbitai", "coderabbitai[bot]"],
      signalSource: "review_threads",
    },
  );
});

test("reviewBotDiagnostics tracks observed review signal precedence", () => {
  const config = createConfig({ reviewBotLogins: ["chatgpt-codex-connector"] });
  const pr = createPr();

  assert.deepEqual(
    reviewBotDiagnostics(config, createRecord(), pr, [createThread()], configuredBotReviewThreads),
    {
      status: "review_signal_observed",
      observedReview: "review_thread",
      nextCheck: "none",
    },
  );

  assert.deepEqual(
    reviewBotDiagnostics(
      config,
      createRecord({ external_review_head_sha: pr.headRefOid }),
      pr,
      [],
      configuredBotReviewThreads,
    ),
    {
      status: "review_signal_observed",
      observedReview: "external_review_record",
      nextCheck: "none",
    },
  );

  assert.deepEqual(
    reviewBotDiagnostics(
      createConfig({ reviewBotLogins: ["copilot-pull-request-reviewer"] }),
      createRecord(),
      createPr({ copilotReviewState: "requested" }),
      [],
      configuredBotReviewThreads,
    ),
    {
      status: "waiting_for_provider_review",
      observedReview: "copilot_requested",
      nextCheck: "provider_delivery",
    },
  );

  assert.deepEqual(reviewBotDiagnostics(config, createRecord(), pr, [], configuredBotReviewThreads), {
    status: "missing_provider_signal",
    observedReview: "none",
    nextCheck: "provider_setup_or_delivery",
  });
});

test("configured review helpers preserve top-level status semantics", () => {
  const config = createConfig({ reviewBotLogins: ["copilot-pull-request-reviewer"] });
  assert.equal(configuredReviewStatusLabel(config), "copilot_review");
  assert.equal(configuredReviewStatusLabel(createConfig({ reviewBotLogins: ["coderabbitai[bot]"] })), "configured_bot_review");

  assert.equal(
    configuredBotTopLevelReviewEffect(
      createConfig({ reviewBotLogins: ["coderabbitai[bot]"] }),
      createPr({ configuredBotTopLevelReviewStrength: "nitpick_only" }),
      [],
      configuredBotReviewThreads,
    ),
    "softened",
  );
  assert.equal(
    configuredBotTopLevelReviewEffect(
      createConfig({ reviewBotLogins: ["coderabbitai[bot]"] }),
      createPr({ configuredBotTopLevelReviewStrength: "nitpick_only" }),
      [createThread()],
      configuredBotReviewThreads,
    ),
    "awaiting_thread_resolution",
  );
});

test("configuredBotRateLimitWaitWindow reports active and expired windows", () => {
  const originalNow = Date.now;
  Date.now = () => Date.parse("2026-03-16T00:05:00.000Z");

  try {
    assert.deepEqual(
      configuredBotRateLimitWaitWindow(
        createConfig({ configuredBotRateLimitWaitMinutes: 10 }),
        createPr({ configuredBotRateLimitedAt: "2026-03-16T00:00:00.000Z" }),
      ),
      {
        status: "active",
        observedAt: "2026-03-16T00:00:00.000Z",
        waitUntil: "2026-03-16T00:10:00.000Z",
      },
    );

    assert.deepEqual(
      configuredBotRateLimitWaitWindow(
        createConfig({ configuredBotRateLimitWaitMinutes: 3 }),
        createPr({ configuredBotRateLimitedAt: "2026-03-16T00:00:00.000Z" }),
      ),
      {
        status: "expired",
        observedAt: "2026-03-16T00:00:00.000Z",
        waitUntil: "2026-03-16T00:03:00.000Z",
      },
    );
  } finally {
    Date.now = originalNow;
  }
});

test("configuredBotSettledWaitWindow reports the active CodeRabbit quiet period", () => {
  const originalNow = Date.now;
  Date.now = () => Date.parse("2026-03-16T00:00:03.000Z");

  try {
    assert.deepEqual(
      configuredBotSettledWaitWindow(
        createConfig({ reviewBotLogins: ["coderabbitai", "coderabbitai[bot]"] }),
        createPr({ configuredBotCurrentHeadObservedAt: "2026-03-16T00:00:00.000Z" }),
      ),
      {
        status: "active",
        provider: "coderabbit",
        observedAt: "2026-03-16T00:00:00.000Z",
        waitUntil: "2026-03-16T00:00:05.000Z",
      },
    );

    assert.deepEqual(
      configuredBotSettledWaitWindow(
        createConfig({ reviewBotLogins: ["chatgpt-codex-connector"] }),
        createPr({ configuredBotCurrentHeadObservedAt: "2026-03-16T00:00:00.000Z" }),
      ),
      {
        status: "inactive",
        provider: "none",
        observedAt: "2026-03-16T00:00:00.000Z",
        waitUntil: null,
      },
    );
  } finally {
    Date.now = originalNow;
  }
});

test("configuredBotSettledWaitWindow uses configuredBotSettledWaitSeconds when provided", () => {
  const originalNow = Date.now;
  Date.now = () => Date.parse("2026-03-16T00:00:03.500Z");

  try {
    assert.deepEqual(
      configuredBotSettledWaitWindow(
        createConfig({
          reviewBotLogins: ["coderabbitai", "coderabbitai[bot]"],
          configuredBotSettledWaitSeconds: 3,
        }),
        createPr({ configuredBotCurrentHeadObservedAt: "2026-03-16T00:00:00.000Z" }),
      ),
      {
        status: "expired",
        provider: "coderabbit",
        observedAt: "2026-03-16T00:00:00.000Z",
        waitUntil: "2026-03-16T00:00:03.000Z",
      },
    );
  } finally {
    Date.now = originalNow;
  }
});
