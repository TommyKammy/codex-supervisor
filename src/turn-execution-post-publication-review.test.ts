import assert from "node:assert/strict";
import test from "node:test";
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
    workspaceStatus: { headSha },
    structuredSummary: "Focused repair verifier passed.",
    postRunState: "blocked",
    hasVerifiedNoSourceChangeReviewThreadEvidence: false,
    verifiedNoSourceChangeReviewThreads: [],
    reviewThreadsToProcess: [reviewThread],
  });

  assert.equal(artifacts?.length, 1);
  assert.deepEqual(artifacts?.[0]?.repair_targets, undefined);
  assert.deepEqual(artifacts?.[0]?.processed_review_thread_ids, [`${reviewThread.id}@${headSha}`]);
  assert.deepEqual(artifacts?.[0]?.processed_review_thread_fingerprints, [
    `${reviewThread.id}@${headSha}#comment-normal-repair`,
  ]);
});
