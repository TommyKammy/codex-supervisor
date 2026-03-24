import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  type GitHubIssue,
  type GitHubPullRequest,
  type IssueRunRecord,
  type PullRequestCheck,
  type ReviewThread,
  type SupervisorConfig,
} from "../core/types";
import { type LocalReviewArtifact } from "../local-review";
import {
  preMergeAssessmentSnapshotPath,
  writePreMergeAssessmentSnapshot,
} from "./pre-merge-assessment-snapshot";

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
    localReviewEnabled: true,
    localReviewAutoDetect: true,
    localReviewRoles: [],
    localReviewArtifactDir: "/tmp/reviews",
    localReviewConfidenceThreshold: 0.7,
    localReviewReviewerThresholds: {
      generic: { confidenceThreshold: 0.7, minimumSeverity: "low" },
      specialist: { confidenceThreshold: 0.7, minimumSeverity: "low" },
    },
    localReviewPolicy: "block_merge",
    localReviewHighSeverityAction: "blocked",
    reviewBotLogins: ["copilot-pull-request-reviewer"],
    humanReviewBlocksMerge: true,
    issueJournalRelativePath: ".codex-supervisor/issue-journal.md",
    issueJournalMaxChars: 6000,
    skipTitlePrefixes: [],
    branchPrefix: "codex/issue-",
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

function createIssue(overrides: Partial<GitHubIssue> = {}): GitHubIssue {
  return {
    number: 916,
    title: "Capture typed pre-merge assessment snapshot",
    body: "",
    createdAt: "2026-03-24T00:00:00Z",
    updatedAt: "2026-03-24T00:00:00Z",
    url: "https://example.test/issues/916",
    state: "OPEN",
    ...overrides,
  };
}

function createPullRequest(overrides: Partial<GitHubPullRequest> = {}): GitHubPullRequest {
  return {
    number: 930,
    title: "Capture typed pre-merge assessment snapshot",
    url: "https://example.test/pull/930",
    state: "OPEN",
    createdAt: "2026-03-24T00:10:00Z",
    isDraft: false,
    reviewDecision: "CHANGES_REQUESTED",
    mergeStateStatus: "CLEAN",
    mergeable: "MERGEABLE",
    headRefName: "codex/issue-916",
    headRefOid: "head-916",
    mergedAt: null,
    ...overrides,
  };
}

function createRecord(summaryPath: string): IssueRunRecord {
  return {
    issue_number: 916,
    state: "pr_open",
    branch: "codex/issue-916",
    pr_number: 930,
    workspace: "/tmp/workspaces/issue-916",
    journal_path: "/tmp/workspaces/issue-916/.codex-supervisor/issue-journal.md",
    review_wait_started_at: null,
    review_wait_head_sha: null,
    provider_success_observed_at: "2026-03-24T00:12:00Z",
    provider_success_head_sha: "head-916",
    merge_readiness_last_evaluated_at: "2026-03-24T00:13:00Z",
    copilot_review_requested_observed_at: null,
    copilot_review_requested_head_sha: null,
    copilot_review_timed_out_at: null,
    copilot_review_timeout_action: null,
    copilot_review_timeout_reason: null,
    codex_session_id: null,
    local_review_head_sha: "head-916",
    local_review_blocker_summary: "high src/gate.ts:44 contract still blocks merge",
    local_review_summary_path: summaryPath,
    local_review_run_at: "2026-03-24T00:11:00Z",
    local_review_max_severity: "high",
    local_review_findings_count: 2,
    local_review_root_cause_count: 1,
    local_review_verified_max_severity: "high",
    local_review_verified_findings_count: 1,
    local_review_recommendation: "changes_requested",
    local_review_degraded: false,
    last_local_review_signature: "local-review:high:1:clean",
    repeated_local_review_signature_count: 0,
    latest_local_ci_result: null,
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
    last_head_sha: "head-916",
    workspace_restore_source: null,
    workspace_restore_ref: null,
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
    updated_at: "2026-03-24T00:14:00Z",
  };
}

