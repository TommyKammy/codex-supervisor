import assert from "node:assert/strict";
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
