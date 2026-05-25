import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { runLocalCiGate } from "./local-ci";
import {
  runTrackedPrCurrentHeadLocalCiGate,
  runTrackedPrReadyLocalCiPublicationGate,
} from "./tracked-pr-local-ci-publication-gate";
import { createConfig, createPullRequest, createRecord } from "./turn-execution-test-helpers";
import type { SupervisorStateFile } from "./core/types";

test("runTrackedPrCurrentHeadLocalCiGate stamps the local CI result only after workspace HEAD matches the PR", async () => {
  const pr = createPullRequest({
    number: 116,
    isDraft: false,
    headRefOid: "head-116",
  });
  const record = createRecord({
    state: "ready_to_merge",
    pr_number: pr.number,
    branch: "codex/issue-102",
    latest_local_ci_result: null,
  });
  const state: SupervisorStateFile = {
    activeIssueNumber: record.issue_number,
    issues: { [String(record.issue_number)]: record },
  };
  let localCiCalls = 0;
  let saveCalls = 0;
  let syncJournalCalls = 0;

  const result = await runTrackedPrCurrentHeadLocalCiGate({
    config: createConfig({ localCiCommand: "npm run ci:local" }),
    stateStore: {
      touch: (currentRecord, patch) => ({
        ...currentRecord,
        ...patch,
        updated_at: currentRecord.updated_at,
      }),
      save: async () => {
        saveCalls += 1;
      },
    },
    state,
    record,
    pr,
    workspacePath: path.join("workspace", "issue-102"),
    gateLabel: "before auto-merging PR #116",
    workspaceHeadMismatchDetail: (localHeadSha, prHeadSha) =>
      `local workspace HEAD ${localHeadSha} does not match PR head ${prHeadSha}; the auto-merge gate is failing closed until the local commit is published.`,
    publishWorkspaceHeadMismatchComment: false,
    github: {},
    syncJournal: async () => {
      syncJournalCalls += 1;
    },
    applyFailureSignature: (_currentRecord, failureContext) => ({
      last_failure_signature: failureContext?.signature ?? null,
      repeated_failure_signature_count: failureContext ? 1 : 0,
    }),
    runLocalCiCommand: async () => {
      localCiCalls += 1;
    },
    getWorkspaceStatus: async () => ({
      branch: "codex/issue-102",
      headSha: "head-116",
      hasUncommittedChanges: false,
      baseAhead: 1,
      baseBehind: 0,
      remoteBranchExists: true,
      remoteAhead: 0,
      remoteBehind: 0,
    }),
  });

  assert.equal(result.ok, true);
  assert.equal(result.failureContext, null);
  assert.equal(result.record.latest_local_ci_result?.outcome, "passed");
  assert.equal(result.record.latest_local_ci_result?.summary, "Configured local CI command passed before auto-merging PR #116.");
  assert.equal(result.record.latest_local_ci_result?.head_sha, "head-116");
  assert.deepEqual(result.record.timeline_artifacts, [
    {
      type: "verification_result",
      gate: "local_ci",
      command: "npm run ci:local",
      head_sha: "head-116",
      outcome: "passed",
      remediation_target: null,
      next_action: "continue",
      summary: "Configured local CI command passed before auto-merging PR #116.",
      recorded_at: result.record.timeline_artifacts?.[0]?.recorded_at ?? "",
    },
  ]);
  assert.equal(localCiCalls, 1);
  assert.equal(saveCalls, 2);
  assert.equal(syncJournalCalls, 2);
});

