import assert from "node:assert/strict";
import test from "node:test";
import {
  buildLocalReviewBlockerSummary,
  formatLocalReviewResult,
  LOCAL_REVIEW_DEGRADED_BLOCKER_SUMMARY,
  prepareLocalReviewGuardrailProvenance,
} from "./result";
import { finalizeLocalReview } from "./finalize";
import { createConfig, createMissPattern } from "./test-helpers";

test("prepareLocalReviewGuardrailProvenance groups runtime sources and keeps artifact-relative paths", () => {
  const config = createConfig({
    localReviewArtifactDir: "/tmp/reviews",
  });

  const provenance = prepareLocalReviewGuardrailProvenance({
    config,
    verifierReport: {
      role: "verifier",
      summary: "verified",
      recommendation: "ready",
      degraded: false,
      exitCode: 0,
      rawOutput: "verifier raw output",
      verifierGuardrails: [{ id: "rule-1", title: "Rule", summary: "Summary", file: "src/file.ts", line: 12, rationale: "Because" }],
      findings: [],
    },
    committedExternalReviewPatterns: [
      createMissPattern({ fingerprint: "committed-1" }),
      createMissPattern({ fingerprint: "committed-2" }),
    ],
    runtimeExternalReviewPatterns: [
      createMissPattern({ fingerprint: "runtime-1", sourceArtifactPath: "/tmp/reviews/owner-repo/issue-38/external-review-misses-head-111.json" }),
      createMissPattern({ fingerprint: "runtime-2", sourceArtifactPath: "/tmp/reviews/owner-repo/issue-38/external-review-misses-head-111.json" }),
      createMissPattern({ fingerprint: "runtime-3", sourceArtifactPath: "/var/tmp/external-review-misses-head-222.json" }),
    ],
  });

  assert.deepEqual(provenance, {
    verifier: {
      committedPath: "docs/shared-memory/verifier-guardrails.json",
      committedCount: 1,
    },
    externalReview: {
      committedPath: "docs/shared-memory/external-review-guardrails.json",
      committedCount: 2,
      runtimeSources: [
        {
          path: "owner-repo/issue-38/external-review-misses-head-111.json",
          count: 2,
        },
        {
          path: "external-review-misses-head-222.json",
          count: 1,
        },
      ],
    },
  });
});

test("prepareLocalReviewGuardrailProvenance collapses relative runtime source paths to a basename", () => {
  const provenance = prepareLocalReviewGuardrailProvenance({
    config: createConfig({
      localReviewArtifactDir: process.cwd(),
    }),
    verifierReport: null,
    committedExternalReviewPatterns: [],
    runtimeExternalReviewPatterns: [
      createMissPattern({
        fingerprint: "runtime-relative",
        sourceArtifactPath: "owner-repo/issue-38/external-review-misses-head-333.json",
      }),
    ],
  });

  assert.deepEqual(provenance.externalReview.runtimeSources, [
    {
      path: "external-review-misses-head-333.json",
      count: 1,
    },
  ]);
});

