import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { loadPreMergeEvaluationDto } from "./supervisor-pre-merge-evaluation";
import { createConfig, createPullRequest, createRecord } from "./supervisor-test-helpers";

test("loadPreMergeEvaluationDto reports pending current-head local review when the tracked PR gate is enabled", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "pre-merge-eval-"));

  try {
    const dto = await loadPreMergeEvaluationDto({
      config: createConfig({
        localReviewEnabled: true,
        localReviewPolicy: "advisory",
        trackedPrCurrentHeadLocalReviewRequired: true,
        localReviewArtifactDir: tempDir,
      }),
      record: createRecord({
        local_review_head_sha: "head-old",
        local_review_summary_path: path.join(tempDir, "owner-repo", "issue-58", "local-review-summary.md"),
        local_review_run_at: "2026-03-24T00:11:00Z",
        local_review_findings_count: 0,
        local_review_recommendation: "ready",
      }),
      pr: createPullRequest({ headRefOid: "head-new", isDraft: false }),
    });

    assert.deepEqual(dto, {
      status: "pending",
      outcome: null,
      repair: "none",
      reason: "awaiting_current_head_local_review",
      headStatus: "stale",
      summaryPath: "owner-repo/issue-58/local-review-summary.md",
      artifactPath: "owner-repo/issue-58/local-review-summary.json",
      ranAt: "2026-03-24T00:11:00Z",
      mustFixCount: 0,
      manualReviewCount: 0,
      followUpCount: 0,
    });
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});

test("loadPreMergeEvaluationDto marks opted-in current-head manual-review local-review residuals as same-PR repair", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "pre-merge-eval-"));
  const summaryPath = path.join(tempDir, "owner-repo", "issue-58", "local-review-summary.md");
  const artifactPath = `${summaryPath.slice(0, -3)}.json`;

  try {
    await fs.mkdir(path.dirname(summaryPath), { recursive: true });
    await fs.writeFile(
      artifactPath,
      JSON.stringify({
        ranAt: "2026-03-24T00:11:00Z",
        finalEvaluation: {
          outcome: "manual_review_blocked",
          mustFixCount: 0,
          manualReviewCount: 1,
          followUpCount: 0,
        },
      }),
      "utf8",
    );

    const dto = await loadPreMergeEvaluationDto({
      config: createConfig({
        localReviewEnabled: true,
        localReviewPolicy: "block_merge",
        localReviewManualReviewRepairEnabled: true,
        localReviewArtifactDir: tempDir,
      }),
      record: createRecord({
        state: "local_review_fix",
        local_review_head_sha: "head-current",
        local_review_summary_path: summaryPath,
        local_review_run_at: "2026-03-24T00:11:00Z",
        pre_merge_manual_review_count: 1,
      }),
      pr: createPullRequest({ headRefOid: "head-current", isDraft: false }),
    });

    assert.deepEqual(dto, {
      status: "blocked",
      outcome: "manual_review_blocked",
      repair: "same_pr_manual_review_current_head",
      reason: "manual_review_residuals=1",
      headStatus: "current",
      summaryPath: "owner-repo/issue-58/local-review-summary.md",
      artifactPath: "owner-repo/issue-58/local-review-summary.json",
      ranAt: "2026-03-24T00:11:00Z",
      mustFixCount: 0,
      manualReviewCount: 1,
      followUpCount: 0,
    });
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});

test("loadPreMergeEvaluationDto keeps current-head manual-review residuals in manual review when GitHub requires review", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "pre-merge-eval-"));
  const summaryPath = path.join(tempDir, "owner-repo", "issue-58", "local-review-summary.md");
  const artifactPath = `${summaryPath.slice(0, -3)}.json`;

  try {
    await fs.mkdir(path.dirname(summaryPath), { recursive: true });
    await fs.writeFile(
      artifactPath,
      JSON.stringify({
        ranAt: "2026-03-24T00:11:00Z",
        finalEvaluation: {
          outcome: "manual_review_blocked",
          mustFixCount: 0,
          manualReviewCount: 1,
          followUpCount: 0,
        },
      }),
      "utf8",
    );

    const dto = await loadPreMergeEvaluationDto({
      config: createConfig({
        localReviewEnabled: true,
        localReviewPolicy: "block_merge",
        localReviewManualReviewRepairEnabled: true,
        localReviewArtifactDir: tempDir,
      }),
      record: createRecord({
        state: "local_review_fix",
        local_review_head_sha: "head-current",
        local_review_summary_path: summaryPath,
        local_review_run_at: "2026-03-24T00:11:00Z",
        pre_merge_manual_review_count: 1,
      }),
      pr: createPullRequest({
        headRefOid: "head-current",
        isDraft: false,
        reviewDecision: "REVIEW_REQUIRED",
      }),
    });

    assert.deepEqual(dto, {
      status: "blocked",
      outcome: "manual_review_blocked",
      repair: "manual_review_required",
      reason: "manual_review_residuals=1",
      headStatus: "current",
      summaryPath: "owner-repo/issue-58/local-review-summary.md",
      artifactPath: "owner-repo/issue-58/local-review-summary.json",
      ranAt: "2026-03-24T00:11:00Z",
      mustFixCount: 0,
      manualReviewCount: 1,
      followUpCount: 0,
    });
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});

