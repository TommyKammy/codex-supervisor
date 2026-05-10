import { type IssueComment, type PullRequestReview, type ReviewThread } from "../core/types";
import { normalizeReviewBotLogins, normalizeReviewProviderLogin } from "../core/review-providers";
import { hasActionableReviewText, isActionableTopLevelReview } from "./external-review-signal-heuristics";
import { type ExternalReviewSignalEnvelope } from "./external-review-signals";

type ExternalReviewSignalProvider = ExternalReviewSignalEnvelope["provider"];

function normalizeBotLogins(reviewBotLogins: string[]): Set<string> {
  return new Set(normalizeReviewBotLogins(reviewBotLogins));
}

function inferProvider(reviewerLogin: string | null | undefined): ExternalReviewSignalProvider {
  const normalized = reviewerLogin?.trim().toLowerCase() ?? "";
  if (normalized === "chatgpt-codex-connector" || normalized === "chatgpt-codex-connector[bot]") {
    return "codex";
  }
  if (normalized === "copilot-pull-request-reviewer") {
    return "copilot";
  }
  if (normalized === "coderabbitai" || normalized === "coderabbitai[bot]") {
    return "coderabbit";
  }
  return "custom";
}

function normalizeHeadSha(headSha: string | null | undefined): string | null {
  const normalized = headSha?.trim();
  return normalized ? normalized : null;
}

function latestConfiguredBotComment(thread: ReviewThread, allowed: Set<string>) {
  for (let index = thread.comments.nodes.length - 1; index >= 0; index -= 1) {
    const comment = thread.comments.nodes[index];
    const login = normalizeReviewProviderLogin(comment.author?.login);
    if (login && allowed.has(login)) {
      return comment;
    }
  }

  return null;
}

export function toExternalReviewThreadSignal(
  thread: ReviewThread,
  reviewBotLogins: string[],
  headSha?: string | null,
): ExternalReviewSignalEnvelope | null {
  const comment = latestConfiguredBotComment(thread, normalizeBotLogins(reviewBotLogins));
  if (!comment) {
    return null;
  }

  return {
    provider: inferProvider(comment.author?.login),
    headSha: normalizeHeadSha(headSha),
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
  headSha?: string | null,
): ExternalReviewSignalEnvelope | null {
  const login = normalizeReviewProviderLogin(review.author?.login);
  if (!login || !normalizeBotLogins(reviewBotLogins).has(login) || !isActionableTopLevelReview(review)) {
    return null;
  }

  const body = review.body?.trim() || review.state?.trim();
  if (!body) {
    return null;
  }

  return {
    provider: inferProvider(review.author?.login),
    headSha: normalizeHeadSha(headSha),
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
  headSha?: string | null,
): ExternalReviewSignalEnvelope | null {
  const login = normalizeReviewProviderLogin(comment.author?.login);
  if (!login || !normalizeBotLogins(reviewBotLogins).has(login) || !hasActionableReviewText(comment.body)) {
    return null;
  }

  return {
    provider: inferProvider(comment.author?.login),
    headSha: normalizeHeadSha(headSha),
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
  headSha?: string | null;
}): ExternalReviewSignalEnvelope[] {
  return [
    ...(args.reviewThreads ?? []).flatMap((thread) => {
      if (thread.isOutdated) {
        return [];
      }
      const signal = toExternalReviewThreadSignal(thread, args.reviewBotLogins, args.headSha);
      return signal ? [signal] : [];
    }),
    ...(args.reviews ?? []).flatMap((review) => {
      const signal = toExternalTopLevelReviewSignal(review, args.reviewBotLogins, args.headSha);
      return signal ? [signal] : [];
    }),
    ...(args.issueComments ?? []).flatMap((comment) => {
      const signal = toExternalIssueCommentSignal(comment, args.reviewBotLogins, args.headSha);
      return signal ? [signal] : [];
    }),
  ];
}
