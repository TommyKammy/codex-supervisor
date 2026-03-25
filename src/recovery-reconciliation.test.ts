import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  cleanupExpiredDoneWorkspaces,
  inspectOrphanedWorkspacePruneCandidates,
  pruneOrphanedWorkspacesForOperator,
} from "./recovery-reconciliation";
import { type SupervisorStateFile } from "./core/types";
import { createConfig } from "./turn-execution-test-helpers";

function git(cwd: string, args: string[]): string {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: "Codex",
      GIT_AUTHOR_EMAIL: "codex@example.com",
      GIT_COMMITTER_NAME: "Codex",
      GIT_COMMITTER_EMAIL: "codex@example.com",
    },
  }).trim();
}

test("orphan prune evaluation stays available when done-workspace cleanup is disabled", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "codex-supervisor-recovery-"));
  t.after(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  const repoPath = path.join(root, "repo");
  const workspaceRoot = path.join(root, "workspaces");
  const stateFile = path.join(root, "state.json");
  await fs.mkdir(repoPath, { recursive: true });
  await fs.mkdir(workspaceRoot, { recursive: true });
  git(repoPath, ["init", "-b", "main"]);
  await fs.writeFile(path.join(repoPath, "README.md"), "# fixture\n", "utf8");
  git(repoPath, ["add", "README.md"]);
  git(repoPath, ["commit", "-m", "seed"]);

  const orphanIssueNumber = 201;
  const orphanBranch = "codex/issue-201";
  const orphanWorkspace = path.join(workspaceRoot, `issue-${orphanIssueNumber}`);
  git(repoPath, ["worktree", "add", "-b", orphanBranch, orphanWorkspace, "HEAD"]);

  const oldTime = new Date("2026-03-01T00:00:00.000Z");
  await fs.utimes(orphanWorkspace, oldTime, oldTime);

  const config = createConfig({
    repoPath,
    workspaceRoot,
    stateFile,
    cleanupDoneWorkspacesAfterHours: -1,
    maxDoneWorkspaces: -1,
    cleanupOrphanedWorkspacesAfterHours: 24,
  });
  const state: SupervisorStateFile = {
    activeIssueNumber: null,
    issues: {},
  };

  assert.deepEqual(await cleanupExpiredDoneWorkspaces(config, state), []);

  assert.deepEqual(
    await inspectOrphanedWorkspacePruneCandidates(config, state),
    [
      {
        issueNumber: orphanIssueNumber,
        workspaceName: `issue-${orphanIssueNumber}`,
        workspacePath: orphanWorkspace,
        branch: orphanBranch,
        eligibility: "eligible",
        reason: "safe orphaned git worktree",
        modifiedAt: oldTime.toISOString(),
      },
    ],
  );

  assert.deepEqual(
    await pruneOrphanedWorkspacesForOperator(config, state),
    {
      action: "prune-orphaned-workspaces",
      outcome: "completed",
      summary: "Pruned 1 orphaned workspace(s); skipped 0 orphaned workspace(s).",
      pruned: [
        {
          issueNumber: orphanIssueNumber,
          workspaceName: `issue-${orphanIssueNumber}`,
          workspacePath: orphanWorkspace,
          branch: orphanBranch,
          modifiedAt: oldTime.toISOString(),
          reason: "safe orphaned git worktree",
        },
      ],
      skipped: [],
    },
  );

  await assert.rejects(fs.access(orphanWorkspace));
  assert.equal(git(repoPath, ["branch", "--list", orphanBranch]), "");
});
