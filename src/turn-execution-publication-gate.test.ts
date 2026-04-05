import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { applyCodexTurnPublicationGate } from "./turn-execution-publication-gate";
import { SupervisorStateFile } from "./core/types";
import { createConfig, createIssue, createPullRequest, createRecord } from "./turn-execution-test-helpers";

const SAMPLE_MACOS_WORKSTATION_PATH = `/${"Users"}/alice/Dev/private-repo`;

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", ["-C", cwd, ...args], {
    encoding: "utf8",
  });
}

async function createTrackedRepo(): Promise<string> {
  const repoPath = await fs.mkdtemp(path.join(os.tmpdir(), "publication-gate-path-hygiene-"));
  git(repoPath, "init", "-b", "main");
  git(repoPath, "config", "user.name", "Codex Supervisor");
  git(repoPath, "config", "user.email", "codex@example.test");
  git(repoPath, "init", "--bare", "origin.git");
  await fs.writeFile(path.join(repoPath, "README.md"), "# fixture\n", "utf8");
  git(repoPath, "add", "README.md");
  git(repoPath, "commit", "-m", "seed");
  git(repoPath, "remote", "add", "origin", path.join(repoPath, "origin.git"));
  git(repoPath, "push", "-u", "origin", "main");
  return repoPath;
}

test("applyCodexTurnPublicationGate blocks draft PR creation when path hygiene fails", async () => {
  const issue = createIssue({ title: "Gate draft PR creation on path hygiene" });
  const state: SupervisorStateFile = {
    activeIssueNumber: 102,
    issues: {
      "102": createRecord({
        state: "stabilizing",
        pr_number: null,
        implementation_attempt_count: 1,
      }),
    },
  };
  let saveCalls = 0;
  let syncJournalCalls = 0;
  let syncExecutionMetricsCalls = 0;
  let createPullRequestCalls = 0;
  let runLocalCiCalls = 0;

  const result = await applyCodexTurnPublicationGate({
    config: createConfig({ localCiCommand: "npm run ci:local" }),
    stateStore: {
      touch: (record, patch) => ({ ...record, ...patch, updated_at: record.updated_at }),
      save: async () => {
        saveCalls += 1;
      },
    },
    state,
    record: state.issues["102"]!,
    issue,
    workspacePath: "/tmp/workspaces/issue-102",
    workspaceStatus: {
      branch: "codex/issue-102",
      headSha: "head-102",
      hasUncommittedChanges: false,
      baseAhead: 1,
      baseBehind: 0,
      remoteBranchExists: true,
      remoteAhead: 0,
      remoteBehind: 0,
    },
    github: {
      resolvePullRequestForBranch: async () => null,
      createPullRequest: async () => {
        createPullRequestCalls += 1;
        throw new Error("unexpected createPullRequest call");
      },
      getChecks: async () => [],
      getUnresolvedReviewThreads: async () => [],
    },
    syncJournal: async () => {
      syncJournalCalls += 1;
    },
    applyFailureSignature: (_record, failureContext) => ({
      last_failure_signature: failureContext?.signature ?? null,
      repeated_failure_signature_count: failureContext ? 1 : 0,
    }),
    runWorkstationLocalPathGate: async () => ({
      ok: false,
      failureContext: {
        category: "blocked",
        summary: "Tracked durable artifacts failed workstation-local path hygiene before publication.",
        signature: "workstation-local-path-hygiene-failed",
        command: "npm run verify:paths",
        details: ['docs/guide.md:1 matched <workstation-local> via "<workstation-local>/private-repo"'],
        url: null,
        updated_at: "2026-03-27T00:00:00Z",
      },
    }),
    runLocalCiCommand: async () => {
      runLocalCiCalls += 1;
    },
    syncExecutionMetricsRunSummary: async () => {
      syncExecutionMetricsCalls += 1;
    },
  });

  assert.equal(result.kind, "blocked");
  assert.equal(result.message, "Workstation-local path hygiene blocked pull request creation for issue #102.");
  assert.equal(result.record.state, "blocked");
  assert.equal(result.record.blocked_reason, "verification");
  assert.equal(result.record.last_failure_signature, "workstation-local-path-hygiene-failed");
  assert.equal(result.pr, null);
  assert.equal(saveCalls, 1);
  assert.equal(syncJournalCalls, 1);
  assert.equal(syncExecutionMetricsCalls, 1);
  assert.equal(createPullRequestCalls, 0);
  assert.equal(runLocalCiCalls, 0);
});

