import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { GitHubIssue, GitHubPullRequest, IssueRunRecord, ReviewThread, SupervisorConfig, WorkspaceStatus } from "../core/types";
import { buildSupervisorCycleDecisionSnapshot } from "./supervisor-cycle-snapshot";
import {
  createCheckedInReplayCorpusConfig,
  deriveReplayCorpusPromotionWorthinessHints,
  formatReplayCorpusMismatchDetailsArtifact,
  loadReplayCorpus,
  formatReplayCorpusMismatchSummaryLine,
  formatReplayCorpusOutcomeMismatch,
  formatReplayCorpusRunSummary,
  promoteCapturedReplaySnapshot,
  runReplayCorpus,
  suggestReplayCorpusCaseIds,
  syncReplayCorpusMismatchDetailsArtifact,
} from "./replay-corpus";

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

function createSnapshot(args: {
  config?: SupervisorConfig;
  capturedAt?: string;
  issue?: GitHubIssue;
  record?: IssueRunRecord;
  workspaceStatus?: WorkspaceStatus;
  pr?: GitHubPullRequest | null;
  checks?: { name: string; state: string; bucket: string; workflow?: string; link?: string }[];
  reviewThreads?: ReviewThread[];
} = {}) {
  const config = args.config ?? createConfig();
  return buildSupervisorCycleDecisionSnapshot({
    config,
    capturedAt: args.capturedAt ?? "2026-03-16T10:07:00Z",
    issue: args.issue ?? createIssue(),
    record: args.record ?? createRecord(),
    workspaceStatus: args.workspaceStatus ?? createWorkspaceStatus(),
    pr: args.pr === undefined ? createPr() : args.pr,
    checks: args.checks ?? [{ name: "build", state: "completed", bucket: "pass" }],
    reviewThreads: args.reviewThreads ?? [createReviewThread()],
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

  const missingReplayResultPath = path.join(
    corpusRoot,
    "cases",
    "review-blocked",
    "expected",
    "replay-result.json",
  );
  await assert.rejects(() => loadReplayCorpus(corpusRoot), (error) => {
    return (
      error instanceof Error &&
      error.message.includes(`Missing required replay corpus file: ${missingReplayResultPath}`)
    );
  });
});

test("loadReplayCorpus rejects manifest case ids that are not single path segments", async () => {
  const corpusRoot = await fs.mkdtemp(path.join(os.tmpdir(), "replay-corpus-invalid-id-"));

  await writeJson(path.join(corpusRoot, "manifest.json"), {
    schemaVersion: 1,
    cases: [
      {
        id: "../outside",
        path: "cases/../outside",
      },
    ],
  });

  await assert.rejects(
    () => loadReplayCorpus(corpusRoot),
    /Replay corpus manifest case\[0\] id must be a single path segment/,
  );
});

test("loadReplayCorpus rejects input snapshots that omit required fields", async () => {
  const corpusRoot = await fs.mkdtemp(path.join(os.tmpdir(), "replay-corpus-invalid-snapshot-"));

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
    issueNumber: 532,
    title: "Replay corpus example",
    capturedAt: "2026-03-16T10:07:00Z",
  });
  await writeJson(path.join(corpusRoot, "cases", "review-blocked", "input", "snapshot.json"), {
    schemaVersion: 1,
  });
  await writeJson(path.join(corpusRoot, "cases", "review-blocked", "expected", "replay-result.json"), {
    nextState: "blocked",
    shouldRunCodex: false,
    blockedReason: "manual_review",
    failureSignature: "stalled-bot:thread-1",
  });

  await assert.rejects(
    () => loadReplayCorpus(corpusRoot),
    /Replay corpus case "review-blocked" input snapshot issue must be an object/,
  );
});

