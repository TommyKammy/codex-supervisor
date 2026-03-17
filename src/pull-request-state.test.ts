import test from "node:test";
import assert from "node:assert/strict";
import { inferStateFromPullRequest } from "./pull-request-state";
import { GitHubPullRequest, IssueRunRecord, PullRequestCheck, ReviewThread, SupervisorConfig } from "./core/types";

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
    configuredBotRateLimitWaitMinutes: 0,
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
    last_head_sha: "head123",
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
    processed_review_thread_fingerprints: [],
    updated_at: "2026-03-11T01:50:41.997Z",
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

  assert.equal(
    inferStateFromPullRequest(config, record, createPullRequest({ isDraft: true }), [], []),
    "local_review_fix",
  );
});

test("inferStateFromPullRequest does not wait for Copilot when no lifecycle signal exists", () => {
  const config = createConfig({ copilotReviewWaitMinutes: 10 });
  const now = new Date().toISOString();
  const record = createRecord({
    state: "pr_open",
    review_wait_started_at: now,
    review_wait_head_sha: "head123",
  });
  const checks: PullRequestCheck[] = [{ name: "build", state: "SUCCESS", bucket: "pass", workflow: "CI" }];

  assert.equal(
    inferStateFromPullRequest(config, record, createPullRequest({ createdAt: now }), checks, []),
    "ready_to_merge",
  );
});

test("inferStateFromPullRequest does not report ready_to_merge when the tracked head is stale", () => {
  const config = createConfig();
  const record = createRecord({
    state: "pr_open",
    last_head_sha: "head-old",
  });
  const checks: PullRequestCheck[] = [{ name: "build", state: "SUCCESS", bucket: "pass", workflow: "CI" }];

  assert.equal(
    inferStateFromPullRequest(config, record, createPullRequest({ headRefOid: "head-new" }), checks, []),
    "stabilizing",
  );
});

test("inferStateFromPullRequest keeps review-required PRs out of ready_to_merge", () => {
  const config = createConfig();
  const record = createRecord({
    state: "pr_open",
    last_head_sha: "head123",
  });
  const checks: PullRequestCheck[] = [{ name: "build", state: "SUCCESS", bucket: "pass", workflow: "CI" }];

  assert.equal(
    inferStateFromPullRequest(config, record, createPullRequest({ reviewDecision: "REVIEW_REQUIRED" }), checks, []),
    "pr_open",
  );
});

test("inferStateFromPullRequest keeps pending checks from reaching ready_to_merge", () => {
  const config = createConfig();
  const record = createRecord({
    state: "pr_open",
    last_head_sha: "head123",
  });
  const checks: PullRequestCheck[] = [{ name: "build", state: "IN_PROGRESS", bucket: "pending", workflow: "CI" }];

  assert.equal(inferStateFromPullRequest(config, record, createPullRequest(), checks, []), "waiting_ci");
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
    const checks: PullRequestCheck[] = [{ name: "build", state: "SUCCESS", bucket: "pass", workflow: "CI" }];

    assert.equal(
      inferStateFromPullRequest(
        config,
        record,
        createPullRequest({
          createdAt: "2026-03-13T05:40:00Z",
          copilotReviewState: "not_requested",
          copilotReviewRequestedAt: null,
          copilotReviewArrivedAt: null,
        }),
        checks,
        [],
      ),
      "waiting_ci",
    );
  });
});

test("inferStateFromPullRequest does not time out immediately when configured review waiting is disabled", () => {
  const config = createConfig({
    copilotReviewWaitMinutes: 0,
    copilotReviewTimeoutAction: "block",
    reviewBotLogins: ["copilot-pull-request-reviewer"],
  });
  const record = createRecord({
    state: "waiting_ci",
    review_wait_started_at: "2026-03-11T00:00:00Z",
    review_wait_head_sha: "head123",
  });
  const checks: PullRequestCheck[] = [{ name: "build", state: "SUCCESS", bucket: "pass", workflow: "CI" }];

  assert.equal(
    inferStateFromPullRequest(
      config,
      record,
      createPullRequest({
        copilotReviewState: "requested",
        copilotReviewRequestedAt: "2026-03-11T00:05:00Z",
        copilotReviewArrivedAt: null,
      }),
      checks,
      [],
    ),
    "waiting_ci",
  );
});

