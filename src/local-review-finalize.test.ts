import assert from "node:assert/strict";
import test from "node:test";
import { finalizeLocalReview } from "./local-review-finalize";
import { createConfig, createDetectedRoles } from "./local-review-test-helpers";

test("finalizeLocalReview keeps raw high-severity findings separate from dismissed verifier results", () => {
  const result = finalizeLocalReview({
    config: createConfig({ localReviewConfidenceThreshold: 0.7 }),
    issueNumber: 38,
    prNumber: 12,
    branch: "codex/issue-38",
    headSha: "deadbeefcafebabe",
    roleResults: [
      {
        role: "reviewer",
        summary: "Flagged one high issue and one medium issue.",
        recommendation: "changes_requested",
        degraded: false,
        exitCode: 0,
        rawOutput: "review raw output",
        findings: [
          {
            role: "reviewer",
            title: "False high severity",
            body: "Looks severe at first glance.",
            file: "src/example.ts",
            start: 10,
            end: 12,
            severity: "high",
            confidence: 0.95,
            category: "correctness",
            evidence: "Initial evidence",
          },
          {
            role: "reviewer",
            title: "Real medium severity",
            body: "This still needs follow-up.",
            file: "src/example.ts",
            start: 20,
            end: 21,
            severity: "medium",
            confidence: 0.9,
            category: "tests",
            evidence: null,
          },
        ],
      },
    ],
    verifierReport: {
      role: "verifier",
      summary: "Dismissed the high-severity finding after re-check.",
      recommendation: "ready",
      degraded: false,
      exitCode: 0,
      rawOutput: "verifier raw output",
      findings: [
        {
          findingKey: "src/example.ts|10|12|false high severity|looks severe at first glance.",
          verdict: "dismissed",
          rationale: "The code path is already guarded.",
        },
      ],
    },
    ranAt: "2026-03-11T14:05:00Z",
  });

  assert.equal(result.findingsCount, 2);
  assert.equal(result.maxSeverity, "high");
  assert.equal(result.verifiedFindingsCount, 0);
  assert.equal(result.verifiedMaxSeverity, "none");
  assert.equal(result.artifact.verification.findingsCount, 1);
  assert.equal(result.artifact.verification.verifiedFindingsCount, 0);
  assert.equal(result.artifact.verification.findings[0]?.verdict, "dismissed");
});

test("finalizeLocalReview propagates verifier degradation to top-level result", () => {
  const result = finalizeLocalReview({
    config: createConfig({ localReviewConfidenceThreshold: 0.7 }),
    issueNumber: 38,
    prNumber: 12,
    branch: "codex/issue-38",
    headSha: "deadbeefcafebabe",
    roleResults: [
      {
        role: "reviewer",
        summary: "Flagged one high issue.",
        recommendation: "changes_requested",
        degraded: false,
        exitCode: 0,
        rawOutput: "review raw output",
        findings: [
          {
            role: "reviewer",
            title: "Potential high severity issue",
            body: "Needs verifier confirmation.",
            file: "src/example.ts",
            start: 10,
            end: 12,
            severity: "high",
            confidence: 0.95,
            category: "correctness",
            evidence: "Initial evidence",
          },
        ],
      },
    ],
    verifierReport: {
      role: "verifier",
      summary: "Verifier failed to complete.",
      recommendation: "unknown",
      degraded: true,
      exitCode: 1,
      rawOutput: "verifier raw output",
      findings: [],
    },
    ranAt: "2026-03-12T00:05:00Z",
  });

  assert.equal(result.degraded, true);
  assert.equal(result.recommendation, "unknown");
  assert.equal(result.artifact.degraded, true);
  assert.equal(result.artifact.verification.degraded, true);
});

test("finalizeLocalReview includes auto-detect reasons in the artifact", () => {
  const result = finalizeLocalReview({
    config: createConfig({ localReviewConfidenceThreshold: 0.7 }),
    issueNumber: 39,
    prNumber: 13,
    branch: "codex/issue-39",
    headSha: "feedfacecafebeef",
    detectedRoles: createDetectedRoles(),
    roleResults: [
      {
        role: "reviewer",
        summary: "No issues found.",
        recommendation: "ready",
        degraded: false,
        exitCode: 0,
        rawOutput: "review raw output",
        findings: [],
      },
      {
        role: "prisma_postgres_reviewer",
        summary: "Checked schema and migrations.",
        recommendation: "ready",
        degraded: false,
        exitCode: 0,
        rawOutput: "prisma raw output",
        findings: [],
      },
    ],
    verifierReport: null,
    ranAt: "2026-03-12T01:00:00Z",
  });

  assert.deepEqual(result.artifact.autoDetectedRoles, createDetectedRoles());
});

