import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";

async function readAgentInstructions(): Promise<string> {
  return fs.readFile(path.join(process.cwd(), "docs", "agent-instructions.md"), "utf8");
}

async function readJapaneseAgentInstructions(): Promise<string> {
  return fs.readFile(path.join(process.cwd(), "docs", "agent-instructions.ja.md"), "utf8");
}

function extractH2Headings(content: string): string[] {
  return [...content.matchAll(/^##(?!#)\s+.+$/gm)].map(([heading]) => heading.trim());
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

test("japanese agent bootstrap doc mirrors the english hub structure and delegation role", async () => {
  const englishContent = await readAgentInstructions();
  const japaneseContent = await readJapaneseAgentInstructions();

  const englishHeadings = [
    "## Purpose",
    "## Prerequisites",
    "## Read this first",
    "## First-run sequence",
    "## Escalate instead of guessing",
    "## Canonical references",
  ];
  const japaneseHeadings = [
    "## 目的",
    "## 前提条件",
    "## 最初に読む順番",
    "## 初回実行の順序",
    "## 推測せずにエスカレーションする条件",
    "## 正式な参照先",
  ];

  const englishH2Headings = extractH2Headings(englishContent);
  const japaneseH2Headings = extractH2Headings(japaneseContent);

  assert.deepEqual(englishH2Headings, englishHeadings);
  assert.deepEqual(japaneseH2Headings, japaneseHeadings);
  assert.equal(
    japaneseH2Headings.length,
    englishH2Headings.length,
    "expected Japanese and English bootstrap docs to have the same number of H2 sections",
  );

  let lastIndex = -1;
  for (const heading of japaneseHeadings) {
    const index = japaneseContent.indexOf(heading);
    assert.notEqual(index, -1, `expected ${heading} in docs/agent-instructions.ja.md`);
    assert.ok(index > lastIndex, `expected ${heading} to appear after the previous section`);
    lastIndex = index;
  }

  assert.match(japaneseContent, /\[Getting started\]\(\.\/getting-started\.md\)/);
  assert.match(japaneseContent, /\[codex-supervisor 入門\]\(\.\/getting-started\.ja\.md\)/);
  assert.match(japaneseContent, /\[Configuration reference\]\(\.\/configuration\.md\)/);
  assert.match(japaneseContent, /\[Issue metadata reference\]\(\.\/issue-metadata\.md\)/);
  assert.match(japaneseContent, /\[Local review reference\]\(\.\/local-review\.md\)/);
  assert.match(japaneseContent, /bootstrap hub/i);

  assert.doesNotMatch(japaneseContent, /^## 完全な設定リファレンス$/m);
  assert.doesNotMatch(japaneseContent, /^## issue metadata の完全仕様$/m);
});