test("inferStateFromPullRequest does not wait for review-threads-only providers without a requested signal", () => {
  withStubbedDateNow("2026-03-13T05:42:40Z", () => {
    const config = createConfig({
      copilotReviewWaitMinutes: 10,
      configuredReviewProviders: [
        {
          kind: "codex",
          reviewerLogins: ["chatgpt-codex-connector"],
          signalSource: "review_threads",
        },
      ],
    });
    const record = createRecord({
      state: "pr_open",
      review_wait_started_at: "2026-03-13T05:42:36Z",
      review_wait_head_sha: "head123",
    });
    const checks: PullRequestCheck[] = [{ name: "build", state: "SUCCESS", bucket: "pass", workflow: "CI" }];

    assert.equal(
      inferStateFromPullRequest(
        config,
        record,
        createPullRequest({
          createdAt: "2026-03-13T05:40:00Z",
          copilotReviewState: "not_requested",
          copilotReviewRequestedAt: null,
          copilotReviewArrivedAt: null,
        }),
        checks,
        [],
      ),
      "ready_to_merge",
    );
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
    const checks: PullRequestCheck[] = [{ name: "build", state: "SUCCESS", bucket: "pass", workflow: "CI" }];

    assert.equal(
      inferStateFromPullRequest(
        config,
        record,
        createPullRequest({
          createdAt: "2026-03-13T05:40:00Z",
          copilotReviewState: "not_requested",
          copilotReviewRequestedAt: null,
          copilotReviewArrivedAt: null,
        }),
        checks,
        [],
      ),
      "ready_to_merge",
    );
  });
});

test("inferStateFromPullRequest ignores observed request fallbacks for review-threads-only providers", () => {
  withStubbedDateNow("2026-03-11T00:10:00Z", () => {
    const config = createConfig({
      copilotReviewWaitMinutes: 10,
      configuredReviewProviders: [
        {
          kind: "codex",
          reviewerLogins: ["chatgpt-codex-connector"],
          signalSource: "review_threads",
        },
      ],
    });
    const record = createRecord({
      state: "waiting_ci",
      review_wait_started_at: "2026-03-11T00:00:00Z",
      review_wait_head_sha: "head123",
      copilot_review_requested_observed_at: "2026-03-11T00:05:00Z",
      copilot_review_requested_head_sha: "head123",
    });
    const checks: PullRequestCheck[] = [{ name: "build", state: "SUCCESS", bucket: "pass", workflow: "CI" }];

    assert.equal(
      inferStateFromPullRequest(
        config,
        record,
        createPullRequest({
          copilotReviewState: "not_requested",
          copilotReviewRequestedAt: null,
          copilotReviewArrivedAt: null,
        }),
        checks,
        [],
      ),
      "ready_to_merge",
    );
  });
});

test("inferStateFromPullRequest waits when mixed configured bots include Copilot lifecycle state", () => {
  withStubbedDateNow("2026-03-11T00:10:00Z", () => {
    const config = createConfig({
      copilotReviewWaitMinutes: 10,
      reviewBotLogins: ["chatgpt-codex-connector", "copilot-pull-request-reviewer"],
    });
    const requestedAt = "2026-03-11T00:05:00Z";
    const record = createRecord({
      state: "waiting_ci",
      review_wait_started_at: requestedAt,
      review_wait_head_sha: "head123",
    });
    const checks: PullRequestCheck[] = [{ name: "build", state: "SUCCESS", bucket: "pass", workflow: "CI" }];

    assert.equal(
      inferStateFromPullRequest(
        config,
        record,
        createPullRequest({
          copilotReviewState: "requested",
          copilotReviewRequestedAt: requestedAt,
          copilotReviewArrivedAt: null,
        }),
        checks,
        [],
      ),
      "waiting_ci",
    );
  });
});

