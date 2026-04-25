import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import {
  TRUSTED_GENERATED_DURABLE_ARTIFACT_PROVENANCE_VALUE,
} from "../durable-artifact-provenance";
import { writeJsonAtomic } from "../core/utils";
import { type LocalReviewArtifact } from "../local-review/types";
import { createConfig, createFailureContext, createIssue, createPullRequest, createRecord } from "../turn-execution-test-helpers";
import { createArtifactTestPaths } from "./artifact-test-helpers";
import { type ExecutionMetricsRunSummaryArtifact } from "./execution-metrics-schema";
import {
  executionMetricsRunSummaryPath,
} from "./execution-metrics-run-summary";
import {
  postMergeAuditArtifactPath,
  syncPostMergeAuditArtifact,
  syncPostMergeAuditArtifactSafely,
  type PostMergeAuditArtifact,
} from "./post-merge-audit-artifact";

test("createArtifactTestPaths returns isolated roots for each artifact test setup", async () => {
  const first = await createArtifactTestPaths("post-merge-audit-isolation");
  const second = await createArtifactTestPaths("post-merge-audit-isolation");
  const sentinelPath = path.join(first.reviewDir, "sentinel.txt");

  assert.notEqual(first.rootPath, second.rootPath);
  assert.notEqual(first.workspacePath, second.workspacePath);
  assert.notEqual(first.reviewDir, second.reviewDir);

  await fs.writeFile(sentinelPath, "stale artifact", "utf8");
  await assert.rejects(fs.stat(path.join(second.reviewDir, "sentinel.txt")), { code: "ENOENT" });
});

