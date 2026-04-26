import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";

async function readRepoFile(relativePath: string): Promise<string> {
  return fs.readFile(path.join(process.cwd(), relativePath), "utf8");
}

test("supervised automation lane product primitive note is repo-owned and discoverable", async () => {
  const [readme, note] = await Promise.all([
    readRepoFile("README.md"),
    readRepoFile("docs/supervised-automation-lane.md"),
  ]);

  assert.match(readme, /\[Supervised automation lane\]\(\.\/docs\/supervised-automation-lane\.md\)/);

  assert.match(note, /^# Supervised Automation Lane$/m);
  assert.match(note, /OpenAI-ready product primitive/i);
  assert.match(note, /chat-driven vibe coding/i);
  assert.match(note, /issue\/spec-driven supervised automation/i);

  for (const primitive of [
    "Task Contract",
    "Trust Posture",
    "Execution Attempt",
    "Evidence Timeline",
    "Operator Action",
    "Bounded Recovery",
    "Durable Memory Writeback",
  ]) {
    assert.match(note, new RegExp(`### ${primitive}`));
  }

  for (const boundary of [
    /GitHub-authored text is execution input, not supervisor policy/i,
    /does not create new automation authority/i,
    /does not default-enable follow-up issue creation/i,
    /trusted solo-lane automation/i,
  ]) {
    assert.match(note, boundary);
  }

  assert.doesNotMatch(note, /\/Users\/[A-Za-z0-9._-]+\//);
  assert.doesNotMatch(note, /C:\\Users\\[A-Za-z0-9._-]+\\/);
});
