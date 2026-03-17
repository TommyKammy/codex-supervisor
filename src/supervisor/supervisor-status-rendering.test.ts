import test from "node:test";
import assert from "node:assert/strict";
import {
  buildChangeClassesStatusLine,
  buildVerificationPolicyStatusLine,
  formatDetailedStatus,
} from "./supervisor-status-rendering";
import { GitHubIssue, GitHubPullRequest, IssueRunRecord, SupervisorConfig } from "../core/types";

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

function createIssue(overrides: Partial<GitHubIssue> = {}): GitHubIssue {
  return {
    number: 58,
    title: "Issue",
    body: "",
    createdAt: "2026-03-11T14:00:00Z",
    updatedAt: "2026-03-11T14:00:00Z",
    url: "https://example.test/issues/58",
    state: "OPEN",
    ...overrides,
  };
}

test("formatDetailedStatus renders core lines before appended summaries", () => {
  const config = createConfig({ localReviewArtifactDir: "/tmp/reviews" });
  const record = createRecord({
    issue_number: 58,
    state: "addressing_review",
    branch: "codex/issue-58",
    pr_number: 58,
    workspace: "/tmp/workspaces/issue-58",
    local_review_summary_path: "/tmp/reviews/owner-repo/issue-58/local-review-summary.md",
    external_review_misses_path: "/tmp/reviews/owner-repo/issue-58/external-review-misses-head-deadbeef.json",
  });
  const latestRecoveryRecord = createRecord({
    issue_number: 57,
    state: "done",
    branch: "codex/issue-57",
    workspace: "/tmp/workspaces/issue-57",
    updated_at: "2026-03-13T00:20:00Z",
    last_recovery_reason: "merged_pr_convergence: tracked PR #157 merged; marked issue #57 done",
    last_recovery_at: "2026-03-13T00:20:00Z",
  });
  const pr: GitHubPullRequest = {
    number: 58,
    title: "Render final status output",
    url: "https://example.test/pr/58",
    state: "OPEN",
    createdAt: "2026-03-11T14:00:00Z",
    isDraft: false,
    reviewDecision: null,
    mergeStateStatus: "CLEAN",
    mergeable: "MERGEABLE",
    headRefName: "codex/issue-58",
    headRefOid: "deadbeef",
    mergedAt: null,
  };

  const status = formatDetailedStatus({
    config,
    activeRecord: record,
    latestRecord: record,
    latestRecoveryRecord,
    trackedIssueCount: 2,
    pr,
    checks: [],
    reviewThreads: [],
    handoffSummary: "blocked\nneeds reproduction",
    changeClassesSummary: "change_classes=backend, docs, tests",
    verificationPolicySummary: "verification_policy intensity=standard driver=changed_files:backend|docs|tests",
    durableGuardrailSummary:
      "durable_guardrails verifier=committed:.codex/verifier-guardrails.json#1 external_review=runtime:owner-repo/issue-58/external-review-misses-head-deadbeef.json#2",
  });

  assert.equal(
    status,
    [
      "issue=#58",
      "state=addressing_review",
      "branch=codex/issue-58",
      "pr=58",
      "attempts=2",
      "implementation_attempts=2",
      "repair_attempts=0",
      "updated_at=2026-03-11T01:50:41.997Z",
      "workspace=/tmp/workspaces/issue-58",
      "blocked_reason=none",
      "last_failure_kind=none",
      "last_failure_signature=none",
      "retries timeout=0 verification=0 same_blocker=0 same_failure_signature=1",
      "local_review gating=no policy=block_ready findings=0 root_causes=0 max_severity=none verified_findings=0 verified_max_severity=none head=none reviewed_head_sha=none pr_head_sha=deadbeef ran_at=none signature=none repeated=0 stalled=no",
      "external_review head=none reviewed_head_sha=none matched=0 near_match=0 missed=0",
      "review_bot_profile profile=none provider=none reviewers=none signal_source=none",
      "review_bot_diagnostics status=disabled observed_review=none expected_reviewers=none next_check=none",
      "copilot_review state=not_requested requested_at=none arrived_at=none timed_out_at=none timeout_action=none",
      "configured_bot_top_level_review strength=none submitted_at=none effect=none",
      "pr_state=OPEN draft=no merge_state=CLEAN review_decision=none head_sha=deadbeef",
      "checks=none",
      "review_threads bot_pending=0 bot_unresolved=0 manual=0",
      "handoff_summary=blocked\\nneeds reproduction",
      "change_classes=backend, docs, tests",
      "verification_policy intensity=standard driver=changed_files:backend|docs|tests",
      "durable_guardrails verifier=committed:.codex/verifier-guardrails.json#1 external_review=runtime:owner-repo/issue-58/external-review-misses-head-deadbeef.json#2",
      "latest_recovery issue=#57 at=2026-03-13T00:20:00Z reason=merged_pr_convergence: tracked PR #157 merged; marked issue #57 done",
      "local_review_summary_path=owner-repo/issue-58/local-review-summary.md",
      "external_review_misses_path=owner-repo/issue-58/external-review-misses-head-deadbeef.json",
    ].join("\n"),
  );
});

test("buildChangeClassesStatusLine reports a sorted multi-class summary", () => {
  assert.equal(
    buildChangeClassesStatusLine([
      "src/supervisor.ts",
      "docs/getting-started.md",
      "src/supervisor/supervisor-status-rendering.test.ts",
      "src/supervisor.ts",
    ]),
    "change_classes=backend, docs, tests",
  );
});

test("buildVerificationPolicyStatusLine reports focused policy for docs-only changes", () => {
  assert.equal(
    buildVerificationPolicyStatusLine({
      changedFiles: ["docs/getting-started.md"],
    }),
    "verification_policy intensity=focused driver=changed_files:docs",
  );
});

test("buildVerificationPolicyStatusLine gives issue metadata precedence when it drives a higher policy", () => {
  assert.equal(
    buildVerificationPolicyStatusLine({
      issue: createIssue({
        title: "Clarify auth rollout",
        body: `## Summary
Document the auth rollout plan.

## Scope
- keep the rollout notes aligned with auth token handling

## Acceptance criteria
- the docs cover the current auth rollout

## Verification
- npm test -- src/supervisor/supervisor-status-rendering.test.ts`,
      }),
      changedFiles: ["docs/getting-started.md"],
    }),
    "verification_policy intensity=strong driver=issue_metadata:auth",
  );
});

test("formatDetailedStatus keeps idle output compact when there is no active issue", () => {
  const status = formatDetailedStatus({
    config: createConfig(),
    activeRecord: null,
    latestRecord: createRecord({
      issue_number: 92,
      state: "done",
      branch: "codex/issue-92",
      updated_at: "2026-03-13T01:20:00Z",
    }),
    latestRecoveryRecord: createRecord({
      issue_number: 91,
      state: "done",
      branch: "codex/issue-91",
      workspace: "/tmp/workspaces/issue-91",
      updated_at: "2026-03-13T00:20:00Z",
      last_recovery_reason: "merged_pr_convergence: tracked PR #191 merged; marked issue #91 done",
      last_recovery_at: "2026-03-13T00:20:00Z",
    }),
    trackedIssueCount: 2,
    pr: null,
    checks: [],
    reviewThreads: [],
  });

  assert.equal(
    status,
    [
      "No active issue.",
      "tracked_issues=2",
      "latest_record=#92 state=done updated_at=2026-03-13T01:20:00Z",
      "latest_recovery issue=#91 at=2026-03-13T00:20:00Z reason=merged_pr_convergence: tracked PR #191 merged; marked issue #91 done",
    ].join("\n"),
  );
});
