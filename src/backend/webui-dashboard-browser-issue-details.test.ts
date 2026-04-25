import assert from "node:assert/strict";
import test from "node:test";
import {
  buildIssueExplainSections,
  formatIssueTimelineEvents,
  formatIssueTimelineSummary,
  formatLatestRecovery,
  formatReviewWaits,
} from "./webui-dashboard-browser-issue-details";

const detailFormatters = {
  formatRetryContextSummary: () => null,
  formatRecoveryLoopSummary: () => null,
  formatRecentPhaseChanges: () => null,
};

test("issue detail helpers prefer typed recovery context and render review waits predictably", () => {
  const activityContext = {
    latestRecovery: {
      issueNumber: 42,
      at: "2026-03-22T00:00:00Z",
      reason: "tracked_pr_head_advanced",
      detail: "resumed issue #42 after tracked PR #42 advanced",
    },
    reviewWaits: [
      {
        kind: "configured_bot_initial_grace_wait",
        status: "active",
        provider: "coderabbit",
        pauseReason: "awaiting_initial_provider_activity",
        recentObservation: "required_checks_green",
        observedAt: "2099-01-01T00:00:30.000Z",
        configuredWaitSeconds: 90,
        waitUntil: "2099-01-01T00:02:00.000Z",
      },
    ],
  };

  assert.equal(
    formatLatestRecovery(activityContext, "legacy recovery line"),
    "issue=#42 at=2026-03-22T00:00:00Z reason=tracked_pr_head_advanced detail=resumed issue #42 after tracked PR #42 advanced",
  );
  assert.match(formatReviewWaits(activityContext), /configured_bot_initial_grace_wait status=active provider=coderabbit/u);
  assert.equal(formatReviewWaits(null), "none");
});

test("formatLatestRecovery falls back when typed recovery data is incomplete", () => {
  assert.equal(
    formatLatestRecovery(
      {
        latestRecovery: {
          issueNumber: 42,
          at: null,
          reason: "tracked_pr_head_advanced",
          detail: "resumed issue #42 after tracked PR #42 advanced",
        },
      },
      "legacy recovery line",
    ),
    "legacy recovery line",
  );

  assert.equal(
    formatLatestRecovery(
      {
        latestRecovery: {
          issueNumber: null,
          at: "2026-03-22T00:00:00Z",
          reason: null,
          detail: "resumed issue #42 after tracked PR #42 advanced",
        },
      },
      null,
    ),
    "none",
  );
});

test("formatReviewWaits normalizes nullish fields to stable placeholders", () => {
  assert.equal(
    formatReviewWaits({
      reviewWaits: [
        {
          kind: undefined,
          status: null,
          provider: undefined,
          pauseReason: null,
          recentObservation: undefined,
          observedAt: null,
          configuredWaitSeconds: undefined,
          waitUntil: null,
        },
      ],
    }),
    "none status=none provider=none pause_reason=none recent_observation=none observed_at=none configured_wait_seconds=none wait_until=none",
  );
});

test("issue history helpers render typed timeline DTOs as evidence lines", () => {
  const timeline = {
    issue_number: 1744,
    pr_number: 275,
    events: [
      {
        event_type: "local_ci",
        timestamp: "2026-04-25T10:06:00Z",
        outcome: "failed",
        summary: "Configured local CI command failed before marking PR ready.",
        head_sha: "head-1744",
        remediation_target: "tracked_publishable_content",
        next_action: "repair_tracked_publishable_content",
      },
      {
        event_type: "stale_review_metadata",
        timestamp: "2026-04-25T10:08:00Z",
        outcome: "recorded",
        summary: "metadata_only",
        head_sha: "head-1744",
        remediation_target: null,
        next_action: null,
      },
    ],
  };

  assert.equal(formatIssueTimelineSummary(timeline), "issue=#1744 pr=#275 events=2");
  assert.deepEqual(formatIssueTimelineEvents(timeline), [
    "evidence type=local_ci outcome=failed at=2026-04-25T10:06:00Z head_sha=head-1744 remediation_target=tracked_publishable_content action=repair_tracked_publishable_content summary=Configured local CI command failed before marking PR ready.",
    "evidence type=stale_review_metadata outcome=recorded at=2026-04-25T10:08:00Z head_sha=head-1744 remediation_target=none action=none summary=metadata_only",
  ]);
  assert.equal(formatIssueTimelineSummary(null), "No issue-run timeline is recorded for this issue.");
  assert.deepEqual(formatIssueTimelineEvents({ issue_number: 1744, pr_number: null, events: [] }), []);
});

test("buildIssueExplainSections keeps only non-empty typed detail sections", () => {
  const sections = buildIssueExplainSections({
    state: "blocked",
    blockedReason: "manual_review",
    runnable: false,
    reasons: ["manual_block manual_review", "local_state blocked"],
    latestRecoverySummary: "legacy recovery line that should only be used as fallback",
    activityContext: {
      handoffSummary: "blocker: wait for typed dashboard issue detail rendering",
      verificationPolicySummary: "verification_policy intensity=standard driver=changed_files:backend",
      latestRecovery: {
        issueNumber: 42,
        at: "2026-03-22T00:00:00Z",
        reason: "tracked_pr_head_advanced",
        detail: "resumed issue #42 after tracked PR #42 advanced",
      },
      reviewWaits: [],
    },
  }, detailFormatters);

  assert.deepEqual(
    sections.map((section) => section.title),
    ["Selection context", "Operator activity", "Latest recovery"],
  );
  assert.match(sections[0].items.map((item) => item.join(": ")).join("\n"), /blocked_reason: manual_review/u);
  assert.match(sections[1].items.map((item) => item.join(": ")).join("\n"), /handoff_summary: blocker: wait for typed dashboard issue detail rendering/u);
  assert.match(sections[2].items.map((item) => item.join(": ")).join("\n"), /tracked_pr_head_advanced/u);
  assert.doesNotMatch(sections[2].items.map((item) => item.join(": ")).join("\n"), /legacy recovery line/u);
});
