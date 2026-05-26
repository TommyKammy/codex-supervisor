import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { handlePostTurnPullRequestTransitionsPhase, type PullRequestLifecycleSnapshot } from "./post-turn-pull-request";
import { IssueRunRecord, PullRequestCheck, ReviewThread, SupervisorStateFile } from "./core/types";
import { blockedReasonFromReviewState as resolveBlockedReasonFromReviewState, inferStateFromPullRequest } from "./pull-request-state";
import { derivePullRequestLifecycleSnapshot as deriveSupervisorPullRequestLifecycleSnapshot } from "./supervisor/supervisor-lifecycle";
import { findCodexConnectorReviewRequest } from "./github/github-review-signals";
import { configuredBotReviewThreads, manualReviewThreads } from "./review-thread-reporting";
import {
  CODEX_CONNECTOR_REVIEW_BOT_LOGIN,
  createCodexConnectorTrackedReviewResidueScenario,
} from "./codex-connector-tracked-pr-test-helpers";
import {
  SAMPLE_MACOS_WORKSTATION_PATH,
  SAMPLE_UNIX_WORKSTATION_PATH,
  TEST_MEMORY_ARTIFACTS,
  createCodexConnectorReviewRequestScenario,
  createDefaultGithub,
  createDraftReadyPromotionScenario,
  createFixBlockedEvaluation,
  createFollowUpEligibleEvaluation,
  createInitialMergeStageObservationPatch,
  createLifecycleSnapshot,
  createLocalReviewResult,
  createManualReviewBlockedEvaluation,
  createNoopStateStore,
  createOpenPullRequestSnapshotLoader,
  createOutdatedConfiguredBotThreads,
  createPersistentMergeStagePatch,
  createPostTurnContext,
  createStaleConfiguredBotBlockerScenario,
  createTrackedHostLocalBlockerScenario,
  createTrackedIssueBranchRepo,
  createTrackedPullRequestFixture,
  createTrackedRepo,
  git,
  runPostTurnTransitionScenario,
  summarizeChecks,
} from "./post-turn-pull-request-test-support";
import {
  createConfig,
  createFailureContext,
  createIssue,
  createPullRequest,
  createRecord,
  createReviewThread,
} from "./turn-execution-test-helpers";

test("handlePostTurnPullRequestTransitionsPhase requests Codex Connector review once after current-head signal timeout", async () => {
  const originalDateNow = Date.now;
  Date.now = () => Date.parse("2026-05-08T03:30:00Z");
  try {
    const { config, context, issue, pr, record, state } = createCodexConnectorReviewRequestScenario();
    const comments: Array<{ issueNumber: number; body: string }> = [];

    const result = await runPostTurnTransitionScenario({
      config,
      github: createDefaultGithub({
        addIssueComment: async (issueNumber, body) => {
          comments.push({ issueNumber, body });
          return {
            databaseId: 1976001,
            nodeId: "IC_kwDOissue1976_request",
            url: "https://github.com/owner/repo/issues/1976#issuecomment-1976001",
          };
        },
      }),
      context,
      loadOpenPullRequestSnapshot: createOpenPullRequestSnapshotLoader({
        pr,
        checks: [{ name: "build", state: "SUCCESS", bucket: "pass", workflow: "CI" }],
      }),
      applyFailureSignature: () => ({ last_failure_signature: null, repeated_failure_signature_count: 0 }),
    });

    assert.equal(comments.length, 1);
    assert.equal(comments[0]?.issueNumber, pr.number);
    assert.equal(
      comments[0]?.body ?? "",
      `@codex review\n\n<!-- codex-supervisor:codex-connector-review-request issue=${issue.number} pr=${pr.number} head=${pr.headRefOid} -->`,
    );
    assert.deepEqual(
      findCodexConnectorReviewRequest(
        [
          {
            authorLogin: "codex-supervisor[bot]",
            createdAt: "2026-05-08T03:30:00Z",
            body: comments[0]?.body ?? null,
            viewerDidAuthor: true,
          },
        ],
        { issueNumber: issue.number, prNumber: pr.number, headSha: pr.headRefOid },
      ),
      {
        requestedAt: "2026-05-08T03:30:00Z",
        headSha: pr.headRefOid,
        commentDatabaseId: null,
        commentNodeId: null,
        commentUrl: null,
      },
    );
    assert.equal(result.record.state, "waiting_ci");
    assert.equal(result.record.codex_connector_review_requested_head_sha, pr.headRefOid);
    assert.ok(result.record.codex_connector_review_requested_observed_at);
    assert.equal(result.record.codex_connector_review_request_comment_identity_status, "available");
    assert.equal(result.record.codex_connector_review_request_comment_database_id, 1976001);
    assert.equal(result.record.codex_connector_review_request_comment_node_id, "IC_kwDOissue1976_request");
    assert.equal(
      result.record.codex_connector_review_request_comment_url,
      "https://github.com/owner/repo/issues/1976#issuecomment-1976001",
    );
    assert.equal(result.record.blocked_reason, null);

    const retryResult = await runPostTurnTransitionScenario({
      config,
      github: createDefaultGithub({
        addIssueComment: async (issueNumber, body) => {
          comments.push({ issueNumber, body });
          return {
            databaseId: 1924001,
            nodeId: "IC_kwDOissue1924_request",
            url: "https://github.com/owner/repo/issues/1924#issuecomment-1924001",
          };
        },
      }),
      context: createPostTurnContext({
        issue,
        pr,
        workspacePath: "/tmp/workspaces/issue-1924",
        state,
        record: result.record,
      }),
      loadOpenPullRequestSnapshot: createOpenPullRequestSnapshotLoader({
        pr,
        checks: [{ name: "build", state: "SUCCESS", bucket: "pass", workflow: "CI" }],
      }),
      applyFailureSignature: () => ({ last_failure_signature: null, repeated_failure_signature_count: 0 }),
    });

    assert.equal(comments.length, 1);
    assert.equal(retryResult.record.codex_connector_review_requested_head_sha, pr.headRefOid);
  } finally {
    Date.now = originalDateNow;
  }
});

test("handlePostTurnPullRequestTransitionsPhase does not request Codex Connector review during dry-run", async () => {
  const originalDateNow = Date.now;
  Date.now = () => Date.parse("2026-05-08T03:30:00Z");
  try {
    const { config, context, pr } = createCodexConnectorReviewRequestScenario({
      issueTitle: "Dry-run Codex Connector review request",
      dryRun: true,
    });
    let addIssueCommentCalls = 0;

    const result = await runPostTurnTransitionScenario({
      config,
      github: createDefaultGithub({
        addIssueComment: async () => {
          addIssueCommentCalls += 1;
          throw new Error("dry-run must not post Codex Connector review requests");
        },
      }),
      context,
      loadOpenPullRequestSnapshot: createOpenPullRequestSnapshotLoader({
        pr,
        checks: [{ name: "build", state: "SUCCESS", bucket: "pass", workflow: "CI" }],
      }),
      applyFailureSignature: () => ({ last_failure_signature: null, repeated_failure_signature_count: 0 }),
    });

    assert.equal(addIssueCommentCalls, 0);
    assert.equal(result.record.codex_connector_review_requested_observed_at, null);
    assert.equal(result.record.codex_connector_review_requested_head_sha, null);
  } finally {
    Date.now = originalDateNow;
  }
});

test("handlePostTurnPullRequestTransitionsPhase retries Codex Connector review once after same-head request gets no response", async () => {
  const originalDateNow = Date.now;
  Date.now = () => Date.parse("2026-05-08T04:00:00Z");
  try {
    const config = createConfig({
      reviewBotLogins: ["chatgpt-codex-connector"],
      configuredBotInitialGraceWaitSeconds: 0,
      configuredBotCurrentHeadSignalTimeoutMinutes: 10,
      configuredBotCurrentHeadSignalTimeoutAction: "request_review_comment",
      codexConnectorReviewRequestNoResponseMinutes: 10,
      codexConnectorReviewRequestRetryLimit: 1,
      codexConnectorReviewRequestRetryMode: "plain",
    });
    const issue = createIssue({ number: 1976, title: "Retry Codex Connector review after no response" });
    const pr = createPullRequest({
      number: 1976,
      title: "Retry Codex Connector review after no response",
      isDraft: false,
      headRefOid: "head-1976",
      currentHeadCiGreenAt: "2026-05-08T03:09:36Z",
      configuredBotCurrentHeadObservedAt: null,
      codexConnectorReviewRequestedAt: "2026-05-08T03:30:00Z",
      codexConnectorReviewRequestedHeadSha: "head-1976",
    });
    const record = createRecord({
      issue_number: issue.number,
      state: "waiting_ci",
      pr_number: pr.number,
      last_head_sha: pr.headRefOid,
      review_wait_started_at: "2026-05-08T03:09:36Z",
      review_wait_head_sha: pr.headRefOid,
      copilot_review_timed_out_at: "2026-05-08T03:19:36.000Z",
      copilot_review_timeout_action: "request_review_comment",
      codex_connector_review_requested_observed_at: "2026-05-08T03:30:00Z",
      codex_connector_review_requested_head_sha: pr.headRefOid,
      codex_connector_review_request_retry_count: 0,
      codex_connector_review_request_retry_head_sha: null,
      codex_connector_review_request_last_retried_at: null,
    });
    const state: SupervisorStateFile = {
      activeIssueNumber: issue.number,
      issues: { [String(issue.number)]: record },
    };
    const comments: Array<{ issueNumber: number; body: string }> = [];

    const result = await handlePostTurnPullRequestTransitionsPhase({
      config,
      stateStore: createNoopStateStore(),
      github: createDefaultGithub({
        addIssueComment: async (issueNumber, body) => {
          comments.push({ issueNumber, body });
          return {
            databaseId: 1924001,
            nodeId: "IC_kwDOissue1924_request",
            url: "https://github.com/owner/repo/issues/1924#issuecomment-1924001",
          };
        },
      }),
      context: createPostTurnContext({
        issue,
        pr,
        workspacePath: "/tmp/workspaces/issue-1976",
        state,
        record,
      }),
      loadOpenPullRequestSnapshot: async () => ({
        pr,
        checks: [{ name: "build", state: "SUCCESS", bucket: "pass", workflow: "CI" }],
        reviewThreads: [],
      }),
      derivePullRequestLifecycleSnapshot: (currentRecord, currentPr, checks, reviewThreads, recordPatch) =>
        deriveSupervisorPullRequestLifecycleSnapshot(config, currentRecord, currentPr, checks, reviewThreads, recordPatch),
      applyFailureSignature: () => ({ last_failure_signature: null, repeated_failure_signature_count: 0 }),
      blockedReasonFromReviewState: (currentRecord, currentPr, checks, reviewThreads) =>
        resolveBlockedReasonFromReviewState(config, currentRecord, currentPr, checks, reviewThreads),
      summarizeChecks,
      configuredBotReviewThreads: () => [],
      manualReviewThreads: () => [],
      mergeConflictDetected: () => false,
    });

    assert.deepEqual(comments, [{ issueNumber: pr.number, body: "@codex review" }]);
    assert.equal(result.record.state, "waiting_ci");
    assert.equal(result.record.codex_connector_review_requested_observed_at, "2026-05-08T03:30:00Z");
    assert.equal(result.record.codex_connector_review_requested_head_sha, pr.headRefOid);
    assert.equal(result.record.codex_connector_review_request_retry_count, 1);
    assert.equal(result.record.codex_connector_review_request_retry_head_sha, pr.headRefOid);
    assert.ok(result.record.codex_connector_review_request_last_retried_at);
    assert.equal(result.record.codex_connector_review_request_comment_identity_status, "available");
    assert.equal(result.record.codex_connector_review_request_comment_database_id, 1924001);
    assert.equal(result.record.codex_connector_review_request_comment_node_id, "IC_kwDOissue1924_request");
    assert.equal(
      result.record.codex_connector_review_request_comment_url,
      "https://github.com/owner/repo/issues/1924#issuecomment-1924001",
    );

    const duplicateCycle = await handlePostTurnPullRequestTransitionsPhase({
      config,
      stateStore: createNoopStateStore(),
      github: createDefaultGithub({
        addIssueComment: async (issueNumber, body) => {
          comments.push({ issueNumber, body });
        },
      }),
      context: createPostTurnContext({
        issue,
        pr,
        workspacePath: "/tmp/workspaces/issue-1976",
        state,
        record: result.record,
      }),
      loadOpenPullRequestSnapshot: async () => ({
        pr,
        checks: [{ name: "build", state: "SUCCESS", bucket: "pass", workflow: "CI" }],
        reviewThreads: [],
      }),
      derivePullRequestLifecycleSnapshot: (currentRecord, currentPr, checks, reviewThreads, recordPatch) =>
        deriveSupervisorPullRequestLifecycleSnapshot(config, currentRecord, currentPr, checks, reviewThreads, recordPatch),
      applyFailureSignature: () => ({ last_failure_signature: null, repeated_failure_signature_count: 0 }),
      blockedReasonFromReviewState: (currentRecord, currentPr, checks, reviewThreads) =>
        resolveBlockedReasonFromReviewState(config, currentRecord, currentPr, checks, reviewThreads),
      summarizeChecks,
      configuredBotReviewThreads: () => [],
      manualReviewThreads: () => [],
      mergeConflictDetected: () => false,
    });

    assert.equal(comments.length, 1);
    assert.equal(duplicateCycle.record.codex_connector_review_request_retry_count, 1);
  } finally {
    Date.now = originalDateNow;
  }
});

