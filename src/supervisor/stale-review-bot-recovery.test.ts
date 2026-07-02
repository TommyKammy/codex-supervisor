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
import {
  recoverStaleConfiguredBotReviewThreads,
  staleConfiguredBotReviewProgressKey,
} from "./stale-review-bot-recovery";

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

test("recoverStaleConfiguredBotReviewThreads clears stale residue when resolve progress is partially preexisting", async () => {
  const config = createConfig({
    reviewBotLogins: ["chatgpt-codex-connector"],
    staleConfiguredBotReviewPolicy: "reply_and_resolve",
  });
  const pr = createPullRequest({
    number: 183,
    headRefOid: "head-183",
  });
  const threadIds = ["thread-1", "thread-2"];
  const signature = threadIds.map((threadId) => `stalled-bot:${threadId}`).join("|");
  const preexistingReplyKey = staleConfiguredBotReviewProgressKey({
    headSha: pr.headRefOid,
    signature,
    threadId: threadIds[0],
    phase: "reply",
  });
  const preexistingResolveKey = staleConfiguredBotReviewProgressKey({
    headSha: pr.headRefOid,
    signature,
    threadId: threadIds[0],
    phase: "resolve",
  });
  const record = createRecord({
    issue_number: 102,
    pr_number: pr.number,
    state: "addressing_review",
    blocked_reason: null,
    last_head_sha: pr.headRefOid,
    last_failure_context: createFailureContext("stale configured-bot review thread"),
    last_failure_signature: signature,
    repeated_failure_signature_count: 4,
    last_tracked_pr_progress_snapshot: "{\"stale\":true}",
    last_tracked_pr_progress_summary: "processed_review_thread_fingerprints_changed",
    last_tracked_pr_repeat_failure_decision: "stop_no_progress",
    processed_review_thread_ids: [`${threadIds[0]}@${pr.headRefOid}`],
    processed_review_thread_fingerprints: [`${threadIds[0]}@${pr.headRefOid}#comment-1`],
    stale_review_bot_reply_progress_keys: [preexistingReplyKey],
    stale_review_bot_resolve_progress_keys: [preexistingResolveKey],
  });
  const state: SupervisorStateFile = {
    activeIssueNumber: 102,
    issues: {
      "102": record,
    },
  };
  const failureContext = {
    ...createFailureContext("stale configured-bot review thread"),
    signature,
    details: threadIds.map(
      (threadId) =>
        `reviewer=chatgpt-codex-connector thread=${threadId} file=src/review.ts line=42 processed_on_current_head=yes`,
    ),
    url: "https://example.test/review/183",
  };
  const reviewThreads = [
    createReviewThread({
      id: threadIds[1],
      path: "src/review.ts",
      line: 42,
      comments: {
        nodes: [
          {
            id: `comment-${threadIds[1]}`,
            body: "This finding is stale on the current head.",
            createdAt: "2026-05-24T02:05:00Z",
            url: `https://example.test/pr/183#discussion_${threadIds[1]}`,
            author: {
              login: "chatgpt-codex-connector",
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
  assert.deepEqual(replies, [threadIds[1]]);
  assert.deepEqual(resolutions, [threadIds[1]]);
  assert.equal(result.shouldRefreshPullRequest, true);
  assert.equal(result.record.last_failure_context, null);
  assert.equal(result.record.last_failure_signature, null);
  assert.equal(result.record.repeated_failure_signature_count, 0);
  assert.equal(result.record.last_tracked_pr_progress_snapshot, null);
  assert.equal(result.record.last_tracked_pr_progress_summary, null);
  assert.equal(result.record.last_tracked_pr_repeat_failure_decision, null);
  assert.deepEqual(result.record.processed_review_thread_ids, []);
  assert.deepEqual(result.record.processed_review_thread_fingerprints, []);
});

test("recoverStaleConfiguredBotReviewThreads retries missing resolves when a reply marker already exists", async () => {
  const config = createConfig({
    reviewBotLogins: ["chatgpt-codex-connector"],
    staleConfiguredBotReviewPolicy: "reply_and_resolve",
  });
  const pr = createPullRequest({
    number: 184,
    headRefOid: "head-184",
  });
  const signature = "stalled-bot:thread-1";
  const record = createRecord({
    issue_number: 184,
    pr_number: pr.number,
    state: "blocked",
    blocked_reason: "manual_review",
    last_head_sha: pr.headRefOid,
    last_stale_review_bot_reply_head_sha: pr.headRefOid,
    last_stale_review_bot_reply_signature: signature,
    stale_review_bot_reply_progress_keys: [
      staleConfiguredBotReviewProgressKey({
        headSha: pr.headRefOid,
        signature,
        threadId: "thread-1",
        phase: "reply",
      }),
    ],
    stale_review_bot_resolve_progress_keys: [],
  });
  const state: SupervisorStateFile = {
    activeIssueNumber: 184,
    issues: {
      "184": record,
    },
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
            createdAt: "2026-05-24T02:05:00Z",
            url: "https://example.test/pr/184#discussion_thread-1",
            author: {
              login: "chatgpt-codex-connector",
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
    failureContext: {
      ...createFailureContext("stale configured-bot review thread"),
      signature,
    },
    resolveAfterReply: true,
  });

  assert.equal(result.status, "resolved");
  assert.deepEqual(replies, []);
  assert.deepEqual(resolutions, ["thread-1"]);
  assert.equal(result.shouldRefreshPullRequest, true);
});

test("recoverStaleConfiguredBotReviewThreads finalizes records with completed resolve progress", async () => {
  const config = createConfig({
    reviewBotLogins: ["chatgpt-codex-connector"],
    staleConfiguredBotReviewPolicy: "reply_and_resolve",
  });
  const pr = createPullRequest({
    number: 186,
    headRefOid: "head-186",
  });
  const signature = "stalled-bot:thread-1";
  const record = createRecord({
    issue_number: 186,
    pr_number: pr.number,
    state: "blocked",
    blocked_reason: "stale_review_bot",
    last_head_sha: pr.headRefOid,
    last_failure_context: createFailureContext("stale configured-bot review thread"),
    last_failure_signature: signature,
    repeated_failure_signature_count: 4,
    stale_review_bot_reply_progress_keys: [
      staleConfiguredBotReviewProgressKey({
        headSha: pr.headRefOid,
        signature,
        threadId: "thread-1",
        phase: "reply",
      }),
    ],
    stale_review_bot_resolve_progress_keys: [
      staleConfiguredBotReviewProgressKey({
        headSha: pr.headRefOid,
        signature,
        threadId: "thread-1",
        phase: "resolve",
      }),
    ],
  });
  const state: SupervisorStateFile = {
    activeIssueNumber: 186,
    issues: {
      "186": record,
    },
  };
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
    reviewThreads: [],
    syncJournal: async () => undefined,
    config,
    failureContext: {
      ...createFailureContext("stale configured-bot review thread"),
      signature,
    },
    resolveAfterReply: true,
  });

  assert.equal(result.status, "no_op");
  assert.deepEqual(replies, []);
  assert.deepEqual(resolutions, []);
  assert.equal(result.shouldRefreshPullRequest, true);
  assert.equal(result.record.last_failure_context, null);
  assert.equal(result.record.last_failure_signature, null);
  assert.equal(result.record.repeated_failure_signature_count, 0);
  assert.equal(result.record.last_stale_review_bot_reply_head_sha, pr.headRefOid);
  assert.equal(result.record.last_stale_review_bot_reply_signature, signature);
});

test("recoverStaleConfiguredBotReviewThreads skips human-touched configured-bot threads", async () => {
  const config = createConfig({
    reviewBotLogins: ["chatgpt-codex-connector"],
    staleConfiguredBotReviewPolicy: "reply_and_resolve",
  });
  const pr = createPullRequest({
    number: 185,
    headRefOid: "head-185",
  });
  const signature = "stalled-bot:thread-human-latest";
  const record = createRecord({
    issue_number: 185,
    pr_number: pr.number,
    state: "blocked",
    blocked_reason: "manual_review",
    last_head_sha: pr.headRefOid,
  });
  const state: SupervisorStateFile = {
    activeIssueNumber: 185,
    issues: {
      "185": record,
    },
  };
  const reviewThreads = [
    createReviewThread({
      id: "thread-human-latest",
      path: "src/review.ts",
      line: 42,
      comments: {
        nodes: [
          {
            id: "comment-bot",
            body: "This finding is stale on the current head.",
            createdAt: "2026-05-24T02:05:00Z",
            url: "https://example.test/pr/185#discussion_thread-human-latest",
            author: {
              login: "chatgpt-codex-connector",
              typeName: "Bot",
            },
          },
          {
            id: "comment-human",
            body: "A human reviewer is still discussing this thread.",
            createdAt: "2026-05-24T02:10:00Z",
            url: "https://example.test/pr/185#discussion_thread-human-latest_followup",
            author: {
              login: "reviewer-human",
              typeName: "User",
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
    failureContext: {
      ...createFailureContext("stale configured-bot review thread"),
      signature,
    },
    resolveAfterReply: true,
  });

  assert.equal(result.status, "skipped");
  assert.equal(result.skippedReason, "missing_configured_thread");
  assert.deepEqual(replies, []);
  assert.deepEqual(resolutions, []);
});

test("recoverStaleConfiguredBotReviewThreads normalizes raw PRRT thread signatures", async () => {
  const config = createConfig({
    reviewBotLogins: ["chatgpt-codex-connector"],
    staleConfiguredBotReviewPolicy: "reply_and_resolve",
  });
  const pr = createPullRequest({
    number: 147,
    headRefOid: "68401b26947918f0ce2280a9526ab68298b1a25c",
  });
  const record = createRecord({
    issue_number: 143,
    pr_number: pr.number,
    state: "blocked",
    blocked_reason: "manual_review",
    last_head_sha: pr.headRefOid,
  });
  const state: SupervisorStateFile = {
    activeIssueNumber: 143,
    issues: {
      "143": record,
    },
  };
  const failureContext = {
    ...createFailureContext("stale Codex review commit residue"),
    signature: "PRRT_kwDOSfC_1M6DBYp8",
    details: ["reviewer=chatgpt-codex-connector file=src/writeback-ingest.ts line=42 processed_on_current_head=yes"],
    url: "https://example.test/pr/147#discussion_r147",
  };
  const reviewThreads = [
    createReviewThread({
      id: "PRRT_kwDOSfC_1M6DBYp8",
      path: "src/writeback-ingest.ts",
      line: 42,
      comments: {
        nodes: [
          {
            id: "comment-1",
            body: "Update the published writeback response schema.",
            createdAt: "2026-05-18T02:05:00Z",
            url: "https://example.test/pr/147#discussion_r147",
            author: {
              login: "chatgpt-codex-connector",
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
    reasonCode: "verified_current_head_repair_auto_resolve",
  });

  assert.equal(result.status, "resolved");
  assert.equal(result.shouldRefreshPullRequest, true);
  assert.deepEqual(replies, ["PRRT_kwDOSfC_1M6DBYp8"]);
  assert.deepEqual(resolutions, ["PRRT_kwDOSfC_1M6DBYp8"]);
  assert.deepEqual(result.record.stale_review_bot_reply_progress_keys, [
    "reply:PRRT_kwDOSfC_1M6DBYp8@68401b26947918f0ce2280a9526ab68298b1a25c:stalled-bot:PRRT_kwDOSfC_1M6DBYp8",
  ]);
  assert.deepEqual(result.record.stale_review_bot_resolve_progress_keys, [
    "resolve:PRRT_kwDOSfC_1M6DBYp8@68401b26947918f0ce2280a9526ab68298b1a25c:stalled-bot:PRRT_kwDOSfC_1M6DBYp8",
  ]);
});
