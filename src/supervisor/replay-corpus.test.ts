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