test("finalizeLocalReview uses stricter confidence thresholds for specialist reviewers", () => {
  const result = finalizeLocalReview({
    config: createConfig({
      localReviewConfidenceThreshold: 0.7,
      localReviewReviewerThresholds: {
        generic: {
          confidenceThreshold: 0.9,
          minimumSeverity: "low",
        },
        specialist: {
          confidenceThreshold: 0.8,
          minimumSeverity: "low",
        },
      },
    }),
    issueNumber: 40,
    prNumber: 14,
    branch: "codex/issue-40",
    headSha: "reviewertype123",
    detectedRoles: createDetectedRoles(),
    roleResults: [
      {
        role: "reviewer",
        summary: "Flagged a generic concern below the generic threshold.",
        recommendation: "changes_requested",
        degraded: false,
        exitCode: 0,
        rawOutput: "generic raw output",
        findings: [
          {
            role: "reviewer",
            title: "Generic finding stays advisory",
            body: "This generic finding should remain below the generic reviewer threshold.",
            file: "src/example.ts",
            start: 30,
            end: 31,
            severity: "medium",
            confidence: 0.85,
            category: "tests",
            evidence: "Generic reviewer confidence is below its stricter threshold.",
          },
        ],
      },
      {
        role: "prisma_postgres_reviewer",
        summary: "Flagged a specialist concern at the specialist threshold.",
        recommendation: "changes_requested",
        degraded: false,
        exitCode: 0,
        rawOutput: "specialist raw output",
        findings: [
          {
            role: "prisma_postgres_reviewer",
            title: "Specialist finding blocks merge",
            body: "This specialist finding should stay actionable under the specialist threshold.",
            file: "prisma/schema.prisma",
            start: 12,
            end: 14,
            severity: "high",
            confidence: 0.85,
            category: "correctness",
            evidence: "Specialist reviewer confidence meets its own threshold.",
          },
        ],
      },
    ],
    verifierReport: {
      role: "verifier",
      summary: "Confirmed the specialist issue.",
      recommendation: "changes_requested",
      degraded: false,
      exitCode: 0,
      rawOutput: "verifier raw output",
      findings: [
        {
          findingKey: "prisma/schema.prisma|12|14|specialist finding blocks merge|this specialist finding should stay actionable under the specialist threshold.",
          verdict: "confirmed",
          rationale: "The schema invariant really is broken.",
        },
      ],
    },
    ranAt: "2026-03-12T01:15:00Z",
  });

  assert.equal(result.findingsCount, 1);
  assert.equal(result.maxSeverity, "high");
  assert.equal(result.verifiedFindingsCount, 1);
  assert.equal(result.actionableFindings[0]?.role, "prisma_postgres_reviewer");
  assert.equal(result.artifact.actionableFindings[0]?.role, "prisma_postgres_reviewer");
  assert.equal(result.artifact.summary.includes("reviewer: 0 actionable"), true);
  assert.equal(result.artifact.summary.includes("prisma_postgres_reviewer: 1 actionable"), true);
});

test("finalizeLocalReview compresses overlapping findings into a root-cause summary", () => {
  const result = finalizeLocalReview({
    config: createConfig({ localReviewConfidenceThreshold: 0.7 }),
    issueNumber: 45,
    prNumber: 18,
    branch: "codex/issue-45",
    headSha: "abc123def456",
    roleResults: [
      {
        role: "reviewer",
        summary: "Flagged missing nil handling in the same path.",
        recommendation: "changes_requested",
        degraded: false,
        exitCode: 0,
        rawOutput: "review raw output",
        findings: [
          {
            role: "reviewer",
            title: "Nil check missing before retry loop",
            body: "The retry path dereferences the local review result before confirming a review artifact exists.",
            file: "src/supervisor.ts",
            start: 2090,
            end: 2098,
            severity: "high",
            confidence: 0.92,
            category: "correctness",
            evidence: "The repair prompt path assumes review output was produced.",
          },
        ],
      },
      {
        role: "explorer",
        summary: "Found the same bug from the repair prompt side.",
        recommendation: "changes_requested",
        degraded: false,
        exitCode: 0,
        rawOutput: "explorer raw output",
        findings: [
          {
            role: "explorer",
            title: "Repair prompt can reference missing review output",
            body: "When local review fails to emit output, the retry path still assumes the review artifact exists and dereferences it.",
            file: "src/supervisor.ts",
            start: 2092,
            end: 2100,
            severity: "high",
            confidence: 0.88,
            category: "correctness",
            evidence: "Both findings point at the same retry-path assumption.",
          },
        ],
      },
    ],
    verifierReport: null,
    ranAt: "2026-03-12T02:00:00Z",
  });

  assert.equal(result.findingsCount, 2);
  assert.equal(result.rootCauseCount, 1);
  assert.equal(result.artifact.rootCauseSummaries.length, 1);
  assert.equal(result.artifact.rootCauseSummaries[0]?.findingsCount, 2);
  assert.equal(result.artifact.rootCauseSummaries[0]?.file, "src/supervisor.ts");
});