test("loadPreMergeEvaluationDto keeps current-head manual-review residuals in manual review when GitHub has human changes requested", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "pre-merge-eval-"));
  const summaryPath = path.join(tempDir, "owner-repo", "issue-58", "local-review-summary.md");
  const artifactPath = `${summaryPath.slice(0, -3)}.json`;

  try {
    await fs.mkdir(path.dirname(summaryPath), { recursive: true });
    await fs.writeFile(
      artifactPath,
      JSON.stringify({
        ranAt: "2026-03-24T00:11:00Z",
        finalEvaluation: {
          outcome: "manual_review_blocked",
          mustFixCount: 0,
          manualReviewCount: 1,
          followUpCount: 0,
        },
      }),
      "utf8",
    );

    const dto = await loadPreMergeEvaluationDto({
      config: createConfig({
        localReviewEnabled: true,
        localReviewPolicy: "block_merge",
        localReviewManualReviewRepairEnabled: true,
        localReviewArtifactDir: tempDir,
      }),
      record: createRecord({
        state: "local_review_fix",
        local_review_head_sha: "head-current",
        local_review_summary_path: summaryPath,
        local_review_run_at: "2026-03-24T00:11:00Z",
        pre_merge_manual_review_count: 1,
      }),
      pr: createPullRequest({
        headRefOid: "head-current",
        isDraft: false,
        reviewDecision: "CHANGES_REQUESTED",
      }),
    });

    assert.deepEqual(dto, {
      status: "blocked",
      outcome: "manual_review_blocked",
      repair: "manual_review_required",
      reason: "manual_review_residuals=1",
      headStatus: "current",
      summaryPath: "owner-repo/issue-58/local-review-summary.md",
      artifactPath: "owner-repo/issue-58/local-review-summary.json",
      ranAt: "2026-03-24T00:11:00Z",
      mustFixCount: 0,
      manualReviewCount: 1,
      followUpCount: 0,
    });
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});

test("loadPreMergeEvaluationDto keeps current-head manual-review residuals in manual review when same-PR repair is disabled", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "pre-merge-eval-"));
  const summaryPath = path.join(tempDir, "owner-repo", "issue-58", "local-review-summary.md");
  const artifactPath = `${summaryPath.slice(0, -3)}.json`;

  try {
    await fs.mkdir(path.dirname(summaryPath), { recursive: true });
    await fs.writeFile(
      artifactPath,
      JSON.stringify({
        ranAt: "2026-03-24T00:11:00Z",
        finalEvaluation: {
          outcome: "manual_review_blocked",
          mustFixCount: 0,
          manualReviewCount: 1,
          followUpCount: 0,
        },
      }),
      "utf8",
    );

    const dto = await loadPreMergeEvaluationDto({
      config: createConfig({
        localReviewEnabled: true,
        localReviewPolicy: "block_merge",
        localReviewManualReviewRepairEnabled: false,
        localReviewArtifactDir: tempDir,
      }),
      record: createRecord({
        state: "local_review_fix",
        local_review_head_sha: "head-current",
        local_review_summary_path: summaryPath,
        local_review_run_at: "2026-03-24T00:11:00Z",
        pre_merge_manual_review_count: 1,
      }),
      pr: createPullRequest({
        headRefOid: "head-current",
        isDraft: false,
      }),
    });

    assert.deepEqual(dto, {
      status: "blocked",
      outcome: "manual_review_blocked",
      repair: "manual_review_required",
      reason: "manual_review_residuals=1",
      headStatus: "current",
      summaryPath: "owner-repo/issue-58/local-review-summary.md",
      artifactPath: "owner-repo/issue-58/local-review-summary.json",
      ranAt: "2026-03-24T00:11:00Z",
      mustFixCount: 0,
      manualReviewCount: 1,
      followUpCount: 0,
    });
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});
