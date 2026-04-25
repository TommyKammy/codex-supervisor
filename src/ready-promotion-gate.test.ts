import test from "node:test";
import assert from "node:assert/strict";
import { createFailureContext, createPullRequest, createRecord } from "./turn-execution-test-helpers";
import { deriveReadyPromotionPathHygieneDecision } from "./ready-promotion-gate";

const SAMPLE_UNIX_WORKSTATION_PATH = `/${"home"}/alice/dev/private-repo`;

test("deriveReadyPromotionPathHygieneDecision routes actionable path hygiene blockers to repair", () => {
  const record = createRecord({ state: "draft_pr" });
  const pr = createPullRequest({ isDraft: true, headRefOid: "head-116" });
  const failureContext = {
    ...createFailureContext("Tracked durable artifacts failed workstation-local path hygiene before marking PR #116 ready."),
    signature: "workstation-local-path-hygiene-failed",
    command: "npm run verify:paths",
    details: [`docs/guide.md:1 matched /${"home"}/ via "${SAMPLE_UNIX_WORKSTATION_PATH}"`],
  };

  const decision = deriveReadyPromotionPathHygieneDecision({
    record,
    pr,
    gate: {
      ok: false,
      failureContext,
      actionablePublishableFilePaths: ["docs/guide.md"],
    },
    fallbackSummary: "fallback",
    applyFailureSignature: (_record, context) => ({
      last_failure_signature: context?.signature ?? null,
      repeated_failure_signature_count: context ? 1 : 0,
    }),
  });

  assert.equal(decision.kind, "repair");
  assert.equal(decision.recordPatch.state, "repairing_ci");
  assert.equal(decision.recordPatch.blocked_reason, null);
  assert.equal(decision.recordPatch.last_failure_signature, "workstation-local-path-hygiene-failed");
  assert.equal(decision.comment.remediationTarget, "repair_already_queued");
  assert.match(decision.failureContext.summary, /will retry a repair turn/i);
  assert.deepEqual(decision.recordPatch.timeline_artifacts, [
    {
      type: "path_hygiene_result",
      gate: "workstation_local_path_hygiene",
      command: "npm run verify:paths",
      head_sha: "head-116",
      outcome: "repair_queued",
      remediation_target: "repair_already_queued",
      next_action: "wait_for_repair_turn",
      summary: decision.failureContext.summary,
      recorded_at: decision.failureContext.updated_at,
      repair_targets: ["docs/guide.md"],
    },
  ]);
});

test("deriveReadyPromotionPathHygieneDecision falls back to manual review for non-actionable blockers", () => {
  const record = createRecord({ state: "draft_pr" });
  const pr = createPullRequest({ isDraft: true, headRefOid: "head-116" });
  const failureContext = {
    ...createFailureContext("Tracked durable artifacts failed workstation-local path hygiene before marking PR #116 ready."),
    signature: "workstation-local-path-hygiene-failed",
    command: "npm run verify:paths",
    details: [`docs/guide.md:1 matched /${"home"}/ via "${SAMPLE_UNIX_WORKSTATION_PATH}"`],
  };

  const decision = deriveReadyPromotionPathHygieneDecision({
    record,
    pr,
    gate: {
      ok: false,
      failureContext,
      actionablePublishableFilePaths: [],
    },
    fallbackSummary: "fallback",
    applyFailureSignature: (_record, context) => ({
      last_failure_signature: context?.signature ?? null,
      repeated_failure_signature_count: context ? 1 : 0,
    }),
  });

  assert.equal(decision.kind, "manual_review");
  assert.equal(decision.recordPatch.state, "blocked");
  assert.equal(decision.recordPatch.blocked_reason, "verification");
  assert.equal(decision.recordPatch.last_failure_signature, "workstation-local-path-hygiene-failed");
  assert.equal(decision.comment.remediationTarget, "manual_review");
  assert.match(decision.recordPatch.last_error ?? "", /Tracked durable artifacts failed/);
  assert.deepEqual(decision.recordPatch.timeline_artifacts, [
    {
      type: "path_hygiene_result",
      gate: "workstation_local_path_hygiene",
      command: "npm run verify:paths",
      head_sha: "head-116",
      outcome: "failed",
      remediation_target: "manual_review",
      next_action: "operator_manual_review",
      summary: failureContext.summary,
      recorded_at: failureContext.updated_at,
    },
  ]);
});
