import assert from "node:assert/strict";
import test from "node:test";
import { classifyExternalReviewFinding } from "./external-review-classifier";
import { normalizeExternalReviewFinding } from "./external-review-normalization";
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

test("classifyExternalReviewFinding marks unmatched configured-bot feedback as missed_by_local_review", () => {
  const normalized = normalizeExternalReviewFinding(createReviewThread(), ["copilot-pull-request-reviewer"]);
  assert.ok(normalized);

  const classified = classifyExternalReviewFinding(normalized, {
    actionableFindings: [
      {
        title: "Missing cache invalidation",
        body: "The cache never clears after a successful save, so readers can observe stale data.",
        file: "src/cache.ts",
        start: 15,
        end: 20,
        severity: "medium",
      },
    ],
    rootCauseSummaries: [
      {
        summary: "Saving data leaves stale cache entries behind.",
        file: "src/cache.ts",
        start: 15,
        end: 20,
        severity: "medium",
      },
    ],
  });

  assert.equal(classified.classification, "missed_by_local_review");
  assert.equal(classified.matchedLocalReference, null);
  assert.match(classified.matchReason, /no same-file local-review match/);
});

test("classifyExternalReviewFinding marks same-hunk findings as matched even with low text overlap", () => {
  const normalized = normalizeExternalReviewFinding(
    createReviewThread({
      path: "src/auth.ts",
      line: 44,
      comments: {
        nodes: [
          {
            id: "comment-1",
            body: "The fallback write runs before the authorization check in this branch.",
            createdAt: "2026-03-12T00:00:00Z",
            url: "https://example.test/thread-1#comment-1",
            author: {
              login: "copilot-pull-request-reviewer",
              typeName: "Bot",
            },
          },
        ],
      },
    }),
    ["copilot-pull-request-reviewer"],
  );
  assert.ok(normalized);

  const classified = classifyExternalReviewFinding(normalized, {
    actionableFindings: [
      {
        title: "Authorization check missing in a nearby helper",
        body: "This branch runs the fallback write before the authorization check and capability gate.",
        file: "src/auth.ts",
        start: 60,
        end: 64,
        severity: "medium",
      },
      {
        title: "Guard ordering bug in fallback branch",
        body: "Delay the persistence path until the capability gate passes.",
        file: "src/auth.ts",
        start: 41,
        end: 46,
        severity: "medium",
      },
    ],
    rootCauseSummaries: [],
  });

  assert.equal(classified.classification, "matched");
  assert.equal(classified.matchedLocalReference, "actionable:2");
  assert.match(classified.matchReason, /^same-hunk/);
  assert.match(classified.matchReason, /\bsame_hunk=yes\b/);
});

test("classifyExternalReviewFinding keeps nearby same-file findings as near_match with stable match reasons", () => {
  const normalized = normalizeExternalReviewFinding(
    createReviewThread({
      path: "src/auth.ts",
      line: 42,
      comments: {
        nodes: [
          {
            id: "comment-1",
            body: "Fallback writes bypass authorization and can update records without the guard.",
            createdAt: "2026-03-12T00:00:00Z",
            url: "https://example.test/thread-1#comment-1",
            author: {
              login: "copilot-pull-request-reviewer",
              typeName: "Bot",
            },
          },
        ],
      },
    }),
    ["copilot-pull-request-reviewer"],
  );
  assert.ok(normalized);

  const classified = classifyExternalReviewFinding(normalized, {
    actionableFindings: [
      {
        title: "Nearby authorization concern",
        body: "Capability gate ordering is wrong in this helper path.",
        file: "src/auth.ts",
        start: 50,
        end: 54,
        severity: "medium",
      },
    ],
    rootCauseSummaries: [],
  });

  assert.equal(classified.classification, "near_match");
  assert.equal(classified.matchedLocalReference, "actionable:1");
  assert.equal(classified.matchReason, "same-file overlap=0.11 line_distance=8 same_hunk=no");
});
