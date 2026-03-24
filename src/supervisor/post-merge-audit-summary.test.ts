import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { writeJsonAtomic } from "../core/utils";
import { createConfig } from "../turn-execution-test-helpers";
import type { LocalReviewArtifact } from "../local-review/types";
import type { PostMergeAuditArtifact } from "./post-merge-audit-artifact";
import { postMergeAuditArtifactDir } from "./post-merge-audit-artifact";
import { summarizePostMergeAuditPatterns } from "./post-merge-audit-summary";

function createLocalReviewArtifact(overrides: Partial<LocalReviewArtifact> = {}): LocalReviewArtifact {
  return {
    issueNumber: 102,
    prNumber: 116,
    branch: "codex/issue-102",
    headSha: "merged-head-116",
    ranAt: "2026-03-24T10:00:00Z",
    confidenceThreshold: 0.7,
    reviewerThresholds: {
      generic: { confidenceThreshold: 0.7, minimumSeverity: "low" },
      specialist: { confidenceThreshold: 0.7, minimumSeverity: "low" },
    },
    roles: ["reviewer"],
    autoDetectedRoles: [],
    summary: "Local review summary",
    recommendation: "changes_requested",
    degraded: false,
    findingsCount: 1,
    rootCauseCount: 1,
    maxSeverity: "medium",
    actionableFindings: [],
    rootCauseSummaries: [
      {
        summary: "Retry path reused stale review context after the head changed.",
        severity: "medium",
        category: "correctness",
        file: "src/supervisor.ts",
        start: 210,
        end: 214,
        roles: ["reviewer"],
        findingsCount: 2,
        findingKeys: ["src/supervisor.ts|210|214|retry path|stale context"],
      },
    ],
    verification: {
      required: false,
      summary: "No extra verification required.",
      recommendation: "unknown",
      degraded: false,
      findingsCount: 0,
      verifiedFindingsCount: 0,
      verifiedMaxSeverity: "none",
      findings: [],
    },
    verifiedFindings: [],
    finalEvaluation: {
      outcome: "follow_up_eligible",
      residualFindings: [],
      mustFixCount: 0,
      manualReviewCount: 0,
      followUpCount: 1,
    },
    guardrailProvenance: {
      verifier: { committedPath: null, committedCount: 0 },
      externalReview: { committedPath: null, committedCount: 0, runtimeSources: [] },
    },
    roleReports: [],
    verifierReport: null,
    ...overrides,
  };
}

function createPostMergeArtifact(overrides: Partial<PostMergeAuditArtifact> = {}): PostMergeAuditArtifact {
  const localReviewArtifact = createLocalReviewArtifact();
  return {
    schemaVersion: 1,
    issueNumber: 102,
    branch: "codex/issue-102",
    capturedAt: "2026-03-24T10:06:00Z",
    issue: {
      number: 102,
      title: "Persist a completed-work audit artifact",
      url: "https://example.test/issues/102",
      createdAt: "2026-03-24T09:55:00Z",
      updatedAt: "2026-03-24T10:06:00Z",
    },
    pullRequest: {
      number: 116,
      title: "Persist completed-work audit artifact",
      url: "https://example.test/pull/116",
      createdAt: "2026-03-24T10:03:00Z",
      mergedAt: "2026-03-24T10:05:00Z",
      headRefName: "codex/issue-102",
      headRefOid: "merged-head-116",
    },
    completion: {
      terminalState: "done",
      lastRecoveryReason: "merged_pr_convergence: tracked PR #116 merged; marked issue #102 done",
      lastRecoveryAt: "2026-03-24T10:06:00Z",
    },
    artifacts: {
      executionMetricsSummaryPath: null,
      localReviewSummaryPath: null,
      localReviewFindingsPath: null,
      externalReviewMissesPath: null,
    },
    executionMetrics: null,
    localReview: {
      summaryPath: null,
      findingsPath: null,
      runAt: localReviewArtifact.ranAt,
      recommendation: localReviewArtifact.recommendation,
      degraded: false,
      findingsCount: localReviewArtifact.findingsCount,
      rootCauseCount: localReviewArtifact.rootCauseCount,
      maxSeverity: localReviewArtifact.maxSeverity,
      verifiedFindingsCount: 0,
      verifiedMaxSeverity: "none",
      artifact: localReviewArtifact,
    },
    failureTaxonomy: {
      latestFailure: {
        category: "review",
        failureKind: "command_error",
        blockedReason: "manual_review",
        signature: "review:stale-context",
        summary: "Review loop reused stale context after the head changed.",
        details: ["head changed before repair context refreshed"],
        updatedAt: "2026-03-24T10:04:00Z",
        repeatedCount: 2,
      },
      latestRecovery: {
        reason: "merged_pr_convergence: tracked PR #116 merged; marked issue #102 done",
        at: "2026-03-24T10:06:00Z",
        occurrenceCount: 1,
        timeToLatestRecoveryMs: 120000,
      },
      staleStabilizingNoPrRecoveryCount: 0,
    },
    ...overrides,
  };
}

