import test from "node:test";
import assert from "node:assert/strict";
import { access } from "node:fs/promises";
import path from "node:path";

const EXTERNAL_REVIEW_MODULES = [
  "external-review-classifier.ts",
  "external-review-durable-guardrail-candidates.ts",
  "external-review-local-artifact-io.ts",
  "external-review-miss-artifact-types.ts",
  "external-review-miss-history.ts",
  "external-review-miss-patterns.ts",
  "external-review-miss-persistence.ts",
  "external-review-miss-state.ts",
  "external-review-misses.ts",
  "external-review-normalization.ts",
  "external-review-regression-candidates.ts",
  "external-review-signal-heuristics.ts",
] as const;

test("external-review family lives under src/external-review", async () => {
  await Promise.all(
    EXTERNAL_REVIEW_MODULES.map(async (modulePath) => {
      await assert.doesNotReject(() => access(path.join(__dirname, modulePath)));
    }),
  );
});
