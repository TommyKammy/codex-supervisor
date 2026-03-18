import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";

async function readReadme(): Promise<string> {
  return fs.readFile(path.join(process.cwd(), "README.md"), "utf8");
}

test("README stays lightweight while routing humans and AI agents to the right docs", async () => {
  const content = await readReadme();

  const requiredHeadings = [
    "## What It Is",
    "## Who It Is For",
    "## Quick Start",
    "## Docs Map",
  ];

  let lastIndex = -1;
  for (const heading of requiredHeadings) {
    const index = content.indexOf(heading);
    assert.notEqual(index, -1, `expected ${heading} in README.md`);
    assert.ok(index > lastIndex, `expected ${heading} to appear after the previous section`);
    lastIndex = index;
  }

  assert.match(content, /\[Getting started\]\(\.\/docs\/getting-started\.md\)/);
  assert.match(content, /\[AI agent handoff\]\(\.\/docs\/agent-instructions\.md\)/);

  assert.doesNotMatch(content, /^## Full setup guide$/m);
  assert.doesNotMatch(content, /^## Complete operator manual$/m);
});
