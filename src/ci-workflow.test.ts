import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const workflowPath = path.resolve(process.cwd(), ".github/workflows/ci.yml");

test("CI workflow cancels stale runs for the same branch or PR", async () => {
  const workflow = await fs.readFile(workflowPath, "utf8");

  assert.match(
    workflow,
    /concurrency:\n  group: \$\{\{ github\.workflow \}\}-\$\{\{ github\.event\.pull_request\.number \|\| github\.ref \}\}\n  cancel-in-progress: true/,
  );
});
