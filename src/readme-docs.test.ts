import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";

async function readReadme(): Promise<string> {
  return fs.readFile(path.join(process.cwd(), "README.md"), "utf8");
}

async function readJapaneseOverview(): Promise<string> {
  return fs.readFile(path.join(process.cwd(), "docs", "README.ja.md"), "utf8");
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

test("README.ja stays lightweight while routing humans and AI agents to the right docs", async () => {
  const content = await readJapaneseOverview();

  const requiredHeadings = [
    "## 何をするツールか",
    "## 向いているケース",
    "## クイックスタート",
    "## ドキュメントマップ",
  ];

  let lastIndex = -1;
  for (const heading of requiredHeadings) {
    const index = content.indexOf(heading);
    assert.notEqual(index, -1, `expected ${heading} in docs/README.ja.md`);
    assert.ok(index > lastIndex, `expected ${heading} to appear after the previous section`);
    lastIndex = index;
  }

  assert.match(content, /\[docs\/getting-started\.ja\.md\]\(\.\/getting-started\.ja\.md\)/);
  assert.match(content, /\[docs\/agent-instructions\.ja\.md\]\(\.\/agent-instructions\.ja\.md\)/);

  assert.doesNotMatch(content, /^## 完全なセットアップガイド$/m);
  assert.doesNotMatch(content, /^## 完全な運用マニュアル$/m);
});
