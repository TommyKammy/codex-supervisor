import assert from "node:assert/strict";
import test from "node:test";
import {
  buildChecksFailureContext,
  buildConflictFailureContext,
  buildCurrentHeadLocalReviewPendingFailureContext,
} from "./pull-request-failure-context";
import { GitHubPullRequest, PullRequestCheck } from "./core/types";

function createPullRequest(overrides: Partial<GitHubPullRequest> = {}): GitHubPullRequest {
  return {
    number: 42,
    title: "Test PR",
    url: "https://example.test/pr/42",
    state: "OPEN",
    createdAt: "2026-03-11T14:00:00Z",
    isDraft: false,
    reviewDecision: null,
    mergeStateStatus: "CLEAN",
    mergeable: "MERGEABLE",
    headRefName: "codex/issue-42",
    headRefOid: "deadbeef",
    mergedAt: null,
    ...overrides,
  };
}

test("buildChecksFailureContext ignores cancelled runs", () => {
  const checks: PullRequestCheck[] = [{ name: "merge-queue", state: "CANCELLED", bucket: "cancel", workflow: "CI" }];

  assert.equal(buildChecksFailureContext(createPullRequest(), checks), null);
});

test("buildChecksFailureContext preserves failing-check reporting fields", () => {
  const checks: PullRequestCheck[] = [
    { name: "build", state: "FAILURE", bucket: "fail", workflow: "CI", link: "https://example.test/checks/1" },
    { name: "lint", state: "FAILURE", bucket: "fail", workflow: "CI" },
  ];

  const context = buildChecksFailureContext(createPullRequest(), checks);

  assert.equal(context?.category, "checks");
  assert.equal(context?.summary, "PR #42 has failing checks.");
  assert.equal(context?.signature, "build:fail|lint:fail");
  assert.equal(context?.command, "gh pr checks");
  assert.deepEqual(context?.details, [
    "build (fail/FAILURE) https://example.test/checks/1",
    "lint (fail/FAILURE)",
  ]);
  assert.equal(context?.url, "https://example.test/pr/42");
});

test("buildConflictFailureContext preserves merge-conflict reporting fields", () => {
  const context = buildConflictFailureContext(createPullRequest({ mergeStateStatus: "DIRTY" }));

  assert.equal(context.category, "conflict");
  assert.equal(context.summary, "PR #42 has merge conflicts and needs a base-branch integration pass.");
  assert.equal(context.signature, "dirty:deadbeef");
  assert.equal(context.command, "git fetch origin && git merge origin/<default-branch>");
  assert.deepEqual(context.details, ["mergeStateStatus=DIRTY"]);
  assert.equal(context.url, "https://example.test/pr/42");
});

test("buildCurrentHeadLocalReviewPendingFailureContext preserves missing-review reporting fields", () => {
  const context = buildCurrentHeadLocalReviewPendingFailureContext({
    pr: createPullRequest({ headRefOid: "head-new" }),
    record: { local_review_head_sha: null },
  });

  assert.equal(context.category, "blocked");
  assert.equal(context.summary, "Current PR head is still waiting for a local review run.");
  assert.equal(context.signature, "local-review-missing:head-new");
  assert.equal(context.command, null);
  assert.deepEqual(context.details, [
    "reviewed_head_sha=none",
    "pr_head_sha=head-new",
    "status=missing",
    "summary=awaiting_local_review",
  ]);
  assert.equal(context.url, null);
});

test("buildCurrentHeadLocalReviewPendingFailureContext preserves stale-review reporting fields", () => {
  const context = buildCurrentHeadLocalReviewPendingFailureContext({
    pr: createPullRequest({ headRefOid: "head-new" }),
    record: { local_review_head_sha: "head-old" },
  });

  assert.equal(context.category, "blocked");
  assert.equal(context.summary, "Current PR head is still waiting for a fresh local review run.");
  assert.equal(context.signature, "local-review-stale:head-old:head-new");
  assert.equal(context.command, null);
  assert.deepEqual(context.details, [
    "reviewed_head_sha=head-old",
    "pr_head_sha=head-new",
    "status=stale",
    "summary=awaiting_local_review",
  ]);
  assert.equal(context.url, null);
});
