import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { formatDetailedStatus, summarizeChecks } from "./supervisor-status-rendering";
import { buildDetailedStatusSummaryLines } from "./supervisor-status-model";
import { buildReadinessSummary } from "./supervisor-selection-readiness-summary";
import {
  GitHubIssue,
  GitHubPullRequest,
  IssueRunRecord,
  PullRequestCheck,
  ReviewThread,
  SupervisorConfig,
  SupervisorStateFile,
} from "../core/types";


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

function createExecutionReadyIssue(overrides: Partial<GitHubIssue> = {}): GitHubIssue {
  const number = overrides.number ?? 1695;
  return {
    number,
    title: `Issue ${number}`,
    body: `## Summary
Keep the issue execution-ready.

## Scope
- preserve the focused test fixture

## Acceptance criteria
- status explains dependency readiness

## Verification
- npx tsx --test src/supervisor/supervisor-status-rendering-supervisor.test.ts

Depends on: none
Parallelizable: No

## Execution order
1 of 1`,
    createdAt: "2026-04-25T00:00:00Z",
    updatedAt: "2026-04-25T00:00:00Z",
    url: `https://example.test/issues/${number}`,
    state: "OPEN",
    labels: [],
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
          url: "https://example.test/pr/42#discussion_r1",
          author: {
            login: "chatgpt-codex-connector",
            typeName: "Bot",
          },
        },
      ],
    },
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

test("buildDetailedStatusSummaryLines surfaces same-PR follow-up repair without changing the saved outcome", () => {
  const statusLines = buildDetailedStatusSummaryLines({
    config: createConfig({ localReviewFollowUpRepairEnabled: true }),
    activeRecord: createRecord({
      state: "local_review_fix",
      local_review_summary_path: "/tmp/reviews/owner-repo/issue-366/head-deadbeef.md",
    }),
    activityContext: {
      handoffSummary: null,
      localReviewRoutingSummary: null,
      changeClassesSummary: null,
      verificationPolicySummary: null,
      durableGuardrailSummary: null,
      externalReviewFollowUpSummary: null,
      preMergeEvaluation: {
        status: "follow_up_eligible",
        outcome: "follow_up_eligible",
        repair: "same_pr_follow_up_current_head",
        reason: "follow_up_candidates=1",
        headStatus: "current",
        summaryPath: "owner-repo/issue-366/head-deadbeef.md",
        artifactPath: "owner-repo/issue-366/head-deadbeef.json",
        ranAt: "2026-03-24T00:11:00Z",
        mustFixCount: 0,
        manualReviewCount: 0,
        followUpCount: 1,
      },
      localCiStatus: null,
      latestRecovery: null,
      retryContext: {
        timeoutRetryCount: 0,
        blockedVerificationRetryCount: 0,
        repeatedBlockerCount: 0,
        repeatedFailureSignatureCount: 0,
        lastFailureSignature: null,
      },
      repeatedRecovery: null,
      recentPhaseChanges: [],
      localReviewSummaryPath: "owner-repo/issue-366/head-deadbeef.md",
      externalReviewMissesPath: null,
      reviewWaits: [],
    },
  });

  assert.ok(
    statusLines.includes(
      "pre_merge_evaluation status=follow_up_eligible outcome=follow_up_eligible repair=same_pr_follow_up_current_head head=current must_fix=0 manual_review=0 follow_up=1 reason=follow_up_candidates=1 ran_at=2026-03-24T00:11:00Z summary_path=owner-repo/issue-366/head-deadbeef.md artifact_path=owner-repo/issue-366/head-deadbeef.json",
    ),
  );
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

test("formatDetailedStatus surfaces final auto-merge guard evidence", () => {
  const status = formatDetailedStatus({
    config: createConfig(),
    activeRecord: createRecord({
      pr_number: 44,
      state: "merging",
      last_auto_merge_guard_context: {
        category: null,
        summary: "Final auto-merge guard passed for PR #44.",
        signature: "auto-merge-ready:head-44",
        command: null,
        details: ["head_sha=head-44", "checks=green count=1", "configured_bot_blockers=0"],
        url: "https://example.test/pr/44",
        updated_at: "2026-03-13T06:30:00Z",
      },
    }),
    latestRecord: null,
    trackedIssueCount: 1,
    pr: createPullRequest({
      number: 44,
      headRefName: "codex/issue-38",
      headRefOid: "head-44",
    }),
    checks: [{ name: "build", state: "SUCCESS", bucket: "pass", workflow: "CI" }],
    reviewThreads: [],
  });

  assert.match(status, /auto_merge_guard summary=Final auto-merge guard passed for PR #44\./);
  assert.match(status, /auto_merge_guard_details=head_sha=head-44 \| checks=green count=1 \| configured_bot_blockers=0/);
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
