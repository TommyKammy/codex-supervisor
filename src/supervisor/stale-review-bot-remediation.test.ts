import test from "node:test";
import assert from "node:assert/strict";
import { createConfig, createPullRequest, createRecord } from "../turn-execution-test-helpers";
import {
  CODEX_CONNECTOR_REVIEW_BOT_LOGIN,
  createCodexConnectorTrackedReviewResidueScenario,
} from "../codex-connector-tracked-pr-test-helpers";
import { buildStaleReviewBotRemediation } from "./stale-review-bot-remediation";

test("buildStaleReviewBotRemediation classifies same-head Codex no-major with covered evidence as stale metadata", () => {
  const issueNumber = 110;
  const prNumber = 115;
  const headSha = "c184c41883b831ab6b85bf3467a66a5c01fd49fa";
  const scenario = createCodexConnectorTrackedReviewResidueScenario({
    issueNumber,
    prNumber,
    headSha,
    threadId: "thread-mutation-lock-stale-recovery",
    commentId: "comment-mutation-lock-stale-recovery",
    path: "src/mutation-lock.ts",
    line: 42,
    commentBody: "P1: Verify stale mutation lock recovery only releases the acquired lock instance.",
    discussionUrl: "https://example.test/pr/115#discussion_r115",
    verifiedRepair: {
      summary: "Focused mutation lock verifier passed on the current head.",
      ranAt: "2026-05-21T11:10:00Z",
      command: "npm test -- src/supervisor/stale-review-bot-remediation.test.ts",
      evidenceSource: "codex_turn_timeline_artifact",
    },
    currentHeadNoMajorReview: {
      requestedAt: "2026-05-21T11:05:00Z",
      observedAt: "2026-05-21T11:09:00Z",
    },
  });
  const config = createConfig({ reviewBotLogins: [CODEX_CONNECTOR_REVIEW_BOT_LOGIN] });
  const record = createRecord(scenario.recordPatch);
  const pr = createPullRequest(scenario.pullRequestPatch);

  const remediation = buildStaleReviewBotRemediation({
    config,
    record,
    pr,
    checks: scenario.passingChecks,
    reviewThreads: [scenario.reviewThread],
  });

  assert.equal(remediation?.classification, "verified_current_head_repair_pending_thread_resolution");
  assert.equal(remediation?.codexCurrentHeadReviewState, "observed");
  assert.equal(
    remediation?.missingProbeReason,
    null,
  );
  assert.match(
    remediation?.verificationEvidenceSummary ?? "",
    /Focused mutation lock verifier passed on the current head.;codex_pr_success_comment_after_current_head_request/,
  );
});

test("buildStaleReviewBotRemediation fails closed when covered evidence lacks current-head Codex no-major signal", () => {
  const issueNumber = 110;
  const prNumber = 115;
  const headSha = "c184c41883b831ab6b85bf3467a66a5c01fd49fa";
  const scenario = createCodexConnectorTrackedReviewResidueScenario({
    issueNumber,
    prNumber,
    headSha,
    threadId: "thread-mutation-lock-stale-recovery",
    commentId: "comment-mutation-lock-stale-recovery",
    path: "src/mutation-lock.ts",
    line: 42,
    commentBody: "P1: Verify stale mutation lock recovery only releases the acquired lock instance.",
    discussionUrl: "https://example.test/pr/115#discussion_r115",
    verifiedRepair: {
      summary: "Focused mutation lock verifier passed on the current head.",
      ranAt: "2026-05-21T11:10:00Z",
      command: "npm test -- src/supervisor/stale-review-bot-remediation.test.ts",
      evidenceSource: "codex_turn_timeline_artifact",
    },
  });
  const config = createConfig({ reviewBotLogins: [CODEX_CONNECTOR_REVIEW_BOT_LOGIN] });
  const record = createRecord(scenario.recordPatch);
  const pr = createPullRequest(scenario.pullRequestPatch);

  const remediation = buildStaleReviewBotRemediation({
    config,
    record,
    pr,
    checks: scenario.passingChecks,
    reviewThreads: [scenario.reviewThread],
  });

  assert.equal(remediation?.classification, "unknown_needs_operator");
  assert.equal(remediation?.codexCurrentHeadReviewState, "missing");
  assert.equal(remediation?.missingProbeReason, "current_head_codex_no_major_signal_missing");
});

test("buildStaleReviewBotRemediation fails closed when current-head no-major has unprocessed must-fix threads", () => {
  const issueNumber = 110;
  const prNumber = 115;
  const headSha = "c184c41883b831ab6b85bf3467a66a5c01fd49fa";
  const scenario = createCodexConnectorTrackedReviewResidueScenario({
    issueNumber,
    prNumber,
    headSha,
    threadId: "thread-mutation-lock-stale-recovery",
    commentId: "comment-mutation-lock-stale-recovery",
    path: "src/mutation-lock.ts",
    line: 42,
    commentBody: "P1: Verify stale mutation lock recovery only releases the acquired lock instance.",
    discussionUrl: "https://example.test/pr/115#discussion_r115",
    verifiedRepair: {
      summary: "Focused mutation lock verifier passed on the current head.",
      ranAt: "2026-05-21T11:10:00Z",
      command: "npm test -- src/supervisor/stale-review-bot-remediation.test.ts",
      evidenceSource: "codex_turn_timeline_artifact",
    },
    currentHeadNoMajorReview: {
      requestedAt: "2026-05-21T11:05:00Z",
      observedAt: "2026-05-21T11:09:00Z",
    },
  });
  const config = createConfig({ reviewBotLogins: [CODEX_CONNECTOR_REVIEW_BOT_LOGIN] });
  const record = createRecord({
    ...scenario.recordPatch,
    processed_review_thread_ids: [],
    processed_review_thread_fingerprints: [],
  });
  const pr = createPullRequest(scenario.pullRequestPatch);

  const remediation = buildStaleReviewBotRemediation({
    config,
    record,
    pr,
    checks: scenario.passingChecks,
    reviewThreads: [scenario.reviewThread],
  });

  assert.equal(remediation?.classification, "unresolved_work");
  assert.equal(remediation?.codexCurrentHeadReviewState, "observed");
  assert.equal(remediation?.missingProbeReason, null);
});
