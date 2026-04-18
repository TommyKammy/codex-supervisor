import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { writeJsonAtomic } from "../core/utils";
import { TRUSTED_GENERATED_DURABLE_ARTIFACT_PROVENANCE_VALUE } from "../durable-artifact-provenance";
import type { ExternalReviewMissArtifact } from "../external-review/external-review-miss-artifact-types";
import { createConfig } from "../turn-execution-test-helpers";
import type { LocalReviewArtifact } from "../local-review/types";
import { createArtifactTestPaths } from "./artifact-test-helpers";
import type { PostMergeAuditArtifact } from "./post-merge-audit-artifact";
import { postMergeAuditArtifactDir } from "./post-merge-audit-artifact";
import {
  POST_MERGE_AUDIT_PATTERN_SUMMARY_TOP_LEVEL_KEYS,
  summarizePostMergeAuditPatterns,
  validatePostMergeAuditPatternSummary,
} from "./post-merge-audit-summary";

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
    codexSupervisorProvenance: TRUSTED_GENERATED_DURABLE_ARTIFACT_PROVENANCE_VALUE,
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

function createExternalReviewMissArtifact(
  overrides: Partial<ExternalReviewMissArtifact> = {},
): ExternalReviewMissArtifact {
  return {
    issueNumber: 102,
    prNumber: 116,
    branch: "codex/issue-102",
    headSha: "merged-head-116",
    generatedAt: "2026-03-24T10:07:00Z",
    localReviewSummaryPath: null,
    localReviewFindingsPath: null,
    findings: [],
    reusableMissPatterns: [],
    durableGuardrailCandidates: [],
    regressionTestCandidates: [
      {
        id: "regression:src/recovery-reconciliation.ts:412:fixture-drift",
        title: "Add regression coverage for execution-ready metadata hardening fixture drift",
        file: "src/recovery-reconciliation.ts",
        line: 412,
        summary: "Execution-ready metadata hardening can drift the recovery reconciliation fixture.",
        rationale: "Add a focused test that locks the recovered fixture shape after metadata hardening.",
        reviewerLogin: "coderabbitai[bot]",
        sourceKind: "review_thread",
        sourceId: "thread-1135",
        sourceThreadId: "thread-1135",
        sourceUrl: "https://example.test/pull/116#discussion_r1135",
        qualificationReasons: [
          "missed_by_local_review",
          "non_low_severity",
          "high_confidence",
          "file_scoped",
          "line_scoped",
        ],
      },
    ],
    counts: {
      matched: 0,
      nearMatch: 0,
      missedByLocalReview: 1,
    },
    ...overrides,
  };
}

