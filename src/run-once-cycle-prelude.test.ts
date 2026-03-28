import test from "node:test";
import assert from "node:assert/strict";
import { GitHubIssue, SupervisorStateFile } from "./core/types";
import { GitHubInventoryRefreshError } from "./github";
import { RecoveryEvent, runOnceCyclePrelude } from "./run-once-cycle-prelude";
import { createRecord } from "./supervisor/supervisor-test-helpers";

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
    reconcileParentEpicClosures: async () => {},
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
    reconcileParentEpicClosures: async () => {},
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
    reconcileParentEpicClosures: async () => {},
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
    reconcileParentEpicClosures: async () => {},
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
            artifact_path: "/tmp/inventory-refresh-failures/primary.json",
            command: ["gh", "issue", "list", "--repo", "owner/repo"],
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
            artifact_path: "/tmp/inventory-refresh-failures/fallback.json",
            command: ["gh", "api", "repos/owner/repo/issues", "--method", "GET", "-f", "page=2"],
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
  assert.equal(savedStates[0]?.inventory_refresh_failure?.diagnostics?.[1]?.page, 2);
  assert.equal(savedStates[0]?.inventory_refresh_failure?.diagnostics?.[1]?.artifact_path, "/tmp/inventory-refresh-failures/fallback.json");
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
    reconcileRecoverableBlockedIssueStates: async (loadedState, loadedIssues) => {
      blockedCalls.push({ loadedState, loadedIssues });
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
    },
  ]);
  assert.equal(result.state.issues["77"]?.state, "ready_to_merge");
  assert.equal(result.state.issues["77"]?.blocked_reason, null);
  assert.equal(result.state.issues["77"]?.last_failure_signature, null);
});

test("runOnceCyclePrelude still reconciles parent epic closures from tracked issue snapshots when full inventory refresh is malformed", async () => {
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
    },
    cleanupExpiredDoneWorkspaces: async () => {
      throw new Error("unexpected cleanupExpiredDoneWorkspaces call");
    },
  });

  assert.ok(!("kind" in result));
  assert.deepEqual(fetchedIssueNumbers, [1043, 1044, 1045]);
  assert.deepEqual(parentEpicClosureCalls, [[parentIssue, childOne, childTwo]]);
  assert.equal(saveCalls.length, 1);
  assert.equal(result.state.inventory_refresh_failure?.source, "gh issue list");
  assert.match(result.state.inventory_refresh_failure?.message ?? "", /Fallback transport: malformed REST inventory fallback payload/);
});

test("runOnceCyclePrelude fetches untracked parent epics for degraded parent closure reconciliation", async () => {
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
    },
    cleanupExpiredDoneWorkspaces: async () => {
      throw new Error("unexpected cleanupExpiredDoneWorkspaces call");
    },
  });

  assert.ok(!("kind" in result));
  assert.deepEqual(fetchedIssueNumbers, [1101, 1102, 1103, 1100]);
  assert.deepEqual(parentEpicClosureCalls, [[childOne, childTwo, childThree, parentIssue]]);
});
