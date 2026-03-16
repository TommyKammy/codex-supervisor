import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { writeLocalReviewArtifacts } from "./local-review-artifacts";
import { finalizeLocalReview } from "./local-review-finalize";
import { createConfig } from "./local-review-test-helpers";

test("writeLocalReviewArtifacts renders durable guardrail provenance compactly", async () => {
  const config = createConfig({
    localReviewArtifactDir: await fs.mkdtemp(path.join(os.tmpdir(), "local-review-artifacts-")),
  });
  const roleResults = [
    {
      role: "reviewer",
      summary: "No actionable findings.",
      recommendation: "ready" as const,
      degraded: false,
      exitCode: 0,
      rawOutput: "review raw output",
      findings: [],
    },
  ];
  const finalized = finalizeLocalReview({
    config,
    issueNumber: 38,
    prNumber: 12,
    branch: "codex/issue-38",
    headSha: "deadbeefcafebabe",
    roleResults,
    verifierReport: null,
    ranAt: "2026-03-14T00:00:00Z",
    guardrailProvenance: {
      verifier: {
        committedPath: "docs/shared-memory/verifier-guardrails.json",
        committedCount: 1,
      },
      externalReview: {
        committedPath: "docs/shared-memory/external-review-guardrails.json",
        committedCount: 1,
        runtimeSources: [
          {
            path: "owner-repo/issue-38/external-review-misses-head-111122223333.json",
            count: 2,
          },
        ],
      },
    },
  });

  const artifacts = await writeLocalReviewArtifacts({
    config,
    issueNumber: 38,
    branch: "codex/issue-38",
    prUrl: "https://example.test/pr/12",
    headSha: "deadbeefcafebabe",
    roles: ["reviewer"],
    ranAt: "2026-03-14T00:00:00Z",
    finalized,
    roleResults,
    verifierReport: null,
  });
  const summary = await fs.readFile(artifacts.summaryPath, "utf8");

  assert.match(summary, /## Durable guardrails/);
  assert.match(summary, /- Verifier committed: 1 from docs\/shared-memory\/verifier-guardrails\.json/);
  assert.match(summary, /- External review committed: 1 from docs\/shared-memory\/external-review-guardrails\.json/);
  assert.match(summary, /- External review runtime: 2 from owner-repo\/issue-38\/external-review-misses-head-111122223333\.json/);
});
