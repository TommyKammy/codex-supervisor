import assert from "node:assert/strict";
import test from "node:test";
import { normalizeExternalReviewSignal } from "./external-review-normalization";
import { toExternalReviewThreadSignal } from "./external-review-signal-collection";
import { ReviewThread } from "../core/types";

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

test("normalizeExternalReviewSignal shapes the selected configured-bot thread signal into a finding", () => {
  const thread = createReviewThread({
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
  });

  const signal = toExternalReviewThreadSignal(thread, ["copilot-pull-request-reviewer"]);
  const finding = signal ? normalizeExternalReviewSignal(signal) : null;
  assert.equal(finding?.reviewerLogin, "copilot-pull-request-reviewer");
  assert.equal(finding?.file, "src/auth.ts");
  assert.equal(finding?.line, 42);
  assert.match(finding?.summary ?? "", /permission guard/i);
  assert.equal(finding?.severity, "medium");
  assert.equal(finding?.confidence, 0.75);
});
