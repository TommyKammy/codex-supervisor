import assert from "node:assert/strict";
import test from "node:test";
import {
  buildExternalReviewMissArtifact,
  readExternalReviewMissArtifactPatterns,
} from "./external-review-miss-artifact";
import {
  buildExternalReviewMissFollowUpDigest,
} from "./external-review-miss-digest";
import { type ExternalReviewMissArtifact } from "./external-review-miss-artifact-types";

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

test("buildExternalReviewMissArtifact assigns one deterministic prevention target to every missed finding", () => {
  const artifact = buildExternalReviewMissArtifact({
    issueNumber: 58,
    prNumber: 91,
    branch: "codex/issue-58",
    headSha: "deadbeefcafebabe",
    localReviewSummaryPath: "/tmp/head-deadbeef.md",
    localReviewFindingsPath: "/tmp/head-deadbeef.json",
    artifactPath: "/tmp/external-review-misses-head-deadbeefcafe.json",
    findings: [
      {
        classification: "missed_by_local_review",
        reviewerLogin: "copilot-pull-request-reviewer",
        file: "src/auth.ts",
        line: 42,
        summary: "Permission guard is bypassed.",
        rationale: "Check the permission guard before the fallback write path.",
        url: "https://example.test/pr/1#discussion_r1",
        sourceKind: "review_thread",
        sourceId: "thread-1",
        sourceUrl: "https://example.test/pr/1#discussion_r1",
        threadId: "thread-1",
        source: "external_bot",
        severity: "high",
        confidence: 0.9,
        matchedLocalReference: null,
        matchReason: "no same-file local-review match",
      },
      {
        classification: "missed_by_local_review",
        reviewerLogin: "coderabbitai[bot]",
        file: "src/cache.ts",
        line: 12,
        summary: "Retry coverage is missing around the cache reset path.",
        rationale: "Add a focused test that proves retries do not reuse stale cache state.",
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
        classification: "missed_by_local_review",
        reviewerLogin: "coderabbitai[bot]",
        file: null,
        line: null,
        summary: "The local review prompt should explicitly inspect migration rollback risks.",
        rationale: "The local review prompt should explicitly inspect migration rollback risks.",
        url: "https://example.test/pr/1#pullrequestreview-1",
        sourceKind: "top_level_review",
        sourceId: "review-1",
        sourceUrl: "https://example.test/pr/1#pullrequestreview-1",
        threadId: null,
        source: "external_bot",
        severity: "medium",
        confidence: 0.9,
        matchedLocalReference: null,
        matchReason: "no same-file local-review match",
      },
      {
        classification: "missed_by_local_review",
        reviewerLogin: "coderabbitai[bot]",
        file: null,
        line: null,
        summary: "The issue metadata should call out rollout and rollback expectations.",
        rationale: "The issue metadata should call out rollout and rollback expectations.",
        url: "https://example.test/pr/1#issuecomment-1",
        sourceKind: "issue_comment",
        sourceId: "issue-comment-1",
        sourceUrl: "https://example.test/pr/1#issuecomment-1",
        threadId: null,
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
        summary: "Matched finding should not gain a prevention target.",
        rationale: "Matched finding should not gain a prevention target.",
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
  });

  assert.deepEqual(
    artifact.findings.map((finding) => ({
      classification: finding.classification,
      preventionTarget: finding.preventionTarget,
    })),
    [
      {
        classification: "missed_by_local_review",
        preventionTarget: "durable_guardrail",
      },
      {
        classification: "missed_by_local_review",
        preventionTarget: "regression_test",
      },
      {
        classification: "missed_by_local_review",
        preventionTarget: "review_prompt",
      },
      {
        classification: "missed_by_local_review",
        preventionTarget: "issue_template",
      },
      {
        classification: "matched",
        preventionTarget: null,
      },
    ],
  );
});

test("buildExternalReviewMissFollowUpDigest groups missed findings by target and flags stale active heads", () => {
  const artifact = buildExternalReviewMissArtifact({
    issueNumber: 58,
    prNumber: 91,
    branch: "codex/issue-58",
    headSha: "deadbeefcafebabe",
    localReviewSummaryPath: "/tmp/head-deadbeef.md",
    localReviewFindingsPath: "/tmp/head-deadbeef.json",
    artifactPath: "/tmp/external-review-misses-head-deadbeefcafe.json",
    findings: [
      {
        classification: "missed_by_local_review",
        reviewerLogin: "copilot-pull-request-reviewer",
        file: "src/auth.ts",
        line: 42,
        summary: "Permission guard is bypassed.",
        rationale: "Check the permission guard before the fallback write path.",
        url: "https://example.test/pr/1#discussion_r1",
        sourceKind: "review_thread",
        sourceId: "thread-1",
        sourceUrl: "https://example.test/pr/1#discussion_r1",
        threadId: "thread-1",
        source: "external_bot",
        severity: "high",
        confidence: 0.9,
        matchedLocalReference: null,
        matchReason: "no same-file local-review match",
      },
      {
        classification: "missed_by_local_review",
        reviewerLogin: "coderabbitai[bot]",
        file: null,
        line: null,
        summary: "Issue instructions should call out rollout expectations.",
        rationale: "Issue instructions should call out rollout expectations.",
        url: "https://example.test/pr/1#issuecomment-1",
        sourceKind: "issue_comment",
        sourceId: "issue-comment-1",
        sourceUrl: "https://example.test/pr/1#issuecomment-1",
        threadId: null,
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
        summary: "Matched finding should stay out of the digest.",
        rationale: "Matched finding should stay out of the digest.",
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
  });

  const digest = buildExternalReviewMissFollowUpDigest({
    artifactPath: "/tmp/external-review-misses-head-deadbeefcafe.json",
    artifact,
    activeHeadSha: "feedfacecafebabe",
    localReviewSummaryPath: "/tmp/head-feedface.md",
    localReviewHeadSha: "feedfacecafebabe",
  });

  assert.match(digest, /- Head status: stale-head \(digest does not match the active PR head\)/);
  assert.match(digest, /## Durable guardrail \(1 finding\)/);
  assert.match(digest, /## Issue template \(1 finding\)/);
  assert.match(digest, /- Prevention target: durable_guardrail/);
  assert.match(digest, /- Prevention target: issue_template/);
  assert.doesNotMatch(digest, /Matched finding should stay out of the digest\./);
});

test("buildExternalReviewMissFollowUpDigest throws when a missed finding lacks a prevention target", () => {
  const artifact: ExternalReviewMissArtifact = {
    issueNumber: 58,
    prNumber: 91,
    branch: "codex/issue-58",
    headSha: "deadbeefcafebabe",
    generatedAt: "2026-03-18T00:00:00Z",
    localReviewSummaryPath: "/tmp/head-deadbeef.md",
    localReviewFindingsPath: "/tmp/head-deadbeef.json",
    findings: [
      {
        classification: "missed_by_local_review",
        reviewerLogin: "coderabbitai[bot]",
        file: null,
        line: null,
        summary: "Rollback expectations are missing from the issue guidance.",
        rationale: "Rollback expectations are missing from the issue guidance.",
        url: "https://example.test/pr/1#issuecomment-1",
        sourceKind: "issue_comment",
        sourceId: "issue-comment-1",
        sourceUrl: "https://example.test/pr/1#issuecomment-1",
        threadId: null,
        source: "external_bot",
        severity: "medium",
        confidence: 0.9,
        matchedLocalReference: null,
        matchReason: "no same-file local-review match",
        preventionTarget: null,
      },
    ],
    reusableMissPatterns: [],
    durableGuardrailCandidates: [],
    regressionTestCandidates: [],
    counts: {
      matched: 0,
      nearMatch: 0,
      missedByLocalReview: 1,
    },
  };

  assert.throws(
    () =>
      buildExternalReviewMissFollowUpDigest({
        artifactPath: "/tmp/external-review-misses-head-deadbeefcafe.json",
        artifact,
        activeHeadSha: "deadbeefcafebabe",
        localReviewSummaryPath: "/tmp/head-deadbeef.md",
        localReviewHeadSha: "deadbeefcafebabe",
      }),
    /Found 1 missed finding\(s\) without a prevention target in \/tmp\/external-review-misses-head-deadbeefcafe\.json/,
  );
});
