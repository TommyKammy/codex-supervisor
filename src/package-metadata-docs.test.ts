import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";

interface PackageJson {
  name?: string;
  version?: string;
  private?: boolean;
  description?: string;
  license?: string;
  homepage?: string;
  repository?: string | { type?: string; url?: string; directory?: string };
  bugs?: { url?: string };
  bin?: unknown;
  exports?: unknown;
  files?: unknown;
  scripts?: Record<string, string>;
}

async function readRepoFile(relativePath: string): Promise<string> {
  return fs.readFile(path.join(process.cwd(), relativePath), "utf8");
}

async function readPackageJson(): Promise<PackageJson> {
  return JSON.parse(await readRepoFile("package.json")) as PackageJson;
}

test("package metadata matches the docs-first quality kit surface", async () => {
  const [packageJson, readme, qualityKit, packageSurfaces] = await Promise.all([
    readPackageJson(),
    readRepoFile("README.md"),
    readRepoFile(path.join("docs", "quality-kit.md")),
    readRepoFile(path.join("docs", "quality-kit-package-surfaces.md")),
  ]);

  assert.equal(packageJson.name, "codex-supervisor");
  assert.equal(packageJson.private, true, "quality kit is not published as an npm package in this phase");
  assert.match(packageJson.description ?? "", /quality layer/i);
  assert.equal(packageJson.license, "MIT");
  assert.equal(packageJson.homepage, "https://github.com/TommyKammy/codex-supervisor#readme");
  assert.deepEqual(packageJson.repository, {
    type: "git",
    url: "git+https://github.com/TommyKammy/codex-supervisor.git",
  });
  assert.deepEqual(packageJson.bugs, {
    url: "https://github.com/TommyKammy/codex-supervisor/issues",
  });

  assert.equal(packageJson.bin, undefined, "private docs-first package should not advertise an npm CLI bin");
  assert.equal(packageJson.exports, undefined, "private docs-first package should not advertise stable package API exports");
  assert.equal(packageJson.files, undefined, "private docs-first package should not imply a publishable npm payload");
  assert.equal(packageJson.scripts?.start, "node dist/index.js");
  assert.equal(packageJson.scripts?.dev, "tsx src/index.ts");

  for (const docsSource of [readme, qualityKit, packageSurfaces]) {
    assert.match(docsSource, /docs-first/i);
    assert.match(docsSource, /not (?:published|publish) as an npm package|does not publish an npm package/i);
    assert.doesNotMatch(docsSource, /npm install (?:-g\s+)?codex-supervisor/i);
  }

  assert.match(readme, /\[AI coding quality kit\]\(\.\/docs\/quality-kit\.md\)/i);
  assert.match(qualityKit, /external adopters should treat these artifacts as the stable, copyable quality-kit surface/i);
});
