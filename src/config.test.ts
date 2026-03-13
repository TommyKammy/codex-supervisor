import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { loadConfig } from "./config";

test("loadConfig leaves bare codexBinary values unresolved for PATH lookup", async (t) => {
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

test("loadConfig still resolves codexBinary when it is an explicit relative path", async (t) => {
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
      codexBinary: "./bin/codex",
      branchPrefix: "codex/issue-",
    }),
    "utf8",
  );

  const config = loadConfig(configPath);

  assert.equal(config.codexBinary, path.join(tempDir, "bin", "codex"));
});

test("loadConfig treats backslash-separated codexBinary values as explicit relative paths", async (t) => {
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
      codexBinary: ".\\bin\\codex",
      branchPrefix: "codex/issue-",
    }),
    "utf8",
  );

  const config = loadConfig(configPath);

  assert.equal(config.codexBinary, path.resolve(tempDir, ".\\bin\\codex"));
});

test("loadConfig defaults copilotReviewTimeoutAction to continue", async (t) => {
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
      branchPrefix: "codex/issue-",
    }),
    "utf8",
  );

  const config = loadConfig(configPath);

  assert.equal(config.copilotReviewTimeoutAction, "continue");
});

test("loadConfig accepts explicit copilotReviewTimeoutAction", async (t) => {
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
      branchPrefix: "codex/issue-",
      copilotReviewTimeoutAction: "block",
    }),
    "utf8",
  );

  const config = loadConfig(configPath);

  assert.equal(config.copilotReviewTimeoutAction, "block");
});
