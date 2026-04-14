import assert from "node:assert/strict";
import test from "node:test";
import { type IssueRunRecord, type SupervisorStateFile } from "./core/types";
import { reconcileTrackedMergedButOpenIssues } from "./recovery-reconciliation";
import { createConfig, createRecord } from "./supervisor/supervisor-test-helpers";

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