test("loadReplayCorpus rejects input snapshots that omit replay-required objects", async () => {
  const corpusRoot = await fs.mkdtemp(path.join(os.tmpdir(), "replay-corpus-invalid-snapshot-"));
  const snapshot = createSnapshot();
  const { decision: _decision, ...snapshotWithoutDecision } = snapshot;

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
  await writeJson(
    path.join(corpusRoot, "cases", "review-blocked", "input", "snapshot.json"),
    snapshotWithoutDecision,
  );
  await writeJson(path.join(corpusRoot, "cases", "review-blocked", "expected", "replay-result.json"), {
    nextState: "blocked",
    shouldRunCodex: false,
    blockedReason: "manual_review",
    failureSignature: "stalled-bot:thread-1",
  });

  await assert.rejects(
    () => loadReplayCorpus(corpusRoot),
    /Replay corpus case "review-blocked" input snapshot decision must be an object/,
  );
});

test("loadReplayCorpus loads the checked-in safety case bundles", async () => {
  const corpus = await loadReplayCorpus(path.join(process.cwd(), "replay-corpus"));

  assert.deepEqual(corpus.cases.map((bundle) => bundle.id), [
    "review-blocked",
    "provider-wait-initial-grace",
    "provider-wait-settled-after-observation",
    "review-timing-ready-for-review-after-draft-skip",
    "required-check-pending",
    "stale-head-prevents-merge",
    "timeout-retry-budget-progression",
    "verification-blocker-retry-exhausted",
    "repeated-failure-escalates-to-failed",
  ]);
  assert.deepEqual(
    corpus.cases.map((bundle) => ({
      id: bundle.id,
      nextState: bundle.expected.nextState,
      blockedReason: bundle.expected.blockedReason,
      failureSignature: bundle.expected.failureSignature,
    })),
    [
      {
        id: "review-blocked",
        nextState: "blocked",
        blockedReason: "manual_review",
        failureSignature: "stalled-bot:thread-1",
      },
      {
        id: "provider-wait-initial-grace",
        nextState: "waiting_ci",
        blockedReason: null,
        failureSignature: null,
      },
      {
        id: "provider-wait-settled-after-observation",
        nextState: "waiting_ci",
        blockedReason: null,
        failureSignature: null,
      },
      {
        id: "review-timing-ready-for-review-after-draft-skip",
        nextState: "waiting_ci",
        blockedReason: null,
        failureSignature: null,
      },
      {
        id: "required-check-pending",
        nextState: "waiting_ci",
        blockedReason: null,
        failureSignature: null,
      },
      {
        id: "stale-head-prevents-merge",
        nextState: "stabilizing",
        blockedReason: null,
        failureSignature: null,
      },
      {
        id: "timeout-retry-budget-progression",
        nextState: "stabilizing",
        blockedReason: null,
        failureSignature: null,
      },
      {
        id: "verification-blocker-retry-exhausted",
        nextState: "blocked",
        blockedReason: "verification",
        failureSignature: "verification:vitest",
      },
      {
        id: "repeated-failure-escalates-to-failed",
        nextState: "failed",
        blockedReason: null,
        failureSignature: "changes-requested:head-539",
      },
    ],
  );
});

test("deriveReplayCorpusPromotionWorthinessHints stays conservative for checked-in replay snapshots", async () => {
  const corpus = await loadReplayCorpus(path.join(process.cwd(), "replay-corpus"));
  const cases = new Map(corpus.cases.map((bundle) => [bundle.id, bundle]));

  assert.deepEqual(
    deriveReplayCorpusPromotionWorthinessHints(cases.get("stale-head-prevents-merge")!.input.snapshot).map(
      (hint) => hint.id,
    ),
    ["stale-head-safety"],
  );
  assert.deepEqual(
    deriveReplayCorpusPromotionWorthinessHints(cases.get("provider-wait-initial-grace")!.input.snapshot).map(
      (hint) => hint.id,
    ),
    ["provider-wait"],
  );
  assert.deepEqual(
    deriveReplayCorpusPromotionWorthinessHints(cases.get("repeated-failure-escalates-to-failed")!.input.snapshot).map(
      (hint) => hint.id,
    ),
    ["retry-escalation"],
  );
  assert.deepEqual(
    deriveReplayCorpusPromotionWorthinessHints(cases.get("required-check-pending")!.input.snapshot),
    [],
  );
});

