import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { lintExecutionReadyIssueBody, validateIssueMetadataSyntax } from "./issue-metadata";
import type { GitHubIssue } from "./core/types";

const demoPath = path.join("docs", "examples", "self-contained-demo-scenario.md");

async function readRepoFile(relativePath: string): Promise<string> {
  return fs.readFile(path.join(process.cwd(), relativePath), "utf8");
}

function extractDemoIssueBody(content: string): string {
  const match = content.match(
    /<!-- self-contained-demo-issue:start -->\s*```md\s*([\s\S]*?)```\s*<!-- self-contained-demo-issue:end -->/,
  );
  assert.ok(match, "self-contained demo must include the marked sample issue body");
  return match[1].trim();
}

function createDemoIssue(body: string): GitHubIssue {
  return {
    number: 101,
    title: "Add issue journal quick filter",
    body,
    createdAt: "2026-04-27T00:00:00Z",
    updatedAt: "2026-04-27T00:00:00Z",
    url: "https://example.com/issues/101",
    labels: [{ name: "codex" }],
    state: "OPEN",
  };
}

test("self-contained demo scenario publishes the expected offline quality artifacts", async () => {
  const demo = await readRepoFile(demoPath);

  assert.match(demo, /^# Self-contained Demo Scenario$/m);
  assert.match(demo, /## Demo issue body/);
  assert.match(demo, /## Expected local verification/);
  assert.match(demo, /## Expected PR outcome/);
  assert.match(demo, /## Evidence timeline references/);
  assert.match(demo, /issue journal/i);
  assert.match(demo, /draft PR/i);
  assert.match(demo, /local verification/i);
  assert.match(demo, /evidence timeline/i);
  assert.match(demo, /review/i);
  assert.match(demo, /merge/i);
  assert.match(demo, /node dist\/index\.js issue-lint <issue-number> --config <supervisor-config-path>/);
  assert.match(demo, /CODEX_SUPERVISOR_CONFIG/);
  assert.doesNotMatch(demo, /\/Users\/[A-Za-z0-9._-]+\//);
  assert.doesNotMatch(demo, /C:\\Users\\[A-Za-z0-9._-]+\\/);
});

test("self-contained demo issue body is execution-ready metadata", async () => {
  const demo = await readRepoFile(demoPath);
  const sampleIssue = createDemoIssue(extractDemoIssueBody(demo));

  assert.deepEqual(validateIssueMetadataSyntax(sampleIssue), []);

  const lint = lintExecutionReadyIssueBody(sampleIssue);
  assert.equal(lint.isExecutionReady, true);
  assert.deepEqual(lint.missingRequired, []);
  assert.deepEqual(lint.missingRecommended, []);
});
