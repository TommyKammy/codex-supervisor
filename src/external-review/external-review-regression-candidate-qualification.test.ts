import assert from "node:assert/strict";
import test from "node:test";
import {
  qualifyRegressionCandidateFinding,
} from "./external-review-regression-candidate-qualification";
import { type ExternalReviewMissFinding } from "./external-review-classifier";

function createMissFinding(overrides: Partial<ExternalReviewMissFinding> = {}): ExternalReviewMissFinding {
  return {
    source: "external_bot",
    sourceKind: "review_thread",
    sourceId: "thread-1",
    sourceUrl: "https://example.test/thread-1#comment-1",
    reviewerLogin: "copilot-pull-request-reviewer",
    threadId: "thread-1",
    file: "src/auth.ts",
    line: 42,
    summary: "This fallback skips the permission guard and lets unauthorized callers update records.",
    rationale: "This fallback skips the permission guard and lets unauthorized callers update records.",
    severity: "medium",
    confidence: 0.9,
    url: "https://example.test/thread-1#comment-1",
    classification: "missed_by_local_review",
    matchedLocalReference: null,
    matchReason: "no same-file local-review match",
    ...overrides,
  };
}

test("qualifyRegressionCandidateFinding captures the regression boundary without durable-only shaping", () => {
  const qualification = qualifyRegressionCandidateFinding(createMissFinding());

  assert.deepEqual(qualification, {
    id: "src/auth.ts|42|this fallback skips the permission guard and lets unauthorized callers update records.",
    file: "src/auth.ts",
    line: 42,
    qualificationReasons: ["missed_by_local_review", "non_low_severity", "high_confidence", "file_scoped", "line_scoped"],
  });
});

test("qualifyRegressionCandidateFinding rejects misses outside the regression boundary", () => {
  assert.equal(
    qualifyRegressionCandidateFinding(
      createMissFinding({
        severity: "low",
      }),
    ),
    null,
  );
  assert.equal(
    qualifyRegressionCandidateFinding(
      createMissFinding({
        sourceKind: "top_level_review",
        sourceId: "review-1",
        sourceUrl: "https://example.test/pr/1#pullrequestreview-1",
        threadId: null,
        url: "https://example.test/pr/1#pullrequestreview-1",
      }),
    ),
    null,
  );
  assert.equal(
    qualifyRegressionCandidateFinding(
      createMissFinding({
        sourceKind: "issue_comment",
        sourceId: "issue-comment-1",
        sourceUrl: "https://example.test/pr/1#issuecomment-1",
        threadId: null,
        url: "https://example.test/pr/1#issuecomment-1",
      }),
    ),
    null,
  );
  assert.equal(
    qualifyRegressionCandidateFinding(
      createMissFinding({
        confidence: 0.74,
      }),
    ),
    null,
  );
  assert.equal(
    qualifyRegressionCandidateFinding(
      createMissFinding({
        file: "   ",
      }),
    ),
    null,
  );
  assert.equal(
    qualifyRegressionCandidateFinding(
      createMissFinding({
        line: null,
      }),
    ),
    null,
  );
});