test("summarizePostMergeAuditPatterns aggregates recurring review, failure, and recovery patterns from persisted artifacts", async () => {
  const reviewDir = await fs.mkdtemp(path.join(os.tmpdir(), "post-merge-audit-summary-"));
  const config = createConfig({
    localReviewArtifactDir: reviewDir,
    repoSlug: "owner/repo",
  });
  const artifactDir = postMergeAuditArtifactDir(config);

  await fs.mkdir(artifactDir, { recursive: true });
  await writeJsonAtomic(
    path.join(artifactDir, "issue-102-head-merged-head.json"),
    createPostMergeArtifact(),
  );
  await writeJsonAtomic(
    path.join(artifactDir, "issue-103-head-merged-head.json"),
    createPostMergeArtifact({
      issueNumber: 103,
      capturedAt: "2026-03-24T12:06:00Z",
      issue: {
        number: 103,
        title: "Repeat the same post-merge audit pattern",
        url: "https://example.test/issues/103",
        createdAt: "2026-03-24T11:55:00Z",
        updatedAt: "2026-03-24T12:06:00Z",
      },
      pullRequest: {
        number: 117,
        title: "Repeat post-merge audit pattern",
        url: "https://example.test/pull/117",
        createdAt: "2026-03-24T12:03:00Z",
        mergedAt: "2026-03-24T12:05:00Z",
        headRefName: "codex/issue-103",
        headRefOid: "merged-head-117",
      },
      completion: {
        terminalState: "done",
        lastRecoveryReason: "merged_pr_convergence: tracked PR #117 merged; marked issue #103 done",
        lastRecoveryAt: "2026-03-24T12:06:00Z",
      },
      localReview: {
        summaryPath: null,
        findingsPath: null,
        runAt: "2026-03-24T12:00:00Z",
        recommendation: "changes_requested",
        degraded: false,
        findingsCount: 1,
        rootCauseCount: 1,
        maxSeverity: "medium",
        verifiedFindingsCount: 0,
        verifiedMaxSeverity: "none",
        artifact: createLocalReviewArtifact({
          issueNumber: 103,
          prNumber: 117,
          branch: "codex/issue-103",
          headSha: "merged-head-117",
        }),
      },
      failureTaxonomy: {
        latestFailure: {
          category: "review",
          failureKind: "command_error",
          blockedReason: "manual_review",
          signature: "review:stale-context",
          summary: "Review loop reused stale context after the head changed.",
          details: ["head changed before repair context refreshed"],
          updatedAt: "2026-03-24T12:04:00Z",
          repeatedCount: 1,
        },
        latestRecovery: {
          reason: "merged_pr_convergence: tracked PR #117 merged; marked issue #103 done",
          at: "2026-03-24T12:06:00Z",
          occurrenceCount: 1,
          timeToLatestRecoveryMs: 60000,
        },
        staleStabilizingNoPrRecoveryCount: 0,
      },
    }),
  );

  const summary = await summarizePostMergeAuditPatterns(config);

  assert.equal(summary.schemaVersion, 1);
  assert.equal(summary.advisoryOnly, true);
  assert.equal(summary.autoApplyGuardrails, false);
  assert.equal(summary.autoCreateFollowUpIssues, false);
  assert.equal(summary.artifactsAnalyzed, 2);
  assert.equal(summary.artifactsSkipped, 0);
  assert.equal(summary.reviewPatterns.length, 1);
  assert.equal(summary.reviewPatterns[0]?.artifactCount, 2);
  assert.equal(summary.reviewPatterns[0]?.evidenceCount, 4);
  assert.deepEqual(summary.reviewPatterns[0]?.exampleIssueNumbers, [102, 103]);
  assert.equal(summary.failurePatterns.length, 1);
  assert.equal(summary.failurePatterns[0]?.artifactCount, 2);
  assert.equal(summary.failurePatterns[0]?.repeatedCount, 3);
  assert.equal(summary.failurePatterns[0]?.blockedReason, "manual_review");
  assert.equal(summary.recoveryPatterns.length, 1);
  assert.equal(summary.recoveryPatterns[0]?.key, "merged_pr_convergence");
  assert.equal(summary.recoveryPatterns[0]?.artifactCount, 2);
  assert.equal(summary.recoveryPatterns[0]?.occurrenceCount, 2);
});
