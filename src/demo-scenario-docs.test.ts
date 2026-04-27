import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { lintExecutionReadyIssueBody, validateIssueMetadataSyntax } from "./issue-metadata";
import type { GitHubIssue } from "./core/types";

const demoPath = path.join("docs", "examples", "self-contained-demo-scenario.md");
const dogfoodWalkthroughPath = path.join("docs", "examples", "phase-16-dogfood-pr-walkthrough.md");
const publicDemoChecklistPath = path.join("docs", "public-demo-validation-checklist.md");

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

test("Phase 16 dogfood PR walkthrough is linked and annotates the supervised lifecycle", async () => {
  const [readme, beforeAfter, walkthrough] = await Promise.all([
    readRepoFile("README.md"),
    readRepoFile("docs/vibe-coding-before-after.md"),
    readRepoFile(dogfoodWalkthroughPath),
  ]);

  assert.match(readme, /\[Phase 16 dogfood PR walkthrough\]\(\.\/docs\/examples\/phase-16-dogfood-pr-walkthrough\.md\)/);
  assert.match(
    beforeAfter,
    /\[Phase 16 dogfood PR walkthrough\]\(\.\/examples\/phase-16-dogfood-pr-walkthrough\.md\)/,
  );

  const requiredHeadings = [
    "# Phase 16 Dogfood PR Walkthrough",
    "## Provenance",
    "## Lifecycle Walkthrough",
    "## Artifact Contracts",
    "## Sanitization Boundary",
    "## Read Offline",
  ];
  for (const heading of requiredHeadings) {
    assert.match(walkthrough, new RegExp(`^${heading}$`, "m"));
  }

  for (const annotation of [
    "issue-lint",
    "local verification",
    "review provider",
    "operator action",
    "evidence timeline",
    "draft PR",
    "issue journal",
    "docs/issue-metadata.md",
    "docs/evidence-timeline.schema.json",
    "docs/operator-actions.schema.json",
  ]) {
    assert.match(walkthrough, new RegExp(annotation, "i"), `expected walkthrough to annotate ${annotation}`);
  }

  assert.match(walkthrough, /Phase 16/i);
  assert.match(walkthrough, /sanitized equivalent/i);
  assert.match(walkthrough, /node dist\/index\.js issue-lint <issue-number> --config <supervisor-config-path>/);
  assert.doesNotMatch(walkthrough, /\/Users\/[A-Za-z0-9._-]+\//);
  assert.doesNotMatch(walkthrough, /C:\\Users\\[A-Za-z0-9._-]+\\/);
});

test("public demo validation checklist guards the publishable demo surfaces", async () => {
  const [readme, checklist] = await Promise.all([readRepoFile("README.md"), readRepoFile(publicDemoChecklistPath)]);

  assert.match(
    readme,
    /\[Public demo validation checklist\]\(\.\/docs\/public-demo-validation-checklist\.md\)/,
  );

  const requiredHeadings = [
    "# Public Demo Validation Checklist",
    "## Checklist",
    "## Drift Checks",
    "## Refresh Readiness Note",
    "## Verification",
  ];
  for (const heading of requiredHeadings) {
    assert.match(checklist, new RegExp(`^${heading}$`, "m"));
  }

  for (const phrase of [
    "README positioning",
    "self-contained demo scenario",
    "annotated PR walkthrough",
    "path hygiene",
    "schema links",
    "docs/examples/self-contained-demo-scenario.md",
    "docs/examples/phase-16-dogfood-pr-walkthrough.md",
    "docs/issue-body-contract.schema.json",
    "docs/evidence-timeline.schema.json",
    "docs/operator-actions.schema.json",
    "node dist/index.js issue-lint <issue-number> --config <supervisor-config-path>",
    "CODEX_SUPERVISOR_CONFIG",
    "npm run verify:paths",
    "npm run build",
  ]) {
    assert.match(checklist, new RegExp(phrase.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&"), "i"));
  }

  const requiredLinks = [
    "./examples/self-contained-demo-scenario.md",
    "./examples/phase-16-dogfood-pr-walkthrough.md",
    "./issue-body-contract.schema.json",
    "./evidence-timeline.schema.json",
    "./operator-actions.schema.json",
  ];
  for (const link of requiredLinks) {
    assert.match(checklist, new RegExp(`\\]${"\\("}${link.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")}\\)`));
  }

  assert.doesNotMatch(checklist, /\/Users\/[A-Za-z0-9._-]+\//);
  assert.doesNotMatch(checklist, /\/home\/[A-Za-z0-9._-]+\//);
  assert.doesNotMatch(checklist, /C:\\Users\\[A-Za-z0-9._-]+\\/i);
});
