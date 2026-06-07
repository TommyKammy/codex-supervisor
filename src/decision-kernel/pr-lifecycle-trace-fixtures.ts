import fs from "node:fs/promises";
import path from "node:path";
import {
  PR_LIFECYCLE_DECISION_TRACE_SCHEMA_VERSION,
  type PrLifecycleDecision,
  type PrLifecycleDecisionTraceArtifact,
  type PrLifecyclePolicyPosture,
  type PrLifecycleRecommendedAction,
} from "./pr-lifecycle-trace";
import type {
  PrLifecycleCheckPosture,
  PrLifecycleFactSource,
  PrLifecycleHeadFreshness,
  PrLifecycleLocalStateFreshness,
  PrLifecycleMergeabilityPosture,
  PrLifecycleReviewPosture,
} from "./pr-lifecycle-state";

export interface PrLifecycleTraceFixture {
  id: string;
  intent: string;
  artifact: PrLifecycleDecisionTraceArtifact;
}

export async function loadPrLifecycleTraceFixtures(
  rootPath: string,
): Promise<PrLifecycleTraceFixture[]> {
  const entries = await fs.readdir(rootPath, { withFileTypes: true });
  const files = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
    .map((entry) => entry.name)
    .sort();

  const fixtures: PrLifecycleTraceFixture[] = [];
  for (const file of files) {
    const fixturePath = path.join(rootPath, file);
    const parsed = JSON.parse(await fs.readFile(fixturePath, "utf8")) as unknown;
    fixtures.push(parsePrLifecycleTraceFixture(parsed, fixturePath));
  }

  return fixtures;
}

export function parsePrLifecycleTraceFixture(
  value: unknown,
  source = "inline",
): PrLifecycleTraceFixture {
  if (!isRecord(value)) {
    throw new Error(`Invalid PR lifecycle trace fixture at ${source}: expected object.`);
  }

  const id = requiredString(value.id, source, "id");
  const intent = requiredString(value.intent, source, "intent");
  const artifact = parsePrLifecycleDecisionTraceArtifact(value.artifact, source);
  if (artifact.traceId !== id) {
    throw new Error(`Invalid PR lifecycle trace fixture at ${source}: id must match artifact.traceId.`);
  }

  return { id, intent, artifact };
}

