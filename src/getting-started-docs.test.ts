import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";

async function readGettingStarted(): Promise<string> {
  return fs.readFile(path.join(process.cwd(), "docs", "getting-started.md"), "utf8");
}

async function readJapaneseOverview(): Promise<string> {
  return fs.readFile(path.join(process.cwd(), "docs", "README.ja.md"), "utf8");
}

async function readJapaneseGettingStarted(): Promise<string> {
  return fs.readFile(path.join(process.cwd(), "docs", "getting-started.ja.md"), "utf8");
}

test("getting-started stays focused on operator setup and flow", async () => {
  const content = await readGettingStarted();

  const requiredHeadings = [
    "# Getting Started with codex-supervisor",
    "## Before you start",
    "## Choose the operating mode",
    "## Prepare the supervisor config",
    "## Write execution-ready issues",
    "## Run the first pass",
    "## Move from run-once to loop",
    "## Common operator decisions",
    "## Common mistakes",
    "## Related docs",
  ];

  let lastIndex = -1;
  for (const heading of requiredHeadings) {
    const index = content.indexOf(heading);
    assert.notEqual(index, -1, `expected ${heading} in docs/getting-started.md`);
    assert.ok(index > lastIndex, `expected ${heading} to appear after the previous section`);
    lastIndex = index;
  }

  assert.match(content, /\[README\]\(\.\.\/README\.md\)/);
  assert.match(content, /\[Configuration reference\]\(\.\/configuration\.md\)/);
  assert.match(content, /\[Local review reference\]\(\.\/local-review\.md\)/);
  assert.match(content, /\[Issue metadata reference\]\(\.\/issue-metadata\.md\)/);

  assert.doesNotMatch(content, /^## Full picture$/m);
  assert.doesNotMatch(content, /^## What codex-supervisor does$/m);
  assert.doesNotMatch(content, /^## Best fit$/m);
  assert.doesNotMatch(content, /^## Not a fit$/m);
  assert.doesNotMatch(content, /^## How readiness-driven scheduling works$/m);
  assert.doesNotMatch(content, /^## State machine$/m);
});

test("japanese docs keep overview and getting-started responsibilities separate", async () => {
  const [overview, gettingStarted] = await Promise.all([
    readJapaneseOverview(),
    readJapaneseGettingStarted(),
  ]);

  assert.match(overview, /\[README\.md\]\(\.\.\/README\.md\)/);
  assert.match(overview, /\[docs\/getting-started\.md\]\(\.\/getting-started\.md\)/);
  assert.match(overview, /\[docs\/getting-started\.ja\.md\]\(\.\/getting-started\.ja\.md\)/);

  assert.doesNotMatch(overview, /\/Users\//);
  assert.doesNotMatch(gettingStarted, /\/Users\//);

  assert.doesNotMatch(overview, /^## 初回セットアップの流れ$/m);
  assert.doesNotMatch(overview, /^## Local Review Swarm$/m);
  assert.doesNotMatch(overview, /^## Codex への指示例$/m);
  assert.doesNotMatch(overview, /^## 最初の実行手順$/m);

  assert.match(gettingStarted, /\[README\]\(\.\.\/README\.md\)/);
  assert.match(gettingStarted, /\[README\.ja\]\(\.\/README\.ja\.md\)/);
  assert.match(gettingStarted, /\[Configuration reference\]\(\.\/configuration\.md\)/);
  assert.match(gettingStarted, /\[Local review reference\]\(\.\/local-review\.md\)/);
  assert.match(gettingStarted, /\[Issue metadata reference\]\(\.\/issue-metadata\.md\)/);
});
