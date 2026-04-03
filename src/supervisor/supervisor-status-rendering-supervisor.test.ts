import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { formatDetailedStatus, summarizeChecks } from "./supervisor-status-rendering";
import { GitHubPullRequest, IssueRunRecord, PullRequestCheck, SupervisorConfig } from "../core/types";

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
    review_follow_up_head_sha: null,
    review_follow_up_remaining: 0,
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
    headRefOid: "deadbeef",
    mergedAt: null,
    ...overrides,
  };
}

function withStubbedDateNow<T>(nowIso: string, run: () => T): T {
  const realDateNow = Date.now;
  Date.now = () => Date.parse(nowIso);
  try {
    return run();
  } finally {
    Date.now = realDateNow;
  }
}

test("summarizeChecks treats cancelled runs as waiting, not failing", () => {
  const summary = summarizeChecks([{ name: "merge-queue", state: "CANCELLED", bucket: "cancel", workflow: "CI" }]);

  assert.equal(summary.allPassing, false);
  assert.equal(summary.hasPending, true);
  assert.equal(summary.hasFailing, false);
});

test("formatDetailedStatus shows blocking local review status for current PR head", () => {
  const config = createConfig({ localReviewEnabled: true, localReviewPolicy: "block_ready" });
  const record = createRecord({
    local_review_head_sha: "deadbeef",
    local_review_blocker_summary: "high src/supervisor.ts:210-214 stale artifact context drives the wrong repair path.",
    local_review_max_severity: "high",
    local_review_findings_count: 3,
    local_review_recommendation: "changes_requested",
    local_review_run_at: "2026-03-11T14:05:00Z",
  });

  const status = formatDetailedStatus({
    config,
    activeRecord: record,
    latestRecord: record,
    trackedIssueCount: 1,
    pr: createPullRequest({ isDraft: true }),
    checks: [],
    reviewThreads: [],
  });

  assert.match(
    status,
    /local_review gating=yes policy=block_ready findings=3 root_causes=0 max_severity=high verified_findings=0 verified_max_severity=none head=current reviewed_head_sha=deadbeef pr_head_sha=deadbeef ran_at=2026-03-11T14:05:00Z blocker_summary=high src\/supervisor\.ts:210-214 stale artifact context drives the wrong repair path\. signature=none repeated=0 stalled=no/,
  );
  assert.doesNotMatch(status, /needs_review_run=/);
  assert.match(status, /external_review head=none reviewed_head_sha=none matched=0 near_match=0 missed=0/);
});

test("formatDetailedStatus shows both raw and compressed local review counts", () => {
  const config = createConfig({ localReviewPolicy: "block_ready" });
  const record = createRecord({
    local_review_head_sha: "deadbeef",
    local_review_max_severity: "high",
    local_review_findings_count: 3,
    local_review_root_cause_count: 1,
    local_review_recommendation: "changes_requested",
    local_review_run_at: "2026-03-11T14:05:00Z",
  });

  const status = formatDetailedStatus({
    config,
    activeRecord: record,
    latestRecord: record,
    trackedIssueCount: 1,
    pr: createPullRequest({ isDraft: true }),
    checks: [],
    reviewThreads: [],
  });

  assert.match(status, /local_review .*findings=3 .*root_causes=1 .*stalled=no/);
});

