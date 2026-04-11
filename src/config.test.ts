import { execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import {
  findRepoOwnedWorkspacePreparationCandidate,
  loadConfig,
  loadConfigSummary,
  loadConfigSummaryFromDocument,
  summarizeCadenceDiagnostics,
} from "./core/config";
import { SupervisorConfig } from "./core/types";
import { buildSetupConfigPreview } from "./setup-config-preview";
import { updateSetupConfig } from "./setup-config-write";

function initGitRepo(repoPath: string): void {
  execFileSync("git", ["init"], { cwd: repoPath, stdio: "ignore" });
  execFileSync("git", ["config", "user.name", "Codex Test"], { cwd: repoPath, stdio: "ignore" });
  execFileSync("git", ["config", "user.email", "codex@example.com"], { cwd: repoPath, stdio: "ignore" });
}

function commitAll(repoPath: string, message: string): void {
  execFileSync("git", ["add", "."], { cwd: repoPath, stdio: "ignore" });
  execFileSync("git", ["commit", "-m", message], { cwd: repoPath, stdio: "ignore" });
}

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

test("loadConfigSummary reports missing required fields without throwing", async (t) => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "codex-supervisor-config-"));
  t.after(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });
  const configPath = path.join(tempDir, "supervisor.config.json");

  await fs.writeFile(
    configPath,
    JSON.stringify({
      repoPath: ".",
      defaultBranch: "main",
    }),
    "utf8",
  );

  const summary = loadConfigSummary(configPath);

  assert.equal(summary.status, "invalid_config");
  assert.deepEqual(summary.missingRequiredFields, [
    "repoSlug",
    "workspaceRoot",
    "stateFile",
    "codexBinary",
    "branchPrefix",
  ]);
  assert.equal(summary.config, null);
  assert.match(summary.error ?? "", /Missing or invalid config field: repoSlug/);
});

test("loadConfigSummaryFromDocument resolves config-relative paths for in-memory previews", () => {
  const configPath = path.join(process.cwd(), "fixtures", "supervisor.config.json");

  const summary = loadConfigSummaryFromDocument(
    {
      repoPath: ".",
      repoSlug: "owner/repo",
      defaultBranch: "main",
      workspaceRoot: "./workspaces",
      stateFile: "./state.json",
      codexBinary: "./bin/codex",
      branchPrefix: "codex/issue-",
    },
    configPath,
  );

  assert.equal(summary.status, "ready");
  assert.equal(summary.configPath, configPath);
  assert.equal(summary.config?.repoPath, path.join(path.dirname(configPath)));
  assert.equal(summary.config?.workspaceRoot, path.join(path.dirname(configPath), "workspaces"));
  assert.equal(summary.config?.stateFile, path.join(path.dirname(configPath), "state.json"));
  assert.equal(summary.config?.codexBinary, path.join(path.dirname(configPath), "bin", "codex"));
  assert.deepEqual(summary.missingRequiredFields, []);
  assert.deepEqual(summary.invalidFields, []);
});

test("loadConfigSummary surfaces the default trust diagnostics posture", async (t) => {
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

  const summary = loadConfigSummary(configPath);

  assert.deepEqual(summary.trustDiagnostics, {
    trustMode: "trusted_repo_and_authors",
    executionSafetyMode: "unsandboxed_autonomous",
    warning: "Unsandboxed autonomous execution assumes trusted GitHub-authored inputs.",
    configWarning: null,
  });
});

test("loadConfig keeps local review disabled by default while using the opinionated enabled posture", async (t) => {
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

  assert.equal(config.localReviewEnabled, false);
  assert.equal(config.localReviewAutoDetect, true);
  assert.deepEqual(config.localReviewRoles, []);
  assert.equal(config.localReviewPolicy, "block_merge");
  assert.equal(config.trackedPrCurrentHeadLocalReviewRequired, false);
  assert.equal(config.localReviewFollowUpRepairEnabled, false);
  assert.equal(config.localReviewManualReviewRepairEnabled, false);
  assert.equal(config.localReviewFollowUpIssueCreationEnabled, false);
  assert.equal(config.localReviewHighSeverityAction, "blocked");
  assert.equal(config.staleConfiguredBotReviewPolicy, "diagnose_only");
});

test("loadConfig accepts explicit local review same-PR follow-up repair opt-in", async (t) => {
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
      localReviewFollowUpRepairEnabled: true,
    }),
    "utf8",
  );

  const config = loadConfig(configPath);
  assert.equal(config.localReviewFollowUpRepairEnabled, true);
});

test("loadConfig accepts explicit local review same-PR manual-review repair opt-in", async (t) => {
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
      localReviewManualReviewRepairEnabled: true,
    }),
    "utf8",
  );

  const config = loadConfig(configPath);
  assert.equal(config.localReviewManualReviewRepairEnabled, true);
});

test("loadConfig accepts explicit local review follow-up issue creation opt-in", async (t) => {
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
      localReviewFollowUpIssueCreationEnabled: true,
    }),
    "utf8",
  );

  const config = loadConfig(configPath);
  assert.equal(config.localReviewFollowUpIssueCreationEnabled, true);
});

test("loadConfig rejects enabling same-PR follow-up repair together with follow-up issue creation", async (t) => {
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
      localReviewFollowUpRepairEnabled: true,
      localReviewFollowUpIssueCreationEnabled: true,
    }),
    "utf8",
  );

  const summary = loadConfigSummary(configPath);
  assert.equal(summary.status, "invalid_config");
  assert.deepEqual(summary.invalidFields, ["localReviewFollowUpRepairEnabled"]);
  assert.match(
    summary.error ?? "",
    /Invalid config field: localReviewFollowUpRepairEnabled \(cannot enable same-PR local-review follow-up repair together with localReviewFollowUpIssueCreationEnabled\)/,
  );

  assert.throws(
    () => loadConfig(configPath),
    /Invalid config field: localReviewFollowUpRepairEnabled \(cannot enable same-PR local-review follow-up repair together with localReviewFollowUpIssueCreationEnabled\)/,
  );
});

