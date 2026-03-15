import assert from "node:assert/strict";
import test from "node:test";
import { extractBlockedReason, extractFailureSignature, extractStateHint } from "./codex-output-parser";

test("extractStateHint accepts supported states", () => {
  assert.equal(extractStateHint("State hint: local_review_fix"), "local_review_fix");
  assert.equal(extractStateHint("State hint: blocked"), "blocked");
});

test("extractStateHint rejects unsupported states", () => {
  assert.equal(extractStateHint("State hint: clarification"), null);
  assert.equal(extractStateHint("No state footer"), null);
});

test("extractBlockedReason accepts supported blocked reasons", () => {
  assert.equal(extractBlockedReason("Blocked reason: verification"), "verification");
  assert.equal(extractBlockedReason("Blocked reason: manual_pr_closed"), "manual_pr_closed");
});

test("extractBlockedReason rejects unsupported blocked reasons", () => {
  assert.equal(extractBlockedReason("Blocked reason: clarification"), null);
  assert.equal(extractBlockedReason("No blocked reason footer"), null);
});

test("extractFailureSignature normalizes empty and none values", () => {
  assert.equal(extractFailureSignature("Failure signature: none"), null);
  assert.equal(extractFailureSignature("Failure signature:    "), null);
  assert.equal(extractFailureSignature("No failure signature footer"), null);
});

test("extractFailureSignature trims and truncates values", () => {
  const longSignature = `Failure signature: ${"x".repeat(600)}`;
  assert.equal(extractFailureSignature("Failure signature:  prior-check  "), "prior-check");
  assert.equal(extractFailureSignature(longSignature), "x".repeat(500));
});
