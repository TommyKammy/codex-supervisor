import test from "node:test";
import assert from "node:assert/strict";
import type { IssueRunRecord, SupervisorStateFile } from "../core/types";
import {
  createConfig,
  createFailureContext,
  createPullRequest,
  createRecord,
  createReviewThread,
} from "../turn-execution-test-helpers";
import { recoverStaleConfiguredBotReviewThreads } from "./stale-review-bot-recovery";

function createNoopStateStore() {
  return {
    touch: (record: IssueRunRecord, patch: Partial<IssueRunRecord>) => ({
      ...record,
      ...patch,
      updated_at: record.updated_at,
    }),
    save: async () => undefined,
  };
}

test("recoverStaleConfiguredBotReviewThreads returns a typed resolved result and preserves progress keys", async () => {
  const config = createConfig({
    reviewBotLogins: ["copilot-pull-request-reviewer"],
    staleConfiguredBotReviewPolicy: "reply_and_resolve",
  });
  const pr = createPullRequest({
    number: 116,
    headRefOid: "head-116",
  });
  const record = createRecord({
    issue_number: 102,
    pr_number: pr.number,
    state: "blocked",
    blocked_reason: "stale_review_bot",
    last_head_sha: pr.headRefOid,
  });
  const state: SupervisorStateFile = {
    activeIssueNumber: 102,
    issues: {
      "102": record,
    },
  };
  const failureContext = {
    ...createFailureContext("stale configured-bot review thread"),
    signature: "stalled-bot:thread-1",
    details: ["reviewer=copilot-pull-request-reviewer file=src/review.ts line=42 processed_on_current_head=yes"],
    url: "https://example.test/review/1",
  };
  const reviewThreads = [
    createReviewThread({
      id: "thread-1",
      path: "src/review.ts",
      line: 42,
      comments: {
        nodes: [
          {
            id: "comment-1",
            body: "This finding is stale on the current head.",
            createdAt: "2026-03-13T02:05:00Z",
            url: "https://example.test/pr/116#discussion_r1",
            author: {
              login: "copilot-pull-request-reviewer",
              typeName: "Bot",
            },
          },
        ],
      },
    }),
  ];
  const replies: string[] = [];
  const resolutions: string[] = [];

  const result = await recoverStaleConfiguredBotReviewThreads({
    github: {
      replyToReviewThread: async (threadId: string) => {
        replies.push(threadId);
      },
      resolveReviewThread: async (threadId: string) => {
        resolutions.push(threadId);
      },
    },
    stateStore: createNoopStateStore(),
    state,
    record,
    pr,
    reviewThreads,
    syncJournal: async () => undefined,
    config,
    failureContext,
    resolveAfterReply: true,
  });

  assert.equal(result.status, "resolved");
  assert.equal(result.replyCount, 1);
  assert.equal(result.resolveCount, 1);
  assert.equal(result.shouldRefreshPullRequest, true);
  assert.deepEqual(replies, ["thread-1"]);
  assert.deepEqual(resolutions, ["thread-1"]);
  assert.deepEqual(result.record.stale_review_bot_reply_progress_keys, [
    "reply:thread-1@head-116:stalled-bot:thread-1",
  ]);
  assert.deepEqual(result.record.stale_review_bot_resolve_progress_keys, [
    "resolve:thread-1@head-116:stalled-bot:thread-1",
  ]);
});
