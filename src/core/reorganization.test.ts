import test from "node:test";
import assert from "node:assert/strict";
import { access } from "node:fs/promises";
import path from "node:path";

const CORE_MODULES = [
  "command.ts",
  "config.ts",
  "journal.ts",
  "lock.ts",
  "memory.ts",
  "state-store.ts",
  "types.ts",
  "utils.ts",
  "workspace.ts",
] as const;

test("shared core modules live under src/core", async () => {
  await Promise.all(
    CORE_MODULES.map(async (modulePath) => {
      await assert.doesNotReject(() => access(path.join(__dirname, modulePath)));
    }),
  );
});