function parsePrLifecycleDecisionTraceArtifact(
  value: unknown,
  source: string,
): PrLifecycleDecisionTraceArtifact {
  if (!isRecord(value)) {
    throw new Error(`Invalid PR lifecycle trace artifact at ${source}: expected artifact object.`);
  }

  const schemaVersion = requiredString(value.schemaVersion, source, "artifact.schemaVersion");
  if (schemaVersion !== PR_LIFECYCLE_DECISION_TRACE_SCHEMA_VERSION) {
    throw new Error(
      `Invalid PR lifecycle trace artifact at ${source}: unsupported schemaVersion ${schemaVersion}.`,
    );
  }

  const traceId = requiredString(value.traceId, source, "artifact.traceId");
  const generatedAt = requiredString(value.generatedAt, source, "artifact.generatedAt");
  const facts = requiredRecord(value.facts, source, "artifact.facts");
  const normalizedState = requiredRecord(facts.normalizedState, source, "artifact.facts.normalizedState");
  const evidence = requiredRecord(
    normalizedState.evidence,
    source,
    "artifact.facts.normalizedState.evidence",
  );
  const policy = requiredRecord(value.policy, source, "artifact.policy");
  const decision = requiredRecord(value.decision, source, "artifact.decision");
  const evidenceTokens = requiredStringArray(value.evidenceTokens, source, "artifact.evidenceTokens");
  const factsSource = requiredEnum(
    facts.source,
    source,
    "artifact.facts.source",
    prLifecycleFactSources,
  );
  const factsObservedAt = nullableString(facts.observedAt, source, "artifact.facts.observedAt");
  const factsPullRequestNumber = nullableNumber(facts.pullRequestNumber, source, "artifact.facts.pullRequestNumber");
  const factsHeadSha = nullableString(facts.headSha, source, "artifact.facts.headSha");
  const normalizedSource = requiredEnum(
    normalizedState.source,
    source,
    "artifact.facts.normalizedState.source",
    prLifecycleFactSources,
  );
  const normalizedObservedAt = nullableString(
    normalizedState.observedAt,
    source,
    "artifact.facts.normalizedState.observedAt",
  );
  const normalizedPullRequestNumber = nullableNumber(
    normalizedState.pullRequestNumber,
    source,
    "artifact.facts.normalizedState.pullRequestNumber",
  );
  const normalizedHeadSha = nullableString(normalizedState.headSha, source, "artifact.facts.normalizedState.headSha");

  assertEqualFixtureField(factsSource, normalizedSource, source, "artifact.facts.source");
  assertEqualFixtureField(factsObservedAt, normalizedObservedAt, source, "artifact.facts.observedAt");
  assertEqualFixtureField(
    factsPullRequestNumber,
    normalizedPullRequestNumber,
    source,
    "artifact.facts.pullRequestNumber",
  );
  assertEqualFixtureField(factsHeadSha, normalizedHeadSha, source, "artifact.facts.headSha");

  return {
    schemaVersion: PR_LIFECYCLE_DECISION_TRACE_SCHEMA_VERSION,
    traceId,
    generatedAt,
    facts: {
      source: factsSource,
      observedAt: factsObservedAt,
      pullRequestNumber: factsPullRequestNumber,
      headSha: factsHeadSha,
      normalizedState: {
        source: normalizedSource,
        observedAt: normalizedObservedAt,
        pullRequestNumber: normalizedPullRequestNumber,
        headSha: normalizedHeadSha,
        headFreshness: requiredEnum(
          normalizedState.headFreshness,
          source,
          "artifact.facts.normalizedState.headFreshness",
          prLifecycleHeadFreshnessValues,
        ),
        reviewPosture: requiredEnum(
          normalizedState.reviewPosture,
          source,
          "artifact.facts.normalizedState.reviewPosture",
          prLifecycleReviewPostures,
        ),
        checkPosture: requiredEnum(
          normalizedState.checkPosture,
          source,
          "artifact.facts.normalizedState.checkPosture",
          prLifecycleCheckPostures,
        ),
        mergeability: requiredEnum(
          normalizedState.mergeability,
          source,
          "artifact.facts.normalizedState.mergeability",
          prLifecycleMergeabilityPostures,
        ),
        localStateFreshness: requiredEnum(
          normalizedState.localStateFreshness,
          source,
          "artifact.facts.normalizedState.localStateFreshness",
          prLifecycleLocalStateFreshnessValues,
        ),
        evidence: {
          manualReviewThreadCount: requiredNumber(
            evidence.manualReviewThreadCount,
            source,
            "artifact.facts.normalizedState.evidence.manualReviewThreadCount",
          ),
          currentHeadConfiguredBotThreadCount: requiredNumber(
            evidence.currentHeadConfiguredBotThreadCount,
            source,
            "artifact.facts.normalizedState.evidence.currentHeadConfiguredBotThreadCount",
          ),
          stalePreviousHeadConfiguredBotThreadCount: requiredNumber(
            evidence.stalePreviousHeadConfiguredBotThreadCount,
            source,
            "artifact.facts.normalizedState.evidence.stalePreviousHeadConfiguredBotThreadCount",
          ),
          metadataOnlyUnresolvedThreadCount: requiredNumber(
            evidence.metadataOnlyUnresolvedThreadCount,
            source,
            "artifact.facts.normalizedState.evidence.metadataOnlyUnresolvedThreadCount",
          ),
          passingCheckCount: requiredNumber(
            evidence.passingCheckCount,
            source,
            "artifact.facts.normalizedState.evidence.passingCheckCount",
          ),
          pendingCheckCount: requiredNumber(
            evidence.pendingCheckCount,
            source,
            "artifact.facts.normalizedState.evidence.pendingCheckCount",
          ),
          failingCheckCount: requiredNumber(
            evidence.failingCheckCount,
            source,
            "artifact.facts.normalizedState.evidence.failingCheckCount",
          ),
          unknownCheckCount: requiredNumber(
            evidence.unknownCheckCount,
            source,
            "artifact.facts.normalizedState.evidence.unknownCheckCount",
          ),
          trackedHeadSha: nullableString(evidence.trackedHeadSha, source, "artifact.facts.normalizedState.evidence.trackedHeadSha"),
          workspaceHeadSha: nullableString(evidence.workspaceHeadSha, source, "artifact.facts.normalizedState.evidence.workspaceHeadSha"),
          lastObservedPrHeadSha: nullableString(
            evidence.lastObservedPrHeadSha,
            source,
            "artifact.facts.normalizedState.evidence.lastObservedPrHeadSha",
          ),
        },
      },
    },
    policy: {
      name: requiredString(policy.name, source, "artifact.policy.name") as PrLifecycleDecisionTraceArtifact["policy"]["name"],
      posture: requiredEnum(policy.posture, source, "artifact.policy.posture", prLifecyclePolicyPostures),
      reasons: requiredStringArray(policy.reasons, source, "artifact.policy.reasons"),
    },
    decision: {
      value: requiredEnum(decision.value, source, "artifact.decision.value", prLifecycleDecisions),
      recommendedAction: requiredEnum(
        decision.recommendedAction,
        source,
        "artifact.decision.recommendedAction",
        prLifecycleRecommendedActions,
      ),
      summary: requiredString(decision.summary, source, "artifact.decision.summary"),
    },
    evidenceTokens,
  };
}

