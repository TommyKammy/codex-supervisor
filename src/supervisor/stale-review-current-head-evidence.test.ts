import test from "node:test";
import assert from "node:assert/strict";
import { createConfig, createPullRequest, createRecord, createReviewThread } from "../turn-execution-test-helpers";
import { CODEX_CONNECTOR_REVIEW_BOT_LOGIN } from "../codex-connector-tracked-pr-test-helpers";
import {
  buildCurrentHeadCleanCommentResidueEvidence,
  buildCurrentHeadCodexNoMajorSignalEvidence,
  buildCurrentHeadVerificationEvidenceSummary,
} from "./stale-review-current-head-evidence";

test("buildCurrentHeadVerificationEvidenceSummary prefers current-head local CI", () => {
  const headSha = "head-current-local-ci";

  assert.equal(
    buildCurrentHeadVerificationEvidenceSummary({
      config: createConfig({ reviewBotLogins: [CODEX_CONNECTOR_REVIEW_BOT_LOGIN] }),
      record: createRecord({
        last_head_sha: headSha,
        latest_local_ci_result: {
          command: "npm test",
          outcome: "passed",
          head_sha: headSha,
          summary: "Focused current-head verifier passed.",
          ran_at: "2026-06-29T17:13:00Z",
          execution_mode: "shell",
          failure_class: null,
          remediation_target: null,
        },
      }),
      pr: createPullRequest({ headRefOid: headSha }),
      checks: [],
      allowCheckEvidence: false,
    }),
    "Focused current-head verifier passed.",
  );
});

test("buildCurrentHeadCodexNoMajorSignalEvidence accepts reviewed-current-head no-major coverage", () => {
  const headSha = "head-reviewed-no-major";
  const thread = createReviewThread({
    id: "thread-reviewed-no-major",
    comments: {
      nodes: [
        {
          id: "comment-reviewed-no-major",
          body: "P2: Earlier current-head finding.",
          createdAt: "2026-06-29T15:54:04Z",
          url: "https://example.test/pr/137#discussion_reviewed_no_major",
          author: {
            login: CODEX_CONNECTOR_REVIEW_BOT_LOGIN,
            typeName: "Bot",
          },
        },
      ],
    },
  });

  assert.equal(
    buildCurrentHeadCodexNoMajorSignalEvidence({
      record: createRecord({
        last_head_sha: headSha,
        review_wait_started_at: "2026-06-29T17:08:34Z",
        review_wait_head_sha: headSha,
      }),
      pr: createPullRequest({
        headRefOid: headSha,
        configuredBotLatestReviewedCommitSha: headSha,
        configuredBotCurrentHeadCodexSuccessReviewedCommitSha: headSha,
        configuredBotCurrentHeadCodexSuccessObservedAt: "2026-06-29T17:14:09Z",
        configuredBotCurrentHeadObservedAt: "2026-06-29T17:14:09Z",
        configuredBotCurrentHeadObservationSource: "codex_pr_success_comment",
        configuredBotCurrentHeadStatusState: "SUCCESS",
      }),
      reviewThreads: [thread],
      currentConfiguredThreads: [thread],
    }),
    "codex_pr_success_comment_reviewed_current_head",
  );
});

test("buildCurrentHeadCleanCommentResidueEvidence isolates clean comment residue proof", () => {
  const headSha = "head-clean-comment";
  const thread = createReviewThread({
    id: "thread-clean-comment",
    path: "src/current-head.ts",
    line: 42,
    comments: {
      nodes: [
        {
          id: "comment-clean-comment",
          body: "P2: Earlier current-head finding that was superseded by the clean Codex review.",
          createdAt: "2026-06-29T15:54:04Z",
          url: "https://example.test/pr/137#discussion_clean_comment",
          author: {
            login: CODEX_CONNECTOR_REVIEW_BOT_LOGIN,
            typeName: "Bot",
          },
        },
      ],
    },
  });

  assert.equal(
    buildCurrentHeadCleanCommentResidueEvidence({
      config: createConfig({ reviewBotLogins: [CODEX_CONNECTOR_REVIEW_BOT_LOGIN] }),
      record: createRecord({
        last_head_sha: headSha,
        review_wait_started_at: "2026-06-29T17:08:34Z",
        review_wait_head_sha: headSha,
        pre_merge_must_fix_count: 0,
        pre_merge_manual_review_count: 0,
        pre_merge_follow_up_count: 0,
      }),
      pr: createPullRequest({
        headRefOid: headSha,
        mergeStateStatus: "CLEAN",
        mergeable: "MERGEABLE",
        configuredBotTopLevelReviewStrength: null,
        configuredBotLatestReviewedCommitSha: headSha,
        configuredBotCurrentHeadCodexSuccessReviewedCommitSha: headSha,
        configuredBotCurrentHeadCodexSuccessObservedAt: "2026-06-29T17:14:09Z",
      }),
      reviewThreads: [thread],
      currentConfiguredThreads: [thread],
      mustFixReviewThreads: [thread],
    }),
    `codex_current_head_clean_comment:reviewed_commit=${headSha}:observed_at=2026-06-29T17:14:09Z:discounted_threads=1`,
  );
});
