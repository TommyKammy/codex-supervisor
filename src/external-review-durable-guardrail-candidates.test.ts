import assert from "node:assert/strict";
import test from "node:test";
import { toDurableGuardrailCandidates } from "./external-review-durable-guardrail-candidates";
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
    severity: "high",
    confidence: 0.9,
    url: "https://example.test/thread-1#comment-1",
    classification: "missed_by_local_review",
    matchedLocalReference: null,
    matchReason: "no same-file local-review match",
    ...overrides,
  };
}

test("toDurableGuardrailCandidates emits explicit categories with deterministic provenance", () => {
  const candidates = toDurableGuardrailCandidates({
    issueNumber: 85,
    prNumber: 144,
    branch: "codex/issue-85",
    headSha: "deadbeefcafebabe",
    sourceArtifactPath: "/tmp/external-review-misses-head-deadbeef.json",
    localReviewSummaryPath: "/tmp/head-deadbeef.md",
    localReviewFindingsPath: "/tmp/head-deadbeef.json",
    finding: createMissFinding(),
  });

  assert.deepEqual(candidates, [
    {
      id: "reviewer_rubric|src/auth.ts|42|this fallback skips the permission guard and lets unauthorized callers update records.",
      category: "reviewer_rubric",
      title: "Promote reviewer rubric guardrail for This fallback skips the permission guard and lets unauthorized callers update records",
      reviewerLogin: "copilot-pull-request-reviewer",
      file: "src/auth.ts",
      line: 42,
      summary: "This fallback skips the permission guard and lets unauthorized callers update records.",
      rationale: "This fallback skips the permission guard and lets unauthorized callers update records.",
      qualificationReasons: ["missed_by_local_review", "high_confidence", "file_scoped", "non_low_severity"],
      provenance: {
        issueNumber: 85,
        prNumber: 144,
        branch: "codex/issue-85",
        headSha: "deadbeefcafebabe",
        sourceKind: "review_thread",
        sourceId: "thread-1",
        sourceThreadId: "thread-1",
        sourceUrl: "https://example.test/thread-1#comment-1",
        sourceArtifactPath: "/tmp/external-review-misses-head-deadbeef.json",
        localReviewSummaryPath: "/tmp/head-deadbeef.md",
        localReviewFindingsPath: "/tmp/head-deadbeef.json",
        matchedLocalReference: null,
        matchReason: "no same-file local-review match",
      },
    },
    {
      id: "verifier|src/auth.ts|42|this fallback skips the permission guard and lets unauthorized callers update records.",
      category: "verifier",
      title: "Promote verifier guardrail for This fallback skips the permission guard and lets unauthorized callers update records",
      reviewerLogin: "copilot-pull-request-reviewer",
      file: "src/auth.ts",
      line: 42,
      summary: "This fallback skips the permission guard and lets unauthorized callers update records.",
      rationale: "This fallback skips the permission guard and lets unauthorized callers update records.",
      qualificationReasons: ["missed_by_local_review", "high_confidence", "file_scoped", "high_severity", "line_scoped"],
      provenance: {
        issueNumber: 85,
        prNumber: 144,
        branch: "codex/issue-85",
        headSha: "deadbeefcafebabe",
        sourceKind: "review_thread",
        sourceId: "thread-1",
        sourceThreadId: "thread-1",
        sourceUrl: "https://example.test/thread-1#comment-1",
        sourceArtifactPath: "/tmp/external-review-misses-head-deadbeef.json",
        localReviewSummaryPath: "/tmp/head-deadbeef.md",
        localReviewFindingsPath: "/tmp/head-deadbeef.json",
        matchedLocalReference: null,
        matchReason: "no same-file local-review match",
      },
    },
    {
      id: "regression_test|src/auth.ts|42|this fallback skips the permission guard and lets unauthorized callers update records.",
      category: "regression_test",
      title: "Promote regression-test guardrail for This fallback skips the permission guard and lets unauthorized callers update records",
      reviewerLogin: "copilot-pull-request-reviewer",
      file: "src/auth.ts",
      line: 42,
      summary: "This fallback skips the permission guard and lets unauthorized callers update records.",
      rationale: "This fallback skips the permission guard and lets unauthorized callers update records.",
      qualificationReasons: ["missed_by_local_review", "high_confidence", "file_scoped", "non_low_severity", "line_scoped"],
      provenance: {
        issueNumber: 85,
        prNumber: 144,
        branch: "codex/issue-85",
        headSha: "deadbeefcafebabe",
        sourceKind: "review_thread",
        sourceId: "thread-1",
        sourceThreadId: "thread-1",
        sourceUrl: "https://example.test/thread-1#comment-1",
        sourceArtifactPath: "/tmp/external-review-misses-head-deadbeef.json",
        localReviewSummaryPath: "/tmp/head-deadbeef.md",
        localReviewFindingsPath: "/tmp/head-deadbeef.json",
        matchedLocalReference: null,
        matchReason: "no same-file local-review match",
      },
    },
  ]);
});

test("toDurableGuardrailCandidates rejects weak or ambiguous misses deterministically", () => {
  assert.deepEqual(
    toDurableGuardrailCandidates({
      issueNumber: 85,
      prNumber: 144,
      branch: "codex/issue-85",
      headSha: "deadbeefcafebabe",
      sourceArtifactPath: "/tmp/external-review-misses-head-deadbeef.json",
      localReviewSummaryPath: "/tmp/head-deadbeef.md",
      localReviewFindingsPath: "/tmp/head-deadbeef.json",
      finding: createMissFinding({
        severity: "low",
      }),
    }).map((candidate) => candidate.category),
    [],
  );

  assert.deepEqual(
    toDurableGuardrailCandidates({
      issueNumber: 85,
      prNumber: 144,
      branch: "codex/issue-85",
      headSha: "deadbeefcafebabe",
      sourceArtifactPath: "/tmp/external-review-misses-head-deadbeef.json",
      localReviewSummaryPath: "/tmp/head-deadbeef.md",
      localReviewFindingsPath: "/tmp/head-deadbeef.json",
      finding: createMissFinding({
        severity: "medium",
      }),
    }).map((candidate) => candidate.category),
    ["reviewer_rubric", "regression_test"],
  );

  assert.deepEqual(
    toDurableGuardrailCandidates({
      issueNumber: 85,
      prNumber: 144,
      branch: "codex/issue-85",
      headSha: "deadbeefcafebabe",
      sourceArtifactPath: "/tmp/external-review-misses-head-deadbeef.json",
      localReviewSummaryPath: "/tmp/head-deadbeef.md",
      localReviewFindingsPath: "/tmp/head-deadbeef.json",
      finding: createMissFinding({
        confidence: 0.74,
      }),
    }),
    [],
  );

  assert.deepEqual(
    toDurableGuardrailCandidates({
      issueNumber: 85,
      prNumber: 144,
      branch: "codex/issue-85",
      headSha: "deadbeefcafebabe",
      sourceArtifactPath: "/tmp/external-review-misses-head-deadbeef.json",
      localReviewSummaryPath: "/tmp/head-deadbeef.md",
      localReviewFindingsPath: "/tmp/head-deadbeef.json",
      finding: createMissFinding({
        line: null,
      }),
    }).map((candidate) => candidate.category),
    ["reviewer_rubric"],
  );
});
