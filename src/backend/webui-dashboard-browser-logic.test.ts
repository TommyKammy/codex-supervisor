import assert from "node:assert/strict";
import test from "node:test";
import {
  buildAttentionItems,
  buildNextIssueSummary,
  buildOverviewSummary,
  buildPrimaryActionSummary,
  buildStatusLines,
  collectTimelineEventIssueNumbers,
  collectIssueShortcuts,
  describeCommandSelectionChange,
  describeConnectionHealth,
  describeTimelineCommandResult,
  describeFreshnessState,
  describeTimelineEvent,
  formatRecentPhaseChanges,
  formatRecoveryLoopSummary,
  formatRetryContextSummary,
  formatTrackedIssues,
  parseSelectedIssueNumber,
} from "./webui-dashboard-browser-logic";
import {
  DASHBOARD_PANEL_IDS,
  DEFAULT_DASHBOARD_PANEL_LAYOUT,
  resolveDashboardPanelLayout,
} from "./webui-dashboard-panel-layout";

test("buildStatusLines summarizes tracked history as a count instead of dumping each tracked issue", () => {
  const lines = buildStatusLines({
    trackedIssues: [
      {
        issueNumber: 58,
        state: "queued",
        branch: "codex/issue-58",
        prNumber: 58,
        blockedReason: null,
      },
    ],
    runnableIssues: [
      {
        issueNumber: 77,
        title: "Ready for inspection",
        readiness: "ready",
      },
    ],
    blockedIssues: [
      {
        issueNumber: 93,
        title: "Needs scope repair",
        blockedBy: "requirements:scope, verification",
      },
    ],
    detailedStatusLines: ["detail line"],
    readinessLines: ["readiness line"],
    whyLines: ["selected_issue=#77"],
    candidateDiscovery: {
      fetchWindow: 250,
      strategy: "paginated",
      truncated: true,
      observedMatchingOpenIssues: 251,
      warning: "Candidate discovery may be truncated.",
    },
    reconciliationWarning: "reconciliation warning",
  });

  assert.deepEqual(lines, [
    "tracked issues=1",
    "runnable issue #77 Ready for inspection ready=ready",
    "blocked issue #93 Needs scope repair blocked_by=requirements:scope, verification",
    "detail line",
    "readiness line",
    "selected_issue=#77",
    "candidate discovery fetch_window=250 strategy=paginated truncated=yes observed_matching_open_issues=251",
    "Candidate discovery may be truncated.",
    "reconciliation warning",
  ]);
});

test("buildAttentionItems includes reconciliation warnings without duplicating status warnings", () => {
  assert.deepEqual(
    buildAttentionItems({
      status: {
        blockedIssues: [],
        runnableIssues: [],
        warning: { message: "status warning" },
        reconciliationWarning: "reconciliation warning",
      },
      doctor: { overallStatus: "pass", checks: [] },
      connectionPhase: "open",
      refreshPhase: "idle",
      hasSuccessfulRefresh: true,
    }),
    ["status warning", "reconciliation warning"],
  );

  assert.deepEqual(
    buildAttentionItems({
      status: {
        blockedIssues: [],
        runnableIssues: [],
        warning: { message: "same warning" },
        reconciliationWarning: "same warning",
      },
      doctor: { overallStatus: "pass", checks: [] },
      connectionPhase: "open",
      refreshPhase: "idle",
      hasSuccessfulRefresh: true,
    }),
    ["same warning"],
  );
});

test("formatTrackedIssues defaults to non-done history and can reveal done issues when requested", () => {
  assert.deepEqual(
    formatTrackedIssues({
      trackedIssues: [
        {
          issueNumber: 41,
          state: "queued",
          branch: "codex/issue-41",
          prNumber: null,
          blockedReason: "requirements:verification",
        },
        {
          issueNumber: 42,
          state: "done",
          branch: "codex/issue-42",
          prNumber: 512,
          blockedReason: null,
        },
      ],
    }),
    ["tracked issue #41 [queued] branch=codex/issue-41 pr=none blocked_reason=requirements:verification"],
  );

  assert.deepEqual(
    formatTrackedIssues(
      {
        trackedIssues: [
          {
            issueNumber: 41,
            state: "queued",
            branch: "codex/issue-41",
            prNumber: null,
            blockedReason: "requirements:verification",
          },
          {
            issueNumber: 42,
            state: "done",
            branch: "codex/issue-42",
            prNumber: 512,
            blockedReason: null,
          },
        ],
      },
      { includeDone: true },
    ),
    [
      "tracked issue #41 [queued] branch=codex/issue-41 pr=none blocked_reason=requirements:verification",
      "tracked issue #42 [done] branch=codex/issue-42 pr=#512 blocked_reason=none",
    ],
  );
});

