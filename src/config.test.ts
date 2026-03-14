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

test("loadConfig defaults localReviewHighSeverityAction to blocked", async (t) => {
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

  assert.equal(config.localReviewHighSeverityAction, "blocked");
});

test("loadConfig defaults reviewer-type local review thresholds from the global confidence threshold", async (t) => {
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
      localReviewConfidenceThreshold: 0.72,
    }),
    "utf8",
  );

  const config = loadConfig(configPath);

  assert.deepEqual(config.localReviewReviewerThresholds, {
    generic: {
      confidenceThreshold: 0.72,
      minimumSeverity: "low",
    },
    specialist: {
      confidenceThreshold: 0.72,
      minimumSeverity: "low",
    },
  });
});

test("loadConfig accepts reviewer-type local review thresholds", async (t) => {
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
      localReviewConfidenceThreshold: 0.7,
      localReviewReviewerThresholds: {
        generic: {
          confidenceThreshold: 0.9,
          minimumSeverity: "high",
        },
        specialist: {
          confidenceThreshold: 0.8,
          minimumSeverity: "medium",
        },
      },
    }),
    "utf8",
  );

  const config = loadConfig(configPath);

  assert.deepEqual(config.localReviewReviewerThresholds, {
    generic: {
      confidenceThreshold: 0.9,
      minimumSeverity: "high",
    },
    specialist: {
      confidenceThreshold: 0.8,
      minimumSeverity: "medium",
    },
  });
});

test("shipped example configs recommend block_merge for local review gating", async () => {
  const rootDir = path.resolve(__dirname, "..");
  const examplePaths = [
    path.join(rootDir, "supervisor.config.example.json"),
    path.join(rootDir, "supervisor.config.copilot.json"),
    path.join(rootDir, "supervisor.config.codex.json"),
    path.join(rootDir, "supervisor.config.coderabbit.json"),
    path.join(rootDir, "docs", "examples", "atlaspm.supervisor.config.example.json"),
  ];

  for (const examplePath of examplePaths) {
    const raw = JSON.parse(await fs.readFile(examplePath, "utf8")) as { localReviewPolicy?: unknown };
    assert.equal(raw.localReviewPolicy, "block_merge", `${path.relative(rootDir, examplePath)} should recommend block_merge`);
  }
});

test("shipped example configs recommend blocked for high-severity local review findings", async () => {
  const rootDir = path.resolve(__dirname, "..");
  const examplePaths = [
    path.join(rootDir, "supervisor.config.example.json"),
    path.join(rootDir, "supervisor.config.copilot.json"),
    path.join(rootDir, "supervisor.config.codex.json"),
    path.join(rootDir, "supervisor.config.coderabbit.json"),
    path.join(rootDir, "docs", "examples", "atlaspm.supervisor.config.example.json"),
  ];

  for (const examplePath of examplePaths) {
    const raw = JSON.parse(await fs.readFile(examplePath, "utf8")) as { localReviewHighSeverityAction?: unknown };
    assert.equal(
      raw.localReviewHighSeverityAction,
      "blocked",
      `${path.relative(rootDir, examplePath)} should recommend blocked for high-severity local review findings`,
    );
  }
});

test("shipped config profiles declare the intended review bot logins", async () => {
  const rootDir = path.resolve(__dirname, "..");
  const expectedProfiles = new Map<string, string[]>([
    ["supervisor.config.example.json", ["copilot-pull-request-reviewer"]],
    ["supervisor.config.copilot.json", ["copilot-pull-request-reviewer"]],
    ["supervisor.config.codex.json", ["chatgpt-codex-connector"]],
    ["supervisor.config.coderabbit.json", ["coderabbitai", "coderabbitai[bot]"]],
  ]);

  for (const [relativePath, expectedReviewBotLogins] of expectedProfiles) {
    const profilePath = path.join(rootDir, relativePath);
    const raw = JSON.parse(await fs.readFile(profilePath, "utf8")) as { reviewBotLogins?: unknown };
    assert.deepEqual(
      raw.reviewBotLogins,
      expectedReviewBotLogins,
      `${relativePath} should declare the expected reviewBotLogins`,
    );
  }
});
