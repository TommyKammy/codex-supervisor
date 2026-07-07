import type { GitHubPullRequest, IssueRunRecord, ReviewThread, TimelineArtifact } from "./core/types";
import { VERIFIED_CURRENT_HEAD_REPAIR_REVIEW_THREAD_RESIDUE_TARGET } from "./current-head-codex-repair-proof";
import {
  codexConnectorMustFixReviewThreads,
  latestCodexConnectorPSeverity,
  latestCodexConnectorReviewComment,
  latestCodexConnectorReviewCommentFingerprint,
  latestCodexConnectorReviewCommentNode,
} from "./codex-connector-review-policy";
import { timelineArtifactCoversReviewThread } from "./codex-connector-review-repair-coverage";
import { latestReviewThreadCommentFingerprint } from "./review-handling";

export const STILL_VALID_REVIEW_THREAD_REPAIR_TARGET =
  "still_valid_review_thread_repair";
const VERIFIED_NO_SOURCE_CHANGE_REVIEW_THREAD_RESIDUE_TARGET =
  "verified_no_source_change_review_thread_residue";

export interface CodexConnectorValidReviewRepairTarget {
  threadId: string;
  path: string;
  line: string;
  severity: string;
  url: string | null;
  summary: string;
  evidenceSummary: string;
}

function isCurrentHeadCodexTurnArtifact(args: {
  artifact: TimelineArtifact;
  pr: Pick<GitHubPullRequest, "headRefOid">;
  thread: ReviewThread;
}): boolean {
  return (
    args.artifact.type === "verification_result" &&
    args.artifact.gate === "codex_turn" &&
    args.artifact.head_sha === args.pr.headRefOid &&
    timelineArtifactCoversReviewThread({
      ...args,
      acceptedFingerprints: [
        latestCodexConnectorReviewCommentFingerprint(args.thread),
        latestReviewThreadCommentFingerprint(args.thread),
      ].filter((fingerprint): fingerprint is string => Boolean(fingerprint)).map((fingerprint) => ({ fingerprint })),
      allowHeadScopedIdWhenFingerprintsExist: true,
    })
  );
}

function isStillValidRepairProbeFailure(args: {
  artifact: TimelineArtifact;
  pr: Pick<GitHubPullRequest, "headRefOid">;
  thread: ReviewThread;
}): boolean {
  return (
    isCurrentHeadCodexTurnArtifact(args) &&
    args.artifact.outcome === "failed" &&
    args.artifact.repair_targets?.includes(STILL_VALID_REVIEW_THREAD_REPAIR_TARGET) === true
  );
}

function isLaterConvergedRepairProof(args: {
  artifact: TimelineArtifact;
  pr: Pick<GitHubPullRequest, "headRefOid">;
  thread: ReviewThread;
}): boolean {
  return (
    isCurrentHeadCodexTurnArtifact(args) &&
    args.artifact.outcome === "passed" &&
    (
      (args.artifact.repair_targets?.length ?? 0) === 0 ||
      args.artifact.repair_targets?.includes(VERIFIED_CURRENT_HEAD_REPAIR_REVIEW_THREAD_RESIDUE_TARGET) === true ||
      args.artifact.repair_targets?.includes(VERIFIED_NO_SOURCE_CHANGE_REVIEW_THREAD_RESIDUE_TARGET) === true
    )
  );
}

export function failedStillValidReviewThreadProbeArtifact(args: {
  record: Pick<IssueRunRecord, "timeline_artifacts">;
  pr: Pick<GitHubPullRequest, "headRefOid">;
  thread: ReviewThread;
}): TimelineArtifact | null {
  for (const artifact of [...(args.record.timeline_artifacts ?? [])].reverse()) {
    if (isLaterConvergedRepairProof({ artifact, pr: args.pr, thread: args.thread })) {
      return null;
    }
    if (isStillValidRepairProbeFailure({ artifact, pr: args.pr, thread: args.thread })) {
      return artifact;
    }
  }
  return null;
}

export function codexConnectorStillValidReviewRepairThreads(args: {
  record: Pick<IssueRunRecord, "timeline_artifacts">;
  pr: Pick<GitHubPullRequest, "headRefOid">;
  reviewThreads: ReviewThread[];
}): ReviewThread[] {
  return codexConnectorMustFixReviewThreads(args.reviewThreads).filter((thread) =>
    failedStillValidReviewThreadProbeArtifact({
      record: args.record,
      pr: args.pr,
      thread,
    }) !== null,
  );
}

function normalizeSummaryText(value: string): string {
  return value
    .replace(/```[\s\S]*?```/gu, " ")
    .replace(/<[^>]+>/gu, " ")
    .replace(/!\[[^\]]*\]\([^)]+\)/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
}

function summarizeReviewThread(thread: ReviewThread): string {
  const body = latestCodexConnectorReviewComment(thread)?.body ?? "";
  const normalized = normalizeSummaryText(body);
  if (normalized.length === 0) {
    return "review details available at source link";
  }
  return normalized.length > 180 ? `${normalized.slice(0, 177)}...` : normalized;
}

export function buildCodexConnectorStillValidReviewRepairTargets(args: {
  record: Pick<IssueRunRecord, "timeline_artifacts">;
  pr: Pick<GitHubPullRequest, "headRefOid">;
  reviewThreads: ReviewThread[];
}): CodexConnectorValidReviewRepairTarget[] {
  return codexConnectorStillValidReviewRepairThreads(args).map((thread) => {
    const evidence = failedStillValidReviewThreadProbeArtifact({
      record: args.record,
      pr: args.pr,
      thread,
    });
    const latestCodexComment = latestCodexConnectorReviewCommentNode(thread);
    return {
      threadId: thread.id,
      path: thread.path ?? "unknown",
      line: thread.line === null ? "?" : String(thread.line),
      severity: latestCodexConnectorPSeverity(thread) ?? "unknown",
      url: latestCodexComment?.url ?? thread.comments.nodes[thread.comments.nodes.length - 1]?.url ?? null,
      summary: summarizeReviewThread(thread),
      evidenceSummary: evidence?.summary ?? "thread-scoped verification failed on the current head",
    };
  });
}
