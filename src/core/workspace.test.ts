import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { SupervisorConfig } from "./types";
import { ensureWorkspace } from "./workspace";

const execFileAsync = promisify(execFile);

function createConfig(root: string): SupervisorConfig {
  return {
    repoPath: path.join(root, "repo"),
    repoSlug: "owner/repo",
    defaultBranch: "main",
    workspaceRoot: path.join(root, "workspaces"),
    stateBackend: "json",
    stateFile: path.join(root, "state.json"),
    codexBinary: "/usr/bin/codex",
    codexModelStrategy: "inherit",
    codexReasoningEffortByState: {},
    codexReasoningEscalateOnRepeatedFailure: true,
    sharedMemoryFiles: [],
    gsdEnabled: false,
    gsdAutoInstall: false,
    gsdInstallScope: "global",
    gsdPlanningFiles: [],
    localReviewEnabled: false,
    localReviewAutoDetect: true,
    localReviewRoles: [],
    localReviewArtifactDir: path.join(root, "reviews"),
    localReviewConfidenceThreshold: 0.7,
    localReviewReviewerThresholds: {
      generic: { confidenceThreshold: 0.7, minimumSeverity: "low" },
      specialist: { confidenceThreshold: 0.7, minimumSeverity: "low" },
    },
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
    copilotReviewTimeoutAction: "continue",
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
  };
}

async function git(cwd: string, ...args: string[]): Promise<void> {
  await execFileAsync("git", ["-C", cwd, ...args]);
}

async function createRepositoryFixture(): Promise<SupervisorConfig> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "codex-supervisor-workspace-"));
  const originPath = path.join(root, "origin.git");
  const config = createConfig(root);

  await execFileAsync("git", ["init", "--bare", originPath]);
  await execFileAsync("git", ["clone", originPath, config.repoPath]);
  await git(config.repoPath, "config", "user.name", "Codex Supervisor");
  await git(config.repoPath, "config", "user.email", "codex@example.test");
  await git(config.repoPath, "checkout", "-b", config.defaultBranch);
  await fs.writeFile(path.join(config.repoPath, "README.md"), "fixture\n", "utf8");
  await git(config.repoPath, "add", "README.md");
  await git(config.repoPath, "commit", "-m", "Initial commit");
  await git(config.repoPath, "push", "-u", "origin", config.defaultBranch);

  return config;
}

test("ensureWorkspace reports when a recreated workspace restores from an existing local branch", async () => {
  const config = await createRepositoryFixture();
  const issueNumber = 721;
  const branch = `${config.branchPrefix}${issueNumber}`;

  await git(config.repoPath, "branch", branch, config.defaultBranch);

  const ensured = await ensureWorkspace(config, issueNumber, branch);

  assert.equal(ensured.workspacePath, path.join(config.workspaceRoot, `issue-${issueNumber}`));
  assert.equal(ensured.restore.source, "local_branch");
  assert.equal(ensured.restore.ref, branch);
});

test("ensureWorkspace reports when a recreated workspace bootstraps from the default branch", async () => {
  const config = await createRepositoryFixture();
  const issueNumber = 722;
  const branch = `${config.branchPrefix}${issueNumber}`;

  const ensured = await ensureWorkspace(config, issueNumber, branch);

  assert.equal(ensured.workspacePath, path.join(config.workspaceRoot, `issue-${issueNumber}`));
  assert.equal(ensured.restore.source, "bootstrap_default_branch");
  assert.equal(ensured.restore.ref, `origin/${config.defaultBranch}`);
});
