import assert from "node:assert/strict";
import test from "node:test";
import { buildSupervisorDashboardWorkflowSteps } from "./supervisor-dashboard-workflow";
import { buildRuntimeRecoverySummary } from "./supervisor-status-report";

const baseLoopRuntime = {
  state: "off" as const,
  hostMode: "unknown" as const,
  markerPath: "none",
  configPath: null,
  stateFile: "none",
  pid: null,
  startedAt: null,
  ownershipConfidence: "none" as const,
  detail: null,
};

test("buildSupervisorDashboardWorkflowSteps owns queue workflow state as a server DTO", () => {
  assert.deepEqual(
    buildSupervisorDashboardWorkflowSteps({
      selectedIssueNumber: null,
      runnableIssueCount: 0,
      blockedIssueCount: 2,
      trackedIssueCount: 3,
      hasCandidateDiscovery: true,
      reconciliationPhase: "steady",
    }).map((step) => [step.id, step.state, step.detail]),
    [
      ["observe", "done", "Connection and freshness checks keep the workspace current."],
      ["triage", "done", "3 tracked issues remain in the working set."],
      ["select", "done", "No runnable issue is currently waiting for handoff."],
      ["execute", "done", "No active issue is currently executing."],
      ["recover", "current warn", "No runnable issue is available, so the supervisor is waiting on recovery or unblock work."],
    ],
  );
});

test("buildSupervisorDashboardWorkflowSteps uses neutral recover detail when no blockers are present", () => {
  const recoverStep = buildSupervisorDashboardWorkflowSteps({
    selectedIssueNumber: null,
    runnableIssueCount: 0,
    blockedIssueCount: 0,
    trackedIssueCount: 1,
    hasCandidateDiscovery: false,
    reconciliationPhase: "steady",
  }).find((step) => step.id === "recover");

  assert.deepEqual(recoverStep, {
    id: "recover",
    title: "Recover",
    detail: "Recovery remains quiet while no active blockers are reported.",
    state: "idle",
  });
});

test("buildSupervisorDashboardWorkflowSteps rejects invalid selected issue numbers before choosing execute", () => {
  for (const selectedIssueNumber of [Number.NaN, 0, -7, 1.5]) {
    const steps = buildSupervisorDashboardWorkflowSteps({
      selectedIssueNumber,
      runnableIssueCount: 1,
      blockedIssueCount: 0,
      trackedIssueCount: 3,
      hasCandidateDiscovery: true,
      reconciliationPhase: "steady",
    });

    assert.equal(steps.find((step) => step.id === "select")?.state, "current");
    assert.deepEqual(steps.find((step) => step.id === "execute"), {
      id: "execute",
      title: "Execute",
      detail: "No active issue is currently executing.",
      state: "idle",
    });
  }
});

test("buildRuntimeRecoverySummary stays quiet when no actionable runtime recovery state exists", () => {
  assert.equal(
    buildRuntimeRecoverySummary({
      loopRuntime: baseLoopRuntime,
      trackedIssues: [],
      detailedStatusLines: ["tracked_issues=0"],
    }),
    null,
  );
});

test("buildRuntimeRecoverySummary stays quiet for quiet no-active tracked records", () => {
  assert.equal(
    buildRuntimeRecoverySummary({
      loopRuntime: baseLoopRuntime,
      trackedIssues: [
        {
          issueNumber: 188,
          state: "done",
          branch: "codex/issue-188",
          prNumber: 288,
          blockedReason: null,
        },
      ],
      detailedStatusLines: [
        "no_active_tracked_record issue=#188 classification=safe_to_ignore state=done reason=terminal_done",
      ],
    }),
    null,
  );
  assert.equal(
    buildRuntimeRecoverySummary({
      loopRuntime: baseLoopRuntime,
      trackedIssues: [],
      detailedStatusLines: [
        "no_active_tracked_record issue=#189 classification=stale_already_handled state=done reason=merged_pr_convergence",
      ],
    }),
    null,
  );
});

test("buildRuntimeRecoverySummary reuses restart recommendation vocabulary and classified recovery signals", () => {
  assert.deepEqual(
    buildRuntimeRecoverySummary({
      loopRuntime: {
        ...baseLoopRuntime,
        ownershipConfidence: "stale_lock",
      },
      trackedIssues: [
        {
          issueNumber: 171,
          state: "blocked",
          branch: "codex/issue-171",
          prNumber: 271,
          blockedReason: "stale_review_bot",
        },
      ],
      detailedStatusLines: [
        "loop_runtime_blocker issue=#171 reason=recoverable_active_tracked_work_waiting_for_loop expected=loop_runtime_state_running_then_tracked_issue_advances",
        "stale_review_bot_remediation issue=#171 pr=#271 reason=stale_review_bot classification=metadata_only manual_next_step=inspect_exact_review_thread_then_resolve_or_leave_manual_note",
        "no_active_tracked_record issue=#178 classification=repair_already_queued state=repairing_ci reason=repairable_path_hygiene_retry_state",
      ],
    }),
    {
      loopState: "off",
      lockConfidence: "stale_lock",
      trackedRecords: [
        {
          issueNumber: 171,
          state: "blocked",
          prNumber: 271,
          blockedReason: "stale_review_bot",
        },
      ],
      signals: [
        {
          kind: "loop_runtime_stale_lock",
          summary: "Loop runtime marker is stale.",
        },
        {
          kind: "stale_review_bot_remediation",
          summary:
            "stale_review_bot_remediation issue=#171 pr=#271 reason=stale_review_bot classification=metadata_only manual_next_step=inspect_exact_review_thread_then_resolve_or_leave_manual_note",
        },
        {
          kind: "repairable_path_hygiene",
          summary:
            "no_active_tracked_record issue=#178 classification=repair_already_queued state=repairing_ci reason=repairable_path_hygiene_retry_state",
        },
      ],
      recommendation: {
        category: "restart_required_for_convergence",
        source: "loop_runtime_blocker",
        summary: "Restarting the supported supervisor loop is required before active tracked work can converge.",
      },
    },
  );
});
