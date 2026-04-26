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

  const laneLink = /\[Supervised automation lane\]\(\.\/docs\/supervised-automation-lane\.md\)/;
  const docsMapIndex = readme.indexOf("## Docs Map");
  assert.notEqual(docsMapIndex, -1, "README must include a Docs Map section");
  assert.match(readme.slice(0, docsMapIndex), laneLink);
  assert.match(readme.slice(docsMapIndex), laneLink);

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

test("supervised automation lane documents an auditable work state machine", async () => {
  const note = await readRepoFile("docs/supervised-automation-lane.md");

  assert.match(note, /^### Auditable Work State Machine$/m);
  assert.match(note, /operator-facing state is a trust surface/i);
  assert.match(note, /status, explain, WebUI, evidence timeline, and recovery diagnostics/i);
  assert.match(note, /does not rename runtime states/i);

  for (const heading of ["State", "Reason", "Evidence", "Authority Boundary", "Next Operator Action"]) {
    assert.match(note, new RegExp(`\\| ${heading} `));
  }

  for (const state of [
    "queued",
    "running",
    "blocked",
    "waiting_ci",
    "waiting_review",
    "repairing_ci",
    "merging",
    "done",
    "manual_review",
  ]) {
    const row = new RegExp("\\| `" + state + "` \\|[^\\n]+\\|[^\\n]+\\|[^\\n]+\\|[^\\n]+\\|");
    assert.match(note, row, `${state} must map to reason, evidence, authority, and action`);
  }

  assert.match(note, /supervisor-owned/i);
  assert.match(note, /operator judgment/i);
  assert.match(note, /fresh GitHub facts/i);
  assert.match(note, /issue journal/i);
});