test("formatLocalReviewResult preserves finalized summary fields and blocker summary", () => {
  const finalized = finalizeLocalReview({
    config: createConfig({ localReviewConfidenceThreshold: 0.7 }),
    issueNumber: 38,
    prNumber: 12,
    branch: "codex/issue-38",
    headSha: "deadbeefcafebabe",
    roleResults: [
      {
        role: "reviewer",
        summary: "Flagged one medium issue.",
        recommendation: "changes_requested",
        degraded: false,
        exitCode: 0,
        rawOutput: "review raw output",
        findings: [
          {
            role: "reviewer",
            title: "Medium issue",
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
    verifierReport: null,
    ranAt: "2026-03-14T00:00:00Z",
  });

  assert.deepEqual(
    formatLocalReviewResult({
      ranAt: "2026-03-14T00:00:00Z",
      finalized,
      artifacts: {
        summaryPath: "/tmp/reviews/summary.md",
        findingsPath: "/tmp/reviews/findings.json",
        rawOutput: "raw output",
      },
    }),
    {
      ranAt: "2026-03-14T00:00:00Z",
      summaryPath: "/tmp/reviews/summary.md",
      findingsPath: "/tmp/reviews/findings.json",
      summary: finalized.summary,
      blockerSummary: "medium src/example.ts:20-21 This still needs follow-up.",
      findingsCount: 1,
      rootCauseCount: 1,
      maxSeverity: "medium",
      verifiedFindingsCount: 0,
      verifiedMaxSeverity: "none",
      recommendation: "changes_requested",
      degraded: false,
      finalEvaluation: {
        outcome: "follow_up_eligible",
        residualFindings: [
          {
            findingKey: "src/example.ts|20|21|medium issue|this still needs follow-up.",
            summary: "This still needs follow-up.",
            severity: "medium",
            category: "tests",
            file: "src/example.ts",
            start: 20,
            end: 21,
            source: "local_review",
            resolution: "follow_up_candidate",
            rationale: "Residual non-high-severity finding is eligible for explicit follow-up instead of blocking merge by itself.",
          },
        ],
        mustFixCount: 0,
        manualReviewCount: 0,
        followUpCount: 1,
      },
      rawOutput: "raw output",
    },
  );
});

test("buildLocalReviewBlockerSummary summarizes the leading root cause compactly", () => {
  const result = finalizeLocalReview({
    config: createConfig({ localReviewConfidenceThreshold: 0.7 }),
    issueNumber: 45,
    prNumber: 20,
    branch: "codex/issue-45",
    headSha: "summary123456",
    roleResults: [
      {
        role: "reviewer",
        summary: "Found two retry-path defects.",
        recommendation: "changes_requested",
        degraded: false,
        exitCode: 0,
        rawOutput: "review raw output",
        findings: [
          {
            role: "reviewer",
            title: "Retry path reuses stale artifact context",
            body: "The retry path can reuse stale artifact context and keep applying the wrong repair guidance.",
            file: "src/supervisor.ts",
            start: 210,
            end: 214,
            severity: "high",
            confidence: 0.95,
            category: "correctness",
            evidence: "The repair step reads stale context after the PR head changes.",
          },
          {
            role: "explorer",
            title: "Second root cause without a file anchor",
            body: "Stale retry metadata can also survive across repeated repair attempts.",
            file: null,
            start: null,
            end: null,
            severity: "medium",
            confidence: 0.9,
            category: "correctness",
            evidence: "No file anchor for the second root cause.",
          },
        ],
      },
    ],
    verifierReport: null,
    ranAt: "2026-03-12T02:20:00Z",
  });

  assert.equal(
    buildLocalReviewBlockerSummary(result),
    "high src/supervisor.ts:210-214 The retry path can reuse stale artifact context and keep applying the wrong repair guidance. (+1 more root cause)",
  );
});

test("buildLocalReviewBlockerSummary returns null for ready reviews", () => {
  assert.equal(
    buildLocalReviewBlockerSummary({
      recommendation: "ready",
      degraded: false,
      maxSeverity: "none",
      rootCauseCount: 0,
      rootCauseSummaries: [],
    }),
    null,
  );
});

test("buildLocalReviewBlockerSummary uses the shared degraded summary", () => {
  assert.equal(
    buildLocalReviewBlockerSummary({
      recommendation: "unknown",
      degraded: true,
      maxSeverity: "none",
      rootCauseCount: 0,
      rootCauseSummaries: [],
    }),
    LOCAL_REVIEW_DEGRADED_BLOCKER_SUMMARY,
  );
});

test("buildLocalReviewBlockerSummary falls back when no root causes are available", () => {
  assert.equal(
    buildLocalReviewBlockerSummary({
      recommendation: "changes_requested",
      degraded: false,
      maxSeverity: "high",
      rootCauseCount: 1,
      rootCauseSummaries: [],
    }),
    "high severity local-review findings",
  );
});
