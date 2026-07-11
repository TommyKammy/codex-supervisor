import fs from "node:fs/promises";
import path from "node:path";
import {
  type CodexExecutionTarget,
  type CodexTargetModelRoute,
} from "../core/config-types";
import { type VerificationVerdict } from "./types";

export const LOCAL_REVIEW_MODEL_ROUTING_EVALUATION_SCHEMA_VERSION = 1;

export const LOCAL_REVIEW_MODEL_ROUTING_EVALUATION_TARGETS = [
  "supervisor",
  "local_review_generic",
  "local_review_specialist",
  "local_review_verifier",
] as const satisfies readonly CodexExecutionTarget[];

const VERIFICATION_VERDICTS = [
  "confirmed",
  "dismissed",
  "unclear",
] as const satisfies readonly VerificationVerdict[];

export type LocalReviewModelRoutingEvaluationEvidenceKind =
  | "representative_fixture"
  | "recorded_run";

export type LocalReviewModelRoutingMetricCoverage =
  | "none"
  | "partial"
  | "complete";

export interface LocalReviewModelRoutingQualityGuardrails {
  minimumCorrectnessRate: number;
  maximumFalsePositiveRate: number;
  minimumVerifierAgreementRate: number;
  maximumRetryRate: number;
  minimumLatencyOrCostImprovementPercent: number;
}

export interface LocalReviewModelRoutingEvaluationCase {
  id: string;
  expectedFindingKeys: string[];
}

export interface LocalReviewModelRoutingVerifierFinding {
  findingKey: string;
  verdict: VerificationVerdict;
}

export interface LocalReviewModelRoutingTokenUsage {
  inputTokens: number;
  outputTokens: number;
}

export interface LocalReviewModelRoutingEvaluationObservation {
  caseId: string;
  observedFindingKeys: string[];
  verifierFindings: LocalReviewModelRoutingVerifierFinding[];
  latencyMs: number;
  retryCount: number;
  tokenUsage: LocalReviewModelRoutingTokenUsage | null;
  estimatedCostUsd: number | null;
}

export type LocalReviewModelRoutingEvaluationRoutes = Record<
  CodexExecutionTarget,
  CodexTargetModelRoute
>;

export interface LocalReviewModelRoutingEvaluationCandidate {
  id: string;
  label: string;
  routes: LocalReviewModelRoutingEvaluationRoutes;
  observations: LocalReviewModelRoutingEvaluationObservation[];
}

export interface LocalReviewModelRoutingEvaluationFixture {
  schemaVersion: typeof LOCAL_REVIEW_MODEL_ROUTING_EVALUATION_SCHEMA_VERSION;
  evaluationId: string;
  evidenceKind: LocalReviewModelRoutingEvaluationEvidenceKind;
  recordedAt: string;
  baselineCandidateId: string;
  guardrails: LocalReviewModelRoutingQualityGuardrails;
  cases: LocalReviewModelRoutingEvaluationCase[];
  candidates: LocalReviewModelRoutingEvaluationCandidate[];
}

export interface LocalReviewModelRoutingTokenUsageSummary {
  coverage: LocalReviewModelRoutingMetricCoverage;
  observedRunCount: number;
  inputTokens: number | null;
  outputTokens: number | null;
  totalTokens: number | null;
}

export interface LocalReviewModelRoutingCostSummary {
  coverage: LocalReviewModelRoutingMetricCoverage;
  observedRunCount: number;
  totalUsd: number | null;
  averageUsd: number | null;
}

export interface LocalReviewModelRoutingCandidateMetrics {
  runCount: number;
  expectedFindingCount: number;
  observedFindingCount: number;
  confirmedFindingCount: number;
  dismissedFindingCount: number;
  unclearFindingCount: number;
  truePositiveCount: number;
  falsePositiveCount: number;
  confirmedFalsePositiveCount: number;
  falseNegativeCount: number;
  correctnessRate: number;
  falsePositiveRate: number;
  verifierAgreementRate: number;
  retriedRunCount: number;
  retryCount: number;
  retryRate: number;
  latencyMs: {
    total: number;
    average: number;
  };
  tokenUsage: LocalReviewModelRoutingTokenUsageSummary;
  estimatedCost: LocalReviewModelRoutingCostSummary;
}

export interface LocalReviewModelRoutingBaselineComparison {
  correctnessRateDelta: number;
  falsePositiveRateDelta: number;
  verifierAgreementRateDelta: number;
  retryRateDelta: number;
  averageLatencyImprovementPercent: number | null;
  averageCostImprovementPercent: number | null;
}

