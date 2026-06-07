import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import {
  guardPrLifecycleEvaluation,
  type PrLifecycleEvaluationMode,
} from "./pr-lifecycle-evaluation-mode";
import {
  loadPrLifecycleTraceFixtures,
  parsePrLifecycleTraceFixture,
} from "./pr-lifecycle-trace-fixtures";
import { formatPrLifecycleTraceDiagnostic } from "./pr-lifecycle-trace-presenter";

const expectedFixtureIds = [
  "merge-ready",
  "metadata-only-review-residue",
  "review-blocked",
  "stale-local-state",
  "wait-ci",
];

test("Decision Kernel trace fixtures load from the replay corpus with stable ids", async () => {
  const fixtures = await loadPrLifecycleTraceFixtures(
    path.join(process.cwd(), "replay-corpus", "decision-traces"),
  );

  assert.deepEqual(fixtures.map((fixture) => fixture.id), expectedFixtureIds);
  assert.equal(fixtures.every((fixture) => fixture.intent.length > 0), true);
  assert.equal(fixtures.every((fixture) => fixture.artifact.traceId === fixture.id), true);
});

test("Decision Kernel trace fixtures preserve representative policy and decision outcomes", async () => {
  const fixtures = await loadPrLifecycleTraceFixtures(
    path.join(process.cwd(), "replay-corpus", "decision-traces"),
  );

  assert.deepEqual(
    fixtures.map((fixture) => [
      fixture.id,
      fixture.artifact.policy.posture,
      fixture.artifact.decision.value,
      fixture.artifact.decision.recommendedAction,
    ]),
    [
      ["merge-ready", "merge_ready", "merge", "merge"],
      ["metadata-only-review-residue", "metadata_only_review_residue", "ask_operator", "manual_review"],
      ["review-blocked", "blocked_by_review", "ask_operator", "manual_review"],
      ["stale-local-state", "stale_local_state", "do_nothing", "refresh_state"],
      ["wait-ci", "wait_for_ci", "wait", "wait_ci"],
    ],
  );
});