test("loadConfigSummary accepts an explicit safer trust diagnostics posture without warning", async (t) => {
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
      trustMode: "untrusted_or_mixed",
      executionSafetyMode: "operator_gated",
    }),
    "utf8",
  );

  const summary = loadConfigSummary(configPath);

  assert.deepEqual(summary.trustDiagnostics, {
    trustMode: "untrusted_or_mixed",
    executionSafetyMode: "operator_gated",
    warning: null,
    configWarning: null,
  });
});

test("findRepoOwnedWorkspacePreparationCandidate ignores untracked lockfiles", async (t) => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "codex-supervisor-config-"));
  t.after(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  initGitRepo(tempDir);
  await fs.writeFile(path.join(tempDir, "README.md"), "# fixture\n", "utf8");
  commitAll(tempDir, "seed");
  await fs.writeFile(path.join(tempDir, "package-lock.json"), "{}\n", "utf8");

  assert.equal(findRepoOwnedWorkspacePreparationCandidate(tempDir), null);
});

test("findRepoOwnedWorkspacePreparationCandidate recommends tracked lockfiles", async (t) => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "codex-supervisor-config-"));
  t.after(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  initGitRepo(tempDir);
  await fs.writeFile(path.join(tempDir, "README.md"), "# fixture\n", "utf8");
  await fs.writeFile(path.join(tempDir, "package-lock.json"), "{}\n", "utf8");
  commitAll(tempDir, "seed");

  assert.equal(findRepoOwnedWorkspacePreparationCandidate(tempDir), "npm ci");
});

test("loadConfig rejects negative orphan cleanup grace values", async (t) => {
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
      cleanupOrphanedWorkspacesAfterHours: -1,
    }),
    "utf8",
  );

  const summary = loadConfigSummary(configPath);
  assert.equal(summary.status, "invalid_config");
  assert.deepEqual(summary.invalidFields, ["cleanupOrphanedWorkspacesAfterHours"]);
  assert.match(summary.error ?? "", /Invalid config field: cleanupOrphanedWorkspacesAfterHours/);

  assert.throws(() => loadConfig(configPath), /Invalid config field: cleanupOrphanedWorkspacesAfterHours/);
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

test("loadConfig skips Epic titles by default during runnable selection", async (t) => {
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

  assert.deepEqual(config.skipTitlePrefixes, ["Epic:"]);
});

test("loadConfig exposes the configured candidate discovery fetch window", async (t) => {
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
      candidateDiscoveryFetchWindow: 250,
    }),
    "utf8",
  );

  const config = loadConfig(configPath);

  assert.equal(config.candidateDiscoveryFetchWindow, 250);
});

test("loadConfig exposes an optional repo-owned local CI command", async (t) => {
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
      localCiCommand: "npm run ci:local",
    }),
    "utf8",
  );

  const config = loadConfig(configPath);

  assert.equal(config.localCiCommand, "npm run ci:local");
});

test("loadConfig accepts a structured repo-owned local CI command", async (t) => {
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
      localCiCommand: {
        mode: "structured",
        executable: "npm",
        args: ["run", "ci:local"],
      },
    }),
    "utf8",
  );

  const config = loadConfig(configPath);

  assert.deepEqual(config.localCiCommand, {
    mode: "structured",
    executable: "npm",
    args: ["run", "ci:local"],
  });
});

test("loadConfig exposes an optional repo-owned workspace preparation command", async (t) => {
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
      workspacePreparationCommand: "npm ci",
    }),
    "utf8",
  );

  const config = loadConfig(configPath);

  assert.equal(config.workspacePreparationCommand, "npm ci");
});

test("loadConfig falls back to the default candidate discovery fetch window for invalid values", async (t) => {
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
      candidateDiscoveryFetchWindow: 0,
    }),
    "utf8",
  );

  const summary = loadConfigSummary(configPath);
  const config = loadConfig(configPath);

  assert.equal(summary.status, "ready");
  assert.equal(config.candidateDiscoveryFetchWindow, 100);
});

test("loadConfig maps reviewBotLogins into the internal configuredReviewProviders model", async (t) => {
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
      reviewBotLogins: ["CodeRabbitAI", "coderabbitai[bot]", "chatgpt-codex-connector"],
    }),
    "utf8",
  );

  const config = loadConfig(configPath);

  assert.deepEqual(config.reviewBotLogins, ["coderabbitai", "coderabbitai[bot]", "chatgpt-codex-connector"]);
  assert.deepEqual(config.configuredReviewProviders, [
    {
      kind: "coderabbit",
      reviewerLogins: ["coderabbitai", "coderabbitai[bot]"],
      signalSource: "review_threads",
    },
    {
      kind: "codex",
      reviewerLogins: ["chatgpt-codex-connector"],
      signalSource: "review_threads",
    },
  ]);
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

test("loadConfig rejects non-finite configuredBotRateLimitWaitMinutes by falling back to 0", async (t) => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "codex-supervisor-config-"));
  t.after(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });
  const configPath = path.join(tempDir, "supervisor.config.json");

  await fs.writeFile(
    configPath,
    `{
      "repoPath": ".",
      "repoSlug": "owner/repo",
      "defaultBranch": "main",
      "workspaceRoot": "./workspaces",
      "stateFile": "./state.json",
      "codexBinary": "codex",
      "branchPrefix": "codex/issue-",
      "configuredBotRateLimitWaitMinutes": 1e309
    }`,
    "utf8",
  );

  const config = loadConfig(configPath);

  assert.equal(config.configuredBotRateLimitWaitMinutes, 0);
});

test("loadConfig accepts an explicit configuredBotSettledWaitSeconds override", async (t) => {
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
      configuredBotSettledWaitSeconds: 3,
    }),
    "utf8",
  );

  const config = loadConfig(configPath) as ReturnType<typeof loadConfig> & {
    configuredBotSettledWaitSeconds?: number;
  };

  assert.equal(config.configuredBotSettledWaitSeconds, 3);
});

