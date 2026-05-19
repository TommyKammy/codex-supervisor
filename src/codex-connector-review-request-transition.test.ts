import test from "node:test";
import assert from "node:assert/strict";
import { maybeRequestCodexConnectorReviewComment } from "./codex-connector-review-request-transition";
import type { FailureContext, IssueRunRecord, PullRequestCheck, SupervisorConfig, SupervisorStateFile } from "./core/types";
import { configuredBotReviewThreads, manualReviewThreads } from "./review-thread-reporting";
import { createConfig, createPullRequest, createRecord } from "./turn-execution-test-helpers";

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

function createNoopStateStore() {
  return {
    touch: (record: IssueRunRecord, patch: Partial<IssueRunRecord>) => ({ ...record, ...patch, updated_at: record.updated_at }),
    save: async () => undefined,
  };
}

function summarizeChecks(checks: PullRequestCheck[]) {
  return {
    hasPending: checks.some((check) => check.bucket === "pending"),
    hasFailing: checks.some((check) => check.bucket === "fail"),
  };
}

const passingChecks: PullRequestCheck[] = [
  {
    name: "build",
    state: "SUCCESS",
    bucket: "pass",
    workflow: "CI",
  },
];

function createRequestRecord(overrides: Partial<IssueRunRecord> = {}): IssueRunRecord {
  return createRecord({
    issue_number: 2052,
    state: "waiting_ci",
    pr_number: 2052,
    last_head_sha: "head-2052",
    review_wait_started_at: "2026-05-08T03:09:36Z",
    review_wait_head_sha: "head-2052",
    copilot_review_timed_out_at: "2026-05-08T03:19:36.000Z",
    copilot_review_timeout_action: "request_review_comment",
    codex_connector_review_requested_observed_at: null,
    codex_connector_review_requested_head_sha: null,
    ...overrides,
  });
}

async function requestTransition(overrides: {
  config?: Partial<SupervisorConfig>;
  record?: Partial<IssueRunRecord>;
  pr?: Parameters<typeof createPullRequest>[0];
  addIssueComment?: (issueNumber: number, body: string) => Promise<{
    databaseId: number;
    nodeId: string;
    url: string;
  } | void>;
  now?: string;
} = {}) {
  const originalDateNow = Date.now;
  Date.now = () => Date.parse(overrides.now ?? "2026-05-08T03:30:00Z");
  try {
    const config = createCodexConfig(overrides.config);
    const record = createRequestRecord(overrides.record);
    const pr = createPullRequest({
      number: 2052,
      title: "Extract Codex Connector review request lifecycle transition",
      headRefOid: "head-2052",
      currentHeadCiGreenAt: "2026-05-08T03:09:36Z",
      configuredBotCurrentHeadObservedAt: null,
      codexConnectorReviewRequestedAt: null,
      codexConnectorReviewRequestedHeadSha: null,
      ...overrides.pr,
    });
    const state: SupervisorStateFile = {
      activeIssueNumber: record.issue_number,
      issues: { [String(record.issue_number)]: record },
    };
    const comments: Array<{ issueNumber: number; body: string }> = [];
    const journaled: IssueRunRecord[] = [];
    const result = await maybeRequestCodexConnectorReviewComment({
      config,
      stateStore: createNoopStateStore(),
      state,
      github: overrides.addIssueComment
        ? {
            addIssueComment: async (issueNumber, body) => {
              comments.push({ issueNumber, body });
              return overrides.addIssueComment?.(issueNumber, body);
            },
          }
        : {},
      record,
      pr,
      checks: passingChecks,
      reviewThreads: [],
      syncJournal: async (updatedRecord) => {
        journaled.push(updatedRecord);
      },
      applyFailureSignature: (_record, failureContext: FailureContext) => ({
        last_failure_signature: failureContext.signature,
        repeated_failure_signature_count: 1,
      }),
      blockedReasonFromReviewState: () => null,
      summarizeChecks,
      configuredBotReviewThreads,
      manualReviewThreads,
      mergeConflictDetected: () => false,
    });
    return { result, state, comments, journaled, pr };
  } finally {
    Date.now = originalDateNow;
  }
}

test("maybeRequestCodexConnectorReviewComment persists initial request comment identity and clears blockers", async () => {
  const { result, state, comments, journaled, pr } = await requestTransition({
    record: {
      blocked_reason: "review_bot_timeout",
      last_error: "waiting for review",
      last_failure_signature: "old-review-timeout",
      repeated_failure_signature_count: 2,
    },
    addIssueComment: async () => ({
      databaseId: 2052001,
      nodeId: "IC_kwDOissue2052_request",
      url: "https://github.com/owner/repo/issues/2052#issuecomment-2052001",
    }),
  });

  assert.deepEqual(comments, [
    {
      issueNumber: pr.number,
      body: `@codex review\n\n<!-- codex-supervisor:codex-connector-review-request issue=2052 pr=${pr.number} head=${pr.headRefOid} -->`,
    },
  ]);
  assert.equal(result.state, "waiting_ci");
  assert.equal(result.codex_connector_review_requested_head_sha, pr.headRefOid);
  assert.match(result.codex_connector_review_requested_observed_at ?? "", /^\d{4}-\d{2}-\d{2}T/);
  assert.equal(result.codex_connector_review_request_retry_count, 0);
  assert.equal(result.codex_connector_review_request_retry_head_sha, null);
  assert.equal(result.codex_connector_review_request_comment_identity_status, "available");
  assert.equal(result.codex_connector_review_request_comment_database_id, 2052001);
  assert.equal(result.codex_connector_review_request_comment_node_id, "IC_kwDOissue2052_request");
  assert.equal(
    result.codex_connector_review_request_comment_url,
    "https://github.com/owner/repo/issues/2052#issuecomment-2052001",
  );
  assert.equal(result.blocked_reason, null);
  assert.equal(result.last_error, null);
  assert.equal(state.issues["2052"], result);
  assert.deepEqual(journaled, [result]);
});

