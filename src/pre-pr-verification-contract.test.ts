import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";

test("package.json exposes the repo-owned pre-PR verification contract with path hygiene first", async () => {
  const packageJson = JSON.parse(
    await fs.readFile(path.join(process.cwd(), "package.json"), "utf8"),
  ) as { scripts?: Record<string, string> };

  assert.equal(
    packageJson.scripts?.["verify:pre-pr"],
    "npm run verify:paths && npm run build && npm test",
  );
});