test("loadConfig accepts an explicit configuredBotInitialGraceWaitSeconds override", async (t) => {
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
      configuredBotInitialGraceWaitSeconds: 120,
    }),
    "utf8",
  );

  const config = loadConfig(configPath) as SupervisorConfig & {
    configuredBotInitialGraceWaitSeconds?: number;
  };

  assert.equal(config.configuredBotInitialGraceWaitSeconds, 120);
});

test("loadConfig accepts strict current-head configured-bot signal settings", async (t) => {
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
      workspaceRoot: "./.local/worktrees",
      stateBackend: "json",
      stateFile: "./.local/state.json",
      codexBinary: "codex",
      branchPrefix: "codex/issue-",
      configuredBotRequireCurrentHeadSignal: true,
      configuredBotCurrentHeadSignalTimeoutMinutes: 12,
      configuredBotCurrentHeadSignalTimeoutAction: "block",
    }),
    "utf8",
  );

  const config = loadConfig(configPath);
  assert.equal(config.configuredBotRequireCurrentHeadSignal, true);
  assert.equal(config.configuredBotCurrentHeadSignalTimeoutMinutes, 12);
  assert.equal(config.configuredBotCurrentHeadSignalTimeoutAction, "block");
});

test("loadConfig accepts explicit stale configured-bot reply_only policy", async (t) => {
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
      workspaceRoot: "./.local/worktrees",
      stateBackend: "json",
      stateFile: "./.local/state.json",
      codexBinary: "codex",
      branchPrefix: "codex/issue-",
      staleConfiguredBotReviewPolicy: "reply_only",
    }),
    "utf8",
  );

  const config = loadConfig(configPath);
  assert.equal(config.staleConfiguredBotReviewPolicy, "reply_only");
});

test("loadConfig rejects unsupported explicit stale configured-bot review policies", async (t) => {
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
      workspaceRoot: "./.local/worktrees",
      stateBackend: "json",
      stateFile: "./.local/state.json",
      codexBinary: "codex",
      branchPrefix: "codex/issue-",
      staleConfiguredBotReviewPolicy: "reply_and_resolve",
    }),
    "utf8",
  );

  const summary = loadConfigSummary(configPath);
  assert.equal(summary.status, "invalid_config");
  assert.deepEqual(summary.invalidFields, ["staleConfiguredBotReviewPolicy"]);
  assert.match(
    summary.error ?? "",
    /Invalid config field: staleConfiguredBotReviewPolicy \(unsupported value: reply_and_resolve; supported values: diagnose_only, reply_only\)/,
  );

  assert.throws(
    () => loadConfig(configPath),
    /Invalid config field: staleConfiguredBotReviewPolicy \(unsupported value: reply_and_resolve; supported values: diagnose_only, reply_only\)/,
  );
});

test("loadConfig accepts an explicit mergeCriticalRecheckSeconds override", async (t) => {
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
      pollIntervalSeconds: 120,
      mergeCriticalRecheckSeconds: 30,
    }),
    "utf8",
  );

  const config = loadConfig(configPath) as SupervisorConfig & {
    mergeCriticalRecheckSeconds?: number;
  };
  const summary = loadConfigSummary(configPath);

  assert.equal(config.mergeCriticalRecheckSeconds, 30);
  assert.equal(summary.config?.mergeCriticalRecheckSeconds, 30);
});

test("loadConfig disables mergeCriticalRecheckSeconds for invalid values and preserves poll cadence fallback", async (t) => {
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
      pollIntervalSeconds: 120,
      mergeCriticalRecheckSeconds: -5,
    }),
    "utf8",
  );

  const config = loadConfig(configPath) as SupervisorConfig & {
    mergeCriticalRecheckSeconds?: number;
  };
  const summary = loadConfigSummary(configPath);

  assert.equal(config.pollIntervalSeconds, 120);
  assert.equal(config.mergeCriticalRecheckSeconds, undefined);
  assert.equal(summary.config?.mergeCriticalRecheckSeconds, undefined);
});

