import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const workflowPath = path.resolve(__dirname, "..", ".github/workflows/ci.yml");

test("CI workflow cancels stale runs for the same branch or PR", async () => {
  const workflow = await fs.readFile(workflowPath, "utf8");

  assert.match(workflow, /on:\s*[\s\S]*push:\s*[\s\S]*branches:\s*-\s*main[\s\S]*pull_request:/);
  assert.match(
    workflow,
    /concurrency:\s*group:\s*\$\{\{ github\.workflow \}\}-\$\{\{ github\.event\.pull_request\.head\.repo\.full_name \|\| github\.repository \}\}-\$\{\{ github\.head_ref \|\| github\.ref_name \}\}\s*cancel-in-progress:\s*true/,
  );
});
