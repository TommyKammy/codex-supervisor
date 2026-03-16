import test from "node:test";
import assert from "node:assert/strict";
import { access } from "node:fs/promises";
import path from "node:path";

const LOCAL_REVIEW_MODULES = [
  "index.ts",
  "artifacts.ts",
  "execution.ts",
  "finalize.ts",
  "preparation.ts",
  "prompt.ts",
  "repair-context.ts",
  "result.ts",
  "runner.ts",
  "test-helpers.ts",
  "thresholds.ts",
  "types.ts",
] as const;

test("local-review family lives under src/local-review", async () => {
  await Promise.all(
    LOCAL_REVIEW_MODULES.map(async (modulePath) => {
      await assert.doesNotReject(() => access(path.join(__dirname, modulePath)));
    }),
  );
});
