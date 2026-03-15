import assert from "node:assert/strict";
import test from "node:test";
import {
  buildManualReviewFailureContext,
  buildRequestedChangesFailureContext,
  buildStalledBotReviewFailureContext,
  configuredBotReviewThreads,
  pendingBotReviewThreads,
} from "./review-thread-reporting";
import { GitHubPullRequest, ReviewThread, SupervisorConfig } from "./types";

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

function createProcessedThreadRecord(overrides: Partial<{
  processed_review_thread_ids: string[];
  processed_review_thread_fingerprints: string[];
  last_head_sha: string | null;
}> = {}) {
  return {
    processed_review_thread_ids: [],
    processed_review_thread_fingerprints: [],
    last_head_sha: null,
    ...overrides,
  };
}

function createPullRequest(overrides: Partial<GitHubPullRequest> = {}): GitHubPullRequest {
  return {
    number: 44,
    title: "Test PR",
    url: "https://example.test/pr/44",
    state: "OPEN",
    createdAt: "2026-03-11T00:00:00Z",
    isDraft: false,
    reviewDecision: "CHANGES_REQUESTED",
    mergeStateStatus: "CLEAN",
    headRefName: "codex/issue-44",
    headRefOid: "head-a",
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

test("configuredBotReviewThreads normalizes configured bot logins before classifying threads", () => {
  const config = createConfig({
    reviewBotLogins: [" Copilot-Pull-Request-Reviewer "],
  });

  const matchingThread = createReviewThread();
  const manualThread = createReviewThread({
    id: "thread-2",
    comments: {
      nodes: [
        {
          id: "comment-2",
          body: "Human feedback.",
          createdAt: "2026-03-11T00:01:00Z",
          url: "https://example.test/pr/44#discussion_r2",
          author: {
            login: "reviewer",
            typeName: "User",
          },
        },
      ],
    },
  });

  assert.deepEqual(configuredBotReviewThreads(config, [matchingThread, manualThread]), [matchingThread]);
});

test("pendingBotReviewThreads leaves a same-head configured thread pending when the latest comment changed", () => {
  const config = createConfig({
    reviewBotLogins: ["copilot-pull-request-reviewer"],
  });
  const record = createProcessedThreadRecord({
    last_head_sha: "head-a",
    processed_review_thread_ids: ["thread-1@head-a"],
    processed_review_thread_fingerprints: ["thread-1@head-a#comment-1"],
  });
  const pr = createPullRequest();
  const updatedThread = createReviewThread({
    comments: {
      nodes: [
        createReviewThread().comments.nodes[0],
        {
          id: "comment-2",
          body: "One more note on the same thread.",
          createdAt: "2026-03-11T00:05:00Z",
          url: "https://example.test/pr/44#discussion_r2",
          author: {
            login: "copilot-pull-request-reviewer",
            typeName: "Bot",
          },
        },
      ],
    },
  });

  assert.deepEqual(pendingBotReviewThreads(config, record, pr, [updatedThread]), [updatedThread]);
});

test("buildManualReviewFailureContext includes reviewer details and normalized body text", () => {
  const context = buildManualReviewFailureContext([
    createReviewThread({
      comments: {
        nodes: [
          {
            id: "comment-1",
            body: "Please\naddress this.",
            createdAt: "2026-03-11T00:00:00Z",
            url: "https://example.test/pr/44#discussion_r1",
            author: {
              login: "reviewer",
              typeName: "User",
            },
          },
        ],
      },
    }),
  ]);

  assert.equal(context?.category, "manual");
  assert.equal(context?.summary, "1 unresolved manual or unconfigured review thread(s) require human attention.");
  assert.deepEqual(context?.details, ["src/file.ts:12 reviewer=reviewer Please address this."]);
});

test("buildStalledBotReviewFailureContext carries processed-on-current-head details for configured bots", () => {
  const context = buildStalledBotReviewFailureContext([createReviewThread()]);

  assert.equal(context?.category, "manual");
  assert.equal(
    context?.summary,
    "1 configured bot review thread(s) remain unresolved after processing on the current head and now require manual attention.",
  );
  assert.deepEqual(context?.details, [
    "reviewer=copilot-pull-request-reviewer file=src/file.ts line=12 processed_on_current_head=yes",
  ]);
});

test("buildRequestedChangesFailureContext keeps requested-changes blocker wording stable", () => {
  const context = buildRequestedChangesFailureContext(createPullRequest());

  assert.equal(context.category, "manual");
  assert.equal(context.summary, "PR #44 has requested changes and requires manual review resolution before merge.");
  assert.equal(context.signature, "changes-requested:head-a");
  assert.deepEqual(context.details, ["reviewDecision=CHANGES_REQUESTED"]);
});
