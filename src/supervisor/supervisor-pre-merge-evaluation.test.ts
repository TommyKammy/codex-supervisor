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
