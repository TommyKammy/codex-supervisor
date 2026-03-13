import assert from "node:assert/strict";
import test from "node:test";
import { legacyReusableMissPatterns, toReusableMissPattern } from "./external-review-miss-patterns";
import { type ExternalReviewMissFinding } from "./external-review-classifier";

function createMissFinding(overrides: Partial<ExternalReviewMissFinding> = {}): ExternalReviewMissFinding {
  return {
    source: "external_bot",
    reviewerLogin: "copilot-pull-request-reviewer",
    threadId: "thread-1",
    file: "src/auth.ts",
    line: 42,
    summary: "This fallback skips the permission guard and lets unauthorized callers update records.",
    rationale:
      "This fallback skips the permission guard and lets unauthorized callers update records while bypassing the capability check on the fallback path.",
    severity: "medium",
    confidence: 0.9,
    url: "https://example.test/thread-1#comment-1",
    classification: "missed_by_local_review",
    matchedLocalReference: null,
    matchReason: "no same-file local-review match",
    ...overrides,
  };
}

test("toReusableMissPattern preserves persisted fingerprinting and truncation behavior", () => {
  const pattern = toReusableMissPattern(
    createMissFinding({
      rationale: "A".repeat(320),
    }),
    "/tmp/external-review-misses-head-deadbeef.json",
    "deadbeef",
    "2026-03-12T00:00:00Z",
  );

  assert.match(
    pattern.fingerprint,
    /^src\/auth\.ts\|this fallback skips the permission guard and lets unauthorized callers update records\.\|a{197}\.\.\.$/,
  );
  assert.equal(pattern.file, "src/auth.ts");
  assert.equal(pattern.rationale.length, 280);
  assert.equal(pattern.sourceHeadSha, "deadbeef");
});

test("legacyReusableMissPatterns only derives reusable entries from file-scoped confirmed misses", () => {
  const patterns = legacyReusableMissPatterns(
    {
      generatedAt: "2026-03-12T00:00:00Z",
      headSha: "deadbeef",
      findings: [
        createMissFinding(),
        createMissFinding({
          threadId: "thread-2",
          file: null,
        }),
        createMissFinding({
          threadId: "thread-3",
          classification: "near_match",
        }),
      ],
    },
    "/tmp/external-review-misses-head-deadbeef.json",
  );

  assert.deepEqual(
    patterns.map((pattern) => ({
      fingerprint: pattern.fingerprint,
      file: pattern.file,
      line: pattern.line,
      sourceHeadSha: pattern.sourceHeadSha,
      lastSeenAt: pattern.lastSeenAt,
    })),
    [
      {
        fingerprint:
          "src/auth.ts|this fallback skips the permission guard and lets unauthorized callers update records.|this fallback skips the permission guard and lets unauthorized callers update records while bypassing the capability check on the fallback path.",
        file: "src/auth.ts",
        line: 42,
        sourceHeadSha: "deadbeef",
        lastSeenAt: "2026-03-12T00:00:00Z",
      },
    ],
  );
});
