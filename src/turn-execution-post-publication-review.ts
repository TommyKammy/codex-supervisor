import type { LocalReviewRepairContext } from "./codex";
import {
  latestReviewThreadCommentFingerprint,
  processedReviewThreadFingerprintKey,
  processedReviewThreadKey,
} from "./review-handling";
import {
  hasCurrentTurnVerifiedNoSourceChangeReviewThreadEvidence,
  nextProcessedReviewThreadPatch,
  nextReviewFollowUpPatch,
  selectVerifiedNoSourceChangeReviewThreads,
} from "./turn-execution-orchestration";
import {
  GitHubPullRequest,
  IssueRunRecord,
  ReviewThread,
  SupervisorConfig,
  TimelineArtifact,
  WorkspaceStatus,
} from "./core/types";
import { upsertTimelineArtifact } from "./timeline-artifacts";
import { conciseCodexVerificationSummary } from "./run-once-turn-verification-evidence";

function sameStringList(left: string[] | null | undefined, right: string[] | null | undefined): boolean {
  const normalizedLeft = left ?? [];
  const normalizedRight = right ?? [];
  return (
    normalizedLeft.length === normalizedRight.length &&
    normalizedLeft.every((target, index) => target === normalizedRight[index])
  );
}

function sameRepairTargets(left: string[] | null | undefined, right: string[] | null | undefined): boolean {
  return sameStringList(left, right);
}

export interface PostPublicationReviewPersistence {
  processedReviewThreadPatch: Pick<
    IssueRunRecord,
    "processed_review_thread_ids" | "processed_review_thread_fingerprints" | "review_loop_retry_state"
  >;
  reviewFollowUpPatch: Pick<IssueRunRecord, "review_follow_up_head_sha" | "review_follow_up_remaining">;
  hasVerifiedNoSourceChangeReviewThreadEvidence: boolean;
  verifiedNoSourceChangeReviewThreads: ReviewThread[];
}

export function buildPostPublicationReviewPersistence(args: {
  config: SupervisorConfig;
  preRunState: IssueRunRecord["state"];
  record: IssueRunRecord;
  currentPr: GitHubPullRequest | null;
  evaluatedReviewHeadSha: string;
  reviewThreadsToProcess: ReviewThread[];
  localReviewRepairContext: LocalReviewRepairContext | null;
  preRunReviewThreads: ReviewThread[];
  postRunReviewThreads: ReviewThread[];
  codexVerificationCommand: string | null;
  workspaceStatus: Pick<WorkspaceStatus, "hasUncommittedChanges" | "headSha">;
  changedFilesAfterPublication: readonly string[];
}): PostPublicationReviewPersistence {
  const verifiedNoSourceChangeReviewThreads =
    args.preRunState === "local_review_fix"
      ? selectVerifiedNoSourceChangeReviewThreads({
          config: args.config,
          localReviewRepairContext: args.localReviewRepairContext,
          reviewThreads: args.reviewThreadsToProcess,
        })
      : [];
  const canPersistVerifiedNoSourceChangeCurrentHead =
    Boolean(args.codexVerificationCommand) &&
    !args.workspaceStatus.hasUncommittedChanges &&
    args.changedFilesAfterPublication.length === 0;
  const processedReviewThreadPatch = nextProcessedReviewThreadPatch({
    config: args.config,
    preRunState: args.preRunState,
    record: args.record,
    currentPr: args.currentPr,
    evaluatedReviewHeadSha: args.evaluatedReviewHeadSha,
    reviewThreadsToProcess: args.reviewThreadsToProcess,
    verifiedNoSourceChangeReviewThreads:
      args.preRunState === "local_review_fix"
        ? verifiedNoSourceChangeReviewThreads
        : undefined,
    persistVerifiedNoSourceChangeCurrentHead: canPersistVerifiedNoSourceChangeCurrentHead,
  });
  const reviewFollowUpPatch = nextReviewFollowUpPatch({
    config: args.config,
    preRunState: args.preRunState,
    record: args.record,
    currentPr: args.currentPr,
    evaluatedReviewHeadSha: args.evaluatedReviewHeadSha,
    preRunReviewThreads: args.preRunReviewThreads,
    postRunReviewThreads: args.postRunReviewThreads,
  });
  const currentPrHeadSha = args.currentPr?.headRefOid ?? null;
  const hasVerifiedNoSourceChangeReviewThreadEvidence =
    hasCurrentTurnVerifiedNoSourceChangeReviewThreadEvidence({
      preRunState: args.preRunState,
      currentPrHeadSha,
      canPersistVerifiedNoSourceChangeCurrentHead,
      verifiedNoSourceChangeReviewThreads,
      processedReviewThreadIds: processedReviewThreadPatch.processed_review_thread_ids,
    });
  return {
    processedReviewThreadPatch,
    reviewFollowUpPatch,
    hasVerifiedNoSourceChangeReviewThreadEvidence,
    verifiedNoSourceChangeReviewThreads,
  };
}

