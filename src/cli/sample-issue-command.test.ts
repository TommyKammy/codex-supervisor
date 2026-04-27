import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createIssueLintDto } from "../supervisor/supervisor-selection-issue-lint";
import { handleSampleIssueCommand } from "./sample-issue-command";

test("handleSampleIssueCommand previews a standalone sample body that reuses issue-lint metadata", async () => {
  const output = await handleSampleIssueCommand({});

  assert.match(output, /^## Summary$/m);
  assert.match(output, /^Depends on: none$/m);
  assert.match(output, /^Parallelizable: No$/m);
  assert.match(output, /^## Execution order\n1 of 1$/m);
  assert.doesNotMatch(output, /Part of:/);

  const filled = output
    .replace("<one short paragraph describing the intended outcome>", "Add a focused onboarding sample issue.")
    .replace("<in-scope behavior delta>", "show one execution-ready behavior delta")
    .replace("<observable completion check>", "sample issue body is ready for issue-lint")
    .replace("<exact command, test file, or manual check>", "`node dist/index.js issue-lint <issue-number> --config <supervisor-config-path>`");
  const dto = createIssueLintDto({
    number: 1,
    title: "Sample issue",
    body: filled,
    createdAt: "2026-04-27T00:00:00Z",
    updatedAt: "2026-04-27T00:00:00Z",
    url: "https://example.test/issues/1",
    labels: [{ name: "codex" }],
    state: "OPEN",
  });

  assert.equal(dto.executionReady, true);
  assert.deepEqual(dto.missingRequired, []);
  assert.deepEqual(dto.metadataErrors, []);
});

test("handleSampleIssueCommand writes SAMPLE_ISSUE.md only when output is explicit", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "codex-supervisor-sample-issue-"));
  t.after(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });
  const outputPath = path.join(root, "SAMPLE_ISSUE.md");

  const output = await handleSampleIssueCommand({ outputPath });
  const written = await fs.readFile(outputPath, "utf8");

  assert.match(output, /^sample_issue_written path=/m);
  assert.match(written, /^## Summary$/m);
  assert.match(written, /^Depends on: none$/m);
});