test("runReplayCorpus replays the checked-in PR lifecycle safety cases without mismatches", async () => {
  const result = await runReplayCorpus(
    path.join(process.cwd(), "replay-corpus"),
    createCheckedInReplayCorpusConfig(process.cwd()),
  );

  assert.equal(result.mismatchCount, 0);
  assert.deepEqual(result.results.map((entry) => entry.caseId), [
    "review-blocked",
    "provider-wait-initial-grace",
    "provider-wait-settled-after-observation",
    "review-timing-ready-for-review-after-draft-skip",
    "required-check-pending",
    "stale-head-prevents-merge",
    "timeout-retry-budget-progression",
    "verification-blocker-retry-exhausted",
    "repeated-failure-escalates-to-failed",
  ]);
});

test("syncReplayCorpusMismatchDetailsArtifact writes deterministic details for failures and removes stale success artifacts", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "replay-corpus-mismatch-details-"));
  const config = createCheckedInReplayCorpusConfig(tempDir);
  const artifactPath = path.join(tempDir, ".codex-supervisor", "replay", "replay-corpus-mismatch-details.json");
  const result = {
    rootPath: path.join(tempDir, "replay-corpus"),
    manifestPath: path.join(tempDir, "replay-corpus", "manifest.json"),
    totalCases: 2,
    mismatchCount: 1,
    results: [
      {
        caseId: "review-blocked",
        issueNumber: 532,
        bundlePath: path.join(tempDir, "replay-corpus", "cases", "review-blocked"),
        expected: {
          nextState: "ready_to_merge",
          shouldRunCodex: true,
          blockedReason: null,
          failureSignature: null,
        },
        actual: {
          nextState: "blocked",
          shouldRunCodex: false,
          blockedReason: "manual_review",
          failureSignature: "stalled-bot:thread-1",
        },
        matchesExpected: false,
      },
      {
        caseId: "review-pass",
        issueNumber: 533,
        bundlePath: path.join(tempDir, "replay-corpus", "cases", "review-pass"),
        expected: {
          nextState: "reproducing",
          shouldRunCodex: true,
          blockedReason: null,
          failureSignature: null,
        },
        actual: {
          nextState: "reproducing",
          shouldRunCodex: true,
          blockedReason: null,
          failureSignature: null,
        },
        matchesExpected: true,
      },
    ],
  };

  const firstContext = await syncReplayCorpusMismatchDetailsArtifact(result, config);
  assert.equal(firstContext?.artifactPath, artifactPath);
  assert.deepEqual(
    JSON.parse(await fs.readFile(artifactPath, "utf8")),
    formatReplayCorpusMismatchDetailsArtifact(result, config),
  );

  const beforeRepeat = await fs.readFile(artifactPath, "utf8");
  const secondContext = await syncReplayCorpusMismatchDetailsArtifact(result, config);
  assert.equal(secondContext?.artifactPath, artifactPath);
  assert.equal(await fs.readFile(artifactPath, "utf8"), beforeRepeat);

  const successContext = await syncReplayCorpusMismatchDetailsArtifact(
    {
      ...result,
      mismatchCount: 0,
      results: result.results.map((entry) => ({
        ...entry,
        actual: entry.expected,
        matchesExpected: true,
      })),
    },
    config,
  );
  assert.equal(successContext, null);
  await assert.rejects(() => fs.readFile(artifactPath, "utf8"), { code: "ENOENT" });
});

