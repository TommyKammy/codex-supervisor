import assert from "node:assert/strict";
import test from "node:test";
import { formatMergedPrConvergenceOperatorEventLine } from "./supervisor-operator-events";
import { createRecord } from "./supervisor-test-helpers";

test("formatMergedPrConvergenceOperatorEventLine normalizes carriage returns in details", () => {
  const line = formatMergedPrConvergenceOperatorEventLine(createRecord({
    issue_number: 240,
    state: "done",
    last_recovery_at: "2026-04-25T00:20:00Z",
    last_recovery_reason: "merged_pr_convergence: tracked PR #340 merged\rmarked issue #240 done",
  }));

  assert.equal(
    line,
    "operator_event type=merged_pr_convergence issue=#240 at=2026-04-25T00:20:00Z detail=tracked PR #340 merged\\nmarked issue #240 done",
  );
});
