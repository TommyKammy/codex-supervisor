import { type IssueComment, type PullRequestReview, type ReviewThread } from "../core/types";
import { hasActionableReviewText, isActionableTopLevelReview } from "./external-review-signal-heuristics";
import { type ExternalReviewSignalEnvelope } from "./external-review-signals";

function normalizeBotLogins(reviewBotLogins: string[]): Set<string> {
  return new Set(reviewBotLogins.map((login) => login.toLowerCase()));
}

function latestConfiguredBotComment(thread: ReviewThread, allowed: Set<string>) {
  for (let index = thread.comments.nodes.length - 1; index >= 0; index -= 1) {
    const comment = thread.comments.nodes[index];
    const login = comment.author?.login?.toLowerCase();
    if (login && allowed.has(login)) {
      return comment;
    }
  }

  return null;
}

export function toExternalReviewThreadSignal(
  thread: ReviewThread,
  reviewBotLogins: string[],
): ExternalReviewSignalEnvelope | null {
  const comment = latestConfiguredBotComment(thread, normalizeBotLogins(reviewBotLogins));
  if (!comment) {
    return null;
  }

  return {
    sourceKind: "review_thread",
    sourceId: thread.id,
    sourceUrl: comment.url ?? null,
    reviewerLogin: comment.author?.login ?? "unknown",
    body: comment.body,
    file: thread.path ?? null,
    line: thread.line ?? null,
    threadId: thread.id,
  };
}

export function toExternalTopLevelReviewSignal(
  review: PullRequestReview,
  reviewBotLogins: string[],
): ExternalReviewSignalEnvelope | null {
  const login = review.author?.login?.toLowerCase();
  if (!login || !normalizeBotLogins(reviewBotLogins).has(login) || !isActionableTopLevelReview(review)) {
    return null;
  }

  const body = review.body?.trim() || review.state?.trim();
  if (!body) {
    return null;
  }

  return {
    sourceKind: "top_level_review",
    sourceId: review.id,
    sourceUrl: review.url ?? null,
    reviewerLogin: review.author?.login ?? "unknown",
    body,
    file: null,
    line: null,
    threadId: null,
  };
}

export function toExternalIssueCommentSignal(
  comment: IssueComment,
  reviewBotLogins: string[],
): ExternalReviewSignalEnvelope | null {
  const login = comment.author?.login?.toLowerCase();
  if (!login || !normalizeBotLogins(reviewBotLogins).has(login) || !hasActionableReviewText(comment.body)) {
    return null;
  }

  return {
    sourceKind: "issue_comment",
    sourceId: comment.id,
    sourceUrl: comment.url ?? null,
    reviewerLogin: comment.author?.login ?? "unknown",
    body: comment.body,
    file: null,
    line: null,
    threadId: null,
  };
}

export function collectExternalReviewSignals(args: {
  reviewThreads?: ReviewThread[];
  reviews?: PullRequestReview[];
  issueComments?: IssueComment[];
  reviewBotLogins: string[];
}): ExternalReviewSignalEnvelope[] {
  return [
    ...(args.reviewThreads ?? []).flatMap((thread) => {
      const signal = toExternalReviewThreadSignal(thread, args.reviewBotLogins);
      return signal ? [signal] : [];
    }),
    ...(args.reviews ?? []).flatMap((review) => {
      const signal = toExternalTopLevelReviewSignal(review, args.reviewBotLogins);
      return signal ? [signal] : [];
    }),
    ...(args.issueComments ?? []).flatMap((comment) => {
      const signal = toExternalIssueCommentSignal(comment, args.reviewBotLogins);
      return signal ? [signal] : [];
    }),
  ];
}
