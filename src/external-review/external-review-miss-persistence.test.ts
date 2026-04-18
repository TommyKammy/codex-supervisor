import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import assert from "node:assert/strict";
import test from "node:test";
import {
  TRUSTED_GENERATED_DURABLE_ARTIFACT_MARKDOWN_MARKER,
  TRUSTED_GENERATED_DURABLE_ARTIFACT_PROVENANCE_VALUE,
} from "../durable-artifact-provenance";
import { loadLocalReviewArtifact } from "./external-review-local-artifact-io";
import { writeExternalReviewMissArtifact } from "./external-review-miss-persistence";
import { collectExternalReviewSignals } from "./external-review-signal-collection";
import { IssueComment, PullRequestReview, ReviewThread } from "../core/types";

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

function createTopLevelReview(overrides: Partial<PullRequestReview> = {}): PullRequestReview {
  return {
    id: "review-1",
    body: "Nitpick: this nil check is inverted and can mask the error path.",
    submittedAt: "2026-03-12T00:03:00Z",
    url: "https://example.test/pr/1#pullrequestreview-1",
    state: "COMMENTED",
    author: {
      login: "coderabbitai[bot]",
      typeName: "Bot",
    },
    ...overrides,
  };
}

function createIssueComment(overrides: Partial<IssueComment> = {}): IssueComment {
  return {
    id: "issue-comment-1",
    body: "Suggestion: the fallback path should guard against unauthorized writes before persisting.",
    createdAt: "2026-03-12T00:04:00Z",
    url: "https://example.test/pr/1#issuecomment-1",
    author: {
      login: "coderabbitai[bot]",
      typeName: "Bot",
    },
    ...overrides,
  };
}

test("loadLocalReviewArtifact only loads md-adjacent findings artifacts", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "external-review-local-artifact-test-"));
  const summaryPath = path.join(tempDir, "head-deadbeef.md");
  const findingsPath = path.join(tempDir, "head-deadbeef.json");
  await fs.writeFile(summaryPath, "# summary\n", "utf8");
  await fs.writeFile(
    findingsPath,
    `${JSON.stringify({ actionableFindings: [{ title: "A", body: "B", file: "src/auth.ts", start: 1, end: 1, severity: "medium" }] })}\n`,
    "utf8",
  );

  const loaded = await loadLocalReviewArtifact(summaryPath);
  assert.equal(loaded.available, true);
  assert.equal(loaded.findingsPath, findingsPath);
  assert.equal(loaded.artifact?.actionableFindings?.[0]?.file, "src/auth.ts");

  const ignored = await loadLocalReviewArtifact(path.join(tempDir, "head-deadbeef.txt"));
  assert.deepEqual(ignored, {
    findingsPath: null,
    artifact: null,
    available: false,
  });
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
  assert.equal(context?.missedFindings[0]?.reviewerLogin, "copilot-pull-request-reviewer");
  assert.equal(path.basename(context?.artifactPath ?? ""), "external-review-misses-head-deadbeefcafe.json");

  const artifactPath = context?.artifactPath ?? "";
  const artifact = JSON.parse(await fs.readFile(artifactPath, "utf8")) as {
    codexSupervisorProvenance: string;
    headSha: string;
    reusableMissPatterns: Array<{ file: string; summary: string }>;
    counts: { missedByLocalReview: number };
    findings: Array<{
      classification: string;
      preventionTarget: string | null;
      reviewerLogin: string;
      file: string | null;
      line: number | null;
    }>;
  };
  assert.equal(artifact.headSha, "deadbeefcafebabe");
  assert.equal(artifact.codexSupervisorProvenance, TRUSTED_GENERATED_DURABLE_ARTIFACT_PROVENANCE_VALUE);
  assert.equal(artifact.counts.missedByLocalReview, 1);
  assert.equal(artifact.reusableMissPatterns.length, 1);
  assert.equal(artifact.reusableMissPatterns[0]?.file, "src/auth.ts");
  assert.match(artifact.reusableMissPatterns[0]?.summary ?? "", /permission guard/i);
  assert.deepEqual(artifact.findings.map((finding) => ({
      classification: finding.classification,
      preventionTarget: finding.preventionTarget,
      reviewerLogin: finding.reviewerLogin,
      file: finding.file,
      line: finding.line,
    })), [
    {
      classification: "missed_by_local_review",
      preventionTarget: "regression_test",
      reviewerLogin: "copilot-pull-request-reviewer",
      file: "src/auth.ts",
      line: 42,
    },
  ]);
});