test("summarizePostMergeAuditPatterns aggregates recurring review, failure, and recovery patterns from persisted artifacts", async () => {
  const { reviewDir } = await createArtifactTestPaths("post-merge-audit-summary");
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

  assert.deepEqual(validatePostMergeAuditPatternSummary(summary), summary);
  assert.deepEqual(Object.keys(summary).sort(), [...POST_MERGE_AUDIT_PATTERN_SUMMARY_TOP_LEVEL_KEYS].sort());
  assert.equal(summary.schemaVersion, 4);
  assert.equal(summary.advisoryOnly, true);
  assert.equal(summary.autoApplyGuardrails, false);
  assert.equal(summary.autoCreateFollowUpIssues, false);
  assert.equal(summary.artifactsAnalyzed, 2);
  assert.equal(summary.artifactsSkipped, 0);
  assert.equal(summary.reviewPatterns.length, 1);
  assert.equal(summary.reviewPatterns[0]?.artifactCount, 2);
  assert.equal(summary.reviewPatterns[0]?.evidenceCount, 4);
  assert.deepEqual(summary.reviewPatterns[0]?.supportingIssueNumbers, [102, 103]);
  assert.equal(summary.failurePatterns.length, 1);
  assert.equal(summary.failurePatterns[0]?.artifactCount, 2);
  assert.equal(summary.failurePatterns[0]?.repeatedCount, 3);
  assert.equal(summary.failurePatterns[0]?.blockedReason, "manual_review");
  assert.equal(summary.recoveryPatterns.length, 1);
  assert.equal(summary.recoveryPatterns[0]?.key, "merged_pr_convergence");
  assert.equal(summary.recoveryPatterns[0]?.artifactCount, 2);
  assert.equal(summary.recoveryPatterns[0]?.occurrenceCount, 2);
  assert.deepEqual(summary.followUpCandidates, []);
  assert.deepEqual(
    summary.promotionCandidates.map((candidate) => ({
      key: candidate.key,
      category: candidate.category,
      sourcePatternKeys: candidate.sourcePatternKeys,
      supportingIssueNumbers: candidate.supportingIssueNumbers,
    })),
    [
      {
        key: "guardrail:correctness-medium-retry-path-reused-stale-review-context-after-the-head-changed",
        category: "guardrail",
        sourcePatternKeys: ["correctness:medium:retry-path-reused-stale-review-context-after-the-head-changed"],
        supportingIssueNumbers: [102, 103],
      },
      {
        key: "shared_memory:correctness-medium-retry-path-reused-stale-review-context-after-the-head-changed",
        category: "shared_memory",
        sourcePatternKeys: ["correctness:medium:retry-path-reused-stale-review-context-after-the-head-changed"],
        supportingIssueNumbers: [102, 103],
      },
      {
        key: "checklist:review-stale-context",
        category: "checklist",
        sourcePatternKeys: ["review:stale-context"],
        supportingIssueNumbers: [102, 103],
      },
      {
        key: "documentation:merged_pr_convergence",
        category: "documentation",
        sourcePatternKeys: ["merged_pr_convergence"],
        supportingIssueNumbers: [102, 103],
      },
    ],
  );
  assert.equal(summary.promotionCandidates[0]?.advisoryOnly, true);
  assert.equal(summary.promotionCandidates[0]?.autoApply, false);
  assert.equal(summary.promotionCandidates[0]?.autoCreateFollowUpIssue, false);
  assert.deepEqual(summary.promotionCandidates[0]?.supportingFindingKeys, [
    "src/supervisor.ts|210|214|retry path|stale context",
  ]);
});

test("summarizePostMergeAuditPatterns skips persisted artifacts missing trusted provenance", async () => {
  const { reviewDir } = await createArtifactTestPaths("post-merge-audit-summary-provenance");
  const config = createConfig({
    localReviewArtifactDir: reviewDir,
    repoSlug: "owner/repo",
  });
  const artifactDir = postMergeAuditArtifactDir(config);
  const artifact = createPostMergeArtifact();

  await fs.mkdir(artifactDir, { recursive: true });
  const { codexSupervisorProvenance, ...artifactWithoutProvenance } = artifact;
  void codexSupervisorProvenance;
  await writeJsonAtomic(path.join(artifactDir, "issue-102-head-merged-head.json"), artifactWithoutProvenance);

  const summary = await summarizePostMergeAuditPatterns(config);

  assert.equal(summary.artifactsAnalyzed, 0);
  assert.equal(summary.artifactsSkipped, 1);
  assert.deepEqual(summary.reviewPatterns, []);
  assert.deepEqual(summary.failurePatterns, []);
  assert.deepEqual(summary.recoveryPatterns, []);
  assert.deepEqual(summary.followUpCandidates, []);
  assert.deepEqual(summary.promotionCandidates, []);
});

