import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createCheckedInReplayCorpusConfig } from "./replay-corpus";
import type { ReplayCorpusRunResult } from "./replay-corpus-model";
import {
  formatReplayCorpusMismatchDetailsArtifact,
  syncReplayCorpusMismatchDetailsArtifact,
} from "./replay-corpus-mismatch-artifact";

function createRunResult(tempDir: string): ReplayCorpusRunResult {
  return {
    rootPath: path.join(tempDir, "replay-corpus"),
    manifestPath: path.join(tempDir, "replay-corpus", "manifest.json"),
    totalCases: 2,
    mismatchCount: 1,
    results: [
      {
        caseId: "review-blocked",
        issueNumber: 532,
        bundlePath: path.join(tempDir, "replay-corpus", "cases", "review-blocked"),
        expected: {
          nextState: "ready_to_merge",
          shouldRunCodex: true,
          blockedReason: null,
          failureSignature: null,
        },
        actual: {
          nextState: "blocked",
          shouldRunCodex: false,
          blockedReason: "manual_review",
          failureSignature: "stalled-bot:thread-1",
        },
        matchesExpected: false,
      },
      {
        caseId: "review-pass",
        issueNumber: 533,
        bundlePath: path.join(tempDir, "replay-corpus", "cases", "review-pass"),
        expected: {
          nextState: "reproducing",
          shouldRunCodex: true,
          blockedReason: null,
          failureSignature: null,
        },
        actual: {
          nextState: "reproducing",
          shouldRunCodex: true,
          blockedReason: null,
          failureSignature: null,
        },
        matchesExpected: true,
      },
    ],
  };
}

test("mismatch artifact helpers shape deterministic details and remove stale success artifacts", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "replay-corpus-mismatch-details-"));
  const config = createCheckedInReplayCorpusConfig(tempDir);
  const artifactPath = path.join(tempDir, ".codex-supervisor", "replay", "replay-corpus-mismatch-details.json");
  const result = createRunResult(tempDir);

  const firstContext = await syncReplayCorpusMismatchDetailsArtifact(result, config);
  assert.equal(firstContext?.artifactPath, artifactPath);
  assert.deepEqual(
    JSON.parse(await fs.readFile(artifactPath, "utf8")),
    formatReplayCorpusMismatchDetailsArtifact(result, config),
  );

  const beforeRepeat = await fs.readFile(artifactPath, "utf8");
  const secondContext = await syncReplayCorpusMismatchDetailsArtifact(result, config);
  assert.equal(secondContext?.artifactPath, artifactPath);
  assert.equal(await fs.readFile(artifactPath, "utf8"), beforeRepeat);

  const successContext = await syncReplayCorpusMismatchDetailsArtifact(
    {
      ...result,
      mismatchCount: 0,
      results: result.results.map((entry) => ({
        ...entry,
        actual: entry.expected,
        matchesExpected: true,
      })),
    },
    config,
  );
  assert.equal(successContext, null);
  await assert.rejects(() => fs.readFile(artifactPath, "utf8"), { code: "ENOENT" });
});
