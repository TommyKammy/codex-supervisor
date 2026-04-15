import assert from "node:assert/strict";
import test from "node:test";
import { inferStateFromPullRequest } from "./pull-request-state";
import {
  createConfig,
  createPullRequest,
  createRecord,
  createReviewThread,
} from "./pull-request-state-test-helpers";

test("inferStateFromPullRequest keeps an unresolved configured bot thread blocked on the same head after processing", () => {
  const config = createConfig({
    reviewBotLogins: ["copilot-pull-request-reviewer"],
  });
  const record = createRecord({
    state: "pr_open",
    last_head_sha: "head-a",
    processed_review_thread_ids: ["thread-1@head-a"],
    processed_review_thread_fingerprints: ["thread-1@head-a#comment-1"],
  });
  const pr = createPullRequest({
    reviewDecision: "CHANGES_REQUESTED",
    headRefOid: "head-a",
  });

  assert.equal(inferStateFromPullRequest(config, record, pr, [], [createReviewThread()]), "blocked");
});

test("inferStateFromPullRequest treats a legacy plain thread id as processed only on the matching head", () => {
  const config = createConfig({
    reviewBotLogins: ["copilot-pull-request-reviewer"],
  });
  const record = createRecord({
    state: "pr_open",
    last_head_sha: "head-a",
    processed_review_thread_ids: ["thread-1"],
  });
  const sameHeadPr = createPullRequest({
    reviewDecision: "CHANGES_REQUESTED",
    headRefOid: "head-a",
  });
  const changedHeadPr = createPullRequest({
    reviewDecision: "CHANGES_REQUESTED",
    headRefOid: "head-b",
  });

  assert.equal(inferStateFromPullRequest(config, record, sameHeadPr, [], [createReviewThread()]), "blocked");
  assert.equal(
    inferStateFromPullRequest(config, record, changedHeadPr, [], [createReviewThread()]),
    "addressing_review",
  );
});

test("inferStateFromPullRequest allows one reprocessing pass for a configured bot thread after the PR head changes", () => {
  const config = createConfig({
    reviewBotLogins: ["copilot-pull-request-reviewer"],
  });
  const record = createRecord({
    state: "pr_open",
    last_head_sha: "head-a",
    processed_review_thread_ids: ["thread-1@head-a"],
    processed_review_thread_fingerprints: ["thread-1@head-a#comment-1"],
  });
  const pr = createPullRequest({
    reviewDecision: "CHANGES_REQUESTED",
    headRefOid: "head-b",
  });

  assert.equal(
    inferStateFromPullRequest(config, record, pr, [], [createReviewThread()]),
    "addressing_review",
  );
});

test("inferStateFromPullRequest allows one reprocessing pass for a configured bot thread when its latest comment changes on the same head", () => {
  const config = createConfig({
    reviewBotLogins: ["copilot-pull-request-reviewer"],
  });
  const record = createRecord({
    state: "pr_open",
    last_head_sha: "head-a",
    processed_review_thread_ids: ["thread-1@head-a"],
    processed_review_thread_fingerprints: ["thread-1@head-a#comment-1"],
  });
  const pr = createPullRequest({
    reviewDecision: "CHANGES_REQUESTED",
    headRefOid: "head-a",
  });
  const updatedThread = createReviewThread({
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

  assert.equal(inferStateFromPullRequest(config, record, pr, [], [updatedThread]), "addressing_review");
});

test("inferStateFromPullRequest keeps a configured bot thread blocked when its latest same-head reply is from a human or Codex", () => {
  const config = createConfig({
    reviewBotLogins: ["copilot-pull-request-reviewer"],
  });
  const record = createRecord({
    state: "pr_open",
    last_head_sha: "head-a",
    processed_review_thread_ids: ["thread-1@head-a"],
    processed_review_thread_fingerprints: ["thread-1@head-a#comment-1"],
  });
  const pr = createPullRequest({
    reviewDecision: "CHANGES_REQUESTED",
    headRefOid: "head-a",
  });
  const updatedThread = createReviewThread({
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
          body: "The latest conversation here is a human clarification, so this should not reopen the automatic same-head retry path by itself.",
          createdAt: "2026-03-11T00:05:00Z",
          url: "https://example.test/pr/44#discussion_r2",
          author: {
            login: "human-reviewer",
            typeName: "User",
          },
        },
      ],
    },
  });
  const codexUpdatedThread = createReviewThread({
    id: "thread-2",
    comments: {
      nodes: [
        {
          id: "comment-3",
          body: "Please address this too.",
          createdAt: "2026-03-11T00:10:00Z",
          url: "https://example.test/pr/44#discussion_r3",
          author: {
            login: "copilot-pull-request-reviewer",
            typeName: "Bot",
          },
        },
        {
          id: "comment-4",
          body: "Codex already replied in-thread with implementation context, so this same-head thread should stay blocked until a configured bot posts fresh guidance.",
          createdAt: "2026-03-11T00:15:00Z",
          url: "https://example.test/pr/44#discussion_r4",
          author: {
            login: "chatgpt-codex-connector",
            typeName: "Bot",
          },
        },
      ],
    },
  });

  assert.equal(inferStateFromPullRequest(config, record, pr, [], [updatedThread]), "blocked");
  assert.equal(
    inferStateFromPullRequest(
      config,
      {
        ...record,
        processed_review_thread_ids: ["thread-2@head-a"],
        processed_review_thread_fingerprints: ["thread-2@head-a#comment-3"],
      },
      pr,
      [],
      [codexUpdatedThread],
    ),
    "blocked",
  );
});

