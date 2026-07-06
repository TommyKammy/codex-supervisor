import assert from "node:assert/strict";
import test from "node:test";
import {
  evaluateFindingSetProofText,
  type FindingSetProofTextEvaluationReason,
} from "./finding-set-proof-text-evaluator";

function reasonFor(summary: string, args: {
  repairResidueThreadCount?: number;
  recordProcessedEvidenceCoversThreadSet?: boolean;
} = {}): FindingSetProofTextEvaluationReason {
  return evaluateFindingSetProofText({
    evidenceText: summary,
    repairResidueThreadCount: args.repairResidueThreadCount ?? 2,
    recordProcessedEvidenceCoversThreadSet: args.recordProcessedEvidenceCoversThreadSet ?? false,
  }).reason;
}

test("evaluateFindingSetProofText accepts explicit current-head finding-set completion", () => {
  assert.deepEqual(evaluateFindingSetProofText({
    evidenceText: "Current-head verification covered all review findings.",
    repairResidueThreadCount: 2,
    recordProcessedEvidenceCoversThreadSet: false,
  }), {
    accepted: true,
    reason: "accepted",
  });
});

test("evaluateFindingSetProofText separates summary-only rejection reasons", () => {
  assert.equal(reasonFor("Focused verifier passed."), "affirmative_completion_missing");
  assert.equal(reasonFor("Review findings not covered by this run."), "negated_completion");
  assert.equal(reasonFor("Only some review findings were covered by this run."), "partial_coverage");
  assert.equal(reasonFor("All review findings will be repaired in the next run."), "future_completion");
  assert.equal(reasonFor("1 of 2 review findings were covered by this run."), "fractional_count_mismatch");
  assert.equal(reasonFor("Review findings were covered by this run.", { repairResidueThreadCount: 2 }), "multi_thread_scope_missing");
});

test("evaluateFindingSetProofText preserves record-processed evidence scope behavior", () => {
  const summary = "Review findings were covered by the current-head verifier.";

  assert.deepEqual(evaluateFindingSetProofText({
    evidenceText: summary,
    repairResidueThreadCount: 2,
    recordProcessedEvidenceCoversThreadSet: true,
  }), {
    accepted: true,
    reason: "accepted",
  });
  assert.equal(reasonFor(summary, {
    repairResidueThreadCount: 2,
    recordProcessedEvidenceCoversThreadSet: false,
  }), "multi_thread_scope_missing");
});
