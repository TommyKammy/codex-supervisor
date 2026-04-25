import assert from "node:assert/strict";
import test from "node:test";
import {
  buildRuntimeRecoverySummaryLines,
  buildWorkflowSteps,
  countCandidateIssues,
  describeLoopRuntime,
  formatRefreshTime,
} from "./webui-dashboard-browser-view-model";

test("buildWorkflowSteps marks execute as current when a selected issue is present", () => {
  assert.deepEqual(buildWorkflowSteps({ selectionSummary: { selectedIssueNumber: 42 } }), [
    {
      id: "observe",
      title: "Observe",
      detail: "Connection and freshness checks keep the workspace current.",
      state: "done",
    },
    {
      id: "triage",
      title: "Triage",
      detail: "Queue discovery and reconciliation determine the next candidate.",
      state: "done",
    },
    {
      id: "select",
      title: "Select",
      detail: "No runnable issue is currently waiting for handoff.",
      state: "done",
    },
    {
      id: "execute",
      title: "Execute",
      detail: "Issue #42 is the current active focus.",
      state: "current",
    },
    {
      id: "recover",
      title: "Recover",
      detail: "Recovery remains quiet while no active blockers are reported.",
      state: "idle",
    },
  ]);
});

test("buildWorkflowSteps renders server-provided workflow DTOs instead of parsing status lines", () => {
  assert.deepEqual(
    buildWorkflowSteps({
      workflowSteps: [
        {
          id: "observe",
          title: "Observe",
          detail: "Server DTO says observation is current.",
          state: "current",
        },
        {
          id: "execute",
          title: "Execute",
          detail: "Server DTO says no issue is executing.",
          state: "idle",
        },
        {
          id: "triage",
          title: "Triage",
          detail: "Server DTO says triage is idle.",
          state: "idle",
        },
        {
          id: "select",
          title: "Select",
          detail: "Server DTO says selection is idle.",
          state: "idle",
        },
        {
          id: "recover",
          title: "Recover",
          detail: "Server DTO says recovery is idle.",
          state: "idle",
        },
      ],
      whyLines: ["selected_issue=#99"],
      detailedStatusLines: ["active_issue=#99"],
    } as Parameters<typeof buildWorkflowSteps>[0] & {
      workflowSteps: ReturnType<typeof buildWorkflowSteps>;
    }),
    [
      {
        id: "observe",
        title: "Observe",
        detail: "Server DTO says observation is current.",
        state: "current",
      },
      {
        id: "execute",
        title: "Execute",
        detail: "Server DTO says no issue is executing.",
        state: "idle",
      },
      {
        id: "triage",
        title: "Triage",
        detail: "Server DTO says triage is idle.",
        state: "idle",
      },
      {
        id: "select",
        title: "Select",
        detail: "Server DTO says selection is idle.",
        state: "idle",
      },
      {
        id: "recover",
        title: "Recover",
        detail: "Server DTO says recovery is idle.",
        state: "idle",
      },
    ],
  );
});

test("buildWorkflowSteps falls back when server workflow DTOs are partial", () => {
  const steps = buildWorkflowSteps({
    workflowSteps: [
      {
        id: "observe",
        title: "Observe",
        detail: "Partial server DTO should not render.",
        state: "current",
      },
      {
        id: "execute",
        title: "Execute",
        detail: "Partial server DTO should not render.",
        state: "idle",
      },
    ],
    whyLines: ["selected_issue=#99"],
  } as Parameters<typeof buildWorkflowSteps>[0] & {
    workflowSteps: ReturnType<typeof buildWorkflowSteps>;
  });

  assert.deepEqual(
    steps.map((step) => [step.id, step.state]),
    [
      ["observe", "done"],
      ["triage", "done"],
      ["select", "done"],
      ["execute", "current"],
      ["recover", "idle"],
    ],
  );
  assert.equal(steps[3].detail, "Issue #99 is the current active focus.");
  assert.ok(steps.every((step) => !step.detail.includes("Partial server DTO")));
});

test("buildWorkflowSteps falls back when server workflow DTOs include malformed entries", () => {
  const steps = buildWorkflowSteps({
    workflowSteps: [
      {
        id: "observe",
        title: "Observe",
        detail: "Complete server DTO should not render with malformed extras.",
        state: "current",
      },
      {
        id: "triage",
        title: "Triage",
        detail: "Complete server DTO should not render with malformed extras.",
        state: "idle",
      },
      {
        id: "select",
        title: "Select",
        detail: "Complete server DTO should not render with malformed extras.",
        state: "idle",
      },
      {
        id: "execute",
        title: "Execute",
        detail: "Complete server DTO should not render with malformed extras.",
        state: "idle",
      },
      {
        id: "recover",
        title: "Recover",
        detail: "Complete server DTO should not render with malformed extras.",
        state: "idle",
      },
      {
        id: "observe",
        title: "Malformed",
        detail: "",
        state: "idle",
      },
    ],
    selectionSummary: { selectedIssueNumber: 101 },
  } as Parameters<typeof buildWorkflowSteps>[0] & {
    workflowSteps: ReturnType<typeof buildWorkflowSteps>;
  });

  assert.equal(steps[3].detail, "Issue #101 is the current active focus.");
  assert.ok(steps.every((step) => !step.detail.includes("Complete server DTO")));
});

test("buildWorkflowSteps surfaces recover as the current step when only blocked issues remain", () => {
  assert.deepEqual(
    buildWorkflowSteps({
      blockedIssues: [{ issueNumber: 93, title: "Needs scope repair", blockedBy: "requirements:scope" }],
    }).map((step) => step.state),
    ["done", "done", "done", "done", "current warn"],
  );
});

