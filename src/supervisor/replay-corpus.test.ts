import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import {
  createCheckedInReplayCorpusConfig as createCheckedInReplayCorpusConfigFacade,
  deriveReplayCorpusPromotionWorthinessHints as deriveReplayCorpusPromotionWorthinessHintsFacade,
  formatReplayCorpusMismatchDetailsArtifact as formatReplayCorpusMismatchDetailsArtifactFacade,
  formatReplayCorpusMismatchSummaryLine as formatReplayCorpusMismatchSummaryLineFacade,
  formatReplayCorpusOutcomeMismatch as formatReplayCorpusOutcomeMismatchFacade,
  formatReplayCorpusRunSummary as formatReplayCorpusRunSummaryFacade,
  loadReplayCorpus as loadReplayCorpusFacade,
  promoteCapturedReplaySnapshot as promoteCapturedReplaySnapshotFacade,
  runReplayCorpus as runReplayCorpusFacade,
  suggestReplayCorpusCaseIds as suggestReplayCorpusCaseIdsFacade,
  summarizeReplayCorpusPromotion as summarizeReplayCorpusPromotionFacade,
  syncReplayCorpusMismatchDetailsArtifact as syncReplayCorpusMismatchDetailsArtifactFacade,
} from "./replay-corpus";
import { createCheckedInReplayCorpusConfig } from "./replay-corpus-config";
import {
  formatReplayCorpusMismatchDetailsArtifact,
  syncReplayCorpusMismatchDetailsArtifact,
} from "./replay-corpus-mismatch-artifact";
import {
  formatReplayCorpusMismatchSummaryLine,
  formatReplayCorpusOutcomeMismatch,
  formatReplayCorpusRunSummary,
} from "./replay-corpus-mismatch-formatting";
import { promoteCapturedReplaySnapshot } from "./replay-corpus-promotion";
import { suggestReplayCorpusCaseIds } from "./replay-corpus-promotion-case-id";
import {
  deriveReplayCorpusPromotionWorthinessHints,
  summarizeReplayCorpusPromotion,
} from "./replay-corpus-promotion-summary";
import { createConnectorReviewPolicyReplayFixtures } from "./replay-corpus-policy-fixtures";
import { loadReplayCorpus, runReplayCorpus } from "./replay-corpus-runner";

test("replay-corpus facade re-exports the dedicated module entry points", () => {
  assert.equal(createCheckedInReplayCorpusConfigFacade, createCheckedInReplayCorpusConfig);
  assert.equal(loadReplayCorpusFacade, loadReplayCorpus);
  assert.equal(runReplayCorpusFacade, runReplayCorpus);
  assert.equal(formatReplayCorpusMismatchDetailsArtifactFacade, formatReplayCorpusMismatchDetailsArtifact);
  assert.equal(syncReplayCorpusMismatchDetailsArtifactFacade, syncReplayCorpusMismatchDetailsArtifact);
  assert.equal(formatReplayCorpusMismatchSummaryLineFacade, formatReplayCorpusMismatchSummaryLine);
  assert.equal(formatReplayCorpusOutcomeMismatchFacade, formatReplayCorpusOutcomeMismatch);
  assert.equal(formatReplayCorpusRunSummaryFacade, formatReplayCorpusRunSummary);
  assert.equal(suggestReplayCorpusCaseIdsFacade, suggestReplayCorpusCaseIds);
  assert.equal(promoteCapturedReplaySnapshotFacade, promoteCapturedReplaySnapshot);
  assert.equal(deriveReplayCorpusPromotionWorthinessHintsFacade, deriveReplayCorpusPromotionWorthinessHints);
  assert.equal(summarizeReplayCorpusPromotionFacade, summarizeReplayCorpusPromotion);
});