const prLifecycleFactSources = ["fresh_github", "cached_github", "local_state", "fixture"] as const satisfies readonly PrLifecycleFactSource[];
const prLifecycleHeadFreshnessValues = ["no_pull_request", "current_head", "stale_head", "unknown"] as const satisfies readonly PrLifecycleHeadFreshness[];
const prLifecycleReviewPostures = [
  "current_head_review_observed",
  "missing_current_head_review",
  "review_blocked",
  "stale_previous_head_review",
  "metadata_only_unresolved",
  "no_unresolved_review",
  "unknown",
] as const satisfies readonly PrLifecycleReviewPosture[];
const prLifecycleCheckPostures = ["green", "pending", "failing", "unknown"] as const satisfies readonly PrLifecycleCheckPosture[];
const prLifecycleMergeabilityPostures = ["mergeable", "conflicted", "draft", "closed", "unknown"] as const satisfies readonly PrLifecycleMergeabilityPosture[];
const prLifecycleLocalStateFreshnessValues = ["fresh", "stale", "missing", "unknown"] as const satisfies readonly PrLifecycleLocalStateFreshness[];
const prLifecyclePolicyPostures = [
  "merge_ready",
  "wait_for_ci",
  "request_current_head_review",
  "repair_current_head_review",
  "blocked_by_review",
  "blocked_by_conflict",
  "stale_local_state",
  "metadata_only_review_residue",
  "no_pull_request",
  "unknown",
] as const satisfies readonly PrLifecyclePolicyPosture[];
const prLifecycleDecisions = ["merge", "wait", "request_review", "run_codex", "ask_operator", "do_nothing"] as const satisfies readonly PrLifecycleDecision[];
const prLifecycleRecommendedActions = ["merge", "wait_ci", "request_review", "repair", "manual_review", "refresh_state", "no_action"] as const satisfies readonly PrLifecycleRecommendedAction[];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requiredRecord(value: unknown, source: string, field: string): Record<string, unknown> {
  if (!isRecord(value)) {
    throw new Error(`Invalid PR lifecycle trace fixture at ${source}: ${field} must be an object.`);
  }
  return value;
}

function requiredString(value: unknown, source: string, field: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`Invalid PR lifecycle trace fixture at ${source}: ${field} must be a string.`);
  }
  return value;
}

function requiredEnum<const T extends readonly string[]>(
  value: unknown,
  source: string,
  field: string,
  allowed: T,
): T[number] {
  const candidate = requiredString(value, source, field);
  if (!allowed.includes(candidate)) {
    throw new Error(
      `Invalid PR lifecycle trace fixture at ${source}: ${field} must be one of ${allowed.join(", ")}.`,
    );
  }
  return candidate;
}

function nullableString(value: unknown, source: string, field: string): string | null {
  if (value === null) {
    return null;
  }
  return requiredString(value, source, field);
}

function requiredNumber(value: unknown, source: string, field: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`Invalid PR lifecycle trace fixture at ${source}: ${field} must be a number.`);
  }
  return value;
}

function nullableNumber(value: unknown, source: string, field: string): number | null {
  if (value === null) {
    return null;
  }
  return requiredNumber(value, source, field);
}

function requiredStringArray(value: unknown, source: string, field: string): string[] {
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string")) {
    throw new Error(`Invalid PR lifecycle trace fixture at ${source}: ${field} must be a string array.`);
  }
  return [...value];
}

function assertEqualFixtureField(
  actual: string | number | null,
  expected: string | number | null,
  source: string,
  field: string,
): void {
  if (actual !== expected) {
    throw new Error(
      `Invalid PR lifecycle trace fixture at ${source}: ${field} must match artifact.facts.normalizedState.`,
    );
  }
}