test("handlePostTurnPullRequestTransitionsPhase requests Codex Connector review once for no-checks repos without local CI", async () => {
  const originalDateNow = Date.now;
  Date.now = () => Date.parse("2026-05-12T04:30:00Z");
  try {
    const config = createConfig({
      reviewBotLogins: ["chatgpt-codex-connector"],
      localCiCommand: "",
      configuredBotInitialGraceWaitSeconds: 0,
      configuredBotCurrentHeadSignalTimeoutMinutes: 10,
      configuredBotCurrentHeadSignalTimeoutAction: "request_review_comment",
    });
    const issue = createIssue({ number: 1969, title: "Request Codex Connector review without checks" });
    const pr = createPullRequest({
      number: 1969,
      title: "Request Codex Connector review without checks",
      isDraft: false,
      headRefOid: "head-1969",
      currentHeadCiGreenAt: null,
      configuredBotCurrentHeadObservedAt: null,
      configuredBotTopLevelReviewSubmittedAt: "2026-05-12T03:40:00Z",
      codexConnectorReviewRequestedAt: null,
      codexConnectorReviewRequestedHeadSha: null,
    });
    const record = createRecord({
      issue_number: issue.number,
      state: "waiting_ci",
      pr_number: pr.number,
      last_head_sha: pr.headRefOid,
      review_wait_started_at: "2026-05-12T04:09:36Z",
      review_wait_head_sha: pr.headRefOid,
      copilot_review_timed_out_at: "2026-05-12T04:19:36.000Z",
      copilot_review_timeout_action: "request_review_comment",
      codex_connector_review_requested_observed_at: null,
      codex_connector_review_requested_head_sha: null,
    });
    const state: SupervisorStateFile = {
      activeIssueNumber: issue.number,
      issues: { [String(issue.number)]: record },
    };
    const comments: Array<{ issueNumber: number; body: string }> = [];

    const result = await handlePostTurnPullRequestTransitionsPhase({
      config,
      stateStore: createNoopStateStore(),
      github: createDefaultGithub({
        addIssueComment: async (issueNumber, body) => {
          comments.push({ issueNumber, body });
        },
      }),
      context: createPostTurnContext({
        issue,
        pr,
        workspacePath: path.join(os.tmpdir(), "workspaces", "issue-1969"),
        state,
        record,
      }),
      loadOpenPullRequestSnapshot: async () => ({
        pr,
        checks: [],
        reviewThreads: [],
      }),
      derivePullRequestLifecycleSnapshot: (currentRecord, currentPr, checks, reviewThreads, recordPatch) =>
        deriveSupervisorPullRequestLifecycleSnapshot(config, currentRecord, currentPr, checks, reviewThreads, recordPatch),
      applyFailureSignature: () => ({ last_failure_signature: null, repeated_failure_signature_count: 0 }),
      blockedReasonFromReviewState: (currentRecord, currentPr, checks, reviewThreads) =>
        resolveBlockedReasonFromReviewState(config, currentRecord, currentPr, checks, reviewThreads),
      summarizeChecks,
      configuredBotReviewThreads: () => [],
      manualReviewThreads: () => [],
      mergeConflictDetected: () => false,
    });

    assert.equal(comments.length, 1);
    assert.equal(comments[0]?.issueNumber, pr.number);
    assert.equal(
      comments[0]?.body ?? "",
      `@codex review\n\n<!-- codex-supervisor:codex-connector-review-request issue=${issue.number} pr=${pr.number} head=${pr.headRefOid} -->`,
    );
    assert.equal(result.record.state, "waiting_ci");
    assert.notEqual(result.record.state, "ready_to_merge");
    assert.equal(result.record.codex_connector_review_requested_head_sha, pr.headRefOid);
    assert.ok(result.record.codex_connector_review_requested_observed_at);

    const retryResult = await handlePostTurnPullRequestTransitionsPhase({
      config,
      stateStore: createNoopStateStore(),
      github: createDefaultGithub({
        addIssueComment: async (issueNumber, body) => {
          comments.push({ issueNumber, body });
        },
      }),
      context: createPostTurnContext({
        issue,
        pr: {
          ...pr,
          codexConnectorReviewRequestedAt: result.record.codex_connector_review_requested_observed_at,
          codexConnectorReviewRequestedHeadSha: result.record.codex_connector_review_requested_head_sha,
        },
        workspacePath: path.join(os.tmpdir(), "workspaces", "issue-1969"),
        state,
        record: result.record,
      }),
      loadOpenPullRequestSnapshot: async () => ({
        pr: {
          ...pr,
          codexConnectorReviewRequestedAt: result.record.codex_connector_review_requested_observed_at,
          codexConnectorReviewRequestedHeadSha: result.record.codex_connector_review_requested_head_sha,
        },
        checks: [],
        reviewThreads: [],
      }),
      derivePullRequestLifecycleSnapshot: (currentRecord, currentPr, checks, reviewThreads, recordPatch) =>
        deriveSupervisorPullRequestLifecycleSnapshot(config, currentRecord, currentPr, checks, reviewThreads, recordPatch),
      applyFailureSignature: () => ({ last_failure_signature: null, repeated_failure_signature_count: 0 }),
      blockedReasonFromReviewState: (currentRecord, currentPr, checks, reviewThreads) =>
        resolveBlockedReasonFromReviewState(config, currentRecord, currentPr, checks, reviewThreads),
      summarizeChecks,
      configuredBotReviewThreads: () => [],
      manualReviewThreads: () => [],
      mergeConflictDetected: () => false,
    });

    assert.equal(comments.length, 1);
    assert.equal(retryResult.record.codex_connector_review_requested_head_sha, pr.headRefOid);
  } finally {
    Date.now = originalDateNow;
  }
});

test("handlePostTurnPullRequestTransitionsPhase requests Codex Connector review despite stale processed Codex threads", async () => {
  const originalDateNow = Date.now;
  Date.now = () => Date.parse("2026-05-08T03:35:00Z");
  try {
    const config = createConfig({
      reviewBotLogins: ["chatgpt-codex-connector"],
      configuredBotInitialGraceWaitSeconds: 0,
      configuredBotCurrentHeadSignalTimeoutMinutes: 10,
      configuredBotCurrentHeadSignalTimeoutAction: "request_review_comment",
    });
    const issue = createIssue({ number: 1957, title: "Request Codex Connector review with stale thread" });
    const pr = createPullRequest({
      number: 1957,
      title: "Request Codex Connector review with stale thread",
      isDraft: false,
      headRefOid: "head-1957",
      currentHeadCiGreenAt: null,
      configuredBotCurrentHeadObservedAt: null,
      codexConnectorReviewRequestedAt: null,
      codexConnectorReviewRequestedHeadSha: null,
    });
    const staleProcessedThread = createReviewThread({
      id: "thread-stale-codex",
      path: "src/example.ts",
      line: 12,
      comments: {
        nodes: [
          {
            id: "comment-stale-codex",
            body: "P3: Nitpick: prefer a clearer helper name.",
            createdAt: "2026-05-08T03:12:00Z",
            url: "https://example.test/pr/1957#discussion_r1",
            author: {
              login: "chatgpt-codex-connector",
              typeName: "Bot",
            },
          },
        ],
      },
    });
    const record = createRecord({
      issue_number: issue.number,
      state: "waiting_ci",
      pr_number: pr.number,
      last_head_sha: pr.headRefOid,
      review_wait_started_at: "2026-05-08T03:09:36Z",
      review_wait_head_sha: pr.headRefOid,
      copilot_review_timed_out_at: "2026-05-08T03:19:36.000Z",
      copilot_review_timeout_action: "request_review_comment",
      processed_review_thread_ids: [`${staleProcessedThread.id}@${pr.headRefOid}`],
      processed_review_thread_fingerprints: [`${staleProcessedThread.id}@${pr.headRefOid}#comment-stale-codex`],
      codex_connector_review_requested_observed_at: null,
      codex_connector_review_requested_head_sha: null,
    });
    const state: SupervisorStateFile = {
      activeIssueNumber: issue.number,
      issues: { [String(issue.number)]: record },
    };
    const comments: Array<{ issueNumber: number; body: string }> = [];

    const result = await handlePostTurnPullRequestTransitionsPhase({
      config,
      stateStore: createNoopStateStore(),
      github: createDefaultGithub({
        addIssueComment: async (issueNumber, body) => {
          comments.push({ issueNumber, body });
        },
      }),
      context: createPostTurnContext({
        issue,
        pr,
        workspacePath: path.join(os.tmpdir(), "workspaces", "issue-1957"),
        state,
        record,
      }),
      loadOpenPullRequestSnapshot: async () => ({
        pr,
        checks: [{ name: "build", state: "SUCCESS", bucket: "pass", workflow: "CI" }],
        reviewThreads: [staleProcessedThread],
      }),
      derivePullRequestLifecycleSnapshot: (currentRecord, currentPr, checks, reviewThreads, recordPatch) =>
        deriveSupervisorPullRequestLifecycleSnapshot(config, currentRecord, currentPr, checks, reviewThreads, recordPatch),
      applyFailureSignature: () => ({ last_failure_signature: null, repeated_failure_signature_count: 0 }),
      blockedReasonFromReviewState: (currentRecord, currentPr, checks, reviewThreads) =>
        resolveBlockedReasonFromReviewState(config, currentRecord, currentPr, checks, reviewThreads),
      summarizeChecks,
      configuredBotReviewThreads,
      manualReviewThreads,
      mergeConflictDetected: () => false,
    });

    assert.equal(comments.length, 1);
    assert.equal(comments[0]?.issueNumber, pr.number);
    assert.equal(
      comments[0]?.body ?? "",
      `@codex review\n\n<!-- codex-supervisor:codex-connector-review-request issue=${issue.number} pr=${pr.number} head=${pr.headRefOid} -->`,
    );
    assert.equal(result.record.state, "waiting_ci");
    assert.notEqual(result.record.state, "ready_to_merge");
    assert.equal(result.record.codex_connector_review_requested_head_sha, pr.headRefOid);
    assert.ok(result.record.codex_connector_review_requested_observed_at);
  } finally {
    Date.now = originalDateNow;
  }
});

