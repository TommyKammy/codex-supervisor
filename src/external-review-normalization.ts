import { truncate } from "./utils";
import { type LocalReviewSeverity } from "./local-review/types";
import { hasActionableReviewText, isActionableTopLevelReview } from "./external-review-signal-heuristics";
import { type IssueComment, type PullRequestReview, type ReviewThread } from "./types";

export type ExternalReviewSignalSourceKind = "review_thread" | "top_level_review" | "issue_comment";

export interface ExternalReviewSignalEnvelope {
  sourceKind: ExternalReviewSignalSourceKind;
  sourceId: string;
  sourceUrl: string | null;
  reviewerLogin: string;
  body: string;
  file: string | null;
  line: number | null;
  threadId: string | null;
}

export interface NormalizedExternalReviewFinding {
  source: "external_bot";
  sourceKind: ExternalReviewSignalSourceKind;
  sourceId: string;
  sourceUrl: string | null;
  reviewerLogin: string;
  threadId: string | null;
  file: string | null;
  line: number | null;
  summary: string;
  rationale: string;
  severity: Exclude<LocalReviewSeverity, "none">;
  confidence: number;
  url: string | null;
}

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function summarizeComment(body: string): string {
  const normalized = normalizeWhitespace(body);
  if (normalized.length === 0) {
    return "External review finding";
  }

  const sentence = normalized.match(/^(.{1,180}?[.!?])(?:\s|$)/)?.[1] ?? normalized;
  return truncate(sentence, 180) ?? "External review finding";
}

function inferSeverity(body: string): Exclude<LocalReviewSeverity, "none"> {
  const normalized = body.toLowerCase();
  if (/\b(security|privilege|secret|panic|crash|corrupt|deadlock|critical|data loss)\b/.test(normalized)) {
    return "high";
  }

  if (/\b(nit|style|format|typo|wording|docs?)\b/.test(normalized)) {
    return "low";
  }

  return "medium";
}

function inferConfidence(body: string): number {
  const normalized = body.toLowerCase();
  if (/\b(will|can|break|fails?|throws?|incorrect|bug|missing|never|always)\b/.test(normalized)) {
    return 0.9;
  }

  if (/\b(nit|style|format|typo|wording|docs?)\b/.test(normalized)) {
    return 0.55;
  }

  return 0.75;
}

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

export function normalizeExternalReviewSignal(
  signal: ExternalReviewSignalEnvelope,
): NormalizedExternalReviewFinding | null {
  const rationale = normalizeWhitespace(signal.body);
  if (rationale.length === 0) {
    return null;
  }

  return {
    source: "external_bot",
    sourceKind: signal.sourceKind,
    sourceId: signal.sourceId,
    sourceUrl: signal.sourceUrl,
    reviewerLogin: signal.reviewerLogin,
    threadId: signal.threadId,
    file: signal.file,
    line: signal.line,
    summary: summarizeComment(signal.body),
    rationale,
    severity: inferSeverity(signal.body),
    confidence: inferConfidence(signal.body),
    url: signal.sourceUrl,
  };
}

export function normalizeExternalReviewFinding(
  thread: ReviewThread,
  reviewBotLogins: string[],
): NormalizedExternalReviewFinding | null {
  const signal = toExternalReviewThreadSignal(thread, reviewBotLogins);
  return signal ? normalizeExternalReviewSignal(signal) : null;
}

export function createExternalReviewMissPatternFingerprint(
  finding: Pick<NormalizedExternalReviewFinding, "file" | "summary" | "rationale">,
): string {
  return [
    finding.file ?? "",
    normalizeWhitespace(finding.summary).toLowerCase(),
    truncate(normalizeWhitespace(finding.rationale).toLowerCase(), 200) ?? "",
  ].join("|");
}

export function createExternalReviewRegressionCandidateId(
  finding: Pick<NormalizedExternalReviewFinding, "file" | "line" | "rationale">,
): string {
  return [
    finding.file ?? "",
    finding.line ?? "",
    normalizeWhitespace(finding.rationale).toLowerCase(),
  ].join("|");
}