test("writePreMergeAssessmentSnapshot captures typed PR, CI, review, local-review, and supervisor evidence", async () => {
  const workspacePath = await fs.mkdtemp(path.join(os.tmpdir(), "pre-merge-assessment-"));
  const reviewDir = path.join(workspacePath, "reviews");
  const summaryPath = path.join(reviewDir, "head-head-916.md");
  const artifactPath = path.join(reviewDir, "head-head-916.json");
  await fs.mkdir(reviewDir, { recursive: true });
  await fs.writeFile(summaryPath, "# local review\n", "utf8");

  const localReviewArtifact: LocalReviewArtifact = {
    issueNumber: 916,
    prNumber: 930,
    branch: "codex/issue-916",
    headSha: "head-916",
    ranAt: "2026-03-24T00:11:00Z",
    confidenceThreshold: 0.7,
    reviewerThresholds: {
      generic: { confidenceThreshold: 0.7, minimumSeverity: "low" },
      specialist: { confidenceThreshold: 0.7, minimumSeverity: "low" },
    },
    roles: ["reviewer"],
    autoDetectedRoles: [],
    summary: "Local review found a confirmed high-severity issue.",
    recommendation: "changes_requested",
    degraded: false,
    findingsCount: 2,
    rootCauseCount: 1,
    maxSeverity: "high",
    actionableFindings: [],
    rootCauseSummaries: [],
    verification: {
      required: true,
      summary: "Verifier confirmed one blocking finding.",
      recommendation: "changes_requested",
      degraded: false,
      findingsCount: 1,
      verifiedFindingsCount: 1,
      verifiedMaxSeverity: "high",
      findings: [],
    },
    verifiedFindings: [],
    finalEvaluation: {
      outcome: "fix_blocked",
      residualFindings: [],
      mustFixCount: 1,
      manualReviewCount: 0,
      followUpCount: 0,
    },
    guardrailProvenance: {
      verifier: { committedPath: null, committedCount: 0 },
      externalReview: { committedPath: null, committedCount: 0, runtimeSources: [] },
    },
    roleReports: [],
    verifierReport: null,
  };
  await fs.writeFile(artifactPath, `${JSON.stringify(localReviewArtifact, null, 2)}\n`, "utf8");

  const persistedPath = await writePreMergeAssessmentSnapshot({
    config: createConfig({ localReviewArtifactDir: reviewDir }),
    capturedAt: "2026-03-24T00:15:00Z",
    issue: createIssue(),
    record: createRecord(summaryPath),
    workspacePath,
    pr: createPullRequest(),
    checks: [
      { name: "build", state: "SUCCESS", bucket: "pass", workflow: "CI" },
      { name: "unit", state: "FAILURE", bucket: "fail", workflow: "CI" },
      { name: "lint", state: "IN_PROGRESS", bucket: "pending", workflow: "CI" },
    ] satisfies PullRequestCheck[],
    reviewThreads: [
      {
        id: "thread-bot",
        isResolved: false,
        isOutdated: false,
        path: "src/gate.ts",
        line: 44,
        comments: {
          nodes: [
            {
              id: "comment-bot",
              body: "Please fix this blocking path.",
              createdAt: "2026-03-24T00:12:30Z",
              url: "https://example.test/pull/930#discussion_r1",
              author: { login: "copilot-pull-request-reviewer", typeName: "Bot" },
            },
          ],
        },
      },
      {
        id: "thread-human",
        isResolved: false,
        isOutdated: false,
        path: "src/gate.ts",
        line: 51,
        comments: {
          nodes: [
            {
              id: "comment-human",
              body: "I want a clearer contract here.",
              createdAt: "2026-03-24T00:13:00Z",
              url: "https://example.test/pull/930#discussion_r2",
              author: { login: "alice", typeName: "User" },
            },
          ],
        },
      },
    ] satisfies ReviewThread[],
  });

  assert.equal(persistedPath, preMergeAssessmentSnapshotPath(workspacePath));
  const snapshot = JSON.parse(await fs.readFile(persistedPath, "utf8"));

  assert.equal(snapshot.schemaVersion, 1);
  assert.equal(snapshot.pullRequest.number, 930);
  assert.equal(snapshot.supervisor.headMatchesPullRequest, true);
  assert.equal(snapshot.supervisor.localReviewGating, true);
  assert.equal(snapshot.checks.summary.total, 3);
  assert.equal(snapshot.checks.summary.hasFailing, true);
  assert.equal(snapshot.checks.summary.hasPending, true);
  assert.equal(snapshot.reviews.summary.reviewDecision, "CHANGES_REQUESTED");
  assert.equal(snapshot.reviews.summary.unresolvedCount, 2);
  assert.equal(snapshot.reviews.summary.manualUnresolvedCount, 1);
  assert.equal(snapshot.reviews.summary.configuredBotUnresolvedCount, 1);
  assert.equal(snapshot.reviews.summary.pendingConfiguredBotCount, 1);
  assert.equal(snapshot.localReview.summary.available, true);
  assert.equal(snapshot.localReview.summary.finalEvaluationOutcome, "fix_blocked");
  assert.equal(snapshot.localReview.artifact.finalEvaluation.mustFixCount, 1);
});
