import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import assert from "node:assert/strict";
import test from "node:test";
import {
  classifyExternalReviewFinding,
  collectExternalReviewSignals,
  loadRelevantExternalReviewMissPatterns,
  normalizeExternalReviewFinding,
  writeExternalReviewMissArtifact,
} from "./external-review-misses";
import { loadLocalReviewArtifact } from "./external-review-local-artifact-io";
import { IssueComment, PullRequestReview, ReviewThread } from "./types";

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

test("collectExternalReviewSignals normalizes thread, top-level review, and issue comment sources through one shared model", () => {
  const signals = collectExternalReviewSignals({
    reviewThreads: [createReviewThread()],
    reviews: [createTopLevelReview()],
    issueComments: [createIssueComment()],
    reviewBotLogins: ["copilot-pull-request-reviewer", "coderabbitai[bot]"],
  });

  assert.deepEqual(
    signals.map((signal) => ({
      sourceKind: signal.sourceKind,
      sourceId: signal.sourceId,
      file: signal.file,
      line: signal.line,
      threadId: signal.threadId,
    })),
    [
      {
        sourceKind: "review_thread",
        sourceId: "thread-1",
        file: "src/auth.ts",
        line: 42,
        threadId: "thread-1",
      },
      {
        sourceKind: "top_level_review",
        sourceId: "review-1",
        file: null,
        line: null,
        threadId: null,
      },
      {
        sourceKind: "issue_comment",
        sourceId: "issue-comment-1",
        file: null,
        line: null,
        threadId: null,
      },
    ],
  );
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

test("classifyExternalReviewFinding marks same-hunk findings as matched even with low text overlap", () => {
  const normalized = normalizeExternalReviewFinding(
    createReviewThread({
      path: "src/auth.ts",
      line: 44,
      comments: {
        nodes: [
          {
            id: "comment-1",
            body: "The fallback write runs before the authorization check in this branch.",
            createdAt: "2026-03-12T00:00:00Z",
            url: "https://example.test/thread-1#comment-1",
            author: {
              login: "copilot-pull-request-reviewer",
              typeName: "Bot",
            },
          },
        ],
      },
    }),
    ["copilot-pull-request-reviewer"],
  );
  assert.ok(normalized);

  const classified = classifyExternalReviewFinding(normalized, {
    actionableFindings: [
      {
        title: "Authorization check missing in a nearby helper",
        body: "This branch runs the fallback write before the authorization check and capability gate.",
        file: "src/auth.ts",
        start: 60,
        end: 64,
        severity: "medium",
      },
      {
        title: "Guard ordering bug in fallback branch",
        body: "Delay the persistence path until the capability gate passes.",
        file: "src/auth.ts",
        start: 41,
        end: 46,
        severity: "medium",
      },
    ],
    rootCauseSummaries: [],
  });

  assert.equal(classified.classification, "matched");
  assert.equal(classified.matchedLocalReference, "actionable:2");
  assert.match(classified.matchReason, /^same-hunk/);
  assert.match(classified.matchReason, /\bsame_hunk=yes\b/);
});

test("classifyExternalReviewFinding keeps nearby same-file findings as near_match with stable match reasons", () => {
  const normalized = normalizeExternalReviewFinding(
    createReviewThread({
      path: "src/auth.ts",
      line: 42,
      comments: {
        nodes: [
          {
            id: "comment-1",
            body: "Fallback writes bypass authorization and can update records without the guard.",
            createdAt: "2026-03-12T00:00:00Z",
            url: "https://example.test/thread-1#comment-1",
            author: {
              login: "copilot-pull-request-reviewer",
              typeName: "Bot",
            },
          },
        ],
      },
    }),
    ["copilot-pull-request-reviewer"],
  );
  assert.ok(normalized);

  const classified = classifyExternalReviewFinding(normalized, {
    actionableFindings: [
      {
        title: "Nearby authorization concern",
        body: "Capability gate ordering is wrong in this helper path.",
        file: "src/auth.ts",
        start: 50,
        end: 54,
        severity: "medium",
      },
    ],
    rootCauseSummaries: [],
  });

  assert.equal(classified.classification, "near_match");
  assert.equal(classified.matchedLocalReference, "actionable:1");
  assert.equal(classified.matchReason, "same-file overlap=0.11 line_distance=8 same_hunk=no");
});

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
    headSha: string;
    reusableMissPatterns: Array<{ file: string; summary: string }>;
    counts: { missedByLocalReview: number };
    findings: Array<{ classification: string; reviewerLogin: string; file: string | null; line: number | null }>;
  };
  assert.equal(artifact.headSha, "deadbeefcafebabe");
  assert.equal(artifact.counts.missedByLocalReview, 1);
  assert.equal(artifact.reusableMissPatterns.length, 1);
  assert.equal(artifact.reusableMissPatterns[0]?.file, "src/auth.ts");
  assert.match(artifact.reusableMissPatterns[0]?.summary ?? "", /permission guard/i);
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
      file: finding.file,
      line: finding.line,
    })),
    [
      { sourceKind: "review_thread", file: "src/auth.ts", line: 42 },
      { sourceKind: "top_level_review", file: null, line: null },
      { sourceKind: "issue_comment", file: null, line: null },
    ],
  );
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
        sourceArtifactPath: context?.artifactPath ?? "",
        localReviewSummaryPath,
        localReviewFindingsPath,
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
      qualificationReasons: ["missed_by_local_review", "high_confidence", "file_scoped", "non_low_severity", "line_scoped"],
      provenance: {
        issueNumber: 63,
        prNumber: 91,
        branch: "codex/issue-63",
        headSha: "deadbeefcafebabe",
        sourceKind: "review_thread",
        sourceId: "thread-strong",
        sourceThreadId: "thread-strong",
        sourceUrl: "https://example.test/thread-strong#comment-1",
        sourceArtifactPath: context?.artifactPath ?? "",
        localReviewSummaryPath,
        localReviewFindingsPath,
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

test("loadRelevantExternalReviewMissPatterns keeps relevant historical misses ordered and bounded", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "external-review-rubric-test-"));
  await fs.writeFile(
    path.join(tempDir, "external-review-misses-head-oldest.json"),
    JSON.stringify({
      branch: "codex/issue-61",
      headSha: "oldesthead",
      generatedAt: "2026-03-10T00:00:00Z",
      reusableMissPatterns: [
        {
          fingerprint: "src/auth.ts|permission",
          reviewerLogin: "copilot-pull-request-reviewer",
          file: "src/auth.ts",
          line: 10,
          summary: "Old duplicate that should lose to a newer artifact.",
          rationale: "Older duplicate rationale.",
          sourceArtifactPath: path.join(tempDir, "external-review-misses-head-oldest.json"),
          sourceHeadSha: "oldesthead",
          lastSeenAt: "2026-03-10T00:00:00Z",
        },
      ],
    }),
    "utf8",
  );
  await fs.writeFile(
    path.join(tempDir, "external-review-misses-head-middle.json"),
    JSON.stringify({
      branch: "codex/issue-61",
      headSha: "middlehead",
      generatedAt: "2026-03-11T00:00:00Z",
      reusableMissPatterns: [
        {
          fingerprint: "src/auth.ts|permission",
          reviewerLogin: "copilot-pull-request-reviewer",
          file: "src/auth.ts",
          line: 42,
          summary: "Permission guard is bypassed.",
          rationale: "Check the permission guard before the fallback write path.",
          sourceArtifactPath: path.join(tempDir, "external-review-misses-head-middle.json"),
          sourceHeadSha: "middlehead",
          lastSeenAt: "2026-03-11T00:00:00Z",
        },
        {
          fingerprint: "src/retry.ts|state",
          reviewerLogin: "copilot-pull-request-reviewer",
          file: "src/retry.ts",
          line: 18,
          summary: "Retry path can reuse stale state.",
          rationale: "Reinitialize state on retry.",
          sourceArtifactPath: path.join(tempDir, "external-review-misses-head-middle.json"),
          sourceHeadSha: "middlehead",
          lastSeenAt: "2026-03-11T00:00:00Z",
        },
      ],
    }),
    "utf8",
  );
  await fs.writeFile(
    path.join(tempDir, "external-review-misses-head-newest.json"),
    JSON.stringify({
      branch: "codex/issue-61",
      headSha: "newesthead",
      generatedAt: "2026-03-12T00:00:00Z",
      reusableMissPatterns: [
        {
          fingerprint: "src/api.ts|contract",
          reviewerLogin: "copilot-pull-request-reviewer",
          file: "src/api.ts",
          line: 88,
          summary: "Response omits a required field.",
          rationale: "Preserve required fields in the API response.",
          sourceArtifactPath: path.join(tempDir, "external-review-misses-head-newest.json"),
          sourceHeadSha: "newesthead",
          lastSeenAt: "2026-03-12T00:00:00Z",
        },
        {
          fingerprint: "src/ignored.ts|unrelated",
          reviewerLogin: "copilot-pull-request-reviewer",
          file: "src/ignored.ts",
          line: 5,
          summary: "Unrelated miss should not be injected.",
          rationale: "This file is not part of the current diff.",
          sourceArtifactPath: path.join(tempDir, "external-review-misses-head-newest.json"),
          sourceHeadSha: "newesthead",
          lastSeenAt: "2026-03-12T00:00:00Z",
        },
      ],
    }),
    "utf8",
  );

  const patterns = await loadRelevantExternalReviewMissPatterns({
    artifactDir: tempDir,
    branch: "codex/issue-61",
    currentHeadSha: "currenthead",
    changedFiles: ["src/api.ts", "src/auth.ts", "src/retry.ts"],
    limit: 2,
  });

  assert.deepEqual(
    patterns.map((pattern) => ({ file: pattern.file, summary: pattern.summary, lastSeenAt: pattern.lastSeenAt })),
    [
      {
        file: "src/api.ts",
        summary: "Response omits a required field.",
        lastSeenAt: "2026-03-12T00:00:00Z",
      },
      {
        file: "src/auth.ts",
        summary: "Permission guard is bypassed.",
        lastSeenAt: "2026-03-11T00:00:00Z",
      },
    ],
  );
});