test("handlePostTurnPullRequestTransitionsPhase keeps Codex Connector review request suppressed by unprocessed must-fix Codex threads", async () => {
  const config = createConfig({
    reviewBotLogins: ["chatgpt-codex-connector"],
    configuredBotInitialGraceWaitSeconds: 0,
    configuredBotCurrentHeadSignalTimeoutMinutes: 10,
    configuredBotCurrentHeadSignalTimeoutAction: "request_review_comment",
  });
  const issue = createIssue({ number: 1958, title: "Suppress Codex Connector request with must-fix thread" });
  const pr = createPullRequest({
    number: 1958,
    title: "Suppress Codex Connector request with must-fix thread",
    isDraft: false,
    headRefOid: "head-1958",
    currentHeadCiGreenAt: null,
    configuredBotCurrentHeadObservedAt: null,
    codexConnectorReviewRequestedAt: null,
    codexConnectorReviewRequestedHeadSha: null,
  });
  const mustFixThread = createReviewThread({
    id: "thread-must-fix-codex",
    path: "src/example.ts",
    line: 21,
    comments: {
      nodes: [
        {
          id: "comment-must-fix-codex",
          body: "P1: Fix this before another review request.",
          createdAt: "2026-05-08T03:12:00Z",
          url: "https://example.test/pr/1958#discussion_r1",
          author: {
            login: "chatgpt-codex-connector",
            typeName: "Bot",
          },
        },
      ],
    },
  });
  const record = createRecord({
    issue_number: issue.number,
    state: "waiting_ci",
    pr_number: pr.number,
    last_head_sha: pr.headRefOid,
    review_wait_started_at: "2026-05-08T03:09:36Z",
    review_wait_head_sha: pr.headRefOid,
    copilot_review_timed_out_at: "2026-05-08T03:19:36.000Z",
    copilot_review_timeout_action: "request_review_comment",
    codex_connector_review_requested_observed_at: null,
    codex_connector_review_requested_head_sha: null,
  });
  const state: SupervisorStateFile = {
    activeIssueNumber: issue.number,
    issues: { [String(issue.number)]: record },
  };
  const comments: Array<{ issueNumber: number; body: string }> = [];

  const result = await handlePostTurnPullRequestTransitionsPhase({
    config,
    stateStore: createNoopStateStore(),
    github: createDefaultGithub({
      addIssueComment: async (issueNumber, body) => {
        comments.push({ issueNumber, body });
      },
    }),
    context: createPostTurnContext({
      issue,
      pr,
      workspacePath: path.join(os.tmpdir(), "workspaces", "issue-1958"),
      state,
      record,
    }),
    loadOpenPullRequestSnapshot: async () => ({
      pr,
      checks: [{ name: "build", state: "SUCCESS", bucket: "pass", workflow: "CI" }],
      reviewThreads: [mustFixThread],
    }),
    derivePullRequestLifecycleSnapshot: (currentRecord, currentPr, checks, reviewThreads, recordPatch) =>
      deriveSupervisorPullRequestLifecycleSnapshot(config, currentRecord, currentPr, checks, reviewThreads, recordPatch),
    applyFailureSignature: () => ({ last_failure_signature: null, repeated_failure_signature_count: 0 }),
    blockedReasonFromReviewState: (currentRecord, currentPr, checks, reviewThreads) =>
      resolveBlockedReasonFromReviewState(config, currentRecord, currentPr, checks, reviewThreads),
    summarizeChecks,
    configuredBotReviewThreads,
    manualReviewThreads,
    mergeConflictDetected: () => false,
  });

  assert.equal(
    comments.some((comment) => comment.body.includes("codex-supervisor:codex-connector-review-request")),
    false,
  );
  assert.equal(result.record.codex_connector_review_requested_head_sha, null);
  assert.notEqual(result.record.state, "ready_to_merge");
});

test("handlePostTurnPullRequestTransitionsPhase does not request Codex Connector review on non-green loaded checks without green timestamp", async () => {
  const config = createConfig({
    reviewBotLogins: ["chatgpt-codex-connector"],
    configuredBotInitialGraceWaitSeconds: 0,
    configuredBotCurrentHeadSignalTimeoutMinutes: 10,
    configuredBotCurrentHeadSignalTimeoutAction: "request_review_comment",
  });
  const issue = createIssue({ number: 1951, title: "Suppress Codex Connector request" });
  const pr = createPullRequest({
    number: 1951,
    title: "Suppress Codex Connector request",
    isDraft: false,
    headRefOid: "head-1951",
    currentHeadCiGreenAt: null,
    configuredBotCurrentHeadObservedAt: null,
  });
  const baseRecord = createRecord({
    issue_number: issue.number,
    state: "waiting_ci",
    pr_number: pr.number,
    last_head_sha: pr.headRefOid,
    review_wait_started_at: "2026-05-08T03:09:36Z",
    review_wait_head_sha: pr.headRefOid,
    copilot_review_timed_out_at: "2026-05-08T03:19:36.000Z",
    copilot_review_timeout_action: "request_review_comment",
    copilot_review_timeout_reason:
      "Configured review bot never produced a current-head signal within 10 minute(s).",
    codex_connector_review_requested_observed_at: null,
    codex_connector_review_requested_head_sha: null,
  });

  const cases: Array<{ name: string; checks: PullRequestCheck[] }> = [
    {
      name: "pending",
      checks: [{ name: "build", state: "IN_PROGRESS", bucket: "pending", workflow: "CI" }],
    },
    {
      name: "cancelled",
      checks: [{ name: "merge-queue", state: "CANCELLED", bucket: "cancel", workflow: "CI" }],
    },
    {
      name: "failing",
      checks: [{ name: "build", state: "FAILURE", bucket: "fail", workflow: "CI" }],
    },
  ];

  for (const scenario of cases) {
    const record = createRecord({ ...baseRecord, issue_number: issue.number });
    const state: SupervisorStateFile = {
      activeIssueNumber: issue.number,
      issues: { [String(issue.number)]: record },
    };
    const commentBodies: string[] = [];

    const result = await handlePostTurnPullRequestTransitionsPhase({
      config,
      stateStore: createNoopStateStore(),
      github: createDefaultGithub({
        addIssueComment: async (_issueNumber, body) => {
          commentBodies.push(body);
        },
      }),
      context: createPostTurnContext({
        issue,
        pr,
        workspacePath: path.join(os.tmpdir(), "workspaces", `issue-1951-${scenario.name}`),
        state,
        record,
      }),
      loadOpenPullRequestSnapshot: async () => ({
        pr,
        checks: scenario.checks,
        reviewThreads: [],
      }),
      derivePullRequestLifecycleSnapshot: (currentRecord, currentPr, checks, reviewThreads, recordPatch) =>
        deriveSupervisorPullRequestLifecycleSnapshot(config, currentRecord, currentPr, checks, reviewThreads, recordPatch),
      applyFailureSignature: () => ({ last_failure_signature: null, repeated_failure_signature_count: 0 }),
      blockedReasonFromReviewState: (currentRecord, currentPr, checks, reviewThreads) =>
        resolveBlockedReasonFromReviewState(config, currentRecord, currentPr, checks, reviewThreads),
      summarizeChecks,
      configuredBotReviewThreads: () => [],
      manualReviewThreads: () => [],
      mergeConflictDetected: () => false,
    });

    assert.equal(
      commentBodies.some((body) => body.includes("codex-supervisor:codex-connector-review-request")),
      false,
      scenario.name,
    );
    assert.equal(result.record.codex_connector_review_requested_head_sha, null, scenario.name);
  }
});

test("handlePostTurnPullRequestTransitionsPhase keeps Codex Connector review request suppressed by PR and review blockers without green timestamp", async () => {
  const config = createConfig({
    reviewBotLogins: ["chatgpt-codex-connector"],
    configuredBotInitialGraceWaitSeconds: 0,
    configuredBotCurrentHeadSignalTimeoutMinutes: 10,
    configuredBotCurrentHeadSignalTimeoutAction: "request_review_comment",
  });
  const issue = createIssue({ number: 1951, title: "Blocked Codex Connector request" });
  const basePr = createPullRequest({
    number: 1951,
    title: "Blocked Codex Connector request",
    isDraft: false,
    headRefOid: "head-1951",
    currentHeadCiGreenAt: null,
    configuredBotCurrentHeadObservedAt: null,
  });
  const passingChecks: PullRequestCheck[] = [{ name: "build", state: "SUCCESS", bucket: "pass", workflow: "CI" }];
  const blockerThread = createReviewThread({
    comments: {
      nodes: [
        {
          id: "comment-codex",
          body: "P1: fix this before merge.",
          createdAt: "2026-05-08T03:30:00Z",
          url: "https://example.test/pr/1951#discussion_r1",
          author: {
            login: "chatgpt-codex-connector",
            typeName: "Bot",
          },
        },
      ],
    },
  });
  const manualThread = createReviewThread({
    id: "manual-thread",
    comments: {
      nodes: [
        {
          id: "comment-human",
          body: "Please revise this.",
          createdAt: "2026-05-08T03:30:00Z",
          url: "https://example.test/pr/1951#discussion_r2",
          author: {
            login: "reviewer",
            typeName: "User",
          },
        },
      ],
    },
  });
  const cases: Array<{
    name: string;
    pr: ReturnType<typeof createPullRequest>;
    reviewThreads: ReviewThread[];
    configuredBotReviewThreads: ReviewThread[];
    manualReviewThreads: ReviewThread[];
    mergeConflict: boolean;
  }> = [
    {
      name: "draft",
      pr: { ...basePr, isDraft: true },
      reviewThreads: [],
      configuredBotReviewThreads: [],
      manualReviewThreads: [],
      mergeConflict: false,
    },
    {
      name: "merge-conflict",
      pr: basePr,
      reviewThreads: [],
      configuredBotReviewThreads: [],
      manualReviewThreads: [],
      mergeConflict: true,
    },
    {
      name: "requested-changes",
      pr: { ...basePr, reviewDecision: "CHANGES_REQUESTED" },
      reviewThreads: [],
      configuredBotReviewThreads: [],
      manualReviewThreads: [],
      mergeConflict: false,
    },
    {
      name: "configured-bot-thread",
      pr: basePr,
      reviewThreads: [blockerThread],
      configuredBotReviewThreads: [blockerThread],
      manualReviewThreads: [],
      mergeConflict: false,
    },
    {
      name: "manual-thread",
      pr: basePr,
      reviewThreads: [manualThread],
      configuredBotReviewThreads: [],
      manualReviewThreads: [manualThread],
      mergeConflict: false,
    },
  ];

  for (const scenario of cases) {
    const record = createRecord({
      issue_number: issue.number,
      state: "waiting_ci",
      pr_number: scenario.pr.number,
      last_head_sha: scenario.pr.headRefOid,
      review_wait_started_at: "2026-05-08T03:09:36Z",
      review_wait_head_sha: scenario.pr.headRefOid,
      copilot_review_timed_out_at: "2026-05-08T03:19:36.000Z",
      copilot_review_timeout_action: "request_review_comment",
      codex_connector_review_requested_observed_at: null,
      codex_connector_review_requested_head_sha: null,
    });
    const state: SupervisorStateFile = {
      activeIssueNumber: issue.number,
      issues: { [String(issue.number)]: record },
    };
    const commentBodies: string[] = [];

    const result = await handlePostTurnPullRequestTransitionsPhase({
      config,
      stateStore: createNoopStateStore(),
      github: createDefaultGithub({
        addIssueComment: async (_issueNumber, body) => {
          commentBodies.push(body);
        },
      }),
      context: createPostTurnContext({
        issue,
        pr: scenario.pr,
        workspacePath: process.cwd(),
        state,
        record,
      }),
      loadOpenPullRequestSnapshot: async () => ({
        pr: scenario.pr,
        checks: passingChecks,
        reviewThreads: scenario.reviewThreads,
      }),
      derivePullRequestLifecycleSnapshot: (currentRecord, currentPr, checks, reviewThreads, recordPatch) =>
        deriveSupervisorPullRequestLifecycleSnapshot(config, currentRecord, currentPr, checks, reviewThreads, recordPatch),
      applyFailureSignature: () => ({ last_failure_signature: null, repeated_failure_signature_count: 0 }),
      blockedReasonFromReviewState: (currentRecord, currentPr, checks, reviewThreads) =>
        resolveBlockedReasonFromReviewState(config, currentRecord, currentPr, checks, reviewThreads),
      summarizeChecks,
      configuredBotReviewThreads: () => scenario.configuredBotReviewThreads,
      manualReviewThreads: () => scenario.manualReviewThreads,
      mergeConflictDetected: () => scenario.mergeConflict,
    });

    assert.equal(
      commentBodies.some((body) => body.includes("codex-supervisor:codex-connector-review-request")),
      false,
      scenario.name,
    );
    assert.equal(result.record.codex_connector_review_requested_head_sha, null, scenario.name);
  }
});