export type LocalReviewModelRoutingDefaultGateReason =
  | "baseline_candidate"
  | "insufficient_quality_evidence"
  | "absolute_quality_guardrails_failed"
  | "baseline_quality_regression"
  | "no_measurable_latency_or_cost_benefit"
  | "representative_fixture_only"
  | "quality_and_benefit_gate_passed";

export interface LocalReviewModelRoutingCandidateSummary {
  id: string;
  label: string;
  routes: LocalReviewModelRoutingEvaluationRoutes;
  metrics: LocalReviewModelRoutingCandidateMetrics;
  comparisonToBaseline: LocalReviewModelRoutingBaselineComparison;
  qualityEvidenceSufficient: boolean;
  absoluteQualityGuardrailsPassed: boolean;
  qualityNonRegression: boolean;
  qualityGuardrailsPassed: boolean;
  measurableLatencyOrCostBenefit: boolean;
  eligibleForDefault: boolean;
  defaultGateReasons: LocalReviewModelRoutingDefaultGateReason[];
}

export interface LocalReviewModelRoutingEvaluationSummary {
  schemaVersion: typeof LOCAL_REVIEW_MODEL_ROUTING_EVALUATION_SCHEMA_VERSION;
  evaluationId: string;
  sourceFixture: string;
  evidenceKind: LocalReviewModelRoutingEvaluationEvidenceKind;
  recordedAt: string;
  baselineCandidateId: string;
  guardrails: LocalReviewModelRoutingQualityGuardrails;
  candidates: LocalReviewModelRoutingCandidateSummary[];
  eligibleCandidateIds: string[];
  defaultDecision: {
    changed: false;
    selectedCandidateId: null;
    reason:
      | "representative_fixture_only"
      | "operator_decision_required"
      | "no_candidate_satisfied_default_gate";
  };
}

type JsonRecord = Record<string, unknown>;

function fail(source: string, message: string): never {
  throw new Error(`Invalid local-review model-routing evaluation at ${source}: ${message}`);
}

function expectRecord(value: unknown, source: string): JsonRecord {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    fail(source, "expected an object.");
  }
  return value as JsonRecord;
}

function expectExactKeys(
  value: JsonRecord,
  expectedKeys: readonly string[],
  source: string,
): void {
  const actualKeys = Object.keys(value).sort();
  const expected = [...expectedKeys].sort();
  const missing = expected.filter((key) => !actualKeys.includes(key));
  const unexpected = actualKeys.filter((key) => !expected.includes(key));
  if (missing.length > 0 || unexpected.length > 0) {
    fail(
      source,
      [
        missing.length > 0 ? `missing keys: ${missing.join(", ")}` : null,
        unexpected.length > 0 ? `unexpected keys: ${unexpected.join(", ")}` : null,
      ]
        .filter(Boolean)
        .join("; "),
    );
  }
}

function expectString(value: unknown, source: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    fail(source, "expected a non-empty string.");
  }
  return value.trim();
}

function expectIsoTimestamp(value: unknown, source: string): string {
  const timestamp = expectString(value, source);
  if (!Number.isFinite(Date.parse(timestamp))) {
    fail(source, "expected an ISO-8601 timestamp.");
  }
  return timestamp;
}

function expectArray(value: unknown, source: string): unknown[] {
  if (!Array.isArray(value)) {
    fail(source, "expected an array.");
  }
  return value;
}

function expectNonNegativeInteger(value: unknown, source: string): number {
  if (!Number.isInteger(value) || (value as number) < 0) {
    fail(source, "expected a non-negative integer.");
  }
  return value as number;
}

function expectNonNegativeNumber(value: unknown, source: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    fail(source, "expected a non-negative finite number.");
  }
  return value;
}

function expectRate(value: unknown, source: string): number {
  const rate = expectNonNegativeNumber(value, source);
  if (rate > 1) {
    fail(source, "expected a rate between 0 and 1.");
  }
  return rate;
}

function expectUniqueStrings(value: unknown, source: string): string[] {
  const strings = expectArray(value, source).map((entry, index) =>
    expectString(entry, `${source}[${index}]`),
  );
  const duplicate = strings.find((entry, index) => strings.indexOf(entry) !== index);
  if (duplicate) {
    fail(source, `duplicate value ${duplicate}.`);
  }
  return strings;
}

function expectUniqueIds<T extends { id: string }>(values: T[], source: string): void {
  const duplicate = values.find(
    (value, index) => values.findIndex((candidate) => candidate.id === value.id) !== index,
  );
  if (duplicate) {
    fail(source, `duplicate id ${duplicate.id}.`);
  }
}

