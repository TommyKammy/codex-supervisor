import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import {
  evaluateLocalReviewModelRoutingFixture,
  loadLocalReviewModelRoutingEvaluationFixture,
  parseLocalReviewModelRoutingEvaluationFixture,
  serializeLocalReviewModelRoutingEvaluationSummary,
} from "./model-routing-evaluation";

const FIXTURE_RELATIVE_PATH =
  "replay-corpus/local-review-model-routing/representative-evaluation.json";
const SUMMARY_RELATIVE_PATH =
  "replay-corpus/local-review-model-routing/representative-summary.json";
const fixturePath = path.join(process.cwd(), FIXTURE_RELATIVE_PATH);
const summaryPath = path.join(process.cwd(), SUMMARY_RELATIVE_PATH);

type MutableFixture = {
  schemaVersion: number;
  evidenceKind: string;
  baselineCandidateId: string;
  cases: Array<{ id: string; expectedFindingKeys: string[] }>;
  candidates: Array<{
    id: string;
    routes: Record<string, unknown>;
    observations: Array<{
      caseId: string;
      observedFindingKeys: string[];
      verifierFindings: Array<{ findingKey: string; verdict: string }>;
    }>;
  }>;
};

async function readMutableFixture(): Promise<MutableFixture> {
  return JSON.parse(await fs.readFile(fixturePath, "utf8")) as MutableFixture;
}

test("representative model-routing evaluation reproduces the checked-in summary", async () => {
  const fixture = await loadLocalReviewModelRoutingEvaluationFixture(fixturePath);
  const summary = evaluateLocalReviewModelRoutingFixture(fixture, FIXTURE_RELATIVE_PATH);
  const committed = JSON.parse(await fs.readFile(summaryPath, "utf8")) as unknown;

  assert.deepEqual(summary, committed);
  assert.equal(
    serializeLocalReviewModelRoutingEvaluationSummary(summary),
    await fs.readFile(summaryPath, "utf8"),
  );
  assert.deepEqual(
    summary.candidates.map((candidate) => candidate.id),
    [
      "all-inherit",
      "terra-specialists-sol-verifier",
      "luna-generic-terra-specialists-sol-verifier",
    ],
  );
  assert.deepEqual(summary.eligibleCandidateIds, []);
  assert.deepEqual(summary.defaultDecision, {
    changed: false,
    selectedCandidateId: null,
    reason: "representative_fixture_only",
  });
  assert.doesNotMatch(JSON.stringify(summary), /\/Users\/|[A-Z]:\\/);
});

