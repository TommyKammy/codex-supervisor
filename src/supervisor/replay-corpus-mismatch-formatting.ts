import type { ReplayCorpusCaseResult, ReplayCorpusRunResult } from "./replay-corpus-model";
import { formatReplayCorpusCompactOutcome } from "./replay-corpus-outcome";

export function formatReplayCorpusOutcomeMismatch(result: ReplayCorpusCaseResult): string {
  return [
    `Replay corpus mismatch for case "${result.caseId}" (issue #${result.issueNumber})`,
    `  expected.nextState=${result.expected.nextState ?? "none"}`,
    `  actual.nextState=${result.actual.nextState ?? "none"}`,
    `  expected.shouldRunCodex=${String(result.expected.shouldRunCodex)}`,
    `  actual.shouldRunCodex=${String(result.actual.shouldRunCodex)}`,
    `  expected.blockedReason=${result.expected.blockedReason ?? "none"}`,
    `  actual.blockedReason=${result.actual.blockedReason ?? "none"}`,
    `  expected.failureSignature=${result.expected.failureSignature ?? "none"}`,
    `  actual.failureSignature=${result.actual.failureSignature ?? "none"}`,
  ].join("\n");
}

export function formatReplayCorpusMismatchSummaryLine(result: ReplayCorpusCaseResult): string {
  return `Mismatch: ${result.caseId} (issue #${result.issueNumber}) expected(${formatReplayCorpusCompactOutcome(result.expected)}) actual(${formatReplayCorpusCompactOutcome(result.actual)})`;
}

export function formatReplayCorpusRunSummary(result: ReplayCorpusRunResult): string {
  const passedCount = result.totalCases - result.mismatchCount;
  const lines = [`Replay corpus summary: total=${result.totalCases} passed=${passedCount} failed=${result.mismatchCount}`];
  for (const entry of result.results) {
    if (!entry.matchesExpected) {
      lines.push(formatReplayCorpusMismatchSummaryLine(entry));
    }
  }

  return lines.join("\n");
}