test("inferStateFromPullRequest keeps waiting when Copilot review was explicitly requested", () => {
  withStubbedDateNow("2026-03-11T00:10:00Z", () => {
    const config = createConfig({
      copilotReviewWaitMinutes: 10,
      reviewBotLogins: ["copilot-pull-request-reviewer"],
    });
    const requestedAt = "2026-03-11T00:05:00Z";
    const record = createRecord({
      state: "waiting_ci",
      review_wait_started_at: requestedAt,
      review_wait_head_sha: "head123",
    });
    const checks: PullRequestCheck[] = [{ name: "build", state: "SUCCESS", bucket: "pass", workflow: "CI" }];

    assert.equal(
      inferStateFromPullRequest(
        config,
        record,
        createPullRequest({
          copilotReviewState: "requested",
          copilotReviewRequestedAt: requestedAt,
          copilotReviewArrivedAt: null,
        }),
        checks,
        [],
      ),
      "waiting_ci",
    );
  });
});

test("inferStateFromPullRequest treats an arrived configured-bot top-level review as satisfying the wait state", () => {
  withStubbedDateNow("2026-03-11T00:10:00Z", () => {
    const config = createConfig({
      copilotReviewWaitMinutes: 10,
      reviewBotLogins: ["coderabbitai[bot]"],
    });
    const requestedAt = "2026-03-11T00:05:00Z";
    const record = createRecord({
      state: "waiting_ci",
      review_wait_started_at: requestedAt,
      review_wait_head_sha: "head123",
    });
    const checks: PullRequestCheck[] = [{ name: "build", state: "SUCCESS", bucket: "pass", workflow: "CI" }];

    assert.equal(
      inferStateFromPullRequest(
        config,
        record,
        createPullRequest({
          copilotReviewState: "arrived",
          copilotReviewRequestedAt: requestedAt,
          copilotReviewArrivedAt: "2026-03-11T00:07:00Z",
        }),
        checks,
        [],
      ),
      "ready_to_merge",
    );
  });
});

test("inferStateFromPullRequest waits through a configured-bot rate limit warning for the configured window", () => {
  withStubbedDateNow("2026-03-11T00:20:00Z", () => {
    const config = createConfig({
      reviewBotLogins: ["coderabbitai", "coderabbitai[bot]"],
      configuredBotRateLimitWaitMinutes: 30,
    });
    const record = createRecord({ state: "waiting_ci" });
    const checks: PullRequestCheck[] = [{ name: "build", state: "SUCCESS", bucket: "pass", workflow: "CI" }];

    assert.equal(
      inferStateFromPullRequest(
        config,
        record,
        createPullRequest({
          copilotReviewState: "requested",
          copilotReviewRequestedAt: "2026-03-11T00:10:00Z",
          copilotReviewArrivedAt: null,
          configuredBotRateLimitedAt: "2026-03-11T00:15:00Z",
        }),
        checks,
        [],
      ),
      "waiting_ci",
    );
  });
});

test("inferStateFromPullRequest lets the rate-limit wait win over a blocking configured-bot timeout", () => {
  withStubbedDateNow("2026-03-11T00:20:00Z", () => {
    const config = createConfig({
      reviewBotLogins: ["coderabbitai", "coderabbitai[bot]"],
      configuredBotRateLimitWaitMinutes: 30,
      copilotReviewWaitMinutes: 10,
      copilotReviewTimeoutAction: "block",
    });
    const record = createRecord({
      state: "waiting_ci",
      copilot_review_requested_observed_at: "2026-03-11T00:00:00Z",
      copilot_review_requested_head_sha: "head123",
    });
    const checks: PullRequestCheck[] = [{ name: "build", state: "SUCCESS", bucket: "pass", workflow: "CI" }];

    assert.equal(
      inferStateFromPullRequest(
        config,
        record,
        createPullRequest({
          copilotReviewState: "requested",
          copilotReviewRequestedAt: "2026-03-11T00:00:00Z",
          copilotReviewArrivedAt: null,
          configuredBotRateLimitedAt: "2026-03-11T00:15:00Z",
        }),
        checks,
        [],
      ),
      "waiting_ci",
    );
  });
});

