import assert from "node:assert/strict";
import test from "node:test";
import {
  type RestartRecommendation,
  selectRestartRecommendation,
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
        "no_active_tracked_record issue=#188 classification=safe_to_ignore state=done reason=terminal_done",
      ],
    })).category,
    "restart_not_enough",
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