test("handlePostTurnPullRequestTransitionsPhase skips duplicate Codex Connector request when GitHub comments hydrate current-head marker", async () => {
  const originalDateNow = Date.now;
  Date.now = () => Date.parse("2026-05-08T03:45:00Z");
  try {
    const config = createConfig({
      reviewBotLogins: ["chatgpt-codex-connector"],
      configuredBotInitialGraceWaitSeconds: 0,
      configuredBotCurrentHeadSignalTimeoutMinutes: 10,
      configuredBotCurrentHeadSignalTimeoutAction: "request_review_comment",
    });
    const issue = createIssue({ number: 1924, title: "Hydrated Codex Connector request" });
    const pr = createPullRequest({
      number: 1924,
      title: "Hydrated Codex Connector request",
      isDraft: false,
      headRefOid: "head-1924",
      currentHeadCiGreenAt: "2026-05-08T03:09:36Z",
      configuredBotCurrentHeadObservedAt: null,
      codexConnectorReviewRequestedAt: "2026-05-08T03:30:00Z",
      codexConnectorReviewRequestedHeadSha: "head-1924",
    });
    const record = createRecord({
      issue_number: issue.number,
      state: "waiting_ci",
      pr_number: pr.number,
      last_head_sha: pr.headRefOid,
      review_wait_started_at: "2026-05-08T03:09:36Z",
      review_wait_head_sha: pr.headRefOid,
      codex_connector_review_requested_observed_at: null,
      codex_connector_review_requested_head_sha: null,
    });
    const state: SupervisorStateFile = {
      activeIssueNumber: issue.number,
      issues: { [String(issue.number)]: record },
    };

    const result = await handlePostTurnPullRequestTransitionsPhase({
      config,
      stateStore: createNoopStateStore(),
      github: createDefaultGithub({
        addIssueComment: async () => {
          throw new Error("unexpected duplicate Codex Connector request");
        },
      }),
      context: createPostTurnContext({
        issue,
        pr,
        workspacePath: "/tmp/workspaces/issue-1924",
        state,
        record,
      }),
      loadOpenPullRequestSnapshot: async () => ({
        pr,
        checks: [{ name: "build", state: "SUCCESS", bucket: "pass", workflow: "CI" }],
        reviewThreads: [],
      }),
      derivePullRequestLifecycleSnapshot: (currentRecord, currentPr, checks, reviewThreads, recordPatch) =>
        deriveSupervisorPullRequestLifecycleSnapshot(config, currentRecord, currentPr, checks, reviewThreads, recordPatch),
      applyFailureSignature: () => ({ last_failure_signature: null, repeated_failure_signature_count: 0 }),
      blockedReasonFromReviewState: (currentRecord, currentPr, checks, reviewThreads) =>
        resolveBlockedReasonFromReviewState(config, currentRecord, currentPr, checks, reviewThreads),
      summarizeChecks,
      configuredBotReviewThreads: () => [],
      manualReviewThreads: () => [],
      mergeConflictDetected: () => false,
    });

    assert.equal(result.record.codex_connector_review_requested_observed_at, "2026-05-08T03:30:00Z");
    assert.equal(result.record.codex_connector_review_requested_head_sha, pr.headRefOid);
  } finally {
    Date.now = originalDateNow;
  }
});

test("handlePostTurnPullRequestTransitionsPhase re-requests Codex Connector review for a repaired new head", async () => {
  const originalDateNow = Date.now;
  Date.now = () => Date.parse("2026-05-08T04:00:00Z");
  try {
    const config = createConfig({
      reviewBotLogins: ["chatgpt-codex-connector"],
      configuredBotInitialGraceWaitSeconds: 0,
      configuredBotCurrentHeadSignalTimeoutMinutes: 10,
      configuredBotCurrentHeadSignalTimeoutAction: "request_review_comment",
    });
    const issue = createIssue({ number: 1937, title: "Re-request Codex Connector review after repair" });
    const pr = createPullRequest({
      number: 1937,
      title: "Re-request Codex Connector review after repair",
      isDraft: false,
      headRefOid: "head-new-1937",
      currentHeadCiGreenAt: "2026-05-08T03:45:00Z",
      configuredBotCurrentHeadObservedAt: null,
      codexConnectorReviewRequestedAt: null,
      codexConnectorReviewRequestedHeadSha: null,
    });
    const record = createRecord({
      issue_number: issue.number,
      state: "waiting_ci",
      pr_number: pr.number,
      last_head_sha: "head-old-1937",
      review_wait_started_at: "2026-05-08T03:20:00Z",
      review_wait_head_sha: "head-old-1937",
      provider_success_observed_at: "2026-05-08T03:24:00Z",
      provider_success_head_sha: "head-old-1937",
      codex_connector_review_requested_observed_at: "2026-05-08T03:30:00Z",
      codex_connector_review_requested_head_sha: "head-old-1937",
    });
    const state: SupervisorStateFile = {
      activeIssueNumber: issue.number,
      issues: { [String(issue.number)]: record },
    };
    const comments: Array<{ issueNumber: number; body: string }> = [];

    const result = await handlePostTurnPullRequestTransitionsPhase({
      config,
      stateStore: createNoopStateStore(),
      github: createDefaultGithub({
        addIssueComment: async (issueNumber, body) => {
          comments.push({ issueNumber, body });
        },
      }),
      context: createPostTurnContext({
        issue,
        pr,
        workspacePath: path.join(os.tmpdir(), "workspaces", "issue-1937"),
        state,
        record,
      }),
      loadOpenPullRequestSnapshot: async () => ({
        pr,
        checks: [{ name: "build", state: "SUCCESS", bucket: "pass", workflow: "CI" }],
        reviewThreads: [],
      }),
      derivePullRequestLifecycleSnapshot: (currentRecord, currentPr, checks, reviewThreads, recordPatch) =>
        deriveSupervisorPullRequestLifecycleSnapshot(config, currentRecord, currentPr, checks, reviewThreads, recordPatch),
      applyFailureSignature: () => ({ last_failure_signature: null, repeated_failure_signature_count: 0 }),
      blockedReasonFromReviewState: (currentRecord, currentPr, checks, reviewThreads) =>
        resolveBlockedReasonFromReviewState(config, currentRecord, currentPr, checks, reviewThreads),
      summarizeChecks,
      configuredBotReviewThreads: () => [],
      manualReviewThreads: () => [],
      mergeConflictDetected: () => false,
    });

  assert.equal(comments.length, 1);
  assert.equal(comments[0]?.issueNumber, pr.number);
  assert.equal(
    comments[0]?.body ?? "",
      `@codex review\n\n<!-- codex-supervisor:codex-connector-review-request issue=${issue.number} pr=${pr.number} head=${pr.headRefOid} -->`,
    );
    assert.equal(result.record.last_head_sha, pr.headRefOid);
    assert.equal(result.record.provider_success_observed_at, null);
    assert.equal(result.record.provider_success_head_sha, null);
  assert.equal(result.record.codex_connector_review_requested_head_sha, pr.headRefOid);
  assert.ok(result.record.codex_connector_review_requested_observed_at);
  } finally {
    Date.now = originalDateNow;
  }
});

test("handlePostTurnPullRequestTransitionsPhase requests Codex Connector review for processed must-fix metadata residue", async () => {
  const originalDateNow = Date.now;
  Date.now = () => Date.parse("2026-05-13T03:40:00Z");
  try {
    const config = createConfig({
      reviewBotLogins: ["chatgpt-codex-connector"],
      configuredBotInitialGraceWaitSeconds: 0,
      configuredBotCurrentHeadSignalTimeoutMinutes: 10,
      configuredBotCurrentHeadSignalTimeoutAction: "request_review_comment",
    });
    const issue = createIssue({ number: 1960, title: "Request Codex Connector review for processed must-fix residue" });
    const pr = createPullRequest({
      number: 1960,
      title: "Request Codex Connector review for processed must-fix residue",
      isDraft: false,
      headRefOid: "head-1960",
      currentHeadCiGreenAt: "2026-05-13T03:30:00Z",
      configuredBotCurrentHeadObservedAt: null,
      codexConnectorReviewRequestedAt: null,
      codexConnectorReviewRequestedHeadSha: null,
    });
    const mustFixThread = createReviewThread({
      id: "thread-processed-must-fix",
      path: "src/example.ts",
      line: 31,
      comments: {
        nodes: [
          {
            id: "comment-processed-must-fix",
            body: "P2: Fix this before another review request.",
            createdAt: "2026-05-13T03:12:00Z",
            url: "https://example.test/pr/1960#discussion_r1",
            author: {
              login: "chatgpt-codex-connector",
              typeName: "Bot",
            },
          },
        ],
      },
    });
    const record = createRecord({
      issue_number: issue.number,
      state: "waiting_ci",
      pr_number: pr.number,
      last_head_sha: pr.headRefOid,
      review_wait_started_at: "2026-05-13T03:09:36Z",
      review_wait_head_sha: pr.headRefOid,
      copilot_review_timed_out_at: "2026-05-13T03:19:36.000Z",
      copilot_review_timeout_action: "request_review_comment",
      processed_review_thread_ids: [`${mustFixThread.id}@${pr.headRefOid}`],
      processed_review_thread_fingerprints: [`${mustFixThread.id}@${pr.headRefOid}#comment-processed-must-fix`],
      codex_connector_review_requested_observed_at: null,
      codex_connector_review_requested_head_sha: null,
    });
    const state: SupervisorStateFile = {
      activeIssueNumber: issue.number,
      issues: { [String(issue.number)]: record },
    };
    const comments: Array<{ issueNumber: number; body: string }> = [];

    const result = await handlePostTurnPullRequestTransitionsPhase({
      config,
      stateStore: createNoopStateStore(),
      github: createDefaultGithub({
        addIssueComment: async (issueNumber, body) => {
          comments.push({ issueNumber, body });
        },
      }),
      context: createPostTurnContext({
        issue,
        pr,
        workspacePath: path.join(os.tmpdir(), "workspaces", "issue-1960"),
        state,
        record,
      }),
      loadOpenPullRequestSnapshot: async () => ({
        pr,
        checks: [{ name: "build", state: "SUCCESS", bucket: "pass", workflow: "CI" }],
        reviewThreads: [mustFixThread],
      }),
      derivePullRequestLifecycleSnapshot: (currentRecord, currentPr, checks, reviewThreads, recordPatch) =>
        deriveSupervisorPullRequestLifecycleSnapshot(config, currentRecord, currentPr, checks, reviewThreads, recordPatch),
      applyFailureSignature: () => ({ last_failure_signature: null, repeated_failure_signature_count: 0 }),
      blockedReasonFromReviewState: (currentRecord, currentPr, checks, reviewThreads) =>
        resolveBlockedReasonFromReviewState(config, currentRecord, currentPr, checks, reviewThreads),
      summarizeChecks,
      configuredBotReviewThreads,
      manualReviewThreads,
      mergeConflictDetected: () => false,
    });

    assert.equal(comments.length, 1);
    assert.equal(comments[0]?.issueNumber, pr.number);
    assert.equal(
      comments[0]?.body ?? "",
      `@codex review\n\n<!-- codex-supervisor:codex-connector-review-request issue=${issue.number} pr=${pr.number} head=${pr.headRefOid} -->`,
    );
    assert.equal(result.record.codex_connector_review_requested_head_sha, pr.headRefOid);

    const retryResult = await handlePostTurnPullRequestTransitionsPhase({
      config,
      stateStore: createNoopStateStore(),
      github: createDefaultGithub({
        addIssueComment: async () => {
          throw new Error("unexpected duplicate request");
        },
      }),
      context: createPostTurnContext({
        issue,
        pr,
        workspacePath: path.join(os.tmpdir(), "workspaces", "issue-1960"),
        state,
        record: result.record,
      }),
      loadOpenPullRequestSnapshot: async () => ({
        pr: {
          ...pr,
          codexConnectorReviewRequestedAt: result.record.codex_connector_review_requested_observed_at,
          codexConnectorReviewRequestedHeadSha: result.record.codex_connector_review_requested_head_sha,
        },
        checks: [{ name: "build", state: "SUCCESS", bucket: "pass", workflow: "CI" }],
        reviewThreads: [mustFixThread],
      }),
      derivePullRequestLifecycleSnapshot: (currentRecord, currentPr, checks, reviewThreads, recordPatch) =>
        deriveSupervisorPullRequestLifecycleSnapshot(config, currentRecord, currentPr, checks, reviewThreads, recordPatch),
      applyFailureSignature: () => ({ last_failure_signature: null, repeated_failure_signature_count: 0 }),
      blockedReasonFromReviewState: (currentRecord, currentPr, checks, reviewThreads) =>
        resolveBlockedReasonFromReviewState(config, currentRecord, currentPr, checks, reviewThreads),
      summarizeChecks,
      configuredBotReviewThreads,
      manualReviewThreads,
      mergeConflictDetected: () => false,
    });

    assert.equal(comments.length, 1);
    assert.equal(retryResult.record.codex_connector_review_requested_head_sha, pr.headRefOid);
  } finally {
    Date.now = originalDateNow;
  }
});

