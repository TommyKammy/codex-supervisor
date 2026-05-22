import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { StateStore } from "../core/state-store";
import type { IssueRunRecord } from "../core/types";
import type { GitHubClient } from "../github";
import { runPreparedIssueFlow } from "./prepared-issue-runner";
import {
  createConfig,
  createIssue,
  createRecord,
  createSupervisorState,
} from "./supervisor-test-helpers";

test("runPreparedIssueFlow persists no-PR prepared issues without dispatching Codex when lifecycle says to wait", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "prepared-issue-runner-"));
  const stateFile = path.join(root, "state.json");
  const config = createConfig({
    repoPath: path.join(root, "repo"),
    stateFile,
    workspaceRoot: path.join(root, "workspaces"),
  });
  const record = createRecord({
    issue_number: 2085,
    state: "stabilizing",
    branch: "codex/issue-2085",
    pr_number: null,
    workspace: path.join(config.workspaceRoot, "issue-2085"),
    journal_path: path.join(config.workspaceRoot, "issue-2085", ".codex-supervisor", "issue-journal.md"),
    implementation_attempt_count: 1,
    last_failure_context: null,
    last_failure_signature: null,
    repeated_failure_signature_count: 0,
    blocked_reason: null,
  });
  const state = createSupervisorState({
    activeIssueNumber: null,
    issues: [record],
  });
  const stateStore = new StateStore(stateFile, { backend: "json" });
  const syncJournalRecords: IssueRunRecord[] = [];
  let saveObserved = false;

  const message = await runPreparedIssueFlow(
    {
      config,
      stateStore,
      github: {} as GitHubClient,
      executeCodexTurn: async () => {
        throw new Error("unexpected Codex dispatch");
      },
      handlePostTurnPullRequestTransitions: async () => {
        throw new Error("unexpected post-turn PR transition");
      },
      handlePostTurnMergeAndCompletion: async () => {
        throw new Error("unexpected post-turn merge transition");
      },
    },
    {
      state,
      record,
      issue: createIssue({ number: record.issue_number }),
      previousCodexSummary: null,
      previousError: null,
      workspacePath: record.workspace,
      journalPath: record.journal_path ?? path.join(record.workspace, ".codex-supervisor", "issue-journal.md"),
      syncJournal: async (syncedRecord) => {
        syncJournalRecords.push(syncedRecord);
      },
      memoryArtifacts: {
        alwaysReadFiles: [],
        onDemandFiles: [],
        contextIndexPath: path.join(root, "context-index.md"),
        agentsPath: path.join(root, "AGENTS.generated.md"),
      },
      workspaceStatus: {
        branch: record.branch,
        headSha: "head-2085",
        hasUncommittedChanges: false,
        baseAhead: 1,
        baseBehind: 0,
        remoteBranchExists: true,
        remoteAhead: 0,
        remoteBehind: 0,
      },
      pr: null,
      checks: [],
      reviewThreads: [],
      options: { dryRun: false },
      recoveryEvents: [],
      recoveryLog: null,
    },
  );

  const savedState = JSON.parse(await fs.readFile(stateFile, "utf8"));
  saveObserved = true;
  assert.match(message, /issue=#2085 state=draft_pr/);
  assert.equal(savedState.activeIssueNumber, 2085);
  assert.equal(savedState.issues["2085"].state, "draft_pr");
  assert.equal(syncJournalRecords.length, 2);
  assert.equal(syncJournalRecords.at(-1)?.state, "draft_pr");
  assert.equal(saveObserved, true);
});
