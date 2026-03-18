import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";

async function readAgentInstructions(): Promise<string> {
  return fs.readFile(path.join(process.cwd(), "docs", "agent-instructions.md"), "utf8");
}

test("agent bootstrap doc exists as a hub that delegates detailed rules", async () => {
  const content = await readAgentInstructions();

  const requiredHeadings = [
    "# Agent Bootstrap Protocol",
    "## Purpose",
    "## Prerequisites",
    "## Read this first",
    "## First-run sequence",
    "## Escalate instead of guessing",
    "## Canonical references",
  ];

  let lastIndex = -1;
  for (const heading of requiredHeadings) {
    const index = content.indexOf(heading);
    assert.notEqual(index, -1, `expected ${heading} in docs/agent-instructions.md`);
    assert.ok(index > lastIndex, `expected ${heading} to appear after the previous section`);
    lastIndex = index;
  }

  assert.match(content, /\[Getting started\]\(\.\/getting-started\.md\)/);
  assert.match(content, /\[Configuration reference\]\(\.\/configuration\.md\)/);
  assert.match(content, /\[Issue metadata reference\]\(\.\/issue-metadata\.md\)/);
  assert.match(content, /\[Local review reference\]\(\.\/local-review\.md\)/);
  assert.match(content, /bootstrap hub/i);

  assert.doesNotMatch(content, /^## Full configuration reference$/m);
  assert.doesNotMatch(content, /^## Complete issue metadata specification$/m);
});