test("promoteCapturedReplaySnapshot writes a normalized canonical bundle that replays immediately", async () => {
  const corpusRoot = await fs.mkdtemp(path.join(os.tmpdir(), "replay-corpus-promotion-"));
  const existingSnapshot = createSnapshot();
  const capturedSnapshot = createSnapshot({
    capturedAt: "2026-03-18T08:59:03.959Z",
    issue: createIssue({
      number: 534,
      title: "Replay corpus: promote captured replay snapshots into canonical corpus cases",
      url: "https://example.test/issues/534",
      updatedAt: "2026-03-18T07:27:52Z",
    }),
    record: createRecord({
      issue_number: 534,
      state: "planning",
      branch: "codex/issue-534",
      pr_number: null,
      workspace: "/home/tommy/Dev/codex-supervisor-self-worktrees/issue-534",
      journal_path: "/home/tommy/Dev/codex-supervisor-self-worktrees/issue-534/.codex-supervisor/issue-journal.md",
      attempt_count: 0,
      implementation_attempt_count: 0,
      repair_attempt_count: 0,
      blocked_reason: null,
      last_error: null,
      last_failure_signature: null,
      last_head_sha: "87ca4ee5b6dbbae4e8fb45bc2f47bc7d3ab6f5d7",
      review_wait_started_at: null,
      review_wait_head_sha: null,
      local_review_head_sha: null,
      local_review_blocker_summary: null,
      local_review_summary_path: "/tmp/reviews/promoted-summary.md",
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
      processed_review_thread_ids: [],
      processed_review_thread_fingerprints: [],
      updated_at: "2026-03-18T08:59:03.090Z",
    }),
    workspaceStatus: createWorkspaceStatus({
      branch: "codex/issue-534",
      headSha: "87ca4ee5b6dbbae4e8fb45bc2f47bc7d3ab6f5d7",
      hasUncommittedChanges: true,
      baseAhead: 0,
      remoteBranchExists: false,
    }),
    pr: null,
    checks: [],
    reviewThreads: [],
  });
  const capturedSnapshotPath = path.join(corpusRoot, "captured-snapshot.json");

  await writeJson(path.join(corpusRoot, "manifest.json"), {
    schemaVersion: 1,
    cases: [{ id: "review-blocked", path: "cases/review-blocked" }],
  });
  await writeJson(path.join(corpusRoot, "cases", "review-blocked", "case.json"), {
    schemaVersion: 1,
    id: "review-blocked",
    issueNumber: existingSnapshot.issue.number,
    title: existingSnapshot.issue.title,
    capturedAt: existingSnapshot.capturedAt,
  });
  await writeJson(path.join(corpusRoot, "cases", "review-blocked", "input", "snapshot.json"), existingSnapshot);
  await writeJson(path.join(corpusRoot, "cases", "review-blocked", "expected", "replay-result.json"), {
    nextState: existingSnapshot.decision.nextState,
    shouldRunCodex: existingSnapshot.decision.shouldRunCodex,
    blockedReason: existingSnapshot.decision.blockedReason,
    failureSignature: existingSnapshot.decision.failureContext?.signature ?? null,
  });
  await writeJson(capturedSnapshotPath, capturedSnapshot);

  const promoted = await promoteCapturedReplaySnapshot({
    corpusRoot,
    snapshotPath: capturedSnapshotPath,
    caseId: "issue-534-reproducing",
    config: createConfig(),
  });

  assert.equal(promoted.id, "issue-534-reproducing");
  assert.equal(promoted.metadata.issueNumber, 534);
  assert.equal(promoted.input.snapshot.local.record.workspace, ".");
  assert.equal(promoted.input.snapshot.local.record.journal_path, ".codex-supervisor/issue-journal.md");
  assert.equal(promoted.input.snapshot.local.record.local_review_summary_path, null);
  assert.equal(promoted.input.snapshot.local.workspaceStatus.hasUncommittedChanges, false);
  assert.deepEqual(promoted.expected, {
    nextState: "reproducing",
    shouldRunCodex: true,
    blockedReason: null,
    failureSignature: null,
  });

  const corpus = await loadReplayCorpus(corpusRoot);
  assert.deepEqual(corpus.cases.map((bundle) => bundle.id), ["review-blocked", "issue-534-reproducing"]);

  const promotedExpected = JSON.parse(
    await fs.readFile(path.join(corpusRoot, "cases", "issue-534-reproducing", "expected", "replay-result.json"), "utf8"),
  );
  assert.deepEqual(Object.keys(promotedExpected), [
    "nextState",
    "shouldRunCodex",
    "blockedReason",
    "failureSignature",
  ]);
  assert.deepEqual(promotedExpected, promoted.expected);

  const runResult = await runReplayCorpus(corpusRoot, createConfig());
  assert.equal(runResult.mismatchCount, 0);
});

test("suggestReplayCorpusCaseIds returns deterministic normalized candidates", () => {
  const snapshot = createSnapshot({
    issue: createIssue({
      number: 557,
      title: "Replay corpus promotion: suggest normalized case ids during promotion",
    }),
    record: createRecord({
      issue_number: 557,
      state: "planning",
    }),
    pr: null,
    checks: [],
    reviewThreads: [],
  });
  snapshot.decision.nextState = "reproducing";

  const suggestions = suggestReplayCorpusCaseIds(snapshot);

  assert.deepEqual(suggestions, [
    "issue-557-reproducing",
    "issue-557-replay-corpus-promotion-suggest-normalized-case",
  ]);
});