test("validatePostMergeAuditPatternSummary rejects unsupported schema versions and missing required fields", () => {
  const summary = {
    schemaVersion: 4,
    generatedAt: "2026-03-25T00:00:00Z",
    artifactDir: "/tmp/post-merge",
    advisoryOnly: true,
    autoApplyGuardrails: false,
    autoCreateFollowUpIssues: false,
    artifactsAnalyzed: 1,
    artifactsSkipped: 0,
    reviewPatterns: [],
    failurePatterns: [],
    recoveryPatterns: [],
    followUpCandidates: [],
    promotionCandidates: [],
  } as const;

  assert.deepEqual(validatePostMergeAuditPatternSummary(summary), summary);

  assert.throws(
    () => validatePostMergeAuditPatternSummary({ ...summary, schemaVersion: 1 }),
    /schemaVersion must be 4\./u,
  );

  const { promotionCandidates, ...summaryWithoutPromotionCandidates } = summary;
  void promotionCandidates;
  assert.throws(
    () => validatePostMergeAuditPatternSummary(summaryWithoutPromotionCandidates),
    /summary must contain schemaVersion, generatedAt, artifactDir, advisoryOnly, autoApplyGuardrails, autoCreateFollowUpIssues, artifactsAnalyzed, artifactsSkipped, reviewPatterns, failurePatterns, recoveryPatterns, followUpCandidates, and promotionCandidates\./u,
  );
});

