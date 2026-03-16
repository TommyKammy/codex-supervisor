import assert from "node:assert/strict";
import test from "node:test";
import { localReviewHasActionableFindings, shouldRunLocalReview } from "./local-review";
import { createConfig, createPullRequest } from "./local-review-test-helpers";

test("shouldRunLocalReview covers draft and ready policy gating combinations", () => {
  const cases: Array<{
    name: string;
    config: ReturnType<typeof createConfig>;
    recordHead: string | null;
    pr: ReturnType<typeof createPullRequest>;
    expected: boolean;
  }> = [
    {
      name: "draft PR runs review before first ready transition across policies",
      config: createConfig({ localReviewPolicy: "advisory" }),
      recordHead: null,
      pr: createPullRequest({ isDraft: true, headRefOid: "newhead" }),
      expected: true,
    },
    {
      name: "draft PR does not rerun when the head sha is unchanged",
      config: createConfig({ localReviewPolicy: "block_ready" }),
      recordHead: "samehead",
      pr: createPullRequest({ isDraft: true, headRefOid: "samehead" }),
      expected: false,
    },
    {
      name: "ready PR reruns on head updates when block_merge is enabled",
      config: createConfig({ localReviewPolicy: "block_merge" }),
      recordHead: "oldhead",
      pr: createPullRequest({ isDraft: false, headRefOid: "newhead" }),
      expected: true,
    },
    {
      name: "ready PR does not rerun on head updates in advisory mode",
      config: createConfig({ localReviewPolicy: "advisory" }),
      recordHead: "oldhead",
      pr: createPullRequest({ isDraft: false, headRefOid: "newhead" }),
      expected: false,
    },
    {
      name: "ready PR does not rerun on head updates in block_ready mode",
      config: createConfig({ localReviewPolicy: "block_ready" }),
      recordHead: "oldhead",
      pr: createPullRequest({ isDraft: false, headRefOid: "newhead" }),
      expected: false,
    },
    {
      name: "local review disabled suppresses draft gating",
      config: createConfig({ localReviewEnabled: false, localReviewPolicy: "block_merge" }),
      recordHead: null,
      pr: createPullRequest({ isDraft: true, headRefOid: "newhead" }),
      expected: false,
    },
  ];

  for (const testCase of cases) {
    const record = { local_review_head_sha: testCase.recordHead };
    assert.equal(shouldRunLocalReview(testCase.config, record, testCase.pr), testCase.expected, testCase.name);
  }
});

test("localReviewHasActionableFindings requires the current head and a non-ready result", () => {
  const pr = createPullRequest({ headRefOid: "newhead123" });

  assert.equal(localReviewHasActionableFindings({
    local_review_head_sha: "newhead123",
    local_review_findings_count: 0,
    local_review_recommendation: "ready",
  }, pr), false);

  assert.equal(localReviewHasActionableFindings({
    local_review_head_sha: "oldhead456",
    local_review_findings_count: 2,
    local_review_recommendation: "changes_requested",
  }, pr), false);

  assert.equal(localReviewHasActionableFindings({
    local_review_head_sha: "newhead123",
    local_review_findings_count: 1,
    local_review_recommendation: "ready",
  }, pr), true);

  assert.equal(localReviewHasActionableFindings({
    local_review_head_sha: "newhead123",
    local_review_findings_count: 0,
    local_review_recommendation: "changes_requested",
  }, pr), true);
});
