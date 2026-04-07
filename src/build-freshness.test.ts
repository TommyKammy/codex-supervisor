import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { assertRuntimeFreshness, buildManifestPath, writeBuildManifest } from "./build-freshness";

async function createRepoFixture(): Promise<string> {
  const repoRoot = await fs.mkdtemp(path.join(os.tmpdir(), "codex-supervisor-build-freshness-"));
  await fs.mkdir(path.join(repoRoot, "src"), { recursive: true });
  await fs.mkdir(path.join(repoRoot, "dist"), { recursive: true });
  await fs.writeFile(path.join(repoRoot, "package.json"), JSON.stringify({ name: "fixture" }) + "\n", "utf8");
  await fs.writeFile(path.join(repoRoot, "tsconfig.json"), JSON.stringify({ compilerOptions: { outDir: "dist" } }) + "\n", "utf8");
  await fs.writeFile(path.join(repoRoot, "src", "index.ts"), "export const value = 1;\n", "utf8");
  return repoRoot;
}

test("assertRuntimeFreshness ignores non-dist entry scripts", async () => {
  const repoRoot = await createRepoFixture();

  await assert.doesNotReject(assertRuntimeFreshness(path.join(repoRoot, "src", "index.ts")));
});

test("assertRuntimeFreshness fails closed when source changed after the dist manifest was written", async () => {
  const repoRoot = await createRepoFixture();
  await writeBuildManifest(repoRoot);

  await fs.writeFile(path.join(repoRoot, "src", "index.ts"), "export const value = 2;\n", "utf8");

  await assert.rejects(
    assertRuntimeFreshness(path.join(repoRoot, "dist", "index.js")),
    /Stale compiled runtime detected: src\/, package\.json, or tsconfig\.json no longer match the compiled dist\/ output\..*npm run build/u,
  );
});

test("writeBuildManifest records a digest that clears the freshness guard", async () => {
  const repoRoot = await createRepoFixture();
  await writeBuildManifest(repoRoot);

  const manifest = JSON.parse(await fs.readFile(buildManifestPath(repoRoot), "utf8")) as { sourceDigest?: string };
  assert.match(manifest.sourceDigest ?? "", /^[a-f0-9]{64}$/u);

  await assert.doesNotReject(assertRuntimeFreshness(path.join(repoRoot, "dist", "index.js")));
});