test("summarizeCadenceDiagnostics disables invalid programmatic mergeCriticalRecheckSeconds values", () => {
  assert.deepEqual(
    summarizeCadenceDiagnostics({
      pollIntervalSeconds: 120,
      mergeCriticalRecheckSeconds: Number.POSITIVE_INFINITY,
    }),
    {
      pollIntervalSeconds: 120,
      mergeCriticalRecheckSeconds: null,
      mergeCriticalEffectiveSeconds: 120,
      mergeCriticalRecheckEnabled: false,
    },
  );

  assert.deepEqual(
    summarizeCadenceDiagnostics({
      pollIntervalSeconds: 120,
      mergeCriticalRecheckSeconds: 1.5,
    }),
    {
      pollIntervalSeconds: 120,
      mergeCriticalRecheckSeconds: null,
      mergeCriticalEffectiveSeconds: 120,
      mergeCriticalRecheckEnabled: false,
    },
  );
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

test("shipped starter config profiles keep local review disabled until operators opt in", async () => {
  const rootDir = path.resolve(__dirname, "..");
  const examplePaths = [
    path.join(rootDir, "supervisor.config.example.json"),
    path.join(rootDir, "supervisor.config.copilot.json"),
    path.join(rootDir, "supervisor.config.codex.json"),
    path.join(rootDir, "supervisor.config.coderabbit.json"),
  ];

  for (const examplePath of examplePaths) {
    const raw = JSON.parse(await fs.readFile(examplePath, "utf8")) as { localReviewEnabled?: unknown };
    assert.equal(raw.localReviewEnabled, false, `${path.relative(rootDir, examplePath)} should keep local review disabled by default`);
  }
});

test("shipped example configs keep local-review follow-up issue creation opt-in", async () => {
  const rootDir = path.resolve(__dirname, "..");
  const examplePaths = [
    path.join(rootDir, "supervisor.config.example.json"),
    path.join(rootDir, "supervisor.config.copilot.json"),
    path.join(rootDir, "supervisor.config.codex.json"),
    path.join(rootDir, "supervisor.config.coderabbit.json"),
    path.join(rootDir, "docs", "examples", "atlaspm.supervisor.config.example.json"),
  ];

  for (const examplePath of examplePaths) {
    const raw = JSON.parse(await fs.readFile(examplePath, "utf8")) as {
      localReviewFollowUpIssueCreationEnabled?: unknown;
    };
    assert.equal(
      raw.localReviewFollowUpIssueCreationEnabled,
      false,
      `${path.relative(rootDir, examplePath)} should keep local-review follow-up issue creation opt-in`,
    );
  }
});

test("shipped example configs keep local-review same-PR follow-up repair opt-in", async () => {
  const rootDir = path.resolve(__dirname, "..");
  const examplePaths = [
    path.join(rootDir, "supervisor.config.example.json"),
    path.join(rootDir, "supervisor.config.copilot.json"),
    path.join(rootDir, "supervisor.config.codex.json"),
    path.join(rootDir, "supervisor.config.coderabbit.json"),
    path.join(rootDir, "docs", "examples", "atlaspm.supervisor.config.example.json"),
  ];

  for (const examplePath of examplePaths) {
    const raw = JSON.parse(await fs.readFile(examplePath, "utf8")) as {
      localReviewFollowUpRepairEnabled?: unknown;
    };
    assert.equal(
      raw.localReviewFollowUpRepairEnabled,
      false,
      `${path.relative(rootDir, examplePath)} should keep local-review same-PR follow-up repair opt-in`,
    );
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

test("shipped example configs use the issue-scoped journal path template and preserve custom overrides", async (t) => {
  const rootDir = path.resolve(__dirname, "..");
  const expectedJournalPath = ".codex-supervisor/issues/{issueNumber}/issue-journal.md";
  const examplePaths = [
    path.join(rootDir, "supervisor.config.example.json"),
    path.join(rootDir, "supervisor.config.copilot.json"),
    path.join(rootDir, "supervisor.config.codex.json"),
    path.join(rootDir, "supervisor.config.coderabbit.json"),
    path.join(rootDir, "docs", "examples", "atlaspm.supervisor.config.example.json"),
  ];

  for (const examplePath of examplePaths) {
    const raw = JSON.parse(await fs.readFile(examplePath, "utf8")) as { issueJournalRelativePath?: unknown };
    assert.equal(
      raw.issueJournalRelativePath,
      expectedJournalPath,
      `${path.relative(rootDir, examplePath)} should use the issue-scoped journal path template`,
    );
  }

  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "codex-supervisor-config-"));
  t.after(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  const configPath = path.join(tempDir, "supervisor.config.json");
  const customJournalPath = ".codex-supervisor/custom-journal.md";
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
      issueJournalRelativePath: customJournalPath,
    }),
    "utf8",
  );

  const config = loadConfig(configPath);
  assert.equal(config.issueJournalRelativePath, customJournalPath);
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

test("shipped CodeRabbit starter profile uses a fail-fast repoSlug placeholder", async () => {
  const rootDir = path.resolve(__dirname, "..");
  const profilePath = path.join(rootDir, "supervisor.config.coderabbit.json");
  const raw = JSON.parse(await fs.readFile(profilePath, "utf8")) as { repoSlug?: unknown };
  const repoSlug = raw.repoSlug;

  if (typeof repoSlug !== "string") {
    assert.fail("supervisor.config.coderabbit.json should define repoSlug as a string");
  }
  assert.notEqual(repoSlug, "TommyKammy/codex-supervisor");
  assert.match(
    repoSlug,
    /^[^/]+$/u,
    "supervisor.config.coderabbit.json should force operators to replace repoSlug before loadConfig accepts it",
  );
});

test("shipped CodeRabbit starter profile preserves the default Epic skip policy", async () => {
  const rootDir = path.resolve(__dirname, "..");
  const profilePath = path.join(rootDir, "supervisor.config.coderabbit.json");
  const raw = JSON.parse(await fs.readFile(profilePath, "utf8")) as { skipTitlePrefixes?: unknown };

  assert.deepEqual(
    raw.skipTitlePrefixes,
    ["Epic:"],
    "supervisor.config.coderabbit.json should preserve the default Epic skip policy unless operators intentionally override it",
  );
});

test("shipped CodeRabbit starter profile enables strict current-head provider gating with a bounded timeout", async () => {
  const rootDir = path.resolve(__dirname, "..");
  const profilePath = path.join(rootDir, "supervisor.config.coderabbit.json");
  const raw = JSON.parse(await fs.readFile(profilePath, "utf8")) as {
    configuredBotRequireCurrentHeadSignal?: unknown;
    configuredBotCurrentHeadSignalTimeoutMinutes?: unknown;
    configuredBotCurrentHeadSignalTimeoutAction?: unknown;
  };

  assert.equal(raw.configuredBotRequireCurrentHeadSignal, true);
  assert.equal(raw.configuredBotCurrentHeadSignalTimeoutMinutes, 10);
  assert.equal(raw.configuredBotCurrentHeadSignalTimeoutAction, "block");
});

test("repo gitignore ignores .DS_Store without hiding host-specific coderabbit config", async (t) => {
  const rootDir = path.resolve(__dirname, "..");
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "codex-supervisor-gitignore-"));
  t.after(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  await fs.copyFile(path.join(rootDir, ".gitignore"), path.join(tempDir, ".gitignore"));
  await fs.writeFile(path.join(tempDir, ".DS_Store"), "", "utf8");
  await fs.writeFile(path.join(tempDir, "supervisor.config.coderabbit.json"), "{}", "utf8");

  execFileSync("git", ["init"], {
    cwd: tempDir,
    stdio: "ignore",
  });

  const ignoredPath = execFileSync("git", ["check-ignore", ".DS_Store"], {
    cwd: tempDir,
    encoding: "utf8",
  }).trim();
  assert.equal(ignoredPath, ".DS_Store");

  const coderabbitExitCode = (() => {
    try {
      execFileSync("git", ["check-ignore", "supervisor.config.coderabbit.json"], {
        cwd: tempDir,
        stdio: "ignore",
      });
      return 0;
    } catch (error) {
      const exitCode = (error as NodeJS.ErrnoException & { status?: number }).status;
      return typeof exitCode === "number" ? exitCode : -1;
    }
  })();
  assert.equal(coderabbitExitCode, 1);
});

test("README stays a lightweight landing page with provider profile guidance and a docs map", async () => {
  const rootDir = path.resolve(__dirname, "..");
  const readme = await fs.readFile(path.join(rootDir, "README.md"), "utf8");

  assert.match(readme, /^## What It Is$/m);
  assert.match(readme, /^## Who It Is For$/m);
  assert.match(readme, /^## Quick Start$/m);
  assert.match(readme, /^## Provider Profiles$/m);
  assert.match(readme, /^## Docs Map$/m);
  assert.match(readme, /\[Getting started\]\(\.\/docs\/getting-started\.md\)/i);
  assert.match(readme, /\[Configuration reference\]\(\.\/docs\/configuration\.md\)/i);
  assert.match(readme, /\[Local review reference\]\(\.\/docs\/local-review\.md\)/i);
  assert.match(readme, /\[Architecture\]\(\.\/docs\/architecture\.md\)/i);
  assert.match(readme, /\[Issue metadata\]\(\.\/docs\/issue-metadata\.md\)/i);
  assert.match(readme, /\[GSD to GitHub issues\]\(\.\/docs\/examples\/gsd-to-github-issues\.md\)/i);
  assert.match(readme, /\[Validation checklist\]\(\.\/docs\/validation-checklist\.md\)/i);
  assert.match(readme, /Copilot profile/i);
  assert.match(readme, /Codex Connector profile/i);
  assert.match(readme, /CodeRabbit profile/i);
  assert.match(readme, /review provider profile/i);
  assert.match(readme, /provider-side setup/i);
  assert.match(readme, /supervisor\.config\.copilot\.json/i);
  assert.match(readme, /supervisor\.config\.codex\.json/i);
  assert.match(readme, /supervisor\.config\.coderabbit\.json/i);
  assert.doesNotMatch(readme, /review-bot profile/i);
  assert.doesNotMatch(readme, /^## Run states$/m);
  assert.doesNotMatch(readme, /^## State backends$/m);
  assert.doesNotMatch(readme, /^## Commands$/m);
});

test("getting started links to focused configuration and local review references", async () => {
  const rootDir = path.resolve(__dirname, "..");
  const gettingStarted = await fs.readFile(path.join(rootDir, "docs", "getting-started.md"), "utf8");
  const localReview = await fs.readFile(path.join(rootDir, "docs", "local-review.md"), "utf8");
  const issueMetadata = await fs.readFile(path.join(rootDir, "docs", "issue-metadata.md"), "utf8");

  assert.match(gettingStarted, /\[Configuration reference\]\(\.\/configuration\.md\)/i);
  assert.match(gettingStarted, /\[Local review reference\]\(\.\/local-review\.md\)/i);
  assert.match(gettingStarted, /\[Issue metadata reference\]\(\.\/issue-metadata\.md\)/i);
  assert.match(gettingStarted, /review provider profile/i);
  assert.match(gettingStarted, /provider-specific review settings/i);
  assert.match(gettingStarted, /disabled by default/i);
  assert.match(gettingStarted, /recommended once enabled/i);
  assert.doesNotMatch(gettingStarted, /review-bot profile/i);
  assert.doesNotMatch(gettingStarted, /^### Option 1: Auto-detect roles$/m);
  assert.doesNotMatch(gettingStarted, /^### Option 2: Explicit roles$/m);
  assert.doesNotMatch(gettingStarted, /^### What specialist roles are for$/m);
  assert.doesNotMatch(gettingStarted, /^Committed Local Review Swarm guardrails are maintained under `docs\/shared-memory\/`:$/m);
  assert.doesNotMatch(gettingStarted, /^## Issue metadata format$/m);

  assert.match(localReview, /^# Local Review Reference$/m);
  assert.match(localReview, /^## Choosing reviewer roles$/m);
  assert.match(localReview, /^## Artifacts, thresholds, and guardrails$/m);
  assert.match(localReview, /disabled by default/i);
  assert.match(localReview, /recommended once enabled/i);

  assert.match(issueMetadata, /^# Issue Metadata$/m);
  assert.match(issueMetadata, /^## Canonical fields$/m);
  assert.match(issueMetadata, /^## How scheduling uses the fields$/m);
  assert.match(issueMetadata, /pages through matching open issues/i);
  assert.match(issueMetadata, /matching open backlog/i);
  assert.match(issueMetadata, /older issue should remain discoverable/i);
  assert.match(issueMetadata, /^## Issue body template$/m);
  assert.match(issueMetadata, /Part of: #42/m);
  assert.match(issueMetadata, /Depends on: #41/m);
  assert.match(issueMetadata, /child issues should use `Part of: #42` to associate with an epic/i);
  assert.match(issueMetadata, /do not use `Depends on: #42` when `#42` is only the parent epic/i);
  assert.match(issueMetadata, /recommended/i);
  assert.match(issueMetadata, /discouraged/i);
  assert.match(issueMetadata, /Parallelizable: No/m);
  assert.match(issueMetadata, /## Execution order/m);
  assert.match(issueMetadata, /2 of 4/m);
  assert.match(issueMetadata, /## Acceptance criteria/m);
  assert.match(issueMetadata, /## Verification/m);
});

test("buildSetupConfigPreview preserves unknown fields and leaves the config file untouched", async (t) => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "codex-supervisor-config-preview-"));
  t.after(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });
  const configPath = path.join(tempDir, "supervisor.config.json");
  const originalDocument = {
    repoPath: ".",
    repoSlug: "owner/repo",
    defaultBranch: "main",
    experimentalFlag: {
      keep: true,
    },
    reviewBotLogins: ["existing-review-bot"],
  };

  await fs.writeFile(configPath, JSON.stringify(originalDocument, null, 2), "utf8");
  const before = await fs.readFile(configPath, "utf8");

  const preview = buildSetupConfigPreview({
    configPath,
    reviewProviderProfile: "codex",
  });

  const after = await fs.readFile(configPath, "utf8");

  assert.equal(preview.kind, "setup_config_preview");
  assert.equal(preview.mode, "patch");
  assert.equal(preview.writesConfig, false);
  assert.equal(preview.selectedReviewProviderProfile, "codex");
  assert.deepEqual(preview.preservedUnknownFields, ["experimentalFlag"]);
  assert.deepEqual(preview.document.experimentalFlag, { keep: true });
  assert.deepEqual(preview.document.reviewBotLogins, ["chatgpt-codex-connector"]);
  assert.equal(preview.validation.status, "ready");
  assert.equal(before, after);
});

test("updateSetupConfig preserves unrelated fields, writes a backup, and refreshes readiness", async (t) => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "codex-supervisor-config-update-"));
  t.after(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });
  const configPath = path.join(tempDir, "supervisor.config.json");
  await fs.writeFile(
    configPath,
    JSON.stringify(
      {
        repoPath: ".",
        repoSlug: "owner/repo",
        defaultBranch: "main",
        workspaceRoot: "./worktrees",
        stateFile: "./state.json",
        codexBinary: "codex",
        branchPrefix: "codex/issue-",
        reviewBotLogins: [],
        experimentalFlag: {
          keep: true,
        },
      },
      null,
      2,
    ),
    "utf8",
  );

  const result = await updateSetupConfig({
    configPath,
    changes: {
      reviewProvider: "codex",
    },
  });

  const updatedDocument = JSON.parse(await fs.readFile(configPath, "utf8")) as Record<string, unknown>;
  assert.ok(result.backupPath, "Expected backupPath to be set when updating an existing config");
  const backupDocument = JSON.parse(await fs.readFile(result.backupPath, "utf8")) as Record<string, unknown>;

  assert.deepEqual(result.updatedFields, ["reviewProvider"]);
  assert.equal(result.restartRequired, true);
  assert.equal(result.restartScope, "supervisor");
  assert.deepEqual(result.restartTriggeredByFields, ["reviewProvider"]);
  assert.deepEqual(updatedDocument.reviewBotLogins, ["chatgpt-codex-connector"]);
  assert.deepEqual(updatedDocument.experimentalFlag, { keep: true });
  assert.deepEqual(backupDocument.reviewBotLogins, []);
  assert.deepEqual(backupDocument.experimentalFlag, { keep: true });
  assert.equal(result.readiness.kind, "setup_readiness");
  assert.equal(result.readiness.providerPosture.profile, "codex");
});

test("updateSetupConfig rotates multiple backups across consecutive writes with bounded retention", async (t) => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "codex-supervisor-config-update-rotate-"));
  t.after(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });
  const configPath = path.join(tempDir, "supervisor.config.json");
  await fs.writeFile(
    configPath,
    JSON.stringify(
      {
        repoPath: ".",
        repoSlug: "owner/repo",
        defaultBranch: "main",
        workspaceRoot: "./worktrees",
        stateFile: "./state.json",
        codexBinary: "codex",
        branchPrefix: "codex/issue-",
        reviewBotLogins: [],
      },
      null,
      2,
    ),
    "utf8",
  );

  const firstResult = await updateSetupConfig({
    configPath,
    changes: {
      reviewProvider: "codex",
    },
  });
  const secondResult = await updateSetupConfig({
    configPath,
    changes: {
      branchPrefix: "codex/task-",
    },
  });
  for (let index = 0; index < 6; index += 1) {
    await updateSetupConfig({
      configPath,
      changes: {
        defaultBranch: `main-${index}`,
      },
    });
  }

  assert.ok(firstResult.backupPath);
  assert.ok(secondResult.backupPath);
  assert.equal(firstResult.backupPath, secondResult.backupPath);

  const backupPaths = (await fs.readdir(tempDir))
    .filter((entry) => entry.startsWith("supervisor.config.json.bak"))
    .sort()
    .map((entry) => path.join(tempDir, entry));

  assert.deepEqual(backupPaths, [
    path.join(tempDir, "supervisor.config.json.bak"),
    path.join(tempDir, "supervisor.config.json.bak.1"),
    path.join(tempDir, "supervisor.config.json.bak.2"),
    path.join(tempDir, "supervisor.config.json.bak.3"),
    path.join(tempDir, "supervisor.config.json.bak.4"),
  ]);

  const secondBackupDocument = JSON.parse(await fs.readFile(secondResult.backupPath, "utf8")) as Record<string, unknown>;
  const oldestRetainedBackup = JSON.parse(
    await fs.readFile(path.join(tempDir, "supervisor.config.json.bak.4"), "utf8"),
  ) as Record<string, unknown>;

  assert.deepEqual(secondBackupDocument.reviewBotLogins, ["chatgpt-codex-connector"]);
  assert.equal(secondBackupDocument.defaultBranch, "main-4");
  assert.equal(oldestRetainedBackup.defaultBranch, "main-0");
});

test("updateSetupConfig reports no restart requirement when a typed setup write is a no-op", async (t) => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "codex-supervisor-config-update-noop-"));
  t.after(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });
  const configPath = path.join(tempDir, "supervisor.config.json");
  await fs.writeFile(
    configPath,
    JSON.stringify(
      {
        repoPath: ".",
        repoSlug: "owner/repo",
        defaultBranch: "main",
        workspaceRoot: "./worktrees",
        stateFile: "./state.json",
        codexBinary: "codex",
        branchPrefix: "codex/issue-",
        reviewBotLogins: ["chatgpt-codex-connector"],
      },
      null,
      2,
    ),
    "utf8",
  );

  const result = await updateSetupConfig({
    configPath,
    changes: {
      reviewProvider: "codex",
    },
  });

  assert.deepEqual(result.updatedFields, ["reviewProvider"]);
  assert.equal(result.restartRequired, false);
  assert.equal(result.restartScope, null);
  assert.deepEqual(result.restartTriggeredByFields, []);
  assert.equal(result.readiness.kind, "setup_readiness");
  assert.equal(result.readiness.providerPosture.profile, "codex");
});

test("updateSetupConfig accepts localCiCommand through the setup-owned write surface", async (t) => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "codex-supervisor-config-update-local-ci-"));
  t.after(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });
  const configPath = path.join(tempDir, "supervisor.config.json");
  const repoPath = path.join(tempDir, "repo");
  await fs.mkdir(repoPath, { recursive: true });
  await fs.writeFile(
    path.join(repoPath, "package.json"),
    JSON.stringify({
      scripts: {
        "verify:pre-pr": "npm test",
      },
    }),
    "utf8",
  );
  await fs.writeFile(
    configPath,
    JSON.stringify(
      {
        repoPath,
        repoSlug: "owner/repo",
        defaultBranch: "main",
        workspaceRoot: path.join(tempDir, "worktrees"),
        stateFile: path.join(tempDir, "state.json"),
        codexBinary: process.execPath,
        branchPrefix: "codex/issue-",
        reviewBotLogins: ["chatgpt-codex-connector"],
        experimentalFlag: true,
      },
      null,
      2,
    ),
    "utf8",
  );

  const result = await updateSetupConfig({
    configPath,
    changes: {
      localCiCommand: "npm run verify:pre-pr",
    },
  });

  const updatedDocument = JSON.parse(await fs.readFile(configPath, "utf8")) as Record<string, unknown>;
  assert.deepEqual(result.updatedFields, ["localCiCommand"]);
  assert.equal(result.restartRequired, true);
  assert.equal(result.restartScope, "supervisor");
  assert.deepEqual(result.restartTriggeredByFields, ["localCiCommand"]);
  assert.equal(updatedDocument.localCiCommand, "npm run verify:pre-pr");
  assert.equal(updatedDocument.experimentalFlag, true);
  assert.deepEqual(result.readiness.localCiContract, {
    configured: true,
    command: "npm run verify:pre-pr",
    recommendedCommand: null,
    source: "config",
    summary: "Repo-owned local CI contract is configured.",
    warning:
      "localCiCommand is configured but workspacePreparationCommand is unset. Configure a repo-owned workspacePreparationCommand so preserved issue worktrees can prepare toolchains before host-local CI runs. GitHub checks can stay green while host-local CI still blocks tracked PR progress.",
  });
});

test("updateSetupConfig clears localCiCommand back to the unset state", async (t) => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "codex-supervisor-config-update-local-ci-clear-"));
  t.after(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });
  const configPath = path.join(tempDir, "supervisor.config.json");
  const repoPath = path.join(tempDir, "repo");
  await fs.mkdir(repoPath, { recursive: true });
  await fs.writeFile(
    path.join(repoPath, "package.json"),
    JSON.stringify({
      scripts: {
        "verify:pre-pr": "npm test",
      },
    }),
    "utf8",
  );
  await fs.writeFile(
    configPath,
    JSON.stringify(
      {
        repoPath,
        repoSlug: "owner/repo",
        defaultBranch: "main",
        workspaceRoot: path.join(tempDir, "worktrees"),
        stateFile: path.join(tempDir, "state.json"),
        codexBinary: process.execPath,
        branchPrefix: "codex/issue-",
        reviewBotLogins: ["chatgpt-codex-connector"],
        localCiCommand: "npm run ci:local",
        experimentalFlag: true,
      },
      null,
      2,
    ),
    "utf8",
  );

  const result = await updateSetupConfig({
    configPath,
    changes: {
      localCiCommand: null,
    },
  });

  const updatedDocument = JSON.parse(await fs.readFile(configPath, "utf8")) as Record<string, unknown>;
  assert.ok(!("localCiCommand" in updatedDocument));
  assert.equal(updatedDocument.experimentalFlag, true);
  assert.deepEqual(result.updatedFields, ["localCiCommand"]);
  assert.equal(result.restartRequired, true);
  assert.equal(result.restartScope, "supervisor");
  assert.deepEqual(result.restartTriggeredByFields, ["localCiCommand"]);
  assert.deepEqual(result.readiness.localCiContract, {
    configured: false,
    command: null,
    recommendedCommand: "npm run verify:pre-pr",
    source: "repo_script_candidate",
    summary: "Repo-owned local CI candidate exists but localCiCommand is unset. Recommended command: npm run verify:pre-pr.",
    warning: null,
  });
});

test("updateSetupConfig rejects invalid setup field values before touching the config file", async (t) => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "codex-supervisor-config-update-invalid-"));
  t.after(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });
  const configPath = path.join(tempDir, "supervisor.config.json");
  const originalDocument = {
    repoPath: ".",
    repoSlug: "owner/repo",
    defaultBranch: "main",
    workspaceRoot: "./worktrees",
    stateFile: "./state.json",
    codexBinary: "codex",
    branchPrefix: "codex/issue-",
    reviewBotLogins: [],
    experimentalFlag: true,
  };
  await fs.writeFile(configPath, JSON.stringify(originalDocument, null, 2), "utf8");
  const before = await fs.readFile(configPath, "utf8");

  await assert.rejects(
    () =>
      updateSetupConfig({
        configPath,
        changes: {
          repoSlug: "not-a-slug",
        },
      }),
    /repoSlug must use owner\/repo format\./u,
  );

  const after = await fs.readFile(configPath, "utf8");
  assert.equal(after, before);
  await assert.rejects(fs.access(`${configPath}.bak`));
});

