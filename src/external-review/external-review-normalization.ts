import { truncate } from "../core/utils";
import { type LocalReviewSeverity } from "../local-review/types";
import { type ExternalReviewSignalEnvelope, type ExternalReviewSignalSourceKind } from "./external-review-signals";

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

export function isCodexConnectorReviewer(reviewerLogin: string): boolean {
  return /^chatgpt-codex-connector(?:\[bot\])?$/iu.test(reviewerLogin);
}

export function extractCodexConnectorPSeverity(body: string): "P0" | "P1" | null {
  const leadingBody = body.slice(0, 800);
  const badgeLabel = leadingBody.match(/!\[[^\]]*\b(P[01])\b[^\]]*\]\([^)]*\)/iu)?.[1];
  if (badgeLabel === "P0" || badgeLabel === "P1") {
    return badgeLabel;
  }

  const shieldBadge = leadingBody.match(/https?:\/\/img\.shields\.io\/badge\/(P[01])(?:[-/?#)]|$)/iu)?.[1];
  if (shieldBadge === "P0" || shieldBadge === "P1") {
    return shieldBadge;
  }

  const textHeading = normalizeWhitespace(leadingBody.replace(/<[^>]+>/gu, " ").replace(/[*_`[\]]/gu, " "));
  const headingLabel = textHeading.match(/^(?:#{1,6}\s*)?(P[01])(?:\s*[:\-]|\s+\b)/iu)?.[1];
  return headingLabel === "P0" || headingLabel === "P1" ? headingLabel : null;
}

function inferSeverity(body: string, reviewerLogin: string): Exclude<LocalReviewSeverity, "none"> {
  if (isCodexConnectorReviewer(reviewerLogin) && extractCodexConnectorPSeverity(body)) {
    return "high";
  }

  const normalized = body.toLowerCase();
  if (/\b(security|privilege|secret|panic|crash|corrupt|deadlock|critical|data loss)\b/.test(normalized)) {
    return "high";
  }

  if (/\b(nit|style|format|typo|wording|docs?)\b/.test(normalized)) {
    return "low";
  }

  return "medium";
}

function inferConfidence(body: string, reviewerLogin: string): number {
  if (isCodexConnectorReviewer(reviewerLogin) && extractCodexConnectorPSeverity(body)) {
    return 0.95;
  }

  const normalized = body.toLowerCase();
  if (/\b(will|can|break|fails?|throws?|incorrect|bug|missing|never|always)\b/.test(normalized)) {
    return 0.9;
  }

  if (/\b(nit|style|format|typo|wording|docs?)\b/.test(normalized)) {
    return 0.55;
  }

  return 0.75;
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
    severity: inferSeverity(signal.body, signal.reviewerLogin),
    confidence: inferConfidence(signal.body, signal.reviewerLogin),
    url: signal.sourceUrl,
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
