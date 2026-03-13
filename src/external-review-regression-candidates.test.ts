import assert from "node:assert/strict";
import test from "node:test";
import { toRegressionTestCandidate } from "./external-review-regression-candidates";
import { type ExternalReviewMissFinding } from "./external-review-classifier";

function createMissFinding(overrides: Partial<ExternalReviewMissFinding> = {}): ExternalReviewMissFinding {
  return {
    source: "external_bot",
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

test("toRegressionTestCandidate keeps persisted ids and qualification reasons stable", () => {
  const candidate = toRegressionTestCandidate(createMissFinding());
  assert.deepEqual(candidate, {
    id: "src/auth.ts|42|this fallback skips the permission guard and lets unauthorized callers update records.",
    title: "Add regression coverage for This fallback skips the permission guard and lets unauthorized callers update records",
    file: "src/auth.ts",
    line: 42,
    summary: "This fallback skips the permission guard and lets unauthorized callers update records.",
    rationale: "This fallback skips the permission guard and lets unauthorized callers update records.",
    reviewerLogin: "copilot-pull-request-reviewer",
    sourceThreadId: "thread-1",
    sourceUrl: "https://example.test/thread-1#comment-1",
    qualificationReasons: ["missed_by_local_review", "non_low_severity", "high_confidence", "file_scoped", "line_scoped"],
  });
});

test("toRegressionTestCandidate rejects misses that do not meet the durable regression bar", () => {
  assert.equal(
    toRegressionTestCandidate(
      createMissFinding({
        severity: "low",
      }),
    ),
    null,
  );
  assert.equal(
    toRegressionTestCandidate(
      createMissFinding({
        confidence: 0.74,
      }),
    ),
    null,
  );
  assert.equal(
    toRegressionTestCandidate(
      createMissFinding({
        line: null,
      }),
    ),
    null,
  );
});