test("handlePostTurnPullRequestTransitionsPhase re-requests Codex Connector review when stale-head Codex must-fix threads remain", async () => {
  const originalDateNow = Date.now;
  Date.now = () => Date.parse("2026-05-13T04:00:00Z");
  try {
    const config = createConfig({
      reviewBotLogins: ["chatgpt-codex-connector"],
      configuredBotInitialGraceWaitSeconds: 0,
      configuredBotCurrentHeadSignalTimeoutMinutes: 10,
      configuredBotCurrentHeadSignalTimeoutAction: "request_review_comment",
    });
    const issue = createIssue({ number: 1972, title: "Re-request Codex Connector review after stale-head repair" });
    const oldHead = "head-old-1972";
    const pr = createPullRequest({
      number: 1972,
      title: "Re-request Codex Connector review after stale-head repair",
      isDraft: false,
      headRefOid: "head-new-1972",
      currentHeadCiGreenAt: "2026-05-13T03:45:00Z",
      configuredBotCurrentHeadObservedAt: null,
      codexConnectorReviewRequestedAt: null,
      codexConnectorReviewRequestedHeadSha: null,
    });
    const staleMustFixThread = createReviewThread({
      id: "thread-stale-codex-must-fix",
      path: "src/repaired.ts",
      line: 24,
      comments: {
        nodes: [
          {
            id: "comment-stale-codex-must-fix",
            body: "P1: Fix this stale-head issue before merge.",
            createdAt: "2026-05-13T03:12:00Z",
            url: "https://example.test/pr/1972#discussion_r1",
            author: {
              login: "chatgpt-codex-connector",
              typeName: "Bot",
            },
          },
        ],
      },
    });
    const record = createRecord({
      issue_number: issue.number,
      state: "waiting_ci",
      pr_number: pr.number,
      last_head_sha: oldHead,
      review_wait_started_at: "2026-05-13T03:20:00Z",
      review_wait_head_sha: oldHead,
      copilot_review_timed_out_at: "2026-05-13T03:30:00.000Z",
      copilot_review_timeout_action: "request_review_comment",
      codex_connector_review_requested_observed_at: "2026-05-13T03:30:00Z",
      codex_connector_review_requested_head_sha: oldHead,
      processed_review_thread_ids: [`${staleMustFixThread.id}@${oldHead}`],
      processed_review_thread_fingerprints: [`${staleMustFixThread.id}@${oldHead}#comment-stale-codex-must-fix`],
    });
    const state: SupervisorStateFile = {
      activeIssueNumber: issue.number,
      issues: { [String(issue.number)]: record },
    };
    const comments: Array<{ issueNumber: number; body: string }> = [];

    const result = await handlePostTurnPullRequestTransitionsPhase({
      config,
      stateStore: createNoopStateStore(),
      github: createDefaultGithub({
        addIssueComment: async (issueNumber, body) => {
          comments.push({ issueNumber, body });
        },
      }),
      context: createPostTurnContext({
        issue,
        pr,
        workspacePath: path.join(os.tmpdir(), "workspaces", "issue-1972"),
        state,
        record,
      }),
      loadOpenPullRequestSnapshot: async () => ({
        pr,
        checks: [{ name: "build", state: "SUCCESS", bucket: "pass", workflow: "CI" }],
        reviewThreads: [staleMustFixThread],
      }),
      derivePullRequestLifecycleSnapshot: (currentRecord, currentPr, checks, reviewThreads, recordPatch) =>
        deriveSupervisorPullRequestLifecycleSnapshot(config, currentRecord, currentPr, checks, reviewThreads, recordPatch),
      applyFailureSignature: () => ({ last_failure_signature: null, repeated_failure_signature_count: 0 }),
      blockedReasonFromReviewState: (currentRecord, currentPr, checks, reviewThreads) =>
        resolveBlockedReasonFromReviewState(config, currentRecord, currentPr, checks, reviewThreads),
      summarizeChecks,
      configuredBotReviewThreads,
      manualReviewThreads,
      mergeConflictDetected: () => false,
    });

    assert.equal(comments.length, 1);
    assert.equal(
      comments[0]?.body ?? "",
      `@codex review\n\n<!-- codex-supervisor:codex-connector-review-request issue=${issue.number} pr=${pr.number} head=${pr.headRefOid} -->`,
    );
    assert.equal(result.record.state, "waiting_ci");
    assert.notEqual(result.record.state, "ready_to_merge");
    assert.equal(result.record.codex_connector_review_requested_head_sha, pr.headRefOid);
    assert.ok(result.record.codex_connector_review_requested_observed_at);

    const retryPr = {
      ...pr,
      codexConnectorReviewRequestedAt: result.record.codex_connector_review_requested_observed_at,
      codexConnectorReviewRequestedHeadSha: result.record.codex_connector_review_requested_head_sha,
    };
    const retryResult = await handlePostTurnPullRequestTransitionsPhase({
      config,
      stateStore: createNoopStateStore(),
      github: createDefaultGithub({
        addIssueComment: async (issueNumber, body) => {
          comments.push({ issueNumber, body });
        },
      }),
      context: createPostTurnContext({
        issue,
        pr: retryPr,
        workspacePath: path.join(os.tmpdir(), "workspaces", "issue-1972"),
        state,
        record: result.record,
      }),
      loadOpenPullRequestSnapshot: async () => ({
        pr: retryPr,
        checks: [{ name: "build", state: "SUCCESS", bucket: "pass", workflow: "CI" }],
        reviewThreads: [staleMustFixThread],
      }),
      derivePullRequestLifecycleSnapshot: (currentRecord, currentPr, checks, reviewThreads, recordPatch) =>
        deriveSupervisorPullRequestLifecycleSnapshot(config, currentRecord, currentPr, checks, reviewThreads, recordPatch),
      applyFailureSignature: () => ({ last_failure_signature: null, repeated_failure_signature_count: 0 }),
      blockedReasonFromReviewState: (currentRecord, currentPr, checks, reviewThreads) =>
        resolveBlockedReasonFromReviewState(config, currentRecord, currentPr, checks, reviewThreads),
      summarizeChecks,
      configuredBotReviewThreads,
      manualReviewThreads,
      mergeConflictDetected: () => false,
    });

    assert.equal(comments.length, 1);
    assert.equal(retryResult.record.codex_connector_review_requested_head_sha, pr.headRefOid);
  } finally {
    Date.now = originalDateNow;
  }
});

test("handlePostTurnPullRequestTransitionsPhase requests Codex review for stale review commit residue after repair-head recovery", async () => {
  const originalDateNow = Date.now;
  Date.now = () => Date.parse("2026-05-19T09:14:00Z");
  try {
    const config = createConfig({
      reviewBotLogins: ["chatgpt-codex-connector"],
      configuredBotInitialGraceWaitSeconds: 0,
      configuredBotCurrentHeadSignalTimeoutMinutes: 10,
      configuredBotCurrentHeadSignalTimeoutAction: "request_review_comment",
    });
    const issue = createIssue({ number: 143, title: "HRCore stale Codex residue" });
    const currentHead = "c1ac7215a12398842152b1daf42311faef297317";
    const staleReviewHead = "98da2474c530b76dae67b5a6f43e0671b989f65a";
    const pr = createPullRequest({
      number: 147,
      title: "HRCore stale Codex residue",
      isDraft: false,
      headRefOid: currentHead,
      mergeStateStatus: "BLOCKED",
      mergeable: "MERGEABLE",
      currentHeadCiGreenAt: "2026-05-19T09:03:41Z",
      configuredBotCurrentHeadObservedAt: null,
      configuredBotLatestReviewedCommitSha: staleReviewHead,
      codexConnectorReviewRequestedAt: null,
      codexConnectorReviewRequestedHeadSha: null,
    });
    const staleReviewCommitThread = createReviewThread({
      id: "PRRT_kwDOSfC_1M6DF5s7",
      path: "src/local-sqlite.ts",
      line: 120,
      comments: {
        nodes: [
          {
            id: "comment-stale-codex-review-commit",
            body: "P1: Run new migrations for existing local databases.",
            createdAt: "2026-05-19T09:01:00Z",
            url: "https://example.test/pr/147#discussion_r147",
            author: {
              login: "chatgpt-codex-connector",
              typeName: "Bot",
            },
          },
        ],
      },
    });
    const record = createRecord({
      issue_number: issue.number,
      state: "addressing_review",
      pr_number: pr.number,
      last_head_sha: currentHead,
      review_wait_started_at: null,
      review_wait_head_sha: null,
      provider_success_observed_at: "2026-05-19T09:00:00Z",
      provider_success_head_sha: staleReviewHead,
      copilot_review_timed_out_at: "2026-05-19T09:13:41.000Z",
      copilot_review_timeout_action: "request_review_comment",
      codex_connector_review_requested_observed_at: null,
      codex_connector_review_requested_head_sha: null,
    });
    const state: SupervisorStateFile = {
      activeIssueNumber: issue.number,
      issues: { [String(issue.number)]: record },
    };
    const comments: Array<{ issueNumber: number; body: string }> = [];

    const result = await handlePostTurnPullRequestTransitionsPhase({
      config,
      stateStore: createNoopStateStore(),
      github: createDefaultGithub({
        addIssueComment: async (issueNumber, body) => {
          comments.push({ issueNumber, body });
        },
      }),
      context: createPostTurnContext({
        issue,
        pr,
        workspacePath: path.join(os.tmpdir(), "workspaces", "issue-143"),
        state,
        record,
      }),
      loadOpenPullRequestSnapshot: async () => ({
        pr,
        checks: [{ name: "verify-pre-pr", state: "SUCCESS", bucket: "pass", workflow: "CI" }],
        reviewThreads: [staleReviewCommitThread],
      }),
      derivePullRequestLifecycleSnapshot: (currentRecord, currentPr, checks, reviewThreads, recordPatch) =>
        deriveSupervisorPullRequestLifecycleSnapshot(config, currentRecord, currentPr, checks, reviewThreads, recordPatch),
      applyFailureSignature: () => ({ last_failure_signature: null, repeated_failure_signature_count: 0 }),
      blockedReasonFromReviewState: (currentRecord, currentPr, checks, reviewThreads) =>
        resolveBlockedReasonFromReviewState(config, currentRecord, currentPr, checks, reviewThreads),
      summarizeChecks,
      configuredBotReviewThreads,
      manualReviewThreads,
      mergeConflictDetected: () => false,
    });

    assert.equal(comments.length, 1);
    assert.equal(comments[0]?.issueNumber, pr.number);
    assert.equal(
      comments[0]?.body ?? "",
      `@codex review\n\n<!-- codex-supervisor:codex-connector-review-request issue=${issue.number} pr=${pr.number} head=${pr.headRefOid} -->`,
    );
    assert.equal(result.record.codex_connector_review_requested_head_sha, currentHead);
    assert.ok(result.record.codex_connector_review_requested_observed_at);
  } finally {
    Date.now = originalDateNow;
  }
});

