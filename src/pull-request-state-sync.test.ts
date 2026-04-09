import assert from "node:assert/strict";
import test from "node:test";
import {
  syncCopilotReviewRequestObservation,
  syncReviewWaitWindow,
} from "./pull-request-state-sync";
import {
  createConfig,
  createPullRequest,
  createRecord,
} from "./pull-request-state-test-helpers";

test("syncReviewWaitWindow clears the wait window for draft PRs", () => {
  const patch = syncReviewWaitWindow(
    createRecord({
      review_wait_started_at: "2026-03-16T00:00:00Z",
      review_wait_head_sha: "head123",
    }),
    createPullRequest({
      isDraft: true,
    }),
  );

  assert.deepEqual(patch, {
    review_wait_started_at: null,
    review_wait_head_sha: null,
  });
});

test("syncCopilotReviewRequestObservation records an observed time when GitHub omits the request timestamp", () => {
  const patch = syncCopilotReviewRequestObservation(
    createConfig({
      reviewBotLogins: ["copilot-pull-request-reviewer"],
    }),
    createRecord({
      issue_number: 115,
      state: "waiting_ci",
      copilot_review_requested_observed_at: null,
      copilot_review_requested_head_sha: null,
    }),
    createPullRequest({
      number: 115,
      title: "Missing Copilot request timestamp",
      url: "https://example.test/pr/115",
      headRefName: "codex/reopen-issue-115",
      headRefOid: "head-115",
      copilotReviewState: "requested",
      copilotReviewRequestedAt: null,
      copilotReviewArrivedAt: null,
    }),
  );

  assert.equal(patch.copilot_review_requested_head_sha, "head-115");
  assert.ok(patch.copilot_review_requested_observed_at);
  assert.equal(Number.isNaN(Date.parse(patch.copilot_review_requested_observed_at ?? "")), false);
});

test("syncCopilotReviewRequestObservation clears a stale same-head observation once the request is gone", () => {
  const patch = syncCopilotReviewRequestObservation(
    createConfig({
      reviewBotLogins: ["copilot-pull-request-reviewer"],
    }),
    createRecord({
      issue_number: 116,
      state: "waiting_ci",
      copilot_review_requested_observed_at: "2026-03-16T00:00:00Z",
      copilot_review_requested_head_sha: "head-116",
    }),
    createPullRequest({
      number: 116,
      title: "Stale Copilot request observation",
      url: "https://example.test/pr/116",
      headRefName: "codex/reopen-issue-116",
      headRefOid: "head-116",
      copilotReviewState: "not_requested",
      copilotReviewRequestedAt: null,
      copilotReviewArrivedAt: null,
    }),
  );

  assert.deepEqual(patch, {
    copilot_review_requested_observed_at: null,
    copilot_review_requested_head_sha: null,
  });
});