test("writeExternalReviewMissArtifact carries source-aware signals through downstream extraction", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "external-review-signal-test-"));
  const localReviewSummaryPath = path.join(tempDir, "head-deadbeef.md");
  const localReviewFindingsPath = path.join(tempDir, "head-deadbeef.json");
  await fs.writeFile(localReviewSummaryPath, "# summary\n", "utf8");
  await fs.writeFile(
    localReviewFindingsPath,
    `${JSON.stringify({
      actionableFindings: [],
      rootCauseSummaries: [],
    }, null, 2)}\n`,
    "utf8",
  );

  const context = await writeExternalReviewMissArtifact({
    artifactDir: tempDir,
    issueNumber: 58,
    prNumber: 91,
    branch: "codex/issue-58",
    headSha: "deadbeefcafebabe",
    reviewSignals: collectExternalReviewSignals({
      reviewThreads: [createReviewThread()],
      reviews: [createTopLevelReview()],
      issueComments: [createIssueComment()],
      reviewBotLogins: ["copilot-pull-request-reviewer", "coderabbitai[bot]"],
    }),
    reviewBotLogins: ["copilot-pull-request-reviewer", "coderabbitai[bot]"],
    localReviewSummaryPath,
  });

  assert.ok(context);
  assert.equal(context?.missedCount, 3);
  assert.deepEqual(
    context?.missedFindings.map((finding) => ({
      sourceKind: finding.sourceKind,
      sourceId: finding.sourceId,
      sourceUrl: finding.sourceUrl,
      file: finding.file,
      line: finding.line,
    })),
    [
      {
        sourceKind: "review_thread",
        sourceId: "thread-1",
        sourceUrl: "https://example.test/thread-1#comment-1",
        file: "src/auth.ts",
        line: 42,
      },
      {
        sourceKind: "top_level_review",
        sourceId: "review-1",
        sourceUrl: "https://example.test/pr/1#pullrequestreview-1",
        file: null,
        line: null,
      },
      {
        sourceKind: "issue_comment",
        sourceId: "issue-comment-1",
        sourceUrl: "https://example.test/pr/1#issuecomment-1",
        file: null,
        line: null,
      },
    ],
  );
});