test("runTrackedPrCurrentHeadLocalCiGate persists auto-merge workspace HEAD mismatch without commenting", async () => {
  const pr = createPullRequest({
    number: 116,
    isDraft: false,
    headRefOid: "remote-head-116",
  });
  const record = createRecord({
    state: "ready_to_merge",
    pr_number: pr.number,
    branch: "codex/issue-102",
    latest_local_ci_result: null,
  });
  const state: SupervisorStateFile = {
    activeIssueNumber: record.issue_number,
    issues: { [String(record.issue_number)]: record },
  };
  let localCiCalls = 0;
  let commentCalls = 0;
  let saveCalls = 0;
  let syncJournalCalls = 0;

  const result = await runTrackedPrCurrentHeadLocalCiGate({
    config: createConfig({ localCiCommand: "npm run ci:local" }),
    stateStore: {
      touch: (currentRecord, patch) => ({
        ...currentRecord,
        ...patch,
        updated_at: currentRecord.updated_at,
      }),
      save: async () => {
        saveCalls += 1;
      },
    },
    state,
    record,
    pr,
    workspacePath: path.join("workspace", "issue-102"),
    gateLabel: "before auto-merging PR #116",
    workspaceHeadMismatchDetail: (localHeadSha, prHeadSha) =>
      `local workspace HEAD ${localHeadSha} does not match PR head ${prHeadSha}; the auto-merge gate is failing closed until the local commit is published.`,
    publishWorkspaceHeadMismatchComment: false,
    github: {
      addIssueComment: async () => {
        commentCalls += 1;
      },
    },
    syncJournal: async () => {
      syncJournalCalls += 1;
    },
    applyFailureSignature: (_currentRecord, failureContext) => ({
      last_failure_signature: failureContext?.signature ?? null,
      repeated_failure_signature_count: failureContext ? 1 : 0,
    }),
    runLocalCiCommand: async () => {
      localCiCalls += 1;
    },
    getWorkspaceStatus: async () => ({
      branch: "codex/issue-102",
      headSha: "local-head-116",
      hasUncommittedChanges: false,
      baseAhead: 1,
      baseBehind: 0,
      remoteBranchExists: true,
      remoteAhead: 0,
      remoteBehind: 1,
    }),
  });

  assert.equal(result.ok, false);
  assert.equal(result.record.state, "blocked");
  assert.equal(result.record.blocked_reason, "verification");
  assert.equal(result.record.last_failure_signature, "workstation-local-path-hygiene-failed");
  assert.equal(result.record.last_observed_host_local_pr_blocker_head_sha, "remote-head-116");
  assert.equal(result.record.last_observed_host_local_pr_blocker_signature, "workstation-local-path-hygiene-failed");
  assert.match(result.failureContext?.details[0] ?? "", /local workspace HEAD local-head-116 does not match PR head remote-head-116/);
  assert.equal(result.record.latest_local_ci_result?.outcome, "passed");
  assert.equal(result.record.latest_local_ci_result?.head_sha, null);
  assert.equal(localCiCalls, 1);
  assert.equal(commentCalls, 0);
  assert.equal(saveCalls, 2);
  assert.equal(syncJournalCalls, 2);
  assert.equal(state.issues[String(record.issue_number)], result.record);
});

test("runTrackedPrReadyLocalCiPublicationGate reports workspace failures with the shared remediation target", async () => {
  const pr = createPullRequest({
    number: 116,
    isDraft: true,
    headRefOid: "head-116",
  });
  const record = createRecord({
    state: "draft_pr",
    pr_number: pr.number,
  });
  const state: SupervisorStateFile = {
    activeIssueNumber: record.issue_number,
    issues: { [String(record.issue_number)]: record },
  };
  const comments: string[] = [];

  const result = await runTrackedPrReadyLocalCiPublicationGate({
    config: createConfig({ localCiCommand: "npm run ci:local" }),
    stateStore: {
      touch: (currentRecord, patch) => ({
        ...currentRecord,
        ...patch,
        updated_at: currentRecord.updated_at,
      }),
      save: async () => undefined,
    },
    state,
    record,
    pr,
    workspacePath: path.join("workspace", "issue-102"),
    github: {
      addIssueComment: async (_issueNumber, body) => {
        comments.push(body);
      },
    },
    syncJournal: async () => undefined,
    applyFailureSignature: (_currentRecord, failureContext) => ({
      last_failure_signature: failureContext?.signature ?? null,
      repeated_failure_signature_count: failureContext ? 1 : 0,
    }),
    runLocalCiCommand: async () => {
      throw Object.assign(
        new Error("Command failed: sh -lc +1 args\nexitCode=1\ntsc is not installed in this workspace"),
        { stderr: "tsc is not installed in this workspace" },
      );
    },
  });

  assert.equal(result.ok, false);
  assert.equal(result.record.latest_local_ci_result?.failure_class, "workspace_toolchain_missing");
  assert.equal(result.record.latest_local_ci_result?.remediation_target, "workspace_environment");
  assert.deepEqual(result.record.timeline_artifacts, [
    {
      type: "verification_result",
      gate: "local_ci",
      command: "npm run ci:local",
      head_sha: "head-116",
      outcome: "failed",
      remediation_target: "workspace_environment",
      next_action: "fix_workspace_environment",
      summary:
        "Configured local CI command could not run before marking PR #116 ready because the workspace toolchain is unavailable. Remediation target: workspace environment.",
      recorded_at: result.record.timeline_artifacts?.[0]?.recorded_at ?? "",
    },
  ]);
  assert.equal(
    result.record.last_host_local_pr_blocker_comment_signature,
    "local-ci-gate-workspace_toolchain_missing|gate=local_ci|failure=workspace_toolchain_missing|target=workspace_environment",
  );
  assert.match(comments[0] ?? "", /remediation target: `workspace_environment`/);
});

test("runLocalCiGate reports missing local CI configuration as a config-contract target", async () => {
  const result = await runLocalCiGate({
    config: { localCiCommand: "" },
    workspacePath: path.join("workspace", "issue-102"),
    gateLabel: "before opening a pull request",
  });

  assert.equal(result.ok, true);
  assert.equal(result.latestResult?.failure_class, "unset_contract");
  assert.equal(result.latestResult?.remediation_target, "config_contract");
  assert.equal(
    result.latestResult?.summary,
    "No repo-owned local CI contract is configured before opening a pull request. Remediation target: config contract.",
  );
});
