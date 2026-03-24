import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { syncMemoryArtifacts } from "./memory";
import { SupervisorConfig } from "./types";

function createConfig(rootPath: string): SupervisorConfig {
  return {
    repoPath: path.join(rootPath, "repo"),
    repoSlug: "owner/repo",
    defaultBranch: "main",
    workspaceRoot: path.join(rootPath, "workspaces"),
    stateBackend: "json",
    stateFile: path.join(rootPath, "state", "state.json"),
    codexBinary: "/usr/bin/codex",
    codexModelStrategy: "inherit",
    codexReasoningEffortByState: {},
    codexReasoningEscalateOnRepeatedFailure: true,
    sharedMemoryFiles: ["README.md", "docs/getting-started.md"],
    gsdEnabled: false,
    gsdAutoInstall: false,
    gsdInstallScope: "global",
    gsdPlanningFiles: [],
    localReviewEnabled: false,
    localReviewAutoDetect: true,
    localReviewRoles: [],
    localReviewArtifactDir: path.join(rootPath, "reviews"),
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
    candidateDiscoveryFetchWindow: 100,
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

test("syncMemoryArtifacts renders generated memory paths without operator-local absolute prefixes", async () => {
  const rootPath = await fs.mkdtemp(path.join(os.tmpdir(), "memory-artifacts-"));
  const workspacePath = path.join(rootPath, "workspaces", "issue-918");
  const journalPath = path.join(workspacePath, ".codex-supervisor", "issue-journal.md");
  const config = createConfig(rootPath);

  await fs.mkdir(path.dirname(config.stateFile), { recursive: true });
  await fs.mkdir(path.join(workspacePath, "docs"), { recursive: true });
  await fs.mkdir(path.dirname(journalPath), { recursive: true });
  await fs.writeFile(path.join(workspacePath, "README.md"), "# Readme\n", "utf8");
  await fs.writeFile(path.join(workspacePath, "docs", "getting-started.md"), "# Getting Started\n", "utf8");
  await fs.writeFile(journalPath, "# Journal\n", "utf8");

  const artifacts = await syncMemoryArtifacts({
    config,
    issueNumber: 918,
    workspacePath,
    journalPath,
  });

  const agentsContent = await fs.readFile(artifacts.agentsPath, "utf8");
  const contextIndexContent = await fs.readFile(artifacts.contextIndexPath, "utf8");
  const escapedRootPath = new RegExp(rootPath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));

  assert.doesNotMatch(agentsContent, escapedRootPath);
  assert.doesNotMatch(contextIndexContent, escapedRootPath);
  assert.match(agentsContent, /## Always Read First\n- \.\.\//);
  assert.match(agentsContent, /- \.codex-supervisor\/issue-journal\.md/);
  assert.match(agentsContent, /- README\.md/);
  assert.match(contextIndexContent, /Read order:\n1\. \.\.\//);
  assert.match(contextIndexContent, /- Tracked path: README\.md/);
  assert.doesNotMatch(contextIndexContent, /Absolute path:/);
});
