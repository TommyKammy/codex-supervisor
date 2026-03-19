import assert from "node:assert/strict";
import test from "node:test";
import type { ReplayCorpusCaseResult, ReplayCorpusRunResult } from "./replay-corpus-model";
import {
  formatReplayCorpusMismatchSummaryLine,
  formatReplayCorpusOutcomeMismatch,
  formatReplayCorpusRunSummary,
} from "./replay-corpus-mismatch-formatting";

function createMismatchResult(): ReplayCorpusCaseResult {
  return {
    caseId: "review-blocked",
    issueNumber: 532,
    bundlePath: "/tmp/replay-corpus/cases/review-blocked",
    expected: {
      nextState: "ready_to_merge",
      shouldRunCodex: true,
      blockedReason: null,
      failureSignature: null,
    },
    actual: {
      nextState: "blocked",
      shouldRunCodex: false,
      blockedReason: "manual_review",
      failureSignature: "stalled-bot:thread-1",
    },
    matchesExpected: false,
  };
}

test("mismatch formatting helpers render deterministic detail and compact summary output", () => {
  const result = createMismatchResult();

  assert.equal(
    formatReplayCorpusOutcomeMismatch(result),
    [
      'Replay corpus mismatch for case "review-blocked" (issue #532)',
      "  expected.nextState=ready_to_merge",
      "  actual.nextState=blocked",
      "  expected.shouldRunCodex=true",
      "  actual.shouldRunCodex=false",
      "  expected.blockedReason=none",
      "  actual.blockedReason=manual_review",
      "  expected.failureSignature=none",
      "  actual.failureSignature=stalled-bot:thread-1",
    ].join("\n"),
  );

  assert.equal(
    formatReplayCorpusMismatchSummaryLine(result),
    "Mismatch: review-blocked (issue #532) expected(nextState=ready_to_merge, shouldRunCodex=true, blockedReason=none, failureSignature=none) actual(nextState=blocked, shouldRunCodex=false, blockedReason=manual_review, failureSignature=stalled-bot:thread-1)",
  );
});

test("run summary formatting reports pass and fail counts compactly", () => {
  const mismatch = createMismatchResult();
  const pass = {
    caseId: "all-pass",
    issueNumber: 540,
    bundlePath: "/tmp/replay-corpus/cases/all-pass",
    expected: {
      nextState: "planning",
      shouldRunCodex: false,
      blockedReason: null,
      failureSignature: null,
    },
    actual: {
      nextState: "planning",
      shouldRunCodex: false,
      blockedReason: null,
      failureSignature: null,
    },
    matchesExpected: true,
  } satisfies ReplayCorpusCaseResult;

  const result: ReplayCorpusRunResult = {
    rootPath: "/tmp/replay-corpus",
    manifestPath: "/tmp/replay-corpus/manifest.json",
    totalCases: 2,
    mismatchCount: 1,
    results: [pass, mismatch],
  };

  assert.equal(
    formatReplayCorpusRunSummary(result),
    [
      "Replay corpus summary: total=2 passed=1 failed=1",
      "Mismatch: review-blocked (issue #532) expected(nextState=ready_to_merge, shouldRunCodex=true, blockedReason=none, failureSignature=none) actual(nextState=blocked, shouldRunCodex=false, blockedReason=manual_review, failureSignature=stalled-bot:thread-1)",
    ].join("\n"),
  );
});
