import assert from "node:assert/strict";
import test from "node:test";
import { VERIFIED_CURRENT_HEAD_REPAIR_REVIEW_THREAD_RESIDUE_TARGET } from "./current-head-codex-repair-proof";
import { buildPostPublicationCodexVerificationTimelineArtifacts } from "./turn-execution-post-publication-review";
import {
  createPullRequest,
  createRecord,
  createReviewThread,
} from "./pull-request-state-test-helpers";
import { CODEX_CONNECTOR_REVIEW_BOT_LOGIN } from "./codex-connector-tracked-pr-test-helpers";

test("buildPostPublicationCodexVerificationTimelineArtifacts persists scoped thread keys for blocked normal repair turns", () => {
  const headSha = "head-normal-repair";
  const reviewThread = createReviewThread({
    id: "thread-normal-repair",
    path: "src/review.ts",
    line: 42,
    comments: {
      nodes: [
        {
          id: "comment-normal-repair",
          body: "P2: Verify this repaired finding before merge.",
          createdAt: "2026-06-14T05:22:00Z",
          url: "https://example.test/pr/406#discussion_r406",
          author: {
            login: CODEX_CONNECTOR_REVIEW_BOT_LOGIN,
            typeName: "Bot",
          },
        },
      ],
    },
  });

  const artifacts = buildPostPublicationCodexVerificationTimelineArtifacts({
    record: createRecord({ timeline_artifacts: [] }),
    currentPr: createPullRequest({ headRefOid: headSha }),
    codexVerificationCommand: "npm test -- src/review.test.ts",
    workspaceStatus: { headSha, hasUncommittedChanges: false },
    preRunState: "addressing_review",
    structuredSummary: "Focused verifier passed without relying on summary wording.",
    postRunState: "blocked",
    hasVerifiedNoSourceChangeReviewThreadEvidence: false,
    verifiedNoSourceChangeReviewThreads: [],
    reviewThreadsToProcess: [reviewThread],
    changedFilesAfterPublication: ["src/review.ts"],
    artifactOnlyChangedFilesAfterPublication: [],
  });

  assert.equal(artifacts?.length, 1);
  assert.deepEqual(artifacts?.[0]?.repair_targets, [VERIFIED_CURRENT_HEAD_REPAIR_REVIEW_THREAD_RESIDUE_TARGET]);
  assert.deepEqual(artifacts?.[0]?.processed_review_thread_ids, [`${reviewThread.id}@${headSha}`]);
  assert.deepEqual(artifacts?.[0]?.processed_review_thread_fingerprints, [
    `${reviewThread.id}@${headSha}#comment-normal-repair`,
  ]);
});

test("buildPostPublicationCodexVerificationTimelineArtifacts preserves no-source-change repair targets", () => {
  const headSha = "head-no-source-repair";
  const reviewThread = createReviewThread({
    id: "thread-no-source-repair",
    path: "src/review.ts",
    line: 43,
    comments: {
      nodes: [
        {
          id: "comment-no-source-repair",
          body: "P2: Verify this already-addressed finding before merge.",
          createdAt: "2026-06-14T05:23:00Z",
          url: "https://example.test/pr/406#discussion_r407",
          author: {
            login: CODEX_CONNECTOR_REVIEW_BOT_LOGIN,
            typeName: "Bot",
          },
        },
      ],
    },
  });

  const artifacts = buildPostPublicationCodexVerificationTimelineArtifacts({
    record: createRecord({ timeline_artifacts: [] }),
    currentPr: createPullRequest({ headRefOid: headSha }),
    codexVerificationCommand: "npm test -- src/review.test.ts",
    workspaceStatus: { headSha, hasUncommittedChanges: false },
    preRunState: "local_review_fix",
    structuredSummary: "Focused no-source verifier passed.",
    postRunState: "blocked",
    hasVerifiedNoSourceChangeReviewThreadEvidence: true,
    verifiedNoSourceChangeReviewThreads: [reviewThread],
    reviewThreadsToProcess: [reviewThread],
    changedFilesAfterPublication: [],
    artifactOnlyChangedFilesAfterPublication: [],
  });

  assert.equal(artifacts?.length, 1);
  assert.deepEqual(artifacts?.[0]?.repair_targets, ["verified_no_source_change_review_thread_residue"]);
  assert.deepEqual(artifacts?.[0]?.processed_review_thread_ids, [`${reviewThread.id}@${headSha}`]);
  assert.deepEqual(artifacts?.[0]?.processed_review_thread_fingerprints, [
    `${reviewThread.id}@${headSha}#comment-no-source-repair`,
  ]);
});

