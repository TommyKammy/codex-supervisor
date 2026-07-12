import assert from "node:assert/strict";
import test from "node:test";

import {
  independentVerificationBlockerSnapshot,
  preserveIndependentVerificationBlockerPatch,
} from "./independent-verification-blocker";
import { createRecord } from "./supervisor-test-helpers";

function verifierFailureContext() {
  return {
    category: "blocked" as const,
    summary: "Independent image verification remains blocked.",
    signature: "verification:images",
    command: "npm run verify:images",
    details: ["structured_blocked_reason=verification"],
    url: null,
    updated_at: "2026-07-12T00:00:00Z",
  };
}

test("independentVerificationBlockerSnapshot carries a queued tracked verifier into dispatch", () => {
  const failureContext = verifierFailureContext();
  const tracked = createRecord({
    issue_number: 2447,
    state: "queued",
    pr_number: 2451,
    blocked_reason: "verification",
    last_error: failureContext.summary,
    last_failure_context: failureContext,
    last_failure_signature: failureContext.signature,
    repeated_failure_signature_count: 3,
    last_blocker_signature: "verification:images",
    repeated_blocker_count: 2,
    blocked_verification_retry_count: 1,
  });

  const snapshot = independentVerificationBlockerSnapshot(tracked);

  assert.ok(snapshot);
  assert.equal(snapshot.lastFailureContext.command, "npm run verify:images");
  assert.equal(snapshot.repeatedFailureSignatureCount, 3);
  assert.equal(snapshot.blockedVerificationRetryCount, 1);
  assert.equal(
    independentVerificationBlockerSnapshot(
      createRecord({ ...tracked, pr_number: null }),
    ),
    null,
  );
});

test("preserveIndependentVerificationBlockerPatch nests a later hard blocker without replacing the verifier", () => {
  const failureContext = verifierFailureContext();
  const snapshot = independentVerificationBlockerSnapshot(
    createRecord({
      issue_number: 2447,
      state: "addressing_review",
      pr_number: 2451,
      blocked_reason: "verification",
      last_error: failureContext.summary,
      last_failure_context: failureContext,
      last_failure_signature: failureContext.signature,
      repeated_failure_signature_count: 3,
      last_blocker_signature: "verification:images",
      repeated_blocker_count: 2,
      blocked_verification_retry_count: 1,
    }),
  );
  assert.ok(snapshot);

  const patch = preserveIndependentVerificationBlockerPatch(snapshot, {
    state: "blocked",
    blocked_reason: "secrets",
    last_error: "A deployment token is required.",
    last_failure_kind: null,
    last_failure_context: {
      category: "blocked",
      summary: "Review repair cannot continue without a token.",
      signature: "secrets:deployment-token",
      command: null,
      details: ["Provide DEPLOY_TOKEN."],
      url: null,
      updated_at: "2026-07-12T00:05:00Z",
    },
  });

  assert.equal(patch.state, "blocked");
  assert.equal(patch.blocked_reason, "verification");
  assert.equal(patch.last_failure_context?.command, "npm run verify:images");
  assert.equal(patch.last_failure_signature, "verification:images");
  assert.equal(patch.repeated_failure_signature_count, 3);
  assert.equal(patch.blocked_verification_retry_count, 1);
  assert.match(patch.last_error ?? "", /deployment token/i);
  assert.ok(
    patch.last_failure_context?.details.includes(
      "review_repair_interruption_blocked_reason=secrets",
    ),
  );
  assert.ok(
    patch.last_failure_context?.details.includes(
      "review_repair_interruption_detail=Provide DEPLOY_TOKEN.",
    ),
  );

  let rollingSnapshot = snapshot;
  let rollingPatch = patch;
  for (let attempt = 0; attempt < 100; attempt += 1) {
    rollingSnapshot = {
      ...rollingSnapshot,
      lastError: rollingPatch.last_error ?? null,
      lastFailureContext:
        rollingPatch.last_failure_context ?? rollingSnapshot.lastFailureContext,
    };
    rollingPatch = preserveIndependentVerificationBlockerPatch(
      rollingSnapshot,
      {
        state: "failed",
        blocked_reason: null,
        last_error: `Transient review repair failure ${attempt}: ${"x".repeat(100)}`,
        last_failure_kind: "command_error",
        last_failure_context: {
          category: "codex",
          summary: `Transient review repair failure ${attempt}.`,
          signature: `review-repair-${attempt}`,
          command: null,
          details: [`attempt=${attempt}`],
          url: null,
          updated_at: `2026-07-12T00:${String(attempt % 60).padStart(2, "0")}:00Z`,
        },
      },
    );
  }
  assert.ok((rollingPatch.last_error?.length ?? 0) <= 1000);
  assert.ok((rollingPatch.last_failure_context?.details.length ?? 0) <= 32);
  assert.ok(
    rollingPatch.last_failure_context?.details.includes(
      "review_repair_interruption_blocked_reason=secrets",
    ),
  );
  assert.ok(
    rollingPatch.last_failure_context?.details.includes(
      "review_repair_interruption_detail=attempt=99",
    ),
  );
});
