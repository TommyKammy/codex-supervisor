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
    "failed",
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
  assert.match(note, /live operator surfaces such as `status` and `explain`/i);
  assert.match(note, /fresh GitHub facts/i);
  assert.match(note, /issue journal/i);
  assert.match(note, /Persisted PR status comments are snapshots/i);
  assert.match(note, /must not be treated as authoritative lifecycle state/i);
  assert.match(note, /tracked-done cleanup/i);
  assert.doesNotMatch(note, /tracked done cleanup/i);
});

test("supervised automation lane documents contract-first issue authoring UX", async () => {
  const [template, metadataReference, note] = await Promise.all([
    readRepoFile(".github/ISSUE_TEMPLATE/codex-execution-ready.md"),
    readRepoFile("docs/issue-metadata.md"),
    readRepoFile("docs/supervised-automation-lane.md"),
  ]);

  assert.match(template, /## Summary/);
  assert.match(template, /## Scope/);
  assert.match(template, /## Acceptance criteria/);
  assert.match(template, /## Verification/);
  assert.match(metadataReference, /Use this document as the canonical reference/i);

  assert.match(note, /^### Contract-First Issue Authoring UX$/m);

  for (const term of [
    "Summary",
    "Scope",
    "Acceptance criteria",
    "Verification",
    "dependencies",
    "parallelization",
    "execution order",
  ]) {
    assert.match(note, new RegExp(term, "i"));
  }

  for (const surface of [
    "GitHub issue template",
    "docs/issue-metadata.md",
    "issue-lint",
    "CLI",
    "WebUI",
    "operator workflow",
  ]) {
    assert.match(note, new RegExp(surface.replace("/", "\\/"), "i"));
  }

  for (const unsafeInput of [
    "missing metadata",
    "unsafe scope",
    "ambiguous verification",
    "dependency",
    "order",
  ]) {
    assert.match(note, new RegExp(unsafeInput, "i"));
  }

  assert.match(note, /fail closed/i);
  assert.match(note, /node dist\/index\.js issue-lint <issue-number> --config <supervisor-config-path>/);
  assert.doesNotMatch(note, /\/Users\/[A-Za-z0-9._-]+\//);
  assert.doesNotMatch(note, /C:\\Users\\[A-Za-z0-9._-]+\\/);
});
