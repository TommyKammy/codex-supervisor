import assert from "node:assert/strict";
import test from "node:test";
import {
  buildIssueExplainSections,
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
