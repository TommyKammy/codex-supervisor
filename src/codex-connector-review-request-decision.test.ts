import test from "node:test";
import assert from "node:assert/strict";
import {
  codexConnectorCurrentHeadReviewReadiness,
  codexConnectorReviewRequestAction,
} from "./codex-connector-review-request-decision";
import {
  codexConnectorPassingChecks,
  createCodexConnectorRequestRetryScenario,
  createCodexConnectorSameHeadRequestScenario,
  createCodexConnectorStaleHeadRequestScenario,
  createCodexConnectorStaleReviewCommitRequestScenario,
  type CodexConnectorReviewRequestScenario,
} from "./codex-connector-tracked-pr-test-helpers";
import type { PullRequestCheck, ReviewThread, SupervisorConfig } from "./core/types";
import { createConfig, createPullRequest, createRecord, createReviewThread } from "./turn-execution-test-helpers";

function createCodexConfig(overrides: Partial<SupervisorConfig> = {}): SupervisorConfig {
  return createConfig({
    reviewBotLogins: ["chatgpt-codex-connector"],
    configuredBotInitialGraceWaitSeconds: 0,
    configuredBotCurrentHeadSignalTimeoutMinutes: 10,
    configuredBotCurrentHeadSignalTimeoutAction: "request_review_comment",
    codexConnectorReviewRequestNoResponseMinutes: 10,
    codexConnectorReviewRequestRetryLimit: 1,
    ...overrides,
  });
}

function summarizeChecks(checks: PullRequestCheck[]) {
  return {
    hasPending: checks.some((check) => check.bucket === "pending"),
    hasFailing: checks.some((check) => check.bucket === "fail"),
  };
}

const passingChecks: PullRequestCheck[] = codexConnectorPassingChecks;

function decide(overrides: {
  config?: Partial<SupervisorConfig>;
  record?: Parameters<typeof createRecord>[0];
  pr?: Parameters<typeof createPullRequest>[0];
  checks?: PullRequestCheck[];
  reviewThreads?: ReviewThread[];
  configuredThreads?: ReviewThread[];
  manualThreads?: ReviewThread[];
  mergeConflict?: boolean;
  now?: string;
} = {}) {
  const config = createCodexConfig(overrides.config);
  const reviewThreads = overrides.reviewThreads ?? [];
  return codexConnectorReviewRequestAction({
    config,
    record: createRecord({
      state: "waiting_ci",
      pr_number: 1995,
      last_head_sha: "head-1995",
      review_wait_started_at: "2026-05-08T03:09:36Z",
      review_wait_head_sha: "head-1995",
      copilot_review_timed_out_at: "2026-05-08T03:19:36.000Z",
      copilot_review_timeout_action: "request_review_comment",
      codex_connector_review_requested_observed_at: null,
      codex_connector_review_requested_head_sha: null,
      ...overrides.record,
    }),
    pr: createPullRequest({
      number: 1995,
      headRefOid: "head-1995",
      isDraft: false,
      currentHeadCiGreenAt: "2026-05-08T03:09:36Z",
      configuredBotCurrentHeadObservedAt: null,
      codexConnectorReviewRequestedAt: null,
      codexConnectorReviewRequestedHeadSha: null,
      ...overrides.pr,
    }),
    checks: overrides.checks ?? passingChecks,
    reviewThreads,
    summarizeChecks,
    configuredBotReviewThreads: () => overrides.configuredThreads ?? [],
    manualReviewThreads: () => overrides.manualThreads ?? [],
    mergeConflictDetected: () => overrides.mergeConflict ?? false,
    nowMs: () => Date.parse(overrides.now ?? "2026-05-08T03:30:00Z"),
  });
}

function decideScenario(scenario: CodexConnectorReviewRequestScenario) {
  return decide({
    record: scenario.recordPatch,
    pr: scenario.pullRequestPatch,
    checks: scenario.checks,
    reviewThreads: scenario.reviewThreads,
    configuredThreads: scenario.configuredThreads,
    now: scenario.now,
  });
}

test("codexConnectorReviewRequestAction selects an initial request without GitHub mutation inputs", () => {
  assert.deepEqual(decide(), { kind: "initial" });
});

