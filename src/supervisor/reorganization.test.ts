import test from "node:test";
import assert from "node:assert/strict";
import { access } from "node:fs/promises";
import path from "node:path";

const SUPERVISOR_MODULES = [
  "supervisor.ts",
  "supervisor-detailed-status-assembly.ts",
  "supervisor-execution-policy.ts",
  "supervisor-failure-context.ts",
  "supervisor-failure-helpers.ts",
  "supervisor-lifecycle.ts",
  "supervisor-reporting.ts",
  "supervisor-selection-status.ts",
  "supervisor-status-model.ts",
  "supervisor-status-rendering.ts",
  "supervisor-status-review-bot.ts",
  "supervisor-status-summary-helpers.ts",
] as const;

test("supervisor family lives under src/supervisor", async () => {
  await Promise.all(
    SUPERVISOR_MODULES.map(async (modulePath) => {
      await assert.doesNotReject(() => access(path.join(__dirname, modulePath)));
    }),
  );
});