test("loadRelevantExternalReviewMissPatterns reads repo-committed durable guardrails when local artifacts are absent", async () => {
  const workspaceDir = await fs.mkdtemp(path.join(os.tmpdir(), "external-review-durable-guardrails-test-"));
  const durableGuardrailPath = path.join(workspaceDir, "docs", "shared-memory", "external-review-guardrails.json");
  await fs.mkdir(path.dirname(durableGuardrailPath), { recursive: true });
  await fs.writeFile(
    durableGuardrailPath,
    JSON.stringify({
      version: 1,
      patterns: [
        {
          fingerprint: "src/auth.ts|permission",
          reviewerLogin: "copilot-pull-request-reviewer",
          file: "src/auth.ts",
          line: 42,
          summary: "Permission guard is bypassed.",
          rationale: "Check the permission guard before the fallback write path.",
          sourceArtifactPath: "external-review-misses-head-middle.json",
          sourceHeadSha: "middlehead",
          lastSeenAt: "2026-03-11T00:00:00Z",
        },
      ],
    }),
    "utf8",
  );

  const patterns = await loadRelevantExternalReviewMissPatterns({
    artifactDir: path.join(workspaceDir, ".local", "reviews"),
    branch: "codex/issue-61",
    currentHeadSha: "currenthead",
    changedFiles: ["src/auth.ts"],
    limit: 3,
    workspacePath: workspaceDir,
  });

  assert.deepEqual(
    patterns.map((pattern) => ({ file: pattern.file, summary: pattern.summary, lastSeenAt: pattern.lastSeenAt })),
    [
      {
        file: "src/auth.ts",
        summary: "Permission guard is bypassed.",
        lastSeenAt: "2026-03-11T00:00:00Z",
      },
    ],
  );
});

