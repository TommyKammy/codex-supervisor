import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { hasProcessedReviewThread } from "./review-handling";
import { executeCodexTurnPhase } from "./run-once-turn-execution";
import { handlePostTurnPullRequestTransitionsPhase } from "./post-turn-pull-request";
import {
  FailureContext,
  GitHubIssue,
  GitHubPullRequest,
  IssueRunRecord,
  PullRequestCheck,
  ReviewThread,
  SupervisorConfig,
  SupervisorStateFile,
} from "./types";

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
    issue_number: 102,
    state: "stabilizing",
    branch: "codex/issue-102",
    pr_number: 116,
    workspace: "/tmp/workspaces/issue-102",
    journal_path: "/tmp/workspaces/issue-102/.codex-supervisor/issue-journal.md",
    review_wait_started_at: null,
    review_wait_head_sha: null,
    copilot_review_requested_observed_at: null,
    copilot_review_requested_head_sha: null,
    copilot_review_timed_out_at: null,
    copilot_review_timeout_action: null,
    copilot_review_timeout_reason: null,
    codex_session_id: null,
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
    attempt_count: 1,
    implementation_attempt_count: 1,
    repair_attempt_count: 0,
    timeout_retry_count: 0,
    blocked_verification_retry_count: 0,
    repeated_blocker_count: 0,
    repeated_failure_signature_count: 0,
    last_head_sha: "head-116",
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
    updated_at: "2026-03-13T06:20:00Z",
    ...overrides,
  };
}

