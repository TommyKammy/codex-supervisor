import type { GitHubPullRequest, IssueRunRecord, ReviewThread, SupervisorConfig } from "../core/types";
import {
  configuredReviewBotLogins,
  normalizeReviewProviderLogin,
} from "../core/review-providers";
import { truncate } from "../core/utils";
import {
  codexConnectorMustFixReviewThreads,
  isSoftenedCodexConnectorP3Thread,
  latestCodexConnectorReviewCommentFingerprint,
  latestCodexConnectorReviewCommentNode,
} from "../codex-connector-review-policy";
import {
  latestReviewThreadCommentFingerprint,
  reviewLoopRetryAttemptCountForThread,
} from "../review-handling";
import { configuredBotReviewThreads } from "../review-thread-reporting";

export interface ProviderNeutralReviewLoopEvidenceInput {
  config?: SupervisorConfig;
  record?: Partial<Pick<IssueRunRecord, "review_loop_retry_state">> | null;
  pr: GitHubPullRequest | null;
  reviewThreads: ReviewThread[];
  activeReviewThreads?: ReviewThread[];
}

function latestReviewComment(thread: ReviewThread): ReviewThread["comments"]["nodes"][number] | undefined {
  return thread.comments.nodes[thread.comments.nodes.length - 1];
}

function uniqueNonEmpty(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter((value) => value.length > 0))];
}

export function buildProviderNeutralReviewLoopEvidence(input: ProviderNeutralReviewLoopEvidenceInput): string[] {
  const sourceReviewThreads = input.activeReviewThreads ?? input.reviewThreads;
  const configuredThreads = input.config ? configuredBotReviewThreads(input.config, sourceReviewThreads) : [];
  const currentHeadReviewThreads = configuredThreads.filter((thread) => !thread.isResolved && !thread.isOutdated);
  const codexMustFixThreadIds = new Set(codexConnectorMustFixReviewThreads(currentHeadReviewThreads).map((thread) => thread.id));
  const configuredProviderCommentForThread = (thread: ReviewThread): ReviewThread["comments"]["nodes"][number] | null => {
    if (!input.config) {
      return latestReviewComment(thread) ?? null;
    }

    const configuredLogins = new Set(configuredReviewBotLogins(input.config));
    const softenedCodexConnectorCommentId = isSoftenedCodexConnectorP3Thread(thread)
      ? latestCodexConnectorReviewCommentNode(thread)?.id ?? null
      : null;
    for (let index = thread.comments.nodes.length - 1; index >= 0; index -= 1) {
      const comment = thread.comments.nodes[index]!;
      const login = normalizeReviewProviderLogin(comment.author?.login);
      if (softenedCodexConnectorCommentId && comment.id === softenedCodexConnectorCommentId) {
        continue;
      }
      if (login && configuredLogins.has(login)) {
        return comment;
      }
    }

    return null;
  };
  const evidenceCommentForThread = (thread: ReviewThread) =>
    codexMustFixThreadIds.has(thread.id)
      ? latestCodexConnectorReviewCommentNode(thread) ?? latestReviewComment(thread) ?? null
      : configuredProviderCommentForThread(thread);
  const evidenceCommentFingerprintForThread = (thread: ReviewThread) =>
    codexMustFixThreadIds.has(thread.id)
      ? latestCodexConnectorReviewCommentFingerprint(thread) ?? latestReviewThreadCommentFingerprint(thread)
      : (evidenceCommentForThread(thread)?.id ?? evidenceCommentForThread(thread)?.createdAt ?? latestReviewThreadCommentFingerprint(thread));
  const evidenceEntries = currentHeadReviewThreads.flatMap((thread) => {
    const evidenceComment = evidenceCommentForThread(thread);
    const commentFingerprint = evidenceCommentFingerprintForThread(thread);
    return evidenceComment && commentFingerprint ? [{ thread, evidenceComment, commentFingerprint }] : [];
  });
  if (evidenceEntries.length === 0) {
    return [
      "Provider-neutral review-loop evidence:",
      "- Current-head unresolved configured-provider review threads: none selected.",
    ];
  }
  const reviewerLogins = uniqueNonEmpty(
    evidenceEntries.map((entry) => entry.evidenceComment.author?.login ?? "unknown"),
  );
  const affectedFiles = uniqueNonEmpty(evidenceEntries.map((entry) => entry.thread.path ?? "unknown"));
  const threadEvidence = evidenceEntries.slice(0, 6).map(({ thread, evidenceComment, commentFingerprint }) => {
    const trackedRetryCount =
      input.record && input.pr
        ? Math.max(
            reviewLoopRetryAttemptCountForThread(input.record, input.pr, thread, commentFingerprint),
            reviewLoopRetryAttemptCountForThread(
              input.record,
              input.pr,
              thread,
              latestReviewThreadCommentFingerprint(thread),
            ),
          )
        : 0;
    return [
      `- Thread ${thread.id}`,
      `  reviewer=${evidenceComment.author?.login ?? "unknown"}`,
      `  file=${thread.path ?? "unknown"}:${thread.line ?? "?"}`,
      `  latest_comment_fingerprint=${commentFingerprint}`,
      `  retry_count=${trackedRetryCount > 0 ? String(trackedRetryCount) : "unknown"}`,
      `  url=${evidenceComment.url ?? "n/a"}`,
      `  comment=${truncate(evidenceComment.body.replace(/\s+/g, " ").trim(), 500) ?? ""}`,
    ].join("\n");
  });

  return [
    "Provider-neutral review-loop evidence:",
    `- Current-head scope: ${input.pr?.headRefOid ?? "unknown"}`,
    `- Current-head unresolved configured-provider review threads: ${evidenceEntries.length}`,
    `- Provider/reviewer identities: ${reviewerLogins.join(", ") || "unknown"}`,
    `- Affected files: ${affectedFiles.join(", ") || "unknown"}`,
    "- Current-head thread evidence:",
    ...threadEvidence,
    ...(evidenceEntries.length > threadEvidence.length
      ? [`- Additional current-head threads omitted: ${evidenceEntries.length - threadEvidence.length}`]
      : []),
    "- Before editing, classify these comments by provider/reviewer, affected file, repeated failure mode, and verifier expectation.",
    "- Choose regression probes from representative current-head comments before changing code.",
    "- Patch the shared failure mode first; avoid one literal wording or line-local patch per comment unless the cluster truly has independent issues.",
  ];
}
