import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { loadConfig } from "./config";

test("loadConfig leaves local-review model routing unset by default so current model behavior stays unchanged", async (t) => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "codex-supervisor-config-"));
  t.after(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });
  const configPath = path.join(tempDir, "supervisor.config.json");

  await fs.writeFile(
    configPath,
    JSON.stringify({
      repoPath: ".",
      repoSlug: "owner/repo",
      defaultBranch: "main",
      workspaceRoot: "./workspaces",
      stateFile: "./state.json",
      codexBinary: "codex",
      codexModelStrategy: "fixed",
      codexModel: "gpt-5-codex",
      branchPrefix: "codex/issue-",
    }),
    "utf8",
  );

  const config = loadConfig(configPath);

  assert.equal(config.localReviewModelStrategy, undefined);
  assert.equal(config.localReviewModel, undefined);
  assert.equal(config.codexModel, "gpt-5-codex");
});

test("loadConfig accepts explicit generic local-review model routing overrides", async (t) => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "codex-supervisor-config-"));
  t.after(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });
  const configPath = path.join(tempDir, "supervisor.config.json");

  await fs.writeFile(
    configPath,
    JSON.stringify({
      repoPath: ".",
      repoSlug: "owner/repo",
      defaultBranch: "main",
      workspaceRoot: "./workspaces",
      stateFile: "./state.json",
      codexBinary: "codex",
      codexModelStrategy: "fixed",
      codexModel: "gpt-5-codex",
      localReviewModelStrategy: "alias",
      localReviewModel: "local-review-fast",
      branchPrefix: "codex/issue-",
    }),
    "utf8",
  );

  const config = loadConfig(configPath);

  assert.equal(config.localReviewModelStrategy, "alias");
  assert.equal(config.localReviewModel, "local-review-fast");
});
