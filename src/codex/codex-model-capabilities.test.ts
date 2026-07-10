import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  clearCodexModelCapabilitiesCacheForTests,
  parseCodexModelCatalog,
  probeCodexModelCapabilities,
  resolveCodexModelCapabilities,
} from "./codex-model-capabilities";

test("parseCodexModelCatalog resolves GPT-5.6 reasoning levels and ignores unsupported future levels", async () => {
  const fixture = await fs.readFile(path.join(process.cwd(), "src/codex/fixtures/model-catalog-gpt-5.6.json"), "utf8");
  const catalog = parseCodexModelCatalog(fixture);
  assert.deepEqual([...catalog?.get("gpt-5.6-sol") ?? []], ["high", "xhigh", "max"]);
  assert.deepEqual([...catalog?.get("gpt-5.6-terra") ?? []], ["high", "xhigh", "max"]);
  assert.deepEqual([...catalog?.get("gpt-5.6-luna") ?? []], ["high", "xhigh", "max"]);
});

test("parseCodexModelCatalog normalizes catalog ultra support to max", () => {
  const catalog = parseCodexModelCatalog(JSON.stringify({
    models: [{ slug: "gpt-5.6-terra", supported_reasoning_levels: [{ effort: "ultra" }] }],
  }));
  assert.deepEqual([...catalog?.get("gpt-5.6-terra") ?? []], ["max"]);
});

test("probeCodexModelCapabilities captures catalogs larger than the default command output limit", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "codex-model-capabilities-large-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const binary = path.join(root, "large-catalog");
  await fs.writeFile(binary, `#!/usr/bin/env node
process.stdout.write(JSON.stringify({ models: [{ slug: "gpt-5.6-terra", supported_reasoning_levels: ["max"], description: "x".repeat(70_000) }] }));
`, { mode: 0o755 });

  const result = await probeCodexModelCapabilities(binary);
  assert.equal(result.source, "live_catalog");
  assert.equal(result.reasoningLevelsByModel.get("gpt-5.6-terra")?.has("max"), true);
});

test("resolveCodexModelCapabilities probes and caches catalogs per target workspace", async (t) => {
  clearCodexModelCapabilitiesCacheForTests();
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "codex-model-capabilities-workspace-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const binary = path.join(root, "workspace-catalog");
  const firstWorkspace = path.join(root, "workspace-a");
  const secondWorkspace = path.join(root, "workspace-b");
  await fs.mkdir(firstWorkspace);
  await fs.mkdir(secondWorkspace);
  await fs.writeFile(binary, `#!/bin/sh
slug=$(basename "$PWD")
printf '{"models":[{"slug":"%s","supported_reasoning_levels":["low"]}]}' "$slug"
`, { mode: 0o755 });

  const first = await resolveCodexModelCapabilities(binary, firstWorkspace);
  const firstAgain = await resolveCodexModelCapabilities(binary, firstWorkspace);
  const second = await resolveCodexModelCapabilities(binary, secondWorkspace);
  assert.strictEqual(firstAgain, first);
  assert.equal(first.reasoningLevelsByModel.has("workspace-a"), true);
  assert.equal(second.reasoningLevelsByModel.has("workspace-b"), true);
});

test("resolveCodexModelCapabilities retries after a transient fallback result", async (t) => {
  clearCodexModelCapabilitiesCacheForTests();
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "codex-model-capabilities-retry-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const binary = path.join(root, "recovering-catalog");
  await fs.writeFile(binary, `#!/bin/sh
marker="$PWD/.catalog-ready"
if [ ! -f "$marker" ]; then
  touch "$marker"
  exit 7
fi
printf '{"models":[{"slug":"gpt-5.6-terra","supported_reasoning_levels":["max"]}]}'
`, { mode: 0o755 });

  const first = await resolveCodexModelCapabilities(binary, root);
  const second = await resolveCodexModelCapabilities(binary, root);
  assert.equal(first.source, "fallback");
  assert.equal(first.fallbackReason, "catalog_probe_exit_7");
  assert.equal(second.source, "live_catalog");
  assert.equal(second.reasoningLevelsByModel.get("gpt-5.6-terra")?.has("max"), true);
});

test("probeCodexModelCapabilities falls back deterministically for malformed, non-zero, and timed-out probes", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "codex-model-capabilities-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const cases = [
    { name: "malformed", body: "printf 'not-json'", reason: "malformed_catalog", timeout: 1_000 },
    { name: "nonzero", body: "exit 7", reason: "catalog_probe_exit_7", timeout: 1_000 },
    { name: "timeout", body: "sleep 1", reason: "catalog_probe_timeout", timeout: 10 },
  ];
  for (const fixture of cases) {
    const binary = path.join(root, fixture.name);
    await fs.writeFile(binary, `#!/bin/sh\n${fixture.body}\n`, { mode: 0o755 });
    const result = await probeCodexModelCapabilities(binary, fixture.timeout);
    assert.equal(result.source, "fallback");
    assert.equal(result.fallbackReason, fixture.reason);
    assert.equal(result.reasoningLevelsByModel.get("gpt-5.6-sol")?.has("max"), true);
    assert.equal(result.reasoningLevelsByModel.has("gpt-5.6-terra"), false);
  }
});

test("parseCodexModelCatalog fails closed for malformed or unknown schemas", () => {
  assert.equal(parseCodexModelCatalog("not json"), null);
  assert.equal(parseCodexModelCatalog('{"models":[{"slug":"gpt-5.6-terra"}]}'), null);
  assert.equal(parseCodexModelCatalog('{"data":[]}'), null);
});