test("inferStateFromPullRequest allows merge again after a configured-bot rate limit wait expires", () => {
  withStubbedDateNow("2026-03-11T00:50:01Z", () => {
    const config = createConfig({
      reviewBotLogins: ["coderabbitai", "coderabbitai[bot]"],
      configuredBotRateLimitWaitMinutes: 30,
    });
    const record = createRecord({ state: "waiting_ci" });
    const checks: PullRequestCheck[] = [{ name: "build", state: "SUCCESS", bucket: "pass", workflow: "CI" }];

    assert.equal(
      inferStateFromPullRequest(
        config,
        record,
        createPullRequest({
          copilotReviewState: "requested",
          copilotReviewRequestedAt: "2026-03-11T00:10:00Z",
          copilotReviewArrivedAt: null,
          configuredBotRateLimitedAt: "2026-03-11T00:20:00Z",
        }),
        checks,
        [],
      ),
      "ready_to_merge",
    );
  });
});

test("inferStateFromPullRequest waits briefly after a recent CodeRabbit current-head observation", () => {
  withStubbedDateNow("2026-03-13T02:04:03Z", () => {
    const config = createConfig({
      reviewBotLogins: ["coderabbitai", "coderabbitai[bot]"],
    });
    const record = createRecord({ state: "waiting_ci" });
    const checks: PullRequestCheck[] = [{ name: "build", state: "SUCCESS", bucket: "pass", workflow: "CI" }];

    assert.equal(
      inferStateFromPullRequest(
        config,
        record,
        createPullRequest({
          copilotReviewState: "arrived",
          copilotReviewArrivedAt: "2026-03-13T02:04:00Z",
          configuredBotCurrentHeadObservedAt: "2026-03-13T02:04:00Z",
        }),
        checks,
        [],
      ),
      "waiting_ci",
    );
  });
});

test("inferStateFromPullRequest waits on a recent summary-only CodeRabbit current-head observation", () => {
  withStubbedDateNow("2026-03-13T02:04:03Z", () => {
    const config = createConfig({
      reviewBotLogins: ["coderabbitai", "coderabbitai[bot]"],
    });
    const record = createRecord({ state: "waiting_ci" });
    const checks: PullRequestCheck[] = [{ name: "build", state: "SUCCESS", bucket: "pass", workflow: "CI" }];

    assert.equal(
      inferStateFromPullRequest(
        config,
        record,
        createPullRequest({
          copilotReviewState: "not_requested",
          copilotReviewArrivedAt: null,
          configuredBotCurrentHeadObservedAt: "2026-03-13T02:04:00Z",
        }),
        checks,
        [],
      ),
      "waiting_ci",
    );
  });
});

test("inferStateFromPullRequest waits on later actionable CodeRabbit issue comments after a current-head observation", () => {
  withStubbedDateNow("2026-03-13T02:04:03Z", () => {
    const config = createConfig({
      reviewBotLogins: ["coderabbitai", "coderabbitai[bot]"],
    });
    const record = createRecord({ state: "waiting_ci" });
    const checks: PullRequestCheck[] = [{ name: "build", state: "SUCCESS", bucket: "pass", workflow: "CI" }];

    assert.equal(
      inferStateFromPullRequest(
        config,
        record,
        createPullRequest({
          copilotReviewState: "arrived",
          copilotReviewArrivedAt: "2026-03-13T02:02:00Z",
          configuredBotCurrentHeadObservedAt: "2026-03-13T02:04:00Z",
        }),
        checks,
        [],
      ),
      "waiting_ci",
    );
  });
});

