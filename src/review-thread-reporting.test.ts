import assert from "node:assert/strict";
import test from "node:test";
import { configuredBotReviewThreads, manualReviewThreads } from "./supervisor/supervisor-reporting";
import {
  buildCodexConnectorPolicyBlockDiagnostic,
  buildCodexConnectorP2P3PolicyDiagnostic,
  actionableBotReviewThreads,
  buildStalledBotReviewFailureContext,
  clusterConfiguredBotReviewThreads,
  codexConnectorMustFixReviewThreads,
  codexConnectorStaleReviewCommitThreads,
  configuredBotReviewFollowUpState,
  effectiveReviewThreadDiagnostics,
  evaluateCodexConnectorConvergencePolicy,
  staleConfiguredBotReviewThreads,
} from "./review-thread-reporting";
import { GitHubPullRequest, IssueRunRecord, ReviewThread, SupervisorConfig } from "./core/types";

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
          url: "https://example.test/pr/44#discussion_r1",
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

function createReviewRecord(
  overrides: Partial<
    Pick<
      IssueRunRecord,
      | "processed_review_thread_ids"
      | "processed_review_thread_fingerprints"
      | "last_head_sha"
      | "review_follow_up_head_sha"
      | "review_follow_up_remaining"
      | "last_tracked_pr_repeat_failure_decision"
    >
  > = {},
): Pick<
  IssueRunRecord,
  | "processed_review_thread_ids"
  | "processed_review_thread_fingerprints"
  | "last_head_sha"
  | "review_follow_up_head_sha"
  | "review_follow_up_remaining"
  | "last_tracked_pr_repeat_failure_decision"
> {
  return {
    processed_review_thread_ids: [],
    processed_review_thread_fingerprints: [],
    last_head_sha: "head123",
    review_follow_up_head_sha: null,
    review_follow_up_remaining: 0,
    last_tracked_pr_repeat_failure_decision: null,
    ...overrides,
  };
}

function createPr(overrides: Partial<Pick<GitHubPullRequest, "headRefOid">> = {}): Pick<GitHubPullRequest, "headRefOid"> {
  return {
    headRefOid: "head123",
    ...overrides,
  };
}

test("configuredBotReviewThreads normalizes configured bot logins before classifying threads", () => {
  const config = createConfig({
    reviewBotLogins: [" Copilot-Pull-Request-Reviewer "],
  });
  const thread = createReviewThread();

  assert.equal(configuredBotReviewThreads(config, [thread]).length, 1);
  assert.equal(manualReviewThreads(config, [thread]).length, 0);
});

test("effectiveReviewThreadDiagnostics separates raw configured-bot residue from effective blockers", () => {
  const config = createConfig({
    reviewBotLogins: ["chatgpt-codex-connector"],
  });
  const outdatedConfiguredBotThread = createReviewThread({
    id: "thread-outdated",
    isOutdated: true,
    comments: {
      nodes: [
        {
          id: "comment-outdated",
          body: "P1: stale concern from an old diff.",
          createdAt: "2026-05-15T00:05:00Z",
          url: "https://example.test/pr/183#discussion_r1",
          author: {
            login: "chatgpt-codex-connector",
            typeName: "Bot",
          },
        },
      ],
    },
  });
  const currentHeadConfiguredBotThread = createReviewThread({
    id: "thread-current",
    comments: {
      nodes: [
        {
          id: "comment-current",
          body: "P2: current-head concern.",
          createdAt: "2026-05-15T00:10:00Z",
          url: "https://example.test/pr/183#discussion_r2",
          author: {
            login: "chatgpt-codex-connector",
            typeName: "Bot",
          },
        },
      ],
    },
  });
  const humanThread = createReviewThread({
    id: "thread-human",
    comments: {
      nodes: [
        {
          id: "comment-human",
          body: "Please consider this.",
          createdAt: "2026-05-15T00:11:00Z",
          url: "https://example.test/pr/183#discussion_r3",
          author: {
            login: "octocat",
            typeName: "User",
          },
        },
      ],
    },
  });
  const resolvedConfiguredBotThread = createReviewThread({
    id: "thread-resolved",
    isResolved: true,
    comments: {
      nodes: [
        {
          id: "comment-resolved",
          body: "P3: already resolved.",
          createdAt: "2026-05-15T00:12:00Z",
          url: "https://example.test/pr/183#discussion_r4",
          author: {
            login: "chatgpt-codex-connector",
            typeName: "Bot",
          },
        },
      ],
    },
  });

  const diagnostics = effectiveReviewThreadDiagnostics(config, [
    outdatedConfiguredBotThread,
    currentHeadConfiguredBotThread,
    humanThread,
    resolvedConfiguredBotThread,
  ]);

  assert.equal(diagnostics.rawUnresolvedConfiguredBotThreadCount, 2);
  assert.equal(diagnostics.effectiveUnresolvedConfiguredBotThreadCount, 1);
  assert.deepEqual(
    diagnostics.threads.map((thread) => ({
      id: thread.id,
      classification: thread.classification,
      effective: thread.effectiveConfiguredBotBlocker,
    })),
    [
      { id: "thread-outdated", classification: "configured_bot_outdated", effective: false },
      { id: "thread-current", classification: "configured_bot_current_head", effective: true },
      { id: "thread-human", classification: "human_unresolved", effective: false },
      { id: "thread-resolved", classification: "configured_bot_resolved", effective: false },
    ],
  );
});

