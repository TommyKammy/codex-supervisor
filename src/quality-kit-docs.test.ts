import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const qualityKitPath = path.join("docs", "quality-kit.md");
const qualityKitPackageSurfacesPath = path.join("docs", "quality-kit-package-surfaces.md");

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

test("quality kit package surface comparison names the smallest adoption surface", async () => {
  const comparison = await readRepoFile(qualityKitPackageSurfacesPath);
  const readme = await readRepoFile("README.md");

  assert.match(comparison, /^# AI Coding Quality Kit Package Surfaces$/m);
  assert.doesNotMatch(comparison, /\/Users\/[A-Za-z0-9._-]+\//);
  assert.doesNotMatch(comparison, /C:\\Users\\[A-Za-z0-9._-]+\\/);

  for (const heading of [
    "Recommended Smallest Surface",
    "Viable Package Shapes",
    "Deferred Shape",
    "Tradeoff Summary",
    "KANAME Bootstrap Reuse",
  ]) {
    assert.match(comparison, new RegExp(`^## ${heading}$`, "m"), `expected ${heading} section`);
  }

  for (const packageShape of [
    "repo-owned schema collection",
    "npm package metadata",
    "templates/docs bundle",
    "KANAME bootstrap bundle",
  ]) {
    assert.match(comparison, new RegExp(packageShape, "i"), `expected ${packageShape} to be compared`);
  }

  for (const tradeoff of [
    "adoption friction",
    "versioning",
    "release burden",
    "copy/paste",
    "docs discoverability",
    "new-repo reuse",
  ]) {
    assert.match(comparison, new RegExp(tradeoff, "i"), `expected ${tradeoff} tradeoff`);
  }

  assert.match(comparison, /external users adopt first/i);
  assert.match(comparison, /no runtime orchestration/i);
  assert.match(comparison, /no WebUI/i);
  assert.match(comparison, /no provider SDK/i);
  assert.match(comparison, /no authority expansion/i);
  assert.match(readme, /\[Quality kit package surfaces\]\(\.\/docs\/quality-kit-package-surfaces\.md\)/i);
});

test("quality kit entrypoint defines the public package surface boundary", async () => {
  const qualityKit = await readRepoFile(qualityKitPath);
  const readme = await readRepoFile("README.md");

  assert.match(qualityKit, /^## Public Package Surface$/m);
  assert.match(qualityKit, /^## Internal-Only Surfaces$/m);
  assert.match(qualityKit, /Phase 18\.1 package-surface comparison/i);
  assert.match(qualityKit, /\[Quality kit package surfaces\]\(\.\/quality-kit-package-surfaces\.md\)/);

  for (const publicArtifact of [
    "docs/quality-kit.md",
    ".github/ISSUE_TEMPLATE/codex-execution-ready.md",
    "docs/issue-body-contract.schema.json",
    "docs/evidence-timeline.schema.json",
    "docs/operator-actions.schema.json",
    "docs/trust-posture-config.schema.json",
    "docs/codex-automation-connector-boundary.schema.json",
  ]) {
    assert.match(qualityKit, new RegExp(publicArtifact.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }

  for (const internalSurface of [
    "src/**/*.ts",
    "dist/",
    ".codex-supervisor/",
    ".local/",
    "WebUI",
    "KANAME",
  ]) {
    assert.match(qualityKit, new RegExp(internalSurface.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }

  assert.match(qualityKit, /does not publish a cloud service/i);
  assert.match(qualityKit, /does not publish a provider SDK/i);
  assert.match(qualityKit, /does not expand executor authority/i);
  assert.match(
    readme,
    /\[AI coding quality kit\]\(\.\/docs\/quality-kit\.md\): compact primitive map and public package surface/i,
  );
});