test("formatDetailedStatus shows configured-bot same-head follow-up eligibility and exhaustion", () => {
  const config = createConfig({ reviewBotLogins: ["copilot-pull-request-reviewer"] });
  const pr = createPullRequest({
    reviewDecision: "CHANGES_REQUESTED",
    headRefOid: "deadbeef",
  });
  const reviewThreads = [
    {
      id: "thread-1",
      isResolved: false,
      isOutdated: false,
      path: "src/file.ts",
      line: 1,
      comments: {
        nodes: [{
          id: "comment-1",
          body: "Still unresolved.",
          createdAt: "2026-03-11T14:05:00Z",
          url: "https://example.test/pr/42#discussion_r1",
          author: { login: "copilot-pull-request-reviewer", typeName: "Bot" },
        }],
      },
    },
  ];

  const eligibleStatus = formatDetailedStatus({
    config,
    activeRecord: createRecord({
      state: "addressing_review",
      pr_number: pr.number,
      review_follow_up_head_sha: "deadbeef",
      review_follow_up_remaining: 1,
      processed_review_thread_ids: ["thread-1@deadbeef"],
      processed_review_thread_fingerprints: ["thread-1@deadbeef#comment-1"],
    }),
    latestRecord: null,
    trackedIssueCount: 1,
    pr,
    checks: [],
    reviewThreads,
  });
  assert.match(eligibleStatus, /review_follow_up state=eligible remaining=1 head_sha=deadbeef actionable=1/);

  const exhaustedStatus = formatDetailedStatus({
    config,
    activeRecord: createRecord({
      state: "blocked",
      blocked_reason: "manual_review",
      pr_number: pr.number,
      review_follow_up_head_sha: "deadbeef",
      review_follow_up_remaining: 0,
      processed_review_thread_ids: ["thread-1@deadbeef"],
      processed_review_thread_fingerprints: ["thread-1@deadbeef#comment-1"],
    }),
    latestRecord: null,
    trackedIssueCount: 1,
    pr,
    checks: [],
    reviewThreads,
  });
  assert.match(exhaustedStatus, /review_follow_up state=exhausted remaining=0 head_sha=deadbeef actionable=0/);
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

  const status = formatDetailedStatus({
    config,
    activeRecord: record,
    latestRecord: record,
    trackedIssueCount: 1,
    pr: createPullRequest({ isDraft: true }),
    checks: [],
    reviewThreads: [],
  });

  assert.match(status, /local_review .* repeated=3 stalled=yes/);
  assert.match(status, /blocked_reason=verification/);
});

test("formatDetailedStatus shows saved external review miss counts for the current PR head", () => {
  const config = createConfig();
  const pr = createPullRequest({
    number: 22,
    title: "Add review learning",
    headRefName: "codex/issue-58",
  });

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
    pr: createPullRequest({ number: 22, title: "Add review learning", headRefName: "codex/issue-58" }),
    checks: [],
    reviewThreads: [],
  });

  assert.match(status, /copilot_review state=not_requested/);
});

test("formatDetailedStatus surfaces fresh PR hydration provenance", () => {
  const config = createConfig({ copilotReviewWaitMinutes: 10 });
  const status = formatDetailedStatus({
    config,
    activeRecord: createRecord({
      pr_number: 22,
      state: "pr_open",
    }),
    latestRecord: null,
    trackedIssueCount: 1,
    pr: createPullRequest({
      number: 22,
      title: "Add review learning",
      headRefName: "codex/issue-58",
      hydrationProvenance: "fresh",
    }),
    checks: [],
    reviewThreads: [],
  });

  assert.match(status, /pr_hydration provenance=fresh head_sha=deadbeef/);
});

test("formatDetailedStatus surfaces cached PR hydration provenance", () => {
  const config = createConfig({ copilotReviewWaitMinutes: 10 });
  const status = formatDetailedStatus({
    config,
    activeRecord: createRecord({
      pr_number: 22,
      state: "pr_open",
    }),
    latestRecord: null,
    trackedIssueCount: 1,
    pr: createPullRequest({
      number: 22,
      title: "Add review learning",
      headRefName: "codex/issue-58",
      hydrationProvenance: "cached",
    }),
    checks: [],
    reviewThreads: [],
  });

  assert.match(status, /pr_hydration provenance=cached head_sha=deadbeef/);
});

test("formatDetailedStatus surfaces unknown Copilot review lifecycle when hydration fails", () => {
  const config = createConfig({ copilotReviewWaitMinutes: 10 });
  const status = formatDetailedStatus({
    config,
    activeRecord: createRecord({
      pr_number: 22,
      state: "pr_open",
    }),
    latestRecord: null,
    trackedIssueCount: 1,
    pr: createPullRequest({
      number: 22,
      title: "Add review learning",
      headRefName: "codex/issue-58",
      copilotReviewState: null,
      copilotReviewRequestedAt: null,
      copilotReviewArrivedAt: null,
    }),
    checks: [],
    reviewThreads: [],
  });

  assert.match(status, /copilot_review state=unknown requested_at=none arrived_at=none/);
});

test("formatDetailedStatus surfaces Copilot review timeout outcome", () => {
  const config = createConfig({ copilotReviewWaitMinutes: 10, copilotReviewTimeoutAction: "continue" });
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
    pr: createPullRequest({
      number: 22,
      title: "Add review learning",
      headRefName: "codex/issue-58",
      copilotReviewState: "requested",
      copilotReviewRequestedAt: "2026-03-11T14:05:00Z",
      copilotReviewArrivedAt: null,
    }),
    checks: [],
    reviewThreads: [],
  });

  assert.match(status, /copilot_review state=requested requested_at=2026-03-11T14:05:00Z arrived_at=none timed_out_at=2026-03-11T14:15:00Z timeout_action=continue/);
  assert.match(status, /timeout_reason=Requested Copilot review never arrived within 10 minute\(s\) for head deadbeef\./);
});