test("inferStateFromPullRequest does not wait on stale CodeRabbit current-head observations", () => {
  withStubbedDateNow("2026-03-13T02:04:06Z", () => {
    const config = createConfig({
      reviewBotLogins: ["coderabbitai", "coderabbitai[bot]"],
    });
    const record = createRecord({ state: "waiting_ci" });
    const checks: PullRequestCheck[] = [{ name: "build", state: "SUCCESS", bucket: "pass", workflow: "CI" }];

    assert.equal(
      inferStateFromPullRequest(
        config,
        record,
        createPullRequest({
          copilotReviewState: "arrived",
          copilotReviewArrivedAt: "2026-03-13T02:04:00Z",
          configuredBotCurrentHeadObservedAt: "2026-03-13T02:04:00Z",
        }),
        checks,
        [],
      ),
      "ready_to_merge",
    );
  });
});

test("inferStateFromPullRequest uses configuredBotSettledWaitSeconds for recent CodeRabbit current-head observations", () => {
  withStubbedDateNow("2026-03-13T02:04:04Z", () => {
    const config = createConfig({
      reviewBotLogins: ["coderabbitai", "coderabbitai[bot]"],
    });
    (config as SupervisorConfig & { configuredBotSettledWaitSeconds?: number }).configuredBotSettledWaitSeconds = 3;
    const record = createRecord({ state: "waiting_ci" });
    const checks: PullRequestCheck[] = [{ name: "build", state: "SUCCESS", bucket: "pass", workflow: "CI" }];

    assert.equal(
      inferStateFromPullRequest(
        config,
        record,
        createPullRequest({
          copilotReviewState: "arrived",
          copilotReviewArrivedAt: "2026-03-13T02:04:00Z",
          configuredBotCurrentHeadObservedAt: "2026-03-13T02:04:00Z",
        }),
        checks,
        [],
      ),
      "ready_to_merge",
    );
  });
});

test("inferStateFromPullRequest softens nitpick-only configured-bot top-level changes requests when no configured-bot threads remain", () => {
  const config = createConfig({
    reviewBotLogins: ["coderabbitai[bot]"],
    humanReviewBlocksMerge: true,
  });
  const record = createRecord({ state: "pr_open" });
  const pr = createPullRequest({
    reviewDecision: "CHANGES_REQUESTED",
    copilotReviewState: "arrived",
    copilotReviewRequestedAt: "2026-03-11T00:05:00Z",
    copilotReviewArrivedAt: "2026-03-11T00:07:00Z",
    configuredBotTopLevelReviewStrength: "nitpick_only",
  });
  const checks: PullRequestCheck[] = [{ name: "build", state: "SUCCESS", bucket: "pass", workflow: "CI" }];

  assert.equal(inferStateFromPullRequest(config, record, pr, checks, []), "ready_to_merge");
});

test("inferStateFromPullRequest still blocks stronger configured-bot top-level changes requests without review threads", () => {
  const config = createConfig({
    reviewBotLogins: ["coderabbitai[bot]"],
    humanReviewBlocksMerge: false,
  });
  const record = createRecord({ state: "pr_open" });
  const pr = createPullRequest({
    reviewDecision: "CHANGES_REQUESTED",
    copilotReviewState: "arrived",
    copilotReviewRequestedAt: "2026-03-11T00:05:00Z",
    copilotReviewArrivedAt: "2026-03-11T00:07:00Z",
    configuredBotTopLevelReviewStrength: "blocking",
    configuredBotTopLevelReviewSubmittedAt: "2026-03-11T00:07:00Z",
  });
  const checks: PullRequestCheck[] = [{ name: "build", state: "SUCCESS", bucket: "pass", workflow: "CI" }];

  assert.equal(inferStateFromPullRequest(config, record, pr, checks, []), "blocked");
});

