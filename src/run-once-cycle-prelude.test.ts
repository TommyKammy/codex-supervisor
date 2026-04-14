import test from "node:test";
import assert from "node:assert/strict";
import { GitHubIssue, SupervisorStateFile } from "./core/types";
import { GitHubInventoryRefreshError } from "./github";
import { reconcileTrackedMergedButOpenIssues } from "./recovery-reconciliation";
import { RecoveryEvent, runOnceCyclePrelude } from "./run-once-cycle-prelude";
import {
  shouldAutoRecoverStaleReviewBot,
  shouldReconcileTrackedPrStaleReviewBot,
} from "./supervisor/supervisor-execution-policy";
import { createConfig, createIssue, createPullRequest, createRecord } from "./supervisor/supervisor-test-helpers";

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
  const parentEpicClosureEvent: RecoveryEvent = {
    issueNumber: 45,
    reason: "parent_epic_auto_closed: auto-closed parent epic #45 because child issues #46, #47 are closed",
    at: "2026-03-14T00:03:30Z",
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
      save: async () => {
        calls.push("save");
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
      return [parentEpicClosureEvent];
    },
    cleanupExpiredDoneWorkspaces: async (loadedState) => {
      calls.push("cleanupExpiredDoneWorkspaces");
      assert.equal(loadedState, state);
      return [orphanCleanupEvent];
    },
  });

  assert.deepEqual(calls, [
    "load",
    "handleAuthFailure",
    "reconcileStaleActiveIssueReservation",
    "listAllIssues",
    "save",
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
    parentEpicClosureEvent,
    orphanCleanupEvent,
  ]);
});

test("runOnceCyclePrelude persists the last-known-good inventory snapshot after a successful full inventory refresh", async () => {
  const state: SupervisorStateFile = {
    activeIssueNumber: null,
    issues: {},
    inventory_refresh_failure: {
      source: "gh issue list",
      message: "Previous refresh failed",
      recorded_at: "2026-03-25T00:00:00Z",
    },
  };
  const issues: GitHubIssue[] = [
    {
      number: 41,
      title: "Persist inventory snapshot",
      body: "## Summary\nPersist the last-known-good full inventory snapshot.",
      createdAt: "2026-03-26T00:00:00Z",
      updatedAt: "2026-03-26T00:00:00Z",
      url: "https://example.test/issues/41",
      state: "OPEN",
    },
    {
      number: 42,
      title: "Show stale snapshot status",
      body: "## Summary\nShow stale snapshot status during degraded mode.",
      createdAt: "2026-03-26T00:01:00Z",
      updatedAt: "2026-03-26T00:01:00Z",
      url: "https://example.test/issues/42",
      state: "OPEN",
    },
  ];
  const savedStates: SupervisorStateFile[] = [];

  const result = await runOnceCyclePrelude({
    stateStore: {
      load: async () => state,
      save: async (nextState) => {
        savedStates.push(structuredClone(nextState));
      },
    },
    carryoverRecoveryEvents: [],
    reconcileStaleActiveIssueReservation: async () => [],
    handleAuthFailure: async () => null,
    listAllIssues: async () => issues,
    reserveRunnableIssueSelection: async () => false,
    reconcileTrackedMergedButOpenIssues: async () => [],
    reconcileMergedIssueClosures: async () => [],
    reconcileStaleFailedIssueStates: async () => {},
    reconcileRecoverableBlockedIssueStates: async () => [],
    reconcileParentEpicClosures: async () => [],
    cleanupExpiredDoneWorkspaces: async () => [],
  });

  assert.ok(!("kind" in result));
  assert.equal(savedStates.length, 1);
  assert.equal(savedStates[0]?.inventory_refresh_failure, undefined);
  assert.equal(savedStates[0]?.last_successful_inventory_snapshot?.source, "gh issue list");
  assert.equal(savedStates[0]?.last_successful_inventory_snapshot?.issue_count, 2);
  assert.deepEqual(savedStates[0]?.last_successful_inventory_snapshot?.issues, issues);
  assert.equal(result.state.last_successful_inventory_snapshot?.source, "gh issue list");
  assert.equal(result.state.last_successful_inventory_snapshot?.issue_count, 2);
});

test("runOnceCyclePrelude prioritizes recoverable tracked PR reconciliation ahead of historical done records", async () => {
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
  const issues: GitHubIssue[] = [];
  const prLookups: number[] = [];
  let saveCalls = 0;

  const result = await runOnceCyclePrelude({
    stateStore: {
      load: async () => state,
      save: async () => {
        saveCalls += 1;
      },
    },
    carryoverRecoveryEvents: [],
    reconcileStaleActiveIssueReservation: async () => [],
    handleAuthFailure: async () => null,
    listAllIssues: async () => issues,
    reconcileTrackedMergedButOpenIssues: async (loadedState, loadedIssues, updateReconciliationProgress, options) =>
      reconcileTrackedMergedButOpenIssues(
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
          touch(record, patch) {
            return {
              ...record,
              ...patch,
              updated_at: "2026-03-13T00:25:00Z",
            };
          },
          save: async () => {
            saveCalls += 1;
          },
        },
        loadedState,
        createConfig(),
        loadedIssues,
        updateReconciliationProgress,
        options,
      ),
    reconcileMergedIssueClosures: async () => [],
    reconcileStaleFailedIssueStates: async () => {},
    reconcileRecoverableBlockedIssueStates: async () => [],
    reconcileParentEpicClosures: async () => [],
    cleanupExpiredDoneWorkspaces: async () => [],
    reserveRunnableIssueSelection: async () => false,
  });

  assert.ok(!("kind" in result));
  assert.deepEqual(prLookups, [901, 902]);
  assert.deepEqual(result.recoveryEvents, []);
  assert.equal(saveCalls, 1);
  assert.equal(result.state.issues["450"]?.state, "merging");
  assert.equal(result.state.issues["451"]?.state, "waiting_ci");
});

test("runOnceCyclePrelude rehydrates tracked blocked PRs before reserving selection", async () => {
  const state: SupervisorStateFile = {
    activeIssueNumber: null,
    issues: {
      "77": createRecord({
        issue_number: 77,
        state: "blocked",
        pr_number: 170,
        blocked_reason: "manual_review",
        last_head_sha: "head-170",
      }),
    },
  };
  const issues: GitHubIssue[] = [
    {
      number: 77,
      title: "Tracked blocked PR",
      body: "",
      createdAt: "2026-03-26T00:00:00Z",
      updatedAt: "2026-03-26T00:00:00Z",
      url: "https://example.test/issues/77",
      state: "OPEN",
    },
  ];
  const calls: string[] = [];

  const result = await runOnceCyclePrelude({
    stateStore: {
      load: async () => state,
      save: async () => {
        calls.push("save");
      },
    },
    carryoverRecoveryEvents: [],
    reconcileStaleActiveIssueReservation: async () => [],
    handleAuthFailure: async () => null,
    listAllIssues: async () => issues,
    reserveRunnableIssueSelection: async (loadedState) => {
      calls.push(`reserve:${loadedState.issues["77"]?.state}`);
      return false;
    },
    reconcileTrackedMergedButOpenIssues: async () => {
      calls.push("tracked_merged");
      return [];
    },
    reconcileMergedIssueClosures: async () => {
      calls.push("merged_closures");
      return [];
    },
    reconcileStaleFailedIssueStates: async () => {
      calls.push("stale_failed");
    },
    reconcileRecoverableBlockedIssueStates: async (loadedState) => {
      calls.push("recoverable_blocked");
      loadedState.issues["77"] = {
        ...loadedState.issues["77"]!,
        state: "ready_to_merge",
        blocked_reason: null,
      };
      return [];
    },
    reconcileParentEpicClosures: async () => {
      calls.push("parent_epics");
      return [];
    },
    cleanupExpiredDoneWorkspaces: async () => {
      calls.push("cleanup");
      return [];
    },
  });

  assert.ok(!("kind" in result));
  assert.deepEqual(calls, [
    "save",
    "tracked_merged",
    "merged_closures",
    "stale_failed",
    "recoverable_blocked",
    "reserve:ready_to_merge",
    "parent_epics",
    "cleanup",
  ]);
});

