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

test("toDurableGuardrailCandidates allows unanchored actionable top-level reviews only for reviewer_rubric", () => {
  const candidates = toDurableGuardrailCandidates({
    issueNumber: 85,
    prNumber: 144,
    branch: "codex/issue-85",
    headSha: "deadbeefcafebabe",
    sourceArtifactPath: "/tmp/external-review-misses-head-deadbeef.json",
    localReviewSummaryPath: "/tmp/head-deadbeef.md",
    localReviewFindingsPath: "/tmp/head-deadbeef.json",
    finding: createMissFinding({
      sourceKind: "top_level_review",
      sourceId: "review-7",
      sourceUrl: "https://example.test/pr/1#pullrequestreview-7",
      threadId: null,
      file: null,
      line: null,
      summary: "Bug: retries can reuse stale state and mask the latest failure.",
      rationale: "Bug: retries can reuse stale state and mask the latest failure.",
      severity: "medium",
      url: "https://example.test/pr/1#pullrequestreview-7",
    }),
  });

  assert.deepEqual(candidates, [
    {
      id: "reviewer_rubric|top_level_review|bug: retries can reuse stale state and mask the latest failure.",
      category: "reviewer_rubric",
      title: "Promote reviewer rubric guardrail for Bug: retries can reuse stale state and mask the latest failure",
      reviewerLogin: "copilot-pull-request-reviewer",
      file: null,
      line: null,
      summary: "Bug: retries can reuse stale state and mask the latest failure.",
      rationale: "Bug: retries can reuse stale state and mask the latest failure.",
      qualificationReasons: ["missed_by_local_review", "high_confidence", "top_level_review_unanchored", "non_low_severity"],
      provenance: {
        issueNumber: 85,
        prNumber: 144,
        branch: "codex/issue-85",
        headSha: "deadbeefcafebabe",
        sourceKind: "top_level_review",
        sourceId: "review-7",
        sourceThreadId: null,
        sourceUrl: "https://example.test/pr/1#pullrequestreview-7",
        sourceArtifactPath: "/tmp/external-review-misses-head-deadbeef.json",
        localReviewSummaryPath: "/tmp/head-deadbeef.md",
        localReviewFindingsPath: "/tmp/head-deadbeef.json",
        matchedLocalReference: null,
        matchReason: "no same-file local-review match",
      },
    },
  ]);
});

test("toDurableGuardrailCandidates restricts file-scoped top-level reviews to reviewer_rubric", () => {
  const candidates = toDurableGuardrailCandidates({
    issueNumber: 85,
    prNumber: 144,
    branch: "codex/issue-85",
    headSha: "deadbeefcafebabe",
    sourceArtifactPath: "/tmp/external-review-misses-head-deadbeef.json",
    localReviewSummaryPath: "/tmp/head-deadbeef.md",
    localReviewFindingsPath: "/tmp/head-deadbeef.json",
    finding: createMissFinding({
      sourceKind: "top_level_review",
      sourceId: "review-7",
      sourceUrl: "https://example.test/pr/1#pullrequestreview-7",
      threadId: null,
      severity: "high",
      url: "https://example.test/pr/1#pullrequestreview-7",
    }),
  });

  assert.deepEqual(candidates.map((candidate) => candidate.category), ["reviewer_rubric"]);
});

test("toDurableGuardrailCandidates does not durably promote issue comments by default", () => {
  const candidates = toDurableGuardrailCandidates({
    issueNumber: 85,
    prNumber: 144,
    branch: "codex/issue-85",
    headSha: "deadbeefcafebabe",
    sourceArtifactPath: "/tmp/external-review-misses-head-deadbeef.json",
    localReviewSummaryPath: "/tmp/head-deadbeef.md",
    localReviewFindingsPath: "/tmp/head-deadbeef.json",
    finding: createMissFinding({
      sourceKind: "issue_comment",
      sourceId: "issue-comment-7",
      sourceUrl: "https://example.test/pr/1#issuecomment-7",
      threadId: null,
      url: "https://example.test/pr/1#issuecomment-7",
    }),
  });

  assert.deepEqual(candidates, []);
});

