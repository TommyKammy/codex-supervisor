import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { loadConfig } from "./core/config";
import {
  buildTrackedPrStaleFailureRecovery,
  cleanupExpiredDoneWorkspaces,
  inspectOrphanedWorkspacePruneCandidates,
  pruneOrphanedWorkspacesForOperator,
} from "./recovery-reconciliation";
import { type SupervisorStateFile } from "./core/types";
import { createConfig, createPullRequest, createRecord } from "./turn-execution-test-helpers";

test("buildTrackedPrStaleFailureRecovery marks tracked head advances distinctly from stale lifecycle refreshes", () => {
  const record = createRecord({
    issue_number: 366,
    state: "failed",
    pr_number: 191,
    last_head_sha: "head-old-191",
    last_failure_signature: "tests:red",
    repeated_failure_signature_count: 3,
  });
  const pr = createPullRequest({
    number: 191,
    headRefName: "codex/issue-366",
    headRefOid: "head-new-191",
  });

  const { recoveryEvent, patch } = buildTrackedPrStaleFailureRecovery({
    record,
    pr,
    nextState: "addressing_review",
    failureContext: null,
    blockedReason: null,
  });

  assert.equal(
    recoveryEvent.reason,
    "tracked_pr_head_advanced: resumed issue #366 from failed to addressing_review after tracked PR #191 advanced from head-old-191 to head-new-191",
  );
  assert.deepEqual(patch, {
    state: "addressing_review",
    last_error: null,
    last_failure_kind: null,
    last_failure_context: null,
    last_blocker_signature: null,
    last_failure_signature: null,
    repeated_failure_signature_count: 0,
    blocked_reason: null,
    repeated_blocker_count: 0,
    timeout_retry_count: 0,
    blocked_verification_retry_count: 0,
    pr_number: 191,
    last_head_sha: "head-new-191",
  });
});

test("buildTrackedPrStaleFailureRecovery preserves blocked tracked-PR recovery policy at the same head", () => {
  const failureContext = {
    category: "review" as const,
    summary: "Manual review is required before the PR can proceed.",
    signature: "manual-review:thread-1",
    command: null,
    details: ["thread=thread-1"],
    url: "https://example.test/pr/191#discussion_r1",
    updated_at: "2026-03-13T00:25:00Z",
  };
  const record = createRecord({
    issue_number: 366,
    state: "failed",
    pr_number: 191,
    last_head_sha: "head-191",
    last_failure_signature: failureContext.signature,
    repeated_failure_signature_count: 3,
    timeout_retry_count: 2,
    blocked_verification_retry_count: 2,
  });
  const pr = createPullRequest({
    number: 191,
    headRefName: "codex/issue-366",
    headRefOid: "head-191",
  });

  const { recoveryEvent, patch } = buildTrackedPrStaleFailureRecovery({
    record,
    pr,
    nextState: "blocked",
    failureContext,
    blockedReason: "manual_review",
    reviewWaitPatch: {
      review_wait_started_at: "2026-03-13T00:24:00Z",
      review_wait_head_sha: "head-191",
    },
  });

  assert.equal(
    recoveryEvent.reason,
    "tracked_pr_lifecycle_recovered: resumed issue #366 from failed to blocked using fresh tracked PR #191 facts at head head-191",
  );
  assert.deepEqual(patch, {
    state: "blocked",
    last_error: failureContext.summary,
    last_failure_kind: null,
    last_failure_context: failureContext,
    last_blocker_signature: null,
    last_failure_signature: failureContext.signature,
    repeated_failure_signature_count: 4,
    blocked_reason: "manual_review",
    repeated_blocker_count: 0,
    timeout_retry_count: 0,
    blocked_verification_retry_count: 0,
    pr_number: 191,
    last_head_sha: "head-191",
    review_wait_started_at: "2026-03-13T00:24:00Z",
    review_wait_head_sha: "head-191",
  });
});

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

