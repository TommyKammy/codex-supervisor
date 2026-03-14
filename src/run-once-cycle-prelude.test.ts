import test from "node:test";
import assert from "node:assert/strict";
import { GitHubIssue, SupervisorStateFile } from "./types";
import { RecoveryEvent, runOnceCyclePrelude } from "./run-once-cycle-prelude";

test("runOnceCyclePrelude loads state and aggregates recovery setup events in order", async () => {
  const state: SupervisorStateFile = {
    activeIssueNumber: 41,
    issues: {},
  };
  const issues: GitHubIssue[] = [
    {
      number: 41,
      title: "Prelude extraction target",
      body: "",
      createdAt: "2026-03-14T00:00:00Z",
      updatedAt: "2026-03-14T00:00:00Z",
      url: "https://example.test/issues/41",
      state: "OPEN",
    },
  ];
  const carryover: RecoveryEvent[] = [
    {
      issueNumber: 90,
      reason: "carryover recovery",
      at: "2026-03-14T00:00:00Z",
    },
  ];
  const staleReservationEvent: RecoveryEvent = {
    issueNumber: 41,
    reason: "cleared stale reservation",
    at: "2026-03-14T00:01:00Z",
  };
  const mergedConvergenceEvent: RecoveryEvent = {
    issueNumber: 42,
    reason: "merged convergence",
    at: "2026-03-14T00:02:00Z",
  };
  const blockedRecoveryEvent: RecoveryEvent = {
    issueNumber: 43,
    reason: "blocked recovery",
    at: "2026-03-14T00:03:00Z",
  };
  const orphanCleanupEvent: RecoveryEvent = {
    issueNumber: 44,
    reason: "pruned orphaned worktree",
    at: "2026-03-14T00:04:00Z",
  };

  const calls: string[] = [];
  const result = await runOnceCyclePrelude({
    stateStore: {
      load: async () => {
        calls.push("load");
        return state;
      },
    },
    carryoverRecoveryEvents: carryover,
    reconcileStaleActiveIssueReservation: async (loadedState) => {
      calls.push("reconcileStaleActiveIssueReservation");
      assert.equal(loadedState, state);
      return [staleReservationEvent];
    },
    handleAuthFailure: async (loadedState) => {
      calls.push("handleAuthFailure");
      assert.equal(loadedState, state);
      return null;
    },
    listAllIssues: async () => {
      calls.push("listAllIssues");
      return issues;
    },
    reconcileTrackedMergedButOpenIssues: async (loadedState, loadedIssues) => {
      calls.push("reconcileTrackedMergedButOpenIssues");
      assert.equal(loadedState, state);
      assert.equal(loadedIssues, issues);
      return [mergedConvergenceEvent];
    },
    reconcileMergedIssueClosures: async (loadedState, loadedIssues) => {
      calls.push("reconcileMergedIssueClosures");
      assert.equal(loadedState, state);
      assert.equal(loadedIssues, issues);
      return [];
    },
    reconcileStaleFailedIssueStates: async (loadedState, loadedIssues) => {
      calls.push("reconcileStaleFailedIssueStates");
      assert.equal(loadedState, state);
      assert.equal(loadedIssues, issues);
    },
    reconcileRecoverableBlockedIssueStates: async (loadedState, loadedIssues) => {
      calls.push("reconcileRecoverableBlockedIssueStates");
      assert.equal(loadedState, state);
      assert.equal(loadedIssues, issues);
      return [blockedRecoveryEvent];
    },
    reconcileParentEpicClosures: async (loadedState, loadedIssues) => {
      calls.push("reconcileParentEpicClosures");
      assert.equal(loadedState, state);
      assert.equal(loadedIssues, issues);
    },
    cleanupExpiredDoneWorkspaces: async (loadedState) => {
      calls.push("cleanupExpiredDoneWorkspaces");
      assert.equal(loadedState, state);
      return [orphanCleanupEvent];
    },
  });

  assert.deepEqual(calls, [
    "load",
    "reconcileStaleActiveIssueReservation",
    "handleAuthFailure",
    "listAllIssues",
    "reconcileTrackedMergedButOpenIssues",
    "reconcileMergedIssueClosures",
    "reconcileStaleFailedIssueStates",
    "reconcileRecoverableBlockedIssueStates",
    "reconcileParentEpicClosures",
    "cleanupExpiredDoneWorkspaces",
  ]);
  assert.ok(!("kind" in result));
  assert.equal(result.state, state);
  assert.deepEqual(result.recoveryEvents, [
    ...carryover,
    staleReservationEvent,
    mergedConvergenceEvent,
    blockedRecoveryEvent,
    orphanCleanupEvent,
  ]);
});

test("runOnceCyclePrelude returns auth failures with accumulated recovery events", async () => {
  const state: SupervisorStateFile = {
    activeIssueNumber: 41,
    issues: {},
  };
  const carryover: RecoveryEvent[] = [
    {
      issueNumber: 90,
      reason: "carryover recovery",
      at: "2026-03-14T00:00:00Z",
    },
  ];
  const staleReservationEvent: RecoveryEvent = {
    issueNumber: 41,
    reason: "cleared stale reservation",
    at: "2026-03-14T00:01:00Z",
  };

  const result = await runOnceCyclePrelude({
    stateStore: {
      load: async () => state,
    },
    carryoverRecoveryEvents: carryover,
    reconcileStaleActiveIssueReservation: async () => [staleReservationEvent],
    handleAuthFailure: async () => "Skipped supervisor cycle: GitHub auth unavailable (gh auth status failed).",
    listAllIssues: async () => {
      throw new Error("unexpected listAllIssues call");
    },
    reconcileTrackedMergedButOpenIssues: async () => {
      throw new Error("unexpected reconcileTrackedMergedButOpenIssues call");
    },
    reconcileMergedIssueClosures: async () => {
      throw new Error("unexpected reconcileMergedIssueClosures call");
    },
    reconcileStaleFailedIssueStates: async () => {
      throw new Error("unexpected reconcileStaleFailedIssueStates call");
    },
    reconcileRecoverableBlockedIssueStates: async () => {
      throw new Error("unexpected reconcileRecoverableBlockedIssueStates call");
    },
    reconcileParentEpicClosures: async () => {
      throw new Error("unexpected reconcileParentEpicClosures call");
    },
    cleanupExpiredDoneWorkspaces: async () => {
      throw new Error("unexpected cleanupExpiredDoneWorkspaces call");
    },
  });

  assert.ok("kind" in result);
  assert.equal(result.kind, "auth_failure");
  assert.match(result.message, /GitHub auth unavailable/);
  assert.deepEqual(result.recoveryEvents, [...carryover, staleReservationEvent]);
});