test("toDurableGuardrailCandidates keeps unanchored durable ids stable across PR-local source ids", () => {
  const findingA = createMissFinding({
    sourceKind: "top_level_review",
    sourceId: "review-7",
    sourceUrl: "https://example.test/pr/1#pullrequestreview-7",
    threadId: null,
    file: null,
    line: null,
    rationale: "Bug: retries can reuse stale state and mask the latest failure.",
    severity: "medium",
    url: "https://example.test/pr/1#pullrequestreview-7",
  });
  const findingB = createMissFinding({
    sourceKind: "top_level_review",
    sourceId: "review-99",
    sourceUrl: "https://example.test/pr/2#pullrequestreview-99",
    threadId: null,
    file: null,
    line: null,
    rationale: "  Bug: retries can reuse stale state and mask the latest failure.\n",
    severity: "medium",
    url: "https://example.test/pr/2#pullrequestreview-99",
  });

  const candidateA = toDurableGuardrailCandidates({
    issueNumber: 85,
    prNumber: 144,
    branch: "codex/issue-85",
    headSha: "deadbeefcafebabe",
    sourceArtifactPath: "/tmp/external-review-misses-head-deadbeef.json",
    localReviewSummaryPath: "/tmp/head-deadbeef.md",
    localReviewFindingsPath: "/tmp/head-deadbeef.json",
    finding: findingA,
  });
  const candidateB = toDurableGuardrailCandidates({
    issueNumber: 86,
    prNumber: 145,
    branch: "codex/issue-86",
    headSha: "feedfacecafebabe",
    sourceArtifactPath: "/tmp/external-review-misses-head-feedface.json",
    localReviewSummaryPath: "/tmp/head-feedface.md",
    localReviewFindingsPath: "/tmp/head-feedface.json",
    finding: findingB,
  });

  assert.equal(candidateA[0]?.id, "reviewer_rubric|top_level_review|bug: retries can reuse stale state and mask the latest failure.");
  assert.equal(candidateA[0]?.id, candidateB[0]?.id);
});

test("toDurableGuardrailCandidates trims anchored file values before emitting ids and payloads", () => {
  const candidates = toDurableGuardrailCandidates({
    issueNumber: 85,
    prNumber: 144,
    branch: "codex/issue-85",
    headSha: "deadbeefcafebabe",
    sourceArtifactPath: "/tmp/external-review-misses-head-deadbeef.json",
    localReviewSummaryPath: "/tmp/head-deadbeef.md",
    localReviewFindingsPath: "/tmp/head-deadbeef.json",
    finding: createMissFinding({
      file: " src/auth.ts ",
      line: 42,
      severity: "medium",
    }),
  });

  assert.equal(candidates[0]?.id, "reviewer_rubric|src/auth.ts|42|this fallback skips the permission guard and lets unauthorized callers update records.");
  assert.equal(candidates[0]?.file, "src/auth.ts");
});

test("toDurableGuardrailCandidates treats whitespace-only file values as unanchored for top-level reviews", () => {
  const candidates = toDurableGuardrailCandidates({
    issueNumber: 85,
    prNumber: 144,
    branch: "codex/issue-85",
    headSha: "deadbeefcafebabe",
    sourceArtifactPath: "/tmp/external-review-misses-head-deadbeef.json",
    localReviewSummaryPath: "/tmp/head-deadbeef.md",
    localReviewFindingsPath: "/tmp/head-deadbeef.json",
    finding: createMissFinding({
      sourceKind: "top_level_review",
      sourceId: "review-whitespace",
      sourceUrl: "https://example.test/pr/1#pullrequestreview-whitespace",
      threadId: null,
      file: "   ",
      line: null,
      summary: "Bug: retries can reuse stale state and mask the latest failure.",
      rationale: "Bug: retries can reuse stale state and mask the latest failure.",
      severity: "medium",
      url: "https://example.test/pr/1#pullrequestreview-whitespace",
    }),
  });

  assert.equal(candidates.length, 1);
  assert.equal(candidates[0]?.category, "reviewer_rubric");
  assert.equal(
    candidates[0]?.id,
    "reviewer_rubric|top_level_review|bug: retries can reuse stale state and mask the latest failure.",
  );
  assert.deepEqual(candidates[0]?.qualificationReasons, [
    "missed_by_local_review",
    "high_confidence",
    "top_level_review_unanchored",
    "non_low_severity",
  ]);
});
