import { truncate } from "./utils";
import { ReviewThread } from "./types";
import { type LocalReviewSeverity } from "./local-review-types";

export interface NormalizedExternalReviewFinding {
  source: "external_bot";
  reviewerLogin: string;
  threadId: string;
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

function latestConfiguredBotComment(thread: ReviewThread, reviewBotLogins: string[]) {
  const allowed = new Set(reviewBotLogins.map((login) => login.toLowerCase()));
  for (let index = thread.comments.nodes.length - 1; index >= 0; index -= 1) {
    const comment = thread.comments.nodes[index];
    const login = comment.author?.login?.toLowerCase();
    if (login && allowed.has(login)) {
      return comment;
    }
  }

  return null;
}

export function normalizeExternalReviewFinding(
  thread: ReviewThread,
  reviewBotLogins: string[],
): NormalizedExternalReviewFinding | null {
  const comment = latestConfiguredBotComment(thread, reviewBotLogins);
  if (!comment) {
    return null;
  }

  const rationale = normalizeWhitespace(comment.body);
  if (rationale.length === 0) {
    return null;
  }

  return {
    source: "external_bot",
    reviewerLogin: comment.author?.login ?? "unknown",
    threadId: thread.id,
    file: thread.path ?? null,
    line: thread.line ?? null,
    summary: summarizeComment(comment.body),
    rationale,
    severity: inferSeverity(comment.body),
    confidence: inferConfidence(comment.body),
    url: comment.url ?? null,
  };
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