test("collectIssueShortcuts deduplicates typed issue shortcuts in priority order and skips tracked done history", () => {
  const shortcuts = collectIssueShortcuts({
    activeIssue: {
      issueNumber: 77,
      state: "running",
      branch: "codex/issue-77",
    },
    runnableIssues: [
      {
        issueNumber: 77,
        title: "Ready for inspection",
        readiness: "ready",
      },
      {
        issueNumber: 81,
        title: "Fresh runnable issue",
        readiness: "ready",
      },
    ],
    blockedIssues: [
      {
        issueNumber: 81,
        title: "Still blocked elsewhere",
        blockedBy: "requirements:verification",
      },
      {
        issueNumber: 93,
        title: "Needs scope repair",
        blockedBy: "requirements:scope, verification",
      },
    ],
    trackedIssues: [
      {
        issueNumber: 93,
        state: "queued",
        branch: "codex/issue-93",
        prNumber: null,
        blockedReason: "requirements:scope, verification",
      },
      {
        issueNumber: 105,
        state: "queued",
        branch: "codex/issue-105",
        prNumber: 412,
        blockedReason: null,
      },
      {
        issueNumber: 12,
        state: "done",
        branch: "codex/issue-12",
        prNumber: 12,
        blockedReason: null,
      },
    ],
  });

  assert.deepEqual(shortcuts, [
    {
      issueNumber: 77,
      label: "active",
      detail: "running codex/issue-77",
    },
    {
      issueNumber: 81,
      label: "runnable ready",
      detail: "Fresh runnable issue",
    },
    {
      issueNumber: 93,
      label: "blocked requirements:scope, verification",
      detail: "Needs scope repair",
    },
    {
      issueNumber: 105,
      label: "tracked queued",
      detail: "codex/issue-105 pr=#412",
    },
  ]);
});

test("resolveDashboardPanelLayout keeps stable typed panel ids and falls back missing entries to the default layout", () => {
  assert.deepEqual(DASHBOARD_PANEL_IDS, [
    "status",
    "doctor",
    "issue-details",
    "tracked-history",
    "operator-actions",
    "live-events",
    "operator-timeline",
  ]);

  assert.deepEqual(DEFAULT_DASHBOARD_PANEL_LAYOUT.order, DASHBOARD_PANEL_IDS);
  assert.equal(Object.isFrozen(DEFAULT_DASHBOARD_PANEL_LAYOUT), true);
  assert.equal(Object.isFrozen(DEFAULT_DASHBOARD_PANEL_LAYOUT.order), true);
  assert.equal(Object.isFrozen(DEFAULT_DASHBOARD_PANEL_LAYOUT.visibility), true);

  assert.deepEqual(
    resolveDashboardPanelLayout({
      order: ["operator-actions", "status", "operator-actions", "unknown-panel"],
      visibility: {
        status: false,
        doctor: true,
      },
    }),
    {
      order: [
        "operator-actions",
        "status",
        "doctor",
        "issue-details",
        "tracked-history",
        "live-events",
        "operator-timeline",
      ],
      visibility: {
        status: false,
        doctor: true,
        "issue-details": true,
        "tracked-history": true,
        "operator-actions": true,
        "live-events": true,
        "operator-timeline": true,
      },
    },
  );
});

test("parseSelectedIssueNumber prefers typed fields before falling back to legacy lines", () => {
  assert.equal(
    parseSelectedIssueNumber({
      selectionSummary: { selectedIssueNumber: 42 },
      whyLines: ["selected_issue=#99"],
    }),
    42,
  );

  assert.equal(
    parseSelectedIssueNumber({
      activeIssue: { issueNumber: 77 },
      whyLines: ["selected_issue=#99"],
    }),
    77,
  );

  assert.equal(
    parseSelectedIssueNumber({
      whyLines: ["selected_issue=#88"],
    }),
    88,
  );

  assert.equal(parseSelectedIssueNumber({ whyLines: ["selected_issue=none"] }), null);
});

test("describeConnectionHealth normalizes the connected SSE state for operators", () => {
  assert.equal(describeConnectionHealth("connecting"), "connecting");
  assert.equal(describeConnectionHealth("open"), "connected");
  assert.equal(describeConnectionHealth("reconnecting"), "reconnecting");
});