test("updateSetupConfig rejects missing repo-relative workspacePreparationCommand helpers before touching the config file", async (t) => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "codex-supervisor-config-update-workspace-prep-missing-"));
  t.after(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });
  const repoPath = path.join(tempDir, "repo");
  await fs.mkdir(repoPath, { recursive: true });
  initGitRepo(repoPath);

  const configPath = path.join(tempDir, "supervisor.config.json");
  const originalDocument = {
    repoPath,
    repoSlug: "owner/repo",
    defaultBranch: "main",
    workspaceRoot: path.join(tempDir, "worktrees"),
    stateFile: path.join(tempDir, "state.json"),
    codexBinary: process.execPath,
    branchPrefix: "codex/issue-",
    reviewBotLogins: [],
    experimentalFlag: true,
  };
  await fs.writeFile(configPath, JSON.stringify(originalDocument, null, 2), "utf8");
  const before = await fs.readFile(configPath, "utf8");

  await assert.rejects(
    () =>
      updateSetupConfig({
        configPath,
        changes: {
          workspacePreparationCommand: "./scripts/prepare-workspace.sh",
        },
      }),
    /workspacePreparationCommand points at \.\/scripts\/prepare-workspace\.sh, but that path does not resolve to a file inside repoPath\./u,
  );

  const after = await fs.readFile(configPath, "utf8");
  assert.equal(after, before);
  await assert.rejects(fs.access(`${configPath}.bak`));
});