test("loadRelevantExternalReviewMissPatterns returns an empty list when durable guardrail files are absent or blank", async () => {
  const workspaceDir = await fs.mkdtemp(path.join(os.tmpdir(), "external-review-durable-guardrails-empty-test-"));

  const absent = await loadRelevantExternalReviewMissPatterns({
    artifactDir: path.join(workspaceDir, ".local", "reviews"),
    branch: "codex/issue-61",
    currentHeadSha: "currenthead",
    changedFiles: ["src/auth.ts"],
    workspacePath: workspaceDir,
  });
  assert.deepEqual(absent, []);

  const durableGuardrailPath = path.join(workspaceDir, "docs", "shared-memory", "external-review-guardrails.json");
  await fs.mkdir(path.dirname(durableGuardrailPath), { recursive: true });
  await fs.writeFile(durableGuardrailPath, "", "utf8");

  const blank = await loadRelevantExternalReviewMissPatterns({
    artifactDir: path.join(workspaceDir, ".local", "reviews"),
    branch: "codex/issue-61",
    currentHeadSha: "currenthead",
    changedFiles: ["src/auth.ts"],
    workspacePath: workspaceDir,
  });
  assert.deepEqual(blank, []);
});

test("loadRelevantExternalReviewMissPatterns validates and orders durable guardrails deterministically", async () => {
  const workspaceDir = await fs.mkdtemp(path.join(os.tmpdir(), "external-review-durable-guardrails-ordered-test-"));
  const durableGuardrailPath = path.join(workspaceDir, "docs", "shared-memory", "external-review-guardrails.json");
  await fs.mkdir(path.dirname(durableGuardrailPath), { recursive: true });
  await fs.writeFile(
    durableGuardrailPath,
    JSON.stringify({
      version: 1,
      patterns: [
        {
          fingerprint: "src/retry.ts|later",
          reviewerLogin: "copilot-pull-request-reviewer",
          file: "src/retry.ts",
          line: 15,
          summary: "Retry loop never stops on fatal errors.",
          rationale: "Exit the retry loop once the fatal predicate matches.",
          sourceArtifactPath: "external-review-misses-head-newer.json",
          sourceHeadSha: "newerhead",
          lastSeenAt: "2026-03-09T00:00:00Z",
        },
        {
          fingerprint: "src/auth.ts|permission",
          reviewerLogin: "copilot-pull-request-reviewer",
          file: "src/auth.ts",
          line: 42,
          summary: "Permission guard is bypassed.",
          rationale: "Check the permission guard before the fallback write path.",
          sourceArtifactPath: "external-review-misses-head-new.json",
          sourceHeadSha: "newhead",
          lastSeenAt: "2026-03-11T00:00:00Z",
        },
        {
          fingerprint: "src/api.ts|required-field",
          reviewerLogin: "copilot-pull-request-reviewer",
          file: "src/api.ts",
          line: 8,
          summary: "Response omits a required field.",
          rationale: "Return the required field from the success response.",
          sourceArtifactPath: "external-review-misses-head-middle.json",
          sourceHeadSha: "middlehead",
          lastSeenAt: "2026-03-10T00:00:00Z",
        },
      ],
    }),
    "utf8",
  );

  const patterns = await loadRelevantExternalReviewMissPatterns({
    artifactDir: path.join(workspaceDir, ".local", "reviews"),
    branch: "codex/issue-61",
    currentHeadSha: "currenthead",
    changedFiles: ["src/api.ts", "src/auth.ts", "src/retry.ts"],
    limit: 2,
    workspacePath: workspaceDir,
  });

  assert.deepEqual(
    patterns.map((pattern) => ({
      fingerprint: pattern.fingerprint,
      file: pattern.file,
      lastSeenAt: pattern.lastSeenAt,
      sourceHeadSha: pattern.sourceHeadSha,
    })),
    [
      {
        fingerprint: "src/auth.ts|permission",
        file: "src/auth.ts",
        lastSeenAt: "2026-03-11T00:00:00Z",
        sourceHeadSha: "newhead",
      },
      {
        fingerprint: "src/api.ts|required-field",
        file: "src/api.ts",
        lastSeenAt: "2026-03-10T00:00:00Z",
        sourceHeadSha: "middlehead",
      },
    ],
  );
});