function parseGuardrails(
  value: unknown,
  source: string,
): LocalReviewModelRoutingQualityGuardrails {
  const record = expectRecord(value, source);
  expectExactKeys(
    record,
    [
      "minimumCorrectnessRate",
      "maximumFalsePositiveRate",
      "minimumVerifierAgreementRate",
      "maximumRetryRate",
      "minimumLatencyOrCostImprovementPercent",
    ],
    source,
  );
  return {
    minimumCorrectnessRate: expectRate(
      record.minimumCorrectnessRate,
      `${source}.minimumCorrectnessRate`,
    ),
    maximumFalsePositiveRate: expectRate(
      record.maximumFalsePositiveRate,
      `${source}.maximumFalsePositiveRate`,
    ),
    minimumVerifierAgreementRate: expectRate(
      record.minimumVerifierAgreementRate,
      `${source}.minimumVerifierAgreementRate`,
    ),
    maximumRetryRate: expectRate(record.maximumRetryRate, `${source}.maximumRetryRate`),
    minimumLatencyOrCostImprovementPercent: expectNonNegativeNumber(
      record.minimumLatencyOrCostImprovementPercent,
      `${source}.minimumLatencyOrCostImprovementPercent`,
    ),
  };
}

function parseCase(
  value: unknown,
  source: string,
): LocalReviewModelRoutingEvaluationCase {
  const record = expectRecord(value, source);
  expectExactKeys(record, ["id", "expectedFindingKeys"], source);
  return {
    id: expectString(record.id, `${source}.id`),
    expectedFindingKeys: expectUniqueStrings(
      record.expectedFindingKeys,
      `${source}.expectedFindingKeys`,
    ),
  };
}

function parseRoute(value: unknown, source: string): CodexTargetModelRoute {
  const record = expectRecord(value, source);
  const strategy = expectString(record.strategy, `${source}.strategy`);
  if (strategy === "inherit") {
    expectExactKeys(record, ["strategy"], source);
    return { strategy };
  }
  if (strategy === "fixed" || strategy === "alias") {
    expectExactKeys(record, ["strategy", "model"], source);
    return {
      strategy,
      model: expectString(record.model, `${source}.model`),
    };
  }
  fail(`${source}.strategy`, "expected inherit, fixed, or alias.");
}

function parseRoutes(
  value: unknown,
  source: string,
): LocalReviewModelRoutingEvaluationRoutes {
  const record = expectRecord(value, source);
  expectExactKeys(record, LOCAL_REVIEW_MODEL_ROUTING_EVALUATION_TARGETS, source);
  return {
    supervisor: parseRoute(record.supervisor, `${source}.supervisor`),
    local_review_generic: parseRoute(
      record.local_review_generic,
      `${source}.local_review_generic`,
    ),
    local_review_specialist: parseRoute(
      record.local_review_specialist,
      `${source}.local_review_specialist`,
    ),
    local_review_verifier: parseRoute(
      record.local_review_verifier,
      `${source}.local_review_verifier`,
    ),
  };
}

function parseVerifierFinding(
  value: unknown,
  source: string,
): LocalReviewModelRoutingVerifierFinding {
  const record = expectRecord(value, source);
  expectExactKeys(record, ["findingKey", "verdict"], source);
  const verdict = expectString(record.verdict, `${source}.verdict`);
  if (!VERIFICATION_VERDICTS.includes(verdict as VerificationVerdict)) {
    fail(`${source}.verdict`, `expected ${VERIFICATION_VERDICTS.join(", ")}.`);
  }
  return {
    findingKey: expectString(record.findingKey, `${source}.findingKey`),
    verdict: verdict as VerificationVerdict,
  };
}

function parseTokenUsage(
  value: unknown,
  source: string,
): LocalReviewModelRoutingTokenUsage | null {
  if (value === null) {
    return null;
  }
  const record = expectRecord(value, source);
  expectExactKeys(record, ["inputTokens", "outputTokens"], source);
  return {
    inputTokens: expectNonNegativeInteger(record.inputTokens, `${source}.inputTokens`),
    outputTokens: expectNonNegativeInteger(record.outputTokens, `${source}.outputTokens`),
  };
}