test("writeExternalReviewMissArtifact emits a follow-up action digest beside the miss artifact", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "external-review-digest-test-"));
  const localReviewSummaryPath = path.join(tempDir, "head-deadbeefcafe.md");
  const localReviewFindingsPath = path.join(tempDir, "head-deadbeefcafe.json");
  await fs.writeFile(localReviewSummaryPath, "# summary\n", "utf8");
  await fs.writeFile(
    localReviewFindingsPath,
    `${JSON.stringify({
      issueNumber: 58,
      prNumber: 91,
      branch: "codex/issue-58",
      headSha: "deadbeefcafebabe",
      actionableFindings: [],
      rootCauseSummaries: [],
      verifiedFindings: [],
    }, null, 2)}\n`,
    "utf8",
  );

  const context = await writeExternalReviewMissArtifact({
    artifactDir: tempDir,
    issueNumber: 58,
    prNumber: 91,
    branch: "codex/issue-58",
    headSha: "deadbeefcafebabe",
    reviewSignals: collectExternalReviewSignals({
      reviewThreads: [
        createReviewThread({
          id: "thread-strong",
          path: "src/auth.ts",
          line: 42,
          comments: {
            nodes: [
              {
                id: "comment-strong",
                body: "This fallback skips the permission guard and lets unauthorized callers update records.",
                createdAt: "2026-03-12T00:00:00Z",
                url: "https://example.test/thread-strong#comment-1",
                author: {
                  login: "copilot-pull-request-reviewer",
                  typeName: "Bot",
                },
              },
            ],
          },
        }),
        createReviewThread({
          id: "thread-regression",
          path: "src/cache.ts",
          line: 12,
          comments: {
            nodes: [
              {
                id: "comment-regression",
                body: "Bug: retries can reuse stale cache state after the reset path runs.",
                createdAt: "2026-03-12T00:01:00Z",
                url: "https://example.test/thread-regression#comment-1",
                author: {
                  login: "coderabbitai[bot]",
                  typeName: "Bot",
                },
              },
            ],
          },
        }),
      ],
      reviews: [
        createTopLevelReview({
          id: "review-1",
          body: "Bug: the local review prompt should inspect migration rollback risks before landing.",
          url: "https://example.test/pr/1#pullrequestreview-1",
        }),
      ],
      issueComments: [
        createIssueComment({
          id: "issue-comment-1",
          body: "Suggestion: issue instructions should call out rollout and rollback expectations up front.",
          url: "https://example.test/pr/1#issuecomment-1",
        }),
      ],
      reviewBotLogins: ["copilot-pull-request-reviewer", "coderabbitai[bot]"],
    }),
    reviewBotLogins: ["copilot-pull-request-reviewer", "coderabbitai[bot]"],
    localReviewSummaryPath,
  });

  assert.ok(context);
  const digestPath = path.join(tempDir, "external-review-misses-head-deadbeefcafe.md");
  const digest = await fs.readFile(digestPath, "utf8");

  assert.equal(path.basename(context?.artifactPath ?? ""), "external-review-misses-head-deadbeefcafe.json");
  assert.match(digest, new RegExp(TRUSTED_GENERATED_DURABLE_ARTIFACT_MARKDOWN_MARKER.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.match(digest, /# External Review Miss Follow-up Digest/);
  assert.match(digest, /- Miss artifact: external-review-misses-head-deadbeefcafe\.json/);
  assert.match(digest, /- Local review summary: head-deadbeefcafe\.md/);
  assert.match(digest, /- Miss analysis head SHA: deadbeefcafebabe/);
  assert.match(digest, /- Active PR head SHA: deadbeefcafebabe/);
  assert.match(digest, /- Head status: current-head \(digest matches the active PR head\)/);
  assert.match(digest, /## Regression test \(2 findings\)/);
  assert.match(digest, /## Review prompt \(1 finding\)/);
  assert.match(digest, /## Issue template \(1 finding\)/);
  assert.match(digest, /This fallback skips the permission guard and lets unauthorized callers update records\./);
  assert.match(digest, /- Prevention target: regression_test/);
  assert.match(digest, /Recommended next action: Add or extend a regression test for `src\/cache\.ts:12` that proves this miss cannot recur\./);
  assert.match(digest, /Recommended next action: Add or extend a regression test for `src\/auth\.ts:42` that proves this miss cannot recur\./);
  assert.match(digest, /Recommended next action: Update the local review prompt or rubric so it explicitly checks for this risk before code changes land\./);
  assert.match(digest, /Recommended next action: Update the issue template or execution checklist so this expectation is explicit before implementation starts\./);
  assert.doesNotMatch(digest, new RegExp(tempDir.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
});

test("writeExternalReviewMissArtifact derives reviewer-grade findings from actionable top-level reviews only", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "external-review-top-level-review-test-"));
  const localReviewSummaryPath = path.join(tempDir, "head-deadbeef.md");
  const localReviewFindingsPath = path.join(tempDir, "head-deadbeef.json");
  await fs.writeFile(localReviewSummaryPath, "# summary\n", "utf8");
  await fs.writeFile(
    localReviewFindingsPath,
    `${JSON.stringify({
      actionableFindings: [],
      rootCauseSummaries: [],
    }, null, 2)}\n`,
    "utf8",
  );

  const context = await writeExternalReviewMissArtifact({
    artifactDir: tempDir,
    issueNumber: 58,
    prNumber: 91,
    branch: "codex/issue-58",
    headSha: "deadbeefcafebabe",
    reviewSignals: collectExternalReviewSignals({
      reviews: [
        createTopLevelReview({
          id: "review-actionable",
          body: "Bug: retries can reuse stale state and mask the latest failure.",
          url: "https://example.test/pr/1#pullrequestreview-actionable",
        }),
        createTopLevelReview({
          id: "review-informational",
          body: "## Summary\nCodeRabbit reviewed this pull request and found no actionable issues.",
          url: "https://example.test/pr/1#pullrequestreview-informational",
        }),
      ],
      reviewBotLogins: ["coderabbitai[bot]"],
    }),
    reviewBotLogins: ["coderabbitai[bot]"],
    localReviewSummaryPath,
  });

  assert.ok(context);
  assert.equal(context?.missedCount, 1);
  assert.equal(context?.matchedCount, 0);
  assert.equal(context?.nearMatchCount, 0);
  assert.deepEqual(
    context?.missedFindings.map((finding) => ({
      sourceKind: finding.sourceKind,
      sourceId: finding.sourceId,
      sourceUrl: finding.sourceUrl,
      reviewerLogin: finding.reviewerLogin,
      file: finding.file,
      line: finding.line,
      summary: finding.summary,
      rationale: finding.rationale,
      url: finding.url,
    })),
    [
      {
        sourceKind: "top_level_review",
        sourceId: "review-actionable",
        sourceUrl: "https://example.test/pr/1#pullrequestreview-actionable",
        reviewerLogin: "coderabbitai[bot]",
        file: null,
        line: null,
        summary: "Bug: retries can reuse stale state and mask the latest failure.",
        rationale: "Bug: retries can reuse stale state and mask the latest failure.",
        url: "https://example.test/pr/1#pullrequestreview-actionable",
      },
    ],
  );
  assert.equal(context?.regressionTestCandidates.length, 0);

  const artifact = JSON.parse(
    await fs.readFile(context?.artifactPath ?? "", "utf8"),
  ) as {
    findings: Array<{
      sourceKind: string;
      sourceId: string;
      summary: string;
      file: string | null;
      line: number | null;
    }>;
    durableGuardrailCandidates: Array<{
      id: string;
      category: string;
      file: string | null;
      line: number | null;
      qualificationReasons: string[];
      provenance: {
        sourceKind: string;
        sourceId: string;
      };
    }>;
    regressionTestCandidates: Array<unknown>;
  };

  assert.deepEqual(artifact.findings.map((finding) => ({
    sourceKind: finding.sourceKind,
    sourceId: finding.sourceId,
    summary: finding.summary,
    file: finding.file,
    line: finding.line,
  })), [
    {
      sourceKind: "top_level_review",
      sourceId: "review-actionable",
      summary: "Bug: retries can reuse stale state and mask the latest failure.",
      file: null,
      line: null,
    },
  ]);
  assert.deepEqual(
    artifact.durableGuardrailCandidates.map((candidate) => ({
      id: candidate.id,
      category: candidate.category,
      file: candidate.file,
      line: candidate.line,
      qualificationReasons: candidate.qualificationReasons,
      provenance: {
        sourceKind: candidate.provenance.sourceKind,
        sourceId: candidate.provenance.sourceId,
      },
    })),
    [
      {
        id: "reviewer_rubric|top_level_review|bug: retries can reuse stale state and mask the latest failure.",
        category: "reviewer_rubric",
        file: null,
        line: null,
        qualificationReasons: ["missed_by_local_review", "high_confidence", "top_level_review_unanchored", "non_low_severity"],
        provenance: {
          sourceKind: "top_level_review",
          sourceId: "review-actionable",
        },
      },
    ],
  );
  assert.deepEqual(artifact.regressionTestCandidates, []);
});

test("writeExternalReviewMissArtifact derives deterministic regression-test candidates from confirmed misses", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "external-review-miss-test-"));
  const localReviewSummaryPath = path.join(tempDir, "head-deadbeef.md");
  const localReviewFindingsPath = path.join(tempDir, "head-deadbeef.json");
  await fs.writeFile(localReviewSummaryPath, "# summary\n", "utf8");
  await fs.writeFile(
    localReviewFindingsPath,
    `${JSON.stringify({
      actionableFindings: [],
      rootCauseSummaries: [],
    }, null, 2)}\n`,
    "utf8",
  );

  const context = await writeExternalReviewMissArtifact({
    artifactDir: tempDir,
    issueNumber: 63,
    prNumber: 91,
    branch: "codex/issue-63",
    headSha: "deadbeefcafebabe",
    reviewThreads: [
      createReviewThread({
        id: "thread-strong",
        path: "src/auth.ts",
        line: 42,
        comments: {
          nodes: [
            {
              id: "comment-strong",
              body: "This fallback skips the permission guard and lets unauthorized callers update records.",
              createdAt: "2026-03-12T00:00:00Z",
              url: "https://example.test/thread-strong#comment-1",
              author: {
                login: "copilot-pull-request-reviewer",
                typeName: "Bot",
              },
            },
          ],
        },
      }),
      createReviewThread({
        id: "thread-low",
        path: "src/docs.ts",
        line: 10,
        comments: {
          nodes: [
            {
              id: "comment-low",
              body: "Nit: docs wording should be clearer here.",
              createdAt: "2026-03-12T00:01:00Z",
              url: "https://example.test/thread-low#comment-1",
              author: {
                login: "copilot-pull-request-reviewer",
                typeName: "Bot",
              },
            },
          ],
        },
      }),
    ],
    reviewBotLogins: ["copilot-pull-request-reviewer"],
    localReviewSummaryPath,
  });

  assert.ok(context);
  assert.equal(context?.regressionTestCandidates.length, 1);
  assert.equal(context?.regressionTestCandidates[0]?.file, "src/auth.ts");
  assert.match(context?.regressionTestCandidates[0]?.title ?? "", /permission guard/i);

  const artifact = JSON.parse(
    await fs.readFile(context?.artifactPath ?? "", "utf8"),
  ) as {
    durableGuardrailCandidates: Array<{
      category: string;
      title: string;
      qualificationReasons: string[];
      provenance: {
        issueNumber: number;
        prNumber: number;
        headSha: string;
        sourceKind: string;
        sourceId: string;
        sourceThreadId: string;
        sourceArtifactPath: string;
        localReviewSummaryPath: string | null;
        localReviewFindingsPath: string | null;
      };
    }>;
    regressionTestCandidates: Array<{
      id: string;
      file: string;
      line: number;
      sourceKind: string;
      sourceId: string;
      sourceThreadId: string;
      qualificationReasons: string[];
    }>;
  };

  assert.deepEqual(artifact.durableGuardrailCandidates, [
    {
      id: "reviewer_rubric|src/auth.ts|42|this fallback skips the permission guard and lets unauthorized callers update records.",
      category: "reviewer_rubric",
      title: "Promote reviewer rubric guardrail for This fallback skips the permission guard and lets unauthorized callers update records",
      reviewerLogin: "copilot-pull-request-reviewer",
      file: "src/auth.ts",
      line: 42,
      summary: "This fallback skips the permission guard and lets unauthorized callers update records.",
      rationale: "This fallback skips the permission guard and lets unauthorized callers update records.",
      qualificationReasons: ["missed_by_local_review", "high_confidence", "file_scoped", "non_low_severity"],
      provenance: {
        issueNumber: 63,
        prNumber: 91,
        branch: "codex/issue-63",
        headSha: "deadbeefcafebabe",
        sourceKind: "review_thread",
        sourceId: "thread-strong",
        sourceThreadId: "thread-strong",
        sourceUrl: "https://example.test/thread-strong#comment-1",
        sourceArtifactPath: "external-review-misses-head-deadbeefcafe.json",
        localReviewSummaryPath: "head-deadbeef.md",
        localReviewFindingsPath: "head-deadbeef.json",
        matchedLocalReference: null,
        matchReason: "no same-file local-review match",
      },
    },
    {
      id: "regression_test|src/auth.ts|42|this fallback skips the permission guard and lets unauthorized callers update records.",
      category: "regression_test",
      title: "Promote regression-test guardrail for This fallback skips the permission guard and lets unauthorized callers update records",
      reviewerLogin: "copilot-pull-request-reviewer",
      file: "src/auth.ts",
      line: 42,
      summary: "This fallback skips the permission guard and lets unauthorized callers update records.",
      rationale: "This fallback skips the permission guard and lets unauthorized callers update records.",
      qualificationReasons: ["missed_by_local_review", "non_low_severity", "high_confidence", "file_scoped", "line_scoped"],
      provenance: {
        issueNumber: 63,
        prNumber: 91,
        branch: "codex/issue-63",
        headSha: "deadbeefcafebabe",
        sourceKind: "review_thread",
        sourceId: "thread-strong",
        sourceThreadId: "thread-strong",
        sourceUrl: "https://example.test/thread-strong#comment-1",
        sourceArtifactPath: "external-review-misses-head-deadbeefcafe.json",
        localReviewSummaryPath: "head-deadbeef.md",
        localReviewFindingsPath: "head-deadbeef.json",
        matchedLocalReference: null,
        matchReason: "no same-file local-review match",
      },
    },
  ]);

  assert.deepEqual(artifact.regressionTestCandidates, [
    {
      id: "src/auth.ts|42|this fallback skips the permission guard and lets unauthorized callers update records.",
      title: "Add regression coverage for This fallback skips the permission guard and lets unauthorized callers update records",
      file: "src/auth.ts",
      line: 42,
      summary: "This fallback skips the permission guard and lets unauthorized callers update records.",
      rationale: "This fallback skips the permission guard and lets unauthorized callers update records.",
      reviewerLogin: "copilot-pull-request-reviewer",
      sourceKind: "review_thread",
      sourceId: "thread-strong",
      sourceThreadId: "thread-strong",
      sourceUrl: "https://example.test/thread-strong#comment-1",
      qualificationReasons: ["missed_by_local_review", "non_low_severity", "high_confidence", "file_scoped", "line_scoped"],
    },
  ]);
});

test("writeExternalReviewMissArtifact skips persistence when the local review artifact is unavailable", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "external-review-miss-test-"));

  const context = await writeExternalReviewMissArtifact({
    artifactDir: tempDir,
    issueNumber: 58,
    prNumber: 91,
    branch: "codex/issue-58",
    headSha: "deadbeefcafebabe",
    reviewThreads: [createReviewThread()],
    reviewBotLogins: ["copilot-pull-request-reviewer"],
    localReviewSummaryPath: path.join(tempDir, "missing-summary.md"),
  });

  assert.equal(context, null);
});
