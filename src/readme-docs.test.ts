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

async function readDoc(relativePath: string): Promise<string> {
  return fs.readFile(path.join(process.cwd(), relativePath), "utf8");
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

test("README first screen positions codex-supervisor as a quality layer", async () => {
  const content = await readReadme();
  const whatItIsStart = content.indexOf("## What It Is");
  const whoItIsForStart = content.indexOf("## Who It Is For");
  assert.notEqual(whatItIsStart, -1, "expected README.md to include What It Is");
  assert.ok(whoItIsForStart > whatItIsStart, "expected Who It Is For to follow What It Is");

  const firstScreen = content.slice(0, whoItIsForStart);

  assert.match(
    firstScreen,
    /Codex Supervisor turns vibe coding into issue-driven, test-backed, reviewable software delivery\./,
  );
  assert.equal(
    [...content.matchAll(/vibe coding/g)].length,
    1,
    "expected README to use vibe coding only in the product positioning sentence",
  );

  const requiredLoop = [
    "issue contract",
    "local verification",
    "reviewable PR",
    "evidence timeline",
  ];
  let lastIndex = -1;
  for (const phrase of requiredLoop) {
    const index = firstScreen.indexOf(phrase, lastIndex + 1);
    assert.notEqual(index, -1, `expected first screen to include ${phrase}`);
    assert.ok(index > lastIndex, `expected ${phrase} to appear after the previous quality-loop step`);
    lastIndex = index;
  }

  const requiredArtifactLinks = [
    "[issue body contract](./docs/issue-body-contract.schema.json)",
    "[trust posture](./docs/trust-posture-config.schema.json)",
    "[operator actions](./docs/operator-actions.schema.json)",
    "[evidence timeline](./docs/evidence-timeline.schema.json)",
    "[automation boundary](./docs/codex-automation-connector-boundary.schema.json)",
  ];
  for (const link of requiredArtifactLinks) {
    assert.ok(firstScreen.includes(link), `expected first screen to link ${link}`);
  }
});

test("README links to a concrete Before / After narrative for the quality layer", async () => {
  const [readme, narrative] = await Promise.all([
    readReadme(),
    readDoc(path.join("docs", "vibe-coding-before-after.md")),
  ]);

  const narrativeLink = "[Before / After narrative](./docs/vibe-coding-before-after.md)";
  assert.ok(readme.includes(narrativeLink), "expected README to link the narrative");

  const requiredHeadings = [
    "# Vibe Coding Before / After",
    "## Same Small Change",
    "## Before: Unstructured Chat Session",
    "## After: Supervised codex-supervisor Loop",
    "## Quality Delta",
    "## Operator Boundary",
  ];
  for (const heading of requiredHeadings) {
    assert.match(narrative, new RegExp(`^${heading}$`, "m"));
  }

  for (const artifact of [
    "execution-ready GitHub issue",
    "per-issue worktree",
    "issue journal",
    "draft PR",
    "local verification",
    "evidence timeline",
    "durable history",
  ]) {
    assert.match(narrative, new RegExp(artifact, "i"), `expected narrative to name ${artifact}`);
  }

  assert.match(narrative, /missing quality layer/i);
  assert.match(narrative, /does not replace the human operator/i);
  assert.doesNotMatch(narrative, /bypass(?:es)? human/i);
  assert.doesNotMatch(narrative, /fully autonomous/i);
  assert.doesNotMatch(narrative, /\/Users\/[A-Za-z0-9._-]+\//);
  assert.doesNotMatch(narrative, /C:\\Users\\[A-Za-z0-9._-]+\\/);
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
