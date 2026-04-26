import assert from "node:assert/strict";
import test from "node:test";
import { type IssueRunRecord, type SupervisorStateFile } from "./core/types";
import { reconcileTrackedMergedButOpenIssues } from "./recovery-reconciliation";
import { createConfig, createPullRequest, createRecord } from "./supervisor/supervisor-test-helpers";

test("reconcileTrackedMergedButOpenIssues default pass stops after recoverable tracked PR records in a mixed state", async () => {
  const recoverableRecords = [
    createRecord({
      issue_number: 450,
      state: "merging",
      branch: "codex/reopen-issue-450",
      pr_number: 901,
      blocked_reason: null,
    }),
    createRecord({
      issue_number: 451,
      state: "waiting_ci",
      branch: "codex/reopen-issue-451",
      pr_number: 902,
      blocked_reason: null,
    }),
  ];
  const historicalDoneRecords = Array.from({ length: 30 }, (_, index) =>
    createRecord({
      issue_number: 300 + index,
      state: "done",
      branch: `codex/historical-done-${300 + index}`,
      pr_number: 800 + index,
      blocked_reason: null,
    }));
  const state: SupervisorStateFile = {
    activeIssueNumber: null,
    issues: Object.fromEntries(
      [...historicalDoneRecords, ...recoverableRecords].map((record) => [String(record.issue_number), record]),
    ),
  };
  const prLookups: number[] = [];
  let saveCalls = 0;

  await reconcileTrackedMergedButOpenIssues(
    {
      getPullRequestIfExists: async (prNumber) => {
        prLookups.push(prNumber);
        return null;
      },
      getIssue: async () => {
        throw new Error("unexpected getIssue call");
      },
      closeIssue: async () => {
        throw new Error("unexpected closeIssue call");
      },
      closePullRequest: async () => {
        throw new Error("unexpected closePullRequest call");
      },
      getChecks: async () => [],
      getMergedPullRequestsClosingIssue: async () => [],
      getUnresolvedReviewThreads: async () => [],
    },
    {
      touch(current: IssueRunRecord, patch: Partial<IssueRunRecord>): IssueRunRecord {
        return {
          ...current,
          ...patch,
          updated_at: "2026-03-13T00:25:00Z",
        };
      },
      save: async () => {
        saveCalls += 1;
      },
    },
    state,
    createConfig(),
    [],
  );

  assert.deepEqual(prLookups, [901, 902]);
  assert.equal(saveCalls, 0);
  assert.equal(state.reconciliation_state?.tracked_merged_but_open_last_processed_issue_number, undefined);
});

test("reconcileTrackedMergedButOpenIssues preserves the historical done cursor when mixed-state passes defer that bucket", async () => {
  const recoverableRecords = [
    createRecord({
      issue_number: 450,
      state: "merging",
      branch: "codex/reopen-issue-450",
      pr_number: 901,
      blocked_reason: null,
    }),
    createRecord({
      issue_number: 451,
      state: "waiting_ci",
      branch: "codex/reopen-issue-451",
      pr_number: 902,
      blocked_reason: null,
    }),
  ];
  const historicalDoneRecords = Array.from({ length: 30 }, (_, index) =>
    createRecord({
      issue_number: 300 + index,
      state: "done",
      branch: `codex/historical-done-${300 + index}`,
      pr_number: 800 + index,
      blocked_reason: null,
    }));
  const state: SupervisorStateFile = {
    activeIssueNumber: null,
    issues: Object.fromEntries(
      [...historicalDoneRecords, ...recoverableRecords].map((record) => [String(record.issue_number), record]),
    ),
    reconciliation_state: {
      tracked_merged_but_open_last_processed_issue_number: 324,
    },
  };
  const prLookups: number[] = [];
  let saveCalls = 0;

  await reconcileTrackedMergedButOpenIssues(
    {
      getPullRequestIfExists: async (prNumber) => {
        prLookups.push(prNumber);
        return null;
      },
      getIssue: async () => {
        throw new Error("unexpected getIssue call");
      },
      closeIssue: async () => {
        throw new Error("unexpected closeIssue call");
      },
      closePullRequest: async () => {
        throw new Error("unexpected closePullRequest call");
      },
      getChecks: async () => [],
      getMergedPullRequestsClosingIssue: async () => [],
      getUnresolvedReviewThreads: async () => [],
    },
    {
      touch(current: IssueRunRecord, patch: Partial<IssueRunRecord>): IssueRunRecord {
        return {
          ...current,
          ...patch,
          updated_at: "2026-03-13T00:25:00Z",
        };
      },
      save: async () => {
        saveCalls += 1;
      },
    },
    state,
    createConfig(),
    [],
  );

  assert.deepEqual(prLookups, [901, 902]);
  assert.equal(saveCalls, 0);
  assert.equal(state.reconciliation_state?.tracked_merged_but_open_last_processed_issue_number, 324);
});