test("formatDetailedStatus surfaces configured bot review timeout outcome with generic wording", () => {
  const config = createConfig({
    reviewBotLogins: ["chatgpt-codex-connector"],
  });
  const pr = createPullRequest({
    number: 44,
    headRefName: "codex/issue-38",
    copilotReviewState: "requested",
    copilotReviewRequestedAt: "2026-03-11T14:05:00Z",
    copilotReviewArrivedAt: null,
  });
  const status = formatDetailedStatus({
    config,
    activeRecord: createRecord({
      pr_number: 44,
      state: "blocked",
      blocked_reason: "review_bot_timeout",
      copilot_review_timed_out_at: "2026-03-11T14:15:00Z",
      copilot_review_timeout_action: "continue",
      copilot_review_timeout_reason:
        "Requested configured review bot (chatgpt-codex-connector) review never arrived within 10 minute(s) for head deadbeef.",
    }),
    latestRecord: null,
    trackedIssueCount: 1,
    pr,
    checks: [{ name: "build", state: "SUCCESS", bucket: "pass", workflow: "CI" }],
    reviewThreads: [],
  });

  assert.match(
    status,
    /configured_bot_review state=requested reviewers=chatgpt-codex-connector requested_at=2026-03-11T14:05:00Z arrived_at=none timed_out_at=2026-03-11T14:15:00Z timeout_action=continue/,
  );
  assert.match(
    status,
    /timeout_reason=Requested configured review bot \(chatgpt-codex-connector\) review never arrived within 10 minute\(s\) for head deadbeef\./,
  );
});

test("formatDetailedStatus explains softened nitpick-only configured-bot top-level reviews", () => {
  const config = createConfig({
    reviewBotLogins: ["coderabbitai[bot]"],
  });
  const status = formatDetailedStatus({
    config,
    activeRecord: createRecord({
      pr_number: 44,
      state: "ready_to_merge",
    }),
    latestRecord: null,
    trackedIssueCount: 1,
    pr: createPullRequest({
      number: 44,
      headRefName: "codex/issue-38",
      reviewDecision: "CHANGES_REQUESTED",
      copilotReviewState: "arrived",
      copilotReviewRequestedAt: "2026-03-11T14:05:00Z",
      copilotReviewArrivedAt: "2026-03-11T14:06:00Z",
      configuredBotTopLevelReviewStrength: "nitpick_only",
      configuredBotTopLevelReviewSubmittedAt: "2026-03-11T14:06:00Z",
    }),
    checks: [{ name: "build", state: "SUCCESS", bucket: "pass", workflow: "CI" }],
    reviewThreads: [],
  });

  assert.match(
    status,
    /configured_bot_top_level_review strength=nitpick_only submitted_at=2026-03-11T14:06:00Z effect=softened/,
  );
});

test("formatDetailedStatus surfaces active review-bot profile and missing external signal for Codex profile", () => {
  const config = createConfig({
    reviewBotLogins: ["chatgpt-codex-connector"],
  });
  const status = formatDetailedStatus({
    config,
    activeRecord: createRecord({
      pr_number: 44,
      state: "pr_open",
      blocked_reason: null,
      copilot_review_timed_out_at: null,
      copilot_review_timeout_action: null,
      copilot_review_timeout_reason: null,
    }),
    latestRecord: null,
    trackedIssueCount: 1,
    pr: createPullRequest({
      number: 44,
      headRefName: "codex/issue-38",
      reviewDecision: "REVIEW_REQUIRED",
      copilotReviewState: "not_requested",
      copilotReviewRequestedAt: null,
      copilotReviewArrivedAt: null,
    }),
    checks: [{ name: "build", state: "SUCCESS", bucket: "pass", workflow: "CI" }],
    reviewThreads: [],
  });

  assert.match(
    status,
    /review_bot_profile profile=codex provider=chatgpt-codex-connector reviewers=chatgpt-codex-connector signal_source=review_threads/,
  );
  assert.match(
    status,
    /review_bot_diagnostics status=missing_provider_signal observed_review=none expected_reviewers=chatgpt-codex-connector next_check=provider_setup_or_delivery/,
  );
});