test("updateSetupConfig rejects untracked repo-relative workspacePreparationCommand helpers before touching the config file", async (t) => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "codex-supervisor-config-update-workspace-prep-untracked-"));
  t.after(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });
  const repoPath = path.join(tempDir, "repo");
  await fs.mkdir(path.join(repoPath, "scripts"), { recursive: true });
  initGitRepo(repoPath);
  await fs.writeFile(path.join(repoPath, "scripts", "prepare-workspace.sh"), "#!/bin/sh\nexit 0\n", "utf8");

  const configPath = path.join(tempDir, "supervisor.config.json");
  const originalDocument = {
    repoPath,
    repoSlug: "owner/repo",
    defaultBranch: "main",
    workspaceRoot: path.join(tempDir, "worktrees"),
    stateFile: path.join(tempDir, "state.json"),
    codexBinary: process.execPath,
    branchPrefix: "codex/issue-",
    reviewBotLogins: [],
    experimentalFlag: true,
  };
  await fs.writeFile(configPath, JSON.stringify(originalDocument, null, 2), "utf8");
  const before = await fs.readFile(configPath, "utf8");

  await assert.rejects(
    () =>
      updateSetupConfig({
        configPath,
        changes: {
          workspacePreparationCommand: "./scripts/prepare-workspace.sh",
        },
      }),
    /workspacePreparationCommand points at \.\/scripts\/prepare-workspace\.sh, but that path resolves to an untracked helper\./u,
  );

  const after = await fs.readFile(configPath, "utf8");
  assert.equal(after, before);
  await assert.rejects(fs.access(`${configPath}.bak`));
});