test("inferStateFromPullRequest does not start Copilot timeout from the generic review wait window", () => {
  withStubbedDateNow("2026-03-11T00:30:00Z", () => {
    const config = createConfig({
      copilotReviewWaitMinutes: 10,
      copilotReviewTimeoutAction: "block",
      reviewBotLogins: ["copilot-pull-request-reviewer"],
    });
    const record = createRecord({
      state: "waiting_ci",
      review_wait_started_at: "2026-03-11T00:00:00Z",
      review_wait_head_sha: "head123",
    });
    const checks: PullRequestCheck[] = [{ name: "build", state: "SUCCESS", bucket: "pass", workflow: "CI" }];

    assert.equal(
      inferStateFromPullRequest(
        config,
        record,
        createPullRequest({
          copilotReviewState: "requested",
          copilotReviewRequestedAt: null,
          copilotReviewArrivedAt: null,
        }),
        checks,
        [],
      ),
      "waiting_ci",
    );
  });
});

test("inferStateFromPullRequest can time out from the observed Copilot request timestamp when GitHub omits one", () => {
  withStubbedDateNow("2026-03-11T00:30:00Z", () => {
    const config = createConfig({
      copilotReviewWaitMinutes: 10,
      copilotReviewTimeoutAction: "block",
      reviewBotLogins: ["copilot-pull-request-reviewer"],
    });
    const record = createRecord({
      state: "waiting_ci",
      review_wait_started_at: "2026-03-11T00:00:00Z",
      review_wait_head_sha: "head123",
      copilot_review_requested_observed_at: "2026-03-11T00:15:00Z",
      copilot_review_requested_head_sha: "head123",
    });
    const checks: PullRequestCheck[] = [{ name: "build", state: "SUCCESS", bucket: "pass", workflow: "CI" }];

    assert.equal(
      inferStateFromPullRequest(
        config,
        record,
        createPullRequest({
          copilotReviewState: "requested",
          copilotReviewRequestedAt: null,
          copilotReviewArrivedAt: null,
        }),
        checks,
        [],
      ),
      "blocked",
    );
  });
});

test("inferStateFromPullRequest does not time out review-threads-only providers from observed request fallback timestamps", () => {
  withStubbedDateNow("2026-03-11T00:30:00Z", () => {
    const config = createConfig({
      copilotReviewWaitMinutes: 10,
      copilotReviewTimeoutAction: "block",
      configuredReviewProviders: [
        {
          kind: "codex",
          reviewerLogins: ["chatgpt-codex-connector"],
          signalSource: "review_threads",
        },
      ],
    });
    const record = createRecord({
      state: "waiting_ci",
      review_wait_started_at: "2026-03-11T00:00:00Z",
      review_wait_head_sha: "head123",
      copilot_review_requested_observed_at: "2026-03-11T00:15:00Z",
      copilot_review_requested_head_sha: "head123",
    });
    const checks: PullRequestCheck[] = [{ name: "build", state: "SUCCESS", bucket: "pass", workflow: "CI" }];

    assert.equal(
      inferStateFromPullRequest(
        config,
        record,
        createPullRequest({
          copilotReviewState: "requested",
          copilotReviewRequestedAt: null,
          copilotReviewArrivedAt: null,
        }),
        checks,
        [],
      ),
      "waiting_ci",
    );
  });
});

