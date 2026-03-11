import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { detectLocalReviewRoles } from "./review-role-detector";
import { SupervisorConfig } from "./types";

function createConfig(repoPath: string, overrides: Partial<SupervisorConfig> = {}): SupervisorConfig {
  return {
    repoPath,
    repoSlug: "owner/repo",
    defaultBranch: "main",
    workspaceRoot: "/tmp/workspaces",
    stateBackend: "json",
    stateFile: "/tmp/state.json",
    codexBinary: "/usr/bin/codex",
    codexModelStrategy: "inherit",
    codexReasoningEffortByState: {},
    codexReasoningEscalateOnRepeatedFailure: true,
    sharedMemoryFiles: [],
    gsdEnabled: false,
    gsdAutoInstall: false,
    gsdInstallScope: "global",
    gsdPlanningFiles: [],
    localReviewEnabled: true,
    localReviewAutoDetect: true,
    localReviewRoles: [],
    localReviewArtifactDir: "/tmp/reviews",
    localReviewConfidenceThreshold: 0.7,
    localReviewPolicy: "block_ready",
    localReviewHighSeverityAction: "retry",
    reviewBotLogins: [],
    humanReviewBlocksMerge: true,
    issueJournalRelativePath: ".codex-supervisor/issue-journal.md",
    issueJournalMaxChars: 6000,
    skipTitlePrefixes: [],
    branchPrefix: "codex/issue-",
    pollIntervalSeconds: 60,
    copilotReviewWaitMinutes: 10,
    codexExecTimeoutMinutes: 30,
    maxCodexAttemptsPerIssue: 5,
    maxImplementationAttemptsPerIssue: 5,
    maxRepairAttemptsPerIssue: 5,
    timeoutRetryLimit: 2,
    blockedVerificationRetryLimit: 3,
    sameBlockerRepeatLimit: 2,
    sameFailureSignatureRepeatLimit: 3,
    maxDoneWorkspaces: 24,
    cleanupDoneWorkspacesAfterHours: 24,
    mergeMethod: "squash",
    draftPrAfterAttempt: 1,
    ...overrides,
  };
}

test("detectLocalReviewRoles adds prisma specialists for prisma repos", async (t) => {
  const repoPath = await fs.mkdtemp(path.join(os.tmpdir(), "codex-supervisor-roles-"));
  t.after(async () => {
    await fs.rm(repoPath, { recursive: true, force: true });
  });
  await fs.writeFile(path.join(repoPath, "package.json"), "{}\n", "utf8");
  await fs.mkdir(path.join(repoPath, "prisma"), { recursive: true });
  await fs.writeFile(path.join(repoPath, "prisma", "schema.prisma"), "datasource db { provider = \"postgresql\" }\n", "utf8");
  await fs.mkdir(path.join(repoPath, "docs"), { recursive: true });
  await fs.writeFile(path.join(repoPath, "docs", "architecture.md"), "# Architecture\n", "utf8");
  await fs.mkdir(path.join(repoPath, "apps", "core-api", "prisma", "migrations"), { recursive: true });
  await fs.mkdir(path.join(repoPath, "packages", "contracts"), { recursive: true });

  const roles = await detectLocalReviewRoles(createConfig(repoPath));

  assert.deepEqual(roles, [
    "reviewer",
    "explorer",
    "docs_researcher",
    "prisma_postgres_reviewer",
    "migration_invariant_reviewer",
    "contract_consistency_reviewer",
    "portability_reviewer",
  ]);
});

test("detectLocalReviewRoles adds UI reviewer for playwright repos", async (t) => {
  const repoPath = await fs.mkdtemp(path.join(os.tmpdir(), "codex-supervisor-roles-"));
  t.after(async () => {
    await fs.rm(repoPath, { recursive: true, force: true });
  });
  await fs.writeFile(path.join(repoPath, "package.json"), "{}\n", "utf8");
  await fs.writeFile(path.join(repoPath, "playwright.config.ts"), "export default {};\n", "utf8");

  const roles = await detectLocalReviewRoles(createConfig(repoPath));

  assert.deepEqual(roles, [
    "reviewer",
    "explorer",
    "ui_regression_reviewer",
    "portability_reviewer",
  ]);
});

test("detectLocalReviewRoles adds workflow specialists for GitHub Actions repos", async (t) => {
  const repoPath = await fs.mkdtemp(path.join(os.tmpdir(), "codex-supervisor-roles-"));
  t.after(async () => {
    await fs.rm(repoPath, { recursive: true, force: true });
  });
  await fs.writeFile(path.join(repoPath, "package.json"), "{}\n", "utf8");
  await fs.mkdir(path.join(repoPath, ".github", "workflows"), { recursive: true });
  await fs.mkdir(path.join(repoPath, "src"), { recursive: true });
  await fs.writeFile(
    path.join(repoPath, ".github", "workflows", "ci.yml"),
    "name: CI\non: [push, pull_request]\n",
    "utf8",
  );
  await fs.writeFile(path.join(repoPath, "src", "ci-workflow.test.ts"), "import test from 'node:test';\n", "utf8");

  const roles = await detectLocalReviewRoles(createConfig(repoPath));

  assert.deepEqual(roles, [
    "reviewer",
    "explorer",
    "github_actions_semantics_reviewer",
    "workflow_test_reviewer",
    "portability_reviewer",
  ]);
});