export function buildPostPublicationCodexVerificationTimelineArtifacts(args: {
  record: IssueRunRecord;
  currentPr: GitHubPullRequest | null;
  codexVerificationCommand: string | null;
  workspaceStatus: Pick<WorkspaceStatus, "headSha">;
  structuredSummary: string | null | undefined;
  postRunState: IssueRunRecord["state"];
  hasVerifiedNoSourceChangeReviewThreadEvidence: boolean;
  verifiedNoSourceChangeReviewThreads: ReviewThread[];
}): TimelineArtifact[] | null {
  const currentPrHeadSha = args.currentPr?.headRefOid ?? null;
  const codexTurnVerificationHeadSha =
    args.currentPr &&
    args.codexVerificationCommand &&
    args.workspaceStatus.headSha === args.currentPr.headRefOid &&
    args.postRunState !== "failed" &&
    (args.postRunState !== "blocked" || args.hasVerifiedNoSourceChangeReviewThreadEvidence)
      ? args.currentPr.headRefOid
      : null;
  const codexTurnVerificationRepairTargets = args.hasVerifiedNoSourceChangeReviewThreadEvidence
    ? ["verified_no_source_change_review_thread_residue"]
    : undefined;
  const codexTurnVerificationReviewThreadIds =
    codexTurnVerificationRepairTargets && currentPrHeadSha
      ? args.verifiedNoSourceChangeReviewThreads.map((thread) =>
          processedReviewThreadKey(thread.id, currentPrHeadSha),
        )
      : undefined;
  const codexTurnVerificationReviewThreadFingerprints =
    codexTurnVerificationRepairTargets && currentPrHeadSha
      ? args.verifiedNoSourceChangeReviewThreads.flatMap((thread) => {
          const fingerprint = latestReviewThreadCommentFingerprint(thread);
          return fingerprint
            ? [processedReviewThreadFingerprintKey(thread.id, currentPrHeadSha, fingerprint)]
            : [];
        })
      : undefined;
  const codexTurnVerificationTimelineArtifacts =
    args.currentPr &&
    args.codexVerificationCommand &&
    codexTurnVerificationHeadSha
      ? upsertTimelineArtifact(
          args.record,
          {
            type: "verification_result",
            gate: "codex_turn",
            command: args.codexVerificationCommand,
            head_sha: codexTurnVerificationHeadSha,
            outcome: "passed",
            remediation_target: null,
            next_action: "continue",
            summary: conciseCodexVerificationSummary(args.structuredSummary),
            recorded_at: new Date().toISOString(),
            ...(codexTurnVerificationRepairTargets
              ? {
                  repair_targets: codexTurnVerificationRepairTargets,
                  processed_review_thread_ids: codexTurnVerificationReviewThreadIds ?? [],
                  processed_review_thread_fingerprints: codexTurnVerificationReviewThreadFingerprints ?? [],
                }
              : {}),
          },
          (candidate) =>
            candidate.type === "verification_result" &&
            candidate.gate === "codex_turn" &&
            candidate.outcome === "passed" &&
            candidate.head_sha === codexTurnVerificationHeadSha &&
            candidate.command === args.codexVerificationCommand &&
            sameRepairTargets(candidate.repair_targets, codexTurnVerificationRepairTargets) &&
            sameStringList(candidate.processed_review_thread_ids, codexTurnVerificationReviewThreadIds) &&
            sameStringList(
              candidate.processed_review_thread_fingerprints,
              codexTurnVerificationReviewThreadFingerprints,
            ),
        )
      : null;
  return codexTurnVerificationTimelineArtifacts;
}