test("summarizePostMergeAuditPatterns keeps review promotion candidate keys unique per severity and preserves full finding traceability", async () => {
  const { reviewDir } = await createArtifactTestPaths("post-merge-audit-summary");
  const config = createConfig({
    localReviewArtifactDir: reviewDir,
    repoSlug: "owner/repo",
  });
  const artifactDir = postMergeAuditArtifactDir(config);
  const repeatedSummary = "Review loop reused stale context after the head changed.";

  await fs.mkdir(artifactDir, { recursive: true });
  await writeJsonAtomic(
    path.join(artifactDir, "issue-201-head-merged-head.json"),
    createPostMergeArtifact({
      issueNumber: 201,
      branch: "codex/issue-201",
      issue: {
        number: 201,
        title: "Repeat the same review summary at medium and high severity",
        url: "https://example.test/issues/201",
        createdAt: "2026-03-24T12:55:00Z",
        updatedAt: "2026-03-24T13:06:00Z",
      },
      pullRequest: {
        number: 201,
        title: "Repeat the same review summary",
        url: "https://example.test/pull/201",
        createdAt: "2026-03-24T13:03:00Z",
        mergedAt: "2026-03-24T13:05:00Z",
        headRefName: "codex/issue-201",
        headRefOid: "merged-head-201",
      },
      localReview: {
        summaryPath: null,
        findingsPath: null,
        runAt: "2026-03-24T13:00:00Z",
        recommendation: "changes_requested",
        degraded: false,
        findingsCount: 4,
        rootCauseCount: 2,
        maxSeverity: "high",
        verifiedFindingsCount: 0,
        verifiedMaxSeverity: "none",
        artifact: createLocalReviewArtifact({
          issueNumber: 201,
          prNumber: 201,
          branch: "codex/issue-201",
          headSha: "merged-head-201",
          findingsCount: 4,
          rootCauseCount: 2,
          maxSeverity: "high",
          rootCauseSummaries: [
            {
              summary: repeatedSummary,
              severity: "medium",
              category: "correctness",
              file: "src/supervisor.ts",
              start: 210,
              end: 214,
              roles: ["reviewer"],
              findingsCount: 2,
              findingKeys: ["medium-finding-d", "medium-finding-b"],
            },
            {
              summary: repeatedSummary,
              severity: "high",
              category: "correctness",
              file: "src/supervisor.ts",
              start: 220,
              end: 224,
              roles: ["reviewer"],
              findingsCount: 2,
              findingKeys: ["high-finding-d", "high-finding-b"],
            },
          ],
        }),
      },
      failureTaxonomy: {
        latestFailure: null,
        latestRecovery: null,
        staleStabilizingNoPrRecoveryCount: 0,
      },
    }),
  );
  await writeJsonAtomic(
    path.join(artifactDir, "issue-202-head-merged-head.json"),
    createPostMergeArtifact({
      issueNumber: 202,
      branch: "codex/issue-202",
      issue: {
        number: 202,
        title: "Repeat the same review summary at medium and high severity again",
        url: "https://example.test/issues/202",
        createdAt: "2026-03-24T13:55:00Z",
        updatedAt: "2026-03-24T14:06:00Z",
      },
      pullRequest: {
        number: 202,
        title: "Repeat the same review summary again",
        url: "https://example.test/pull/202",
        createdAt: "2026-03-24T14:03:00Z",
        mergedAt: "2026-03-24T14:05:00Z",
        headRefName: "codex/issue-202",
        headRefOid: "merged-head-202",
      },
      localReview: {
        summaryPath: null,
        findingsPath: null,
        runAt: "2026-03-24T14:00:00Z",
        recommendation: "changes_requested",
        degraded: false,
        findingsCount: 4,
        rootCauseCount: 2,
        maxSeverity: "high",
        verifiedFindingsCount: 0,
        verifiedMaxSeverity: "none",
        artifact: createLocalReviewArtifact({
          issueNumber: 202,
          prNumber: 202,
          branch: "codex/issue-202",
          headSha: "merged-head-202",
          findingsCount: 4,
          rootCauseCount: 2,
          maxSeverity: "high",
          rootCauseSummaries: [
            {
              summary: repeatedSummary,
              severity: "medium",
              category: "correctness",
              file: "src/supervisor.ts",
              start: 210,
              end: 214,
              roles: ["reviewer"],
              findingsCount: 2,
              findingKeys: ["medium-finding-c", "medium-finding-a"],
            },
            {
              summary: repeatedSummary,
              severity: "high",
              category: "correctness",
              file: "src/supervisor.ts",
              start: 220,
              end: 224,
              roles: ["reviewer"],
              findingsCount: 2,
              findingKeys: ["high-finding-c", "high-finding-a"],
            },
          ],
        }),
      },
      failureTaxonomy: {
        latestFailure: null,
        latestRecovery: null,
        staleStabilizingNoPrRecoveryCount: 0,
      },
    }),
  );

  const summary = await summarizePostMergeAuditPatterns(config);

  assert.deepEqual(
    summary.reviewPatterns.map((pattern) => pattern.key),
    [
      "correctness:high:review-loop-reused-stale-context-after-the-head-changed",
      "correctness:medium:review-loop-reused-stale-context-after-the-head-changed",
    ],
  );

  const reviewCandidateKeys = summary.promotionCandidates
    .filter((candidate) => candidate.category === "guardrail" || candidate.category === "shared_memory")
    .map((candidate) => candidate.key);
  assert.equal(new Set(reviewCandidateKeys).size, reviewCandidateKeys.length);
  assert.deepEqual(reviewCandidateKeys, [
    "guardrail:correctness-high-review-loop-reused-stale-context-after-the-head-changed",
    "guardrail:correctness-medium-review-loop-reused-stale-context-after-the-head-changed",
    "shared_memory:correctness-high-review-loop-reused-stale-context-after-the-head-changed",
    "shared_memory:correctness-medium-review-loop-reused-stale-context-after-the-head-changed",
  ]);

  const mediumPattern = summary.reviewPatterns.find((pattern) => pattern.severity === "medium");
  assert.deepEqual(mediumPattern?.supportingFindingKeys, [
    "medium-finding-a",
    "medium-finding-b",
    "medium-finding-c",
    "medium-finding-d",
  ]);

  const mediumGuardrailCandidate = summary.promotionCandidates.find(
    (candidate) => candidate.key === "guardrail:correctness-medium-review-loop-reused-stale-context-after-the-head-changed",
  );
  assert.deepEqual(mediumGuardrailCandidate?.supportingFindingKeys, [
    "medium-finding-a",
    "medium-finding-b",
    "medium-finding-c",
    "medium-finding-d",
  ]);
});

