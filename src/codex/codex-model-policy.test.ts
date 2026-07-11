import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { resolveHostCodexDefaultModel } from "./codex-model-policy";

test("resolveHostCodexDefaultModel ignores untrusted workspace config", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "codex-model-policy-untrusted-"));
  const codexHome = path.join(root, "codex-home");
  const workspace = path.join(root, "workspace");
  const previousCodexHome = process.env.CODEX_HOME;
  t.after(async () => {
    if (previousCodexHome === undefined) delete process.env.CODEX_HOME;
    else process.env.CODEX_HOME = previousCodexHome;
    await fs.rm(root, { recursive: true, force: true });
  });
  process.env.CODEX_HOME = codexHome;
  await fs.mkdir(path.join(workspace, ".codex"), { recursive: true });
  await fs.mkdir(codexHome, { recursive: true });
  await fs.writeFile(path.join(workspace, ".codex", "config.toml"), 'model = "gpt-5.6-sol"\n');
  await fs.writeFile(path.join(codexHome, "config.toml"), 'model = "gpt-5.4"\n');

  assert.deepEqual(await resolveHostCodexDefaultModel(workspace), {
    model: "gpt-5.4",
    source: path.join(codexHome, "config.toml"),
  });
});

test("resolveHostCodexDefaultModel loads workspace config only for an explicitly trusted project", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "codex-model-policy-trusted-"));
  const codexHome = path.join(root, "codex-home");
  const workspace = path.join(root, "workspace");
  const previousCodexHome = process.env.CODEX_HOME;
  t.after(async () => {
    if (previousCodexHome === undefined) delete process.env.CODEX_HOME;
    else process.env.CODEX_HOME = previousCodexHome;
    await fs.rm(root, { recursive: true, force: true });
  });
  process.env.CODEX_HOME = codexHome;
  await fs.mkdir(path.join(workspace, ".codex"), { recursive: true });
  await fs.mkdir(codexHome, { recursive: true });
  await fs.writeFile(path.join(workspace, ".codex", "config.toml"), 'model = "gpt-5.6-terra"\n');
  await fs.writeFile(
    path.join(codexHome, "config.toml"),
    `model = "gpt-5.4"\n\n[projects.${JSON.stringify(workspace)}]\ntrust_level = "trusted"\n`,
  );

  assert.deepEqual(await resolveHostCodexDefaultModel(workspace), {
    model: "gpt-5.6-terra",
    source: path.join(workspace, ".codex", "config.toml"),
  });
});

test("resolveHostCodexDefaultModel decodes TOML escapes in trusted project keys", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "codex-model-policy-escaped-trust-"));
  const codexHome = path.join(root, "codex-home");
  const workspace = path.join(root, String.raw`workspace\with\backslashes`);
  const previousCodexHome = process.env.CODEX_HOME;
  t.after(async () => {
    if (previousCodexHome === undefined) delete process.env.CODEX_HOME;
    else process.env.CODEX_HOME = previousCodexHome;
    await fs.rm(root, { recursive: true, force: true });
  });
  process.env.CODEX_HOME = codexHome;
  await fs.mkdir(path.join(workspace, ".codex"), { recursive: true });
  await fs.mkdir(codexHome, { recursive: true });
  await fs.writeFile(path.join(workspace, ".codex", "config.toml"), 'model = "gpt-5.6-terra"\n');
  await fs.writeFile(
    path.join(codexHome, "config.toml"),
    `model = "gpt-5.4"\n\n[projects.${JSON.stringify(workspace)}]\ntrust_level = "trusted"\n`,
  );

  assert.deepEqual(await resolveHostCodexDefaultModel(workspace), {
    model: "gpt-5.6-terra",
    source: path.join(workspace, ".codex", "config.toml"),
  });
});