test("syncPostMergeAuditArtifact persists a typed completed-work artifact", async () => {
  const { workspacePath, reviewDir } = await createArtifactTestPaths("post-merge-audit");
  const config = createConfig({
    localReviewArtifactDir: reviewDir,
    repoSlug: "owner/repo",
  });
  const localReviewSummaryPath = path.join(reviewDir, "owner-repo", "issue-102", "head-deadbeef.md");
  const localReviewFindingsPath = `${localReviewSummaryPath.slice(0, -3)}.json`;

  await fs.mkdir(path.dirname(localReviewSummaryPath), { recursive: true });
  await fs.writeFile(localReviewSummaryPath, "# local review\n", "utf8");
  const localReviewArtifact: LocalReviewArtifact = {
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
    summary: "Local review captured one durable root cause.",
    recommendation: "changes_requested",
    degraded: false,
    findingsCount: 1,
    rootCauseCount: 1,
    maxSeverity: "medium",
    actionableFindings: [],
    rootCauseSummaries: [],
    verification: {
      required: false,
      summary: "No high-severity findings required verification.",
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
      followUpCount: 0,
    },
    guardrailProvenance: {
      verifier: { committedPath: null, committedCount: 0 },
      externalReview: { committedPath: null, committedCount: 0, runtimeSources: [] },
    },
    roleReports: [],
    verifierReport: null,
  };
  await writeJsonAtomic(localReviewFindingsPath, localReviewArtifact);

  const executionMetricsArtifact: ExecutionMetricsRunSummaryArtifact = {
    schemaVersion: 4,
    issueNumber: 102,
    terminalState: "done",
    terminalOutcome: { category: "completed", reason: "merged" },
    issueCreatedAt: "2026-03-24T09:55:00Z",
    startedAt: "2026-03-24T10:00:00Z",
    prCreatedAt: "2026-03-24T10:03:00Z",
    prMergedAt: "2026-03-24T10:05:00Z",
    finishedAt: "2026-03-24T10:06:00Z",
    runDurationMs: 360000,
    issueLeadTimeMs: 660000,
    issueToPrCreatedMs: 480000,
    prOpenDurationMs: 120000,
    reviewMetrics: null,
    failureMetrics: {
      classification: "latest_failure",
      category: "review",
      failureKind: "command_error",
      blockedReason: null,
      occurrenceCount: 2,
      lastOccurredAt: "2026-03-24T10:04:00Z",
    },
    recoveryMetrics: {
      classification: "latest_recovery",
      reason: "merged_pr_convergence",
      occurrenceCount: 1,
      lastRecoveredAt: "2026-03-24T10:06:00Z",
      timeToLatestRecoveryMs: 120000,
    },
  };
  await writeJsonAtomic(executionMetricsRunSummaryPath(workspacePath), executionMetricsArtifact);

  const previousRecord = createRecord({
    issue_number: 102,
    branch: "codex/issue-102",
    workspace: workspacePath,
    local_review_summary_path: localReviewSummaryPath,
    local_review_run_at: "2026-03-24T10:00:00Z",
    local_review_recommendation: "changes_requested",
    local_review_findings_count: 1,
    local_review_root_cause_count: 1,
    local_review_max_severity: "medium",
    local_review_verified_findings_count: 0,
    local_review_verified_max_severity: "none",
    external_review_misses_path: "/tmp/reviews/external-review-misses-head-merged-head-116.json",
    latest_local_ci_result: {
      outcome: "passed",
      summary: "Configured local CI passed.",
      ran_at: "2026-03-24T10:04:00Z",
      head_sha: "merged-head-116",
      execution_mode: "shell",
      command: "npm run build",
      stderr_summary: null,
      failure_class: null,
      remediation_target: null,
    },
    last_failure_kind: "command_error",
    last_failure_context: createFailureContext("Code review exposed a recurring mismatch."),
    blocked_reason: "manual_review",
    repeated_failure_signature_count: 2,
    updated_at: "2026-03-24T10:00:00Z",
  });
  const nextRecord = {
    ...previousRecord,
    state: "done" as const,
    last_recovery_reason: "merged_pr_convergence: tracked PR #116 merged; marked issue #102 done",
    last_recovery_at: "2026-03-24T10:06:00Z",
    updated_at: "2026-03-24T10:06:00Z",
  };
  const issue = createIssue({
    number: 102,
    title: "Persist a completed-work audit artifact",
    body: [
      "## Summary",
      "Persist a completed-work audit artifact",
      "",
      "## Verification",
      "- `npx tsx --test src/supervisor/post-merge-audit-artifact.test.ts`",
      "- `npm run build`",
    ].join("\n"),
    createdAt: "2026-03-24T09:55:00Z",
    updatedAt: "2026-03-24T10:06:00Z",
  });
  const pullRequest = createPullRequest({
    number: 116,
    title: "Persist completed-work audit artifact",
    headRefName: "codex/issue-102",
    headRefOid: "merged-head-116",
    createdAt: "2026-03-24T10:03:00Z",
    mergedAt: "2026-03-24T10:05:00Z",
  });

  const artifactPath = await syncPostMergeAuditArtifact({
    config,
    previousRecord,
    nextRecord,
    issue,
    pullRequest,
  });

  assert.equal(
    artifactPath,
    postMergeAuditArtifactPath({ config, issueNumber: 102, headSha: "merged-head-116" }),
  );

  const artifact = JSON.parse(await fs.readFile(artifactPath!, "utf8")) as PostMergeAuditArtifact;
  assert.equal(artifact.codexSupervisorProvenance, TRUSTED_GENERATED_DURABLE_ARTIFACT_PROVENANCE_VALUE);
  assert.equal(artifact.schemaVersion, 1);
  assert.equal(artifact.issue.title, "Persist a completed-work audit artifact");
  assert.equal(artifact.pullRequest.number, 116);
  assert.equal(artifact.executionMetrics?.terminalState, "done");
  assert.equal(artifact.artifacts.localReviewSummaryPath, "owner-repo/issue-102/head-deadbeef.md");
  assert.equal(artifact.artifacts.localReviewFindingsPath, "owner-repo/issue-102/head-deadbeef.json");
  assert.equal(artifact.artifacts.externalReviewMissesPath, "<redacted-local-path>");
  assert.equal(artifact.localReview?.artifact?.summary, localReviewArtifact.summary);
  assert.equal(artifact.failureTaxonomy.latestFailure?.failureKind, "command_error");
  assert.equal(artifact.failureTaxonomy.latestRecovery?.reason, nextRecord.last_recovery_reason);
  assert.equal(artifact.operatorAuditBundle?.localCi.value?.summary, "Configured local CI passed.");
  assert.deepEqual(artifact.operatorAuditBundle?.verificationCommands.value, [
    "npx tsx --test src/supervisor/post-merge-audit-artifact.test.ts",
    "npm run build",
  ]);
  assert.doesNotMatch(JSON.stringify(artifact), new RegExp(workspacePath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.doesNotMatch(JSON.stringify(artifact), /\/tmp\/reviews\/external-review-misses-head-merged-head-116\.json/);
});

test("syncPostMergeAuditArtifact ignores stale execution metrics summaries", async () => {
  const { workspacePath, reviewDir } = await createArtifactTestPaths("post-merge-audit-stale-metrics");
  const config = createConfig({
    localReviewArtifactDir: reviewDir,
    repoSlug: "owner/repo",
  });

  const staleExecutionMetrics: ExecutionMetricsRunSummaryArtifact = {
    schemaVersion: 4,
    issueNumber: 102,
    terminalState: "blocked",
    terminalOutcome: { category: "blocked", reason: "manual_review" },
    issueCreatedAt: "2026-03-24T09:55:00Z",
    startedAt: "2026-03-24T10:00:00Z",
    prCreatedAt: "2026-03-24T10:03:00Z",
    prMergedAt: "2026-03-24T10:04:00Z",
    finishedAt: "2026-03-24T10:05:00Z",
    runDurationMs: 300000,
    issueLeadTimeMs: 600000,
    issueToPrCreatedMs: 480000,
    prOpenDurationMs: 60000,
    reviewMetrics: null,
    failureMetrics: {
      classification: "latest_failure",
      category: "review",
      failureKind: "command_error",
      blockedReason: "manual_review",
      occurrenceCount: 1,
      lastOccurredAt: "2026-03-24T10:05:00Z",
    },
    recoveryMetrics: null,
  };
  await writeJsonAtomic(executionMetricsRunSummaryPath(workspacePath), staleExecutionMetrics);

  const previousRecord = createRecord({
    issue_number: 102,
    branch: "codex/issue-102",
    workspace: workspacePath,
    updated_at: "2026-03-24T10:00:00Z",
  });
  const nextRecord = {
    ...previousRecord,
    state: "done" as const,
    updated_at: "2026-03-24T10:06:00Z",
    last_recovery_reason: "merged_pr_convergence",
    last_recovery_at: "2026-03-24T10:06:00Z",
  };
  const issue = createIssue({
    number: 102,
    updatedAt: "2026-03-24T10:06:00Z",
  });
  const pullRequest = createPullRequest({
    number: 116,
    headRefOid: "merged-head-116",
    createdAt: "2026-03-24T10:03:00Z",
    mergedAt: "2026-03-24T10:05:00Z",
  });

  const artifactPath = await syncPostMergeAuditArtifact({
    config,
    previousRecord,
    nextRecord,
    issue,
    pullRequest,
  });

  const artifact = JSON.parse(await fs.readFile(artifactPath!, "utf8")) as PostMergeAuditArtifact;
  assert.equal(artifact.executionMetrics, null);
  assert.equal(artifact.artifacts.executionMetricsSummaryPath, null);
});

test("syncPostMergeAuditArtifactSafely swallows malformed local review artifacts", async () => {
  const { workspacePath, reviewDir } = await createArtifactTestPaths("post-merge-audit-safe-wrapper");
  const config = createConfig({
    localReviewArtifactDir: reviewDir,
    repoSlug: "owner/repo",
  });
  const localReviewSummaryPath = path.join(reviewDir, "owner-repo", "issue-102", "head-deadbeef.md");
  const localReviewFindingsPath = `${localReviewSummaryPath.slice(0, -3)}.json`;
  await fs.mkdir(path.dirname(localReviewSummaryPath), { recursive: true });
  await fs.writeFile(localReviewSummaryPath, "# local review\n", "utf8");
  await fs.writeFile(localReviewFindingsPath, "{not-json", "utf8");

  const previousRecord = createRecord({
    issue_number: 102,
    branch: "codex/issue-102",
    workspace: workspacePath,
    local_review_summary_path: localReviewSummaryPath,
    updated_at: "2026-03-24T10:00:00Z",
  });
  const nextRecord = {
    ...previousRecord,
    state: "done" as const,
    updated_at: "2026-03-24T10:06:00Z",
    last_recovery_reason: "merged_pr_convergence",
    last_recovery_at: "2026-03-24T10:06:00Z",
  };
  const issue = createIssue({
    number: 102,
    updatedAt: "2026-03-24T10:06:00Z",
  });
  const pullRequest = createPullRequest({
    number: 116,
    headRefOid: "merged-head-116",
    createdAt: "2026-03-24T10:03:00Z",
    mergedAt: "2026-03-24T10:05:00Z",
  });

  const warnings: unknown[][] = [];
  const originalWarn = console.warn;
  console.warn = (...args: unknown[]) => {
    warnings.push(args);
  };
  try {
    const artifactPath = await syncPostMergeAuditArtifactSafely({
      config,
      previousRecord,
      nextRecord,
      issue,
      pullRequest,
      warningContext: "persisting",
    });
    assert.equal(artifactPath, null);
  } finally {
    console.warn = originalWarn;
  }

  assert.equal(warnings.length, 1);
  assert.match(String(warnings[0][0]), /Failed to persist post-merge audit artifact while persisting issue #102\./u);
});
