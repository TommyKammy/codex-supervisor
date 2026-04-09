import test from "node:test";
import assert from "node:assert/strict";
import { derivePostTurnLocalReviewDecision } from "./post-turn-pull-request-policy";
import type { LocalReviewResult } from "./local-review";
import { createConfig, createPullRequest, createRecord } from "./turn-execution-test-helpers";

function createLocalReviewResult(overrides: Partial<LocalReviewResult> = {}): LocalReviewResult {
  return {
    ranAt: "2026-04-09T00:00:00Z",
    summaryPath: "/tmp/reviews/summary.md",
    findingsPath: "/tmp/reviews/findings.json",
    summary: "Local review summary",
    blockerSummary: "medium src/example.ts:20 follow-up needed",
    findingsCount: 1,
    rootCauseCount: 1,
    maxSeverity: "medium",
    verifiedFindingsCount: 1,
    verifiedMaxSeverity: "medium",
    recommendation: "changes_requested",
    degraded: false,
    finalEvaluation: {
      outcome: "follow_up_eligible",
      residualFindings: [],
      mustFixCount: 0,
      manualReviewCount: 0,
      followUpCount: 1,
    },
    rawOutput: "review output",
    ...overrides,
  };
}

test("derivePostTurnLocalReviewDecision keeps follow-up-eligible residuals advisory by default", () => {
  const config = createConfig({
    localReviewEnabled: true,
    localReviewPolicy: "block_merge",
  });
  const record = createRecord();
  const pr = createPullRequest();
  const localReview = createLocalReviewResult();

  const decision = derivePostTurnLocalReviewDecision({
    config,
    record,
    pr,
    localReview,
  });

  assert.equal(decision.recordPatch.state, "draft_pr");
  assert.equal(decision.recordPatch.blocked_reason, null);
  assert.equal(decision.shouldCreateFollowUpIssues, false);
});

test("derivePostTurnLocalReviewDecision requests explicit follow-up issue creation when enabled", () => {
  const config = createConfig({
    localReviewEnabled: true,
    localReviewPolicy: "block_merge",
    localReviewFollowUpIssueCreationEnabled: true,
  });
  const record = createRecord();
  const pr = createPullRequest();
  const localReview = createLocalReviewResult();

  const decision = derivePostTurnLocalReviewDecision({
    config,
    record,
    pr,
    localReview,
  });

  assert.equal(decision.recordPatch.state, "draft_pr");
  assert.equal(decision.shouldCreateFollowUpIssues, true);
});

test("derivePostTurnLocalReviewDecision routes current-head manual-review residuals into same-PR repair when enabled", () => {
  const config = createConfig({
    localReviewEnabled: true,
    localReviewPolicy: "block_merge",
    localReviewManualReviewRepairEnabled: true,
  });
  const record = createRecord();
  const pr = createPullRequest({ reviewDecision: null });
  const localReview = createLocalReviewResult({
    blockerSummary: "medium src/example.ts:20 manual review needed",
    finalEvaluation: {
      outcome: "manual_review_blocked",
      residualFindings: [],
      mustFixCount: 0,
      manualReviewCount: 1,
      followUpCount: 0,
    },
  });

  const decision = derivePostTurnLocalReviewDecision({
    config,
    record,
    pr,
    localReview,
  });

  assert.equal(decision.recordPatch.state, "local_review_fix");
  assert.equal(decision.recordPatch.blocked_reason, null);
  assert.match(decision.recordPatch.last_error ?? "", /same-PR repair pass/i);
  assert.equal(decision.shouldCreateFollowUpIssues, false);
});
