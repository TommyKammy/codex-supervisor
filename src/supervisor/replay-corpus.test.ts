import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { GitHubIssue, GitHubPullRequest, IssueRunRecord, ReviewThread, SupervisorConfig, WorkspaceStatus } from "../core/types";
import { buildSupervisorCycleDecisionSnapshot } from "./supervisor-cycle-snapshot";
import { loadReplayCorpus } from "./replay-corpus";

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
    localReviewPolicy: "block_ready",
    localReviewHighSeverityAction: "retry",
    reviewBotLogins: ["copilot-pull-request-reviewer"],
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
    issue_number: 532,
    state: "addressing_review",
    branch: "codex/issue-532",
    pr_number: 90,
    workspace: "/tmp/workspaces/issue-532",
    journal_path: "/tmp/workspaces/issue-532/.codex-supervisor/issue-journal.md",
    review_wait_started_at: "2026-03-16T10:00:00Z",
    review_wait_head_sha: "head-532",
    copilot_review_requested_observed_at: null,
    copilot_review_requested_head_sha: null,
    copilot_review_timed_out_at: null,
    copilot_review_timeout_action: null,
    copilot_review_timeout_reason: null,
    codex_session_id: null,
    local_review_head_sha: "head-532",
    local_review_blocker_summary: "High severity finding still open.",
    local_review_summary_path: "/tmp/reviews/summary.md",
    local_review_run_at: "2026-03-16T10:03:00Z",
    local_review_max_severity: "high",
    local_review_findings_count: 1,
    local_review_root_cause_count: 1,
    local_review_verified_max_severity: "high",
    local_review_verified_findings_count: 1,
    local_review_recommendation: "changes_requested",
    local_review_degraded: false,
    last_local_review_signature: "local-review:high",
    repeated_local_review_signature_count: 1,
    external_review_head_sha: null,
    external_review_misses_path: null,
    external_review_matched_findings_count: 0,
    external_review_near_match_findings_count: 0,
    external_review_missed_findings_count: 0,
    attempt_count: 3,
    implementation_attempt_count: 2,
    repair_attempt_count: 1,
    timeout_retry_count: 0,
    blocked_verification_retry_count: 0,
    repeated_blocker_count: 0,
    repeated_failure_signature_count: 0,
    last_head_sha: "head-532",
    last_codex_summary: null,
    last_recovery_reason: null,
    last_recovery_at: null,
    last_error: "Review still pending.",
    last_failure_kind: null,
    last_failure_context: null,
    last_blocker_signature: null,
    last_failure_signature: "review-pending",
    blocked_reason: null,
    processed_review_thread_ids: ["thread-1@head-532"],
    processed_review_thread_fingerprints: ["thread-1@head-532#comment-1"],
    updated_at: "2026-03-16T10:05:00Z",
    ...overrides,
  };
}

function createIssue(overrides: Partial<GitHubIssue> = {}): GitHubIssue {
  return {
    number: 532,
    title: "Replay corpus example",
    body: "",
    createdAt: "2026-03-16T09:00:00Z",
    updatedAt: "2026-03-16T10:05:00Z",
    url: "https://example.test/issues/532",
    state: "OPEN",
    ...overrides,
  };
}

function createPr(overrides: Partial<GitHubPullRequest> = {}): GitHubPullRequest {
  return {
    number: 90,
    title: "Replay corpus example",
    url: "https://example.test/pull/90",
    state: "OPEN",
    createdAt: "2026-03-16T09:15:00Z",
    updatedAt: "2026-03-16T10:06:00Z",
    isDraft: false,
    reviewDecision: "CHANGES_REQUESTED",
    mergeStateStatus: "CLEAN",
    mergeable: "MERGEABLE",
    headRefName: "codex/issue-532",
    headRefOid: "head-532",
    mergedAt: null,
    configuredBotTopLevelReviewStrength: "blocking",
    ...overrides,
  };
}

function createWorkspaceStatus(overrides: Partial<WorkspaceStatus> = {}): WorkspaceStatus {
  return {
    branch: "codex/issue-532",
    headSha: "head-532",
    hasUncommittedChanges: false,
    baseAhead: 1,
    baseBehind: 0,
    remoteBranchExists: true,
    remoteAhead: 0,
    remoteBehind: 0,
    ...overrides,
  };
}