test("summarizePostMergeAuditPatterns tolerates root-cause summaries without finding metadata", async () => {
  const { reviewDir } = await createArtifactTestPaths("post-merge-audit-summary");
  const config = createConfig({
    localReviewArtifactDir: reviewDir,
    repoSlug: "owner/repo",
  });
  const artifactDir = postMergeAuditArtifactDir(config);
  const artifact = createPostMergeArtifact();
  const rootCause = artifact.localReview?.artifact?.rootCauseSummaries[0];

  assert.ok(rootCause);
  delete (rootCause as unknown as Record<string, unknown>).findingsCount;
  delete (rootCause as unknown as Record<string, unknown>).findingKeys;

  await fs.mkdir(artifactDir, { recursive: true });
  await writeJsonAtomic(path.join(artifactDir, "issue-102-head-merged-head.json"), artifact);

  const summary = await summarizePostMergeAuditPatterns(config);

  assert.equal(summary.artifactsAnalyzed, 1);
  assert.equal(summary.artifactsSkipped, 0);
  assert.equal(summary.reviewPatterns.length, 1);
  assert.equal(summary.reviewPatterns[0]?.evidenceCount, 0);
  assert.deepEqual(summary.reviewPatterns[0]?.supportingFindingKeys, []);
});

test("summarizePostMergeAuditPatterns skips artifacts whose embedded local-review identity does not match the merged context", async () => {
  const { reviewDir } = await createArtifactTestPaths("post-merge-audit-summary");
  const config = createConfig({
    localReviewArtifactDir: reviewDir,
    repoSlug: "owner/repo",
  });
  const artifactDir = postMergeAuditArtifactDir(config);

  await fs.mkdir(artifactDir, { recursive: true });
  await writeJsonAtomic(
    path.join(artifactDir, "issue-102-head-merged-head.json"),
    createPostMergeArtifact({
      localReview: {
        summaryPath: null,
        findingsPath: null,
        runAt: "2026-03-24T10:00:00Z",
        recommendation: "changes_requested",
        degraded: false,
        findingsCount: 1,
        rootCauseCount: 1,
        maxSeverity: "medium",
        verifiedFindingsCount: 0,
        verifiedMaxSeverity: "none",
        artifact: createLocalReviewArtifact({
          issueNumber: 999,
          prNumber: 888,
          branch: "codex/issue-999",
          headSha: "wrong-head",
        }),
      },
    }),
  );

  const summary = await summarizePostMergeAuditPatterns(config);

  assert.equal(summary.artifactsAnalyzed, 0);
  assert.equal(summary.artifactsSkipped, 1);
  assert.deepEqual(summary.reviewPatterns, []);
  assert.deepEqual(summary.failurePatterns, []);
  assert.deepEqual(summary.recoveryPatterns, []);
  assert.deepEqual(summary.promotionCandidates, []);
});

test("summarizePostMergeAuditPatterns promotes missed focused test regressions into operator-facing follow-up candidates", async () => {
  const { reviewDir } = await createArtifactTestPaths("post-merge-audit-summary");
  const config = createConfig({
    localReviewArtifactDir: reviewDir,
    repoSlug: "owner/repo",
  });
  const artifactDir = postMergeAuditArtifactDir(config);
  const missArtifactPath = path.join(reviewDir, "owner-repo", "issue-102", "external-review-misses-head-merged-head.json");

  await fs.mkdir(path.dirname(missArtifactPath), { recursive: true });
  await fs.mkdir(artifactDir, { recursive: true });
  await writeJsonAtomic(missArtifactPath, createExternalReviewMissArtifact());
  await writeJsonAtomic(
    path.join(artifactDir, "issue-102-head-merged-head.json"),
    createPostMergeArtifact({
      artifacts: {
        executionMetricsSummaryPath: null,
        localReviewSummaryPath: null,
        localReviewFindingsPath: null,
        externalReviewMissesPath: missArtifactPath,
      },
    }),
  );

  const summary = await summarizePostMergeAuditPatterns(config);

  assert.deepEqual(summary.followUpCandidates, [
    {
      key: "test_regression:102:116:regression:src/recovery-reconciliation.ts:412:fixture-drift",
      category: "test_regression",
      title: "Add regression coverage for execution-ready metadata hardening fixture drift",
      summary: "Execution-ready metadata hardening can drift the recovery reconciliation fixture.",
      rationale: "Add a focused test that locks the recovered fixture shape after metadata hardening.",
      sourcePatternKeys: ["regression:src/recovery-reconciliation.ts:412:fixture-drift"],
      supportingIssueNumbers: [102],
      supportingFindingKeys: [],
      advisoryOnly: true,
      autoCreateFollowUpIssue: false,
      evidence: {
        mergedIssueNumber: 102,
        mergedIssueTitle: "Persist a completed-work audit artifact",
        mergedPrNumber: 116,
        mergedPrTitle: "Persist completed-work audit artifact",
        sourceArtifactPath: missArtifactPath,
        sourceUrl: "https://example.test/pull/116#discussion_r1135",
        sourceId: "thread-1135",
        sourceThreadId: "thread-1135",
        reviewerLogin: "coderabbitai[bot]",
        file: "src/recovery-reconciliation.ts",
        line: 412,
      },
    },
  ]);
});