test("evaluation records quality, benefit, and optional metric coverage separately", async () => {
  const fixture = await loadLocalReviewModelRoutingEvaluationFixture(fixturePath);
  const summary = evaluateLocalReviewModelRoutingFixture(fixture, FIXTURE_RELATIVE_PATH);
  const baseline = summary.candidates.find((candidate) => candidate.id === "all-inherit");
  const passingHypothesis = summary.candidates.find(
    (candidate) => candidate.id === "terra-specialists-sol-verifier",
  );
  const regressingHypothesis = summary.candidates.find(
    (candidate) => candidate.id === "luna-generic-terra-specialists-sol-verifier",
  );

  assert.ok(baseline);
  assert.ok(passingHypothesis);
  assert.ok(regressingHypothesis);
  assert.deepEqual(
    {
      correctnessRate: baseline.metrics.correctnessRate,
      falsePositiveCount: baseline.metrics.falsePositiveCount,
      falsePositiveRate: baseline.metrics.falsePositiveRate,
      verifierAgreementRate: baseline.metrics.verifierAgreementRate,
      latencyAverage: baseline.metrics.latencyMs.average,
      tokenCoverage: baseline.metrics.tokenUsage.coverage,
      costCoverage: baseline.metrics.estimatedCost.coverage,
    },
    {
      correctnessRate: 1,
      falsePositiveCount: 1,
      falsePositiveRate: 0.25,
      verifierAgreementRate: 0.75,
      latencyAverage: 1300,
      tokenCoverage: "complete",
      costCoverage: "complete",
    },
  );
  assert.equal(passingHypothesis.qualityGuardrailsPassed, true);
  assert.equal(passingHypothesis.qualityNonRegression, true);
  assert.equal(passingHypothesis.measurableLatencyOrCostBenefit, true);
  assert.equal(passingHypothesis.eligibleForDefault, false);
  assert.deepEqual(passingHypothesis.defaultGateReasons, ["representative_fixture_only"]);
  assert.equal(regressingHypothesis.metrics.correctnessRate, 0.6667);
  assert.equal(regressingHypothesis.metrics.falsePositiveRate, 0.3333);
  assert.equal(regressingHypothesis.metrics.verifierAgreementRate, 0.6667);
  assert.equal(regressingHypothesis.metrics.retryRate, 0.3333);
  assert.equal(regressingHypothesis.metrics.tokenUsage.coverage, "partial");
  assert.equal(regressingHypothesis.metrics.tokenUsage.inputTokens, null);
  assert.equal(regressingHypothesis.metrics.estimatedCost.coverage, "partial");
  assert.equal(regressingHypothesis.metrics.estimatedCost.totalUsd, null);
  assert.equal(regressingHypothesis.measurableLatencyOrCostBenefit, true);
  assert.equal(regressingHypothesis.qualityGuardrailsPassed, false);
  assert.equal(regressingHypothesis.eligibleForDefault, false);
  assert.deepEqual(regressingHypothesis.defaultGateReasons, [
    "absolute_quality_guardrails_failed",
    "baseline_quality_regression",
    "representative_fixture_only",
  ]);
});

test("recorded evidence can clear eligibility without changing the default automatically", async () => {
  const raw = await readMutableFixture();
  raw.evidenceKind = "recorded_run";
  const fixture = parseLocalReviewModelRoutingEvaluationFixture(raw, "recorded-fixture");
  const summary = evaluateLocalReviewModelRoutingFixture(fixture, "recorded-fixture.json");
  const passingHypothesis = summary.candidates.find(
    (candidate) => candidate.id === "terra-specialists-sol-verifier",
  );

  assert.ok(passingHypothesis);
  assert.equal(passingHypothesis.eligibleForDefault, true);
  assert.deepEqual(passingHypothesis.defaultGateReasons, [
    "quality_and_benefit_gate_passed",
  ]);
  assert.deepEqual(summary.eligibleCandidateIds, ["terra-specialists-sol-verifier"]);
  assert.deepEqual(summary.defaultDecision, {
    changed: false,
    selectedCandidateId: null,
    reason: "operator_decision_required",
  });
});

test("recorded evidence without expected findings or verifier verdicts cannot clear eligibility", async () => {
  const raw = await readMutableFixture();
  raw.evidenceKind = "recorded_run";
  for (const evaluationCase of raw.cases) {
    evaluationCase.expectedFindingKeys = [];
  }
  for (const candidate of raw.candidates) {
    for (const observation of candidate.observations) {
      observation.observedFindingKeys = [];
      observation.verifierFindings = [];
    }
  }

  const fixture = parseLocalReviewModelRoutingEvaluationFixture(raw, "zero-signal-recorded");
  const summary = evaluateLocalReviewModelRoutingFixture(fixture, "zero-signal-recorded.json");
  const fasterCandidate = summary.candidates.find(
    (candidate) => candidate.id === "terra-specialists-sol-verifier",
  );

  assert.ok(fasterCandidate);
  assert.equal(fasterCandidate.metrics.correctnessRate, 1);
  assert.equal(fasterCandidate.metrics.verifierAgreementRate, 1);
  assert.equal(fasterCandidate.qualityEvidenceSufficient, false);
  assert.equal(fasterCandidate.qualityGuardrailsPassed, false);
  assert.equal(fasterCandidate.measurableLatencyOrCostBenefit, true);
  assert.equal(fasterCandidate.eligibleForDefault, false);
  assert.deepEqual(fasterCandidate.defaultGateReasons, [
    "insufficient_quality_evidence",
  ]);
  assert.deepEqual(summary.eligibleCandidateIds, []);
  assert.equal(summary.defaultDecision.reason, "no_candidate_satisfied_default_gate");
});