test("codexConnectorCurrentHeadReviewReadiness exposes shared wait/request gating vocabulary", () => {
  const config = createCodexConfig();
  const pr = createPullRequest({
    number: 1995,
    headRefOid: "head-1995",
    isDraft: false,
    currentHeadCiGreenAt: "2026-05-08T03:09:36Z",
    configuredBotCurrentHeadObservedAt: null,
  });

  assert.deepEqual(
    codexConnectorCurrentHeadReviewReadiness({
      config,
      pr,
      checks: passingChecks,
      manualThreadCount: 0,
      configuredThreadsAreSafe: true,
      checkSummary: summarizeChecks(passingChecks),
      mergeConflict: false,
    }),
    { kind: "eligible" },
  );
  assert.deepEqual(
    codexConnectorCurrentHeadReviewReadiness({
      config,
      pr,
      checks: [],
      manualThreadCount: 0,
      configuredThreadsAreSafe: true,
      checkSummary: summarizeChecks([]),
      mergeConflict: false,
    }),
    { kind: "eligible" },
  );
  assert.deepEqual(
    codexConnectorCurrentHeadReviewReadiness({
      config: createCodexConfig({ localCiCommand: "npm test" }),
      pr: createPullRequest({
        ...pr,
        currentHeadCiGreenAt: null,
      }),
      checks: [],
      manualThreadCount: 0,
      configuredThreadsAreSafe: true,
      checkSummary: summarizeChecks([]),
      mergeConflict: false,
    }),
    { kind: "none", reason: "missing_fallback_signal" },
  );
  const pendingChecks: PullRequestCheck[] = [{ ...passingChecks[0]!, bucket: "pending" }];

  assert.deepEqual(
    codexConnectorCurrentHeadReviewReadiness({
      config: createCodexConfig({ localCiCommand: "npm test" }),
      pr: createPullRequest({
        ...pr,
        currentHeadCiGreenAt: null,
      }),
      checks: pendingChecks,
      manualThreadCount: 0,
      configuredThreadsAreSafe: true,
      checkSummary: summarizeChecks(pendingChecks),
      mergeConflict: false,
    }),
    { kind: "none", reason: "checks_not_green" },
  );
  assert.deepEqual(
    codexConnectorCurrentHeadReviewReadiness({
      config,
      pr: createPullRequest({
        ...pr,
        configuredBotCurrentHeadObservedAt: "2026-05-08T03:24:00Z",
      }),
      checks: passingChecks,
      manualThreadCount: 0,
      configuredThreadsAreSafe: true,
      checkSummary: summarizeChecks(passingChecks),
      mergeConflict: false,
    }),
    { kind: "none", reason: "current_head_already_observed" },
  );
});

test("codexConnectorReviewRequestAction requests review for stale-head configured-bot signal after timeout", () => {
  assert.deepEqual(decideScenario(createCodexConnectorStaleHeadRequestScenario()), { kind: "initial" });
});

test("codexConnectorReviewRequestAction requests review for stale review commit residue after timeout", () => {
  assert.deepEqual(decideScenario(createCodexConnectorStaleReviewCommitRequestScenario()), { kind: "initial" });
});

test("codexConnectorReviewRequestAction ignores non-actionable Codex P3 nitpicks when requesting stale review commit recovery", () => {
  const scenario = createCodexConnectorStaleReviewCommitRequestScenario();
  const softP3Thread = createReviewThread({
    id: "thread-soft-p3",
    comments: {
      nodes: [
        {
          id: "comment-soft-p3",
          body: "P3: Consider clarifying this retry note in a follow-up.",
          createdAt: "2026-05-08T03:20:00Z",
          url: "https://example.test/pr/1995#discussion_soft_p3",
          author: {
            login: "chatgpt-codex-connector",
            typeName: "Bot",
          },
        },
      ],
    },
  });

  assert.deepEqual(
    decide({
      record: scenario.recordPatch,
      pr: scenario.pullRequestPatch,
      checks: scenario.checks,
      reviewThreads: [...scenario.reviewThreads, softP3Thread],
      configuredThreads: [...scenario.configuredThreads, softP3Thread],
      now: scenario.now,
    }),
    { kind: "initial" },
  );
});

