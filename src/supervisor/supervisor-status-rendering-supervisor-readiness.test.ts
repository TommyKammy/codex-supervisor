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

test("status readiness shows stale-review root blockers through dependency chains", async () => {
  const config = createConfig();
  const state: SupervisorStateFile = {
    activeIssueNumber: null,
    issues: {
      "1695": createRecord({
        issue_number: 1695,
        state: "blocked",
        blocked_reason: "stale_review_bot",
      }),
    },
  };
  const staleRoot = createExecutionReadyIssue({
    number: 1695,
    title: "Refresh configured-bot metadata",
  });
  const firstDependent = createExecutionReadyIssue({
    number: 1696,
    title: "Use fresh configured-bot metadata",
    body: `## Summary
Run only after the configured-bot metadata blocker clears.

## Scope
- depend on the stale review-bot predecessor

## Acceptance criteria
- status shows the dependency root blocker

## Verification
- npx tsx --test src/supervisor/supervisor-status-rendering-supervisor.test.ts

Depends on: #1695
Parallelizable: No

## Execution order
1 of 1`,
  });
  const secondDependent = createExecutionReadyIssue({
    number: 1697,
    title: "Run after the dependent issue",
    body: `## Summary
Run only after the previous dependent issue clears.

## Scope
- depend on the chained predecessor

## Acceptance criteria
- status shows the dependency root blocker through the chain

## Verification
- npx tsx --test src/supervisor/supervisor-status-rendering-supervisor.test.ts

Depends on: #1696
Parallelizable: No

## Execution order
1 of 1`,
  });

  const summary = await buildReadinessSummary(
    {
      listCandidateIssues: async () => [firstDependent, secondDependent],
      listAllIssues: async () => [staleRoot, firstDependent, secondDependent],
    },
    config,
    state,
  );

  assert.deepEqual(summary.blockedIssues, [
    {
      issueNumber: 1696,
      title: "Use fresh configured-bot metadata",
      blockedBy: "depends on #1695 root_blocker=#1695 blocked_reason=stale_review_bot",
    },
    {
      issueNumber: 1697,
      title: "Run after the dependent issue",
      blockedBy: "depends on #1696 root_blocker=#1695 blocked_reason=stale_review_bot",
    },
  ]);
  assert.match(
    summary.readinessLines.join("\n"),
    /blocked_issues=#1696 blocked_by=depends on #1695 root_blocker=#1695 blocked_reason=stale_review_bot; #1697 blocked_by=depends on #1696 root_blocker=#1695 blocked_reason=stale_review_bot/,
  );
});