test("buildPostPublicationCodexVerificationTimelineArtifacts does not mark unchanged normal turns as current-head repair proof", () => {
  const headSha = "head-unchanged-normal-repair";
  const reviewThread = createReviewThread({
    id: "thread-unchanged-normal-repair",
    path: "src/review.ts",
    line: 44,
    comments: {
      nodes: [
        {
          id: "comment-unchanged-normal-repair",
          body: "P2: Verify this finding before merge.",
          createdAt: "2026-06-15T05:23:00Z",
          url: "https://example.test/pr/406#discussion_r408",
          author: {
            login: CODEX_CONNECTOR_REVIEW_BOT_LOGIN,
            typeName: "Bot",
          },
        },
      ],
    },
  });

  const artifacts = buildPostPublicationCodexVerificationTimelineArtifacts({
    record: createRecord({ timeline_artifacts: [] }),
    currentPr: createPullRequest({ headRefOid: headSha }),
    codexVerificationCommand: "npm test -- src/review.test.ts",
    workspaceStatus: { headSha, hasUncommittedChanges: false },
    preRunState: "addressing_review",
    structuredSummary: "Focused verifier passed without source changes.",
    postRunState: "blocked",
    hasVerifiedNoSourceChangeReviewThreadEvidence: false,
    verifiedNoSourceChangeReviewThreads: [],
    reviewThreadsToProcess: [reviewThread],
    changedFilesAfterPublication: [],
    artifactOnlyChangedFilesAfterPublication: [],
  });

  assert.equal(artifacts?.length, 1);
  assert.equal(artifacts?.[0]?.repair_targets, undefined);
  assert.deepEqual(artifacts?.[0]?.processed_review_thread_ids, [`${reviewThread.id}@${headSha}`]);
  assert.deepEqual(artifacts?.[0]?.processed_review_thread_fingerprints, [
    `${reviewThread.id}@${headSha}#comment-unchanged-normal-repair`,
  ]);
});

test("buildPostPublicationCodexVerificationTimelineArtifacts ignores artifact-only changes for current-head repair proof", () => {
  const headSha = "head-artifact-only-repair";
  const reviewThread = createReviewThread({
    id: "thread-artifact-only-repair",
    path: "src/review.ts",
    line: 45,
    comments: {
      nodes: [
        {
          id: "comment-artifact-only-repair",
          body: "P2: Verify this finding before merge.",
          createdAt: "2026-06-15T05:24:00Z",
          url: "https://example.test/pr/406#discussion_r409",
          author: {
            login: CODEX_CONNECTOR_REVIEW_BOT_LOGIN,
            typeName: "Bot",
          },
        },
      ],
    },
  });

  const artifacts = buildPostPublicationCodexVerificationTimelineArtifacts({
    record: createRecord({ timeline_artifacts: [] }),
    currentPr: createPullRequest({ headRefOid: headSha }),
    codexVerificationCommand: "npm test -- src/review.test.ts",
    workspaceStatus: { headSha, hasUncommittedChanges: false },
    preRunState: "addressing_review",
    structuredSummary: "Focused verifier passed after artifact normalization.",
    postRunState: "blocked",
    hasVerifiedNoSourceChangeReviewThreadEvidence: false,
    verifiedNoSourceChangeReviewThreads: [],
    reviewThreadsToProcess: [reviewThread],
    changedFilesAfterPublication: [
      ".codex-supervisor/issues/2377/issue-journal.md",
      "docs/generated-summary.md",
    ],
    artifactOnlyChangedFilesAfterPublication: ["docs/generated-summary.md"],
  });

  assert.equal(artifacts?.length, 1);
  assert.equal(artifacts?.[0]?.repair_targets, undefined);
  assert.deepEqual(artifacts?.[0]?.processed_review_thread_ids, [`${reviewThread.id}@${headSha}`]);
});