test("codexConnectorReviewRequestAction keeps human-updated bot threads blocking recovery requests", () => {
  const scenario = createCodexConnectorStaleReviewCommitRequestScenario();
  const humanUpdatedThread = createReviewThread({
    id: "thread-human-updated",
    comments: {
      nodes: [
        {
          id: "comment-soft-p3",
          body: "P3: Consider clarifying this retry note in a follow-up.",
          createdAt: "2026-05-08T03:20:00Z",
          url: "https://example.test/pr/1995#discussion_human_updated",
          author: {
            login: "chatgpt-codex-connector",
            typeName: "Bot",
          },
        },
        {
          id: "comment-human-follow-up",
          body: "This still needs operator attention before another bot review.",
          createdAt: "2026-05-08T03:25:00Z",
          url: "https://example.test/pr/1995#discussion_human_updated_follow_up",
          author: {
            login: "reviewer",
            typeName: "User",
          },
        },
      ],
    },
  });

  assert.deepEqual(
    decide({
      record: scenario.recordPatch,
      pr: scenario.pullRequestPatch,
      checks: scenario.checks,
      reviewThreads: [...scenario.reviewThreads, humanUpdatedThread],
      configuredThreads: [...scenario.configuredThreads, humanUpdatedThread],
      now: scenario.now,
    }),
    { kind: "none" },
  );
});

test("codexConnectorReviewRequestAction keeps other-bot updated Codex P3 threads blocking recovery requests", () => {
  const scenario = createCodexConnectorStaleReviewCommitRequestScenario();
  const otherBotUpdatedThread = createReviewThread({
    id: "thread-other-bot-updated",
    comments: {
      nodes: [
        {
          id: "comment-soft-p3",
          body: "P3: Consider clarifying this retry note in a follow-up.",
          createdAt: "2026-05-08T03:20:00Z",
          url: "https://example.test/pr/1995#discussion_other_bot_updated",
          author: {
            login: "chatgpt-codex-connector",
            typeName: "Bot",
          },
        },
        {
          id: "comment-coderabbit-follow-up",
          body: "Please keep this blocked until the latest configured-bot feedback is handled.",
          createdAt: "2026-05-08T03:25:00Z",
          url: "https://example.test/pr/1995#discussion_other_bot_updated_follow_up",
          author: {
            login: "coderabbitai",
            typeName: "Bot",
          },
        },
      ],
    },
  });

  assert.deepEqual(
    decide({
      config: {
        reviewBotLogins: ["chatgpt-codex-connector", "coderabbitai"],
      },
      record: scenario.recordPatch,
      pr: scenario.pullRequestPatch,
      checks: scenario.checks,
      reviewThreads: [...scenario.reviewThreads, otherBotUpdatedThread],
      configuredThreads: [...scenario.configuredThreads, otherBotUpdatedThread],
      now: scenario.now,
    }),
    { kind: "none" },
  );
});

test("codexConnectorReviewRequestAction keeps newer unlabeled Codex comments blocking recovery requests", () => {
  const scenario = createCodexConnectorStaleReviewCommitRequestScenario();
  const codexUpdatedThread = createReviewThread({
    id: "thread-codex-unlabeled-update",
    comments: {
      nodes: [
        {
          id: "comment-soft-p3",
          body: "P3: Consider clarifying this retry note in a follow-up.",
          createdAt: "2026-05-08T03:20:00Z",
          url: "https://example.test/pr/1995#discussion_codex_unlabeled_update",
          author: {
            login: "chatgpt-codex-connector",
            typeName: "Bot",
          },
        },
        {
          id: "comment-codex-unlabeled-follow-up",
          body: "Please inspect the latest review state before requesting another review.",
          createdAt: "2026-05-08T03:25:00Z",
          url: "https://example.test/pr/1995#discussion_codex_unlabeled_update_follow_up",
          author: {
            login: "chatgpt-codex-connector",
            typeName: "Bot",
          },
        },
      ],
    },
  });

  assert.deepEqual(
    decide({
      record: scenario.recordPatch,
      pr: scenario.pullRequestPatch,
      checks: scenario.checks,
      reviewThreads: [...scenario.reviewThreads, codexUpdatedThread],
      configuredThreads: [...scenario.configuredThreads, codexUpdatedThread],
      now: scenario.now,
    }),
    { kind: "none" },
  );
});