test("inferStateFromPullRequest blocks a same-head configured bot thread again after its updated comment has already been reprocessed once", () => {
  const config = createConfig({
    reviewBotLogins: ["copilot-pull-request-reviewer"],
  });
  const record = createRecord({
    state: "pr_open",
    last_head_sha: "head-a",
    processed_review_thread_ids: ["thread-1@head-a"],
    processed_review_thread_fingerprints: ["thread-1@head-a#comment-2"],
  });
  const pr = createPullRequest({
    reviewDecision: "CHANGES_REQUESTED",
    headRefOid: "head-a",
  });
  const updatedThread = createReviewThread({
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

  assert.equal(inferStateFromPullRequest(config, record, pr, [], [updatedThread]), "blocked");
});

test("inferStateFromPullRequest blocks a repeatedly unresolved configured bot thread again after its one pass on the new head", () => {
  const config = createConfig({
    reviewBotLogins: ["copilot-pull-request-reviewer"],
  });
  const record = createRecord({
    state: "pr_open",
    last_head_sha: "head-b",
    processed_review_thread_ids: ["thread-1@head-a", "thread-1@head-b"],
    processed_review_thread_fingerprints: ["thread-1@head-b#comment-1"],
  });
  const pr = createPullRequest({
    reviewDecision: "CHANGES_REQUESTED",
    headRefOid: "head-b",
  });

  assert.equal(inferStateFromPullRequest(config, record, pr, [], [createReviewThread()]), "blocked");
});

test("inferStateFromPullRequest allows one same-head follow-up turn after partial configured-bot progress", () => {
  const config = createConfig({
    reviewBotLogins: ["copilot-pull-request-reviewer"],
  });
  const record = createRecord({
    state: "pr_open",
    last_head_sha: "head-a",
    processed_review_thread_ids: ["thread-1@head-a", "thread-2@head-a"],
    processed_review_thread_fingerprints: ["thread-1@head-a#comment-1", "thread-2@head-a#comment-2"],
    review_follow_up_head_sha: "head-a",
    review_follow_up_remaining: 1,
  });
  const pr = createPullRequest({
    reviewDecision: "CHANGES_REQUESTED",
    headRefOid: "head-a",
  });
  const remainingThread = createReviewThread({
    id: "thread-2",
    comments: {
      nodes: [
        {
          id: "comment-2",
          body: "Still unresolved.",
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

  assert.equal(inferStateFromPullRequest(config, record, pr, [], [remainingThread]), "addressing_review");
});

test("inferStateFromPullRequest still blocks same-head configured bot threads when no follow-up progress was recorded", () => {
  const config = createConfig({
    reviewBotLogins: ["copilot-pull-request-reviewer"],
  });
  const record = createRecord({
    state: "pr_open",
    last_head_sha: "head-a",
    processed_review_thread_ids: ["thread-1@head-a"],
    processed_review_thread_fingerprints: ["thread-1@head-a#comment-1"],
    review_follow_up_head_sha: null,
    review_follow_up_remaining: 0,
  });
  const pr = createPullRequest({
    reviewDecision: "CHANGES_REQUESTED",
    headRefOid: "head-a",
  });

  assert.equal(inferStateFromPullRequest(config, record, pr, [], [createReviewThread()]), "blocked");
});

test("inferStateFromPullRequest blocks after the one same-head follow-up allowance is exhausted", () => {
  const config = createConfig({
    reviewBotLogins: ["copilot-pull-request-reviewer"],
  });
  const record = createRecord({
    state: "pr_open",
    last_head_sha: "head-a",
    processed_review_thread_ids: ["thread-1@head-a"],
    processed_review_thread_fingerprints: ["thread-1@head-a#comment-1"],
    review_follow_up_head_sha: "head-a",
    review_follow_up_remaining: 0,
  });
  const pr = createPullRequest({
    reviewDecision: "CHANGES_REQUESTED",
    headRefOid: "head-a",
  });

  assert.equal(inferStateFromPullRequest(config, record, pr, [], [createReviewThread()]), "blocked");
});