test("loadRelevantExternalReviewMissPatterns rejects durable guardrails with an unsupported schema version", async () => {
  const workspaceDir = await fs.mkdtemp(path.join(os.tmpdir(), "external-review-durable-guardrails-invalid-test-"));
  const durableGuardrailPath = path.join(workspaceDir, "docs", "shared-memory", "external-review-guardrails.json");
  await fs.mkdir(path.dirname(durableGuardrailPath), { recursive: true });
  await fs.writeFile(
    durableGuardrailPath,
    JSON.stringify({
      version: 2,
      patterns: [],
    }),
    "utf8",
  );

  await assert.rejects(
    () => loadRelevantExternalReviewMissPatterns({
      artifactDir: path.join(workspaceDir, ".local", "reviews"),
      branch: "codex/issue-61",
      currentHeadSha: "currenthead",
      changedFiles: ["src/auth.ts"],
      workspacePath: workspaceDir,
    }),
    /unsupported schema version 2; expected version 1/,
  );
});

test("loadRelevantExternalReviewMissPatterns rejects malformed committed durable guardrails even when no files changed", async () => {
  const workspaceDir = await fs.mkdtemp(path.join(os.tmpdir(), "external-review-durable-guardrails-invalid-no-files-test-"));
  const durableGuardrailPath = path.join(workspaceDir, "docs", "shared-memory", "external-review-guardrails.json");
  await fs.mkdir(path.dirname(durableGuardrailPath), { recursive: true });
  await fs.writeFile(
    durableGuardrailPath,
    JSON.stringify({
      version: 1,
      patterns: [
        {
          fingerprint: "",
          reviewerLogin: "copilot-pull-request-reviewer",
          file: "src/auth.ts",
          line: 42,
          summary: "Permission guard is bypassed.",
          rationale: "Check the permission guard before the fallback write path.",
          sourceArtifactPath: "external-review-misses-head-new.json",
          sourceHeadSha: "newhead",
          lastSeenAt: "2026-03-11T00:00:00Z",
        },
      ],
    }),
    "utf8",
  );

  await assert.rejects(
    () => loadRelevantExternalReviewMissPatterns({
      artifactDir: path.join(workspaceDir, ".local", "reviews"),
      branch: "codex/issue-61",
      currentHeadSha: "currenthead",
      changedFiles: [],
      workspacePath: workspaceDir,
    }),
    /Invalid durable external review guardrails in .*external-review-guardrails\.json: patterns\[0\]\.fingerprint must be a non-empty string\./,
  );
});