test("codexConnectorReviewRequestAction keeps mixed human then Codex P3 threads blocking recovery requests", () => {
  const scenario = createCodexConnectorStaleReviewCommitRequestScenario();
  const mixedHumanCodexThread = createReviewThread({
    id: "thread-human-then-codex-p3",
    comments: {
      nodes: [
        {
          id: "comment-human-manual",
          body: "Manual follow-up is still required before another bot review.",
          createdAt: "2026-05-08T03:20:00Z",
          url: "https://example.test/pr/1995#discussion_human_then_codex_p3",
          author: {
            login: "reviewer",
            typeName: "User",
          },
        },
        {
          id: "comment-soft-p3",
          body: "P3: Consider clarifying this retry note in a follow-up.",
          createdAt: "2026-05-08T03:25:00Z",
          url: "https://example.test/pr/1995#discussion_human_then_codex_p3_follow_up",
          author: {
            login: "chatgpt-codex-connector",
            typeName: "Bot",
          },
        },
      ],
    },
  });

  assert.deepEqual(
    decide({
      record: scenario.recordPatch,
      pr: scenario.pullRequestPatch,
      checks: scenario.checks,
      reviewThreads: [...scenario.reviewThreads, mixedHumanCodexThread],
      configuredThreads: [...scenario.configuredThreads, mixedHumanCodexThread],
      now: scenario.now,
    }),
    { kind: "none" },
  );
});

test("codexConnectorReviewRequestAction waits for scheduler timeout before recovering stale review commit residue without timeout metadata", () => {
  const scenario = createCodexConnectorStaleReviewCommitRequestScenario();
  const record = {
    ...scenario.recordPatch,
    review_wait_started_at: "2026-05-08T03:09:36Z",
    review_wait_head_sha: "head-1995",
    copilot_review_timed_out_at: null,
    copilot_review_timeout_action: null,
  };

  assert.deepEqual(
    decide({
      record,
      pr: scenario.pullRequestPatch,
      checks: scenario.checks,
      reviewThreads: scenario.reviewThreads,
      configuredThreads: scenario.configuredThreads,
      now: "2026-05-08T03:19:35.999Z",
    }),
    { kind: "none" },
  );
  assert.deepEqual(
    decide({
      record,
      pr: scenario.pullRequestPatch,
      checks: scenario.checks,
      reviewThreads: scenario.reviewThreads,
      configuredThreads: scenario.configuredThreads,
      now: "2026-05-08T03:19:36.000Z",
    }),
    { kind: "initial" },
  );
});

test("codexConnectorReviewRequestAction selects retry after the same-head request wait expires", () => {
  assert.deepEqual(decideScenario(createCodexConnectorRequestRetryScenario()), {
    kind: "retry",
    retryCount: 0,
    retryAttempt: 1,
  });
});

test("codexConnectorReviewRequestAction suppresses retry when the same-head request comment is still tracked", () => {
  const scenario = createCodexConnectorRequestRetryScenario();

  assert.deepEqual(
    decide({
      record: {
        ...scenario.recordPatch,
        codex_connector_review_request_comment_identity_status: "available",
        codex_connector_review_request_comment_database_id: 1995001,
        codex_connector_review_request_comment_node_id: "IC_head_1995",
        codex_connector_review_request_comment_url:
          "https://github.com/owner/repo/issues/1995#issuecomment-1995001",
      },
      pr: scenario.pullRequestPatch,
      checks: scenario.checks,
      reviewThreads: scenario.reviewThreads,
      configuredThreads: scenario.configuredThreads,
      now: scenario.now,
    }),
    { kind: "none" },
  );
});

test("codexConnectorReviewRequestAction suppresses retry when the same-head request comment is hydrated from GitHub", () => {
  const scenario = createCodexConnectorRequestRetryScenario();

  assert.deepEqual(
    decide({
      record: scenario.recordPatch,
      pr: {
        ...scenario.pullRequestPatch,
        codexConnectorReviewRequestCommentDatabaseId: 1995001,
      },
      checks: scenario.checks,
      reviewThreads: scenario.reviewThreads,
      configuredThreads: scenario.configuredThreads,
      now: scenario.now,
    }),
    { kind: "none" },
  );
});