test("maybeRequestCodexConnectorReviewComment retries same-head request without resetting original request time", async () => {
  const { result, comments, pr } = await requestTransition({
    config: { codexConnectorReviewRequestRetryMode: "plain" },
    now: "2026-05-08T03:40:00Z",
    record: {
      codex_connector_review_requested_observed_at: "2026-05-08T03:30:00Z",
      codex_connector_review_requested_head_sha: "head-2052",
      codex_connector_review_request_retry_count: 0,
      codex_connector_review_request_retry_head_sha: null,
      codex_connector_review_request_last_retried_at: null,
    },
    pr: {
      codexConnectorReviewRequestedAt: "2026-05-08T03:30:00Z",
      codexConnectorReviewRequestedHeadSha: "head-2052",
    },
    addIssueComment: async () => ({
      databaseId: 2052002,
      nodeId: "IC_kwDOissue2052_retry",
      url: "https://github.com/owner/repo/issues/2052#issuecomment-2052002",
    }),
  });

  assert.deepEqual(comments, [{ issueNumber: pr.number, body: "@codex review" }]);
  assert.equal(result.codex_connector_review_requested_observed_at, "2026-05-08T03:30:00Z");
  assert.equal(result.codex_connector_review_requested_head_sha, "head-2052");
  assert.equal(result.codex_connector_review_request_retry_count, 1);
  assert.equal(result.codex_connector_review_request_retry_head_sha, "head-2052");
  assert.match(result.codex_connector_review_request_last_retried_at ?? "", /^\d{4}-\d{2}-\d{2}T/);
  assert.equal(result.codex_connector_review_request_comment_database_id, 2052002);
});

test("maybeRequestCodexConnectorReviewComment sends a fresh marker request for a stale-head prior request", async () => {
  const { result, comments, pr } = await requestTransition({
    record: {
      codex_connector_review_requested_observed_at: "2026-05-08T03:30:00Z",
      codex_connector_review_requested_head_sha: "head-old",
      codex_connector_review_request_retry_count: 1,
      codex_connector_review_request_retry_head_sha: "head-old",
      codex_connector_review_request_last_retried_at: "2026-05-08T03:40:00Z",
    },
    pr: {
      headRefOid: "head-2052-new",
      codexConnectorReviewRequestedAt: "2026-05-08T03:30:00Z",
      codexConnectorReviewRequestedHeadSha: "head-old",
    },
    addIssueComment: async () => undefined,
  });

  assert.deepEqual(comments, [
    {
      issueNumber: pr.number,
      body: `@codex review\n\n<!-- codex-supervisor:codex-connector-review-request issue=2052 pr=${pr.number} head=head-2052-new -->`,
    },
  ]);
  assert.match(result.codex_connector_review_requested_observed_at ?? "", /^\d{4}-\d{2}-\d{2}T/);
  assert.equal(result.codex_connector_review_requested_head_sha, "head-2052-new");
  assert.equal(result.codex_connector_review_request_retry_count, 0);
  assert.equal(result.codex_connector_review_request_retry_head_sha, null);
  assert.equal(result.codex_connector_review_request_comment_identity_status, "unavailable");
});

test("maybeRequestCodexConnectorReviewComment blocks with stable failure context when GitHub transport is missing", async () => {
  const { result, state, comments, journaled, pr } = await requestTransition();

  assert.deepEqual(comments, []);
  assert.equal(result.state, "blocked");
  assert.equal(result.blocked_reason, "review_bot_timeout");
  assert.equal(result.last_error, `Failed to request Codex Connector review for PR #${pr.number}.`);
  assert.equal(result.last_failure_context?.category, "blocked");
  assert.equal(result.last_failure_context?.signature, `codex-connector-review-request-failed:${pr.headRefOid}`);
  assert.deepEqual(result.last_failure_context?.details, [
    `head=${pr.headRefOid}`,
    "mutation=add_pr_comment",
    "error=GitHub comment transport unavailable",
  ]);
  assert.equal(result.last_failure_signature, `codex-connector-review-request-failed:${pr.headRefOid}`);
  assert.equal(result.repeated_failure_signature_count, 1);
  assert.equal(state.issues["2052"], result);
  assert.deepEqual(journaled, [result]);
});

test("maybeRequestCodexConnectorReviewComment blocks with mutation failure details when GitHub comment post fails", async () => {
  const { result, comments, pr } = await requestTransition({
    addIssueComment: async () => {
      throw new Error("GraphQL mutation rejected");
    },
  });

  assert.equal(comments.length, 1);
  assert.equal(result.state, "blocked");
  assert.equal(result.blocked_reason, "review_bot_timeout");
  assert.equal(result.last_failure_context?.signature, `codex-connector-review-request-failed:${pr.headRefOid}`);
  assert.deepEqual(result.last_failure_context?.details, [
    `head=${pr.headRefOid}`,
    "mutation=add_pr_comment",
    "error=GraphQL mutation rejected",
  ]);
});