function parseObservation(
  value: unknown,
  source: string,
): LocalReviewModelRoutingEvaluationObservation {
  const record = expectRecord(value, source);
  expectExactKeys(
    record,
    [
      "caseId",
      "observedFindingKeys",
      "verifierFindings",
      "latencyMs",
      "retryCount",
      "tokenUsage",
      "estimatedCostUsd",
    ],
    source,
  );
  const observedFindingKeys = expectUniqueStrings(
    record.observedFindingKeys,
    `${source}.observedFindingKeys`,
  );
  const verifierFindings = expectArray(record.verifierFindings, `${source}.verifierFindings`).map(
    (finding, index) =>
      parseVerifierFinding(finding, `${source}.verifierFindings[${index}]`),
  );
  const verifierKeys = verifierFindings.map((finding) => finding.findingKey);
  const duplicateVerifierKey = verifierKeys.find(
    (findingKey, index) => verifierKeys.indexOf(findingKey) !== index,
  );
  if (duplicateVerifierKey) {
    fail(`${source}.verifierFindings`, `duplicate findingKey ${duplicateVerifierKey}.`);
  }
  const missingVerifierKeys = observedFindingKeys.filter(
    (findingKey) => !verifierKeys.includes(findingKey),
  );
  const unknownVerifierKeys = verifierKeys.filter(
    (findingKey) => !observedFindingKeys.includes(findingKey),
  );
  if (missingVerifierKeys.length > 0 || unknownVerifierKeys.length > 0) {
    fail(
      `${source}.verifierFindings`,
      [
        missingVerifierKeys.length > 0
          ? `missing verdicts for: ${missingVerifierKeys.join(", ")}`
          : null,
        unknownVerifierKeys.length > 0
          ? `verdicts without observed findings: ${unknownVerifierKeys.join(", ")}`
          : null,
      ]
        .filter(Boolean)
        .join("; "),
    );
  }
  const estimatedCostUsd =
    record.estimatedCostUsd === null
      ? null
      : expectNonNegativeNumber(record.estimatedCostUsd, `${source}.estimatedCostUsd`);
  return {
    caseId: expectString(record.caseId, `${source}.caseId`),
    observedFindingKeys,
    verifierFindings,
    latencyMs: expectNonNegativeInteger(record.latencyMs, `${source}.latencyMs`),
    retryCount: expectNonNegativeInteger(record.retryCount, `${source}.retryCount`),
    tokenUsage: parseTokenUsage(record.tokenUsage, `${source}.tokenUsage`),
    estimatedCostUsd,
  };
}

function parseCandidate(
  value: unknown,
  source: string,
): LocalReviewModelRoutingEvaluationCandidate {
  const record = expectRecord(value, source);
  expectExactKeys(record, ["id", "label", "routes", "observations"], source);
  return {
    id: expectString(record.id, `${source}.id`),
    label: expectString(record.label, `${source}.label`),
    routes: parseRoutes(record.routes, `${source}.routes`),
    observations: expectArray(record.observations, `${source}.observations`).map(
      (observation, index) =>
        parseObservation(observation, `${source}.observations[${index}]`),
    ),
  };
}