function createReviewThread(overrides: Partial<ReviewThread> = {}): ReviewThread {
  return {
    id: "thread-1",
    isResolved: false,
    isOutdated: false,
    path: "src/supervisor.ts",
    line: 42,
    comments: {
      nodes: [
        {
          id: "comment-1",
          body: "Please address this blocking issue.",
          createdAt: "2026-03-16T10:04:00Z",
          url: "https://example.test/pull/90#discussion_r1",
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

function createSnapshot() {
  return buildSupervisorCycleDecisionSnapshot({
    config: createConfig(),
    capturedAt: "2026-03-16T10:07:00Z",
    issue: createIssue(),
    record: createRecord(),
    workspaceStatus: createWorkspaceStatus(),
    pr: createPr(),
    checks: [{ name: "build", state: "completed", bucket: "pass" }],
    reviewThreads: [createReviewThread()],
  });
}

async function writeJson(filePath: string, value: unknown): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

test("loadReplayCorpus loads canonical case bundles from the manifest in order", async () => {
  const corpusRoot = await fs.mkdtemp(path.join(os.tmpdir(), "replay-corpus-"));
  const snapshot = createSnapshot();
  const expectedReplay = {
    nextState: snapshot.decision.nextState,
    shouldRunCodex: snapshot.decision.shouldRunCodex,
    blockedReason: snapshot.decision.blockedReason,
    failureSignature: snapshot.decision.failureContext?.signature ?? null,
  };

  await writeJson(path.join(corpusRoot, "manifest.json"), {
    schemaVersion: 1,
    cases: [
      {
        id: "review-blocked",
        path: "cases/review-blocked",
      },
    ],
  });
  await writeJson(path.join(corpusRoot, "cases", "review-blocked", "case.json"), {
    schemaVersion: 1,
    id: "review-blocked",
    issueNumber: snapshot.issue.number,
    title: snapshot.issue.title,
    capturedAt: snapshot.capturedAt,
  });
  await writeJson(path.join(corpusRoot, "cases", "review-blocked", "input", "snapshot.json"), snapshot);
  await writeJson(path.join(corpusRoot, "cases", "review-blocked", "expected", "replay-result.json"), expectedReplay);

  const corpus = await loadReplayCorpus(corpusRoot);

  assert.equal(corpus.rootPath, corpusRoot);
  assert.deepEqual(corpus.cases.map((bundle) => bundle.id), ["review-blocked"]);
  assert.equal(corpus.cases[0]?.bundlePath, path.join(corpusRoot, "cases", "review-blocked"));
  assert.equal(corpus.cases[0]?.metadata.issueNumber, 532);
  assert.equal(corpus.cases[0]?.input.snapshot.issue.number, 532);
  assert.deepEqual(corpus.cases[0]?.expected, expectedReplay);
});

test("loadReplayCorpus rejects case bundles that omit required files", async () => {
  const corpusRoot = await fs.mkdtemp(path.join(os.tmpdir(), "replay-corpus-invalid-"));
  const snapshot = createSnapshot();

  await writeJson(path.join(corpusRoot, "manifest.json"), {
    schemaVersion: 1,
    cases: [
      {
        id: "review-blocked",
        path: "cases/review-blocked",
      },
    ],
  });
  await writeJson(path.join(corpusRoot, "cases", "review-blocked", "case.json"), {
    schemaVersion: 1,
    id: "review-blocked",
    issueNumber: snapshot.issue.number,
    title: snapshot.issue.title,
    capturedAt: snapshot.capturedAt,
  });
  await writeJson(path.join(corpusRoot, "cases", "review-blocked", "input", "snapshot.json"), snapshot);

  await assert.rejects(
    () => loadReplayCorpus(corpusRoot),
    /Missing required replay corpus file: .*cases\/review-blocked\/expected\/replay-result\.json/,
  );
});

test("loadReplayCorpus loads the checked-in example bundle", async () => {
  const corpus = await loadReplayCorpus(path.join(process.cwd(), "replay-corpus"));

  assert.deepEqual(corpus.cases.map((bundle) => bundle.id), ["review-blocked"]);
  assert.equal(corpus.cases[0]?.metadata.issueNumber, 532);
  assert.equal(corpus.cases[0]?.expected.nextState, "blocked");
  assert.equal(corpus.cases[0]?.expected.blockedReason, "manual_review");
  assert.equal(corpus.cases[0]?.expected.failureSignature, "stalled-bot:thread-1");
});