test("buildOverviewSummary and related beginner-first helpers produce concise English summaries", () => {
  assert.deepEqual(
    buildOverviewSummary({
      status: {
        selectionSummary: { selectedIssueNumber: 42 },
        runnableIssues: [{ issueNumber: 42, title: "Fix queue summary", readiness: "execution_ready" }],
      },
      doctor: { overallStatus: "pass", checks: [] },
      connectionPhase: "open",
      refreshPhase: "idle",
      hasSuccessfulRefresh: true,
    }),
    {
      headline: "A focused issue is ready to inspect",
      detail: "Issue #42 is the current dashboard focus.",
      tone: "ok",
    },
  );

  assert.deepEqual(
    buildNextIssueSummary({
      runnableIssues: [{ issueNumber: 77, title: "Ready issue", readiness: "execution_ready" }],
    }),
    {
      issueNumber: 77,
      title: "Ready issue",
      detail: "This is the next runnable issue available to the supervisor.",
      stateLabel: "Next runnable issue",
    },
  );

  assert.deepEqual(
    buildPrimaryActionSummary({
      status: { blockedIssues: [{ issueNumber: 91, blockedBy: "verification" }] },
      doctor: { overallStatus: "pass", checks: [] },
      connectionPhase: "open",
      refreshPhase: "idle",
      hasSuccessfulRefresh: true,
    }),
    {
      title: "Recover blocked work",
      detail: "The queue has blockers and no runnable issue, so the next supervisor state is recovery-oriented.",
    },
  );

  assert.deepEqual(
    buildPrimaryActionSummary({
      status: {
        selectionSummary: { selectedIssueNumber: 77 },
        runnableIssues: [{ issueNumber: 77, title: "Ready issue", readiness: "execution_ready" }],
      },
      doctor: { overallStatus: "pass", checks: [] },
      connectionPhase: "reconnecting",
      refreshPhase: "failed",
      hasSuccessfulRefresh: true,
    }),
    {
      title: "Recover dashboard freshness",
      detail: "Wait for a healthy refresh before relying on the next supervisor state shown here.",
    },
  );

  assert.deepEqual(
    buildPrimaryActionSummary({
      status: {
        selectionSummary: { selectedIssueNumber: 77 },
        runnableIssues: [{ issueNumber: 77, title: "Ready issue", readiness: "execution_ready" }],
      },
      doctor: { overallStatus: "fail", checks: [{ name: "github_auth", status: "fail", summary: "No auth." }] },
      connectionPhase: "open",
      refreshPhase: "idle",
      hasSuccessfulRefresh: true,
    }),
    {
      title: "Resolve environment checks",
      detail: "A required dependency is failing, so the supervisor should not advance until checks recover.",
    },
  );

  assert.deepEqual(
    buildAttentionItems({
      status: {
        blockedIssues: [{ issueNumber: 91, blockedBy: "verification" }],
        runnableIssues: [{ issueNumber: 77, title: "Ready issue", readiness: "execution_ready" }],
      },
      doctor: {
        overallStatus: "warn",
        checks: [{ name: "github_auth", status: "warn", summary: "Authentication needs refresh." }],
      },
      connectionPhase: "reconnecting",
      refreshPhase: "failed",
      hasSuccessfulRefresh: true,
    }),
    [
      "The live connection is reconnecting.",
      "The last refresh failed, so some details may be stale.",
      "1 blocked issue(s) are waiting on follow-up work.",
      "1 runnable issue(s) are available.",
      "github_auth: Authentication needs refresh.",
    ],
  );
});

test("describeFreshnessState distinguishes fresh, refreshing, stale, and first-load states", () => {
  assert.equal(
    describeFreshnessState({
      connectionPhase: "open",
      refreshPhase: "idle",
      hasSuccessfulRefresh: true,
    }),
    "fresh",
  );

  assert.equal(
    describeFreshnessState({
      connectionPhase: "open",
      refreshPhase: "refreshing",
      hasSuccessfulRefresh: true,
    }),
    "refreshing",
  );

  assert.equal(
    describeFreshnessState({
      connectionPhase: "reconnecting",
      refreshPhase: "idle",
      hasSuccessfulRefresh: true,
    }),
    "stale",
  );

  assert.equal(
    describeFreshnessState({
      connectionPhase: "open",
      refreshPhase: "failed",
      hasSuccessfulRefresh: true,
    }),
    "stale",
  );

  assert.equal(
    describeFreshnessState({
      connectionPhase: "connecting",
      refreshPhase: "idle",
      hasSuccessfulRefresh: false,
    }),
    "awaiting refresh",
  );
});

