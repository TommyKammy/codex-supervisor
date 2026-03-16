import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

test("non-codex modules use the codex family barrel for prompt helpers", async () => {
  const sourceFiles = [
    path.join(__dirname, "..", "turn-execution-orchestration.ts"),
    path.join(__dirname, "..", "local-review", "repair-context.ts"),
  ];

  await Promise.all(sourceFiles.map(async (sourceFile) => {
    const content = await readFile(sourceFile, "utf8");
    assert.doesNotMatch(content, /from ["'][.]{1,2}\/codex\/codex-prompt["']/);
  }));
});
