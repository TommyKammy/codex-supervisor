import type { GitHubPullRequest, IssueRunRecord, ReviewThread, TimelineArtifact } from "./core/types";
import {
  latestReviewThreadCommentFingerprint,
  processedReviewThreadFingerprintKey,
  processedReviewThreadKey,
} from "./review-handling";
import {
  codexConnectorMustFixReviewThreads,
  latestCodexConnectorPSeverity,
  latestCodexConnectorReviewComment,
  latestCodexConnectorReviewCommentFingerprint,
  latestCodexConnectorReviewCommentNode,
} from "./codex-connector-review-policy";

export const STILL_VALID_REVIEW_THREAD_REPAIR_TARGET =
  "still_valid_review_thread_repair";

export interface CodexConnectorValidReviewRepairTarget {
  threadId: string;
  path: string;
  line: string;
  severity: string;
  url: string | null;
  summary: string;
  evidenceSummary: string;
}

function timelineArtifactCoversReviewThread(args: {
  artifact: TimelineArtifact;
  pr: Pick<GitHubPullRequest, "headRefOid">;
  thread: Pick<ReviewThread, "id" | "comments">;
}): boolean {
  const processedThreadIds = args.artifact.processed_review_thread_ids ?? [];
  const processedThreadFingerprints = args.artifact.processed_review_thread_fingerprints ?? [];
  const headScopedThreadId = processedReviewThreadKey(args.thread.id, args.pr.headRefOid);
  if (processedThreadIds.includes(headScopedThreadId)) {
    return true;
  }

  const latestCommentFingerprint =
    latestCodexConnectorReviewCommentFingerprint(args.thread as ReviewThread) ??
    latestReviewThreadCommentFingerprint(args.thread);
  if (!latestCommentFingerprint) {
    return false;
  }

  return processedThreadFingerprints.includes(
    processedReviewThreadFingerprintKey(args.thread.id, args.pr.headRefOid, latestCommentFingerprint),
  );
}

export function failedStillValidReviewThreadProbeArtifact(args: {
  record: Pick<IssueRunRecord, "timeline_artifacts">;
  pr: Pick<GitHubPullRequest, "headRefOid">;
  thread: ReviewThread;
}): TimelineArtifact | null {
  return [...(args.record.timeline_artifacts ?? [])].reverse().find((artifact) =>
    artifact.type === "verification_result" &&
    artifact.gate === "codex_turn" &&
    artifact.outcome === "failed" &&
    artifact.head_sha === args.pr.headRefOid &&
    artifact.repair_targets?.includes(STILL_VALID_REVIEW_THREAD_REPAIR_TARGET) === true &&
    timelineArtifactCoversReviewThread({ artifact, pr: args.pr, thread: args.thread }),
  ) ?? null;
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
