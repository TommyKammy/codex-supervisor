import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import test from "node:test";
import {
  loadActiveIssueStatusSnapshot,
} from "./supervisor-selection-active-status";
import {
  summarizeSupervisorStatusRecords,
} from "./supervisor-selection-status-records";
import { GitHubIssue, GitHubPullRequest, IssueRunRecord, PullRequestCheck, ReviewThread, SupervisorConfig, SupervisorStateFile } from "../core/types";

const execFileAsync = promisify(execFile);

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

function createRecord(overrides: Partial<IssueRunRecord> = {}): IssueRunRecord {
  return {
    issue_number: 58,
    state: "reproducing",
    branch: "codex/issue-58",
    pr_number: 58,
    workspace: "/tmp/workspaces/issue-58",
    journal_path: "/tmp/workspaces/issue-58/.codex-supervisor/issue-journal.md",
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
    last_head_sha: "cafebabe",
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
    title: "Status helpers",
    body: "## Summary\nRefactor active status helpers.",
    createdAt: "2026-03-11T00:00:00Z",
    updatedAt: "2026-03-11T00:00:00Z",
    url: "https://example.test/issues/58",
    ...overrides,
  };
}

function createPullRequest(overrides: Partial<GitHubPullRequest> = {}): GitHubPullRequest {
  return {
    number: 58,
    title: "Status helpers",
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
    ...overrides,
  };
}

test("summarizeSupervisorStatusRecords selects the active, latest, and latest recovery records", () => {
  const activeRecord = createRecord({
    issue_number: 58,
    updated_at: "2026-03-11T01:50:41.997Z",
  });
  const latestRecord = createRecord({
    issue_number: 59,
    updated_at: "2026-03-14T05:00:00.000Z",
  });
  const latestRecoveryRecord = createRecord({
    issue_number: 60,
    updated_at: "2026-03-13T04:00:00.000Z",
    last_recovery_reason: "merged_pr_convergence: tracked PR #60 merged",
    last_recovery_at: "2026-03-15T09:30:00.000Z",
  });
  const state: SupervisorStateFile = {
    activeIssueNumber: 58,
    issues: {
      "58": activeRecord,
      "59": latestRecord,
      "60": latestRecoveryRecord,
    },
  };

  assert.deepEqual(summarizeSupervisorStatusRecords(state), {
    activeRecord,
    latestRecord,
    latestRecoveryRecord,
    trackedIssueCount: 3,
  });
});

test("loadActiveIssueStatusSnapshot keeps journal handoff, summarizes status, and skips closed PR checks", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "selection-status-"));
  const workspace = path.join(tempDir, "workspace");
  const remote = path.join(tempDir, "remote.git");
  const journalPath = path.join(workspace, ".codex-supervisor", "issue-journal.md");
  await fs.mkdir(path.dirname(journalPath), { recursive: true });
  await fs.writeFile(
    journalPath,
    [
      "# Issue #58: Status helpers",
      "",
      "## Codex Working Notes",
      "### Current Handoff",
      "- Current blocker: verification waiting on active PR signal",
      "- Next exact step: extract active status helpers into their own module",
      "",
      "### Scratchpad",
      "- Keep this section short.",
      "",
    ].join("\n"),
    "utf8",
  );

  const checks: PullRequestCheck[] = [{ name: "ci", state: "SUCCESS", bucket: "pass", workflow: "CI" }];
  const reviewThreads: ReviewThread[] = [
    {
      id: "thread-1",
      isResolved: false,
      isOutdated: false,
      path: "src/supervisor/supervisor-selection-status.ts",
      line: 12,
      comments: { nodes: [] },
    },
  ];

  const record = createRecord({
    workspace,
    journal_path: journalPath,
    external_review_head_sha: "cafebabe",
  });

  try {
    await execFileAsync("git", ["init", "--bare", remote]);
    await execFileAsync("git", ["init", "-b", "main", workspace]);
    await execFileAsync("git", ["config", "user.name", "Codex"], { cwd: workspace });
    await execFileAsync("git", ["config", "user.email", "codex@example.test"], { cwd: workspace });
    await execFileAsync("git", ["remote", "add", "origin", remote], { cwd: workspace });
    await fs.mkdir(path.join(workspace, "src", "supervisor"), { recursive: true });
    await fs.writeFile(path.join(workspace, "README.md"), "base\n", "utf8");
    await execFileAsync("git", ["add", "README.md"], { cwd: workspace });
    await execFileAsync("git", ["commit", "-m", "base"], { cwd: workspace });
    await execFileAsync("git", ["push", "-u", "origin", "main"], { cwd: workspace });
    await execFileAsync("git", ["checkout", "-b", "codex/issue-58"], { cwd: workspace });
    await fs.writeFile(
      path.join(workspace, "src", "supervisor", "supervisor-status-model.test.ts"),
      "export const changed = true;\n",
      "utf8",
    );
    await execFileAsync("git", ["add", "src/supervisor/supervisor-status-model.test.ts"], { cwd: workspace });
    await execFileAsync("git", ["commit", "-m", "add test change"], { cwd: workspace });

    const snapshot = await loadActiveIssueStatusSnapshot({
      config: createConfig({ defaultBranch: "main" }),
      activeRecord: record,
      github: {
        async getIssue() {
          return createIssue();
        },
        async resolvePullRequestForBranch() {
          return createPullRequest({
            state: "CLOSED",
            mergedAt: "2026-03-12T00:00:00Z",
          });
        },
        async getChecks() {
          return checks;
        },
        async getUnresolvedReviewThreads() {
          return reviewThreads;
        },
      },
    });

    assert.equal(
      snapshot.handoffSummary,
      "blocker: verification waiting on active PR signal | next: extract active status helpers into their own module",
    );
    assert.equal(snapshot.pr?.state, "CLOSED");
    assert.deepEqual(snapshot.checks, []);
    assert.deepEqual(snapshot.reviewThreads, []);
    assert.equal(snapshot.changeClassesSummary, "change_classes=tests");
    assert.equal(snapshot.verificationPolicySummary, "verification_policy intensity=focused driver=changed_files:tests");
    assert.equal(snapshot.durableGuardrailSummary, null);
    assert.equal(snapshot.externalReviewFollowUpSummary, null);
    assert.equal(snapshot.warningMessage, null);
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});

test("loadActiveIssueStatusSnapshot aggregates journal and GitHub warnings", async () => {
  const record = createRecord({
    workspace: "/tmp/workspaces/issue-58",
    journal_path: "/tmp/workspaces/issue-58/.codex-supervisor/missing-issue-journal.md",
  });

  const snapshot = await loadActiveIssueStatusSnapshot({
    config: createConfig(),
    activeRecord: record,
    github: {
      async resolvePullRequestForBranch() {
        throw new Error("pull request lookup failed");
      },
      async getChecks(): Promise<PullRequestCheck[]> {
        throw new Error("should not be called");
      },
      async getUnresolvedReviewThreads(): Promise<ReviewThread[]> {
        throw new Error("should not be called");
      },
    },
  });

  assert.equal(snapshot.pr, null);
  assert.deepEqual(snapshot.checks, []);
  assert.deepEqual(snapshot.reviewThreads, []);
  assert.equal(snapshot.handoffSummary, null);
  assert.match(snapshot.warningMessage ?? "", /pull request lookup failed/);
});