test("runOnceCyclePrelude reconciles stale done no-PR records before reserving a new issue", async () => {
  const state: SupervisorStateFile = {
    activeIssueNumber: null,
    issues: {
      "77": createRecord({
        issue_number: 77,
        state: "done",
        pr_number: null,
        blocked_reason: null,
        codex_session_id: null,
        last_recovery_reason:
          "already_satisfied_on_main: marked issue #77 done after failed no-PR recovery found no meaningful branch changes",
      }),
    },
  };
  const issues: GitHubIssue[] = [
    {
      number: 77,
      title: "Stale done issue",
      body: "",
      createdAt: "2026-03-26T00:00:00Z",
      updatedAt: "2026-03-26T00:00:00Z",
      url: "https://example.test/issues/77",
      state: "OPEN",
    },
  ];
  const calls: string[] = [];

  const result = await runOnceCyclePrelude({
    stateStore: {
      load: async () => state,
      save: async () => {
        calls.push("save");
      },
    },
    carryoverRecoveryEvents: [],
    reconcileStaleActiveIssueReservation: async () => [],
    handleAuthFailure: async () => null,
    listAllIssues: async () => issues,
    reserveRunnableIssueSelection: async (loadedState) => {
      calls.push(`reserve:${loadedState.issues["77"]?.state}`);
      return false;
    },
    reconcileTrackedMergedButOpenIssues: async () => {
      calls.push("tracked_merged");
      return [];
    },
    reconcileMergedIssueClosures: async () => {
      calls.push("merged_closures");
      return [];
    },
    reconcileStaleFailedIssueStates: async () => {
      calls.push("stale_failed");
    },
    reconcileStaleDoneIssueStates: async (loadedState, loadedIssues) => {
      calls.push("stale_done");
      assert.equal(loadedState, state);
      assert.equal(loadedIssues, issues);
      loadedState.issues["77"] = {
        ...loadedState.issues["77"]!,
        state: "blocked",
        blocked_reason: "manual_review",
      };
      return [];
    },
    reconcileRecoverableBlockedIssueStates: async () => {
      calls.push("recoverable_blocked");
      return [];
    },
    reconcileParentEpicClosures: async () => {
      calls.push("parent_epics");
      return [];
    },
    cleanupExpiredDoneWorkspaces: async () => {
      calls.push("cleanup");
      return [];
    },
  });

  assert.ok(!("kind" in result));
  assert.deepEqual(calls, [
    "save",
    "tracked_merged",
    "merged_closures",
    "stale_failed",
    "stale_done",
    "recoverable_blocked",
    "reserve:blocked",
    "recoverable_blocked",
    "parent_epics",
    "cleanup",
  ]);
});