test("Decision Kernel trace fixtures render compact diagnostics without host-local paths", async () => {
  const fixtures = await loadPrLifecycleTraceFixtures(
    path.join(process.cwd(), "replay-corpus", "decision-traces"),
  );
  const diagnostics = fixtures.map((fixture) => formatPrLifecycleTraceDiagnostic(fixture.artifact));

  assert.equal(diagnostics.every((line) => line.startsWith("pr_lifecycle_trace ")), true);
  assert.match(diagnostics.join("\n"), /label=merge_ready/);
  assert.match(diagnostics.join("\n"), /label=ci_pending/);
  assert.match(diagnostics.join("\n"), /label=review_blocked/);
  assert.match(diagnostics.join("\n"), /label=stale_local_state/);
  assert.match(diagnostics.join("\n"), /label=metadata_only_review_residue/);
  assert.doesNotMatch(diagnostics.join("\n"), /\/Users\//);
  assert.doesNotMatch(diagnostics.join("\n"), /[A-Z]:\\/);
});

test("Decision Kernel trace fixtures remain read-only for action-taking evaluation", async () => {
  const fixtures = await loadPrLifecycleTraceFixtures(
    path.join(process.cwd(), "replay-corpus", "decision-traces"),
  );
  const modeById = new Map<string, PrLifecycleEvaluationMode>([
    ["merge-ready", "action_taking"],
    ["metadata-only-review-residue", "diagnostic_only"],
    ["review-blocked", "diagnostic_only"],
    ["stale-local-state", "action_taking"],
    ["wait-ci", "action_taking"],
  ]);
  const results = fixtures.map((fixture) => [
    fixture.id,
    guardPrLifecycleEvaluation({
      mode: modeById.get(fixture.id) ?? "diagnostic_only",
      normalizedState: fixture.artifact.facts.normalizedState,
    }).decision,
  ]);

  assert.deepEqual(results, [
    ["merge-ready", "allowed"],
    ["metadata-only-review-residue", "allowed"],
    ["review-blocked", "allowed"],
    ["stale-local-state", "blocked"],
    ["wait-ci", "allowed"],
  ]);
});

test("parsePrLifecycleTraceFixture rejects schema drift", () => {
  assert.throws(
    () =>
      parsePrLifecycleTraceFixture({
        id: "bad-schema",
        intent: "prove schema validation fails",
        artifact: {
          schemaVersion: "future-schema",
        },
      }),
    /unsupported schemaVersion future-schema/,
  );
});

test("parsePrLifecycleTraceFixture rejects invalid enum fields", () => {
  assert.throws(
    () =>
      parsePrLifecycleTraceFixture({
        id: "bad-review-posture",
        intent: "prove enum validation fails",
        artifact: {
          schemaVersion: "pr_lifecycle_decision_trace.v1",
          traceId: "bad-review-posture",
          generatedAt: "2026-06-07T00:00:00.000Z",
          facts: {
            source: "fixture",
            observedAt: "2026-06-07T00:00:00.000Z",
            pullRequestNumber: 100,
            headSha: "head",
            normalizedState: {
              source: "fixture",
              observedAt: "2026-06-07T00:00:00.000Z",
              pullRequestNumber: 100,
              headSha: "head",
              headFreshness: "current_head",
              reviewPosture: "review-blocked",
              checkPosture: "green",
              mergeability: "mergeable",
              localStateFreshness: "fresh",
              evidence: {
                manualReviewThreadCount: 0,
                currentHeadConfiguredBotThreadCount: 0,
                stalePreviousHeadConfiguredBotThreadCount: 0,
                metadataOnlyUnresolvedThreadCount: 0,
                passingCheckCount: 1,
                pendingCheckCount: 0,
                failingCheckCount: 0,
                unknownCheckCount: 0,
                trackedHeadSha: "head",
                workspaceHeadSha: "head",
                lastObservedPrHeadSha: "head"
              }
            }
          },
          policy: {
            name: "pr_lifecycle_decision_kernel_v2",
            posture: "merge_ready",
            reasons: []
          },
          decision: {
            value: "merge",
            recommendedAction: "merge",
            summary: "bad enum"
          },
          evidenceTokens: []
        }
      }),
    /artifact\.facts\.normalizedState\.reviewPosture must be one of/,
  );
});

test("parsePrLifecycleTraceFixture rejects top-level fact snapshots that disagree with normalized state", () => {
  assert.throws(
    () =>
      parsePrLifecycleTraceFixture({
        id: "bad-snapshot",
        intent: "prove duplicated snapshot validation fails",
        artifact: {
          schemaVersion: "pr_lifecycle_decision_trace.v1",
          traceId: "bad-snapshot",
          generatedAt: "2026-06-07T00:00:00.000Z",
          facts: {
            source: "fixture",
            observedAt: "2026-06-07T00:00:00.000Z",
            pullRequestNumber: 100,
            headSha: "head-old",
            normalizedState: {
              source: "fixture",
              observedAt: "2026-06-07T00:00:00.000Z",
              pullRequestNumber: 100,
              headSha: "head-current",
              headFreshness: "current_head",
              reviewPosture: "current_head_review_observed",
              checkPosture: "green",
              mergeability: "mergeable",
              localStateFreshness: "fresh",
              evidence: {
                manualReviewThreadCount: 0,
                currentHeadConfiguredBotThreadCount: 0,
                stalePreviousHeadConfiguredBotThreadCount: 0,
                metadataOnlyUnresolvedThreadCount: 0,
                passingCheckCount: 1,
                pendingCheckCount: 0,
                failingCheckCount: 0,
                unknownCheckCount: 0,
                trackedHeadSha: "head-current",
                workspaceHeadSha: "head-current",
                lastObservedPrHeadSha: "head-current"
              }
            }
          },
          policy: {
            name: "pr_lifecycle_decision_kernel_v2",
            posture: "merge_ready",
            reasons: []
          },
          decision: {
            value: "merge",
            recommendedAction: "merge",
            summary: "bad snapshot"
          },
          evidenceTokens: []
        }
      }),
    /artifact\.facts\.headSha must match artifact\.facts\.normalizedState/,
  );
});
