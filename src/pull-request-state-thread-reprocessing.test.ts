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
