import assert from "node:assert/strict";
import test from "node:test";
import { collectExternalReviewSignals } from "./external-review-signal-collection";
import { IssueComment, PullRequestReview, ReviewThread } from "../core/types";

function createReviewThread(overrides: Partial<ReviewThread> = {}): ReviewThread {
  return {
    id: "thread-1",
    isResolved: false,
    isOutdated: false,
    path: "src/auth.ts",
    line: 42,
    comments: {
      nodes: [
        {
          id: "comment-1",
          body: "This fallback skips the permission guard and lets unauthorized callers update records.",
          createdAt: "2026-03-12T00:00:00Z",
          url: "https://example.test/thread-1#comment-1",
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

function createTopLevelReview(overrides: Partial<PullRequestReview> = {}): PullRequestReview {
  return {
    id: "review-1",
    body: "Nitpick: this nil check is inverted and can mask the error path.",
    submittedAt: "2026-03-12T00:03:00Z",
    url: "https://example.test/pr/1#pullrequestreview-1",
    state: "COMMENTED",
    author: {
      login: "coderabbitai[bot]",
      typeName: "Bot",
    },
    ...overrides,
  };
}

function createIssueComment(overrides: Partial<IssueComment> = {}): IssueComment {
  return {
    id: "issue-comment-1",
    body: "Suggestion: the fallback path should guard against unauthorized writes before persisting.",
    createdAt: "2026-03-12T00:04:00Z",
    url: "https://example.test/pr/1#issuecomment-1",
    author: {
      login: "coderabbitai[bot]",
      typeName: "Bot",
    },
    ...overrides,
  };
}

test("collectExternalReviewSignals uses the final configured-bot thread comment", () => {
  const signals = collectExternalReviewSignals({
    reviewThreads: [
      createReviewThread({
        comments: {
          nodes: [
            {
              id: "comment-1",
              body: "Initial note.",
              createdAt: "2026-03-12T00:00:00Z",
              url: "https://example.test/thread-1#comment-1",
              author: {
                login: "copilot-pull-request-reviewer",
                typeName: "Bot",
              },
            },
            {
              id: "comment-2",
              body: "Author reply",
              createdAt: "2026-03-12T00:01:00Z",
              url: "https://example.test/thread-1#comment-2",
              author: {
                login: "tommy",
                typeName: "User",
              },
            },
            {
              id: "comment-3",
              body: "This fallback skips the permission guard and lets unauthorized callers update records.",
              createdAt: "2026-03-12T00:02:00Z",
              url: "https://example.test/thread-1#comment-3",
              author: {
                login: "copilot-pull-request-reviewer",
                typeName: "Bot",
              },
            },
          ],
        },
      }),
    ],
    reviewBotLogins: ["copilot-pull-request-reviewer"],
  });

  assert.deepEqual(signals, [
    {
      sourceKind: "review_thread",
      sourceId: "thread-1",
      sourceUrl: "https://example.test/thread-1#comment-3",
      reviewerLogin: "copilot-pull-request-reviewer",
      body: "This fallback skips the permission guard and lets unauthorized callers update records.",
      file: "src/auth.ts",
      line: 42,
      threadId: "thread-1",
    },
  ]);
});

test("collectExternalReviewSignals normalizes thread, top-level review, and issue comment sources through one shared model", () => {
  const signals = collectExternalReviewSignals({
    reviewThreads: [createReviewThread()],
    reviews: [createTopLevelReview()],
    issueComments: [createIssueComment()],
    reviewBotLogins: ["copilot-pull-request-reviewer", "coderabbitai[bot]"],
  });

  assert.deepEqual(
    signals.map((signal) => ({
      sourceKind: signal.sourceKind,
      sourceId: signal.sourceId,
      file: signal.file,
      line: signal.line,
      threadId: signal.threadId,
    })),
    [
      {
        sourceKind: "review_thread",
        sourceId: "thread-1",
        file: "src/auth.ts",
        line: 42,
        threadId: "thread-1",
      },
      {
        sourceKind: "top_level_review",
        sourceId: "review-1",
        file: null,
        line: null,
        threadId: null,
      },
      {
        sourceKind: "issue_comment",
        sourceId: "issue-comment-1",
        file: null,
        line: null,
        threadId: null,
      },
    ],
  );
});

test("collectExternalReviewSignals preserves actionable top-level reviews that only expose review state", () => {
  const signals = collectExternalReviewSignals({
    reviews: [
      createTopLevelReview({
        id: "review-state-only",
        body: null,
        state: "CHANGES_REQUESTED",
        url: "https://example.test/pr/1#pullrequestreview-2",
      }),
    ],
    reviewBotLogins: ["coderabbitai[bot]"],
  });

  assert.deepEqual(signals, [
    {
      sourceKind: "top_level_review",
      sourceId: "review-state-only",
      sourceUrl: "https://example.test/pr/1#pullrequestreview-2",
      reviewerLogin: "coderabbitai[bot]",
      body: "CHANGES_REQUESTED",
      file: null,
      line: null,
      threadId: null,
    },
  ]);
});

test("collectExternalReviewSignals ignores late configured-bot closed-PR follow-up issue comments", () => {
  const signals = collectExternalReviewSignals({
    issueComments: [
      createIssueComment({
        body: "This pull request is already closed. Please ignore this follow-up review comment.",
      }),
    ],
    reviewBotLogins: ["coderabbitai[bot]"],
  });

  assert.deepEqual(signals, []);
});
