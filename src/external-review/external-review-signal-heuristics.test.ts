import assert from "node:assert/strict";
import test from "node:test";
import { classifyConfiguredBotTopLevelReviewStrength } from "./external-review-signal-heuristics";

test("classifyConfiguredBotTopLevelReviewStrength preserves nitpick-only softening for style-only changes requests", () => {
  assert.equal(
    classifyConfiguredBotTopLevelReviewStrength({
      state: "CHANGES_REQUESTED",
      body: "Nitpick: prefer a shorter helper name for readability.",
    }),
    "nitpick_only",
  );
});

test("classifyConfiguredBotTopLevelReviewStrength keeps stronger changes requests blocking", () => {
  assert.equal(
    classifyConfiguredBotTopLevelReviewStrength({
      state: "CHANGES_REQUESTED",
      body: "Nitpick: this can cause a regression in the restore failure path.",
    }),
    "blocking",
  );
});