test("describeCommandSelectionChange highlights whether a command moved the selected issue", () => {
  assert.equal(describeCommandSelectionChange(42, 77), "selected issue #42 -> #77");
  assert.equal(describeCommandSelectionChange(null, 77), "selected issue none -> #77");
  assert.equal(describeCommandSelectionChange(42, 42), "selected issue unchanged (#42)");
  assert.equal(describeCommandSelectionChange(null, null), "selected issue unchanged (none)");
  assert.equal(describeCommandSelectionChange(undefined, null), "selected issue unchanged (none)");
});

test("collectTimelineEventIssueNumbers deduplicates the issue ids attached to a supervisor event", () => {
  assert.deepEqual(
    collectTimelineEventIssueNumbers({
      type: "supervisor.active_issue.changed",
      issueNumbers: [77, 42, 77, null],
      issueNumber: 77,
      previousIssueNumber: 42,
      nextIssueNumber: 77,
    }),
    [77, 42],
  );

  assert.deepEqual(
    collectTimelineEventIssueNumbers({
      type: "supervisor.run_lock.blocked",
      command: "run-once",
    }),
    [],
  );
});

test("describeTimelineEvent summarizes known supervisor events for the operator timeline", () => {
  assert.equal(
    describeTimelineEvent({
      type: "supervisor.active_issue.changed",
      previousIssueNumber: 42,
      nextIssueNumber: 77,
      reason: "reserved_for_cycle",
    }),
    "active issue reserved for cycle: #42 -> #77",
  );

  assert.equal(
    describeTimelineEvent({
      type: "supervisor.recovery",
      issueNumber: 77,
      reason: "operator_requeue",
    }),
    "recovery issue #77: operator requeue",
  );

  assert.equal(
    describeTimelineEvent({
      type: "supervisor.run_lock.blocked",
      command: "run-once",
      reason: "lock held by pid 123",
      reconciliationPhase: "addressing_review",
    }),
    "run-once blocked: lock held by pid 123 during addressing review",
  );

  assert.equal(
    describeTimelineEvent({
      type: " queued ",
      summary: "",
      message: "  ",
    }),
    "queued",
  );

  assert.equal(
    describeTimelineEvent({
      type: " ",
      summary: "",
      message: "  ",
    }),
    "event",
  );
});

test("describeTimelineCommandResult summarizes typed recovery and maintenance command outcomes", () => {
  assert.equal(
    describeTimelineCommandResult({
      action: "requeue",
      issueNumber: 42,
      previousState: "blocked",
      nextState: "queued",
      recoveryReason: "operator_requested",
      summary: "Requeued issue #42.",
    }),
    "requeue issue #42 blocked -> queued (operator requested)",
  );

  assert.equal(
    describeTimelineCommandResult({
      action: "prune-orphaned-workspaces",
      summary: "Pruned 1 orphaned workspace(s); skipped 2 orphaned workspace(s).",
      pruned: [{}],
      skipped: [{}, {}],
    }),
    "prune orphaned workspaces: pruned 1, skipped 2",
  );
});

test("typed observability helpers summarize retry risk, repeated recovery loops, and phase changes", () => {
  const activityContext = {
    retryContext: {
      timeoutRetryCount: 2,
      blockedVerificationRetryCount: 1,
      repeatedBlockerCount: 3,
      repeatedFailureSignatureCount: 4,
      lastFailureSignature: "tracked-pr-refresh-loop",
    },
    repeatedRecovery: {
      kind: "stale_stabilizing_no_pr",
      repeatCount: 2,
      repeatLimit: 3,
      status: "retrying",
      action: "confirm_whether_the_change_already_landed_or_retarget_the_issue_manually",
      lastFailureSignature: "stale-stabilizing-no-pr-recovery-loop",
    },
    recentPhaseChanges: [
      {
        at: "2026-03-22T00:15:00Z",
        from: "blocked",
        to: "addressing_review",
        reason: "tracked_pr_head_advanced",
        source: "recovery",
      },
    ],
  };

  assert.equal(
    formatRetryContextSummary(activityContext),
    "timeout=2 verification=1 same_blocker=3 same_failure_signature=4 last_failure_signature=tracked-pr-refresh-loop",
  );
  assert.equal(
    formatRecoveryLoopSummary(activityContext),
    "kind=stale_stabilizing_no_pr repeat_count=2/3 status=retrying last_failure_signature=stale-stabilizing-no-pr-recovery-loop action=confirm_whether_the_change_already_landed_or_retarget_the_issue_manually",
  );
  assert.equal(
    formatRecentPhaseChanges(activityContext),
    "at=2026-03-22T00:15:00Z phase_change=blocked->addressing_review reason=tracked_pr_head_advanced source=recovery",
  );
});