test("buildPostPublicationCodexVerificationTimelineArtifacts requires a clean workspace for current-head repair proof", () => {
  const headSha = "head-dirty-workspace-repair";
  const reviewThread = createReviewThread({
    id: "thread-dirty-workspace-repair",
    path: "src/review.ts",
    line: 46,
    comments: {
      nodes: [
        {
          id: "comment-dirty-workspace-repair",
          body: "P2: Verify this finding before merge.",
          createdAt: "2026-06-15T05:25:00Z",
          url: "https://example.test/pr/406#discussion_r410",
          author: {
            login: CODEX_CONNECTOR_REVIEW_BOT_LOGIN,
            typeName: "Bot",
          },
        },
      ],
    },
  });

  const artifacts = buildPostPublicationCodexVerificationTimelineArtifacts({
    record: createRecord({ timeline_artifacts: [] }),
    currentPr: createPullRequest({ headRefOid: headSha }),
    codexVerificationCommand: "npm test -- src/review.test.ts",
    workspaceStatus: { headSha, hasUncommittedChanges: true },
    preRunState: "addressing_review",
    structuredSummary: "Focused verifier passed with dirty workspace.",
    postRunState: "blocked",
    hasVerifiedNoSourceChangeReviewThreadEvidence: false,
    verifiedNoSourceChangeReviewThreads: [],
    reviewThreadsToProcess: [reviewThread],
    changedFilesAfterPublication: ["src/review.ts"],
    artifactOnlyChangedFilesAfterPublication: [],
  });

  assert.equal(artifacts?.length, 1);
  assert.equal(artifacts?.[0]?.repair_targets, undefined);
  assert.deepEqual(artifacts?.[0]?.processed_review_thread_ids, [`${reviewThread.id}@${headSha}`]);
});

test("buildPostPublicationCodexVerificationTimelineArtifacts keeps source changes from non-review turns out of current-head repair proof", () => {
  const headSha = "head-ci-repair-with-review-threads";
  const reviewThread = createReviewThread({
    id: "thread-ci-repair-with-review-threads",
    path: "src/review.ts",
    line: 47,
    comments: {
      nodes: [
        {
          id: "comment-ci-repair-with-review-threads",
          body: "P2: Verify this finding before merge.",
          createdAt: "2026-06-15T05:26:00Z",
          url: "https://example.test/pr/406#discussion_r411",
          author: {
            login: CODEX_CONNECTOR_REVIEW_BOT_LOGIN,
            typeName: "Bot",
          },
        },
      ],
    },
  });

  const artifacts = buildPostPublicationCodexVerificationTimelineArtifacts({
    record: createRecord({ timeline_artifacts: [] }),
    currentPr: createPullRequest({ headRefOid: headSha }),
    codexVerificationCommand: "npm test -- src/review.test.ts",
    workspaceStatus: { headSha, hasUncommittedChanges: false },
    preRunState: "repairing_ci",
    structuredSummary: "Focused verifier passed after CI repair.",
    postRunState: "blocked",
    hasVerifiedNoSourceChangeReviewThreadEvidence: false,
    verifiedNoSourceChangeReviewThreads: [],
    reviewThreadsToProcess: [reviewThread],
    changedFilesAfterPublication: ["src/unrelated-ci-fix.ts"],
    artifactOnlyChangedFilesAfterPublication: [],
  });

  assert.equal(artifacts?.length, 1);
  assert.equal(artifacts?.[0]?.repair_targets, undefined);
  assert.deepEqual(artifacts?.[0]?.processed_review_thread_ids, [`${reviewThread.id}@${headSha}`]);
});

test("buildPostPublicationCodexVerificationTimelineArtifacts honors custom journal paths when filtering repair sources", () => {
  const headSha = "head-custom-journal-only";
  const reviewThread = createReviewThread({
    id: "thread-custom-journal-only",
    path: "src/review.ts",
    line: 48,
    comments: {
      nodes: [
        {
          id: "comment-custom-journal-only",
          body: "P2: Verify this finding before merge.",
          createdAt: "2026-06-15T05:27:00Z",
          url: "https://example.test/pr/406#discussion_r412",
          author: {
            login: CODEX_CONNECTOR_REVIEW_BOT_LOGIN,
            typeName: "Bot",
          },
        },
      ],
    },
  });

  const artifacts = buildPostPublicationCodexVerificationTimelineArtifacts({
    record: createRecord({ timeline_artifacts: [] }),
    currentPr: createPullRequest({ headRefOid: headSha }),
    codexVerificationCommand: "npm test -- src/review.test.ts",
    workspaceStatus: { headSha, hasUncommittedChanges: false },
    preRunState: "addressing_review",
    structuredSummary: "Focused verifier passed after journal update.",
    postRunState: "blocked",
    hasVerifiedNoSourceChangeReviewThreadEvidence: false,
    verifiedNoSourceChangeReviewThreads: [],
    reviewThreadsToProcess: [reviewThread],
    changedFilesAfterPublication: [".codex-supervisor/custom-journal.md"],
    artifactOnlyChangedFilesAfterPublication: [],
    issueJournalRelativePath: ".codex-supervisor/custom-journal.md",
  });

  assert.equal(artifacts?.length, 1);
  assert.equal(artifacts?.[0]?.repair_targets, undefined);
  assert.deepEqual(artifacts?.[0]?.processed_review_thread_ids, [`${reviewThread.id}@${headSha}`]);
});