test("formatDetailedStatus marks bootstrap repos without workflows as not ready for expected external signals", async (t) => {
  const repoPath = await fs.mkdtemp(path.join(os.tmpdir(), "codex-supervisor-status-bootstrap-"));
  t.after(async () => {
    await fs.rm(repoPath, { recursive: true, force: true });
  });

  const status = formatDetailedStatus({
    config: createConfig({
      repoPath,
      reviewBotLogins: ["chatgpt-codex-connector"],
    }),
    activeRecord: createRecord({
      pr_number: 44,
      state: "draft_pr",
      blocked_reason: null,
      copilot_review_timed_out_at: null,
      copilot_review_timeout_action: null,
      copilot_review_timeout_reason: null,
    }),
    latestRecord: null,
    trackedIssueCount: 1,
    pr: createPullRequest({
      number: 44,
      isDraft: true,
      headRefName: "codex/issue-38",
      reviewDecision: "REVIEW_REQUIRED",
      copilotReviewState: "not_requested",
      copilotReviewRequestedAt: null,
      copilotReviewArrivedAt: null,
      currentHeadCiGreenAt: null,
      configuredBotCurrentHeadObservedAt: null,
    }),
    checks: [],
    reviewThreads: [],
  });

  assert.match(
    status,
    /external_signal_readiness status=repo_not_ready_for_expected_signals ci=repo_not_configured review=repo_not_configured workflows=absent/,
  );
});

test("formatDetailedStatus detects the CodeRabbit profile for canonical and reversed review bot login orderings", () => {
  const pr = createPullRequest({
    number: 44,
    headRefName: "codex/issue-38",
    reviewDecision: "REVIEW_REQUIRED",
    copilotReviewState: "not_requested",
    copilotReviewRequestedAt: null,
    copilotReviewArrivedAt: null,
  });

  for (const reviewBotLogins of [
    ["coderabbitai", "coderabbitai[bot]"],
    ["coderabbitai[bot]", "coderabbitai"],
  ]) {
    const status = formatDetailedStatus({
      config: createConfig({ reviewBotLogins }),
      activeRecord: createRecord({
        pr_number: 44,
        state: "pr_open",
        blocked_reason: null,
        copilot_review_timed_out_at: null,
        copilot_review_timeout_action: null,
        copilot_review_timeout_reason: null,
      }),
      latestRecord: null,
      trackedIssueCount: 1,
      pr,
      checks: [{ name: "build", state: "SUCCESS", bucket: "pass", workflow: "CI" }],
      reviewThreads: [],
    });

    assert.match(
      status,
      /review_bot_profile profile=coderabbit provider=coderabbitai .* signal_source=review_threads/,
    );
  }
});

test("formatDetailedStatus surfaces an active CodeRabbit settled wait after a current-head observation", () => {
  withStubbedDateNow("2026-03-13T02:04:03Z", () => {
    const status = formatDetailedStatus({
      config: createConfig({
        reviewBotLogins: ["coderabbitai", "coderabbitai[bot]"],
      }),
      activeRecord: createRecord({
        pr_number: 44,
        state: "waiting_ci",
      }),
      latestRecord: null,
      trackedIssueCount: 1,
      pr: createPullRequest({
        number: 44,
        headRefName: "codex/issue-38",
        copilotReviewState: "arrived",
        copilotReviewArrivedAt: "2026-03-13T02:04:00Z",
        configuredBotCurrentHeadObservedAt: "2026-03-13T02:04:00Z",
      }),
      checks: [{ name: "build", state: "SUCCESS", bucket: "pass", workflow: "CI" }],
      reviewThreads: [],
    });

    assert.match(
      status,
      /configured_bot_settled_wait status=active provider=coderabbit pause_reason=recent_current_head_observation recent_observation=current_head_activity observed_at=2026-03-13T02:04:00Z configured_wait_seconds=5 wait_until=2026-03-13T02:04:05\.000Z/,
    );
  });
});