test("inferStateFromPullRequest does not wait on stale configured bot request state when no review bots are configured", () => {
  withStubbedDateNow("2026-03-11T00:30:00Z", () => {
    const config = createConfig({
      copilotReviewWaitMinutes: 10,
      copilotReviewTimeoutAction: "block",
      reviewBotLogins: [],
    });
    const record = createRecord({
      state: "waiting_ci",
      review_wait_started_at: "2026-03-11T00:00:00Z",
      review_wait_head_sha: "head123",
      copilot_review_requested_observed_at: "2026-03-11T00:05:00Z",
      copilot_review_requested_head_sha: "head123",
    });
    const checks: PullRequestCheck[] = [{ name: "build", state: "SUCCESS", bucket: "pass", workflow: "CI" }];

    assert.equal(
      inferStateFromPullRequest(
        config,
        record,
        createPullRequest({
          copilotReviewState: "not_requested",
          copilotReviewRequestedAt: null,
          copilotReviewArrivedAt: null,
        }),
        checks,
        [],
      ),
      "ready_to_merge",
    );
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
    const checks: PullRequestCheck[] = [{ name: "build", state: "SUCCESS", bucket: "pass", workflow: "CI" }];

    assert.equal(
      inferStateFromPullRequest(
        config,
        record,
        createPullRequest({
          copilotReviewState: "requested",
          copilotReviewRequestedAt: "2026-03-11T00:05:00Z",
          copilotReviewArrivedAt: null,
        }),
        checks,
        [],
      ),
      "ready_to_merge",
    );
  });
});

test("inferStateFromPullRequest can block when a requested Copilot review times out", () => {
  withStubbedDateNow("2026-03-11T00:30:00Z", () => {
    const config = createConfig({
      copilotReviewWaitMinutes: 10,
      copilotReviewTimeoutAction: "block",
      reviewBotLogins: ["copilot-pull-request-reviewer"],
    });
    const record = createRecord({
      state: "waiting_ci",
      review_wait_started_at: "2026-03-11T00:00:00Z",
      review_wait_head_sha: "head123",
    });
    const checks: PullRequestCheck[] = [{ name: "build", state: "SUCCESS", bucket: "pass", workflow: "CI" }];

    assert.equal(
      inferStateFromPullRequest(
        config,
        record,
        createPullRequest({
          copilotReviewState: "requested",
          copilotReviewRequestedAt: "2026-03-11T00:05:00Z",
          copilotReviewArrivedAt: null,
        }),
        checks,
        [],
      ),
      "blocked",
    );
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
        last_head_sha: "newhead",
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
    const pr = createPullRequest({
      createdAt: "2026-03-01T00:00:00Z",
      ...testCase.pr,
    });

    assert.equal(inferStateFromPullRequest(config, record, pr, [], []), testCase.expected, testCase.name);
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

  assert.equal(
    inferStateFromPullRequest(config, record, createPullRequest({ isDraft: true }), [], []),
    "blocked",
  );
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
  const checks: PullRequestCheck[] = [{ name: "test", state: "FAILURE", bucket: "fail", workflow: "CI" }];

  assert.equal(
    inferStateFromPullRequest(config, record, createPullRequest({ isDraft: true }), checks, []),
    "local_review_fix",
  );
});

test("inferStateFromPullRequest keeps an unresolved configured bot thread blocked on the same head after processing", () => {
  const config = createConfig({
    reviewBotLogins: ["copilot-pull-request-reviewer"],
  });
  const record = createRecord({
    state: "pr_open",
    last_head_sha: "head-a",
    processed_review_thread_ids: ["thread-1@head-a"],
    processed_review_thread_fingerprints: ["thread-1@head-a#comment-1"],
  });
  const pr = createPullRequest({
    reviewDecision: "CHANGES_REQUESTED",
    headRefOid: "head-a",
  });

  assert.equal(inferStateFromPullRequest(config, record, pr, [], [createReviewThread()]), "blocked");
});

test("inferStateFromPullRequest treats a legacy plain thread id as processed only on the matching head", () => {
  const config = createConfig({
    reviewBotLogins: ["copilot-pull-request-reviewer"],
  });
  const record = createRecord({
    state: "pr_open",
    last_head_sha: "head-a",
    processed_review_thread_ids: ["thread-1"],
  });
  const sameHeadPr = createPullRequest({
    reviewDecision: "CHANGES_REQUESTED",
    headRefOid: "head-a",
  });
  const changedHeadPr = createPullRequest({
    reviewDecision: "CHANGES_REQUESTED",
    headRefOid: "head-b",
  });

  assert.equal(inferStateFromPullRequest(config, record, sameHeadPr, [], [createReviewThread()]), "blocked");
  assert.equal(
    inferStateFromPullRequest(config, record, changedHeadPr, [], [createReviewThread()]),
    "addressing_review",
  );
});

test("inferStateFromPullRequest allows one reprocessing pass for a configured bot thread after the PR head changes", () => {
  const config = createConfig({
    reviewBotLogins: ["copilot-pull-request-reviewer"],
  });
  const record = createRecord({
    state: "pr_open",
    last_head_sha: "head-a",
    processed_review_thread_ids: ["thread-1@head-a"],
    processed_review_thread_fingerprints: ["thread-1@head-a#comment-1"],
  });
  const pr = createPullRequest({
    reviewDecision: "CHANGES_REQUESTED",
    headRefOid: "head-b",
  });

  assert.equal(
    inferStateFromPullRequest(config, record, pr, [], [createReviewThread()]),
    "addressing_review",
  );
});

test("inferStateFromPullRequest allows one reprocessing pass for a configured bot thread when its latest comment changes on the same head", () => {
  const config = createConfig({
    reviewBotLogins: ["copilot-pull-request-reviewer"],
  });
  const record = createRecord({
    state: "pr_open",
    last_head_sha: "head-a",
    processed_review_thread_ids: ["thread-1@head-a"],
    processed_review_thread_fingerprints: ["thread-1@head-a#comment-1"],
  });
  const pr = createPullRequest({
    reviewDecision: "CHANGES_REQUESTED",
    headRefOid: "head-a",
  });
  const updatedThread = createReviewThread({
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
        {
          id: "comment-2",
          body: "One more note on the same thread.",
          createdAt: "2026-03-11T00:05:00Z",
          url: "https://example.test/pr/44#discussion_r2",
          author: {
            login: "copilot-pull-request-reviewer",
            typeName: "Bot",
          },
        },
      ],
    },
  });

  assert.equal(inferStateFromPullRequest(config, record, pr, [], [updatedThread]), "addressing_review");
});

