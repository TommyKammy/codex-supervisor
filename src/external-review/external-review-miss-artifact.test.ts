import assert from "node:assert/strict";
import test from "node:test";
import { readExternalReviewMissArtifactPatterns } from "./external-review-miss-artifact";

test("readExternalReviewMissArtifactPatterns prefers persisted reusable patterns", () => {
  const artifactPath = "/tmp/external-review-misses-head-newest.json";
  const patterns = readExternalReviewMissArtifactPatterns(
    {
      generatedAt: "2026-03-12T00:00:00Z",
      headSha: "newesthead",
      reusableMissPatterns: [
        {
          fingerprint: "src/auth.ts|permission",
          reviewerLogin: "copilot-pull-request-reviewer",
          file: "src/auth.ts",
          line: 42,
          summary: "Permission guard is bypassed.",
          rationale: "Check the permission guard before the fallback write path.",
          sourceArtifactPath: artifactPath,
          sourceHeadSha: "newesthead",
          lastSeenAt: "2026-03-12T00:00:00Z",
        },
      ],
      findings: [
        {
          classification: "missed_by_local_review",
          reviewerLogin: "copilot-pull-request-reviewer",
          file: "src/auth.ts",
          line: 19,
          summary: "Older fallback summary should not be used.",
          rationale: "Older fallback rationale should not be used.",
          url: "https://example.test/pr/1#discussion_r1",
          sourceKind: "review_thread",
          sourceId: "thread-1",
          sourceUrl: "https://example.test/pr/1#discussion_r1",
          threadId: "thread-1",
          source: "external_bot",
          severity: "medium",
          confidence: 0.9,
          matchedLocalReference: null,
          matchReason: "no same-file local-review match",
        },
      ],
    },
    artifactPath,
  );

  assert.deepEqual(patterns.map((pattern) => ({ summary: pattern.summary, line: pattern.line })), [
    {
      summary: "Permission guard is bypassed.",
      line: 42,
    },
  ]);
});

test("readExternalReviewMissArtifactPatterns honors persisted empty reusable patterns", () => {
  const artifactPath = "/tmp/external-review-misses-head-empty.json";
  const patterns = readExternalReviewMissArtifactPatterns(
    {
      generatedAt: "2026-03-12T00:00:00Z",
      headSha: "emptyhead",
      reusableMissPatterns: [],
      findings: [
        {
          classification: "missed_by_local_review",
          reviewerLogin: "copilot-pull-request-reviewer",
          file: "src/auth.ts",
          line: 19,
          summary: "Legacy fallback summary should not be reused.",
          rationale: "Legacy fallback rationale should not be reused.",
          url: "https://example.test/pr/1#discussion_r4",
          sourceKind: "review_thread",
          sourceId: "thread-4",
          sourceUrl: "https://example.test/pr/1#discussion_r4",
          threadId: "thread-4",
          source: "external_bot",
          severity: "medium",
          confidence: 0.9,
          matchedLocalReference: null,
          matchReason: "no same-file local-review match",
        },
      ],
    },
    artifactPath,
  );

  assert.deepEqual(patterns, []);
});

test("readExternalReviewMissArtifactPatterns derives reusable patterns from legacy missed findings", () => {
  const artifactPath = "/tmp/external-review-misses-head-legacy.json";
  const patterns = readExternalReviewMissArtifactPatterns(
    {
      generatedAt: "2026-03-10T00:00:00Z",
      headSha: "legacyhead",
      findings: [
        {
          classification: "missed_by_local_review",
          reviewerLogin: "copilot-pull-request-reviewer",
          file: "src/auth.ts",
          line: 42,
          summary: "Permission guard is bypassed.",
          rationale: "Check the permission guard before the fallback write path.",
          url: "https://example.test/pr/1#discussion_r2",
          sourceKind: "review_thread",
          sourceId: "thread-2",
          sourceUrl: "https://example.test/pr/1#discussion_r2",
          threadId: "thread-2",
          source: "external_bot",
          severity: "medium",
          confidence: 0.9,
          matchedLocalReference: null,
          matchReason: "no same-file local-review match",
        },
        {
          classification: "matched",
          reviewerLogin: "copilot-pull-request-reviewer",
          file: "src/retry.ts",
          line: 12,
          summary: "Matched finding should not be reused.",
          rationale: "Matched finding should not be reused.",
          url: "https://example.test/pr/1#discussion_r3",
          sourceKind: "review_thread",
          sourceId: "thread-3",
          sourceUrl: "https://example.test/pr/1#discussion_r3",
          threadId: "thread-3",
          source: "external_bot",
          severity: "medium",
          confidence: 0.9,
          matchedLocalReference: "actionable:1",
          matchReason: "same-file overlap=0.40 line_distance=0 same_hunk=yes",
        },
      ],
    },
    artifactPath,
  );

  assert.deepEqual(
    patterns.map((pattern) => ({
      file: pattern.file,
      line: pattern.line,
      summary: pattern.summary,
      sourceArtifactPath: pattern.sourceArtifactPath,
      sourceHeadSha: pattern.sourceHeadSha,
      lastSeenAt: pattern.lastSeenAt,
    })),
    [
      {
        file: "src/auth.ts",
        line: 42,
        summary: "Permission guard is bypassed.",
        sourceArtifactPath: artifactPath,
        sourceHeadSha: "legacyhead",
        lastSeenAt: "2026-03-10T00:00:00Z",
      },
    ],
  );
});
