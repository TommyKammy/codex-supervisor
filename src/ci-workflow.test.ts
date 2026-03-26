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

test("CI workflow surfaces the compact replay corpus summary in pull request output", async () => {
  const workflow = await fs.readFile(workflowPath, "utf8");

  assert.match(
    workflow,
    /-\s*id:\s*replay_corpus\s*if:\s*matrix\.os == 'ubuntu-latest'\s*[\s\S]*?run:\s*npx tsx src\/index\.ts replay-corpus(?:\s|$)/,
  );
});

test("CI workflow uploads replay corpus mismatch details only when the Ubuntu replay run fails", async () => {
  const workflow = await fs.readFile(workflowPath, "utf8");

  assert.match(
    workflow,
    /-\s*if:\s*\$\{\{\s*failure\(\)\s*&&\s*matrix\.os == 'ubuntu-latest'\s*&&\s*steps\.replay_corpus\.outcome == 'failure'\s*\}\}\s*uses:\s*actions\/upload-artifact@v4[\s\S]*?name:\s*replay-corpus-mismatch-details[\s\S]*?path:\s*\.codex-supervisor\/replay\/replay-corpus-mismatch-details\.json(?:\s|$)/,
  );
});

test("CI workflow runs the focused malformed-inventory regression suite on Ubuntu pull request jobs", async () => {
  const workflow = await fs.readFile(workflowPath, "utf8");

  assert.match(
    workflow,
    /-\s*if:\s*matrix\.os == 'ubuntu-latest'\s*run:\s*npm run test:malformed-inventory-regressions(?:\s|$)/,
  );
});

test("CI workflow runs the focused managed-restart regression suite on Ubuntu pull request jobs", async () => {
  const workflow = await fs.readFile(workflowPath, "utf8");

  assert.match(
    workflow,
    /-\s*if:\s*matrix\.os == 'ubuntu-latest'\s*run:\s*npm run test:managed-restart-regressions(?:\s|$)/,
  );
});