export function parseLocalReviewModelRoutingEvaluationFixture(
  value: unknown,
  source = "inline",
): LocalReviewModelRoutingEvaluationFixture {
  const record = expectRecord(value, source);
  expectExactKeys(
    record,
    [
      "schemaVersion",
      "evaluationId",
      "evidenceKind",
      "recordedAt",
      "baselineCandidateId",
      "guardrails",
      "cases",
      "candidates",
    ],
    source,
  );
  if (record.schemaVersion !== LOCAL_REVIEW_MODEL_ROUTING_EVALUATION_SCHEMA_VERSION) {
    fail(
      `${source}.schemaVersion`,
      `expected ${LOCAL_REVIEW_MODEL_ROUTING_EVALUATION_SCHEMA_VERSION}.`,
    );
  }
  const evidenceKind = expectString(record.evidenceKind, `${source}.evidenceKind`);
  if (evidenceKind !== "representative_fixture" && evidenceKind !== "recorded_run") {
    fail(`${source}.evidenceKind`, "expected representative_fixture or recorded_run.");
  }
  const cases = expectArray(record.cases, `${source}.cases`).map((entry, index) =>
    parseCase(entry, `${source}.cases[${index}]`),
  );
  const candidates = expectArray(record.candidates, `${source}.candidates`).map(
    (entry, index) => parseCandidate(entry, `${source}.candidates[${index}]`),
  );
  if (cases.length === 0) {
    fail(`${source}.cases`, "expected at least one case.");
  }
  if (candidates.length < 2) {
    fail(`${source}.candidates`, "expected a baseline and at least one candidate.");
  }
  expectUniqueIds(cases, `${source}.cases`);
  expectUniqueIds(candidates, `${source}.candidates`);

  const baselineCandidateId = expectString(
    record.baselineCandidateId,
    `${source}.baselineCandidateId`,
  );
  const baseline = candidates.find((candidate) => candidate.id === baselineCandidateId);
  if (!baseline) {
    fail(`${source}.baselineCandidateId`, `unknown candidate ${baselineCandidateId}.`);
  }
  const nonInheritedBaselineTargets = LOCAL_REVIEW_MODEL_ROUTING_EVALUATION_TARGETS.filter(
    (target) => baseline.routes[target].strategy !== "inherit",
  );
  if (nonInheritedBaselineTargets.length > 0) {
    fail(
      `${source}.candidates`,
      `baseline must inherit every target; explicit targets: ${nonInheritedBaselineTargets.join(", ")}.`,
    );
  }
  const routeSignature = (candidate: LocalReviewModelRoutingEvaluationCandidate): string =>
    JSON.stringify(
      LOCAL_REVIEW_MODEL_ROUTING_EVALUATION_TARGETS.map((target) => {
        const route = candidate.routes[target];
        return [target, route.strategy, "model" in route ? route.model : null];
      }),
    );
  const baselineRouteSignature = routeSignature(baseline);
  const candidateIdByRouteSignature = new Map<string, string>();
  for (const candidate of candidates) {
    const signature = routeSignature(candidate);
    if (candidate.id !== baselineCandidateId && signature === baselineRouteSignature) {
      fail(
        `${source}.candidates.${candidate.id}.routes`,
        `candidate must differ from baseline ${baselineCandidateId} on at least one target.`,
      );
    }
    const duplicateCandidateId = candidateIdByRouteSignature.get(signature);
    if (duplicateCandidateId) {
      fail(
        `${source}.candidates.${candidate.id}.routes`,
        `route matrix duplicates candidate ${duplicateCandidateId}.`,
      );
    }
    candidateIdByRouteSignature.set(signature, candidate.id);
  }

  const caseIds = cases.map((evaluationCase) => evaluationCase.id);
  for (const candidate of candidates) {
    const observationCaseIds = candidate.observations.map((observation) => observation.caseId);
    const duplicateCaseId = observationCaseIds.find(
      (caseId, index) => observationCaseIds.indexOf(caseId) !== index,
    );
    if (duplicateCaseId) {
      fail(
        `${source}.candidates.${candidate.id}.observations`,
        `duplicate caseId ${duplicateCaseId}.`,
      );
    }
    const missingCaseIds = caseIds.filter((caseId) => !observationCaseIds.includes(caseId));
    const unknownCaseIds = observationCaseIds.filter((caseId) => !caseIds.includes(caseId));
    if (missingCaseIds.length > 0 || unknownCaseIds.length > 0) {
      fail(
        `${source}.candidates.${candidate.id}.observations`,
        [
          missingCaseIds.length > 0 ? `missing cases: ${missingCaseIds.join(", ")}` : null,
          unknownCaseIds.length > 0 ? `unknown cases: ${unknownCaseIds.join(", ")}` : null,
        ]
          .filter(Boolean)
          .join("; "),
      );
    }
  }

  return {
    schemaVersion: LOCAL_REVIEW_MODEL_ROUTING_EVALUATION_SCHEMA_VERSION,
    evaluationId: expectString(record.evaluationId, `${source}.evaluationId`),
    evidenceKind,
    recordedAt: expectIsoTimestamp(record.recordedAt, `${source}.recordedAt`),
    baselineCandidateId,
    guardrails: parseGuardrails(record.guardrails, `${source}.guardrails`),
    cases,
    candidates,
  };
}

export async function loadLocalReviewModelRoutingEvaluationFixture(
  fixturePath: string,
): Promise<LocalReviewModelRoutingEvaluationFixture> {
  const raw = JSON.parse(await fs.readFile(fixturePath, "utf8")) as unknown;
  return parseLocalReviewModelRoutingEvaluationFixture(raw, fixturePath);
}