test("describeLoopRuntime summarizes running, off, and unknown states with host mode detail", () => {
  assert.deepEqual(describeLoopRuntime({ state: "running", hostMode: "tmux" }), {
    modeBadge: "Mode: web + loop running (tmux)",
    summary: "Loop mode is running on this host via tmux",
    chipLabel: "loop running via tmux",
    chipTone: "ok",
  });

  assert.deepEqual(describeLoopRuntime({ state: "running", hostMode: "direct" }), {
    modeBadge: "Mode: web + loop running (direct)",
    summary: "Loop mode is running on this host directly",
    chipLabel: "loop running directly",
    chipTone: "warn",
  });

  assert.deepEqual(describeLoopRuntime({ state: "off" }), {
    modeBadge: "Mode: web only (loop off)",
    summary: "Loop mode is off on this host",
    chipLabel: "loop off",
    chipTone: "ok",
  });

  assert.deepEqual(describeLoopRuntime({
    state: "off",
    hostMode: "unknown",
    ownershipConfidence: "duplicate_suspected",
    recoveryGuidance:
      "Safe recovery: for config /tmp/supervisor.config.json, stop the tmux-managed loop with ./scripts/stop-loop-tmux.sh, inspect the listed direct loop PIDs before stopping any process, then restart with ./scripts/start-loop-tmux.sh using the same config.",
    duplicateLoopDiagnostic: {
      kind: "duplicate_loop_processes",
      status: "duplicate",
      matchingProcessCount: 2,
      matchingPids: [4242, 4243],
      configPath: "/tmp/supervisor.config.json",
      stateFile: "/tmp/state.json",
      recoveryGuidance:
        "Safe recovery: for config /tmp/supervisor.config.json, stop the tmux-managed loop with ./scripts/stop-loop-tmux.sh, inspect the listed direct loop PIDs before stopping any process, then restart with ./scripts/start-loop-tmux.sh using the same config.",
    },
  }), {
    modeBadge: "Mode: web + loop ambiguous",
    summary:
      "Loop runtime ownership is ambiguous: 2 matching loop processes. Safe recovery: for config /tmp/supervisor.config.json, stop the tmux-managed loop with ./scripts/stop-loop-tmux.sh, inspect the listed direct loop PIDs before stopping any process, then restart with ./scripts/start-loop-tmux.sh using the same config.",
    chipLabel: "loop ownership ambiguous",
    chipTone: "warn",
  });

  assert.deepEqual(describeLoopRuntime({
    state: "unknown",
    hostMode: "unknown",
    ownershipConfidence: "ambiguous_owner",
    pid: 4242,
    configPath: "/tmp/supervisor.config.json",
    recoveryGuidance:
      "Safe recovery: verify marker PID 4242 owns config /tmp/supervisor.config.json before restarting automation; if ownership is still unclear, inspect the process and marker instead of deleting the marker or killing processes automatically.",
  }), {
    modeBadge: "Mode: local WebUI",
    summary:
      "Loop runtime marker ownership is ambiguous. Safe recovery: verify marker PID 4242 owns config /tmp/supervisor.config.json before restarting automation; if ownership is still unclear, inspect the process and marker instead of deleting the marker or killing processes automatically.",
    chipLabel: "loop marker ambiguous",
    chipTone: "warn",
  });

  assert.deepEqual(describeLoopRuntime({
    state: "off",
    hostMode: "unknown",
    duplicateLoopDiagnostic: {
      kind: "unrelated_runtime_diagnostic",
      status: "informational",
      matchingProcessCount: 2,
    },
  }), {
    modeBadge: "Mode: web only (loop off)",
    summary: "Loop mode is off on this host",
    chipLabel: "loop off",
    chipTone: "ok",
  });

  assert.deepEqual(describeLoopRuntime(null), {
    modeBadge: "Mode: local WebUI",
    summary: "Loop status is unavailable on this host",
    chipLabel: "loop unknown",
    chipTone: "info",
  });
});

test("countCandidateIssues and formatRefreshTime handle missing values predictably", () => {
  assert.equal(countCandidateIssues({ candidateDiscovery: { observedMatchingOpenIssues: 251 } }), "251");
  assert.equal(countCandidateIssues({ candidateDiscovery: { observedMatchingOpenIssues: null } }), "n/a");
  assert.equal(countCandidateIssues({}), "n/a");

  assert.equal(formatRefreshTime(null), "never");
  const refreshTime = formatRefreshTime("2026-03-25T01:02:03.000Z");
  assert.equal(typeof refreshTime, "string");
  assert.notEqual(refreshTime, "");
  assert.notEqual(refreshTime, "never");
});

test("buildRuntimeRecoverySummaryLines skips malformed tracked records and signals", () => {
  const lines = buildRuntimeRecoverySummaryLines({
    loopState: "off",
    lockConfidence: "stale_lock",
    trackedRecords: [
      null,
      "invalid",
      {
        issueNumber: 1720,
        state: "blocked",
        prNumber: 1725,
        blockedReason: "review",
      },
    ] as unknown as NonNullable<Parameters<typeof buildRuntimeRecoverySummaryLines>[0]>["trackedRecords"],
    signals: [
      42,
      null,
      {
        kind: "stale_review_bot_remediation",
        summary: "metadata_only",
      },
    ] as unknown as NonNullable<Parameters<typeof buildRuntimeRecoverySummaryLines>[0]>["signals"],
  });

  assert.deepEqual(lines, [
    "loop_state: off",
    "lock_confidence: stale_lock",
    "tracked_records: #1720 blocked pr=#1725 blocked_reason=review",
    "signal: stale_review_bot_remediation metadata_only",
  ]);
});