test("configuredBotReviewFollowUpState treats repeat-stop records as exhausted even if follow-up budget remains", () => {
  const config = createConfig({
    reviewBotLogins: ["copilot-pull-request-reviewer"],
  });
  const record = createReviewRecord({
    processed_review_thread_ids: ["thread-1@head123"],
    processed_review_thread_fingerprints: ["thread-1@head123#comment-1"],
    review_follow_up_head_sha: "head123",
    review_follow_up_remaining: 1,
    last_tracked_pr_repeat_failure_decision: "stop_no_progress",
  });
  const thread = createReviewThread();

  assert.equal(configuredBotReviewFollowUpState(config, record, createPr(), [thread]), "exhausted");
  assert.deepEqual(actionableBotReviewThreads(config, record, createPr(), [thread]), []);
});

test("staleConfiguredBotReviewThreads requires current-head processing evidence before classifying stale bot blockers", () => {
  const config = createConfig({
    reviewBotLogins: ["copilot-pull-request-reviewer"],
  });
  const pr: Pick<GitHubPullRequest, "headRefOid"> = { headRefOid: "head123" };
  const record: Pick<
    IssueRunRecord,
    | "processed_review_thread_ids"
    | "processed_review_thread_fingerprints"
    | "last_head_sha"
    | "review_follow_up_head_sha"
    | "review_follow_up_remaining"
  > = {
    processed_review_thread_ids: ["thread-1@head123"],
    processed_review_thread_fingerprints: ["thread-1@head123#comment-1"],
    last_head_sha: "head123",
    review_follow_up_head_sha: null,
    review_follow_up_remaining: 0,
  };
  const processedThread = createReviewThread();
  const unprocessedThread = createReviewThread({ id: "thread-2" });

  assert.deepEqual(staleConfiguredBotReviewThreads(config, record, pr, [processedThread]), [processedThread]);
  assert.deepEqual(staleConfiguredBotReviewThreads(config, record, pr, [unprocessedThread]), []);
});

test("staleConfiguredBotReviewThreads excludes same-head configured-bot threads whose latest comment is no longer actionable", () => {
  const config = createConfig({
    reviewBotLogins: ["copilot-pull-request-reviewer"],
  });
  const pr: Pick<GitHubPullRequest, "headRefOid"> = { headRefOid: "head123" };
  const record: Pick<
    IssueRunRecord,
    | "processed_review_thread_ids"
    | "processed_review_thread_fingerprints"
    | "last_head_sha"
    | "review_follow_up_head_sha"
    | "review_follow_up_remaining"
  > = {
    processed_review_thread_ids: ["thread-1@head123"],
    processed_review_thread_fingerprints: ["thread-1@head123#comment-1"],
    last_head_sha: "head123",
    review_follow_up_head_sha: null,
    review_follow_up_remaining: 0,
  };
  const nonActionableSameHeadThread = createReviewThread({
    comments: {
      nodes: [
        {
          id: "comment-1",
          body: "Please address this.",
          createdAt: "2026-03-11T00:00:00Z",
          url: "https://example.test/pr/44#discussion_r1",
          author: {
            login: "copilot-pull-request-reviewer",
            typeName: "Bot",
          },
        },
        {
          id: "comment-2",
          body: "Handled manually elsewhere.",
          createdAt: "2026-03-11T00:10:00Z",
          url: "https://example.test/pr/44#discussion_r2",
          author: {
            login: "octocat",
            typeName: "User",
          },
        },
      ],
    },
  });

  assert.deepEqual(staleConfiguredBotReviewThreads(config, record, pr, [nonActionableSameHeadThread]), []);
});

