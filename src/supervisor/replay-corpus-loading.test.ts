import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { buildSupervisorCycleDecisionSnapshot } from "./supervisor-cycle-snapshot";
import {
  loadReplayCorpusCaseBundle,
  loadReplayCorpusManifest,
  loadReplayCorpusManifestOrDefault,
} from "./replay-corpus-loading";
import { validateReplayCorpusInputSnapshot } from "./replay-corpus-validation";
import type {
  ReplayCorpusExpectedReplayResult,
  ReplayCorpusInputSnapshot,
  ReplayCorpusManifestEntry,
} from "./replay-corpus-model";
import type {
  GitHubIssue,
  GitHubPullRequest,
  IssueRunRecord,
  ReviewThread,
  SupervisorConfig,
  WorkspaceStatus,
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
} = {}): ReplayCorpusInputSnapshot {
  return buildSupervisorCycleDecisionSnapshot({
    config: args.config ?? createConfig(),
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

function createExpectedReplay(snapshot: ReplayCorpusInputSnapshot): ReplayCorpusExpectedReplayResult {
  return {
    nextState: snapshot.decision.nextState,
    shouldRunCodex: snapshot.decision.shouldRunCodex,
    blockedReason: snapshot.decision.blockedReason,
    failureSignature: snapshot.decision.failureContext?.signature ?? null,
  };
}

test("replay corpus loading helpers load canonical manifest entries and case bundles", async () => {
  const corpusRoot = await fs.mkdtemp(path.join(os.tmpdir(), "replay-corpus-loading-"));
  const snapshot = createSnapshot();
  const entry: ReplayCorpusManifestEntry = { id: "review-blocked", path: "cases/review-blocked" };

  await writeJson(path.join(corpusRoot, "manifest.json"), {
    schemaVersion: 1,
    cases: [entry],
  });
  await writeJson(path.join(corpusRoot, entry.path, "case.json"), {
    schemaVersion: 1,
    id: entry.id,
    issueNumber: snapshot.issue.number,
    title: snapshot.issue.title,
    capturedAt: snapshot.capturedAt,
  });
  await writeJson(path.join(corpusRoot, entry.path, "input", "snapshot.json"), snapshot);
  await writeJson(path.join(corpusRoot, entry.path, "expected", "replay-result.json"), createExpectedReplay(snapshot));

  const manifest = await loadReplayCorpusManifest(corpusRoot);
  const bundle = await loadReplayCorpusCaseBundle(corpusRoot, manifest.cases[0]!);

  assert.deepEqual(manifest.cases, [entry]);
  assert.equal(bundle.id, entry.id);
  assert.equal(bundle.bundlePath, path.join(corpusRoot, entry.path));
  assert.equal(bundle.metadata.issueNumber, snapshot.issue.number);
  assert.equal(bundle.input.snapshot.issue.title, snapshot.issue.title);
  assert.deepEqual(bundle.expected, createExpectedReplay(snapshot));
});

test("replay corpus loading helpers return an empty default manifest when the corpus is new", async () => {
  const corpusRoot = await fs.mkdtemp(path.join(os.tmpdir(), "replay-corpus-empty-"));

  const manifest = await loadReplayCorpusManifestOrDefault(corpusRoot);

  assert.deepEqual(manifest, { schemaVersion: 1, cases: [] });
});

test("replay corpus validation preserves snapshot validation errors for missing replay-required objects", () => {
  const snapshot = createSnapshot();
  const { decision: _decision, ...snapshotWithoutDecision } = snapshot;

  assert.throws(
    () => validateReplayCorpusInputSnapshot(snapshotWithoutDecision, "review-blocked"),
    /Replay corpus case "review-blocked" input snapshot decision must be an object/,
  );
});