test("codexConnectorReviewRequestAction ignores stale request comment identity when retrying the current head", () => {
  const scenario = createCodexConnectorRequestRetryScenario();

  assert.deepEqual(
    decide({
      record: {
        ...scenario.recordPatch,
        codex_connector_review_requested_observed_at: null,
        codex_connector_review_requested_head_sha: "head-old",
        codex_connector_review_request_comment_identity_status: "available",
        codex_connector_review_request_comment_database_id: 1994001,
      },
      pr: {
        ...scenario.pullRequestPatch,
        codexConnectorReviewRequestCommentDatabaseId: null,
      },
      checks: scenario.checks,
      reviewThreads: scenario.reviewThreads,
      configuredThreads: scenario.configuredThreads,
      now: scenario.now,
    }),
    { kind: "retry", retryCount: 0, retryAttempt: 1 },
  );
});

test("codexConnectorReviewRequestAction suppresses request while same-head request wait is active", () => {
  assert.deepEqual(
    decideScenario(
      createCodexConnectorSameHeadRequestScenario({
        requestedAt: "2026-05-08T03:30:00Z",
        now: "2026-05-08T03:35:00.000Z",
      }),
    ),
    { kind: "none" },
  );
});

test("codexConnectorReviewRequestAction falls back to a complete PR request pair when record metadata is partial", () => {
  assert.deepEqual(
    decide({
      record: {
        codex_connector_review_requested_observed_at: null,
        codex_connector_review_requested_head_sha: "head-old",
      },
      pr: {
        codexConnectorReviewRequestedAt: "2026-05-08T03:30:00Z",
        codexConnectorReviewRequestedHeadSha: "head-1995",
      },
      now: "2026-05-08T03:35:00.000Z",
    }),
    { kind: "none" },
  );
});

test("codexConnectorReviewRequestAction suppresses retry after retry exhaustion", () => {
  assert.deepEqual(
    decide({
      record: {
        codex_connector_review_requested_observed_at: "2026-05-08T03:30:00Z",
        codex_connector_review_requested_head_sha: "head-1995",
        codex_connector_review_request_retry_count: 1,
        codex_connector_review_request_retry_head_sha: "head-1995",
        codex_connector_review_request_last_retried_at: "2026-05-08T03:40:00.000Z",
      },
      now: "2026-05-08T04:00:00.000Z",
    }),
    { kind: "none" },
  );
});

test("codexConnectorReviewRequestAction suppresses requests behind PR and review blockers", () => {
  const codexMustFixThread = createReviewThread({
    id: "thread-codex-must-fix",
    comments: {
      nodes: [
        {
          id: "comment-codex-must-fix",
          body: "P1: fix the boundary before requesting another review.",
          createdAt: "2026-05-08T03:20:00Z",
          url: "https://example.test/pr/1995#discussion_r1",
          author: {
            login: "chatgpt-codex-connector",
            typeName: "Bot",
          },
        },
      ],
    },
  });

  const cases: Array<{ name: string; overrides: Parameters<typeof decide>[0] }> = [
    { name: "draft", overrides: { pr: { isDraft: true } } },
    { name: "manual review thread", overrides: { manualThreads: [createReviewThread()] } },
    { name: "unprocessed must-fix Codex thread", overrides: { configuredThreads: [codexMustFixThread] } },
    { name: "merge conflict", overrides: { mergeConflict: true } },
    { name: "pending checks", overrides: { checks: [{ ...passingChecks[0]!, bucket: "pending" }] } },
    { name: "failing checks", overrides: { checks: [{ ...passingChecks[0]!, bucket: "fail" }] } },
    {
      name: "missing fallback evidence",
      overrides: {
        pr: { currentHeadCiGreenAt: null },
        checks: [],
        config: { localCiCommand: "npm test" },
      },
    },
    {
      name: "current-head review already observed",
      overrides: { pr: { configuredBotCurrentHeadObservedAt: "2026-05-08T03:24:00Z" } },
    },
  ];

  for (const scenario of cases) {
    assert.deepEqual(decide(scenario.overrides), { kind: "none" }, scenario.name);
  }
});