function createFailureContext(summary: string): FailureContext {
  return {
    category: "blocked",
    summary,
    signature: summary,
    command: null,
    details: [],
    url: null,
    updated_at: "2026-03-13T06:20:00Z",
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
          createdAt: "2026-03-13T06:20:00Z",
          url: "https://example.test/pr/116#discussion_r1",
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

test("hasProcessedReviewThread matches head-scoped processed thread ids", () => {
  assert.equal(
    hasProcessedReviewThread(
      createRecord({
        last_head_sha: "head-a",
        processed_review_thread_ids: ["thread-1@head-b"],
        processed_review_thread_fingerprints: ["thread-1@head-b#comment-1"],
      }),
      { headRefOid: "head-b" },
      createReviewThread(),
    ),
    true,
  );
});

test("hasProcessedReviewThread treats a same-head thread with a fresh latest comment as reprocessable once", () => {
  assert.equal(
    hasProcessedReviewThread(
      createRecord({
        last_head_sha: "head-a",
        processed_review_thread_ids: ["thread-1@head-a"],
        processed_review_thread_fingerprints: ["thread-1@head-a#comment-1"],
      }),
      { headRefOid: "head-a" },
      createReviewThread({
        comments: {
          nodes: [
            {
              id: "comment-1",
              body: "Please address this.",
              createdAt: "2026-03-13T06:20:00Z",
              url: "https://example.test/pr/116#discussion_r1",
              author: {
                login: "copilot-pull-request-reviewer",
                typeName: "Bot",
              },
            },
            {
              id: "comment-2",
              body: "Please also handle this update.",
              createdAt: "2026-03-13T06:25:00Z",
              url: "https://example.test/pr/116#discussion_r2",
              author: {
                login: "copilot-pull-request-reviewer",
                typeName: "Bot",
              },
            },
          ],
        },
      }),
    ),
    false,
  );
});

test("hasProcessedReviewThread ignores unrelated same-head fingerprints when deciding whether a thread is already processed", () => {
  assert.equal(
    hasProcessedReviewThread(
      createRecord({
        last_head_sha: "head-a",
        processed_review_thread_ids: ["thread-1@head-a"],
        processed_review_thread_fingerprints: ["thread-2@head-a#comment-9"],
      }),
      { headRefOid: "head-a" },
      createReviewThread(),
    ),
    true,
  );
});

test("handlePostTurnPullRequestTransitionsPhase refreshes PR state after marking ready", async () => {
  const config = createConfig();
  const issue: GitHubIssue = {
    number: 102,
    title: "Refresh post-ready PR state",
    body: "",
    createdAt: "2026-03-13T00:00:00Z",
    updatedAt: "2026-03-13T00:00:00Z",
    url: "https://example.test/issues/102",
    state: "OPEN",
  };
  const draftPr: GitHubPullRequest = {
    number: 116,
    title: "Refresh after ready",
    url: "https://example.test/pr/116",
    state: "OPEN",
    createdAt: "2026-03-13T06:20:00Z",
    isDraft: true,
    reviewDecision: null,
    mergeStateStatus: "CLEAN",
    mergeable: "MERGEABLE",
    headRefName: "codex/issue-102",
    headRefOid: "head-116",
    mergedAt: null,
    copilotReviewState: "not_requested",
    copilotReviewRequestedAt: null,
    copilotReviewArrivedAt: null,
  };
  const readyPr: GitHubPullRequest = { ...draftPr, isDraft: false };
  const initialChecks: PullRequestCheck[] = [{ name: "build", state: "SUCCESS", bucket: "pass", workflow: "CI" }];
  const postReadyChecks: PullRequestCheck[] = [{ name: "build", state: "IN_PROGRESS", bucket: "pending", workflow: "CI" }];
  const state: SupervisorStateFile = {
    activeIssueNumber: 102,
    issues: { "102": createRecord({ last_head_sha: "head-115" }) },
  };

  let readyCalls = 0;
  let snapshotLoads = 0;
  let syncJournalCalls = 0;
  const result = await handlePostTurnPullRequestTransitionsPhase({
    config,
    stateStore: {
      touch: (record, patch) => ({ ...record, ...patch, updated_at: record.updated_at }),
      save: async () => undefined,
    },
    github: {
      getPullRequest: async () => {
        throw new Error("unexpected getPullRequest call");
      },
      getChecks: async () => {
        throw new Error("unexpected getChecks call");
      },
      getUnresolvedReviewThreads: async () => {
        throw new Error("unexpected getUnresolvedReviewThreads call");
      },
      markPullRequestReady: async (prNumber: number) => {
        assert.equal(prNumber, 116);
        readyCalls += 1;
      },
    },
    context: {
      state,
      record: state.issues["102"]!,
      issue,
      workspacePath: path.join("/tmp/workspaces", "issue-102"),
      syncJournal: async () => {
        syncJournalCalls += 1;
      },
      memoryArtifacts: {
        alwaysReadFiles: [],
        onDemandFiles: [],
        contextIndexPath: "/tmp/context-index.md",
        agentsPath: "/tmp/AGENTS.generated.md",
      },
      pr: draftPr,
      options: { dryRun: false },
    },
    derivePullRequestLifecycleSnapshot: (_record, pr, checks) => ({
      recordForState: _record,
      nextState: checks.some((check) => check.bucket === "pending") ? "waiting_ci" : "pr_open",
      failureContext: checks.some((check) => check.bucket === "pending")
        ? null
        : createFailureContext("unexpected failure"),
      reviewWaitPatch: { review_wait_started_at: "2026-03-13T06:26:22Z", review_wait_head_sha: pr.headRefOid },
      copilotRequestObservationPatch: {},
      copilotTimeoutPatch: {
        copilot_review_timed_out_at: null,
        copilot_review_timeout_action: null,
        copilot_review_timeout_reason: null,
      },
    }),
    applyFailureSignature: () => ({
      last_failure_signature: null,
      repeated_failure_signature_count: 0,
    }),
    blockedReasonFromReviewState: () => null,
    summarizeChecks: (checks) => ({
      hasPending: checks.some((check) => check.bucket === "pending"),
      hasFailing: checks.some((check) => check.bucket === "fail"),
    }),
    configuredBotReviewThreads: () => [],
    manualReviewThreads: () => [],
    mergeConflictDetected: () => false,
    loadOpenPullRequestSnapshot: async () => {
      snapshotLoads += 1;
      return snapshotLoads === 1
        ? { pr: draftPr, checks: initialChecks, reviewThreads: [] satisfies ReviewThread[] }
        : { pr: readyPr, checks: postReadyChecks, reviewThreads: [] satisfies ReviewThread[] };
    },
  });

  assert.equal(result.pr.isDraft, false);
  assert.equal(result.record.state, "waiting_ci");
  assert.equal(result.record.review_wait_head_sha, "head-116");
  assert.equal(result.record.last_head_sha, "head-116");
  assert.equal(readyCalls, 1);
  assert.equal(snapshotLoads, 2);
  assert.equal(syncJournalCalls, 0);
});

test("executeCodexTurnPhase persists blocked reason and repeated blocker bookkeeping from Codex hints", async () => {
  const config = createConfig();
  const issue: GitHubIssue = {
    number: 102,
    title: "Persist blocked Codex hints",
    body: "",
    createdAt: "2026-03-13T00:00:00Z",
    updatedAt: "2026-03-13T00:00:00Z",
    url: "https://example.test/issues/102",
    state: "OPEN",
  };
  const state: SupervisorStateFile = {
    activeIssueNumber: 102,
    issues: {
      "102": createRecord({
        state: "reproducing",
        repeated_blocker_count: 1,
        last_blocker_signature: "waiting on verification evidence failure signature: prior-check",
      }),
    },
  };
  let journalReads = 0;
  let syncJournalCalls = 0;
  const result = await executeCodexTurnPhase({
    config,
    stateStore: {
      touch: (record, patch) => ({ ...record, ...patch, updated_at: record.updated_at }),
      save: async () => undefined,
    },
    github: {
      resolvePullRequestForBranch: async () => {
        throw new Error("unexpected resolvePullRequestForBranch call");
      },
      createPullRequest: async () => {
        throw new Error("unexpected createPullRequest call");
      },
      getChecks: async () => {
        throw new Error("unexpected getChecks call");
      },
      getUnresolvedReviewThreads: async () => {
        throw new Error("unexpected getUnresolvedReviewThreads call");
      },
      getExternalReviewSurface: async () => {
        throw new Error("unexpected getExternalReviewSurface call");
      },
    },
    context: {
      state,
      record: state.issues["102"]!,
      issue,
      previousCodexSummary: null,
      previousError: null,
      workspacePath: path.join("/tmp/workspaces", "issue-102"),
      journalPath: path.join("/tmp/workspaces", "issue-102/.codex-supervisor/issue-journal.md"),
      syncJournal: async () => {
        syncJournalCalls += 1;
      },
      memoryArtifacts: {
        alwaysReadFiles: [],
        onDemandFiles: [],
        contextIndexPath: "/tmp/context-index.md",
        agentsPath: "/tmp/AGENTS.generated.md",
      },
      workspaceStatus: {
        branch: "codex/issue-102",
        headSha: "head-116",
        hasUncommittedChanges: false,
        baseAhead: 0,
        baseBehind: 0,
        remoteBranchExists: true,
        remoteAhead: 0,
        remoteBehind: 0,
      },
      pr: null,
      checks: [],
      reviewThreads: [],
      options: { dryRun: false },
    },
    acquireSessionLock: async () => null,
    classifyFailure: () => "command_error",
    buildCodexFailureContext: (category, summary, details) => ({
      category,
      summary,
      signature: `${category}:${summary}`,
      command: null,
      details,
      url: null,
      updated_at: "2026-03-13T06:20:00Z",
    }),
    applyFailureSignature: (record, failureContext) => ({
      last_failure_signature: failureContext?.signature ?? null,
      repeated_failure_signature_count:
        failureContext?.signature && record.last_failure_signature === failureContext.signature
          ? record.repeated_failure_signature_count + 1
          : failureContext?.signature
            ? 1
            : 0,
    }),
    normalizeBlockerSignature: (message) =>
      message
        ?.toLowerCase()
        .replace(/state hint:\s*[a-z_]+/i, "")
        .replace(/blocked reason:\s*[a-z_]+/i, "")
        .replace(/\s+/g, " ")
        .trim() ?? null,
    isVerificationBlockedMessage: (message) => (message ?? "").includes("verification"),
    derivePullRequestLifecycleSnapshot: () => {
      throw new Error("unexpected derivePullRequestLifecycleSnapshot call");
    },
    inferStateWithoutPullRequest: () => "stabilizing",
    blockedReasonFromReviewState: () => null,
    recoverUnexpectedCodexTurnFailure: async () => {
      throw new Error("unexpected recoverUnexpectedCodexTurnFailure call");
    },
    readIssueJournal: async () => {
      journalReads += 1;
      return journalReads === 1
        ? "## Codex Working Notes\n### Current Handoff\n- Hypothesis: reproduce the failure.\n"
        : [
            "## Codex Working Notes",
            "### Current Handoff",
            "- Hypothesis: reproduce the failure.",
            "- Current blocker: Waiting on verification evidence.",
            "- Next exact step: capture the missing verification output.",
          ].join("\n");
    },
    runCodexTurnImpl: async () => ({
      exitCode: 0,
      sessionId: "session-102",
      lastMessage: [
        "Waiting on verification evidence",
        "State hint: blocked",
        "Blocked reason: verification",
        "Failure signature: prior-check",
      ].join("\n"),
      stderr: "",
      stdout: "",
    }),
  });

  assert.deepEqual(result, {
    kind: "returned",
    message: "Codex reported blocked for issue #102.",
  });
  assert.equal(syncJournalCalls, 1);
  assert.equal(state.issues["102"]?.state, "blocked");
  assert.equal(state.issues["102"]?.blocked_reason, "verification");
  assert.equal(state.issues["102"]?.last_blocker_signature, "waiting on verification evidence failure signature: prior-check");
  assert.equal(state.issues["102"]?.repeated_blocker_count, 2);
  assert.equal(state.issues["102"]?.last_failure_signature, "prior-check");
  assert.equal(state.issues["102"]?.repeated_failure_signature_count, 1);
});

test("executeCodexTurnPhase loads local-review repair context before building the local_review_fix prompt", async () => {
  const workspaceDir = await fs.mkdtemp(path.join(os.tmpdir(), "turn-execution-local-review-fix-"));
  const reviewDir = path.join(workspaceDir, "reviews");
  const summaryPath = path.join(reviewDir, "head-deadbeef.md");
  const findingsPath = path.join(reviewDir, "head-deadbeef.json");
  let capturedPrompt = "";
  let journalReads = 0;

  await fs.mkdir(reviewDir, { recursive: true });
  await fs.writeFile(summaryPath, "# summary\n", "utf8");
  await fs.writeFile(
    findingsPath,
    JSON.stringify({
      actionableFindings: [{ file: "src/auth.ts" }],
      rootCauseSummaries: [
        {
          severity: "high",
          summary: "Permission guard retry path is fragile",
          file: "src/auth.ts",
          start: 40,
          end: 44,
        },
      ],
    }),
    "utf8",
  );

  const state: SupervisorStateFile = {
    activeIssueNumber: 102,
    issues: {
      "102": createRecord({
        state: "local_review_fix",
        local_review_summary_path: summaryPath,
        last_failure_context: createFailureContext("Active local-review blocker."),
      }),
    },
  };

  try {
    const result = await executeCodexTurnPhase({
      config: createConfig(),
      stateStore: {
        touch: (record, patch) => ({ ...record, ...patch, updated_at: record.updated_at }),
        save: async () => undefined,
      },
      github: {
        resolvePullRequestForBranch: async () => null,
        createPullRequest: async () => {
          throw new Error("unexpected createPullRequest call");
        },
        getChecks: async () => [],
        getUnresolvedReviewThreads: async () => [],
        getExternalReviewSurface: async () => {
          throw new Error("unexpected getExternalReviewSurface call");
        },
      },
      context: {
        state,
        record: state.issues["102"]!,
        issue: {
          number: 102,
          title: "Repair local review context loading",
          body: "",
          createdAt: "2026-03-13T00:00:00Z",
          updatedAt: "2026-03-13T00:00:00Z",
          url: "https://example.test/issues/102",
          state: "OPEN",
        },
        previousCodexSummary: null,
        previousError: null,
        workspacePath: workspaceDir,
        journalPath: path.join(workspaceDir, ".codex-supervisor", "issue-journal.md"),
        syncJournal: async () => undefined,
        memoryArtifacts: {
          contextIndexPath: path.join(workspaceDir, "context-index.md"),
          agentsPath: path.join(workspaceDir, "AGENTS.generated.md"),
          alwaysReadFiles: [],
          onDemandFiles: [],
        },
        workspaceStatus: {
          branch: "codex/issue-102",
          headSha: "head-116",
          hasUncommittedChanges: false,
          baseAhead: 0,
          baseBehind: 0,
          remoteBranchExists: true,
          remoteAhead: 0,
          remoteBehind: 0,
        },
        pr: null,
        checks: [],
        reviewThreads: [],
        options: { dryRun: false },
      },
      acquireSessionLock: async () => null,
      classifyFailure: () => "command_error",
      buildCodexFailureContext: (category, summary, details) => ({
        category,
        summary,
        signature: `${category}:${summary}`,
        command: null,
        details,
        url: null,
        updated_at: "2026-03-13T06:20:00Z",
      }),
      applyFailureSignature: (record, failureContext) => ({
        last_failure_signature: failureContext?.signature ?? null,
        repeated_failure_signature_count:
          failureContext?.signature && record.last_failure_signature === failureContext.signature
            ? record.repeated_failure_signature_count + 1
            : failureContext?.signature
              ? 1
              : 0,
      }),
      normalizeBlockerSignature: (message) => message?.trim() ?? null,
      isVerificationBlockedMessage: () => false,
      derivePullRequestLifecycleSnapshot: () => {
        throw new Error("unexpected derivePullRequestLifecycleSnapshot call");
      },
      inferStateWithoutPullRequest: () => "stabilizing",
      blockedReasonFromReviewState: () => null,
      recoverUnexpectedCodexTurnFailure: async () => {
        throw new Error("unexpected recoverUnexpectedCodexTurnFailure call");
      },
      readIssueJournal: async () => {
        journalReads += 1;
        return journalReads === 1
          ? [
              "## Codex Working Notes",
              "### Current Handoff",
              "- Hypothesis: local-review repair context should reach the prompt.",
            ].join("\n")
          : [
              "## Codex Working Notes",
              "### Current Handoff",
              "- Hypothesis: local-review repair context should reach the prompt.",
              "- Current blocker: Waiting on repair verification.",
              "- Next exact step: validate the permission guard path against the root-cause summary.",
            ].join("\n");
      },
      runCodexTurnImpl: async (_config, _workspacePath, prompt) => {
        capturedPrompt = prompt;
        return {
          exitCode: 0,
          sessionId: "session-102",
          lastMessage: [
            "Waiting on repair verification",
            "State hint: blocked",
            "Blocked reason: verification",
          ].join("\n"),
          stderr: "",
          stdout: "",
        };
      },
    });

    assert.deepEqual(result, {
      kind: "returned",
      message: "Codex reported blocked for issue #102.",
    });
    assert.match(capturedPrompt, /Active local-review repair context:/);
    assert.match(capturedPrompt, /Permission guard retry path is fragile/);
    assert.match(capturedPrompt, /file=src\/auth\.ts lines=40-44/);
  } finally {
    await fs.rm(workspaceDir, { recursive: true, force: true });
  }
});
