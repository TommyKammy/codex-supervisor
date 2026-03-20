import { execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { loadConfig } from "./core/config";
import { SupervisorConfig } from "./core/types";

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
  assert.doesNotMatch(gettingStarted, /review-bot profile/i);
  assert.doesNotMatch(gettingStarted, /^### Option 1: Auto-detect roles$/m);
  assert.doesNotMatch(gettingStarted, /^### Option 2: Explicit roles$/m);
  assert.doesNotMatch(gettingStarted, /^### What specialist roles are for$/m);
  assert.doesNotMatch(gettingStarted, /^Committed Local Review Swarm guardrails are maintained under `docs\/shared-memory\/`:$/m);
  assert.doesNotMatch(gettingStarted, /^## Issue metadata format$/m);

  assert.match(localReview, /^# Local Review Reference$/m);
  assert.match(localReview, /^## Choosing reviewer roles$/m);
  assert.match(localReview, /^## Artifacts, thresholds, and guardrails$/m);

  assert.match(issueMetadata, /^# Issue Metadata$/m);
  assert.match(issueMetadata, /^## Canonical fields$/m);
  assert.match(issueMetadata, /^## How scheduling uses the fields$/m);
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
