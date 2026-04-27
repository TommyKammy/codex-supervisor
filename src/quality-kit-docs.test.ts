import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const qualityKitPath = path.join("docs", "quality-kit.md");

async function readRepoFile(relativePath: string): Promise<string> {
  return fs.readFile(path.join(process.cwd(), relativePath), "utf8");
}

test("quality kit map publishes the primitive overview and source anchors", async () => {
  const qualityKit = await readRepoFile(qualityKitPath);

  assert.match(qualityKit, /^# AI Coding Quality Kit$/m);
  assert.match(qualityKit, /public product overview/i);
  assert.doesNotMatch(qualityKit, /\/Users\/[A-Za-z0-9._-]+\//);
  assert.doesNotMatch(qualityKit, /C:\\Users\\[A-Za-z0-9._-]+\\/);

  const requiredPrimitives = [
    "Issue Contract",
    "Local Verification Gate",
    "Prompt Safety Boundary",
    "Evidence Timeline",
    "Operator Action",
    "Durable History Writeback",
  ];

  for (const primitive of requiredPrimitives) {
    assert.match(qualityKit, new RegExp(`^## ${primitive}$`, "m"), `expected ${primitive} section`);
  }

  const requiredLinks = [
    "[Issue metadata](./issue-metadata.md)",
    "[issue body contract](./issue-body-contract.schema.json)",
    "[Configuration reference](./configuration.md)",
    "[Local review reference](./local-review.md)",
    "[AI agent handoff](./agent-instructions.md)",
    "[trust posture](./trust-posture-config.schema.json)",
    "[evidence timeline](./evidence-timeline.schema.json)",
    "[Operator actions](./operator-actions.schema.json)",
    "[Supervised automation lane](./supervised-automation-lane.md)",
    "[Architecture](./architecture.md)",
    "[self-contained demo scenario](./examples/self-contained-demo-scenario.md)",
  ];

  for (const link of requiredLinks) {
    assert.ok(qualityKit.includes(link), `expected quality kit map to link ${link}`);
  }

  assert.doesNotMatch(
    qualityKit,
    /\b(properties|definitions|required|enum|oneOf|anyOf|allOf)\b/i,
    "quality kit map should not duplicate schema internals",
  );
});

test("README and demo docs discover the quality kit map", async () => {
  const [readme, demo, walkthrough] = await Promise.all([
    readRepoFile("README.md"),
    readRepoFile("docs/examples/self-contained-demo-scenario.md"),
    readRepoFile("docs/examples/phase-16-dogfood-pr-walkthrough.md"),
  ]);

  assert.match(readme, /\[AI coding quality kit\]\(\.\/docs\/quality-kit\.md\)/i);
  assert.match(demo, /\[AI coding quality kit\]\(\.\.\/quality-kit\.md\)/i);
  assert.match(walkthrough, /\[AI coding quality kit\]\(\.\.\/quality-kit\.md\)/i);
});
