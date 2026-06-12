import test from "node:test";
import assert from "node:assert/strict";
import type { PullRequestCheck } from "./core/types";
import {
  currentHeadConfiguredBotEvidence,
  firstPassingCheckEvidence,
  isCurrentHeadReviewSignalRequestTimeout,
  trackedHandoffExternalProgressEvidence,
} from "./recovery-current-head-evidence";

function check(args: Partial<PullRequestCheck> & Pick<PullRequestCheck, "name" | "bucket" | "state">): PullRequestCheck {
  return {
    workflow: "CI",
    ...args,
  };
}

test("firstPassingCheckEvidence reports deterministic green-check evidence only when all checks pass", () => {
  assert.equal(
    firstPassingCheckEvidence([
      check({ name: "test", bucket: "pass", state: "SUCCESS" }),
      check({ name: "build", bucket: "pass", state: "SUCCESS" }),
    ]),
    "required_checks_green:build",
  );
  assert.equal(firstPassingCheckEvidence([check({ name: "build", bucket: "fail", state: "FAILURE" })]), null);
  assert.equal(firstPassingCheckEvidence([]), null);
});

test("currentHeadConfiguredBotEvidence requires an observed current-head signal with a passing status or no blocking top-level review", () => {
  assert.equal(
    currentHeadConfiguredBotEvidence({
      configuredBotCurrentHeadObservedAt: "2026-06-12T00:00:00Z",
      configuredBotCurrentHeadStatusState: "SUCCESS",
      configuredBotTopLevelReviewStrength: "blocking",
    }),
    "configured_bot_current_head_passed",
  );
  assert.equal(
    currentHeadConfiguredBotEvidence({
      configuredBotCurrentHeadObservedAt: "2026-06-12T00:00:00Z",
      configuredBotCurrentHeadStatusState: null,
      configuredBotTopLevelReviewStrength: "nitpick_only",
    }),
    "configured_bot_current_head_passed",
  );
  assert.equal(
    currentHeadConfiguredBotEvidence({
      configuredBotCurrentHeadObservedAt: null,
      configuredBotCurrentHeadStatusState: "SUCCESS",
      configuredBotTopLevelReviewStrength: "nitpick_only",
    }),
    null,
  );
  assert.equal(
    currentHeadConfiguredBotEvidence({
      configuredBotCurrentHeadObservedAt: "2026-06-12T00:00:00Z",
      configuredBotCurrentHeadStatusState: "FAILURE",
      configuredBotTopLevelReviewStrength: "blocking",
    }),
    null,
  );
});

test("trackedHandoffExternalProgressEvidence prefers green checks before configured-bot evidence after head advance", () => {
  assert.equal(
    trackedHandoffExternalProgressEvidence({
      record: { last_head_sha: "old-head" },
      pr: {
        headRefOid: "new-head",
        configuredBotCurrentHeadObservedAt: "2026-06-12T00:00:00Z",
        configuredBotCurrentHeadStatusState: "SUCCESS",
        configuredBotTopLevelReviewStrength: "nitpick_only",
      },
      checks: [check({ name: "build", bucket: "pass", state: "SUCCESS" })],
    }),
    "required_checks_green:build",
  );
  assert.equal(
    trackedHandoffExternalProgressEvidence({
      record: { last_head_sha: "same-head" },
      pr: {
        headRefOid: "same-head",
        configuredBotCurrentHeadObservedAt: "2026-06-12T00:00:00Z",
        configuredBotCurrentHeadStatusState: "SUCCESS",
        configuredBotTopLevelReviewStrength: "nitpick_only",
      },
      checks: [check({ name: "build", bucket: "pass", state: "SUCCESS" })],
    }),
    null,
  );
});

test("isCurrentHeadReviewSignalRequestTimeout identifies current-head review request timeout patches", () => {
  assert.equal(
    isCurrentHeadReviewSignalRequestTimeout({
      copilot_review_timed_out_at: "2026-06-12T00:00:00Z",
      copilot_review_timeout_action: "request_review_comment",
      copilot_review_timeout_reason: "configured review bot missed current-head review signal",
    }),
    true,
  );
  assert.equal(
    isCurrentHeadReviewSignalRequestTimeout({
      copilot_review_timed_out_at: null,
      copilot_review_timeout_action: "request_review_comment",
      copilot_review_timeout_reason: "configured review bot missed current-head review signal",
    }),
    false,
  );
});