test("staleConfiguredBotReviewThreads treats non-actionable same-head configured-bot threads as stale when the current head has an explicit no-actionable configured-bot signal", () => {
  const config = createConfig({
    reviewBotLogins: ["copilot-pull-request-reviewer"],
  });
  const pr: Pick<
    GitHubPullRequest,
    "headRefOid" | "configuredBotCurrentHeadObservedAt" | "configuredBotCurrentHeadStatusState" | "configuredBotTopLevelReviewStrength"
  > = {
    headRefOid: "head123",
    configuredBotCurrentHeadObservedAt: "2026-03-11T00:15:00Z",
    configuredBotCurrentHeadStatusState: "SUCCESS",
    configuredBotTopLevelReviewStrength: null,
  };
  const record: Pick<
    IssueRunRecord,
    | "processed_review_thread_ids"
    | "processed_review_thread_fingerprints"
    | "last_head_sha"
    | "review_follow_up_head_sha"
    | "review_follow_up_remaining"
  > = {
    processed_review_thread_ids: ["thread-1@head123"],
    processed_review_thread_fingerprints: ["thread-1@head123#comment-1"],
    last_head_sha: "head123",
    review_follow_up_head_sha: null,
    review_follow_up_remaining: 0,
  };
  const nonActionableSameHeadThread = createReviewThread({
    comments: {
      nodes: [
        {
          id: "comment-1",
          body: "Please address this.",
          createdAt: "2026-03-11T00:00:00Z",
          url: "https://example.test/pr/44#discussion_r1",
          author: {
            login: "copilot-pull-request-reviewer",
            typeName: "Bot",
          },
        },
        {
          id: "comment-2",
          body: "Handled manually elsewhere.",
          createdAt: "2026-03-11T00:10:00Z",
          url: "https://example.test/pr/44#discussion_r2",
          author: {
            login: "octocat",
            typeName: "User",
          },
        },
      ],
    },
  });

  assert.deepEqual(staleConfiguredBotReviewThreads(config, record, pr, [nonActionableSameHeadThread]), [nonActionableSameHeadThread]);
});

test("codexConnectorMustFixReviewThreads tracks unresolved P1 findings and reports their severity", () => {
  const p1Thread = createReviewThread({
    comments: {
      nodes: [
        {
          id: "comment-1",
          body:
            "**<sub><sub>![P1 Badge](https://img.shields.io/badge/P1-orange?style=flat)</sub></sub> Restore test execution in pre-PR verification**",
          createdAt: "2026-03-11T00:00:00Z",
          url: "https://example.test/pr/44#discussion_r1",
          author: {
            login: "chatgpt-codex-connector[bot]",
            typeName: "Bot",
          },
        },
      ],
    },
  });

  assert.deepEqual(codexConnectorMustFixReviewThreads([p1Thread]), [p1Thread]);
  assert.match(buildStalledBotReviewFailureContext([p1Thread])?.details[0] ?? "", /p_severity=P1/);
});

