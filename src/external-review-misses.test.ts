import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import assert from "node:assert/strict";
import test from "node:test";
import { classifyExternalReviewFinding, normalizeExternalReviewFinding, writeExternalReviewMissArtifact } from "./external-review-misses";
import { ReviewThread } from "./types";

function createReviewThread(overrides: Partial<ReviewThread> = {}): ReviewThread {
  return {
    id: "thread-1",
    isResolved: false,
    isOutdated: false,
    path: "src/auth.ts",
    line: 42,
    comments: {
      nodes: [
        {
          id: "comment-1",
          body: "This fallback skips the permission guard and lets unauthorized callers update records.",
          createdAt: "2026-03-12T00:00:00Z",
          url: "https://example.test/thread-1#comment-1",
          author: {
            login: "copilot-pull-request-reviewer",
            typeName: "Bot",
          },
        },
      ],
    },
    ...overrides,
  };
}

test("normalizeExternalReviewFinding uses the final configured-bot comment", () => {
  const thread = createReviewThread({
    comments: {
      nodes: [
        {
          id: "comment-1",
          body: "Initial note.",
          createdAt: "2026-03-12T00:00:00Z",
          url: "https://example.test/thread-1#comment-1",
          author: {
            login: "copilot-pull-request-reviewer",
            typeName: "Bot",
          },
        },
        {
          id: "comment-2",
          body: "Author reply",
          createdAt: "2026-03-12T00:01:00Z",
          url: "https://example.test/thread-1#comment-2",
          author: {
            login: "tommy",
            typeName: "User",
          },
        },
        {
          id: "comment-3",
          body: "This fallback skips the permission guard and lets unauthorized callers update records.",
          createdAt: "2026-03-12T00:02:00Z",
          url: "https://example.test/thread-1#comment-3",
          author: {
            login: "copilot-pull-request-reviewer",
            typeName: "Bot",
          },
        },
      ],
    },
  });

  const finding = normalizeExternalReviewFinding(thread, ["copilot-pull-request-reviewer"]);
  assert.equal(finding?.reviewerLogin, "copilot-pull-request-reviewer");
  assert.equal(finding?.file, "src/auth.ts");
  assert.equal(finding?.line, 42);
  assert.match(finding?.summary ?? "", /permission guard/i);
  assert.equal(finding?.severity, "medium");
  assert.equal(finding?.confidence, 0.75);
});

test("classifyExternalReviewFinding marks unmatched configured-bot feedback as missed_by_local_review", () => {
  const normalized = normalizeExternalReviewFinding(createReviewThread(), ["copilot-pull-request-reviewer"]);
  assert.ok(normalized);

  const classified = classifyExternalReviewFinding(normalized, {
    actionableFindings: [
      {
        title: "Missing cache invalidation",
        body: "The cache never clears after a successful save, so readers can observe stale data.",
        file: "src/cache.ts",
        start: 15,
        end: 20,
        severity: "medium",
      },
    ],
    rootCauseSummaries: [
      {
        summary: "Saving data leaves stale cache entries behind.",
        file: "src/cache.ts",
        start: 15,
        end: 20,
        severity: "medium",
      },
    ],
  });

  assert.equal(classified.classification, "missed_by_local_review");
  assert.equal(classified.matchedLocalReference, null);
  assert.match(classified.matchReason, /no same-file local-review match/);
});

test("writeExternalReviewMissArtifact persists missed external findings for the current review head", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "external-review-miss-test-"));
  const localReviewSummaryPath = path.join(tempDir, "head-deadbeef.md");
  const localReviewFindingsPath = path.join(tempDir, "head-deadbeef.json");
  await fs.writeFile(localReviewSummaryPath, "# summary\n", "utf8");
  await fs.writeFile(
    localReviewFindingsPath,
    `${JSON.stringify({
      actionableFindings: [
        {
          title: "Missing cache invalidation",
          body: "The cache never clears after a successful save, so readers can observe stale data.",
          file: "src/cache.ts",
          start: 15,
          end: 20,
          severity: "medium",
        },
      ],
      rootCauseSummaries: [
        {
          summary: "Saving data leaves stale cache entries behind.",
          file: "src/cache.ts",
          start: 15,
          end: 20,
          severity: "medium",
        },
      ],
    }, null, 2)}\n`,
    "utf8",
  );

  const context = await writeExternalReviewMissArtifact({
    artifactDir: tempDir,
    issueNumber: 58,
    prNumber: 91,
    branch: "codex/issue-58",
    headSha: "deadbeefcafebabe",
    reviewThreads: [createReviewThread()],
    reviewBotLogins: ["copilot-pull-request-reviewer"],
    localReviewSummaryPath,
  });

  assert.ok(context);
  assert.equal(context?.matchedCount, 0);
  assert.equal(context?.nearMatchCount, 0);
  assert.equal(context?.missedCount, 1);
  assert.equal(context?.missedFindings[0]?.classification, "missed_by_local_review");

  const artifactPath = context?.artifactPath ?? "";
  const artifact = JSON.parse(await fs.readFile(artifactPath, "utf8")) as {
    headSha: string;
    counts: { missedByLocalReview: number };
    findings: Array<{ classification: string; reviewerLogin: string; file: string | null; line: number | null }>;
  };
  assert.equal(artifact.headSha, "deadbeefcafebabe");
  assert.equal(artifact.counts.missedByLocalReview, 1);
  assert.deepEqual(artifact.findings.map((finding) => ({
    classification: finding.classification,
    reviewerLogin: finding.reviewerLogin,
    file: finding.file,
    line: finding.line,
  })), [
    {
      classification: "missed_by_local_review",
      reviewerLogin: "copilot-pull-request-reviewer",
      file: "src/auth.ts",
      line: 42,
    },
  ]);
});