test("applyCodexTurnPublicationGate redacts supervisor-owned cross-issue journals before publication", async (t) => {
  const workspacePath = await createTrackedRepo();
  t.after(async () => {
    await fs.rm(workspacePath, { recursive: true, force: true });
  });
  git(workspacePath, "checkout", "-b", "codex/issue-102");

  const currentJournalPath = path.join(workspacePath, ".codex-supervisor", "issues", "102", "issue-journal.md");
  const otherJournalPath = path.join(workspacePath, ".codex-supervisor", "issues", "181", "issue-journal.md");
  await fs.mkdir(path.dirname(currentJournalPath), { recursive: true });
  await fs.mkdir(path.dirname(otherJournalPath), { recursive: true });
  await fs.writeFile(currentJournalPath, "# Issue #102\n", "utf8");
  await fs.writeFile(
    otherJournalPath,
    [
      "# Issue #181: stale leak",
      "",
      "## Codex Working Notes",
      "### Current Handoff",
      `- What changed: reproduced a leak from ${SAMPLE_MACOS_WORKSTATION_PATH}.`,
      "",
    ].join("\n"),
    "utf8",
  );
  git(workspacePath, "add", ".codex-supervisor/issues/102/issue-journal.md", ".codex-supervisor/issues/181/issue-journal.md");
  git(workspacePath, "commit", "-m", "seed cross-issue journal leak");

  let createPullRequestCalls = 0;
  const issue = createIssue({ title: "Gate draft PR creation on cross-issue journal hygiene" });
  const state: SupervisorStateFile = {
    activeIssueNumber: 102,
    issues: {
      "102": createRecord({
        state: "stabilizing",
        pr_number: null,
        implementation_attempt_count: 1,
        workspace: workspacePath,
        journal_path: currentJournalPath,
      }),
    },
  };

  const result = await applyCodexTurnPublicationGate({
    config: createConfig({
      localCiCommand: "npm run ci:local",
      issueJournalRelativePath: ".codex-supervisor/issues/{issueNumber}/issue-journal.md",
    }),
    stateStore: {
      touch: (record, patch) => ({ ...record, ...patch, updated_at: record.updated_at }),
      save: async () => undefined,
    },
    state,
    record: state.issues["102"]!,
    issue,
    workspacePath,
    workspaceStatus: {
      branch: "codex/issue-102",
      headSha: git(workspacePath, "rev-parse", "HEAD").trim(),
      hasUncommittedChanges: false,
      baseAhead: 1,
      baseBehind: 0,
      remoteBranchExists: false,
      remoteAhead: 0,
      remoteBehind: 0,
    },
    github: {
      resolvePullRequestForBranch: async () => null,
      createPullRequest: async () => {
        createPullRequestCalls += 1;
        return createPullRequest({ number: 200, isDraft: true, headRefOid: "head-102" });
      },
      getChecks: async () => [],
      getUnresolvedReviewThreads: async () => [],
    },
    syncJournal: async () => undefined,
    applyFailureSignature: () => ({
      last_failure_signature: null,
      repeated_failure_signature_count: 0,
    }),
    runLocalCiCommand: async () => undefined,
    syncExecutionMetricsRunSummary: async () => undefined,
  });

  assert.equal(result.kind, "ready");
  assert.equal(createPullRequestCalls, 1);
  assert.equal(result.record.last_head_sha, git(workspacePath, "rev-parse", "HEAD").trim());
  const redactedJournal = await fs.readFile(otherJournalPath, "utf8");
  assert.doesNotMatch(redactedJournal, new RegExp(SAMPLE_MACOS_WORKSTATION_PATH.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.match(redactedJournal, /<redacted-local-path>/);
  assert.match(git(workspacePath, "log", "-1", "--pretty=%s"), /Normalize supervisor-owned issue journals for path hygiene/);
  assert.match(git(workspacePath, "ls-remote", "--heads", "origin", "codex/issue-102"), /refs\/heads\/codex\/issue-102/);
  assert.equal(git(workspacePath, "status", "--short", "--untracked-files=no").trim(), "");
});

test("applyCodexTurnPublicationGate blocks draft PR creation when local CI fails", async () => {
  const issue = createIssue({ title: "Gate draft PR creation" });
  const state: SupervisorStateFile = {
    activeIssueNumber: 102,
    issues: {
      "102": createRecord({
        state: "stabilizing",
        pr_number: null,
        implementation_attempt_count: 1,
      }),
    },
  };
  let saveCalls = 0;
  let syncJournalCalls = 0;
  let createPullRequestCalls = 0;

  const result = await applyCodexTurnPublicationGate({
    config: createConfig({ localCiCommand: "npm run ci:local" }),
    stateStore: {
      touch: (record, patch) => ({ ...record, ...patch, updated_at: record.updated_at }),
      save: async () => {
        saveCalls += 1;
      },
    },
    state,
    record: state.issues["102"]!,
    issue,
    workspacePath: "/tmp/workspaces/issue-102",
    workspaceStatus: {
      branch: "codex/issue-102",
      headSha: "head-102",
      hasUncommittedChanges: false,
      baseAhead: 1,
      baseBehind: 0,
      remoteBranchExists: true,
      remoteAhead: 0,
      remoteBehind: 0,
    },
    github: {
      resolvePullRequestForBranch: async () => null,
      createPullRequest: async () => {
        createPullRequestCalls += 1;
        throw new Error("unexpected createPullRequest call");
      },
      getChecks: async () => [],
      getUnresolvedReviewThreads: async () => [],
    },
    syncJournal: async () => {
      syncJournalCalls += 1;
    },
    applyFailureSignature: (_record, failureContext) => ({
      last_failure_signature: failureContext?.signature ?? null,
      repeated_failure_signature_count: failureContext ? 1 : 0,
    }),
    runWorkstationLocalPathGate: async () => ({
      ok: true,
      failureContext: null,
    }),
    runLocalCiCommand: async () => {
      throw new Error("local ci failed");
    },
    syncExecutionMetricsRunSummary: async () => undefined,
  });

  assert.equal(result.kind, "blocked");
  assert.equal(result.message, "Local CI gate blocked pull request creation for issue #102.");
  assert.equal(result.record.state, "blocked");
  assert.equal(result.record.blocked_reason, "verification");
  assert.equal(result.record.last_failure_signature, "local-ci-gate-non_zero_exit");
  assert.equal(result.pr, null);
  assert.equal(saveCalls, 1);
  assert.equal(syncJournalCalls, 1);
  assert.equal(createPullRequestCalls, 0);
});

test("applyCodexTurnPublicationGate runs workspace preparation before local CI", async () => {
  const issue = createIssue({ title: "Prepare workspace before local CI" });
  const state: SupervisorStateFile = {
    activeIssueNumber: 102,
    issues: {
      "102": createRecord({
        state: "stabilizing",
        pr_number: null,
        implementation_attempt_count: 1,
      }),
    },
  };
  const callOrder: string[] = [];

  const result = await applyCodexTurnPublicationGate({
    config: createConfig({
      workspacePreparationCommand: "npm ci",
      localCiCommand: "npm run ci:local",
    }),
    stateStore: {
      touch: (record, patch) => ({ ...record, ...patch, updated_at: record.updated_at }),
      save: async () => undefined,
    },
    state,
    record: state.issues["102"]!,
    issue,
    workspacePath: "/tmp/workspaces/issue-102",
    workspaceStatus: {
      branch: "codex/issue-102",
      headSha: "head-102",
      hasUncommittedChanges: false,
      baseAhead: 1,
      baseBehind: 0,
      remoteBranchExists: true,
      remoteAhead: 0,
      remoteBehind: 0,
    },
    github: {
      resolvePullRequestForBranch: async () => null,
      createPullRequest: async () => createPullRequest({ number: 200, isDraft: true, headRefOid: "head-102" }),
      getChecks: async () => [],
      getUnresolvedReviewThreads: async () => [],
    },
    syncJournal: async () => undefined,
    applyFailureSignature: () => ({
      last_failure_signature: null,
      repeated_failure_signature_count: 0,
    }),
    runWorkstationLocalPathGate: async () => ({
      ok: true,
      failureContext: null,
    }),
    runWorkspacePreparationCommand: async (command, cwd) => {
      callOrder.push(`prepare:${command.displayCommand}:${cwd}`);
    },
    runLocalCiCommand: async (command, cwd) => {
      callOrder.push(`local-ci:${command.displayCommand}:${cwd}`);
    },
    syncExecutionMetricsRunSummary: async () => undefined,
  });

  assert.equal(result.kind, "ready");
  assert.deepEqual(callOrder, [
    "prepare:npm ci:/tmp/workspaces/issue-102",
    "local-ci:npm run ci:local:/tmp/workspaces/issue-102",
  ]);
});

test("applyCodexTurnPublicationGate blocks draft PR creation when workspace preparation fails", async () => {
  const issue = createIssue({ title: "Gate draft PR creation on workspace preparation" });
  const state: SupervisorStateFile = {
    activeIssueNumber: 102,
    issues: {
      "102": createRecord({
        state: "stabilizing",
        pr_number: null,
        implementation_attempt_count: 1,
      }),
    },
  };
  let runLocalCiCalls = 0;

  const result = await applyCodexTurnPublicationGate({
    config: createConfig({
      workspacePreparationCommand: "npm ci",
      localCiCommand: "npm run ci:local",
    }),
    stateStore: {
      touch: (record, patch) => ({ ...record, ...patch, updated_at: record.updated_at }),
      save: async () => undefined,
    },
    state,
    record: state.issues["102"]!,
    issue,
    workspacePath: "/tmp/workspaces/issue-102",
    workspaceStatus: {
      branch: "codex/issue-102",
      headSha: "head-102",
      hasUncommittedChanges: false,
      baseAhead: 1,
      baseBehind: 0,
      remoteBranchExists: true,
      remoteAhead: 0,
      remoteBehind: 0,
    },
    github: {
      resolvePullRequestForBranch: async () => null,
      createPullRequest: async () => {
        throw new Error("unexpected createPullRequest call");
      },
      getChecks: async () => [],
      getUnresolvedReviewThreads: async () => [],
    },
    syncJournal: async () => undefined,
    applyFailureSignature: (_record, failureContext) => ({
      last_failure_signature: failureContext?.signature ?? null,
      repeated_failure_signature_count: failureContext ? 1 : 0,
    }),
    runWorkstationLocalPathGate: async () => ({
      ok: true,
      failureContext: null,
    }),
    runWorkspacePreparationCommand: async () => {
      throw new Error("Command failed: sh -lc +1 args\nexitCode=1\nnpm error missing node_modules");
    },
    runLocalCiCommand: async () => {
      runLocalCiCalls += 1;
    },
    syncExecutionMetricsRunSummary: async () => undefined,
  });

  assert.equal(result.kind, "blocked");
  assert.equal(result.message, "Workspace preparation blocked pull request creation for issue #102.");
  assert.equal(result.record.state, "blocked");
  assert.equal(result.record.blocked_reason, "verification");
  assert.equal(result.record.last_failure_signature, "workspace-preparation-gate-non_zero_exit");
  assert.match(result.record.last_error ?? "", /workspace environment/i);
  assert.equal(runLocalCiCalls, 0);
});

test("applyCodexTurnPublicationGate opens a draft PR after the gate passes", async () => {
  const issue = createIssue({ title: "Open draft PR" });
  const draftPr = createPullRequest({ number: 200, isDraft: true, headRefOid: "head-102" });
  const state: SupervisorStateFile = {
    activeIssueNumber: 102,
    issues: {
      "102": createRecord({
        state: "stabilizing",
        pr_number: null,
        implementation_attempt_count: 1,
      }),
    },
  };
  let saveCalls = 0;
  let syncJournalCalls = 0;
  let createPullRequestCalls = 0;

  const result = await applyCodexTurnPublicationGate({
    config: createConfig({ localCiCommand: "npm run ci:local" }),
    stateStore: {
      touch: (record, patch) => ({ ...record, ...patch, updated_at: record.updated_at }),
      save: async () => {
        saveCalls += 1;
      },
    },
    state,
    record: state.issues["102"]!,
    issue,
    workspacePath: "/tmp/workspaces/issue-102",
    workspaceStatus: {
      branch: "codex/issue-102",
      headSha: "head-102",
      hasUncommittedChanges: false,
      baseAhead: 1,
      baseBehind: 0,
      remoteBranchExists: true,
      remoteAhead: 0,
      remoteBehind: 0,
    },
    github: {
      resolvePullRequestForBranch: async () => null,
      createPullRequest: async () => {
        createPullRequestCalls += 1;
        return draftPr;
      },
      getChecks: async (prNumber) => {
        assert.equal(prNumber, 200);
        return [];
      },
      getUnresolvedReviewThreads: async (prNumber) => {
        assert.equal(prNumber, 200);
        return [];
      },
    },
    syncJournal: async () => {
      syncJournalCalls += 1;
    },
    applyFailureSignature: () => ({
      last_failure_signature: null,
      repeated_failure_signature_count: 0,
    }),
    runWorkstationLocalPathGate: async () => ({
      ok: true,
      failureContext: null,
    }),
    runLocalCiCommand: async () => undefined,
    syncExecutionMetricsRunSummary: async () => undefined,
  });

  assert.equal(result.kind, "ready");
  assert.equal(result.record.pr_number, null);
  assert.equal(result.record.latest_local_ci_result?.outcome, "passed");
  assert.equal(result.pr?.number, 200);
  assert.equal(createPullRequestCalls, 1);
  assert.equal(saveCalls, 1);
  assert.equal(syncJournalCalls, 1);
});
