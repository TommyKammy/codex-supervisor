import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { loadConfig } from "./config";

test("loadConfig leaves bare codexBinary values unresolved for PATH lookup", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "codex-supervisor-config-"));
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
      branchPrefix: "codex/issue-",
    }),
    "utf8",
  );

  const config = loadConfig(configPath);

  assert.equal(config.codexBinary, "codex");
  assert.equal(config.repoPath, tempDir);
  assert.equal(config.workspaceRoot, path.join(tempDir, "workspaces"));
  assert.equal(config.stateFile, path.join(tempDir, "state.json"));
});

test("loadConfig still resolves codexBinary when it is an explicit relative path", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "codex-supervisor-config-"));
  const configPath = path.join(tempDir, "supervisor.config.json");

  await fs.writeFile(
    configPath,
    JSON.stringify({
      repoPath: ".",
      repoSlug: "owner/repo",
      defaultBranch: "main",
      workspaceRoot: "./workspaces",
      stateFile: "./state.json",
      codexBinary: "./bin/codex",
      branchPrefix: "codex/issue-",
    }),
    "utf8",
  );

  const config = loadConfig(configPath);

  assert.equal(config.codexBinary, path.join(tempDir, "bin", "codex"));
});
