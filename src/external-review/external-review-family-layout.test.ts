import assert from "node:assert/strict";
import { readdir } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const EXPECTED_RUNTIME_FILES = [
  "external-review-classifier.ts",
  "external-review-durable-guardrail-candidates.ts",
  "external-review-local-artifact-io.ts",
  "external-review-miss-artifact-types.ts",
  "external-review-miss-artifact.ts",
  "external-review-miss-history.ts",
  "external-review-miss-patterns.ts",
  "external-review-miss-persistence.ts",
  "external-review-miss-state.ts",
  "external-review-misses.ts",
  "external-review-normalization.ts",
  "external-review-regression-candidate-qualification.ts",
  "external-review-regression-candidates.ts",
  "external-review-signal-collection.ts",
  "external-review-signal-heuristics.ts",
  "external-review-signals.ts",
] as const;

const EXPECTED_TEST_FILES = [
  "external-review-classifier.test.ts",
  "external-review-durable-guardrail-candidates.test.ts",
  "external-review-family-layout.test.ts",
  "external-review-miss-artifact.test.ts",
  "external-review-miss-history.test.ts",
  "external-review-miss-patterns.test.ts",
  "external-review-miss-persistence.test.ts",
  "external-review-miss-state.test.ts",
  "external-review-normalization.test.ts",
  "external-review-regression-candidate-qualification.test.ts",
  "external-review-regression-candidates.test.ts",
  "external-review-signal-collection.test.ts",
] as const;

test("external-review runtime modules and focused tests stay aligned", async () => {
  const familyEntries = await readdir(__dirname, { withFileTypes: true });
  const runtimeFiles = familyEntries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts"))
    .map((entry) => entry.name)
    .sort();
  const testFiles = familyEntries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".test.ts"))
    .map((entry) => entry.name)
    .sort();

  assert.deepEqual(runtimeFiles, [...EXPECTED_RUNTIME_FILES]);
  assert.deepEqual(testFiles, [...EXPECTED_TEST_FILES]);
});

test("qualification and candidate shaping stay in separate external-review tests", async () => {
  const familyEntries = await readdir(__dirname, { withFileTypes: true });
  const entryNames = new Set(familyEntries.filter((entry) => entry.isFile()).map((entry) => entry.name));

  assert.equal(entryNames.has("external-review-regression-candidate-qualification.ts"), true);
  assert.equal(entryNames.has("external-review-regression-candidate-qualification.test.ts"), true);
  assert.equal(entryNames.has("external-review-regression-candidates.ts"), true);
  assert.equal(entryNames.has("external-review-regression-candidates.test.ts"), true);
  assert.equal(path.basename(__filename), "external-review-family-layout.test.ts");
});
