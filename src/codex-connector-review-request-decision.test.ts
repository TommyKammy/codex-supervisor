import test from "node:test";
import assert from "node:assert/strict";
import { codexConnectorReviewRequestAction } from "./codex-connector-review-request-decision";
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

test("codexConnectorReviewRequestAction requests review for stale-head configured-bot signal after timeout", () => {
  assert.deepEqual(decideScenario(createCodexConnectorStaleHeadRequestScenario()), { kind: "initial" });
});

test("codexConnectorReviewRequestAction requests review for stale review commit residue after timeout", () => {
  assert.deepEqual(decideScenario(createCodexConnectorStaleReviewCommitRequestScenario()), { kind: "initial" });
});

test("codexConnectorReviewRequestAction selects retry after the same-head request wait expires", () => {
  assert.deepEqual(decideScenario(createCodexConnectorRequestRetryScenario()), {
    kind: "retry",
    retryCount: 0,
    retryAttempt: 1,
  });
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