test("runOnceCyclePrelude reconciles tracked PR-open issues before reserving a new issue", async () => {
  const state: SupervisorStateFile = {
    activeIssueNumber: null,
    issues: {
      "77": createRecord({
        issue_number: 77,
        state: "pr_open",
        pr_number: 170,
        last_head_sha: "head-170",
      }),
    },
  };
  const issues: GitHubIssue[] = [
    {
      number: 77,
      title: "Tracked PR-open issue",
      body: "",
      createdAt: "2026-03-26T00:00:00Z",
      updatedAt: "2026-03-26T00:00:00Z",
      url: "https://example.test/issues/77",
      state: "OPEN",
    },
    {
      number: 91,
      title: "Fresh runnable issue",
      body: "",
      createdAt: "2026-03-26T00:01:00Z",
      updatedAt: "2026-03-26T00:01:00Z",
      url: "https://example.test/issues/91",
      state: "OPEN",
    },
  ];
  const calls: string[] = [];

  const result = await runOnceCyclePrelude({
    stateStore: {
      load: async () => state,
      save: async () => {
        calls.push("save");
      },
    },
    carryoverRecoveryEvents: [],
    reconcileStaleActiveIssueReservation: async () => [],
    handleAuthFailure: async () => null,
    listAllIssues: async () => issues,
    reserveRunnableIssueSelection: async () => {
      calls.push("reserve");
      return false;
    },
    reconcileTrackedMergedButOpenIssues: async () => {
      calls.push("tracked_merged");
      return [];
    },
    reconcileMergedIssueClosures: async () => {
      calls.push("merged_closures");
      return [];
    },
    reconcileStaleFailedIssueStates: async () => {
      calls.push("stale_failed");
    },
    reconcileRecoverableBlockedIssueStates: async () => {
      calls.push("recoverable_blocked");
      return [];
    },
    reconcileParentEpicClosures: async () => {
      calls.push("parent_epics");
      return [];
    },
    cleanupExpiredDoneWorkspaces: async () => {
      calls.push("cleanup");
      return [];
    },
  });

  assert.ok(!("kind" in result));
  assert.deepEqual(calls, [
    "save",
    "tracked_merged",
    "merged_closures",
    "stale_failed",
    "recoverable_blocked",
    "reserve",
    "parent_epics",
    "cleanup",
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

  const result = await runOnceCyclePrelude({
    stateStore: {
      load: async () => state,
      save: async () => {},
    },
    carryoverRecoveryEvents: carryover,
    reconcileStaleActiveIssueReservation: async () => {
      throw new Error("unexpected reconcileStaleActiveIssueReservation call");
    },
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
  assert.deepEqual(result.recoveryEvents, carryover);
});

test("runOnceCyclePrelude publishes the active reconciliation phase and clears it when complete", async () => {
  const state: SupervisorStateFile = {
    activeIssueNumber: null,
    issues: {},
  };
  const observedPhases: Array<string | null> = [];

  await runOnceCyclePrelude({
    stateStore: {
      load: async () => state,
      save: async () => {},
    },
    carryoverRecoveryEvents: [],
    setReconciliationPhase: async (phase) => {
      observedPhases.push(phase);
    },
    reconcileStaleActiveIssueReservation: async () => [],
    handleAuthFailure: async () => null,
    listAllIssues: async () => [],
    reconcileTrackedMergedButOpenIssues: async () => [],
    reconcileMergedIssueClosures: async () => [],
    reconcileStaleFailedIssueStates: async () => {},
    reconcileRecoverableBlockedIssueStates: async () => [],
    reconcileParentEpicClosures: async () => [],
    cleanupExpiredDoneWorkspaces: async () => [],
  });

  assert.deepEqual(observedPhases, [
    "stale_active_issue_reservation",
    "tracked_merged_but_open_issues",
    "merged_issue_closures",
    "stale_failed_issue_states",
    "recoverable_blocked_issue_states",
    "parent_epic_closures",
    "cleanup_expired_done_workspaces",
    null,
  ]);
});

test("runOnceCyclePrelude publishes reconciliation target updates within a phase", async () => {
  const state: SupervisorStateFile = {
    activeIssueNumber: null,
    issues: {},
  };
  const observedProgress: unknown[] = [];

  await runOnceCyclePrelude({
    stateStore: {
      load: async () => state,
      save: async () => {},
    },
    carryoverRecoveryEvents: [],
    setReconciliationProgress: async (progress) => {
      observedProgress.push(progress);
    },
    reconcileStaleActiveIssueReservation: async () => [],
    handleAuthFailure: async () => null,
    listAllIssues: async () => [],
    reconcileTrackedMergedButOpenIssues: async (_loadedState, _loadedIssues, updateReconciliationProgress) => {
      await updateReconciliationProgress({
        targetIssueNumber: 77,
        targetPrNumber: 170,
      });
      return [];
    },
    reconcileMergedIssueClosures: async () => [],
    reconcileStaleFailedIssueStates: async () => {},
    reconcileRecoverableBlockedIssueStates: async () => [],
    reconcileParentEpicClosures: async () => [],
    cleanupExpiredDoneWorkspaces: async () => [],
  });

  assert.deepEqual(observedProgress, [
    {
      phase: "stale_active_issue_reservation",
      targetIssueNumber: null,
      targetPrNumber: null,
      waitStep: null,
    },
    {
      phase: "tracked_merged_but_open_issues",
      targetIssueNumber: null,
      targetPrNumber: null,
      waitStep: null,
    },
    {
      phase: "tracked_merged_but_open_issues",
      targetIssueNumber: 77,
      targetPrNumber: 170,
      waitStep: null,
    },
    {
      phase: "merged_issue_closures",
      targetIssueNumber: null,
      targetPrNumber: null,
      waitStep: null,
    },
    {
      phase: "stale_failed_issue_states",
      targetIssueNumber: null,
      targetPrNumber: null,
      waitStep: null,
    },
    {
      phase: "recoverable_blocked_issue_states",
      targetIssueNumber: null,
      targetPrNumber: null,
      waitStep: null,
    },
    {
      phase: "parent_epic_closures",
      targetIssueNumber: null,
      targetPrNumber: null,
      waitStep: null,
    },
    {
      phase: "cleanup_expired_done_workspaces",
      targetIssueNumber: null,
      targetPrNumber: null,
      waitStep: null,
    },
    null,
  ]);
});

test("runOnceCyclePrelude emits typed recovery events for transport adapters", async () => {
  const state: SupervisorStateFile = {
    activeIssueNumber: null,
    issues: {},
  };
  const issues: GitHubIssue[] = [];
  const recoveryEvents: RecoveryEvent[] = [
    {
      issueNumber: 77,
      reason: "tracked_pr_head_advanced: resumed issue #77 after tracked PR advanced",
      at: "2026-03-14T00:03:00Z",
    },
  ];
  const emitted: unknown[] = [];

  await runOnceCyclePrelude({
    stateStore: {
      load: async () => state,
      save: async () => {},
    },
    carryoverRecoveryEvents: [],
    emitEvent: (event) => {
      emitted.push(event);
    },
    reconcileStaleActiveIssueReservation: async () => [],
    handleAuthFailure: async () => null,
    listAllIssues: async () => issues,
    reconcileTrackedMergedButOpenIssues: async () => recoveryEvents,
    reconcileMergedIssueClosures: async () => [],
    reconcileStaleFailedIssueStates: async () => {},
    reconcileRecoverableBlockedIssueStates: async () => [],
    reconcileParentEpicClosures: async () => [],
    cleanupExpiredDoneWorkspaces: async () => [],
  });

  assert.deepEqual(emitted, [
    {
      type: "supervisor.recovery",
      family: "recovery",
      issueNumber: 77,
      reason: "tracked_pr_head_advanced: resumed issue #77 after tracked PR advanced",
      at: "2026-03-14T00:03:00Z",
    },
  ]);
});

test("runOnceCyclePrelude contains malformed inventory failures for an active tracked issue", async () => {
  const state: SupervisorStateFile = {
    activeIssueNumber: 41,
    issues: {
      "41": {
        issue_number: 41,
        state: "waiting_ci",
        branch: "issue-41",
        pr_number: 1033,
        workspace: "/tmp/issue-41",
        journal_path: null,
        review_wait_started_at: null,
        review_wait_head_sha: null,
        provider_success_observed_at: null,
        provider_success_head_sha: null,
        merge_readiness_last_evaluated_at: null,
        copilot_review_requested_observed_at: null,
        copilot_review_requested_head_sha: null,
        copilot_review_timed_out_at: null,
        copilot_review_timeout_action: null,
        copilot_review_timeout_reason: null,
        codex_session_id: null,
        local_review_head_sha: null,
        local_review_blocker_summary: null,
        local_review_summary_path: null,
        local_review_run_at: null,
        local_review_max_severity: null,
        local_review_findings_count: 0,
        local_review_root_cause_count: 0,
        local_review_verified_max_severity: null,
        local_review_verified_findings_count: 0,
        local_review_recommendation: null,
        local_review_degraded: false,
        last_local_review_signature: null,
        repeated_local_review_signature_count: 0,
        external_review_head_sha: null,
        external_review_misses_path: null,
        external_review_matched_findings_count: 0,
        external_review_near_match_findings_count: 0,
        external_review_missed_findings_count: 0,
        attempt_count: 0,
        implementation_attempt_count: 0,
        repair_attempt_count: 0,
        timeout_retry_count: 0,
        blocked_verification_retry_count: 0,
        repeated_blocker_count: 0,
        repeated_failure_signature_count: 0,
        last_head_sha: null,
        last_codex_summary: null,
        last_recovery_reason: null,
        last_recovery_at: null,
        last_error: null,
        last_failure_kind: null,
        last_failure_context: null,
        last_blocker_signature: null,
        last_failure_signature: null,
        blocked_reason: null,
        processed_review_thread_ids: [],
        processed_review_thread_fingerprints: [],
        updated_at: "2026-03-26T00:00:00Z",
      },
    },
  };
  const savedStates: SupervisorStateFile[] = [];
  let reconcileCallCount = 0;

  const result = await runOnceCyclePrelude({
    stateStore: {
      load: async () => state,
      save: async (nextState) => {
        savedStates.push(JSON.parse(JSON.stringify(nextState)) as SupervisorStateFile);
      },
    },
    carryoverRecoveryEvents: [],
    reconcileStaleActiveIssueReservation: async () => [],
    handleAuthFailure: async () => null,
    listAllIssues: async () => {
      throw new Error("Failed to parse JSON from gh issue list: Unexpected token ] in JSON at position 1");
    },
    reconcileTrackedMergedButOpenIssues: async (_loadedState, loadedIssues, _updateReconciliationProgress, options) => {
      reconcileCallCount += 1;
      assert.deepEqual(loadedIssues, []);
      assert.deepEqual(options, { onlyIssueNumber: 41 });
      return [];
    },
    reserveRunnableIssueSelection: async () => {
      throw new Error("unexpected reserveRunnableIssueSelection call");
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

  assert.ok(!("kind" in result));
  assert.equal(reconcileCallCount, 1);
  assert.equal(savedStates.length, 1);
  assert.equal(savedStates[0]?.inventory_refresh_failure?.source, "gh issue list");
  assert.match(savedStates[0]?.inventory_refresh_failure?.message ?? "", /Failed to parse JSON from gh issue list/);
  assert.equal(result.state.inventory_refresh_failure?.source, "gh issue list");
});

test("runOnceCyclePrelude preserves structured primary and fallback inventory diagnostics", async () => {
  const state: SupervisorStateFile = {
    activeIssueNumber: null,
    issues: {},
  };
  const savedStates: SupervisorStateFile[] = [];

  const result = await runOnceCyclePrelude({
    stateStore: {
      load: async () => state,
      save: async (nextState) => {
        savedStates.push(JSON.parse(JSON.stringify(nextState)) as SupervisorStateFile);
      },
    },
    carryoverRecoveryEvents: [],
    reconcileStaleActiveIssueReservation: async () => [],
    handleAuthFailure: async () => null,
    listAllIssues: async () => {
      throw new GitHubInventoryRefreshError(
        [
          "Failed to load full issue inventory.",
          "Primary transport: Failed to parse JSON from gh issue list: Bad control character in string literal",
          "Malformed inventory capture: /tmp/inventory-refresh-failures/primary.json",
          "Fallback transport: Failed to parse JSON from gh api repos/owner/repo/issues page=2: Bad control character in string literal",
          "Malformed inventory capture: /tmp/inventory-refresh-failures/fallback.json",
        ].join("\n"),
        [
          {
            transport: "primary",
            source: "gh issue list",
            message: "Failed to parse JSON from gh issue list: Bad control character in string literal",
            raw_artifact_path: "/tmp/inventory-refresh-failures/primary-raw.json",
            preview_artifact_path: "/tmp/inventory-refresh-failures/primary-preview.json",
            command: ["gh", "issue", "list", "--repo", "owner/repo"],
            parse_stage: "primary_json_parse",
            parse_error: "Failed to parse JSON from gh issue list: Bad control character in string literal",
            stdout_bytes: 32766,
            stderr_bytes: 14,
            captured_at: "2026-03-28T07:16:21.409Z",
            working_directory: "/tmp/workspaces/loop",
          },
          {
            transport: "fallback",
            source: "gh api repos/owner/repo/issues",
            message: "Failed to parse JSON from gh api repos/owner/repo/issues page=2: Bad control character in string literal",
            page: 2,
            raw_artifact_path: "/tmp/inventory-refresh-failures/fallback-raw.json",
            preview_artifact_path: "/tmp/inventory-refresh-failures/fallback-preview.json",
            command: ["gh", "api", "repos/owner/repo/issues", "--method", "GET", "-f", "page=2"],
            parse_stage: "fallback_json_parse",
            parse_error: "Failed to parse JSON from gh api repos/owner/repo/issues page=2: Bad control character in string literal",
            stdout_bytes: 32766,
            stderr_bytes: 9,
            captured_at: "2026-03-28T07:16:22.000Z",
            working_directory: "/tmp/workspaces/loop",
          },
        ],
      );
    },
    reserveRunnableIssueSelection: async () => {
      throw new Error("unexpected reserveRunnableIssueSelection call");
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

  assert.ok(!("kind" in result));
  assert.equal(savedStates.length, 1);
  assert.equal(savedStates[0]?.inventory_refresh_failure?.diagnostics?.length, 2);
  assert.equal(savedStates[0]?.inventory_refresh_failure?.diagnostics?.[0]?.transport, "primary");
  assert.equal(savedStates[0]?.inventory_refresh_failure?.diagnostics?.[1]?.transport, "fallback");
  assert.equal(savedStates[0]?.inventory_refresh_failure?.diagnostics?.[0]?.parse_stage, "primary_json_parse");
  assert.equal(savedStates[0]?.inventory_refresh_failure?.diagnostics?.[1]?.page, 2);
  assert.equal(
    savedStates[0]?.inventory_refresh_failure?.diagnostics?.[0]?.raw_artifact_path,
    "/tmp/inventory-refresh-failures/primary-raw.json",
  );
  assert.equal(
    savedStates[0]?.inventory_refresh_failure?.diagnostics?.[0]?.preview_artifact_path,
    "/tmp/inventory-refresh-failures/primary-preview.json",
  );
  assert.equal(
    savedStates[0]?.inventory_refresh_failure?.diagnostics?.[1]?.raw_artifact_path,
    "/tmp/inventory-refresh-failures/fallback-raw.json",
  );
  assert.equal(
    savedStates[0]?.inventory_refresh_failure?.diagnostics?.[1]?.preview_artifact_path,
    "/tmp/inventory-refresh-failures/fallback-preview.json",
  );
  assert.equal(result.state.inventory_refresh_failure?.diagnostics?.[0]?.command?.[0], "gh");
});

test("runOnceCyclePrelude blocks new selection when full inventory refresh is malformed and no issue is active", async () => {
  const state: SupervisorStateFile = {
    activeIssueNumber: null,
    issues: {},
  };
  let reserveCalled = false;

  const result = await runOnceCyclePrelude({
    stateStore: {
      load: async () => state,
      save: async () => {},
    },
    carryoverRecoveryEvents: [],
    reconcileStaleActiveIssueReservation: async () => [],
    handleAuthFailure: async () => null,
    listAllIssues: async () => {
      throw new Error("Failed to parse JSON from gh issue list: Unexpected token ] in JSON at position 1");
    },
    reserveRunnableIssueSelection: async () => {
      reserveCalled = true;
      return true;
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

  assert.ok(!("kind" in result));
  assert.equal(reserveCalled, false);
  assert.equal(result.state.inventory_refresh_failure?.source, "gh issue list");
});

test("runOnceCyclePrelude allows new selection after a transient full inventory refresh failure when a fresh snapshot exists", async () => {
  const state: SupervisorStateFile = {
    activeIssueNumber: null,
    issues: {},
    last_successful_inventory_snapshot: {
      source: "gh issue list",
      recorded_at: new Date(Date.now() - 5 * 60 * 1000).toISOString(),
      issue_count: 1,
      issues: [
        {
          number: 91,
          title: "Fresh snapshot candidate",
          body: "## Summary\nAllow snapshot-backed selection after a transient refresh failure.",
          createdAt: "2026-03-26T00:00:00Z",
          updatedAt: "2026-03-26T00:00:00Z",
          url: "https://example.test/issues/91",
          state: "OPEN",
        },
      ],
    },
  };
  const savedStates: SupervisorStateFile[] = [];
  let reserveCallCount = 0;

  const result = await runOnceCyclePrelude({
    stateStore: {
      load: async () => state,
      save: async (nextState) => {
        savedStates.push(structuredClone(nextState));
      },
    },
    carryoverRecoveryEvents: [],
    reconcileStaleActiveIssueReservation: async () => [],
    handleAuthFailure: async () => null,
    listAllIssues: async () => {
      throw new Error(
        'Transient GitHub CLI failure after 3 attempts: gh issue list --repo owner/repo\nCommand failed: gh issue list --repo owner/repo\nexitCode=1\nPost "https://api.github.com/graphql": read tcp 127.0.0.1:12345->140.82.112.6:443: read: connection reset by peer',
      );
    },
    reserveRunnableIssueSelection: async () => {
      reserveCallCount += 1;
      return true;
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

  assert.ok(!("kind" in result));
  assert.equal(savedStates.length, 1);
  assert.equal(savedStates[0]?.inventory_refresh_failure?.source, "gh issue list");
  assert.equal(savedStates[0]?.inventory_refresh_failure?.bounded_continuation_allowed, true);
  assert.equal(savedStates[0]?.inventory_refresh_failure?.selection_permitted, "snapshot_backed");
  assert.equal(reserveCallCount, 1);
});

test("runOnceCyclePrelude still blocks new selection after repeated transient full inventory refresh failures", async () => {
  const state: SupervisorStateFile = {
    activeIssueNumber: null,
    issues: {},
    inventory_refresh_failure: {
      source: "gh issue list",
      message:
        'Transient GitHub CLI failure after 3 attempts: gh issue list --repo owner/repo\nCommand failed: gh issue list --repo owner/repo\nexitCode=1\nPost "https://api.github.com/graphql": read tcp 127.0.0.1:12345->140.82.112.6:443: read: connection reset by peer',
      recorded_at: "2026-03-26T00:09:00Z",
    },
    last_successful_inventory_snapshot: {
      source: "gh issue list",
      recorded_at: new Date(Date.now() - 5 * 60 * 1000).toISOString(),
      issue_count: 1,
      issues: [
        {
          number: 91,
          title: "Fresh snapshot candidate",
          body: "## Summary\nBlock repeated transient refresh failures.",
          createdAt: "2026-03-26T00:00:00Z",
          updatedAt: "2026-03-26T00:00:00Z",
          url: "https://example.test/issues/91",
          state: "OPEN",
        },
      ],
    },
  };
  let reserveCallCount = 0;

  const result = await runOnceCyclePrelude({
    stateStore: {
      load: async () => state,
      save: async () => {},
    },
    carryoverRecoveryEvents: [],
    reconcileStaleActiveIssueReservation: async () => [],
    handleAuthFailure: async () => null,
    listAllIssues: async () => {
      throw new Error(
        'Transient GitHub CLI failure after 3 attempts: gh issue list --repo owner/repo\nCommand failed: gh issue list --repo owner/repo\nexitCode=1\nPost "https://api.github.com/graphql": read tcp 127.0.0.1:12345->140.82.112.6:443: read: connection reset by peer',
      );
    },
    reserveRunnableIssueSelection: async () => {
      reserveCallCount += 1;
      return true;
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

  assert.ok(!("kind" in result));
  assert.equal(reserveCallCount, 0);
  assert.equal(result.state.inventory_refresh_failure?.bounded_continuation_allowed, undefined);
  assert.equal(result.state.inventory_refresh_failure?.selection_permitted, undefined);
});

test("runOnceCyclePrelude hard-blocks tracked PR reconciliation after repeated transient full inventory refresh failures even with a fresh snapshot", async () => {
  const state: SupervisorStateFile = {
    activeIssueNumber: 41,
    issues: {
      "41": createRecord({
        issue_number: 41,
        state: "waiting_ci",
        pr_number: 141,
      }),
    },
    inventory_refresh_failure: {
      source: "gh issue list",
      message:
        'Transient GitHub CLI failure after 3 attempts: gh issue list --repo owner/repo\nCommand failed: gh issue list --repo owner/repo\nexitCode=1\nPost "https://api.github.com/graphql": read tcp 127.0.0.1:12345->140.82.112.6:443: read: connection reset by peer',
      recorded_at: "2026-03-26T00:09:00Z",
    },
    last_successful_inventory_snapshot: {
      source: "gh issue list",
      recorded_at: new Date(Date.now() - 5 * 60 * 1000).toISOString(),
      issue_count: 1,
      issues: [
        {
          number: 41,
          title: "Fresh snapshot candidate",
          body: "## Summary\nBound repeated transient degradation for tracked PR reconciliation.",
          createdAt: "2026-03-26T00:00:00Z",
          updatedAt: "2026-03-26T00:00:00Z",
          url: "https://example.test/issues/41",
          state: "OPEN",
        },
      ],
    },
  };
  let reconcileCallCount = 0;

  const result = await runOnceCyclePrelude({
    stateStore: {
      load: async () => state,
      save: async () => {},
    },
    carryoverRecoveryEvents: [],
    reconcileStaleActiveIssueReservation: async () => [],
    handleAuthFailure: async () => null,
    listAllIssues: async () => {
      throw new Error(
        'Transient GitHub CLI failure after 3 attempts: gh issue list --repo owner/repo\nCommand failed: gh issue list --repo owner/repo\nexitCode=1\nPost "https://api.github.com/graphql": read tcp 127.0.0.1:12345->140.82.112.6:443: read: connection reset by peer',
      );
    },
    reserveRunnableIssueSelection: async () => {
      throw new Error("unexpected reserveRunnableIssueSelection call");
    },
    reconcileTrackedMergedButOpenIssues: async () => {
      reconcileCallCount += 1;
      return [];
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

  assert.ok(!("kind" in result));
  assert.equal(reconcileCallCount, 0);
});

test("runOnceCyclePrelude records rate-limited inventory refresh failures distinctly while keeping active tracked reconciliation available", async () => {
  const state: SupervisorStateFile = {
    activeIssueNumber: 41,
    issues: {
      "41": {
        issue_number: 41,
        state: "waiting_ci",
        branch: "codex/issue-41",
        pr_number: 141,
        workspace: "/tmp/workspaces/issue-41",
        journal_path: null,
        review_wait_started_at: null,
        review_wait_head_sha: null,
        copilot_review_requested_observed_at: null,
        copilot_review_requested_head_sha: null,
        copilot_review_timed_out_at: null,
        copilot_review_timeout_action: null,
        copilot_review_timeout_reason: null,
        codex_session_id: null,
        local_review_head_sha: null,
        local_review_blocker_summary: null,
        local_review_summary_path: null,
        local_review_run_at: null,
        local_review_max_severity: null,
        local_review_findings_count: 0,
        local_review_root_cause_count: 0,
        local_review_verified_max_severity: null,
        local_review_verified_findings_count: 0,
        local_review_recommendation: null,
        local_review_degraded: false,
        last_local_review_signature: null,
        repeated_local_review_signature_count: 0,
        external_review_head_sha: null,
        external_review_misses_path: null,
        external_review_matched_findings_count: 0,
        external_review_near_match_findings_count: 0,
        external_review_missed_findings_count: 0,
        attempt_count: 1,
        implementation_attempt_count: 0,
        repair_attempt_count: 0,
        timeout_retry_count: 0,
        blocked_verification_retry_count: 0,
        repeated_blocker_count: 0,
        repeated_failure_signature_count: 0,
        last_head_sha: null,
        last_codex_summary: null,
        updated_at: "2026-03-26T00:00:00Z",
        blocked_reason: null,
        last_failure_kind: null,
        last_failure_context: null,
        last_blocker_signature: null,
        last_failure_signature: null,
        last_recovery_reason: null,
        last_recovery_at: null,
        last_error: null,
        processed_review_thread_ids: [],
        processed_review_thread_fingerprints: [],
      },
    },
  };
  const savedStates: SupervisorStateFile[] = [];
  let reconcileCallCount = 0;

  const result = await runOnceCyclePrelude({
    stateStore: {
      load: async () => state,
      save: async (nextState) => {
        savedStates.push(JSON.parse(JSON.stringify(nextState)) as SupervisorStateFile);
      },
    },
    carryoverRecoveryEvents: [],
    reconcileStaleActiveIssueReservation: async () => [],
    handleAuthFailure: async () => null,
    listAllIssues: async () => {
      throw new Error(
        'Command failed: gh issue list --repo owner/repo\nexitCode=1\nHTTP 403: You have exceeded a secondary rate limit. Please wait a few minutes before you try again.',
      );
    },
    reconcileTrackedMergedButOpenIssues: async (_loadedState, loadedIssues, _updateReconciliationProgress, options) => {
      reconcileCallCount += 1;
      assert.deepEqual(loadedIssues, []);
      assert.deepEqual(options, { onlyIssueNumber: 41 });
      return [];
    },
    reserveRunnableIssueSelection: async () => {
      throw new Error("unexpected reserveRunnableIssueSelection call");
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

  assert.ok(!("kind" in result));
  assert.equal(reconcileCallCount, 1);
  assert.equal(savedStates.length, 1);
  assert.equal(savedStates[0]?.inventory_refresh_failure?.source, "gh issue list");
  assert.equal(savedStates[0]?.inventory_refresh_failure?.classification, "rate_limited");
  assert.match(savedStates[0]?.inventory_refresh_failure?.message ?? "", /secondary rate limit/);
  assert.equal(result.state.inventory_refresh_failure?.classification, "rate_limited");
});

test("runOnceCyclePrelude rehydrates stale failed tracked PRs during degraded inventory refresh even without an active issue", async () => {
  const state: SupervisorStateFile = {
    activeIssueNumber: null,
    issues: {
      "77": createRecord({
        issue_number: 77,
        state: "failed",
        pr_number: 170,
        last_head_sha: "head-old-170",
        last_failure_signature: "dirty:head-old-170",
        repeated_failure_signature_count: 3,
        blocked_reason: null,
        last_error: "PR was previously conflicted.",
        last_failure_kind: "codex_failed",
      }),
    },
  };
  const savedStates: SupervisorStateFile[] = [];
  const staleFailedCalls: Array<{
    loadedState: SupervisorStateFile;
    loadedIssues: GitHubIssue[];
  }> = [];

  const result = await runOnceCyclePrelude({
    stateStore: {
      load: async () => state,
      save: async (nextState) => {
        savedStates.push(structuredClone(nextState));
      },
    },
    carryoverRecoveryEvents: [],
    reconcileStaleActiveIssueReservation: async () => [],
    handleAuthFailure: async () => null,
    listAllIssues: async () => {
      throw new Error("Failed to parse JSON from gh issue list: Unexpected token ] in JSON at position 1");
    },
    reserveRunnableIssueSelection: async () => {
      throw new Error("unexpected reserveRunnableIssueSelection call");
    },
    reconcileTrackedMergedButOpenIssues: async () => {
      throw new Error("unexpected reconcileTrackedMergedButOpenIssues call");
    },
    reconcileMergedIssueClosures: async () => {
      throw new Error("unexpected reconcileMergedIssueClosures call");
    },
    reconcileStaleFailedIssueStates: async (loadedState, loadedIssues) => {
      staleFailedCalls.push({ loadedState, loadedIssues });
      loadedState.issues["77"] = {
        ...loadedState.issues["77"]!,
        state: "addressing_review",
        last_head_sha: "head-new-170",
        last_failure_signature: null,
        repeated_failure_signature_count: 0,
        last_recovery_reason:
          "tracked_pr_head_advanced: resumed issue #77 from failed to addressing_review after tracked PR #170 advanced from head-old-170 to head-new-170",
      };
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

  assert.ok(!("kind" in result));
  assert.equal(savedStates.length, 1);
  assert.equal(savedStates[0]?.inventory_refresh_failure?.source, "gh issue list");
  assert.deepEqual(staleFailedCalls, [
    {
      loadedState: state,
      loadedIssues: [],
    },
  ]);
  assert.equal(result.state.issues["77"]?.state, "addressing_review");
  assert.equal(result.state.issues["77"]?.last_head_sha, "head-new-170");
  assert.equal(result.state.issues["77"]?.last_failure_signature, null);
});

test("runOnceCyclePrelude rehydrates an active stale failed tracked PR during degraded inventory refresh", async () => {
  const state: SupervisorStateFile = {
    activeIssueNumber: 77,
    issues: {
      "77": createRecord({
        issue_number: 77,
        state: "failed",
        pr_number: 170,
        last_head_sha: "head-old-170",
        last_failure_signature: "repair-budget-exhausted",
        repeated_failure_signature_count: 3,
        blocked_reason: null,
        last_error: "Stopped after repeated repair attempts.",
        last_failure_kind: "codex_failed",
      }),
    },
  };
  const staleFailedCalls: Array<{
    loadedState: SupervisorStateFile;
    loadedIssues: GitHubIssue[];
  }> = [];

  const result = await runOnceCyclePrelude({
    stateStore: {
      load: async () => state,
      save: async () => undefined,
    },
    carryoverRecoveryEvents: [],
    reconcileStaleActiveIssueReservation: async () => [],
    handleAuthFailure: async () => null,
    listAllIssues: async () => {
      throw new Error("Failed to parse JSON from gh issue list: Unexpected token ] in JSON at position 1");
    },
    reserveRunnableIssueSelection: async () => {
      throw new Error("unexpected reserveRunnableIssueSelection call");
    },
    reconcileTrackedMergedButOpenIssues: async () => [],
    reconcileMergedIssueClosures: async () => {
      throw new Error("unexpected reconcileMergedIssueClosures call");
    },
    reconcileStaleFailedIssueStates: async (loadedState, loadedIssues) => {
      staleFailedCalls.push({ loadedState, loadedIssues });
      loadedState.issues["77"] = {
        ...loadedState.issues["77"]!,
        state: "draft_pr",
        last_error: null,
        last_failure_kind: null,
        last_failure_context: null,
        last_failure_signature: null,
        repeated_failure_signature_count: 0,
        last_recovery_reason:
          "tracked_pr_lifecycle_recovered: resumed issue #77 from failed to draft_pr using fresh tracked PR #170 facts at head head-old-170",
      };
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

  assert.ok(!("kind" in result));
  assert.deepEqual(staleFailedCalls, [
    {
      loadedState: state,
      loadedIssues: [],
    },
  ]);
  assert.equal(result.state.issues["77"]?.state, "draft_pr");
  assert.equal(result.state.issues["77"]?.last_error, null);
  assert.equal(result.state.issues["77"]?.last_failure_kind, null);
  assert.equal(result.state.issues["77"]?.last_failure_context, null);
  assert.equal(result.state.issues["77"]?.last_failure_signature, null);
  assert.equal(result.state.issues["77"]?.repeated_failure_signature_count, 0);
});

test("runOnceCyclePrelude rehydrates blocked tracked PRs during degraded inventory refresh", async () => {
  const state: SupervisorStateFile = {
    activeIssueNumber: null,
    issues: {
      "77": createRecord({
        issue_number: 77,
        state: "blocked",
        pr_number: 170,
        blocked_reason: "manual_review",
        last_head_sha: "head-170",
        last_failure_signature: "manual-review:thread-1",
      }),
    },
  };
  const savedStates: SupervisorStateFile[] = [];
  const blockedCalls: Array<{
    loadedState: SupervisorStateFile;
    loadedIssues: GitHubIssue[];
    options?: { onlyTrackedPrStates?: boolean };
  }> = [];

  const result = await runOnceCyclePrelude({
    stateStore: {
      load: async () => state,
      save: async (nextState) => {
        savedStates.push(structuredClone(nextState));
      },
    },
    carryoverRecoveryEvents: [],
    reconcileStaleActiveIssueReservation: async () => [],
    handleAuthFailure: async () => null,
    listAllIssues: async () => {
      throw new Error("Failed to parse JSON from gh issue list: Unexpected token ] in JSON at position 1");
    },
    reserveRunnableIssueSelection: async () => {
      throw new Error("unexpected reserveRunnableIssueSelection call");
    },
    reconcileTrackedMergedButOpenIssues: async () => [],
    reconcileMergedIssueClosures: async () => {
      throw new Error("unexpected reconcileMergedIssueClosures call");
    },
    reconcileStaleFailedIssueStates: async () => {
      throw new Error("unexpected reconcileStaleFailedIssueStates call");
    },
    reconcileRecoverableBlockedIssueStates: async (loadedState, loadedIssues, options) => {
      blockedCalls.push({ loadedState, loadedIssues, options });
      loadedState.issues["77"] = {
        ...loadedState.issues["77"]!,
        state: "ready_to_merge",
        blocked_reason: null,
        last_failure_signature: null,
      };
      return [];
    },
    reconcileParentEpicClosures: async () => {
      throw new Error("unexpected reconcileParentEpicClosures call");
    },
    cleanupExpiredDoneWorkspaces: async () => {
      throw new Error("unexpected cleanupExpiredDoneWorkspaces call");
    },
  });

  assert.ok(!("kind" in result));
  assert.equal(savedStates.length, 1);
  assert.equal(savedStates[0]?.inventory_refresh_failure?.source, "gh issue list");
  assert.deepEqual(blockedCalls, [
    {
      loadedState: state,
      loadedIssues: [],
      options: { onlyTrackedPrStates: true },
    },
  ]);
  assert.equal(result.state.issues["77"]?.state, "ready_to_merge");
  assert.equal(result.state.issues["77"]?.blocked_reason, null);
  assert.equal(result.state.issues["77"]?.last_failure_signature, null);
});

test("runOnceCyclePrelude rehydrates same-head stale review bot tracked PRs during degraded inventory refresh even after auto-handle dedupe is recorded", async () => {
  const config = createConfig({ staleConfiguredBotReviewPolicy: "reply_and_resolve" });
  const state: SupervisorStateFile = {
    activeIssueNumber: null,
    issues: {
      "77": createRecord({
        issue_number: 77,
        state: "blocked",
        pr_number: 170,
        blocked_reason: "stale_review_bot",
        last_head_sha: "head-170",
        last_failure_signature: "stale-configured-bot-review",
        last_stale_review_bot_reply_head_sha: "head-170",
        last_stale_review_bot_reply_signature: "stale-configured-bot-review",
      }),
    },
  };
  const blockedCalls: Array<{
    loadedState: SupervisorStateFile;
    loadedIssues: GitHubIssue[];
    options?: { onlyTrackedPrStates?: boolean };
  }> = [];

  assert.equal(shouldAutoRecoverStaleReviewBot(state.issues["77"]!, config), false);
  assert.equal(shouldReconcileTrackedPrStaleReviewBot(state.issues["77"]!, config), true);

  const result = await runOnceCyclePrelude({
    stateStore: {
      load: async () => state,
      save: async () => {},
    },
    carryoverRecoveryEvents: [],
    shouldReconcileTrackedBlockedRecordDuringDegradedContinuation: (record) =>
      shouldReconcileTrackedPrStaleReviewBot(record, config),
    reconcileStaleActiveIssueReservation: async () => [],
    handleAuthFailure: async () => null,
    listAllIssues: async () => {
      throw new Error("Failed to parse JSON from gh issue list: Unexpected token ] in JSON at position 1");
    },
    reserveRunnableIssueSelection: async () => {
      throw new Error("unexpected reserveRunnableIssueSelection call");
    },
    reconcileTrackedMergedButOpenIssues: async () => [],
    reconcileMergedIssueClosures: async () => {
      throw new Error("unexpected reconcileMergedIssueClosures call");
    },
    reconcileStaleFailedIssueStates: async () => {
      throw new Error("unexpected reconcileStaleFailedIssueStates call");
    },
    reconcileRecoverableBlockedIssueStates: async (loadedState, loadedIssues, options) => {
      blockedCalls.push({ loadedState, loadedIssues, options });
      return [];
    },
    reconcileParentEpicClosures: async () => {
      throw new Error("unexpected reconcileParentEpicClosures call");
    },
    cleanupExpiredDoneWorkspaces: async () => {
      throw new Error("unexpected cleanupExpiredDoneWorkspaces call");
    },
  });

  assert.ok(!("kind" in result));
  assert.deepEqual(blockedCalls, [
    {
      loadedState: state,
      loadedIssues: [],
      options: { onlyTrackedPrStates: true },
    },
  ]);
});

test("runOnceCyclePrelude does not reconcile parent epic closures from tracked issue snapshots when full inventory refresh is malformed", async () => {
  const parentIssue: GitHubIssue = {
    number: 1043,
    title: "Epic issue",
    body: "",
    createdAt: "2026-03-26T00:00:00Z",
    updatedAt: "2026-03-26T00:00:00Z",
    url: "https://example.test/issues/1043",
    state: "OPEN",
  };
  const childOne: GitHubIssue = {
    number: 1044,
    title: "Child one",
    body: "- Part of: #1043",
    createdAt: "2026-03-26T00:00:00Z",
    updatedAt: "2026-03-26T00:00:00Z",
    url: "https://example.test/issues/1044",
    state: "CLOSED",
  };
  const childTwo: GitHubIssue = {
    number: 1045,
    title: "Child two",
    body: "Part of: #1043",
    createdAt: "2026-03-26T00:00:00Z",
    updatedAt: "2026-03-26T00:00:00Z",
    url: "https://example.test/issues/1045",
    state: "CLOSED",
  };
  const issuesByNumber = new Map([
    [parentIssue.number, parentIssue],
    [childOne.number, childOne],
    [childTwo.number, childTwo],
  ]);
  const state: SupervisorStateFile = {
    activeIssueNumber: null,
    issues: {
      "1043": {} as never,
      "1044": {} as never,
      "1045": {} as never,
    },
  };
  const saveCalls: Array<SupervisorStateFile["inventory_refresh_failure"] | undefined> = [];
  const fetchedIssueNumbers: number[] = [];
  const parentEpicClosureCalls: GitHubIssue[][] = [];

  const result = await runOnceCyclePrelude({
    stateStore: {
      load: async () => state,
      save: async (nextState) => {
        saveCalls.push(nextState.inventory_refresh_failure);
      },
    },
    carryoverRecoveryEvents: [],
    reconcileStaleActiveIssueReservation: async () => [],
    handleAuthFailure: async () => null,
    listAllIssues: async () => {
      throw new Error("Failed to load full issue inventory.\nPrimary transport: malformed gh issue list JSON\nFallback transport: malformed REST inventory fallback payload");
    },
    getIssueForParentEpicClosureFallback: async (issueNumber) => {
      fetchedIssueNumbers.push(issueNumber);
      const issue = issuesByNumber.get(issueNumber);
      assert.ok(issue);
      return issue;
    },
    reserveRunnableIssueSelection: async () => {
      throw new Error("unexpected reserveRunnableIssueSelection call");
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
    reconcileParentEpicClosures: async (_loadedState, loadedIssues) => {
      parentEpicClosureCalls.push(loadedIssues);
      return [];
    },
    cleanupExpiredDoneWorkspaces: async () => {
      throw new Error("unexpected cleanupExpiredDoneWorkspaces call");
    },
  });

  assert.ok(!("kind" in result));
  assert.deepEqual(fetchedIssueNumbers, []);
  assert.deepEqual(parentEpicClosureCalls, []);
  assert.equal(saveCalls.length, 1);
  assert.equal(result.state.inventory_refresh_failure?.source, "gh issue list");
  assert.match(result.state.inventory_refresh_failure?.message ?? "", /Fallback transport: malformed REST inventory fallback payload/);
});

test("runOnceCyclePrelude does not attempt degraded parent epic closure from a partial tracked child set", async () => {
  const parentIssue: GitHubIssue = {
    number: 1150,
    title: "Epic issue",
    body: "",
    createdAt: "2026-03-26T00:00:00Z",
    updatedAt: "2026-03-26T00:00:00Z",
    url: "https://example.test/issues/1150",
    state: "OPEN",
  };
  const trackedChild: GitHubIssue = {
    number: 1152,
    title: "Tracked child",
    body: "Part of: #1150",
    createdAt: "2026-03-26T00:00:00Z",
    updatedAt: "2026-03-26T00:00:00Z",
    url: "https://example.test/issues/1152",
    state: "CLOSED",
  };
  const issuesByNumber = new Map([
    [parentIssue.number, parentIssue],
    [trackedChild.number, trackedChild],
  ]);
  const state: SupervisorStateFile = {
    activeIssueNumber: null,
    issues: {
      "1152": {} as never,
    },
  };
  let parentEpicClosureCalls = 0;

  const result = await runOnceCyclePrelude({
    stateStore: {
      load: async () => state,
      save: async () => {},
    },
    carryoverRecoveryEvents: [],
    reconcileStaleActiveIssueReservation: async () => [],
    handleAuthFailure: async () => null,
    listAllIssues: async () => {
      throw new Error("Failed to load full issue inventory.\nPrimary transport: malformed gh issue list JSON");
    },
    getIssueForParentEpicClosureFallback: async (issueNumber) => {
      const issue = issuesByNumber.get(issueNumber);
      assert.ok(issue);
      return issue;
    },
    reserveRunnableIssueSelection: async () => {
      throw new Error("unexpected reserveRunnableIssueSelection call");
    },
    reconcileTrackedMergedButOpenIssues: async () => [],
    reconcileMergedIssueClosures: async () => [],
    reconcileStaleFailedIssueStates: async () => {},
    reconcileRecoverableBlockedIssueStates: async () => [],
    reconcileParentEpicClosures: async () => {
      parentEpicClosureCalls += 1;
      return [];
    },
    cleanupExpiredDoneWorkspaces: async () => [],
  });

  assert.ok(!("kind" in result));
  assert.equal(parentEpicClosureCalls, 0);
  assert.equal(result.state.inventory_refresh_failure?.source, "gh issue list");
});

test("runOnceCyclePrelude does not fetch parent epics for degraded parent closure reconciliation", async () => {
  const parentIssue: GitHubIssue = {
    number: 1100,
    title: "Epic issue",
    body: "",
    createdAt: "2026-03-26T00:00:00Z",
    updatedAt: "2026-03-26T00:00:00Z",
    url: "https://example.test/issues/1100",
    state: "OPEN",
  };
  const childOne: GitHubIssue = {
    number: 1101,
    title: "Child one",
    body: "Part of: #1100",
    createdAt: "2026-03-26T00:00:00Z",
    updatedAt: "2026-03-26T00:00:00Z",
    url: "https://example.test/issues/1101",
    state: "CLOSED",
  };
  const childTwo: GitHubIssue = {
    number: 1102,
    title: "Child two",
    body: "Part of: #1100",
    createdAt: "2026-03-26T00:00:00Z",
    updatedAt: "2026-03-26T00:00:00Z",
    url: "https://example.test/issues/1102",
    state: "CLOSED",
  };
  const childThree: GitHubIssue = {
    number: 1103,
    title: "Child three",
    body: "Part of: #1100",
    createdAt: "2026-03-26T00:00:00Z",
    updatedAt: "2026-03-26T00:00:00Z",
    url: "https://example.test/issues/1103",
    state: "CLOSED",
  };
  const issuesByNumber = new Map([
    [parentIssue.number, parentIssue],
    [childOne.number, childOne],
    [childTwo.number, childTwo],
    [childThree.number, childThree],
  ]);
  const state: SupervisorStateFile = {
    activeIssueNumber: null,
    issues: {
      "1101": {} as never,
      "1102": {} as never,
      "1103": {} as never,
    },
  };
  const fetchedIssueNumbers: number[] = [];
  const parentEpicClosureCalls: GitHubIssue[][] = [];

  const result = await runOnceCyclePrelude({
    stateStore: {
      load: async () => state,
      save: async () => {},
    },
    carryoverRecoveryEvents: [],
    reconcileStaleActiveIssueReservation: async () => [],
    handleAuthFailure: async () => null,
    listAllIssues: async () => {
      throw new Error("Failed to load full issue inventory.\nPrimary transport: malformed gh issue list JSON");
    },
    getIssueForParentEpicClosureFallback: async (issueNumber) => {
      fetchedIssueNumbers.push(issueNumber);
      const issue = issuesByNumber.get(issueNumber);
      assert.ok(issue);
      return issue;
    },
    reserveRunnableIssueSelection: async () => {
      throw new Error("unexpected reserveRunnableIssueSelection call");
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
    reconcileParentEpicClosures: async (_loadedState, loadedIssues) => {
      parentEpicClosureCalls.push(loadedIssues);
      return [];
    },
    cleanupExpiredDoneWorkspaces: async () => {
      throw new Error("unexpected cleanupExpiredDoneWorkspaces call");
    },
  });

  assert.ok(!("kind" in result));
  assert.deepEqual(fetchedIssueNumbers, []);
  assert.deepEqual(parentEpicClosureCalls, []);
});