test("formatDetailedStatus surfaces an active CodeRabbit initial grace wait after checks turn green", () => {
  withStubbedDateNow("2026-03-13T02:05:45Z", () => {
    const status = formatDetailedStatus({
      config: createConfig({
        reviewBotLogins: ["coderabbitai", "coderabbitai[bot]"],
        configuredBotInitialGraceWaitSeconds: 90,
      }),
      activeRecord: createRecord({
        pr_number: 44,
        state: "waiting_ci",
      }),
      latestRecord: null,
      trackedIssueCount: 1,
      pr: createPullRequest({
        number: 44,
        headRefName: "codex/issue-38",
        copilotReviewState: "not_requested",
        copilotReviewArrivedAt: null,
        currentHeadCiGreenAt: "2026-03-13T02:05:00Z",
        configuredBotCurrentHeadObservedAt: null,
      }),
      checks: [{ name: "build", state: "SUCCESS", bucket: "pass", workflow: "CI" }],
      reviewThreads: [],
    });

    assert.match(
      status,
      /configured_bot_initial_grace_wait status=active provider=coderabbit pause_reason=awaiting_initial_provider_activity recent_observation=required_checks_green observed_at=2026-03-13T02:05:00Z configured_wait_seconds=90 wait_until=2026-03-13T02:06:30\.000Z/,
    );
  });
});

test("formatDetailedStatus explains CodeRabbit re-waiting after a draft skip when the PR becomes ready", () => {
  withStubbedDateNow("2026-03-13T02:30:45Z", () => {
    const status = formatDetailedStatus({
      config: createConfig({
        reviewBotLogins: ["coderabbitai", "coderabbitai[bot]"],
        configuredBotInitialGraceWaitSeconds: 90,
      }),
      activeRecord: createRecord({
        pr_number: 44,
        state: "waiting_ci",
        review_wait_started_at: "2026-03-13T02:30:00Z",
        review_wait_head_sha: "deadbeef",
      }),
      latestRecord: null,
      trackedIssueCount: 1,
      pr: createPullRequest({
        number: 44,
        headRefName: "codex/issue-38",
        copilotReviewState: "not_requested",
        copilotReviewArrivedAt: null,
        currentHeadCiGreenAt: "2026-03-13T02:05:00Z",
        configuredBotCurrentHeadObservedAt: null,
        configuredBotDraftSkipAt: "2026-03-13T02:25:00Z",
      }),
      checks: [{ name: "build", state: "SUCCESS", bucket: "pass", workflow: "CI" }],
      reviewThreads: [],
    });

    assert.match(
      status,
      /configured_bot_initial_grace_wait status=active provider=coderabbit pause_reason=awaiting_fresh_provider_review_after_draft_skip recent_observation=ready_for_review_reopened_wait observed_at=2026-03-13T02:30:00Z configured_wait_seconds=90 wait_until=2026-03-13T02:31:30\.000Z/,
    );
  });
});

test("formatDetailedStatus preserves Copilot-specific timeout wording for Copilot-only repos", () => {
  const config = createConfig({
    reviewBotLogins: ["copilot-pull-request-reviewer"],
  });
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
    pr: createPullRequest({
      number: 22,
      title: "Add review learning",
      headRefName: "codex/issue-58",
      copilotReviewState: "requested",
      copilotReviewRequestedAt: "2026-03-11T14:05:00Z",
      copilotReviewArrivedAt: null,
    }),
    checks: [],
    reviewThreads: [],
  });

  assert.match(status, /copilot_review state=requested requested_at=2026-03-11T14:05:00Z arrived_at=none timed_out_at=2026-03-11T14:15:00Z timeout_action=continue/);
  assert.match(status, /timeout_reason=Requested Copilot review never arrived within 10 minute\(s\) for head deadbeef\./);
});

test("formatDetailedStatus keeps generic configured bot timeout wording for mixed bot repos", () => {
  const config = createConfig({
    reviewBotLogins: ["copilot-pull-request-reviewer", "chatgpt-codex-connector"],
  });
  const status = formatDetailedStatus({
    config,
    activeRecord: createRecord({
      pr_number: 44,
      state: "blocked",
      blocked_reason: "review_bot_timeout",
      copilot_review_timed_out_at: "2026-03-11T14:15:00Z",
      copilot_review_timeout_action: "continue",
      copilot_review_timeout_reason:
        "Requested configured review bots (copilot-pull-request-reviewer, chatgpt-codex-connector) review never arrived within 10 minute(s) for head deadbeef.",
    }),
    latestRecord: null,
    trackedIssueCount: 1,
    pr: createPullRequest({
      number: 44,
      headRefName: "codex/issue-38",
      copilotReviewState: "requested",
      copilotReviewRequestedAt: "2026-03-11T14:05:00Z",
      copilotReviewArrivedAt: null,
    }),
    checks: [{ name: "build", state: "SUCCESS", bucket: "pass", workflow: "CI" }],
    reviewThreads: [],
  });

  assert.match(
    status,
    /configured_bot_review state=requested reviewers=copilot-pull-request-reviewer,chatgpt-codex-connector requested_at=2026-03-11T14:05:00Z arrived_at=none timed_out_at=2026-03-11T14:15:00Z timeout_action=continue/,
  );
  assert.match(
    status,
    /timeout_reason=Requested configured review bots \(copilot-pull-request-reviewer, chatgpt-codex-connector\) review never arrived within 10 minute\(s\) for head deadbeef\./,
  );
});

