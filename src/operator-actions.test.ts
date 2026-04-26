import assert from "node:assert/strict";
import test from "node:test";
import {
  buildStatusOperatorCockpitViewModel,
  parseOperatorActionLine,
  type RestartRecommendation,
  selectRestartRecommendation,
  selectStatusOperatorAction,
} from "./operator-actions";

function requireRestartRecommendation(recommendation: RestartRecommendation | null): RestartRecommendation {
  if (recommendation === null) {
    assert.fail("expected a restart recommendation");
  }
  return recommendation;
}

test("selectRestartRecommendation classifies every restart recommendation category from shared status lines", () => {
  assert.equal(
    requireRestartRecommendation(selectRestartRecommendation({
      detailedStatusLines: [
        "loop_runtime_diagnostic kind=duplicate_loop_processes status=duplicate matching_processes=2 pids=4242,4243 config_path=<supervisor-config-path> state_file=<state-file> recovery=inspect_then_restart",
      ],
    })).category,
    "safe_restart",
  );
  assert.equal(
    requireRestartRecommendation(selectRestartRecommendation({
      detailedStatusLines: [
        "loop_runtime_blocker state=off active_tracked_issues=1 first_issue=#188 first_state=addressing_review first_pr=#288 action=restart_loop restart_reason=recoverable_active_tracked_work_waiting_for_loop expected_outcome=loop_runtime_state_running_then_tracked_issue_advances fallback=inspect_runtime",
      ],
    })).category,
    "restart_required_for_convergence",
  );
  assert.equal(
    requireRestartRecommendation(selectRestartRecommendation({
      detailedStatusLines: [
        "no_active_tracked_record issue=#188 classification=active_tracked_work_blocker state=addressing_review reason=loop_off",
      ],
    })).category,
    "restart_required_for_convergence",
  );
  assert.equal(
    requireRestartRecommendation(selectRestartRecommendation({
      detailedStatusLines: [
        "no_active_tracked_record issue=#189 classification=stale_but_recoverable state=blocked reason=stale_review_bot",
      ],
    })).category,
    "restart_required_for_convergence",
  );
  assert.equal(
    requireRestartRecommendation(selectRestartRecommendation({
      detailedStatusLines: [
        "no_active_tracked_record issue=#188 classification=manual_review_required state=blocked reason=manual_review",
      ],
    })).category,
    "manual_review_before_restart",
  );
});

test("parseOperatorActionLine reads rendered status and doctor action lines", () => {
  const expected = {
    action: "fix_config",
    source: "tracked_pr_host_local_ci",
    priority: 80,
    summary:
      "Host-local CI could not run because the workspace environment is missing prerequisites; fix configuration or workspace preparation before continuing.",
  };

  assert.deepEqual(
    parseOperatorActionLine(
      "operator_action action=fix_config source=tracked_pr_host_local_ci priority=80 summary=Host-local CI could not run because the workspace environment is missing prerequisites; fix configuration or workspace preparation before continuing.",
    ),
    expected,
  );

  assert.deepEqual(
    parseOperatorActionLine(
      "doctor_operator_action action=fix_config source=tracked_pr_host_local_ci priority=80 summary=Host-local CI could not run because the workspace environment is missing prerequisites; fix configuration or workspace preparation before continuing.",
    ),
    expected,
  );

  assert.equal(parseOperatorActionLine("operator_action action=unknown source=status priority=0 summary=nope"), null);
  assert.equal(parseOperatorActionLine("doctor_operator_action action=unknown source=doctor priority=0 summary=nope"), null);
  assert.equal(parseOperatorActionLine("operator_action action=fix_config source=status priority=80foo summary=nope"), null);
});

test("selectStatusOperatorAction ignores rendered doctor action lines", () => {
  assert.deepEqual(
    selectStatusOperatorAction({
      detailedStatusLines: [
        "doctor_operator_action action=fix_config source=doctor_check priority=80 summary=Doctor found a failing host prerequisite; fix the reported check before continuing supervisor operation.",
        "operator_action action=continue source=status priority=0 summary=No blocking operator action was detected; continue normal supervisor operation.",
      ],
    }),
    {
      action: "continue",
      source: "status",
      priority: 0,
      summary: "No blocking operator action was detected; continue normal supervisor operation.",
    },
  );
});

