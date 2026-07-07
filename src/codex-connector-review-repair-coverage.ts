import type { GitHubPullRequest, IssueRunRecord, ReviewThread, TimelineArtifact } from "./core/types";
import {
  latestReviewThreadCommentFingerprint,
  processedReviewThreadFingerprintKey,
  processedReviewThreadKey,
} from "./review-handling";
import { latestCodexConnectorPSeverity } from "./codex-connector-review-policy";

export interface ReviewThreadCoverageFingerprint {
  fingerprint: string;
}

export function headScopedProcessedThreadEvidenceCount(
  source: Pick<
    IssueRunRecord | TimelineArtifact,
    "processed_review_thread_ids" | "processed_review_thread_fingerprints"
  >,
  pr: Pick<GitHubPullRequest, "headRefOid">,
): number {
  const headToken = `@${pr.headRefOid}`;
  return (
    (source.processed_review_thread_ids ?? []).filter((key) => key.includes(headToken)).length +
    (source.processed_review_thread_fingerprints ?? []).filter((key) => key.includes(headToken)).length
  );
}

export function allCodexConnectorRepairResidueThreadsAreP2(reviewThreads: ReviewThread[]): boolean {
  return reviewThreads.length > 0 && reviewThreads.every((thread) => latestCodexConnectorPSeverity(thread) === "P2");
}

export function timelineArtifactCoversReviewThread(args: {
  artifact: Pick<TimelineArtifact, "processed_review_thread_ids" | "processed_review_thread_fingerprints">;
  pr: Pick<GitHubPullRequest, "headRefOid">;
  thread: Pick<ReviewThread, "id" | "comments">;
  acceptedFingerprints?: ReviewThreadCoverageFingerprint[];
  allowHeadScopedIdWhenFingerprintsExist?: boolean;
}): boolean {
  const processedThreadIds = args.artifact.processed_review_thread_ids ?? [];
  const processedThreadFingerprints = args.artifact.processed_review_thread_fingerprints ?? [];
  const headScopedKey = processedReviewThreadKey(args.thread.id, args.pr.headRefOid);
  const latestFingerprint = latestReviewThreadCommentFingerprint(args.thread);
  const acceptedFingerprints =
    args.acceptedFingerprints ?? (latestFingerprint ? [{ fingerprint: latestFingerprint }] : []);
  const matchedFingerprint = acceptedFingerprints.find((candidate) =>
    processedThreadFingerprints.includes(
      processedReviewThreadFingerprintKey(args.thread.id, args.pr.headRefOid, candidate.fingerprint),
    )
  );
  if (matchedFingerprint) {
    return true;
  }

  if (!processedThreadIds.includes(headScopedKey)) {
    return false;
  }
  if (acceptedFingerprints.length === 0) {
    return true;
  }
  if (args.allowHeadScopedIdWhenFingerprintsExist !== true) {
    return false;
  }

  const threadFingerprintPrefix = `${headScopedKey}#`;
  return !processedThreadFingerprints.some((key) => key.startsWith(threadFingerprintPrefix));
}

export function timelineArtifactCoversReviewThreads(args: {
  artifact: Pick<TimelineArtifact, "processed_review_thread_ids" | "processed_review_thread_fingerprints">;
  pr: Pick<GitHubPullRequest, "headRefOid">;
  reviewThreads: ReviewThread[];
  acceptedFingerprints?: (thread: ReviewThread) => ReviewThreadCoverageFingerprint[];
  allowHeadScopedIdWhenFingerprintsExist?: boolean;
}): boolean {
  if (args.reviewThreads.length === 0) {
    return false;
  }
  return args.reviewThreads.every((thread) =>
    timelineArtifactCoversReviewThread({
      artifact: args.artifact,
      pr: args.pr,
      thread,
      acceptedFingerprints: args.acceptedFingerprints?.(thread),
      allowHeadScopedIdWhenFingerprintsExist: args.allowHeadScopedIdWhenFingerprintsExist,
    })
  );
}