test("promoteCapturedReplaySnapshot rejects an invalid existing corpus before writing a new case", async () => {
  const corpusRoot = await fs.mkdtemp(path.join(os.tmpdir(), "replay-corpus-promotion-invalid-"));
  const existingSnapshot = createSnapshot();
  const capturedSnapshot = createSnapshot({
    issue: createIssue({
      number: 534,
      title: "Replay corpus: promote captured replay snapshots into canonical corpus cases",
      url: "https://example.test/issues/534",
    }),
    record: createRecord({
      issue_number: 534,
      branch: "codex/issue-534",
      pr_number: null,
      workspace: "/home/tommy/Dev/codex-supervisor-self-worktrees/issue-534",
      journal_path: "/home/tommy/Dev/codex-supervisor-self-worktrees/issue-534/.codex-supervisor/issue-journal.md",
      local_review_summary_path: "/tmp/reviews/promoted-summary.md",
    }),
    pr: null,
    checks: [],
    reviewThreads: [],
  });
  const capturedSnapshotPath = path.join(corpusRoot, "captured-snapshot.json");

  await writeJson(path.join(corpusRoot, "manifest.json"), {
    schemaVersion: 1,
    cases: [{ id: "review-blocked", path: "cases/review-blocked" }],
  });
  await writeJson(path.join(corpusRoot, "cases", "review-blocked", "case.json"), {
    schemaVersion: 1,
    id: "review-blocked",
    issueNumber: existingSnapshot.issue.number,
    title: existingSnapshot.issue.title,
    capturedAt: existingSnapshot.capturedAt,
  });
  await writeJson(path.join(corpusRoot, "cases", "review-blocked", "input", "snapshot.json"), existingSnapshot);
  await writeJson(capturedSnapshotPath, capturedSnapshot);

  const missingReplayResultPath = path.join(
    corpusRoot,
    "cases",
    "review-blocked",
    "expected",
    "replay-result.json",
  );
  await assert.rejects(
    () =>
      promoteCapturedReplaySnapshot({
        corpusRoot,
        snapshotPath: capturedSnapshotPath,
        caseId: "issue-534-reproducing",
        config: createConfig(),
      }),
    (error) => error instanceof Error && error.message.includes(`Missing required replay corpus file: ${missingReplayResultPath}`),
  );

  await assert.rejects(
    () => fs.access(path.join(corpusRoot, "cases", "issue-534-reproducing", "case.json")),
    (error) => (error as NodeJS.ErrnoException).code === "ENOENT",
  );

  const manifest = JSON.parse(await fs.readFile(path.join(corpusRoot, "manifest.json"), "utf8"));
  assert.deepEqual(manifest.cases, [{ id: "review-blocked", path: "cases/review-blocked" }]);
});