test("Phase 0 replay fixtures are checked into the corpus with stable terminal outcomes", async () => {
  const corpusRoot = path.join(process.cwd(), "replay-corpus");
  const phase0CaseIds = [
    "phase0-aegisops-repeated-codex-feedback-terminal",
    "phase0-hrcore-current-head-repair-metadata-residue",
  ];
  const corpus = await loadReplayCorpus(corpusRoot);
  const phase0Cases = corpus.cases.filter((entry) => phase0CaseIds.includes(entry.id));

  assert.deepEqual(phase0Cases.map((entry) => entry.id), phase0CaseIds);
  assert.deepEqual(
    phase0Cases.map((entry) => entry.expected),
    [
      {
        nextState: "blocked",
        shouldRunCodex: false,
        blockedReason: "stale_review_bot",
        failureSignature: "stalled-bot:thread-production-source-denylist",
      },
      {
        nextState: "ready_to_merge",
        shouldRunCodex: false,
        blockedReason: null,
        failureSignature: null,
      },
    ],
  );

  const result = await runReplayCorpus(corpusRoot, createCheckedInReplayCorpusConfig(process.cwd()));
  const phase0Results = result.results.filter((entry) => phase0CaseIds.includes(entry.caseId));

  assert.deepEqual(phase0Results.map((entry) => entry.caseId), phase0CaseIds);
  assert.equal(phase0Results.every((entry) => entry.matchesExpected), true);
});

test("Phase 2 Connector review policy replay fixtures cover typed boundary outcomes", () => {
  const fixtures = createConnectorReviewPolicyReplayFixtures();

  assert.deepEqual(
    fixtures.map((fixture) => fixture.id),
    [
      "phase2-aegisops-current-head-must-fix",
      "phase2-hrcore-softened-p3-advisory",
      "phase2-aegisops-stale-commit-waits",
      "phase2-hrcore-metadata-residue",
    ],
  );
  assert.deepEqual(new Set(fixtures.map((fixture) => fixture.projectShape)), new Set(["aegisops", "hrcore"]));

  const outcomes = fixtures.flatMap((fixture) =>
    fixture.expectedThreadOutcomes.map((outcome) => [outcome.boundaryOutcome, outcome.nextAction]),
  );
  assert.deepEqual(new Set(outcomes.map(([outcome]) => outcome)), new Set([
    "must_fix_current_head",
    "escalated_p3",
    "softened_p3_advisory",
    "stale_commit_thread",
    "metadata_only_unresolved",
    "manual_thread",
    "configured_bot_thread",
  ]));
  assert.deepEqual(new Set(outcomes.map(([, nextAction]) => nextAction)), new Set([
    "fix",
    "wait",
    "manual",
    "metadata_cleanup",
    "advisory_only",
  ]));

  const softenedP3 = fixtures.find((fixture) => fixture.id === "phase2-hrcore-softened-p3-advisory");
  assert.deepEqual(softenedP3?.expectedThreadOutcomes, [
    {
      threadId: "softened-p3",
      boundaryOutcome: "softened_p3_advisory",
      nextAction: "advisory_only",
    },
  ]);
  const repeatStopFixture = fixtures.find((fixture) => fixture.id === "phase2-hrcore-metadata-residue");
  assert.equal(repeatStopFixture?.repeatStopSuppressedReason, "repeat_stop_exhausted");
});

test("Phase 5 external orchestration fixtures keep complex project handoffs bounded", () => {
  const fixtures = [
    {
      id: "phase5-aegisops-external-handoff-review-ci-merge",
      projectShape: "aegisops",
      externalHandoff: {
        routingCategory: "external_orchestration_handoff",
        mutationAuthority: "none",
        handoff: "prepare_evidence",
      },
      coreSafetyGates: ["fresh_pr_facts", "current_head_review", "green_checks", "mergeable_state"],
      boundedNextAction: "ask_operator",
    },
    {
      id: "phase5-hrcore-external-handoff-metadata-residue",
      projectShape: "hrcore",
      externalHandoff: {
        routingCategory: "external_orchestration_handoff",
        mutationAuthority: "none",
        handoff: "prepare_evidence",
      },
      coreSafetyGates: ["fresh_pr_facts", "current_head_review", "resolved_metadata_residue"],
      boundedNextAction: "ask_operator",
    },
  ];

  assert.deepEqual(new Set(fixtures.map((fixture) => fixture.projectShape)), new Set(["aegisops", "hrcore"]));
  assert.equal(fixtures.every((fixture) => fixture.externalHandoff.mutationAuthority === "none"), true);
  assert.equal(fixtures.every((fixture) => fixture.externalHandoff.handoff === "prepare_evidence"), true);
  assert.deepEqual(new Set(fixtures.map((fixture) => fixture.boundedNextAction)), new Set(["ask_operator"]));
  assert.equal(
    fixtures.every((fixture) => fixture.coreSafetyGates.length > 0 && fixture.coreSafetyGates.includes("fresh_pr_facts")),
    true,
  );
});