test("updateSetupConfig accepts tracked repo-owned workspacePreparationCommand helpers", async (t) => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "codex-supervisor-config-update-workspace-prep-tracked-"));
  t.after(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });
  const repoPath = path.join(tempDir, "repo");
  await fs.mkdir(path.join(repoPath, "scripts"), { recursive: true });
  initGitRepo(repoPath);
  await fs.writeFile(path.join(repoPath, "scripts", "prepare-workspace.sh"), "#!/bin/sh\nexit 0\n", "utf8");
  execFileSync("git", ["add", "scripts/prepare-workspace.sh"], { cwd: repoPath, stdio: "ignore" });
  execFileSync("git", ["commit", "-m", "Add workspace helper"], { cwd: repoPath, stdio: "ignore" });

  const configPath = path.join(tempDir, "supervisor.config.json");
  await fs.writeFile(
    configPath,
    JSON.stringify({
      repoPath,
      repoSlug: "owner/repo",
      defaultBranch: "main",
      workspaceRoot: path.join(tempDir, "worktrees"),
      stateFile: path.join(tempDir, "state.json"),
      codexBinary: process.execPath,
      branchPrefix: "codex/issue-",
      reviewBotLogins: [],
      experimentalFlag: true,
    }, null, 2),
    "utf8",
  );

  const result = await updateSetupConfig({
    configPath,
    changes: {
      workspacePreparationCommand: "./scripts/prepare-workspace.sh",
    },
  });

  const updatedDocument = JSON.parse(await fs.readFile(configPath, "utf8")) as Record<string, unknown>;
  const workspacePreparationField = result.readiness.fields.find((field) => field.key === "workspacePreparationCommand");
  assert.equal(updatedDocument.workspacePreparationCommand, "./scripts/prepare-workspace.sh");
  assert.equal(updatedDocument.experimentalFlag, true);
  assert.deepEqual(result.updatedFields, ["workspacePreparationCommand"]);
  assert.ok(workspacePreparationField);
  assert.equal(workspacePreparationField.state, "configured");
  assert.equal(workspacePreparationField.value, "./scripts/prepare-workspace.sh");
  assert.equal(workspacePreparationField.message, "Workspace preparation command is configured.");
});