test("runReplayCorpus replays multiple cases in manifest order and reports normalized outcomes", async () => {
  const corpusRoot = await fs.mkdtemp(path.join(os.tmpdir(), "replay-corpus-runner-"));
  const firstSnapshot = createSnapshot();
  const secondSnapshot = createSnapshot({
    record: createRecord({
      issue_number: 533,
      state: "waiting_ci",
      branch: "codex/issue-533",
      pr_number: 91,
      workspace: "/tmp/workspaces/issue-533",
      journal_path: "/tmp/workspaces/issue-533/.codex-supervisor/issue-journal.md",
      review_wait_started_at: "2026-03-16T11:00:00Z",
      review_wait_head_sha: "head-533",
      local_review_head_sha: "head-533",
      updated_at: "2026-03-16T11:05:00Z",
    }),
    issue: createIssue({
      number: 533,
      title: "Replay corpus waiting-ci example",
      url: "https://example.test/issues/533",
      updatedAt: "2026-03-16T11:05:00Z",
    }),
    pr: createPr({
      number: 91,
      title: "Replay corpus waiting-ci example",
      url: "https://example.test/pull/91",
      headRefName: "codex/issue-533",
      headRefOid: "head-533",
      reviewDecision: "APPROVED",
      mergeStateStatus: "CLEAN",
      configuredBotTopLevelReviewStrength: "blocking",
      updatedAt: "2026-03-16T11:06:00Z",
    }),
    workspaceStatus: createWorkspaceStatus({
      branch: "codex/issue-533",
      headSha: "head-533",
    }),
    reviewThreads: [],
  });

  const caseDefinitions = [
    {
      id: "review-blocked",
      snapshot: firstSnapshot,
      expected: {
        nextState: firstSnapshot.decision.nextState,
        shouldRunCodex: firstSnapshot.decision.shouldRunCodex,
        blockedReason: firstSnapshot.decision.blockedReason,
        failureSignature: firstSnapshot.decision.failureContext?.signature ?? null,
      },
    },
    {
      id: "waiting-ci",
      snapshot: secondSnapshot,
      expected: {
        nextState: secondSnapshot.decision.nextState,
        shouldRunCodex: secondSnapshot.decision.shouldRunCodex,
        blockedReason: secondSnapshot.decision.blockedReason,
        failureSignature: secondSnapshot.decision.failureContext?.signature ?? null,
      },
    },
  ];

  await writeJson(path.join(corpusRoot, "manifest.json"), {
    schemaVersion: 1,
    cases: caseDefinitions.map(({ id }) => ({ id, path: `cases/${id}` })),
  });

  for (const { id, snapshot, expected } of caseDefinitions) {
    await writeJson(path.join(corpusRoot, "cases", id, "case.json"), {
      schemaVersion: 1,
      id,
      issueNumber: snapshot.issue.number,
      title: snapshot.issue.title,
      capturedAt: snapshot.capturedAt,
    });
    await writeJson(path.join(corpusRoot, "cases", id, "input", "snapshot.json"), snapshot);
    await writeJson(path.join(corpusRoot, "cases", id, "expected", "replay-result.json"), expected);
  }

  const result = await runReplayCorpus(corpusRoot, createConfig());

  assert.equal(result.totalCases, 2);
  assert.equal(result.mismatchCount, 0);
  assert.deepEqual(result.results.map((entry) => entry.caseId), ["review-blocked", "waiting-ci"]);
  assert.deepEqual(
    result.results.map((entry) => entry.actual),
    caseDefinitions.map(({ expected }) => expected),
  );
});

test("formatReplayCorpusOutcomeMismatch renders deterministic expected-versus-actual output", async () => {
  const corpusRoot = await fs.mkdtemp(path.join(os.tmpdir(), "replay-corpus-mismatch-"));
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
  await writeJson(path.join(corpusRoot, "cases", "review-blocked", "expected", "replay-result.json"), {
    nextState: "ready_to_merge",
    shouldRunCodex: true,
    blockedReason: null,
    failureSignature: null,
  });

  const result = await runReplayCorpus(corpusRoot, createConfig());

  assert.equal(result.mismatchCount, 1);
  assert.equal(
    formatReplayCorpusOutcomeMismatch(result.results[0]!),
    [
      'Replay corpus mismatch for case "review-blocked" (issue #532)',
      "  expected.nextState=ready_to_merge",
      "  actual.nextState=blocked",
      "  expected.shouldRunCodex=true",
      "  actual.shouldRunCodex=false",
      "  expected.blockedReason=none",
      "  actual.blockedReason=manual_review",
      "  expected.failureSignature=none",
      "  actual.failureSignature=stalled-bot:thread-1",
    ].join("\n"),
  );
});