test("codexConnectorStaleReviewCommitThreads compares current-head SHAs case-insensitively", () => {
  const config = createConfig({
    reviewBotLogins: ["chatgpt-codex-connector"],
  });
  const currentHeadSha = "c171be8a7f6e27d18eeef27cf27fd34c33371508";
  const p1Thread = createReviewThread({
    id: "thread-p1",
    comments: {
      nodes: [
        {
          id: "comment-p1",
          body: "P1: Keep the current-head authorization diagnostic active.",
          createdAt: "2026-03-11T00:00:00Z",
          url: "https://example.test/pr/44#discussion_r1",
          author: {
            login: "chatgpt-codex-connector",
            typeName: "Bot",
          },
        },
      ],
    },
  });
  const pr: Pick<GitHubPullRequest, "headRefOid" | "configuredBotCurrentHeadObservedAt" | "configuredBotLatestReviewedCommitSha"> = {
    headRefOid: currentHeadSha,
    configuredBotCurrentHeadObservedAt: null,
    configuredBotLatestReviewedCommitSha: currentHeadSha.toUpperCase(),
  };

  assert.deepEqual(codexConnectorStaleReviewCommitThreads(pr, [p1Thread]), []);
  assert.equal(buildCodexConnectorPolicyBlockDiagnostic(config, [p1Thread], pr)?.count, 1);
});

test("codexConnectorMustFixReviewThreads treats P2 and escalated P3 findings as must-fix", () => {
  const p2Thread = createReviewThread({
    id: "thread-p2",
    comments: {
      nodes: [
        {
          id: "comment-p2",
          body: "P2: Preserve failed restore cleanup as a blocking verification failure.",
          createdAt: "2026-03-11T00:00:00Z",
          url: "https://example.test/pr/44#discussion_r3",
          author: {
            login: "chatgpt-codex-connector",
            typeName: "Bot",
          },
        },
      ],
    },
  });
  const p3NitpickThread = createReviewThread({
    id: "thread-p3-softened",
    comments: {
      nodes: [
        {
          id: "comment-p3-softened",
          body: "P3: Nitpick: prefer a shorter helper name for readability.",
          createdAt: "2026-03-11T00:01:00Z",
          url: "https://example.test/pr/44#discussion_r4",
          author: {
            login: "chatgpt-codex-connector",
            typeName: "Bot",
          },
        },
      ],
    },
  });
  const p3RiskThread = createReviewThread({
    id: "thread-p3-escalated",
    comments: {
      nodes: [
        {
          id: "comment-p3-escalated",
          body: "P3: This cleanup can cause a regression in the restore failure path.",
          createdAt: "2026-03-11T00:02:00Z",
          url: "https://example.test/pr/44#discussion_r5",
          author: {
            login: "chatgpt-codex-connector",
            typeName: "Bot",
          },
        },
      ],
    },
  });

  assert.deepEqual(codexConnectorMustFixReviewThreads([p2Thread, p3NitpickThread, p3RiskThread]), [
    p2Thread,
    p3RiskThread,
  ]);
});

test("buildCodexConnectorPolicyBlockDiagnostic reports the highest-severity thread location", () => {
  const config = createConfig({
    reviewBotLogins: ["chatgpt-codex-connector"],
  });
  const p1Thread = createReviewThread({
    id: "thread-p1",
    path: "src/policy.ts",
    line: 12,
    comments: {
      nodes: [
        {
          id: "comment-p1",
          body: "P1: Tighten the diagnostic wording before merge.",
          createdAt: "2026-03-11T00:00:00Z",
          url: "https://example.test/pr/44#discussion_r1",
          author: {
            login: "chatgpt-codex-connector",
            typeName: "Bot",
          },
        },
      ],
    },
  });
  const p0Thread = createReviewThread({
    id: "thread-p0",
    path: "src/auth.ts",
    line: 24,
    comments: {
      nodes: [
        {
          id: "comment-p0",
          body: "P0: Keep the authorization bypass blocked.",
          createdAt: "2026-03-11T00:05:00Z",
          url: "https://example.test/pr/44#discussion_r2",
          author: {
            login: "chatgpt-codex-connector",
            typeName: "Bot",
          },
        },
      ],
    },
  });

  assert.deepEqual(buildCodexConnectorPolicyBlockDiagnostic(config, [p1Thread, p0Thread]), {
    count: 2,
    severity: "P0",
    file: "src/auth.ts",
    line: "24",
    threadUrl: "https://example.test/pr/44#discussion_r2",
    nextAction: "fix_on_new_head_or_wait_for_github_thread_resolution_or_use_explicit_manual_operator_path",
  });
});

