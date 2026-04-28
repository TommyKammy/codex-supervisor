import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const qualityKitPath = path.join("docs", "quality-kit.md");
const qualityKitPackageSurfacesPath = path.join("docs", "quality-kit-package-surfaces.md");
const qualityGateExamplesPath = path.join("docs", "examples", "quality-gate-examples.md");
const qualityKitTemplatesPath = path.join("docs", "templates", "quality-primitives");
const publicSchemaArtifactPaths = [
  "docs/issue-body-contract.schema.json",
  "docs/trust-posture-config.schema.json",
  "docs/operator-actions.schema.json",
  "docs/evidence-timeline.schema.json",
  "docs/supervised-automation-state-machine.schema.json",
  "docs/codex-automation-connector-boundary.schema.json",
];

async function readRepoFile(relativePath: string): Promise<string> {
  return fs.readFile(path.join(process.cwd(), relativePath), "utf8");
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
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
    "docs/supervised-automation-state-machine.schema.json",
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

test("public schema artifacts publish versioning and compatibility guidance", async () => {
  const qualityKit = await readRepoFile(qualityKitPath);

  assert.match(qualityKit, /^## Schema Versioning and Compatibility$/m);

  for (const artifactPath of publicSchemaArtifactPaths) {
    const source = await readRepoFile(artifactPath);
    const artifact = JSON.parse(source) as {
      contractVersion?: number;
      artifactVersion?: number;
      compatibilityPolicy?: {
        versionField?: string;
        enforcementBoundary?: string;
        additiveChanges?: string[];
        breakingChanges?: string[];
        stabilityLimit?: string;
      };
    };
    const versionField = artifact.contractVersion === undefined ? "artifactVersion" : "contractVersion";

    assert.equal(typeof artifact[versionField], "number", `${artifactPath} must expose ${versionField}`);
    assert.equal(
      artifact.compatibilityPolicy?.versionField,
      versionField,
      `${artifactPath} must identify its version field`,
    );
    assert.match(
      artifact.compatibilityPolicy?.enforcementBoundary ?? "",
      /issue-lint|config-loader|setup-readiness|src\/operator-actions\.ts|IssueRunTimelineExport|RunState|codex-supervisor-executor-safety-gates/i,
      `${artifactPath} must anchor compatibility to an existing enforcement boundary`,
    );
    assert.ok(
      (artifact.compatibilityPolicy?.additiveChanges ?? []).some((note) => /additive|optional|new fields|new enum values/i.test(note)),
      `${artifactPath} must explain additive changes`,
    );
    assert.ok(
      (artifact.compatibilityPolicy?.breakingChanges ?? []).some((note) => /breaking|required|remov|rename|semantic/i.test(note)),
      `${artifactPath} must explain breaking changes`,
    );
    assert.match(
      artifact.compatibilityPolicy?.stabilityLimit ?? "",
      /does not claim|not claim|no runtime enforcement|existing runtime|repo tag/i,
      `${artifactPath} must avoid overstating schema stability`,
    );
    assert.doesNotMatch(source, /\/Users\/[A-Za-z0-9._-]+\//);
    assert.doesNotMatch(source, /\/home\/[A-Za-z0-9._-]+\//);
    assert.doesNotMatch(source, /C:\\Users\\[A-Za-z0-9._-]+\\/);
  }
});

test("quality kit publishes path-safe copyable primitive templates", async () => {
  const qualityKit = await readRepoFile(qualityKitPath);
  const templateIndex = await readRepoFile(path.join(qualityKitTemplatesPath, "README.md"));
  const templateFiles = [
    "issue-contract.md",
    "agent-instructions.md",
    "local-ci-gate.md",
    "evidence-timeline.md",
    "trust-posture.md",
    "operator-actions.md",
  ];

  assert.match(qualityKit, /\[quality primitive templates\]\(\.\/templates\/quality-primitives\/README\.md\)/i);
  assert.match(templateIndex, /^# Quality Primitive Templates$/m);
  assert.match(templateIndex, /start with `issue-contract\.md` for a first safe issue/i);
  assert.match(templateIndex, /one adoption primitive/i);
  assert.doesNotMatch(templateIndex, /\/Users\/[A-Za-z0-9._-]+\//);
  assert.doesNotMatch(templateIndex, /\/home\/[A-Za-z0-9._-]+\//);
  assert.doesNotMatch(templateIndex, /C:\\Users\\[A-Za-z0-9._-]+\\/);

  for (const templateFile of templateFiles) {
    const template = await readRepoFile(path.join(qualityKitTemplatesPath, templateFile));
    assert.match(templateIndex, new RegExp(`\\(${escapeRegExp(templateFile)}\\)`), `expected index to link ${templateFile}`);
    assert.match(template, /<[^>\n]+>/, `expected ${templateFile} to use placeholders`);
    assert.doesNotMatch(template, /\/Users\/[A-Za-z0-9._-]+\//);
    assert.doesNotMatch(template, /\/home\/[A-Za-z0-9._-]+\//);
    assert.doesNotMatch(template, /C:\\Users\\[A-Za-z0-9._-]+\\/);
  }

  const issueContract = await readRepoFile(path.join(qualityKitTemplatesPath, "issue-contract.md"));
  assert.match(issueContract, /^## Summary$/m);
  assert.match(issueContract, /^## Scope$/m);
  assert.match(issueContract, /^## Acceptance criteria$/m);
  assert.match(issueContract, /^## Verification$/m);
  assert.match(issueContract, /^Depends on: none$/m);
  assert.match(issueContract, /^Parallelizable: No$/m);
  assert.match(issueContract, /^## Execution order$/m);
  assert.match(issueContract, /^1 of 1$/m);
  assert.match(issueContract, /node dist\/index\.js issue-lint <issue-number> --config <supervisor-config-path>/);

  const localCiGate = await readRepoFile(path.join(qualityKitTemplatesPath, "local-ci-gate.md"));
  assert.match(localCiGate, /local CI must not replace issue-lint/i);
  assert.match(localCiGate, /review/i);

  const trustPosture = await readRepoFile(path.join(qualityKitTemplatesPath, "trust-posture.md"));
  assert.match(trustPosture, /GitHub-authored text is untrusted context/i);
  assert.match(trustPosture, /does not grant executor authority/i);
});

test("quality gate examples publish offline adoption scenarios with safe review boundaries", async () => {
  const [qualityKit, readme, examples] = await Promise.all([
    readRepoFile(qualityKitPath),
    readRepoFile("README.md"),
    readRepoFile(qualityGateExamplesPath),
  ]);

  assert.match(qualityKit, /\[Quality gate examples\]\(\.\/examples\/quality-gate-examples\.md\)/);
  assert.match(readme, /\[Quality gate examples\]\(\.\/docs\/examples\/quality-gate-examples\.md\)/);
  assert.match(examples, /^# Quality Gate Examples$/m);
  assert.match(examples, /readable offline/i);
  assert.match(examples, /do not require live GitHub credentials/i);
  assert.doesNotMatch(examples, /\/Users\/[A-Za-z0-9._-]+\//);
  assert.doesNotMatch(examples, /\/home\/[A-Za-z0-9._-]+\//);
  assert.doesNotMatch(examples, /C:\\Users\\[A-Za-z0-9._-]+\\/);

  for (const heading of [
    "Local CI",
    "Path Hygiene",
    "Review Readiness",
    "Stale Review Bot Remediation Boundary",
    "Evidence Timeline",
  ]) {
    assert.match(examples, new RegExp(`^## ${heading}$`, "m"), `expected ${heading} example`);
  }

  for (const command of [
    "npm run verify:paths",
    "npm run verify:subprocess-safety",
    "npm run build",
    "node dist/index.js issue-lint <issue-number> --config <supervisor-config-path>",
    "node dist/index.js explain <issue-number> --timeline --config <supervisor-config-path>",
  ]) {
    assert.match(examples, new RegExp(escapeRegExp(command)), `expected ${command}`);
  }

  assert.match(examples, /SafeQuery-shaped metadata-only stale review bot/i);
  assert.match(examples, /metadata-only handled review state/i);
  assert.match(examples, /genuine unresolved provider-signal/i);
  assert.match(examples, /must stay unresolved/i);
  assert.doesNotMatch(examples, /metadata-only review auto-resolve/i);
  assert.doesNotMatch(examples, /provider-outage suppression/i);
});