test("fixture parser rejects schema drift and duplicate candidates", async () => {
  const schemaDrift = await readMutableFixture();
  schemaDrift.schemaVersion = 2;
  assert.throws(
    () => parseLocalReviewModelRoutingEvaluationFixture(schemaDrift, "schema-drift"),
    /schema-drift\.schemaVersion: expected 1/,
  );

  const duplicateCandidate = await readMutableFixture();
  duplicateCandidate.candidates[1]!.id = duplicateCandidate.candidates[0]!.id;
  assert.throws(
    () => parseLocalReviewModelRoutingEvaluationFixture(duplicateCandidate, "duplicates"),
    /duplicates\.candidates: duplicate id all-inherit/,
  );
});

test("fixture parser rejects unchanged and duplicate candidate route matrices", async () => {
  const unchangedCandidate = await readMutableFixture();
  unchangedCandidate.candidates[1]!.routes = structuredClone(
    unchangedCandidate.candidates[0]!.routes,
  );
  assert.throws(
    () => parseLocalReviewModelRoutingEvaluationFixture(unchangedCandidate, "unchanged-route"),
    /unchanged-route\.candidates\.terra-specialists-sol-verifier\.routes: candidate must differ from baseline all-inherit on at least one target/,
  );

  const duplicateRoute = await readMutableFixture();
  duplicateRoute.candidates[2]!.routes = structuredClone(
    duplicateRoute.candidates[1]!.routes,
  );
  assert.throws(
    () => parseLocalReviewModelRoutingEvaluationFixture(duplicateRoute, "duplicate-route"),
    /duplicate-route\.candidates\.luna-generic-terra-specialists-sol-verifier\.routes: route matrix duplicates candidate terra-specialists-sol-verifier/,
  );
});

test("fixture parser requires every target and exactly one observation per case", async () => {
  const missingTarget = await readMutableFixture();
  delete missingTarget.candidates[1]!.routes.local_review_verifier;
  assert.throws(
    () => parseLocalReviewModelRoutingEvaluationFixture(missingTarget, "missing-target"),
    /missing-target\.candidates\[1\]\.routes: missing keys: local_review_verifier/,
  );

  const missingCase = await readMutableFixture();
  missingCase.candidates[1]!.observations.pop();
  assert.throws(
    () => parseLocalReviewModelRoutingEvaluationFixture(missingCase, "missing-case"),
    /missing-case\.candidates\.terra-specialists-sol-verifier\.observations: missing cases: documentation-only/,
  );

  const duplicateCase = await readMutableFixture();
  duplicateCase.candidates[1]!.observations[2]!.caseId =
    duplicateCase.candidates[1]!.observations[1]!.caseId;
  assert.throws(
    () => parseLocalReviewModelRoutingEvaluationFixture(duplicateCase, "duplicate-case"),
    /duplicate-case\.candidates\.terra-specialists-sol-verifier\.observations: duplicate caseId migration-rollback/,
  );
});

test("fixture parser rejects incomplete verifier coverage", async () => {
  const missingVerdict = (await readMutableFixture()) as MutableFixture & {
    candidates: Array<{
      id: string;
      routes: Record<string, unknown>;
      observations: Array<{
        caseId: string;
        verifierFindings?: Array<{ findingKey: string; verdict: string }>;
      }>;
    }>;
  };
  missingVerdict.candidates[0]!.observations[0]!.verifierFindings = [];
  assert.throws(
    () => parseLocalReviewModelRoutingEvaluationFixture(missingVerdict, "missing-verdict"),
    /missing-verdict\.candidates\[0\]\.observations\[0\]\.verifierFindings: missing verdicts for: auth-missing-signature/,
  );
});
