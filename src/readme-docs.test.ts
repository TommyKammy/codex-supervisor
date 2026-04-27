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
  assert.match(content, /On macOS, use `\.\/scripts\/start-loop-tmux\.sh` to host the loop in a managed `tmux` session/i);
  assert.match(content, /stop it with `\.\/scripts\/stop-loop-tmux\.sh`/i);
  assert.match(content, /`\.\/scripts\/install-launchd\.sh` is not a supported macOS loop path/i);

  assert.doesNotMatch(content, /^## Full setup guide$/m);
  assert.doesNotMatch(content, /^## Complete operator manual$/m);
});

test("README Quick Start leads with the five-minute playground smoke flow", async () => {
  const content = await readReadme();
  const quickStartStart = content.indexOf("## Quick Start");
  const webUiStart = content.indexOf("## WebUI");
  assert.notEqual(quickStartStart, -1, "expected README.md to include Quick Start");
  assert.ok(webUiStart > quickStartStart, "expected WebUI to follow Quick Start");

  const quickStart = content.slice(quickStartStart, webUiStart);
  const requiredFlow = [
    "[Playground smoke run](./docs/playground-smoke-run.md)",
    "npm install",
    "npm run build",
    "cp supervisor.config.example.json supervisor.config.playground.json",
    "export CODEX_SUPERVISOR_CONFIG=<supervisor-config-path>",
    "node dist/index.js help",
    'node dist/index.js doctor --config "$CODEX_SUPERVISOR_CONFIG"',
    'node dist/index.js status --config "$CODEX_SUPERVISOR_CONFIG" --why',
    'node dist/index.js issue-lint <issue-number> --config "$CODEX_SUPERVISOR_CONFIG"',
    'node dist/index.js run-once --config "$CODEX_SUPERVISOR_CONFIG" --dry-run',
    'node dist/index.js run-once --config "$CODEX_SUPERVISOR_CONFIG"',
    "Stop after one successful `run-once`.",
  ];

  let lastIndex = -1;
  for (const phrase of requiredFlow) {
    const index = quickStart.indexOf(phrase, lastIndex + 1);
    assert.notEqual(index, -1, `expected Quick Start to include ${phrase}`);
    assert.ok(index > lastIndex, `expected ${phrase} to appear after the previous quick-start step`);
    lastIndex = index;
  }

  const safetyIndex = quickStart.search(/trusted repo with trusted GitHub authors/i);
  const loopIndex = quickStart.indexOf("node dist/index.js loop");
  assert.notEqual(safetyIndex, -1, "expected Quick Start to keep trust posture warning visible");
  assert.notEqual(loopIndex, -1, "expected Quick Start to link the loop handoff");
  assert.ok(safetyIndex < loopIndex, "expected safety warning to appear before loop guidance");

  assert.match(quickStart, /\[Configuration guide\]\(\.\/docs\/configuration\.md\)/);
  assert.match(quickStart, /\[Getting started\]\(\.\/docs\/getting-started\.md\)/);
  assert.match(quickStart, /\[Issue metadata\]\(\.\/docs\/issue-metadata\.md\)/);
  assert.match(quickStart, /\[Architecture\]\(\.\/docs\/architecture\.md\)/);
  assert.doesNotMatch(quickStart, /--config \/path\/to\//);
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