test("handlePostTurnPullRequestTransitionsPhase requests current-head Codex review for stale review-commit residue before manual review stop", async () => {
  const originalDateNow = Date.now;
  Date.now = () => Date.parse("2026-05-26T04:00:00Z");
  try {
    const config = createConfig({
      reviewBotLogins: [CODEX_CONNECTOR_REVIEW_BOT_LOGIN],
      configuredBotInitialGraceWaitSeconds: 0,
      configuredBotCurrentHeadSignalTimeoutMinutes: 10,
      configuredBotCurrentHeadSignalTimeoutAction: "request_review_comment",
      verifiedCurrentHeadRepairReviewThreadAutoResolve: true,
    });
    const issue = createIssue({
      number: 2199,
      title: "Recover stale Codex review-commit residue before manual-review stop",
    });
    const staleReviewedHead = "stale-reviewed-head-2199";
    const currentRepairHead = "current-repair-head-2199";
    const pr = createPullRequest({
      number: 2198,
      title: "Repair stale Codex residue",
      isDraft: false,
      headRefOid: currentRepairHead,
      currentHeadCiGreenAt: "2026-05-26T03:55:00Z",
      configuredBotLatestReviewedCommitSha: staleReviewedHead,
      configuredBotCurrentHeadObservedAt: null,
      codexConnectorReviewRequestedAt: null,
      codexConnectorReviewRequestedHeadSha: null,
    });
    const staleReviewCommitThread = createReviewThread({
      id: "thread-stale-review-commit-residue",
      path: "src/supervisor/supervisor-status-review-bot.ts",
      line: 42,
      comments: {
        nodes: [
          {
            id: "comment-stale-review-commit-residue",
            body: "P1: Keep the stale review residue diagnostic formatter exported from the facade.",
            createdAt: "2026-05-26T03:30:00Z",
            url: "https://example.test/pr/2198#discussion_r2199",
            author: {
              login: CODEX_CONNECTOR_REVIEW_BOT_LOGIN,
              typeName: "Bot",
            },
          },
        ],
      },
    });
    const record = createRecord({
      issue_number: issue.number,
      state: "blocked",
      pr_number: pr.number,
      last_head_sha: currentRepairHead,
      blocked_reason: "manual_review",
      last_failure_context: createFailureContext("1 unresolved automated review thread(s) remain."),
      last_failure_signature: "stale-review-commit-residue",
      processed_review_thread_ids: [`${staleReviewCommitThread.id}@${staleReviewedHead}`],
      processed_review_thread_fingerprints: [
        `${staleReviewCommitThread.id}@${staleReviewedHead}#comment-stale-review-commit-residue`,
      ],
      codex_connector_review_requested_observed_at: null,
      codex_connector_review_requested_head_sha: null,
    });
    const state: SupervisorStateFile = {
      activeIssueNumber: issue.number,
      issues: { [String(issue.number)]: record },
    };
    const comments: Array<{ issueNumber: number; body: string }> = [];

    const result = await handlePostTurnPullRequestTransitionsPhase({
      config,
      stateStore: createNoopStateStore(),
      github: createDefaultGithub({
        addIssueComment: async (issueNumber, body) => {
          comments.push({ issueNumber, body });
        },
      }),
      context: createPostTurnContext({
        issue,
        pr,
        workspacePath: path.join(os.tmpdir(), "workspaces", "issue-2199"),
        state,
        record,
      }),
      loadOpenPullRequestSnapshot: async () => ({
        pr,
        checks: [{ name: "build", state: "SUCCESS", bucket: "pass", workflow: "CI" }],
        reviewThreads: [staleReviewCommitThread],
      }),
      derivePullRequestLifecycleSnapshot: (currentRecord, currentPr, checks, reviewThreads, recordPatch) =>
        deriveSupervisorPullRequestLifecycleSnapshot(config, currentRecord, currentPr, checks, reviewThreads, recordPatch),
      applyFailureSignature: () => ({ last_failure_signature: null, repeated_failure_signature_count: 0 }),
      blockedReasonFromReviewState: (currentRecord, currentPr, checks, reviewThreads) =>
        resolveBlockedReasonFromReviewState(config, currentRecord, currentPr, checks, reviewThreads),
      summarizeChecks,
      configuredBotReviewThreads,
      manualReviewThreads,
      mergeConflictDetected: () => false,
    });

    assert.equal(comments.length, 1);
    assert.equal(comments[0]?.issueNumber, pr.number);
    assert.equal(
      comments[0]?.body ?? "",
      `@codex review\n\n<!-- codex-supervisor:codex-connector-review-request issue=${issue.number} pr=${pr.number} head=${currentRepairHead} -->`,
    );
    assert.equal(result.record.state, "waiting_ci");
    assert.equal(result.record.blocked_reason, null);
    assert.equal(result.record.codex_connector_review_requested_head_sha, currentRepairHead);
    assert.ok(result.record.codex_connector_review_requested_observed_at);
  } finally {
    Date.now = originalDateNow;
  }
});

test("handlePostTurnPullRequestTransitionsPhase requests Codex review for blocked stale-head configured-bot signal", async () => {
  const originalDateNow = Date.now;
  Date.now = () => Date.parse("2026-05-19T09:14:00Z");
  try {
    const config = createConfig({
      reviewBotLogins: ["chatgpt-codex-connector"],
      configuredBotInitialGraceWaitSeconds: 0,
      configuredBotCurrentHeadSignalTimeoutMinutes: 10,
      configuredBotCurrentHeadSignalTimeoutAction: "request_review_comment",
    });
    const issue = createIssue({ number: 150, title: "HRCore stale-head Codex request" });
    const currentHead = "48263f7ab1e54762bf467b6a74ca97df3096b178";
    const staleReviewHead = "f26360ae56dea3deaadddb958ad1ef01567aaefb";
    const pr = createPullRequest({
      number: 154,
      title: "HRCore stale-head Codex request",
      isDraft: false,
      headRefOid: currentHead,
      mergeStateStatus: "BLOCKED",
      mergeable: "MERGEABLE",
      currentHeadCiGreenAt: "2026-05-19T09:03:41Z",
      configuredBotCurrentHeadObservedAt: null,
      configuredBotLatestReviewedCommitSha: staleReviewHead,
      codexConnectorReviewRequestedAt: null,
      codexConnectorReviewRequestedHeadSha: null,
    });
    const record = createRecord({
      issue_number: issue.number,
      state: "blocked",
      blocked_reason: "stale_review_bot",
      pr_number: pr.number,
      last_head_sha: currentHead,
      review_wait_started_at: "2026-05-19T09:03:41Z",
      review_wait_head_sha: currentHead,
      provider_success_observed_at: "2026-05-19T09:00:00Z",
      provider_success_head_sha: staleReviewHead,
      external_review_head_sha: staleReviewHead,
      copilot_review_timed_out_at: "2026-05-19T09:13:41.000Z",
      copilot_review_timeout_action: "request_review_comment",
      codex_connector_review_requested_observed_at: null,
      codex_connector_review_requested_head_sha: null,
    });
    const state: SupervisorStateFile = {
      activeIssueNumber: issue.number,
      issues: { [String(issue.number)]: record },
    };
    const comments: Array<{ issueNumber: number; body: string }> = [];

    const result = await handlePostTurnPullRequestTransitionsPhase({
      config,
      stateStore: createNoopStateStore(),
      github: createDefaultGithub({
        addIssueComment: async (issueNumber, body) => {
          comments.push({ issueNumber, body });
          return {
            databaseId: 154001,
            nodeId: "IC_kwDO154",
            url: "https://example.test/pr/154#issuecomment-154001",
          };
        },
      }),
      context: createPostTurnContext({
        issue,
        pr,
        workspacePath: path.join(os.tmpdir(), "workspaces", "issue-150"),
        state,
        record,
      }),
      loadOpenPullRequestSnapshot: async () => ({
        pr,
        checks: [{ name: "verify-pre-pr", state: "SUCCESS", bucket: "pass", workflow: "CI" }],
        reviewThreads: [],
      }),
      derivePullRequestLifecycleSnapshot: (recordForState) =>
        createLifecycleSnapshot(recordForState, "blocked", {
          copilotTimeoutPatch: {
            copilot_review_timed_out_at: "2026-05-19T09:13:41.000Z",
            copilot_review_timeout_action: "request_review_comment",
            copilot_review_timeout_reason: "current_head_signal_timeout",
          },
        }),
      applyFailureSignature: () => ({ last_failure_signature: null, repeated_failure_signature_count: 0 }),
      blockedReasonFromReviewState: () => "stale_review_bot",
      summarizeChecks,
      configuredBotReviewThreads,
      manualReviewThreads,
      mergeConflictDetected: () => false,
    });

    assert.deepEqual(comments, [
      {
        issueNumber: pr.number,
        body: `@codex review\n\n<!-- codex-supervisor:codex-connector-review-request issue=${issue.number} pr=${pr.number} head=${pr.headRefOid} -->`,
      },
    ]);
    assert.equal(result.record.codex_connector_review_requested_head_sha, currentHead);
    assert.ok(result.record.codex_connector_review_requested_observed_at);
    assert.equal(result.record.codex_connector_review_request_comment_identity_status, "available");
    assert.equal(result.record.codex_connector_review_request_comment_database_id, 154001);

    const duplicateState: SupervisorStateFile = {
      activeIssueNumber: issue.number,
      issues: { [String(issue.number)]: result.record },
    };
    const duplicateResult = await handlePostTurnPullRequestTransitionsPhase({
      config,
      stateStore: createNoopStateStore(),
      github: createDefaultGithub({
        addIssueComment: async (issueNumber, body) => {
          comments.push({ issueNumber, body });
        },
      }),
      context: createPostTurnContext({
        issue,
        pr: {
          ...pr,
          codexConnectorReviewRequestedAt: result.record.codex_connector_review_requested_observed_at,
          codexConnectorReviewRequestedHeadSha: result.record.codex_connector_review_requested_head_sha,
        },
        workspacePath: path.join(os.tmpdir(), "workspaces", "issue-150"),
        state: duplicateState,
        record: result.record,
      }),
      loadOpenPullRequestSnapshot: async () => ({
        pr: {
          ...pr,
          codexConnectorReviewRequestedAt: result.record.codex_connector_review_requested_observed_at,
          codexConnectorReviewRequestedHeadSha: result.record.codex_connector_review_requested_head_sha,
        },
        checks: [{ name: "verify-pre-pr", state: "SUCCESS", bucket: "pass", workflow: "CI" }],
        reviewThreads: [],
      }),
      derivePullRequestLifecycleSnapshot: (recordForState) =>
        createLifecycleSnapshot(recordForState, "blocked", {
          codexConnectorRequestObservationPatch: {},
          copilotTimeoutPatch: {
            copilot_review_timed_out_at: result.record.copilot_review_timed_out_at,
            copilot_review_timeout_action: result.record.copilot_review_timeout_action,
            copilot_review_timeout_reason: result.record.copilot_review_timeout_reason,
          },
        }),
      applyFailureSignature: () => ({ last_failure_signature: null, repeated_failure_signature_count: 0 }),
      blockedReasonFromReviewState: () => "stale_review_bot",
      summarizeChecks,
      configuredBotReviewThreads,
      manualReviewThreads,
      mergeConflictDetected: () => false,
    });

    assert.equal(
      comments.filter((comment) => comment.body.includes("codex-supervisor:codex-connector-review-request")).length,
      1,
      JSON.stringify(comments),
    );
    assert.equal(duplicateResult.record.codex_connector_review_requested_head_sha, currentHead);
  } finally {
    Date.now = originalDateNow;
  }
});