test("summarizePostMergeAuditPatterns ignores external review miss artifacts with malformed nullable evidence fields", async () => {
  const { reviewDir } = await createArtifactTestPaths("post-merge-audit-summary");
  const config = createConfig({
    localReviewArtifactDir: reviewDir,
    repoSlug: "owner/repo",
  });
  const artifactDir = postMergeAuditArtifactDir(config);
  const missArtifactPath = path.join(reviewDir, "owner-repo", "issue-102", "external-review-misses-head-merged-head.json");
  const malformedMissArtifact = createExternalReviewMissArtifact();
  const malformedCandidate = malformedMissArtifact.regressionTestCandidates[0];

  assert.ok(malformedCandidate);
  (malformedCandidate as unknown as Record<string, unknown>).sourceThreadId = { invalid: true };
  (malformedCandidate as unknown as Record<string, unknown>).sourceUrl = 42;

  await fs.mkdir(path.dirname(missArtifactPath), { recursive: true });
  await fs.mkdir(artifactDir, { recursive: true });
  await writeJsonAtomic(missArtifactPath, malformedMissArtifact as unknown as Record<string, unknown>);
  await writeJsonAtomic(
    path.join(artifactDir, "issue-102-head-merged-head.json"),
    createPostMergeArtifact({
      artifacts: {
        executionMetricsSummaryPath: null,
        localReviewSummaryPath: null,
        localReviewFindingsPath: null,
        externalReviewMissesPath: missArtifactPath,
      },
    }),
  );

  const summary = await summarizePostMergeAuditPatterns(config);

  assert.deepEqual(summary.followUpCandidates, []);
});

test("summarizePostMergeAuditPatterns ignores external review miss artifacts that do not match the merged issue metadata", async () => {
  const { reviewDir } = await createArtifactTestPaths("post-merge-audit-summary");
  const config = createConfig({
    localReviewArtifactDir: reviewDir,
    repoSlug: "owner/repo",
  });
  const artifactDir = postMergeAuditArtifactDir(config);
  const missArtifactPath = path.join(reviewDir, "owner-repo", "issue-102", "external-review-misses-head-merged-head.json");

  await fs.mkdir(path.dirname(missArtifactPath), { recursive: true });
  await fs.mkdir(artifactDir, { recursive: true });
  await writeJsonAtomic(
    missArtifactPath,
    createExternalReviewMissArtifact({
      issueNumber: 999,
      prNumber: 998,
      branch: "codex/issue-999",
      headSha: "wrong-head-sha",
    }),
  );
  await writeJsonAtomic(
    path.join(artifactDir, "issue-102-head-merged-head.json"),
    createPostMergeArtifact({
      artifacts: {
        executionMetricsSummaryPath: null,
        localReviewSummaryPath: null,
        localReviewFindingsPath: null,
        externalReviewMissesPath: missArtifactPath,
      },
    }),
  );

  const summary = await summarizePostMergeAuditPatterns(config);

  assert.deepEqual(summary.followUpCandidates, []);
});
