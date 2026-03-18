import type {
  ReplayCorpusExpectedReplayResult,
  ReplayCorpusNormalizedOutcome,
} from "./replay-corpus-model";
import { replaySupervisorCycleDecisionSnapshot } from "./supervisor-cycle-replay";

export function normalizeExpectedReplayResult(expected: ReplayCorpusExpectedReplayResult): ReplayCorpusNormalizedOutcome {
  return {
    nextState: expected.nextState,
    shouldRunCodex: expected.shouldRunCodex,
    blockedReason: expected.blockedReason,
    failureSignature: expected.failureSignature,
  };
}

export function normalizeReplayResult(
  replayResult: ReturnType<typeof replaySupervisorCycleDecisionSnapshot>,
): ReplayCorpusNormalizedOutcome {
  return {
    nextState: replayResult.replayedDecision.nextState,
    shouldRunCodex: replayResult.replayedDecision.shouldRunCodex,
    blockedReason: replayResult.replayedDecision.blockedReason,
    failureSignature: replayResult.replayedDecision.failureContext?.signature ?? null,
  };
}

function formatOutcomeValue(value: string | boolean | null): string {
  if (value === null) {
    return "none";
  }

  return String(value);
}

export function formatReplayCorpusCompactOutcome(outcome: ReplayCorpusNormalizedOutcome): string {
  return [
    `nextState=${formatOutcomeValue(outcome.nextState)}`,
    `shouldRunCodex=${formatOutcomeValue(outcome.shouldRunCodex)}`,
    `blockedReason=${formatOutcomeValue(outcome.blockedReason)}`,
    `failureSignature=${formatOutcomeValue(outcome.failureSignature)}`,
  ].join(", ");
}