test("updateSetupConfig accepts non-file workspacePreparationCommand probes", async (t) => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "codex-supervisor-config-update-workspace-prep-probe-"));
  t.after(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });
  const repoPath = path.join(tempDir, "repo");
  await fs.mkdir(repoPath, { recursive: true });
  initGitRepo(repoPath);

  const configPath = path.join(tempDir, "supervisor.config.json");
  await fs.writeFile(
    configPath,
    JSON.stringify({
      repoPath,
      repoSlug: "owner/repo",
      defaultBranch: "main",
      workspaceRoot: path.join(tempDir, "worktrees"),
      stateFile: path.join(tempDir, "state.json"),
      codexBinary: process.execPath,
      branchPrefix: "codex/issue-",
      reviewBotLogins: [],
    }, null, 2),
    "utf8",
  );

  const result = await updateSetupConfig({
    configPath,
    changes: {
      workspacePreparationCommand: "node --version",
    },
  });

  const updatedDocument = JSON.parse(await fs.readFile(configPath, "utf8")) as Record<string, unknown>;
  const workspacePreparationField = result.readiness.fields.find((field) => field.key === "workspacePreparationCommand");
  assert.equal(updatedDocument.workspacePreparationCommand, "node --version");
  assert.deepEqual(result.updatedFields, ["workspacePreparationCommand"]);
  assert.ok(workspacePreparationField);
  assert.equal(workspacePreparationField.state, "configured");
  assert.equal(workspacePreparationField.value, "node --version");
  assert.equal(workspacePreparationField.message, "Workspace preparation command is configured.");
});