test("finalizeLocalReview merges root-cause groups connected by a bridging finding", () => {
  const result = finalizeLocalReview({
    config: createConfig({ localReviewConfidenceThreshold: 0.7 }),
    issueNumber: 45,
    prNumber: 19,
    branch: "codex/issue-45",
    headSha: "bridge123456",
    roleResults: [
      {
        role: "reviewer",
        summary: "Found repeated auth-refresh failures.",
        recommendation: "changes_requested",
        degraded: false,
        exitCode: 0,
        rawOutput: "review raw output",
        findings: [
          {
            role: "reviewer",
            title: "Auth refresh misses invalid session guard",
            body: "The auth refresh path can continue after an invalid session token and retry stale work.",
            file: "src/local-review.ts",
            start: 10,
            end: 12,
            severity: "high",
            confidence: 0.95,
            category: "correctness",
            evidence: "The auth refresh branch reuses a stale session token.",
          },
          {
            role: "reviewer",
            title: "Bridge finding links the same stale session retry path",
            body: "The auth refresh retry path keeps using the same stale session token after invalidation.",
            file: "src/local-review.ts",
            start: 15,
            end: 17,
            severity: "high",
            confidence: 0.9,
            category: "correctness",
            evidence: "The bridge finding overlaps both auth refresh ranges.",
          },
          {
            role: "explorer",
            title: "Retry loop keeps invalid session token alive",
            body: "The auth refresh retry loop can keep an invalid session token alive and repeat stale work.",
            file: "src/local-review.ts",
            start: 21,
            end: 23,
            severity: "high",
            confidence: 0.88,
            category: "correctness",
            evidence: "The retry loop reconnects to the same stale session token.",
          },
        ],
      },
    ],
    verifierReport: null,
    ranAt: "2026-03-12T02:10:00Z",
  });

  assert.equal(result.findingsCount, 3);
  assert.equal(result.rootCauseCount, 1);
  assert.equal(result.artifact.rootCauseSummaries[0]?.findingsCount, 3);
});

test("finalizeLocalReview does not compress findings without file locations", () => {
  const result = finalizeLocalReview({
    config: createConfig({ localReviewConfidenceThreshold: 0.7 }),
    issueNumber: 45,
    prNumber: 20,
    branch: "codex/issue-45",
    headSha: "nofile123456",
    roleResults: [
      {
        role: "reviewer",
        summary: "Found two similar unscoped concerns.",
        recommendation: "changes_requested",
        degraded: false,
        exitCode: 0,
        rawOutput: "review raw output",
        findings: [
          {
            role: "reviewer",
            title: "Retry path may reuse stale review context",
            body: "The retry path may reuse stale review context and produce repeated repair guidance.",
            file: null,
            start: null,
            end: null,
            severity: "medium",
            confidence: 0.91,
            category: "correctness",
            evidence: "This finding has no file anchor.",
          },
          {
            role: "explorer",
            title: "Repeated repair guidance from stale review context",
            body: "Repeated repair guidance may come from stale review context in the retry path.",
            file: null,
            start: null,
            end: null,
            severity: "medium",
            confidence: 0.9,
            category: "correctness",
            evidence: "This finding also has no file anchor.",
          },
        ],
      },
    ],
    verifierReport: null,
    ranAt: "2026-03-12T02:15:00Z",
  });

  assert.equal(result.findingsCount, 2);
  assert.equal(result.rootCauseCount, 2);
});