test("handlePostTurnPullRequestTransitionsPhase requests current-head Codex review despite repeat-stop on outdated metadata-only residue", async () => {
  const config = createConfig({
    reviewBotLogins: [CODEX_CONNECTOR_REVIEW_BOT_LOGIN],
    configuredBotCurrentHeadSignalTimeoutAction: "request_review_comment",
  });
  const issue = createIssue({ number: 168, title: "Fix stale Codex metadata-only residue" });
  const headSha = "f3addc310b0ff8e4fc53d9f3e0ab783af70a552f";
  const staleReviewedSha = "d0800e414f305e8ce4f4f9785fc4ee6ad2ba0c90";
  const pr = createPullRequest({
    number: 176,
    title: "Tracked PR with stale metadata-only Codex residue",
    isDraft: false,
    headRefOid: headSha,
    mergeable: "MERGEABLE",
    mergeStateStatus: "BLOCKED",
    currentHeadCiGreenAt: "2026-05-21T20:32:06Z",
    configuredBotLatestReviewedCommitSha: staleReviewedSha,
    configuredBotCurrentHeadObservedAt: null,
    configuredBotCurrentHeadObservationSource: null,
    configuredBotCurrentHeadStatusState: null,
    configuredBotTopLevelReviewStrength: null,
    codexConnectorReviewRequestedAt: null,
    codexConnectorReviewRequestedHeadSha: null,
  });
  const reviewThreads = createOutdatedConfiguredBotThreads(
    ["thread-date-fields", "thread-correlation-id", "thread-email-expectation", "thread-onboarding-strings"],
    pr.number,
  );
  const staleBotFailureContext = {
    ...createFailureContext("Outdated configured-bot metadata-only residue is blocking the tracked PR."),
    signature: reviewThreads.map((thread) => `stalled-bot:${thread.id}`).join("|"),
    details: reviewThreads.map(
      (thread) =>
        `reviewer=${CODEX_CONNECTOR_REVIEW_BOT_LOGIN} file=${thread.path} line=${thread.line} processed_on_current_head=yes`,
    ),
    url: "https://example.test/pr/176#discussion_rmetadata",
  };
  const state: SupervisorStateFile = {
    activeIssueNumber: issue.number,
    issues: {
      [String(issue.number)]: createRecord({
        issue_number: issue.number,
        state: "blocked",
        pr_number: pr.number,
        last_head_sha: headSha,
        blocked_reason: "stale_review_bot",
        last_tracked_pr_repeat_failure_decision: "stop_no_progress",
        last_tracked_pr_progress_summary: "recovery_blocked=stale_review_bot_no_auto_retry",
        repeated_failure_signature_count: 5,
        last_failure_signature: staleBotFailureContext.signature,
        last_failure_context: staleBotFailureContext,
        processed_review_thread_ids: reviewThreads.map((thread) => `${thread.id}@${headSha}`),
        processed_review_thread_fingerprints: reviewThreads.map(
          (thread) => `${thread.id}@${headSha}#comment-${thread.id}`,
        ),
        codex_connector_review_requested_observed_at: null,
        codex_connector_review_requested_head_sha: null,
      }),
    },
  };
  const requestComments: string[] = [];

  const result = await handlePostTurnPullRequestTransitionsPhase({
    config,
    stateStore: createNoopStateStore(),
    github: createDefaultGithub({
      addIssueComment: async (_prNumber: number, body: string) => {
        requestComments.push(body);
        return {
          databaseId: 176001,
          nodeId: "IC_kwDO176",
          url: "https://example.test/pr/176#issuecomment-176001",
        };
      },
      replyToReviewThread: async () => {
        throw new Error("unexpected replyToReviewThread call");
      },
      resolveReviewThread: async () => {
        throw new Error("unexpected resolveReviewThread call");
      },
    }),
    context: createPostTurnContext({
      state,
      record: state.issues[String(issue.number)]!,
      issue,
      pr,
      workspacePath: path.join("/tmp/workspaces", "issue-168"),
    }),
    derivePullRequestLifecycleSnapshot: (recordForState) =>
      createLifecycleSnapshot(recordForState, "blocked", {
        failureContext: staleBotFailureContext,
        copilotTimeoutPatch: {
          copilot_review_timed_out_at: "2026-05-21T20:42:06Z",
          copilot_review_timeout_action: "request_review_comment",
          copilot_review_timeout_reason: "current_head_signal_timeout",
        },
      }),
    applyFailureSignature: (_record, failureContext) => ({
      last_failure_signature: failureContext?.signature ?? null,
      repeated_failure_signature_count: failureContext ? 5 : 0,
    }),
    blockedReasonFromReviewState: () => "stale_review_bot",
    summarizeChecks,
    configuredBotReviewThreads,
    manualReviewThreads,
    mergeConflictDetected: () => false,
    runLocalCiCommand: async () => undefined,
    runWorkstationLocalPathGate: async () => ({
      ok: true,
      failureContext: null,
    }),
    loadOpenPullRequestSnapshot: async () => ({
      pr,
      checks: [{ name: "verify-pre-pr", state: "SUCCESS", bucket: "pass", workflow: "CI" }],
      reviewThreads,
    }),
  });

  assert.equal(requestComments.length, 1);
  assert.match(requestComments[0] ?? "", /^@codex review\b/);
  assert.match(requestComments[0] ?? "", /codex-supervisor:codex-connector-review-request/);
  assert.equal(result.record.state, "waiting_ci");
  assert.equal(result.record.blocked_reason, null);
  assert.equal(result.record.codex_connector_review_requested_head_sha, headSha);
  assert.ok(result.record.codex_connector_review_requested_observed_at);
  assert.equal(result.record.last_failure_context, null);
  assert.equal(result.record.repeated_failure_signature_count, 0);
});

