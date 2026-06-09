import assert from "node:assert/strict";
import test from "node:test";
import {
  formatPrLifecycleTraceDiagnostic,
  prLifecycleTraceDiagnosticLabel,
} from "./pr-lifecycle-trace-presenter";
import {
  buildPrLifecycleDecisionTrace,
  type PrLifecycleDecisionTraceInput,
  type PrLifecyclePolicyPosture,
} from "./pr-lifecycle-trace";
import {
  normalizePrLifecycleFacts,
  type PrLifecycleFactInventory,
} from "./pr-lifecycle-state";

function inventory(overrides: Partial<PrLifecycleFactInventory> = {}): PrLifecycleFactInventory {
  return {
    source: "fixture",
    observedAt: "2026-06-07T00:00:00.000Z",
    pullRequest: {
      number: 2281,
      headSha: "head-current",
      state: "OPEN",
      isDraft: false,
      mergeStateStatus: "CLEAN",
      mergeable: "MERGEABLE",
      currentHeadReviewObservedAt: "2026-06-07T00:01:00.000Z",
      currentHeadReviewHeadSha: "head-current",
    },
    reviewThreads: {
      unresolvedManualThreadCount: 0,
      unresolvedCurrentHeadConfiguredBotThreadCount: 0,
      stalePreviousHeadConfiguredBotThreadCount: 0,
      metadataOnlyUnresolvedThreadCount: 0,
    },
    checks: {
      passingCount: 3,
      pendingCount: 0,
      failingCount: 0,
      unknownCount: 0,
    },
    localState: {
      trackedHeadSha: "head-current",
      workspaceHeadSha: "head-current",
      lastObservedPrHeadSha: "head-current",
    },
    configuredCurrentHeadReviewRequired: true,
    ...overrides,
  };
}

function traceInput(overrides: Partial<PrLifecycleDecisionTraceInput> = {}): PrLifecycleDecisionTraceInput {
  return {
    traceId: "trace-2281",
    generatedAt: "2026-06-07T00:02:00.000Z",
    normalizedState: normalizePrLifecycleFacts(inventory()),
    policy: {
      name: "pr_lifecycle_decision_kernel_v2",
      posture: "merge_ready",
      reasons: ["checks_green", "review_observed", "mergeable"],
    },
    decision: {
      value: "merge",
      recommendedAction: "merge",
      summary: "PR lifecycle facts are merge ready.",
    },
    evidenceTokens: ["pr=2281", "head=head-current", "checks=green"],
    ...overrides,
  };
}

test("prLifecycleTraceDiagnosticLabel covers representative Phase 1.3 trace labels", () => {
  const cases: Array<[PrLifecyclePolicyPosture, string]> = [
    ["wait_for_ci", "ci_pending"],
    ["request_current_head_review", "current_head_review_request"],
    ["blocked_by_review", "review_blocked"],
    ["stale_local_state", "stale_local_state"],
    ["merge_ready", "merge_ready"],
  ];

  for (const [posture, label] of cases) {
    assert.equal(prLifecycleTraceDiagnosticLabel(posture), label);
  }
});

test("formatPrLifecycleTraceDiagnostic renders a merge-ready trace line", () => {
  const line = formatPrLifecycleTraceDiagnostic(
    buildPrLifecycleDecisionTrace(traceInput()),
  );

  assert.match(line, /^pr_lifecycle_trace /);
  assert.match(line, /label=merge_ready/);
  assert.match(line, /policy=merge_ready/);
  assert.match(line, /decision=merge/);
  assert.match(line, /action=merge/);
  assert.match(line, /review=current_head_review_observed/);
  assert.match(line, /checks=green/);
  assert.match(line, /mergeability=mergeable/);
  assert.match(line, /local_state=fresh/);
  assert.match(line, /evidence=pr=2281,head=head-current,checks=green/);
  assert.match(line, /v2_mode=diagnostic_only/);
  assert.match(line, /v2_authoritative=false/);
  assert.match(line, /v2_mutation_allowed=false/);
  assert.match(line, /v2_action_source=disabled/);
  assert.match(line, /v2_action_scope=none/);
  assert.match(line, /rollback_posture=diagnostic_only_to_rollback/);
  assert.match(line, /v2_comparison=none/);
  assert.match(line, /v2_diagnostic_only=no/);
});

test("formatPrLifecycleTraceDiagnostic renders the gated v2 PR lifecycle action source", () => {
  const line = formatPrLifecycleTraceDiagnostic(
    buildPrLifecycleDecisionTrace(
      traceInput({
        v2Mode: "pr_lifecycle_action_taking",
      }),
    ),
  );

  assert.match(line, /v2_mode=pr_lifecycle_action_taking/);
  assert.match(line, /v2_authoritative=true/);
  assert.match(line, /v2_mutation_allowed=true/);
  assert.match(line, /v2_action_source=pr_lifecycle_v2/);
  assert.match(line, /v2_action_scope=pr_lifecycle/);
  assert.match(line, /rollback_posture=disable_to_rollback/);
});

test("formatPrLifecycleTraceDiagnostic renders disabled v2 rollback posture", () => {
  const line = formatPrLifecycleTraceDiagnostic(
    buildPrLifecycleDecisionTrace(
      traceInput({
        v2Mode: "disabled",
      }),
    ),
  );

  assert.match(line, /v2_mode=disabled/);
  assert.match(line, /v2_action_source=disabled/);
  assert.match(line, /rollback_posture=already_disabled/);
});

