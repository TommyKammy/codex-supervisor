import { formatReplayCorpusCompactOutcome } from "./replay-corpus-outcome";
import type {
  ReplayCorpusCaseBundle,
  ReplayCorpusInputSnapshot,
  ReplayCorpusPromotionHint,
  ReplayCorpusPromotionSummary,
} from "./replay-corpus-model";

function formatPromotionNoteValue(value: string | boolean | null): string {
  return value === null ? "none" : String(value);
}

export function summarizeReplayCorpusPromotion(
  sourceSnapshot: ReplayCorpusInputSnapshot,
  promotedCase: ReplayCorpusCaseBundle,
): ReplayCorpusPromotionSummary {
  const normalizationNotes: string[] = [];
  const normalizedSnapshot = promotedCase.input.snapshot;

  if (sourceSnapshot.local.record.workspace !== normalizedSnapshot.local.record.workspace) {
    normalizationNotes.push(`workspace=>${formatPromotionNoteValue(normalizedSnapshot.local.record.workspace)}`);
  }
  if (sourceSnapshot.local.record.journal_path !== normalizedSnapshot.local.record.journal_path) {
    normalizationNotes.push(`journal_path=>${formatPromotionNoteValue(normalizedSnapshot.local.record.journal_path)}`);
  }
  if (sourceSnapshot.local.record.local_review_summary_path !== normalizedSnapshot.local.record.local_review_summary_path) {
    normalizationNotes.push(
      `local_review_summary_path=>${formatPromotionNoteValue(normalizedSnapshot.local.record.local_review_summary_path)}`,
    );
  }
  if (sourceSnapshot.local.workspaceStatus.hasUncommittedChanges !== normalizedSnapshot.local.workspaceStatus.hasUncommittedChanges) {
    normalizationNotes.push(
      `hasUncommittedChanges=>${formatPromotionNoteValue(normalizedSnapshot.local.workspaceStatus.hasUncommittedChanges)}`,
    );
  }

  return {
    casePath: promotedCase.bundlePath,
    expectedOutcome: formatReplayCorpusCompactOutcome(promotedCase.expected),
    normalizationNotes,
    promotionHints: deriveReplayCorpusPromotionWorthinessHints(normalizedSnapshot),
  };
}

export function deriveReplayCorpusPromotionWorthinessHints(
  snapshot: ReplayCorpusInputSnapshot,
): ReplayCorpusPromotionHint[] {
  const hints: ReplayCorpusPromotionHint[] = [];
  const pullRequest = snapshot.github.pullRequest;
  const record = snapshot.local.record;
  const workspaceStatus = snapshot.local.workspaceStatus;

  if (
    pullRequest &&
    snapshot.decision.nextState === "stabilizing" &&
    snapshot.decision.shouldRunCodex &&
    typeof record.last_head_sha === "string" &&
    record.last_head_sha.length > 0 &&
    pullRequest.headRefOid === workspaceStatus.headSha &&
    record.last_head_sha !== pullRequest.headRefOid
  ) {
    hints.push({
      id: "stale-head-safety",
      summary: "tracked head differs from the current PR head",
    });
  }

  if (
    pullRequest &&
    snapshot.decision.nextState === "waiting_ci" &&
    snapshot.decision.shouldRunCodex === false &&
    record.review_wait_started_at === null &&
    pullRequest.currentHeadCiGreenAt !== undefined &&
    pullRequest.currentHeadCiGreenAt !== null &&
    snapshot.github.checks.length > 0 &&
    snapshot.github.checks.every((check) => check.bucket === "pass") &&
    (pullRequest.configuredBotCurrentHeadObservedAt !== null ||
      pullRequest.copilotReviewState !== undefined)
  ) {
    hints.push({
      id: "provider-wait",
      summary: "checks are green but provider timing still keeps the PR waiting",
    });
  }

  const retrySignals: string[] = [];
  if ((record.timeout_retry_count ?? 0) > 0) {
    retrySignals.push(`timeout_retry_count=${record.timeout_retry_count}`);
  }
  if ((record.blocked_verification_retry_count ?? 0) > 0) {
    retrySignals.push(`blocked_verification_retry_count=${record.blocked_verification_retry_count}`);
  }
  if ((record.repeated_failure_signature_count ?? 0) > 0) {
    retrySignals.push(`repeated_failure_signature_count=${record.repeated_failure_signature_count}`);
  }
  if (retrySignals.length > 0) {
    hints.push({
      id: "retry-escalation",
      summary: `retry pressure is already visible via ${retrySignals.join(", ")}`,
    });
  }

  return hints;
}