test("buildCodexConnectorP2P3PolicyDiagnostic distinguishes actionable, softened, and escalated outcomes", () => {
  const config = createConfig({ reviewBotLogins: ["chatgpt-codex-connector"] });
  const p2Thread = createReviewThread({
    id: "thread-p2",
    comments: {
      nodes: [
        {
          id: "comment-p2",
          body: "P2: Repair the retry path before reporting verification success.",
          createdAt: "2026-03-11T00:00:00Z",
          url: "https://example.test/pr/44#discussion_r3",
          author: {
            login: "chatgpt-codex-connector",
            typeName: "Bot",
          },
        },
      ],
    },
  });
  const p3NitpickThread = createReviewThread({
    id: "thread-p3-softened",
    comments: {
      nodes: [
        {
          id: "comment-p3-softened",
          body: "P3: Nitpick: prefer a shorter helper name for readability.",
          createdAt: "2026-03-11T00:01:00Z",
          url: "https://example.test/pr/44#discussion_r4",
          author: {
            login: "chatgpt-codex-connector",
            typeName: "Bot",
          },
        },
      ],
    },
  });
  const p3RiskThread = createReviewThread({
    id: "thread-p3-escalated",
    comments: {
      nodes: [
        {
          id: "comment-p3-escalated",
          body: "P3: This cleanup can cause a regression in the restore failure path.",
          createdAt: "2026-03-11T00:02:00Z",
          url: "https://example.test/pr/44#discussion_r5",
          author: {
            login: "chatgpt-codex-connector",
            typeName: "Bot",
          },
        },
      ],
    },
  });

  assert.deepEqual(buildCodexConnectorP2P3PolicyDiagnostic(config, [p2Thread, p3NitpickThread, p3RiskThread]), {
    p2Actionable: 1,
    p3Softened: 1,
    p3Escalated: 1,
  });
});

test("clusterConfiguredBotReviewThreads groups repeated signatures while preserving audit evidence", () => {
  const repeatedBody =
    "P1: Missing verifier coverage lets failed restore writes leave a half-restored durable state. Add a regression.";
  const firstThread = createReviewThread({
    id: "thread-restore",
    path: "src/restore.ts",
    line: 42,
    comments: {
      nodes: [
        {
          id: "comment-restore",
          body: repeatedBody,
          createdAt: "2026-03-11T00:00:00Z",
          url: "https://example.test/pr/44#discussion_r1",
          author: {
            login: "chatgpt-codex-connector",
            typeName: "Bot",
          },
        },
      ],
    },
  });
  const secondThread = createReviewThread({
    id: "thread-restore-test",
    path: "src/restore.test.ts",
    line: 88,
    comments: {
      nodes: [
        {
          id: "comment-restore-test",
          body: repeatedBody,
          createdAt: "2026-03-11T00:01:00Z",
          url: "https://example.test/pr/44#discussion_r2",
          author: {
            login: "chatgpt-codex-connector",
            typeName: "Bot",
          },
        },
      ],
    },
  });
  const malformedUrlThread = createReviewThread({
    id: "thread-restore-worker",
    path: "src/restore-worker.ts",
    line: 120,
    comments: {
      nodes: [
        {
          id: "comment-restore-worker",
          body: repeatedBody,
          createdAt: "2026-03-11T00:01:30Z",
          url: undefined as unknown as string,
          author: {
            login: "chatgpt-codex-connector",
            typeName: "Bot",
          },
        },
      ],
    },
  });
  const unrelatedThread = createReviewThread({
    id: "thread-export",
    path: "src/export.ts",
    line: 12,
    comments: {
      nodes: [
        {
          id: "comment-export",
          body: "P2: Export readiness must reject mixed-snapshot rows instead of stitching partial results together.",
          createdAt: "2026-03-11T00:02:00Z",
          url: "https://example.test/pr/44#discussion_r3",
          author: {
            login: "chatgpt-codex-connector",
            typeName: "Bot",
          },
        },
      ],
    },
  });

  const clusters = clusterConfiguredBotReviewThreads([firstThread, secondThread, malformedUrlThread, unrelatedThread]);

  assert.equal(clusters.length, 2);
  assert.deepEqual(clusters[0]?.threads.map((thread) => thread.id), [
    "thread-restore",
    "thread-restore-test",
    "thread-restore-worker",
  ]);
  assert.deepEqual(clusters[0]?.files, ["src/restore.ts", "src/restore.test.ts", "src/restore-worker.ts"]);
  assert.deepEqual(clusters[0]?.sourceUrls, [
    "https://example.test/pr/44#discussion_r1",
    "https://example.test/pr/44#discussion_r2",
  ]);
  assert.deepEqual(clusters[1]?.threads.map((thread) => thread.id), ["thread-export"]);
});