test("loadRelevantExternalReviewMissPatterns rejects malformed durable guardrail fields and trims identifier-like strings", async () => {
  const workspaceDir = await fs.mkdtemp(path.join(os.tmpdir(), "external-review-durable-guardrails-strict-test-"));
  const durableGuardrailPath = path.join(workspaceDir, "docs", "shared-memory", "external-review-guardrails.json");
  await fs.mkdir(path.dirname(durableGuardrailPath), { recursive: true });

  const buildPattern = (overrides: Record<string, unknown> = {}) => ({
    fingerprint: " src/auth.ts|permission ",
    reviewerLogin: " copilot-pull-request-reviewer ",
    file: " src/auth.ts ",
    line: 42,
    summary: "Permission guard is bypassed.",
    rationale: "Check the permission guard before the fallback write path.",
    sourceArtifactPath: " external-review-misses-head-new.json ",
    sourceHeadSha: " newhead ",
    lastSeenAt: "2026-03-11T00:00:00Z",
    ...overrides,
  });

  const expectInvalidPattern = async (pattern: Record<string, unknown>, message: RegExp) => {
    await fs.writeFile(
      durableGuardrailPath,
      JSON.stringify({
        version: 1,
        patterns: [pattern],
      }),
      "utf8",
    );

    await assert.rejects(
      () => loadRelevantExternalReviewMissPatterns({
        artifactDir: path.join(workspaceDir, ".local", "reviews"),
        branch: "codex/issue-61",
        currentHeadSha: "currenthead",
        changedFiles: ["src/auth.ts"],
        workspacePath: workspaceDir,
      }),
      message,
    );
  };

  await expectInvalidPattern(buildPattern({ line: 0 }), /patterns\[0\]\.line must be an integer >= 1 or null/);
  await expectInvalidPattern(buildPattern({ line: -1 }), /patterns\[0\]\.line must be an integer >= 1 or null/);
  await expectInvalidPattern(buildPattern({ line: 1.5 }), /patterns\[0\]\.line must be an integer >= 1 or null/);
  await expectInvalidPattern(buildPattern({ lastSeenAt: "not-an-iso-timestamp" }), /patterns\[0\]\.lastSeenAt must be an ISO-8601 timestamp/);
  await expectInvalidPattern(buildPattern({ lastSeenAt: "2026-03-11 00:00:00Z" }), /patterns\[0\]\.lastSeenAt must be an ISO-8601 timestamp/);

  await fs.writeFile(
    durableGuardrailPath,
    JSON.stringify({
      version: 1,
      patterns: [buildPattern()],
    }),
    "utf8",
  );

  const patterns = await loadRelevantExternalReviewMissPatterns({
    artifactDir: path.join(workspaceDir, ".local", "reviews"),
    branch: "codex/issue-61",
    currentHeadSha: "currenthead",
    changedFiles: ["src/auth.ts"],
    workspacePath: workspaceDir,
  });

  assert.deepEqual(patterns, [
    {
      fingerprint: "src/auth.ts|permission",
      reviewerLogin: "copilot-pull-request-reviewer",
      file: "src/auth.ts",
      line: 42,
      summary: "Permission guard is bypassed.",
      rationale: "Check the permission guard before the fallback write path.",
      sourceArtifactPath: "external-review-misses-head-new.json",
      sourceHeadSha: "newhead",
      lastSeenAt: "2026-03-11T00:00:00Z",
    },
  ]);
});