test("inferStateFromPullRequest blocks a same-head configured bot thread again after its updated comment has already been reprocessed once", () => {
  const config = createConfig({
    reviewBotLogins: ["copilot-pull-request-reviewer"],
  });
  const record = createRecord({
    state: "pr_open",
    last_head_sha: "head-a",
    processed_review_thread_ids: ["thread-1@head-a"],
    processed_review_thread_fingerprints: ["thread-1@head-a#comment-2"],
  });
  const pr = createPullRequest({
    reviewDecision: "CHANGES_REQUESTED",
    headRefOid: "head-a",
  });
  const updatedThread = createReviewThread({
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
        {
          id: "comment-2",
          body: "One more note on the same thread.",
          createdAt: "2026-03-11T00:05:00Z",
          url: "https://example.test/pr/44#discussion_r2",
          author: {
            login: "copilot-pull-request-reviewer",
            typeName: "Bot",
          },
        },
      ],
    },
  });

  assert.equal(inferStateFromPullRequest(config, record, pr, [], [updatedThread]), "blocked");
});

test("inferStateFromPullRequest blocks a repeatedly unresolved configured bot thread again after its one pass on the new head", () => {
  const config = createConfig({
    reviewBotLogins: ["copilot-pull-request-reviewer"],
  });
  const record = createRecord({
    state: "pr_open",
    last_head_sha: "head-b",
    processed_review_thread_ids: ["thread-1@head-a", "thread-1@head-b"],
    processed_review_thread_fingerprints: ["thread-1@head-b#comment-1"],
  });
  const pr = createPullRequest({
    reviewDecision: "CHANGES_REQUESTED",
    headRefOid: "head-b",
  });

  assert.equal(inferStateFromPullRequest(config, record, pr, [], [createReviewThread()]), "blocked");
});