test("reconcileTrackedMergedButOpenIssues preserves queued ready-promotion path hygiene repairs", async () => {
  const failureContext = {
    category: "blocked" as const,
    summary:
      "Ready-promotion path hygiene found actionable publishable tracked content; supervisor will retry a repair turn before marking the draft PR ready. Actionable files: backend/app/features/auth/bridge.py.",
    signature: "workstation-local-path-hygiene-failed",
    command: "npm run verify:paths",
    details: ["First fix: backend/app/features/auth/bridge.py (2 matches, Linux user home directory)."],
    url: null,
    updated_at: "2026-04-26T23:00:00Z",
  };
  const record = createRecord({
    issue_number: 315,
    state: "repairing_ci",
    branch: "codex/issue-315",
    pr_number: 321,
    blocked_reason: null,
    last_head_sha: "head-ready",
    last_failure_signature: failureContext.signature,
    last_failure_context: failureContext,
    last_observed_host_local_pr_blocker_signature: failureContext.signature,
    last_observed_host_local_pr_blocker_head_sha: "head-ready",
    timeline_artifacts: [
      {
        type: "path_hygiene_result",
        gate: "workstation_local_path_hygiene",
        command: "npm run verify:paths",
        head_sha: "head-ready",
        outcome: "repair_queued",
        remediation_target: "repair_already_queued",
        next_action: "wait_for_repair_turn",
        summary: failureContext.summary,
        recorded_at: "2026-04-26T23:00:00Z",
        repair_targets: ["backend/app/features/auth/bridge.py"],
      },
    ],
  });
  const state: SupervisorStateFile = {
    activeIssueNumber: null,
    issues: { "315": record },
  };
  let saveCalls = 0;

  await reconcileTrackedMergedButOpenIssues(
    {
      getPullRequestIfExists: async () => createPullRequest({
        number: 321,
        state: "OPEN",
        isDraft: true,
        headRefName: "codex/issue-315",
        headRefOid: "head-ready",
        mergeStateStatus: "CLEAN",
      }),
      getIssue: async () => {
        throw new Error("unexpected getIssue call");
      },
      closeIssue: async () => {
        throw new Error("unexpected closeIssue call");
      },
      closePullRequest: async () => {
        throw new Error("unexpected closePullRequest call");
      },
      getChecks: async () => [{ name: "build", state: "SUCCESS", bucket: "pass", workflow: "CI" }],
      getMergedPullRequestsClosingIssue: async () => [],
      getUnresolvedReviewThreads: async () => [],
    },
    {
      touch(current: IssueRunRecord, patch: Partial<IssueRunRecord>): IssueRunRecord {
        return {
          ...current,
          ...patch,
          updated_at: "2026-04-26T23:01:00Z",
        };
      },
      save: async () => {
        saveCalls += 1;
      },
    },
    state,
    createConfig(),
    [],
  );

  assert.equal(saveCalls, 0);
  assert.equal(state.issues["315"]?.state, "repairing_ci");
  assert.equal(state.issues["315"]?.last_failure_context, failureContext);
});

test("reconcileTrackedMergedButOpenIssues emits a bounded backlog recovery event when historical tracked PR work is deferred", async () => {
  const historicalDoneRecords = Array.from({ length: 30 }, (_, index) =>
    createRecord({
      issue_number: 300 + index,
      state: "done",
      branch: `codex/historical-done-${300 + index}`,
      pr_number: 800 + index,
      blocked_reason: null,
    }));
  const state: SupervisorStateFile = {
    activeIssueNumber: null,
    issues: Object.fromEntries(historicalDoneRecords.map((record) => [String(record.issue_number), record])),
  };
  const prLookups: number[] = [];
  let saveCalls = 0;

  const recoveryEvents = await reconcileTrackedMergedButOpenIssues(
    {
      getPullRequestIfExists: async (prNumber) => {
        prLookups.push(prNumber);
        return null;
      },
      getIssue: async () => {
        throw new Error("unexpected getIssue call");
      },
      closeIssue: async () => {
        throw new Error("unexpected closeIssue call");
      },
      closePullRequest: async () => {
        throw new Error("unexpected closePullRequest call");
      },
      getChecks: async () => [],
      getMergedPullRequestsClosingIssue: async () => [],
      getUnresolvedReviewThreads: async () => [],
    },
    {
      touch(current: IssueRunRecord, patch: Partial<IssueRunRecord>): IssueRunRecord {
        return {
          ...current,
          ...patch,
          updated_at: "2026-03-13T00:25:00Z",
        };
      },
      save: async () => {
        saveCalls += 1;
      },
    },
    state,
    createConfig(),
    [],
  );

  assert.deepEqual(prLookups, historicalDoneRecords.slice(0, 25).map((record) => record.pr_number));
  assert.equal(saveCalls, 1);
  assert.equal(state.reconciliation_state?.tracked_merged_but_open_last_processed_issue_number, 324);
  assert.deepEqual(recoveryEvents.map((event) => event.reason), [
    "tracked_pr_reconciliation_bounded: deferred 5 tracked PR backlog record(s) after issue #324; resume after this cursor next cycle",
  ]);
});