test("formatReplayCorpusMismatchSummaryLine renders one normalized compact line", async () => {
  const corpusRoot = await fs.mkdtemp(path.join(os.tmpdir(), "replay-corpus-mismatch-summary-"));
  const snapshot = createSnapshot();

  await writeJson(path.join(corpusRoot, "manifest.json"), {
    schemaVersion: 1,
    cases: [{ id: "review-blocked", path: "cases/review-blocked" }],
  });
  await writeJson(path.join(corpusRoot, "cases", "review-blocked", "case.json"), {
    schemaVersion: 1,
    id: "review-blocked",
    issueNumber: snapshot.issue.number,
    title: snapshot.issue.title,
    capturedAt: snapshot.capturedAt,
  });
  await writeJson(path.join(corpusRoot, "cases", "review-blocked", "input", "snapshot.json"), snapshot);
  await writeJson(path.join(corpusRoot, "cases", "review-blocked", "expected", "replay-result.json"), {
    nextState: "ready_to_merge",
    shouldRunCodex: true,
    blockedReason: null,
    failureSignature: null,
  });

  const result = await runReplayCorpus(corpusRoot, createConfig());

  assert.equal(
    formatReplayCorpusMismatchSummaryLine(result.results[0]!),
    "Mismatch: review-blocked (issue #532) expected(nextState=ready_to_merge, shouldRunCodex=true, blockedReason=none, failureSignature=none) actual(nextState=blocked, shouldRunCodex=false, blockedReason=manual_review, failureSignature=stalled-bot:thread-1)",
  );
});

test("formatReplayCorpusRunSummary reports pass and fail counts compactly", async () => {
  const corpusRoot = await fs.mkdtemp(path.join(os.tmpdir(), "replay-corpus-summary-"));
  const firstSnapshot = createSnapshot({
    issue: createIssue({
      number: 540,
      title: "Replay pass example",
      url: "https://example.test/issues/540",
    }),
    record: createRecord({
      issue_number: 540,
      branch: "codex/issue-540",
      pr_number: null,
      state: "reproducing",
      review_wait_started_at: null,
      review_wait_head_sha: null,
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
      last_local_review_signature: null,
      repeated_local_review_signature_count: 0,
      last_error: null,
      last_failure_signature: null,
      processed_review_thread_ids: [],
      processed_review_thread_fingerprints: [],
    }),
    pr: null,
    reviewThreads: [],
  });
  const secondSnapshot = createSnapshot();

  await writeJson(path.join(corpusRoot, "manifest.json"), {
    schemaVersion: 1,
    cases: [
      { id: "all-pass", path: "cases/all-pass" },
      { id: "review-blocked", path: "cases/review-blocked" },
    ],
  });

  await writeJson(path.join(corpusRoot, "cases", "all-pass", "case.json"), {
    schemaVersion: 1,
    id: "all-pass",
    issueNumber: firstSnapshot.issue.number,
    title: firstSnapshot.issue.title,
    capturedAt: firstSnapshot.capturedAt,
  });
  await writeJson(path.join(corpusRoot, "cases", "all-pass", "input", "snapshot.json"), firstSnapshot);
  await writeJson(path.join(corpusRoot, "cases", "all-pass", "expected", "replay-result.json"), {
    nextState: firstSnapshot.decision.nextState,
    shouldRunCodex: firstSnapshot.decision.shouldRunCodex,
    blockedReason: firstSnapshot.decision.blockedReason,
    failureSignature: firstSnapshot.decision.failureContext?.signature ?? null,
  });

  await writeJson(path.join(corpusRoot, "cases", "review-blocked", "case.json"), {
    schemaVersion: 1,
    id: "review-blocked",
    issueNumber: secondSnapshot.issue.number,
    title: secondSnapshot.issue.title,
    capturedAt: secondSnapshot.capturedAt,
  });
  await writeJson(path.join(corpusRoot, "cases", "review-blocked", "input", "snapshot.json"), secondSnapshot);
  await writeJson(path.join(corpusRoot, "cases", "review-blocked", "expected", "replay-result.json"), {
    nextState: "ready_to_merge",
    shouldRunCodex: true,
    blockedReason: null,
    failureSignature: null,
  });

  const result = await runReplayCorpus(corpusRoot, createConfig());

  assert.equal(
    formatReplayCorpusRunSummary(result),
    [
      "Replay corpus summary: total=2 passed=1 failed=1",
      "Mismatch: review-blocked (issue #532) expected(nextState=ready_to_merge, shouldRunCodex=true, blockedReason=none, failureSignature=none) actual(nextState=blocked, shouldRunCodex=false, blockedReason=manual_review, failureSignature=stalled-bot:thread-1)",
    ].join("\n"),
  );
});