test("handlePostTurnPullRequestTransitionsPhase resolves verified no-source-change Codex threads after current-head success", async () => {
  const config = createConfig({
    reviewBotLogins: [CODEX_CONNECTOR_REVIEW_BOT_LOGIN],
    configuredBotCurrentHeadSignalTimeoutAction: "request_review_comment",
    verifiedNoSourceChangeReviewThreadAutoResolve: true,
  });
  const issue = createIssue({ title: "Resolve verified no-source-change Codex thread residue" });
  const scenario = createCodexConnectorTrackedReviewResidueScenario({
    issueNumber: issue.number,
    prNumber: 1985,
    headSha: "head-1985",
    threadId: "thread-codex",
    commentId: "comment-codex",
    path: "src/review.ts",
    line: 7,
    commentBody: "P1: This finding was verified as no source change needed.",
    discussionUrl: "https://example.test/pr/1985#discussion_r1985",
    currentHeadNoMajorReview: {
      requestedAt: "2026-05-15T00:12:00Z",
      observedAt: "2026-05-15T00:17:00Z",
    },
  });
  const pr = createPullRequest({
    ...scenario.pullRequestPatch,
    configuredBotCurrentHeadObservedAt: "2026-05-15T00:17:00Z",
  });
  const state: SupervisorStateFile = {
    activeIssueNumber: 102,
    issues: {
      "102": createRecord({
        ...scenario.recordPatch,
        latest_local_ci_result: {
          outcome: "passed",
          summary: "Focused verifier proved the current head no longer reproduces the finding.",
          ran_at: "2026-05-15T00:18:00Z",
          head_sha: "head-1985",
          execution_mode: "shell",
          command: "npm test -- src/post-turn-pull-request.test.ts",
          failure_class: null,
          remediation_target: null,
        },
      }),
    },
  };
  const reviewThreads = [scenario.reviewThread] satisfies ReviewThread[];
  const replyCalls: Array<{ threadId: string; body: string }> = [];
  const resolveCalls: string[] = [];
  const requestComments: string[] = [];
  let snapshotLoads = 0;

  const result = await handlePostTurnPullRequestTransitionsPhase({
    config,
    stateStore: createNoopStateStore(),
    github: createDefaultGithub({
      addIssueComment: async (_prNumber: number, body: string) => {
        requestComments.push(body);
        return {
          databaseId: 1985001,
          nodeId: "IC_kwDO1985",
          url: "https://example.test/pr/1985#issuecomment-1985001",
        };
      },
      replyToReviewThread: async (threadId: string, body: string) => {
        replyCalls.push({ threadId, body });
      },
      resolveReviewThread: async (threadId: string) => {
        resolveCalls.push(threadId);
      },
    }),
    context: createPostTurnContext({
      state,
      record: state.issues["102"]!,
      issue,
      pr,
      workspacePath: path.join("/tmp/workspaces", "issue-102"),
    }),
    derivePullRequestLifecycleSnapshot: (recordForState, _pr, _checks, currentReviewThreads) =>
      createLifecycleSnapshot(recordForState, currentReviewThreads.length === 0 ? "waiting_ci" : "blocked", {
        failureContext: currentReviewThreads.length === 0 ? null : scenario.staleReviewFailureContext,
        copilotTimeoutPatch: {
          copilot_review_timed_out_at: "2026-05-15T00:20:00Z",
          copilot_review_timeout_action: "request_review_comment",
          copilot_review_timeout_reason: "current_head_signal_timeout",
        },
      }),
    applyFailureSignature: (_record, failureContext) => ({
      last_failure_signature: failureContext?.signature ?? null,
      repeated_failure_signature_count: failureContext ? 1 : 0,
    }),
    blockedReasonFromReviewState: (_record, _pr, _checks, currentReviewThreads) =>
      currentReviewThreads.length === 0 ? null : "stale_review_bot",
    summarizeChecks,
    configuredBotReviewThreads,
    manualReviewThreads,
    mergeConflictDetected: () => false,
    runLocalCiCommand: async () => undefined,
    runWorkstationLocalPathGate: async () => ({
      ok: true,
      failureContext: null,
    }),
    loadOpenPullRequestSnapshot: async () => {
      snapshotLoads += 1;
      return {
        pr,
        checks: scenario.passingChecks,
        reviewThreads: snapshotLoads <= 2 ? reviewThreads : [],
      };
    },
  });

  assert.equal(result.record.state, "waiting_ci");
  assert.deepEqual(replyCalls.map((call) => call.threadId), ["thread-codex"]);
  assert.deepEqual(resolveCalls, ["thread-codex"]);
  assert.match(replyCalls[0]?.body ?? "", /reason=verified_no_source_change_auto_resolve/);
  assert.match(replyCalls[0]?.body ?? "", /issue=#102 pr=#1985 head=head-1985 thread=thread-codex/);
  assert.equal(requestComments.length, 0);
});

test("handlePostTurnPullRequestTransitionsPhase resolves verified current-head repair Codex threads only with the repair opt-in", async () => {
  const config = createConfig({
    reviewBotLogins: [CODEX_CONNECTOR_REVIEW_BOT_LOGIN],
    configuredBotCurrentHeadSignalTimeoutAction: "request_review_comment",
    verifiedCurrentHeadRepairReviewThreadAutoResolve: true,
  });
  const issue = createIssue({ title: "Resolve verified current-head repair Codex thread residue" });
  const scenario = createCodexConnectorTrackedReviewResidueScenario({
    issueNumber: issue.number,
    prNumber: 1988,
    headSha: "head-1988",
    threadId: "thread-codex-repair",
    commentId: "comment-codex-repair",
    path: "src/review.ts",
    line: 7,
    commentBody: "P1: Verify the repair covers this finding before merge.",
    discussionUrl: "https://example.test/pr/1988#discussion_r1988",
    verifiedRepair: {
      summary: "Focused verifier passed after the repair commit.",
      ranAt: "2026-05-15T00:18:00Z",
      command: "npm test -- src/post-turn-pull-request.test.ts",
      evidenceSource: "codex_turn_timeline_artifact",
    },
    currentHeadNoMajorReview: {
      requestedAt: "2026-05-15T00:12:00Z",
      observedAt: "2026-05-15T00:17:00Z",
    },
  });
  const pr = createPullRequest(scenario.pullRequestPatch);
  const state: SupervisorStateFile = {
    activeIssueNumber: 102,
    issues: {
      "102": createRecord(scenario.recordPatch),
    },
  };
  const reviewThreads = [scenario.reviewThread] satisfies ReviewThread[];
  const replyCalls: Array<{ threadId: string; body: string }> = [];
  const resolveCalls: string[] = [];
  const requestComments: string[] = [];
  let snapshotLoads = 0;

  const result = await handlePostTurnPullRequestTransitionsPhase({
    config,
    stateStore: createNoopStateStore(),
    github: createDefaultGithub({
      addIssueComment: async (_prNumber: number, body: string) => {
        requestComments.push(body);
        return {
          databaseId: 1988001,
          nodeId: "IC_kwDO1988",
          url: "https://example.test/pr/1988#issuecomment-1988001",
        };
      },
      replyToReviewThread: async (threadId: string, body: string) => {
        replyCalls.push({ threadId, body });
      },
      resolveReviewThread: async (threadId: string) => {
        resolveCalls.push(threadId);
      },
    }),
    context: createPostTurnContext({
      state,
      record: state.issues["102"]!,
      issue,
      pr,
      workspacePath: path.join("/tmp/workspaces", "issue-102"),
    }),
    derivePullRequestLifecycleSnapshot: (recordForState, _pr, _checks, currentReviewThreads) =>
      createLifecycleSnapshot(recordForState, currentReviewThreads.length === 0 ? "waiting_ci" : "blocked", {
        failureContext: currentReviewThreads.length === 0 ? null : scenario.staleReviewFailureContext,
        copilotTimeoutPatch: {
          copilot_review_timed_out_at: "2026-05-15T00:20:00Z",
          copilot_review_timeout_action: "request_review_comment",
          copilot_review_timeout_reason: "current_head_signal_timeout",
        },
      }),
    applyFailureSignature: (_record, failureContext) => ({
      last_failure_signature: failureContext?.signature ?? null,
      repeated_failure_signature_count: failureContext ? 1 : 0,
    }),
    blockedReasonFromReviewState: (_record, _pr, _checks, currentReviewThreads) =>
      currentReviewThreads.length === 0 ? null : "stale_review_bot",
    summarizeChecks,
    configuredBotReviewThreads,
    manualReviewThreads,
    mergeConflictDetected: () => false,
    runLocalCiCommand: async () => undefined,
    runWorkstationLocalPathGate: async () => ({
      ok: true,
      failureContext: null,
    }),
    loadOpenPullRequestSnapshot: async () => {
      snapshotLoads += 1;
      return {
        pr,
        checks: scenario.passingChecks,
        reviewThreads: snapshotLoads <= 2 ? reviewThreads : [],
      };
    },
  });

  assert.equal(result.record.state, "waiting_ci");
  assert.deepEqual(replyCalls.map((call) => call.threadId), ["thread-codex-repair"]);
  assert.deepEqual(resolveCalls, ["thread-codex-repair"]);
  assert.match(replyCalls[0]?.body ?? "", /reason=verified_current_head_repair_auto_resolve/);
  assert.doesNotMatch(replyCalls[0]?.body ?? "", /verified_no_source_change_auto_resolve/);
  assert.equal(requestComments.length, 0);
});

test("handlePostTurnPullRequestTransitionsPhase resolves verified current-head repair Codex threads even when review state falls through to manual_review", async () => {
  const config = createConfig({
    reviewBotLogins: [CODEX_CONNECTOR_REVIEW_BOT_LOGIN],
    configuredBotCurrentHeadSignalTimeoutAction: "request_review_comment",
    verifiedCurrentHeadRepairReviewThreadAutoResolve: true,
  });
  const issue = createIssue({ title: "Resolve verified repair thread after manual_review fallthrough" });
  const scenario = createCodexConnectorTrackedReviewResidueScenario({
    issueNumber: issue.number,
    prNumber: 2034,
    headSha: "head-2034",
    threadId: "thread-codex-manual-fallthrough",
    commentId: "comment-codex-manual-fallthrough",
    path: "src/review.ts",
    line: 300,
    commentBody: "P2: Validate group keys before encoding projection metadata.",
    discussionUrl: "https://example.test/pr/2034#discussion_r2034",
    verifiedRepair: {
      summary: "Focused verifier passed after the repair commit.",
      ranAt: "2026-05-18T07:18:00Z",
      command: "npm test -- --test-name-pattern \"malformed projection key|group projection\"",
      evidenceSource: "codex_turn_timeline_artifact",
    },
    currentHeadNoMajorReview: {
      requestedAt: "2026-05-18T07:12:00Z",
      observedAt: "2026-05-18T07:17:00Z",
    },
  });
  const pr = createPullRequest({
    ...scenario.pullRequestPatch,
    mergeable: "MERGEABLE",
    mergeStateStatus: "CLEAN",
  });
  const state: SupervisorStateFile = {
    activeIssueNumber: 102,
    issues: {
      "102": createRecord(scenario.recordPatch),
    },
  };
  const reviewThreads = [scenario.reviewThread] satisfies ReviewThread[];
  const replyCalls: Array<{ threadId: string; body: string }> = [];
  const resolveCalls: string[] = [];
  let snapshotLoads = 0;

  const result = await handlePostTurnPullRequestTransitionsPhase({
    config,
    stateStore: createNoopStateStore(),
    github: createDefaultGithub({
      addIssueComment: async () => ({
        databaseId: 2034001,
        nodeId: "IC_kwDO2034",
        url: "https://example.test/pr/2034#issuecomment-2034001",
      }),
      replyToReviewThread: async (threadId: string, body: string) => {
        replyCalls.push({ threadId, body });
      },
      resolveReviewThread: async (threadId: string) => {
        resolveCalls.push(threadId);
      },
    }),
    context: createPostTurnContext({
      state,
      record: state.issues["102"]!,
      issue,
      pr,
      workspacePath: path.join("/tmp/workspaces", "issue-102"),
    }),
    derivePullRequestLifecycleSnapshot: (recordForState, _pr, _checks, currentReviewThreads) =>
      createLifecycleSnapshot(recordForState, currentReviewThreads.length === 0 ? "waiting_ci" : "blocked", {
        failureContext: currentReviewThreads.length === 0 ? null : scenario.staleReviewFailureContext,
      }),
    applyFailureSignature: (_record, failureContext) => ({
      last_failure_signature: failureContext?.signature ?? null,
      repeated_failure_signature_count: failureContext ? 1 : 0,
    }),
    blockedReasonFromReviewState: (_record, _pr, _checks, currentReviewThreads) =>
      currentReviewThreads.length === 0 ? null : "manual_review",
    summarizeChecks,
    configuredBotReviewThreads,
    manualReviewThreads,
    mergeConflictDetected: () => false,
    runLocalCiCommand: async () => undefined,
    runWorkstationLocalPathGate: async () => ({
      ok: true,
      failureContext: null,
    }),
    loadOpenPullRequestSnapshot: async () => {
      snapshotLoads += 1;
      return {
        pr,
        checks: scenario.passingChecks,
        reviewThreads: snapshotLoads <= 2 ? reviewThreads : [],
      };
    },
  });

  assert.equal(result.record.state, "waiting_ci");
  assert.equal(result.record.blocked_reason, null);
  assert.deepEqual(replyCalls.map((call) => call.threadId), ["thread-codex-manual-fallthrough"]);
  assert.deepEqual(resolveCalls, ["thread-codex-manual-fallthrough"]);
  assert.match(replyCalls[0]?.body ?? "", /reason=verified_current_head_repair_auto_resolve/);
});

test("handlePostTurnPullRequestTransitionsPhase keeps verified repair thread resolution fail-closed without opt-in or current codex_turn evidence", async () => {
  const cases: Array<{
    name: string;
    autoResolve?: boolean;
    reviewThreadAuthor?: { login: string; typeName: "Bot" | "User" };
    timelineArtifacts: IssueRunRecord["timeline_artifacts"];
  }> = [
    {
      name: "repair opt-in disabled",
      autoResolve: false,
      timelineArtifacts: [
        {
          type: "verification_result",
          gate: "codex_turn",
          command: "npx tsx --test src/post-turn-pull-request.test.ts",
          head_sha: "head-2000",
          outcome: "passed",
          remediation_target: null,
          next_action: "continue",
          summary: "Focused verifier passed after the repair commit.",
          recorded_at: "2026-05-15T00:18:00Z",
        },
      ],
    },
    {
      name: "missing codex_turn artifact",
      timelineArtifacts: [],
    },
    {
      name: "failed codex_turn artifact",
      timelineArtifacts: [
        {
          type: "verification_result" as const,
          gate: "codex_turn" as const,
          command: "npx tsx --test src/post-turn-pull-request.test.ts",
          head_sha: "head-2000",
          outcome: "failed" as const,
          remediation_target: null,
          next_action: "continue",
          summary: "Focused verifier failed after the repair commit.",
          recorded_at: "2026-05-15T00:18:00Z",
        },
      ],
    },
    {
      name: "stale-head codex_turn artifact",
      timelineArtifacts: [
        {
          type: "verification_result" as const,
          gate: "codex_turn" as const,
          command: "npx tsx --test src/post-turn-pull-request.test.ts",
          head_sha: "stale-head-2000",
          outcome: "passed" as const,
          remediation_target: null,
          next_action: "continue",
          summary: "Focused verifier passed before the repair commit.",
          recorded_at: "2026-05-15T00:18:00Z",
        },
      ],
    },
    {
      name: "different-head codex_turn artifact",
      timelineArtifacts: [
        {
          type: "verification_result" as const,
          gate: "codex_turn" as const,
          command: "npx tsx --test src/post-turn-pull-request.test.ts",
          head_sha: "head-elsewhere",
          outcome: "passed" as const,
          remediation_target: null,
          next_action: "continue",
          summary: "Focused verifier passed on another PR head.",
          recorded_at: "2026-05-15T00:18:00Z",
        },
      ],
    },
    {
      name: "current-head non-codex verification artifact",
      timelineArtifacts: [
        {
          type: "verification_result" as const,
          gate: "workspace_preparation" as const,
          command: "node dist/index.js issue-lint 2000 --config <supervisor-config-path>",
          head_sha: "head-2000",
          outcome: "passed" as const,
          remediation_target: null,
          next_action: "continue",
          summary: "Workspace preparation passed but is not repair verification.",
          recorded_at: "2026-05-15T00:18:00Z",
        },
      ],
    },
    {
      name: "manual review thread",
      reviewThreadAuthor: { login: "human-reviewer", typeName: "User" },
      timelineArtifacts: [
        {
          type: "verification_result",
          gate: "codex_turn",
          command: "npx tsx --test src/post-turn-pull-request.test.ts",
          head_sha: "head-2000",
          outcome: "passed",
          remediation_target: null,
          next_action: "continue",
          summary: "Focused verifier passed after the repair commit.",
          recorded_at: "2026-05-15T00:18:00Z",
        },
      ],
    },
    {
      name: "unconfigured bot review thread",
      reviewThreadAuthor: { login: "unconfigured-review-bot", typeName: "Bot" },
      timelineArtifacts: [
        {
          type: "verification_result",
          gate: "codex_turn",
          command: "npx tsx --test src/post-turn-pull-request.test.ts",
          head_sha: "head-2000",
          outcome: "passed",
          remediation_target: null,
          next_action: "continue",
          summary: "Focused verifier passed after the repair commit.",
          recorded_at: "2026-05-15T00:18:00Z",
        },
      ],
    },
  ];

  for (const testCase of cases) {
    const config = createConfig({
      reviewBotLogins: [CODEX_CONNECTOR_REVIEW_BOT_LOGIN],
      configuredBotCurrentHeadSignalTimeoutAction: "request_review_comment",
      verifiedCurrentHeadRepairReviewThreadAutoResolve: testCase.autoResolve ?? true,
    });
    const issue = createIssue({ title: `Keep ${testCase.name} blocked` });
    const scenario = createCodexConnectorTrackedReviewResidueScenario({
      issueNumber: issue.number,
      prNumber: 2000,
      headSha: "head-2000",
      threadId: `thread-${testCase.name.replace(/[^a-z0-9]+/giu, "-")}`,
      commentId: `comment-${testCase.name.replace(/[^a-z0-9]+/giu, "-")}`,
      path: "src/review.ts",
      line: 7,
      commentBody: "P1: Verify the repair covers this finding before merge.",
      discussionUrl: "https://example.test/pr/2000#discussion_r2000",
    });
    const pr = createPullRequest(scenario.pullRequestPatch);
    const state: SupervisorStateFile = {
      activeIssueNumber: 102,
      issues: {
        "102": createRecord({
          ...scenario.recordPatch,
          latest_local_ci_result: null,
          timeline_artifacts: testCase.timelineArtifacts,
        }),
      },
    };
    const reviewThread = testCase.reviewThreadAuthor
      ? {
          ...scenario.reviewThread,
          comments: {
            nodes: scenario.reviewThread.comments.nodes.map((comment) => ({
              ...comment,
              author: testCase.reviewThreadAuthor!,
            })),
          },
        }
      : scenario.reviewThread;
    const replyCalls: Array<{ threadId: string; body: string }> = [];
    const resolveCalls: string[] = [];

    const result = await handlePostTurnPullRequestTransitionsPhase({
      config,
      stateStore: createNoopStateStore(),
      github: createDefaultGithub({
        addIssueComment: async () => {
          throw new Error("unexpected addIssueComment call");
        },
        replyToReviewThread: async (threadId: string, body: string) => {
          replyCalls.push({ threadId, body });
        },
        resolveReviewThread: async (threadId: string) => {
          resolveCalls.push(threadId);
        },
      }),
      context: createPostTurnContext({
        state,
        record: state.issues["102"]!,
        issue,
        pr,
        workspacePath: path.join("/tmp/workspaces", "issue-102"),
      }),
      derivePullRequestLifecycleSnapshot: (recordForState) =>
        createLifecycleSnapshot(recordForState, "blocked", {
          failureContext: scenario.staleReviewFailureContext,
        }),
      applyFailureSignature: (_record, failureContext) => ({
        last_failure_signature: failureContext?.signature ?? null,
        repeated_failure_signature_count: failureContext ? 1 : 0,
      }),
      blockedReasonFromReviewState: () => "stale_review_bot",
      summarizeChecks,
      configuredBotReviewThreads,
      manualReviewThreads,
      mergeConflictDetected: () => false,
      runLocalCiCommand: async () => undefined,
      runWorkstationLocalPathGate: async () => ({
        ok: true,
        failureContext: null,
      }),
      loadOpenPullRequestSnapshot: async () => ({
        pr,
        checks: scenario.passingChecks,
        reviewThreads: [reviewThread],
      }),
    });

    assert.equal(result.record.state, "blocked", testCase.name);
    assert.deepEqual(replyCalls, [], testCase.name);
    assert.deepEqual(resolveCalls, [], testCase.name);
  }
});