test("buildStatusOperatorCockpitViewModel carries the shared action contract and evidence", () => {
  assert.deepEqual(
    buildStatusOperatorCockpitViewModel({
      detailedStatusLines: [
        "tracked_pr_host_local_ci issue=#1783 gate=local_ci blocked_reason=workspace_environment remediation_target=workspace_environment",
        "trust_mode=trusted_repo_and_authors execution_safety_mode=operator_gated",
      ],
      whyLines: ["selected_issue=#1783"],
    }),
    {
      action: {
        action: "fix_config",
        source: "tracked_pr_host_local_ci",
        priority: 80,
        summary:
          "Host-local CI could not run because the workspace environment is missing prerequisites; fix configuration or workspace preparation before continuing.",
      },
      currentTaskContract: "selected_issue=#1783",
      trustPosture: "trust_mode=trusted_repo_and_authors execution_safety_mode=operator_gated",
      gateState: "gate=local_ci remediation_target=workspace_environment",
      blockingReason: "workspace_environment",
      evidence: [
        "tracked_pr_host_local_ci issue=#1783 gate=local_ci blocked_reason=workspace_environment remediation_target=workspace_environment",
      ],
      fallbackCommand: "node dist/index.js doctor --config <supervisor-config-path>",
    },
  );
});

test("buildStatusOperatorCockpitViewModel prefers whyLines for the current task contract", () => {
  assert.equal(
    buildStatusOperatorCockpitViewModel({
      detailedStatusLines: ["selected_issue=#1777"],
      whyLines: ["selected_issue=#1783"],
    }).currentTaskContract,
    "selected_issue=#1783",
  );
});

test("selectRestartRecommendation stays quiet for completed no-active tracked records", () => {
  assert.equal(
    selectRestartRecommendation({
      detailedStatusLines: [
        "no_active_tracked_record issue=#188 classification=safe_to_ignore state=done reason=terminal_done",
      ],
    }),
    null,
  );
  assert.equal(
    selectRestartRecommendation({
      detailedStatusLines: [
        "no_active_tracked_record issue=#189 classification=stale_already_handled state=done reason=merged_pr_convergence",
      ],
    }),
    null,
  );
});

test("selectRestartRecommendation still flags non-quiet no-active classifications as restart-not-enough", () => {
  assert.equal(
    requireRestartRecommendation(selectRestartRecommendation({
      detailedStatusLines: [
        "no_active_tracked_record issue=#188 classification=repair_already_queued state=repairing_ci reason=repairable_path_hygiene_retry_state",
      ],
    })).category,
    "restart_not_enough",
  );
});

test("selectRestartRecommendation preserves the matching source for safe restart recovery lines", () => {
  assert.equal(
    requireRestartRecommendation(selectRestartRecommendation({
      detailedStatusLines: [
        "loop_runtime_recovery action=inspect_then_restart owner=supervisor recommendation=restart_loop",
      ],
    })).source,
    "loop_runtime_recovery",
  );
  assert.equal(
    requireRestartRecommendation(selectRestartRecommendation({
      detailedStatusLines: [
        "doctor_loop_runtime_recovery action=inspect_then_restart owner=supervisor recommendation=restart_loop",
      ],
    })).source,
    "doctor_loop_runtime_recovery",
  );
  assert.equal(
    requireRestartRecommendation(selectRestartRecommendation({
      detailedStatusLines: [
        "doctor_loop_runtime_diagnostic kind=duplicate_loop_processes status=duplicate matching_processes=2 pids=4242,4243 config_path=<supervisor-config-path> state_file=<state-file> recovery=inspect_then_restart",
      ],
    })).source,
    "doctor_loop_runtime_diagnostic",
  );
});

test("selectRestartRecommendation does not let safe restart outrank manual review before restart", () => {
  const recommendation = requireRestartRecommendation(selectRestartRecommendation({
    detailedStatusLines: [
      "loop_runtime_diagnostic kind=duplicate_loop_processes status=duplicate matching_processes=2 pids=4242,4243 config_path=<supervisor-config-path> state_file=<state-file> recovery=inspect_then_restart",
      "no_active_tracked_record issue=#188 classification=manual_review_required state=blocked reason=manual_review",
    ],
  }));

  assert.equal(recommendation.category, "manual_review_before_restart");
  assert.equal(recommendation.source, "no_active_tracked_record");

  assert.equal(
    requireRestartRecommendation(selectRestartRecommendation({
      detailedStatusLines: [
        "loop_runtime_diagnostic kind=duplicate_loop_processes status=duplicate matching_processes=2 pids=4242,4243 config_path=<supervisor-config-path> state_file=<state-file> recovery=inspect_then_restart",
        "no_active_tracked_record issue=#188 classification=provider_outage_suspected state=blocked reason=review_provider_wait",
      ],
    })).category,
    "manual_review_before_restart",
  );
});