test("formatPrLifecycleTraceDiagnostic renders pending CI diagnostics", () => {
  const line = formatPrLifecycleTraceDiagnostic(
    buildPrLifecycleDecisionTrace(
      traceInput({
        normalizedState: normalizePrLifecycleFacts(
          inventory({
            checks: {
              passingCount: 1,
              pendingCount: 2,
              failingCount: 0,
              unknownCount: 0,
            },
          }),
        ),
        policy: {
          name: "pr_lifecycle_decision_kernel_v2",
          posture: "wait_for_ci",
          reasons: ["checks_pending"],
        },
        decision: {
          value: "wait",
          recommendedAction: "wait_ci",
          summary: "Required checks are pending.",
        },
      }),
    ),
  );

  assert.match(line, /label=ci_pending/);
  assert.match(line, /checks=pending/);
  assert.match(line, /pending_checks=2/);
  assert.match(line, /reasons=checks_pending/);
});

test("formatPrLifecycleTraceDiagnostic renders current-head review request diagnostics", () => {
  const line = formatPrLifecycleTraceDiagnostic(
    buildPrLifecycleDecisionTrace(
      traceInput({
        normalizedState: normalizePrLifecycleFacts(
          inventory({
            pullRequest: {
              number: 2281,
              headSha: "head-current",
              state: "OPEN",
              isDraft: false,
              mergeStateStatus: "CLEAN",
              mergeable: "MERGEABLE",
              currentHeadReviewObservedAt: null,
              currentHeadReviewHeadSha: null,
            },
          }),
        ),
        policy: {
          name: "pr_lifecycle_decision_kernel_v2",
          posture: "request_current_head_review",
          reasons: ["missing_current_head_review"],
        },
        decision: {
          value: "request_review",
          recommendedAction: "request_review",
          summary: "Request current-head review.",
        },
      }),
    ),
  );

  assert.match(line, /label=current_head_review_request/);
  assert.match(line, /review=missing_current_head_review/);
  assert.match(line, /decision=request_review/);
  assert.match(line, /action=request_review/);
});

test("formatPrLifecycleTraceDiagnostic renders review-blocked diagnostics", () => {
  const line = formatPrLifecycleTraceDiagnostic(
    buildPrLifecycleDecisionTrace(
      traceInput({
        normalizedState: normalizePrLifecycleFacts(
          inventory({
            reviewThreads: {
              unresolvedManualThreadCount: 1,
              unresolvedCurrentHeadConfiguredBotThreadCount: 2,
              stalePreviousHeadConfiguredBotThreadCount: 0,
              metadataOnlyUnresolvedThreadCount: 0,
            },
          }),
        ),
        policy: {
          name: "pr_lifecycle_decision_kernel_v2",
          posture: "blocked_by_review",
          reasons: ["manual_thread", "configured_bot_thread"],
        },
        decision: {
          value: "ask_operator",
          recommendedAction: "manual_review",
          summary: "Review threads are unresolved.",
        },
      }),
    ),
  );

  assert.match(line, /label=review_blocked/);
  assert.match(line, /review=review_blocked/);
  assert.match(line, /manual_threads=1/);
  assert.match(line, /current_bot_threads=2/);
});

test("formatPrLifecycleTraceDiagnostic renders diagnostic-only v2 comparison evidence", () => {
  const line = formatPrLifecycleTraceDiagnostic(
    buildPrLifecycleDecisionTrace(
      traceInput({
        v2Comparison: {
          current: {
            state: "blocked",
            actionEquivalent: "ask_operator",
          },
          v2: {
            action: "run_codex",
            reasons: ["current_head_must_fix_review"],
          },
          category: "manual_review_required",
          differences: [
            {
              field: "action",
              current: "ask_operator",
              v2: "run_codex",
            },
          ],
          safetyNote: "Current and v2 diverge in an unsafe or ambiguous way; require operator review before trusting v2.",
        },
      }),
    ),
  );

  assert.match(line, /v2_comparison=manual_review_required/);
  assert.match(line, /v2_diagnostic_only=yes/);
  assert.match(line, /v2_comparison_differences=action:ask_operator->run_codex/);
});

test("formatPrLifecycleTraceDiagnostic renders stale local state versus fresh GitHub facts", () => {
  const line = formatPrLifecycleTraceDiagnostic(
    buildPrLifecycleDecisionTrace(
      traceInput({
        normalizedState: normalizePrLifecycleFacts(
          inventory({
            source: "fresh_github",
            pullRequest: {
              number: 2281,
              headSha: "head-new",
              state: "OPEN",
              isDraft: false,
              mergeStateStatus: "CLEAN",
              mergeable: "MERGEABLE",
              currentHeadReviewObservedAt: "2026-06-07T00:01:00.000Z",
              currentHeadReviewHeadSha: "head-new",
            },
            localState: {
              trackedHeadSha: "head-old",
              workspaceHeadSha: "head-old",
              lastObservedPrHeadSha: "head-old",
            },
          }),
        ),
        policy: {
          name: "pr_lifecycle_decision_kernel_v2",
          posture: "stale_local_state",
          reasons: ["local_head_differs_from_pr_head"],
        },
        decision: {
          value: "do_nothing",
          recommendedAction: "refresh_state",
          summary: "Local state is stale.",
        },
        evidenceTokens: ["remote=head-new", "local=head-old"],
      }),
    ),
  );

  assert.match(line, /label=stale_local_state/);
  assert.match(line, /source=fresh_github/);
  assert.match(line, /head=head-new/);
  assert.match(line, /head_freshness=stale_head/);
  assert.match(line, /local_state=stale/);
  assert.match(line, /tracked_head=head-old/);
  assert.match(line, /workspace_head=head-old/);
  assert.match(line, /last_observed_pr_head=head-old/);
});