test("runtime done-workspace cleanup preserves orphan workspaces until an operator explicitly prunes them", async (t) => {
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

  const orphanIssueNumber = 202;
  const orphanBranch = "codex/issue-202";
  const orphanWorkspace = path.join(workspaceRoot, `issue-${orphanIssueNumber}`);
  git(repoPath, ["worktree", "add", "-b", orphanBranch, orphanWorkspace, "HEAD"]);

  const oldTime = new Date("2026-03-01T00:00:00.000Z");
  await fs.utimes(orphanWorkspace, oldTime, oldTime);

  const config = createConfig({
    repoPath,
    workspaceRoot,
    stateFile,
    cleanupDoneWorkspacesAfterHours: 0,
    maxDoneWorkspaces: 0,
    cleanupOrphanedWorkspacesAfterHours: 24,
  });
  const state: SupervisorStateFile = {
    activeIssueNumber: null,
    issues: {},
  };

  assert.deepEqual(await cleanupExpiredDoneWorkspaces(config, state), []);
  await fs.access(orphanWorkspace);
  assert.match(git(repoPath, ["branch", "--list", orphanBranch]), new RegExp(orphanBranch));

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

test("cleanupExpiredDoneWorkspaces returns recovery events for tracked done workspace deletions", async (t) => {
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

  const olderIssueNumber = 203;
  const newerIssueNumber = 204;
  const olderBranch = "codex/issue-203";
  const newerBranch = "codex/issue-204";
  const olderWorkspace = path.join(workspaceRoot, `issue-${olderIssueNumber}`);
  const newerWorkspace = path.join(workspaceRoot, `issue-${newerIssueNumber}`);
  git(repoPath, ["worktree", "add", "-b", olderBranch, olderWorkspace, "HEAD"]);
  git(repoPath, ["worktree", "add", "-b", newerBranch, newerWorkspace, "HEAD"]);

  const config = createConfig({
    repoPath,
    workspaceRoot,
    stateFile,
    cleanupDoneWorkspacesAfterHours: -1,
    maxDoneWorkspaces: 1,
    cleanupOrphanedWorkspacesAfterHours: 24,
  });
  const state: SupervisorStateFile = {
    activeIssueNumber: null,
    issues: {
      [String(olderIssueNumber)]: createRecord({
        issue_number: olderIssueNumber,
        state: "done",
        branch: olderBranch,
        workspace: olderWorkspace,
        updated_at: "2026-03-01T00:00:00Z",
      }),
      [String(newerIssueNumber)]: createRecord({
        issue_number: newerIssueNumber,
        state: "done",
        branch: newerBranch,
        workspace: newerWorkspace,
        updated_at: "2026-03-02T00:00:00Z",
      }),
    },
  };

  const recoveryEvents = await cleanupExpiredDoneWorkspaces(config, state);

  assert.equal(recoveryEvents.length, 1);
  assert.equal(recoveryEvents[0]?.issueNumber, olderIssueNumber);
  assert.match(recoveryEvents[0]?.reason ?? "", /done_workspace_cleanup: removed tracked done workspace for issue #203/);
  await assert.rejects(fs.access(olderWorkspace));
  await fs.access(newerWorkspace);
  assert.equal(git(repoPath, ["branch", "--list", olderBranch]), "");
  assert.match(git(repoPath, ["branch", "--list", newerBranch]), new RegExp(newerBranch));
});

test("orphan prune inspection fails fast on invalid orphan cleanup grace config", async () => {
  const config = createConfig({
    workspaceRoot: path.join(os.tmpdir(), "codex-supervisor-missing-workspaces"),
    cleanupOrphanedWorkspacesAfterHours: -1,
  });
  const state: SupervisorStateFile = {
    activeIssueNumber: null,
    issues: {},
  };

  await assert.rejects(
    inspectOrphanedWorkspacePruneCandidates(config, state),
    /Invalid config field: cleanupOrphanedWorkspacesAfterHours/,
  );
});

test("orphan prune inspection rejects orphan cleanup grace values that become invalid after config load", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "codex-supervisor-recovery-config-"));
  t.after(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  const configPath = path.join(root, "supervisor.config.json");
  await fs.mkdir(path.join(root, "repo"), { recursive: true });
  await fs.mkdir(path.join(root, "workspaces"), { recursive: true });
  await fs.writeFile(
    configPath,
    JSON.stringify({
      repoPath: "./repo",
      repoSlug: "owner/repo",
      defaultBranch: "main",
      workspaceRoot: "./workspaces",
      stateFile: "./state.json",
      codexBinary: "codex",
      branchPrefix: "codex/issue-",
      cleanupOrphanedWorkspacesAfterHours: 24,
    }),
    "utf8",
  );

  const config = loadConfig(configPath);
  config.cleanupOrphanedWorkspacesAfterHours = -1;
  const state: SupervisorStateFile = {
    activeIssueNumber: null,
    issues: {},
  };

  await assert.rejects(
    inspectOrphanedWorkspacePruneCandidates(config, state),
    /Invalid config field: cleanupOrphanedWorkspacesAfterHours/,
  );
});

test("orphan prune runtime rejects orphan cleanup grace values that become invalid after config load", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "codex-supervisor-recovery-config-"));
  t.after(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  const configPath = path.join(root, "supervisor.config.json");
  await fs.mkdir(path.join(root, "repo"), { recursive: true });
  await fs.mkdir(path.join(root, "workspaces"), { recursive: true });
  await fs.writeFile(
    configPath,
    JSON.stringify({
      repoPath: "./repo",
      repoSlug: "owner/repo",
      defaultBranch: "main",
      workspaceRoot: "./workspaces",
      stateFile: "./state.json",
      codexBinary: "codex",
      branchPrefix: "codex/issue-",
      cleanupOrphanedWorkspacesAfterHours: 24,
    }),
    "utf8",
  );

  const config = loadConfig(configPath);
  config.cleanupOrphanedWorkspacesAfterHours = -1;
  const state: SupervisorStateFile = {
    activeIssueNumber: null,
    issues: {},
  };

  await assert.rejects(
    pruneOrphanedWorkspacesForOperator(config, state),
    /Invalid config field: cleanupOrphanedWorkspacesAfterHours/,
  );
});
