import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { renderCliHelp } from "./cli/help";

async function readDoc(relativePath: string): Promise<string> {
  return fs.readFile(path.join(process.cwd(), relativePath), "utf8");
}

test("validation checklist is maintained as the release-readiness artifact", async () => {
  const checklist = await readDoc("docs/validation-checklist.md");

  const requiredHeadings = [
    "# Release Readiness Checklist",
    "## Readiness levels",
    "### Minimum",
    "### Recommended",
    "### Sufficient",
    "## Checklist",
    "## Advisory boundary",
    "## Verification",
  ];

  let lastIndex = -1;
  for (const heading of requiredHeadings) {
    const index = checklist.indexOf(heading);
    assert.notEqual(index, -1, `expected ${heading} in docs/validation-checklist.md`);
    assert.ok(index > lastIndex, `expected ${heading} to appear after the previous section`);
    lastIndex = index;
  }

  for (const phrase of [
    "first-run setup",
    "one-shot execution",
    "loop operation",
    "review handling",
    "merge convergence",
    "WebUI",
    "local CI",
    "release gate",
    "trust boundaries",
    "release notes source",
    "summarize-post-merge-audits",
    "releaseNotesSources",
    "development-history updates",
    "advisory checklist",
    "issue-authored verification guidance",
    "not a repo-owned fail-closed gate by itself",
    "releaseReadinessGate: advisory",
    "releaseReadinessGate: block_release_publication",
    "doctor_release_readiness_gate",
    "block release publication only",
    "node dist/index.js run-once --config <supervisor-config-path>",
    "node dist/index.js loop --config <supervisor-config-path>",
    "node dist/index.js web --config <supervisor-config-path>",
    "npm run verify:supervisor-pre-pr",
  ]) {
    assert.match(checklist, new RegExp(phrase.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&"), "i"));
  }

  assert.doesNotMatch(checklist, /\/Users\//);
  assert.doesNotMatch(checklist, /\/home\/[A-Za-z0-9_-]+\//);
  assert.doesNotMatch(checklist, /C:\\Users\\/i);
});

test("operators can discover the release-readiness checklist from docs and CLI help", async () => {
  const [readme, gettingStarted] = await Promise.all([
    readDoc("README.md"),
    readDoc("docs/getting-started.md"),
  ]);
  const help = renderCliHelp();

  assert.match(readme, /\[Release readiness checklist\]\(\.\/docs\/validation-checklist\.md\)/i);
  assert.match(gettingStarted, /\[Release readiness checklist\]\(\.\/validation-checklist\.md\)/i);
  assert.match(help, /readiness-checklist\s+Print the release-readiness checklist/i);
  assert.match(help, /node dist\/index\.js help/);
  assert.match(help, /node dist\/index\.js web --config <supervisor-config-path>\s+# open \/setup/);
  assert.match(help, /node dist\/index\.js issue-lint <issue-number> --config <supervisor-config-path>/);
  assert.match(help, /node dist\/index\.js run-once --config <supervisor-config-path> --dry-run/);
});