test("clusterConfiguredBotReviewThreads groups same-path Codex Connector findings by normalized failure theme", () => {
  const simulatorAuthorityThread = createReviewThread({
    id: "thread-simulator-authority",
    path: "src/simulator/validation.ts",
    line: 42,
    comments: {
      nodes: [
        {
          id: "comment-simulator-authority",
          body:
            "P1: The simulator validation path still accepts a production authority flag without proving the signed fixture. Add regression coverage before merge.",
          createdAt: "2026-03-11T00:00:00Z",
          url: "https://example.test/pr/44#discussion_r1",
          author: {
            login: "chatgpt-codex-connector",
            typeName: "Bot",
          },
        },
      ],
    },
  });
  const simulatorFixtureThread = createReviewThread({
    id: "thread-simulator-fixture",
    path: "src/simulator/validation.ts",
    line: 88,
    comments: {
      nodes: [
        {
          id: "comment-simulator-fixture",
          body:
            "P1: Simulator validation can still pass when the signed fixture proof is missing, so production authority is inferred from an unsafe fallback.",
          createdAt: "2026-03-11T00:01:00Z",
          url: "https://example.test/pr/44#discussion_r2",
          author: {
            login: "chatgpt-codex-connector",
            typeName: "Bot",
          },
        },
      ],
    },
  });
  const unrelatedThread = createReviewThread({
    id: "thread-export-snapshot",
    path: "src/export/readiness.ts",
    line: 12,
    comments: {
      nodes: [
        {
          id: "comment-export-snapshot",
          body:
            "P1: Export readiness still stitches rows from mixed snapshots instead of rejecting the inconsistent read set.",
          createdAt: "2026-03-11T00:02:00Z",
          url: "https://example.test/pr/44#discussion_r3",
          author: {
            login: "chatgpt-codex-connector",
            typeName: "Bot",
          },
        },
      ],
    },
  });

  const clusters = clusterConfiguredBotReviewThreads([
    simulatorAuthorityThread,
    simulatorFixtureThread,
    unrelatedThread,
  ]);

  assert.equal(clusters.length, 2);
  assert.deepEqual(clusters[0]?.threads.map((thread) => thread.id), [
    "thread-simulator-authority",
    "thread-simulator-fixture",
  ]);
  assert.deepEqual(clusters[0]?.sourceUrls, [
    "https://example.test/pr/44#discussion_r1",
    "https://example.test/pr/44#discussion_r2",
  ]);
  assert.deepEqual(clusters[1]?.threads.map((thread) => thread.id), ["thread-export-snapshot"]);
});

test("evaluateCodexConnectorConvergencePolicy separates missing, must-fix, nitpick-only, and converged outcomes", () => {
  const config = createConfig({ reviewBotLogins: ["chatgpt-codex-connector"] });
  const currentHeadPr = {
    configuredBotCurrentHeadObservedAt: "2026-03-11T00:04:00Z",
  };
  const p2Thread = createReviewThread({
    id: "thread-p2",
    comments: {
      nodes: [
        {
          id: "comment-p2",
          body: "P2: Preserve failed restore cleanup as a blocking verification failure.",
          createdAt: "2026-03-11T00:00:00Z",
          url: "https://example.test/pr/44#discussion_r3",
          author: {
            login: "chatgpt-codex-connector",
            typeName: "Bot",
          },
        },
      ],
    },
  });
  const p3NitpickThread = createReviewThread({
    id: "thread-p3-softened",
    comments: {
      nodes: [
        {
          id: "comment-p3-softened",
          body: "P3: Nitpick: prefer a shorter helper name for readability.",
          createdAt: "2026-03-11T00:01:00Z",
          url: "https://example.test/pr/44#discussion_r4",
          author: {
            login: "chatgpt-codex-connector",
            typeName: "Bot",
          },
        },
      ],
    },
  });

  assert.equal(evaluateCodexConnectorConvergencePolicy(config, { configuredBotCurrentHeadObservedAt: null }, [])?.outcome, "missing_current_head_review");
  assert.equal(evaluateCodexConnectorConvergencePolicy(config, currentHeadPr, [p2Thread])?.outcome, "must_fix_remaining");
  assert.equal(
    evaluateCodexConnectorConvergencePolicy(config, { configuredBotCurrentHeadObservedAt: null }, [p3NitpickThread])?.outcome,
    "missing_current_head_review",
  );
  assert.equal(evaluateCodexConnectorConvergencePolicy(config, currentHeadPr, [p3NitpickThread])?.outcome, "nitpick_only");
  assert.equal(evaluateCodexConnectorConvergencePolicy(config, currentHeadPr, [])?.outcome, "converged");
});