test("repo-committed durable external-review guardrails teach stable anchors for drift-prone line assertions", async () => {
  const repoRoot = path.resolve(__dirname, "..");
  const patterns = await loadRelevantExternalReviewMissPatterns({
    artifactDir: path.join(repoRoot, ".local", "reviews"),
    branch: "codex/issue-203",
    currentHeadSha: "currenthead",
    changedFiles: ["src/local-review.test.ts"],
    limit: 10,
    workspacePath: repoRoot,
  });

  assert.deepEqual(
    patterns.filter((pattern) => pattern.fingerprint === "src/local-review.test.ts|avoid-drift-prone-line-coupling"),
    [
      {
        fingerprint: "src/local-review.test.ts|avoid-drift-prone-line-coupling",
        reviewerLogin: "copilot-pull-request-reviewer",
        file: "src/local-review.test.ts",
        line: null,
        summary:
          "Flag tests or promoted guardrails that hard-code exact source line numbers when a stable behavior, identifier, or nearby intent anchor would verify the same invariant.",
        rationale:
          "Source lines drift during refactors. Keep exact line assertions only when the source location itself is the intended contract, such as user-visible diagnostics or mappings.",
        sourceArtifactPath: "promoted-from-issue-203",
        sourceHeadSha: "issue-203",
        lastSeenAt: "2026-03-14T00:00:00Z",
      },
    ],
  );
});

test("repo-committed durable external-review guardrails prefer the real behavioral boundary over adjacent anchors", async () => {
  const repoRoot = path.resolve(__dirname, "..");
  const patterns = await loadRelevantExternalReviewMissPatterns({
    artifactDir: path.join(repoRoot, ".local", "reviews"),
    branch: "codex/issue-204",
    currentHeadSha: "currenthead",
    changedFiles: ["src/local-review-prompt.ts"],
    limit: 10,
    workspacePath: repoRoot,
  });

  assert.deepEqual(
    patterns.filter((pattern) => pattern.fingerprint === "src/local-review-prompt.ts|anchor-findings-to-real-boundary"),
    [
      {
        fingerprint: "src/local-review-prompt.ts|anchor-findings-to-real-boundary",
        reviewerLogin: "copilot-pull-request-reviewer",
        file: "src/local-review-prompt.ts",
        line: null,
        summary:
          "Flag findings or promoted guardrails that anchor to an earlier or adjacent implementation step when the real behavioral boundary is a later transition or invariant.",
        rationale:
          "Guardrails last longer when they point at the decisive boundary under protection instead of a nearby setup location that refactors can move without changing the behavior.",
        sourceArtifactPath: "promoted-from-issue-204",
        sourceHeadSha: "issue-204",
        lastSeenAt: "2026-03-14T00:00:00Z",
      },
    ],
  );
});
