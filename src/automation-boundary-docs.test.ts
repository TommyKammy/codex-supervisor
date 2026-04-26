import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";

async function readRepoFile(relativePath: string): Promise<string> {
  return fs.readFile(path.join(process.cwd(), relativePath), "utf8");
}

test("repo guidance documents Codex app Automation as orchestration rather than executor replacement", async () => {
  const [readme, architecture, automation] = await Promise.all([
    readRepoFile("README.md"),
    readRepoFile("docs/architecture.md"),
    readRepoFile("docs/automation.md"),
  ]);

  assert.match(readme, /\[Codex app Automation boundary\]\(\.\/docs\/automation\.md\)/);
  assert.match(architecture, /Codex app Automation is an orchestration boundary/i);

  for (const content of [architecture, automation]) {
    assert.match(content, /codex-supervisor remains the implementation executor/i);
    assert.match(content, /Automation is not an executor replacement/i);
  }

  for (const role of ["Loop Watcher", "Merge Evaluator", "Follow-up Issue Creator", "Obsidian Recorder"]) {
    assert.match(automation, new RegExp(role));
  }

  for (const requiredBoundary of [
    /quiet when there is no actionable change/i,
    /confirm-required/i,
    /no destructive git operations/i,
    /respect core safety gates/i,
  ]) {
    assert.match(automation, requiredBoundary);
  }

  for (const forbiddenExpansion of [
    /default-enabled follow-up issue creation/i,
    /metadata-only review auto-resolve/i,
    /broad path repair/i,
    /multi-user governance/i,
  ]) {
    assert.match(automation, forbiddenExpansion);
  }

  assert.doesNotMatch(automation, /\/Users\/[A-Za-z0-9._-]+\//);
  assert.doesNotMatch(automation, /C:\\Users\\[A-Za-z0-9._-]+\\/);
});
