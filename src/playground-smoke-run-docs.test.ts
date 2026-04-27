import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { lintExecutionReadyIssueBody, validateIssueMetadataSyntax } from "./issue-metadata";
import type { GitHubIssue } from "./core/types";

async function readRepoFile(relativePath: string): Promise<string> {
  return fs.readFile(path.join(process.cwd(), relativePath), "utf8");
}

function extractSampleIssueBody(content: string): string {
  const match = content.match(
    /<!-- playground-smoke-sample-issue:start -->\s*```md\s*([\s\S]*?)```\s*<!-- playground-smoke-sample-issue:end -->/,
  );
  assert.ok(match, "playground guide must include the marked sample issue body");
  return match[1].trim();
}

function createSampleIssue(body: string): GitHubIssue {
  return {
    number: 1,
    title: "Playground smoke run",
    body,
    createdAt: "2026-04-27T00:00:00Z",
    updatedAt: "2026-04-27T00:00:00Z",
    url: "https://example.com/issues/1",
    labels: [{ name: "codex" }],
    state: "OPEN",
  };
}

test("playground smoke-run guide is linked from first-run docs", async () => {
  const [readme, gettingStarted, guide] = await Promise.all([
    readRepoFile("README.md"),
    readRepoFile("docs/getting-started.md"),
    readRepoFile("docs/playground-smoke-run.md"),
  ]);

  assert.match(guide, /^# Playground Smoke Run$/m);
  assert.match(readme, /\[Playground smoke run\]\(\.\/docs\/playground-smoke-run\.md\)/);
  assert.match(gettingStarted, /\[Playground smoke run\]\(\.\/playground-smoke-run\.md\)/);
});

test("playground smoke-run documents sandbox posture separately from production posture", async () => {
  const guide = await readRepoFile("docs/playground-smoke-run.md");

  assert.match(guide, /sandbox-only/i);
  assert.match(guide, /production/i);
  assert.match(guide, /trusted repo/i);
  assert.match(guide, /trusted GitHub authors/i);
  assert.match(guide, /CODEX_SUPERVISOR_CONFIG/);
  assert.match(guide, /<supervisor-config-path>/);
  assert.match(guide, /node dist\/index\.js issue-lint <issue-number> --config <supervisor-config-path>/);
  assert.doesNotMatch(guide, /\/Users\/[A-Za-z0-9._-]+\//);
  assert.doesNotMatch(guide, /C:\\Users\\[A-Za-z0-9._-]+\\/);
});

test("playground smoke-run sample issue is execution-ready metadata", async () => {
  const guide = await readRepoFile("docs/playground-smoke-run.md");
  const sampleIssue = createSampleIssue(extractSampleIssueBody(guide));

  assert.deepEqual(validateIssueMetadataSyntax(sampleIssue), []);

  const lint = lintExecutionReadyIssueBody(sampleIssue);
  assert.equal(lint.isExecutionReady, true);
  assert.deepEqual(lint.missingRequired, []);
  assert.deepEqual(lint.missingRecommended, []);
});