function round(value: number, precision = 4): number {
  const factor = 10 ** precision;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

function rate(numerator: number, denominator: number, emptyValue: number): number {
  return denominator === 0 ? emptyValue : round(numerator / denominator);
}

function metricCoverage(
  observedRunCount: number,
  runCount: number,
): LocalReviewModelRoutingMetricCoverage {
  if (observedRunCount === 0) {
    return "none";
  }
  return observedRunCount === runCount ? "complete" : "partial";
}

function buildCandidateMetrics(
  candidate: LocalReviewModelRoutingEvaluationCandidate,
  evaluationCases: LocalReviewModelRoutingEvaluationCase[],
): LocalReviewModelRoutingCandidateMetrics {
  const observationByCaseId = new Map(
    candidate.observations.map((observation) => [observation.caseId, observation]),
  );
  let expectedFindingCount = 0;
  let observedFindingCount = 0;
  let confirmedFindingCount = 0;
  let dismissedFindingCount = 0;
  let unclearFindingCount = 0;
  let truePositiveCount = 0;
  let falsePositiveCount = 0;
  let confirmedFalsePositiveCount = 0;
  let falseNegativeCount = 0;

  for (const evaluationCase of evaluationCases) {
    const observation = observationByCaseId.get(evaluationCase.id);
    if (!observation) {
      throw new Error(`Validated evaluation is missing case ${evaluationCase.id}.`);
    }
    const expected = new Set(evaluationCase.expectedFindingKeys);
    const confirmed = new Set(
      observation.verifierFindings
        .filter((finding) => finding.verdict === "confirmed")
        .map((finding) => finding.findingKey),
    );
    expectedFindingCount += expected.size;
    observedFindingCount += observation.observedFindingKeys.length;
    confirmedFindingCount += confirmed.size;
    dismissedFindingCount += observation.verifierFindings.filter(
      (finding) => finding.verdict === "dismissed",
    ).length;
    unclearFindingCount += observation.verifierFindings.filter(
      (finding) => finding.verdict === "unclear",
    ).length;
    truePositiveCount += [...confirmed].filter((findingKey) => expected.has(findingKey)).length;
    falsePositiveCount += observation.observedFindingKeys.filter(
      (findingKey) => !expected.has(findingKey),
    ).length;
    confirmedFalsePositiveCount += [...confirmed].filter(
      (findingKey) => !expected.has(findingKey),
    ).length;
    falseNegativeCount += [...expected].filter(
      (findingKey) => !confirmed.has(findingKey),
    ).length;
  }

  const runCount = candidate.observations.length;
  const retriedRunCount = candidate.observations.filter(
    (observation) => observation.retryCount > 0,
  ).length;
  const retryCount = candidate.observations.reduce(
    (total, observation) => total + observation.retryCount,
    0,
  );
  const totalLatencyMs = candidate.observations.reduce(
    (total, observation) => total + observation.latencyMs,
    0,
  );
  const tokenObservations = candidate.observations.flatMap((observation) =>
    observation.tokenUsage ? [observation.tokenUsage] : [],
  );
  const tokenCoverage = metricCoverage(tokenObservations.length, runCount);
  const costObservations = candidate.observations.flatMap((observation) =>
    observation.estimatedCostUsd === null ? [] : [observation.estimatedCostUsd],
  );
  const costCoverage = metricCoverage(costObservations.length, runCount);
  const completeInputTokens =
    tokenCoverage === "complete"
      ? tokenObservations.reduce((total, usage) => total + usage.inputTokens, 0)
      : null;
  const completeOutputTokens =
    tokenCoverage === "complete"
      ? tokenObservations.reduce((total, usage) => total + usage.outputTokens, 0)
      : null;
  const completeCost =
    costCoverage === "complete"
      ? round(costObservations.reduce((total, cost) => total + cost, 0), 6)
      : null;

  return {
    runCount,
    expectedFindingCount,
    observedFindingCount,
    confirmedFindingCount,
    dismissedFindingCount,
    unclearFindingCount,
    truePositiveCount,
    falsePositiveCount,
    confirmedFalsePositiveCount,
    falseNegativeCount,
    correctnessRate: rate(
      truePositiveCount,
      truePositiveCount + confirmedFalsePositiveCount + falseNegativeCount,
      1,
    ),
    falsePositiveRate: rate(falsePositiveCount, observedFindingCount, 0),
    verifierAgreementRate: rate(
      confirmedFindingCount,
      confirmedFindingCount + dismissedFindingCount + unclearFindingCount,
      1,
    ),
    retriedRunCount,
    retryCount,
    retryRate: rate(retriedRunCount, runCount, 0),
    latencyMs: {
      total: totalLatencyMs,
      average: round(totalLatencyMs / runCount, 2),
    },
    tokenUsage: {
      coverage: tokenCoverage,
      observedRunCount: tokenObservations.length,
      inputTokens: completeInputTokens,
      outputTokens: completeOutputTokens,
      totalTokens:
        completeInputTokens === null || completeOutputTokens === null
          ? null
          : completeInputTokens + completeOutputTokens,
    },
    estimatedCost: {
      coverage: costCoverage,
      observedRunCount: costObservations.length,
      totalUsd: completeCost,
      averageUsd: completeCost === null ? null : round(completeCost / runCount, 6),
    },
  };
}

function improvementPercent(baseline: number, candidate: number): number | null {
  if (baseline === 0) {
    return null;
  }
  return round(((baseline - candidate) / baseline) * 100, 2);
}

function compareToBaseline(
  metrics: LocalReviewModelRoutingCandidateMetrics,
  baseline: LocalReviewModelRoutingCandidateMetrics,
): LocalReviewModelRoutingBaselineComparison {
  return {
    correctnessRateDelta: round(metrics.correctnessRate - baseline.correctnessRate),
    falsePositiveRateDelta: round(metrics.falsePositiveRate - baseline.falsePositiveRate),
    verifierAgreementRateDelta: round(
      metrics.verifierAgreementRate - baseline.verifierAgreementRate,
    ),
    retryRateDelta: round(metrics.retryRate - baseline.retryRate),
    averageLatencyImprovementPercent: improvementPercent(
      baseline.latencyMs.average,
      metrics.latencyMs.average,
    ),
    averageCostImprovementPercent:
      baseline.estimatedCost.averageUsd === null || metrics.estimatedCost.averageUsd === null
        ? null
        : improvementPercent(
            baseline.estimatedCost.averageUsd,
            metrics.estimatedCost.averageUsd,
          ),
  };
}

function passesAbsoluteGuardrails(
  metrics: LocalReviewModelRoutingCandidateMetrics,
  guardrails: LocalReviewModelRoutingQualityGuardrails,
): boolean {
  return (
    metrics.correctnessRate >= guardrails.minimumCorrectnessRate &&
    metrics.falsePositiveRate <= guardrails.maximumFalsePositiveRate &&
    metrics.verifierAgreementRate >= guardrails.minimumVerifierAgreementRate &&
    metrics.retryRate <= guardrails.maximumRetryRate
  );
}

function hasSufficientQualityEvidence(
  metrics: LocalReviewModelRoutingCandidateMetrics,
): boolean {
  const verifierVerdictCount =
    metrics.confirmedFindingCount +
    metrics.dismissedFindingCount +
    metrics.unclearFindingCount;
  return metrics.expectedFindingCount > 0 && verifierVerdictCount > 0;
}

function preservesBaselineQuality(
  metrics: LocalReviewModelRoutingCandidateMetrics,
  baseline: LocalReviewModelRoutingCandidateMetrics,
): boolean {
  return (
    metrics.correctnessRate >= baseline.correctnessRate &&
    metrics.falsePositiveRate <= baseline.falsePositiveRate &&
    metrics.verifierAgreementRate >= baseline.verifierAgreementRate &&
    metrics.retryRate <= baseline.retryRate
  );
}

function hasMeasurableBenefit(
  comparison: LocalReviewModelRoutingBaselineComparison,
  guardrails: LocalReviewModelRoutingQualityGuardrails,
): boolean {
  const threshold = guardrails.minimumLatencyOrCostImprovementPercent;
  return (
    (comparison.averageLatencyImprovementPercent !== null &&
      comparison.averageLatencyImprovementPercent >= threshold) ||
    (comparison.averageCostImprovementPercent !== null &&
      comparison.averageCostImprovementPercent >= threshold)
  );
}

function buildGateReasons(args: {
  isBaseline: boolean;
  qualityEvidenceSufficient: boolean;
  absoluteQualityGuardrailsPassed: boolean;
  qualityNonRegression: boolean;
  measurableLatencyOrCostBenefit: boolean;
  evidenceKind: LocalReviewModelRoutingEvaluationEvidenceKind;
  eligibleForDefault: boolean;
}): LocalReviewModelRoutingDefaultGateReason[] {
  if (args.isBaseline) {
    return ["baseline_candidate"];
  }
  const reasons: LocalReviewModelRoutingDefaultGateReason[] = [];
  if (!args.qualityEvidenceSufficient) {
    reasons.push("insufficient_quality_evidence");
  }
  if (!args.absoluteQualityGuardrailsPassed) {
    reasons.push("absolute_quality_guardrails_failed");
  }
  if (!args.qualityNonRegression) {
    reasons.push("baseline_quality_regression");
  }
  if (!args.measurableLatencyOrCostBenefit) {
    reasons.push("no_measurable_latency_or_cost_benefit");
  }
  if (args.evidenceKind === "representative_fixture") {
    reasons.push("representative_fixture_only");
  }
  if (args.eligibleForDefault) {
    reasons.push("quality_and_benefit_gate_passed");
  }
  return reasons;
}

export function evaluateLocalReviewModelRoutingFixture(
  fixture: LocalReviewModelRoutingEvaluationFixture,
  sourceFixture = "inline",
): LocalReviewModelRoutingEvaluationSummary {
  const metricsByCandidateId = new Map(
    fixture.candidates.map((candidate) => [
      candidate.id,
      buildCandidateMetrics(candidate, fixture.cases),
    ]),
  );
  const baselineMetrics = metricsByCandidateId.get(fixture.baselineCandidateId);
  if (!baselineMetrics) {
    throw new Error(`Validated evaluation is missing baseline ${fixture.baselineCandidateId}.`);
  }

  const candidates = fixture.candidates.map((candidate): LocalReviewModelRoutingCandidateSummary => {
    const metrics = metricsByCandidateId.get(candidate.id);
    if (!metrics) {
      throw new Error(`Validated evaluation is missing candidate ${candidate.id}.`);
    }
    const comparisonToBaseline = compareToBaseline(metrics, baselineMetrics);
    const isBaseline = candidate.id === fixture.baselineCandidateId;
    const qualityEvidenceSufficient = hasSufficientQualityEvidence(metrics);
    const absoluteQualityGuardrailsPassed = passesAbsoluteGuardrails(
      metrics,
      fixture.guardrails,
    );
    const qualityNonRegression = isBaseline
      ? true
      : preservesBaselineQuality(metrics, baselineMetrics);
    const qualityGuardrailsPassed =
      qualityEvidenceSufficient && absoluteQualityGuardrailsPassed && qualityNonRegression;
    const measurableLatencyOrCostBenefit =
      !isBaseline && hasMeasurableBenefit(comparisonToBaseline, fixture.guardrails);
    const eligibleForDefault =
      !isBaseline &&
      fixture.evidenceKind === "recorded_run" &&
      qualityGuardrailsPassed &&
      measurableLatencyOrCostBenefit;
    return {
      id: candidate.id,
      label: candidate.label,
      routes: candidate.routes,
      metrics,
      comparisonToBaseline,
      qualityEvidenceSufficient,
      absoluteQualityGuardrailsPassed,
      qualityNonRegression,
      qualityGuardrailsPassed,
      measurableLatencyOrCostBenefit,
      eligibleForDefault,
      defaultGateReasons: buildGateReasons({
        isBaseline,
        qualityEvidenceSufficient,
        absoluteQualityGuardrailsPassed,
        qualityNonRegression,
        measurableLatencyOrCostBenefit,
        evidenceKind: fixture.evidenceKind,
        eligibleForDefault,
      }),
    };
  });
  const eligibleCandidateIds = candidates
    .filter((candidate) => candidate.eligibleForDefault)
    .map((candidate) => candidate.id);

  return {
    schemaVersion: LOCAL_REVIEW_MODEL_ROUTING_EVALUATION_SCHEMA_VERSION,
    evaluationId: fixture.evaluationId,
    sourceFixture,
    evidenceKind: fixture.evidenceKind,
    recordedAt: fixture.recordedAt,
    baselineCandidateId: fixture.baselineCandidateId,
    guardrails: fixture.guardrails,
    candidates,
    eligibleCandidateIds,
    defaultDecision: {
      changed: false,
      selectedCandidateId: null,
      reason:
        fixture.evidenceKind === "representative_fixture"
          ? "representative_fixture_only"
          : eligibleCandidateIds.length > 0
            ? "operator_decision_required"
            : "no_candidate_satisfied_default_gate",
    },
  };
}

export function serializeLocalReviewModelRoutingEvaluationSummary(
  summary: LocalReviewModelRoutingEvaluationSummary,
): string {
  return `${JSON.stringify(summary, null, 2)}\n`;
}

export async function writeLocalReviewModelRoutingEvaluationSummary(args: {
  fixturePath: string;
  outputPath: string;
  sourceFixture?: string;
}): Promise<LocalReviewModelRoutingEvaluationSummary> {
  const fixture = await loadLocalReviewModelRoutingEvaluationFixture(args.fixturePath);
  const summary = evaluateLocalReviewModelRoutingFixture(
    fixture,
    args.sourceFixture ?? path.relative(process.cwd(), args.fixturePath),
  );
  await fs.mkdir(path.dirname(args.outputPath), { recursive: true });
  await fs.writeFile(
    args.outputPath,
    serializeLocalReviewModelRoutingEvaluationSummary(summary),
    "utf8",
  );
  return summary;
}

export function formatLocalReviewModelRoutingEvaluationSummary(
  summary: LocalReviewModelRoutingEvaluationSummary,
): string {
  return [
    "local_review_model_routing_evaluation",
    `id=${summary.evaluationId}`,
    `evidence=${summary.evidenceKind}`,
    `baseline=${summary.baselineCandidateId}`,
    `candidates=${summary.candidates.length}`,
    `eligible=${summary.eligibleCandidateIds.join(",") || "none"}`,
    "default_changed=no",
    `reason=${summary.defaultDecision.reason}`,
  ].join(" ");
}