test("formatDetailedStatus surfaces the latest recovery reason separately from the active issue", () => {
  const config = createConfig();
  const activeRecord = createRecord({
    issue_number: 92,
    state: "implementing",
    branch: "codex/issue-92",
    workspace: "/tmp/workspaces/issue-92",
    blocked_reason: null,
    last_error: null,
    last_failure_kind: null,
    last_failure_context: null,
    last_failure_signature: null,
    codex_session_id: null,
  });
  const latestRecoveryRecord = createRecord({
    issue_number: 91,
    state: "done",
    branch: "codex/issue-91",
    workspace: "/tmp/workspaces/issue-91",
    blocked_reason: null,
    last_error: null,
    last_failure_kind: null,
    last_failure_context: null,
    last_failure_signature: null,
    codex_session_id: null,
    updated_at: "2026-03-13T00:20:00Z",
    last_codex_summary: null,
    last_recovery_reason: "merged_pr_convergence: tracked PR #191 merged; marked issue #91 done",
    last_recovery_at: "2026-03-13T00:20:00Z",
  });

  const status = formatDetailedStatus({
    config,
    activeRecord,
    latestRecord: latestRecoveryRecord,
    latestRecoveryRecord,
    trackedIssueCount: 2,
    pr: null,
    checks: [],
    reviewThreads: [],
  });

  assert.match(
    status,
    /latest_recovery issue=#91 at=2026-03-13T00:20:00Z reason=merged_pr_convergence detail=tracked PR #191 merged; marked issue #91 done/,
  );
});

test("formatDetailedStatus reports idle status with the latest record and latest recovery", () => {
  const config = createConfig();
  const latestRecord = createRecord({
    issue_number: 92,
    state: "done",
    branch: "codex/issue-92",
    updated_at: "2026-03-13T01:20:00Z",
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

  const status = formatDetailedStatus({
    config,
    activeRecord: null,
    latestRecord,
    latestRecoveryRecord,
    trackedIssueCount: 2,
    pr: null,
    checks: [],
    reviewThreads: [],
  });

  assert.match(status, /^No active issue\./);
  assert.match(status, /tracked_issues=2/);
  assert.match(status, /latest_record=#92 state=done updated_at=2026-03-13T01:20:00Z/);
  assert.match(
    status,
    /latest_recovery issue=#91 at=2026-03-13T00:20:00Z reason=merged_pr_convergence detail=tracked PR #191 merged; marked issue #91 done/,
  );
});

test("formatDetailedStatus marks stale local review as gating until current-head final evaluation resolves", () => {
  const config = createConfig({ localReviewEnabled: true, localReviewPolicy: "block_merge" });
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
    pr: createPullRequest({ headRefOid: "newhead" }),
    checks: [],
    reviewThreads: [],
  });

  assert.match(
    status,
    /local_review gating=yes policy=block_merge findings=2 root_causes=0 max_severity=medium verified_findings=0 verified_max_severity=none head=stale reviewed_head_sha=oldhead pr_head_sha=newhead ran_at=2026-03-11T14:05:00Z needs_review_run=yes drift=oldhead->newhead/,
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
  const config = createConfig({ localReviewEnabled: true, localReviewPolicy: "block_merge" });
  const record = createRecord({
    local_review_head_sha: null,
    local_review_run_at: null,
  });

  const status = formatDetailedStatus({
    config,
    activeRecord: record,
    latestRecord: record,
    trackedIssueCount: 1,
    pr: createPullRequest({ headRefOid: "newhead" }),
    checks: [],
    reviewThreads: [],
  });

  assert.match(
    status,
    /local_review gating=yes policy=block_merge findings=0 root_causes=0 max_severity=none verified_findings=0 verified_max_severity=none head=none reviewed_head_sha=none pr_head_sha=newhead ran_at=none/,
  );
  assert.doesNotMatch(status, /blocker_summary=/);
});
