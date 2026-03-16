import test from "node:test";
import assert from "node:assert/strict";
import { access } from "node:fs/promises";
import path from "node:path";

const ISSUE_METADATA_MODULES = [
  "issue-metadata.ts",
  "issue-metadata-parser.ts",
  "issue-metadata-gates.ts",
  "issue-metadata-risky-policy.ts",
] as const;
const ISSUE_METADATA_DIR = __dirname;

test("issue-metadata family lives under src/issue-metadata", async () => {
  await Promise.all(
    ISSUE_METADATA_MODULES.map(async (modulePath) => {
      await assert.doesNotReject(() => access(path.join(ISSUE_METADATA_DIR, modulePath)));
    }),
  );
});