function assertCodexConnectorConvergencePolicyResultTypes(): void {
  const config = createConfig({ reviewBotLogins: ["chatgpt-codex-connector"] });
  const result = evaluateCodexConnectorConvergencePolicy(
    config,
    { configuredBotCurrentHeadObservedAt: "2026-03-11T00:04:00Z" },
    [],
  );
  if (result?.outcome === "converged") {
    assert.equal(result.findingCount, 0);
    assert.equal(result.mergeEffect, "ready");
    assert.equal(result.nextAction, "merge_ready");
    // @ts-expect-error converged results must not expose outcome-specific must-fix counts.
    void result.mustFixCount;
    // @ts-expect-error converged results must not expose outcome-specific nitpick counts.
    void result.nitpickCount;
  }
}
void assertCodexConnectorConvergencePolicyResultTypes;

test("actionableBotReviewThreads treats Codex Connector P2 as actionable by default", () => {
  const config = createConfig({ reviewBotLogins: ["chatgpt-codex-connector"] });
  const record = createReviewRecord();
  const pr = createPr();
  const p2Thread = createReviewThread({
    comments: {
      nodes: [
        {
          id: "comment-p2",
          body: "P2: Repair the retry path so failed verification cannot be reported as success.",
          createdAt: "2026-03-11T00:00:00Z",
          url: "https://example.test/pr/44#discussion_r3",
          author: {
            login: "chatgpt-codex-connector",
            typeName: "Bot",
          },
        },
      ],
    },
  });

  assert.deepEqual(actionableBotReviewThreads(config, record, pr, [p2Thread]), [p2Thread]);
});

test("actionableBotReviewThreads softens Codex Connector P3 only without stronger risk wording", () => {
  const config = createConfig({ reviewBotLogins: ["chatgpt-codex-connector"] });
  const record = createReviewRecord();
  const pr = createPr();
  const p3NitpickThread = createReviewThread({
    comments: {
      nodes: [
        {
          id: "comment-p3",
          body: "P3: Nitpick: prefer a shorter helper name for readability.",
          createdAt: "2026-03-11T00:00:00Z",
          url: "https://example.test/pr/44#discussion_r4",
          author: {
            login: "chatgpt-codex-connector",
            typeName: "Bot",
          },
        },
      ],
    },
  });

  assert.deepEqual(actionableBotReviewThreads(config, record, pr, [p3NitpickThread]), []);
});

test("actionableBotReviewThreads escalates Codex Connector P3 with stronger wording", () => {
  const config = createConfig({ reviewBotLogins: ["chatgpt-codex-connector"] });
  const record = createReviewRecord();
  const pr = createPr();
  const p3RiskThread = createReviewThread({
    comments: {
      nodes: [
        {
          id: "comment-p3",
          body: "P3: This cleanup can cause a regression in the restore failure path.",
          createdAt: "2026-03-11T00:00:00Z",
          url: "https://example.test/pr/44#discussion_r5",
          author: {
            login: "chatgpt-codex-connector",
            typeName: "Bot",
          },
        },
      ],
    },
  });

  assert.deepEqual(actionableBotReviewThreads(config, record, pr, [p3RiskThread]), [p3RiskThread]);
});
