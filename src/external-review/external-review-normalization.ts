import { truncate } from "../core/utils";
import { type LocalReviewSeverity } from "../local-review/types";
import { type ExternalReviewSignalEnvelope, type ExternalReviewSignalSourceKind } from "./external-review-signals";

export interface NormalizedExternalReviewFinding {
  source: "external_bot";
  provider: "codex" | "copilot" | "coderabbit" | "custom";
  headSha: string | null;
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

export type CodexConnectorPSeverity = "P0" | "P1" | "P2" | "P3";

export function extractCodexConnectorPSeverity(body: string): CodexConnectorPSeverity | null {
  const leadingBody = body.slice(0, 800);
  const badgeLabel = leadingBody.match(/!\[[^\]]*\b(P[0-3])\b[^\]]*\]\([^)]*\)/iu)?.[1];
  if (isCodexConnectorPSeverity(badgeLabel)) {
    return badgeLabel;
  }

  const shieldBadge = leadingBody.match(/https?:\/\/img\.shields\.io\/badge\/(P[0-3])(?:[-/?#)]|$)/iu)?.[1];
  if (isCodexConnectorPSeverity(shieldBadge)) {
    return shieldBadge;
  }

  const textHeading = normalizeWhitespace(leadingBody.replace(/<[^>]+>/gu, " ").replace(/[*_`[\]]/gu, " "));
  const headingLabel = textHeading.match(/^(?:#{1,6}\s*)?(P[0-3])(?:\s*[:\-]|\s+\b)/iu)?.[1];
  return isCodexConnectorPSeverity(headingLabel) ? headingLabel : null;
}

function isCodexConnectorPSeverity(value: string | undefined): value is CodexConnectorPSeverity {
  return value === "P0" || value === "P1" || value === "P2" || value === "P3";
}

export function hasCodexConnectorStrongRiskWording(body: string): boolean {
  const normalized = body.toLowerCase();
  return /\b(correctness|correct|incorrect|safety|unsafe|security|auth|authorization|permission|privilege|secret|data[- ]?loss|verification|verify|test|tests|fails?|failure|broken|bug|issue|error|warning|missing|regression|risk|leak|panic|crash|deadlock|corrupt)\b/u.test(
    normalized,
  );
}

function inferSeverity(body: string, reviewerLogin: string): Exclude<LocalReviewSeverity, "none"> {
  const codexConnectorPSeverity = isCodexConnectorReviewer(reviewerLogin) ? extractCodexConnectorPSeverity(body) : null;
  if (codexConnectorPSeverity === "P0" || codexConnectorPSeverity === "P1") {
    return "high";
  }
  if (codexConnectorPSeverity === "P2") {
    return "medium";
  }
  if (codexConnectorPSeverity === "P3" && hasCodexConnectorStrongRiskWording(body)) {
    return "medium";
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
  const codexConnectorPSeverity = isCodexConnectorReviewer(reviewerLogin) ? extractCodexConnectorPSeverity(body) : null;
  if (codexConnectorPSeverity === "P0" || codexConnectorPSeverity === "P1") {
    return 0.95;
  }
  if (codexConnectorPSeverity === "P2" || (codexConnectorPSeverity === "P3" && hasCodexConnectorStrongRiskWording(body))) {
    return 0.9;
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
    provider: signal.provider,
    headSha: signal.headSha,
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
