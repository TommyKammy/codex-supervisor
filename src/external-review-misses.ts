import fs from "node:fs/promises";
import path from "node:path";
import { ensureDir, nowIso, parseJson, truncate } from "./utils";
import { ReviewThread } from "./types";

type LocalReviewSeverity = "none" | "low" | "medium" | "high";
type ExternalReviewMatch = "matched" | "near_match" | "missed_by_local_review";

interface LocalReviewArtifactLike {
  issueNumber?: number;
  prNumber?: number;
  branch?: string;
  headSha?: string;
  actionableFindings?: Array<{
    title?: string;
    body?: string;
    file?: string | null;
    start?: number | null;
    end?: number | null;
    severity?: LocalReviewSeverity;
    category?: string | null;
  }>;
  rootCauseSummaries?: Array<{
    summary?: string;
    file?: string | null;
    start?: number | null;
    end?: number | null;
    severity?: LocalReviewSeverity;
    category?: string | null;
  }>;
  verifiedFindings?: Array<{
    title?: string;
    body?: string;
    file?: string | null;
    start?: number | null;
    end?: number | null;
    severity?: LocalReviewSeverity;
    category?: string | null;
  }>;
}

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

export interface ExternalReviewMissFinding extends NormalizedExternalReviewFinding {
  classification: ExternalReviewMatch;
  matchedLocalReference: string | null;
  matchReason: string;
}

export type ExternalReviewPromptFinding = Pick<
  ExternalReviewMissFinding,
  "reviewerLogin" | "file" | "line" | "summary" | "rationale" | "url"
>;

export interface ExternalReviewMissArtifact {
  issueNumber: number;
  prNumber: number;
  branch: string;
  headSha: string;
  generatedAt: string;
  localReviewSummaryPath: string | null;
  localReviewFindingsPath: string | null;
  findings: ExternalReviewMissFinding[];
  counts: {
    matched: number;
    nearMatch: number;
    missedByLocalReview: number;
  };
}

export interface ExternalReviewMissContext {
  artifactPath: string;
  missedFindings: ExternalReviewPromptFinding[];
  matchedCount: number;
  nearMatchCount: number;
  missedCount: number;
}

interface LocalComparisonCandidate {
  reference: string;
  file: string | null;
  start: number | null;
  end: number | null;
  text: string;
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

function tokenize(value: string): Set<string> {
  const stopWords = new Set(["the", "and", "that", "this", "with", "from", "into", "when", "then", "than", "they", "them", "their", "there", "would", "should", "could", "because", "while", "after", "before", "about", "have", "has", "had", "been", "being", "your", "will", "does", "only", "just"]);
  return new Set(
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .split(/\s+/)
      .map((token) => token.trim())
      .filter((token) => token.length >= 3 && !stopWords.has(token)),
  );
}

function overlapScore(left: string, right: string): number {
  const leftTokens = tokenize(left);
  const rightTokens = tokenize(right);
  if (leftTokens.size === 0 || rightTokens.size === 0) {
    return 0;
  }

  let overlap = 0;
  for (const token of leftTokens) {
    if (rightTokens.has(token)) {
      overlap += 1;
    }
  }

  return overlap / Math.max(leftTokens.size, rightTokens.size);
}

function lineDistance(finding: NormalizedExternalReviewFinding, candidate: LocalComparisonCandidate): number | null {
  if (finding.line == null || candidate.start == null) {
    return null;
  }

  const candidateEnd = candidate.end ?? candidate.start;
  if (finding.line >= candidate.start && finding.line <= candidateEnd) {
    return 0;
  }

  return Math.min(Math.abs(finding.line - candidate.start), Math.abs(finding.line - candidateEnd));
}

function buildLocalCandidates(artifact: LocalReviewArtifactLike): LocalComparisonCandidate[] {
  const actionable = (artifact.actionableFindings ?? []).map((finding, index) => ({
    reference: `actionable:${index + 1}`,
    file: finding.file ?? null,
    start: finding.start ?? null,
    end: finding.end ?? finding.start ?? null,
    text: [finding.title, finding.body, finding.category ?? undefined].filter(Boolean).join(" "),
  }));
  const rootCauses = (artifact.rootCauseSummaries ?? []).map((finding, index) => ({
    reference: `root_cause:${index + 1}`,
    file: finding.file ?? null,
    start: finding.start ?? null,
    end: finding.end ?? finding.start ?? null,
    text: [finding.summary, finding.category ?? undefined].filter(Boolean).join(" "),
  }));
  const verified = (artifact.verifiedFindings ?? []).map((finding, index) => ({
    reference: `verified:${index + 1}`,
    file: finding.file ?? null,
    start: finding.start ?? null,
    end: finding.end ?? finding.start ?? null,
    text: [finding.title, finding.body, finding.category ?? undefined].filter(Boolean).join(" "),
  }));
  return [...actionable, ...rootCauses, ...verified].filter((candidate) => candidate.text.trim().length > 0);
}

export function classifyExternalReviewFinding(
  finding: NormalizedExternalReviewFinding,
  localArtifact: LocalReviewArtifactLike | null,
): ExternalReviewMissFinding {
  const candidates = localArtifact ? buildLocalCandidates(localArtifact) : [];
  let bestMatch: { candidate: LocalComparisonCandidate; overlap: number; distance: number | null } | null = null;

  for (const candidate of candidates) {
    const sameFile =
      finding.file === null || candidate.file === null ? false : finding.file === candidate.file;
    if (!sameFile) {
      continue;
    }

    const overlap = overlapScore(`${finding.summary} ${finding.rationale}`, candidate.text);
    const distance = lineDistance(finding, candidate);
    if (!bestMatch || overlap > bestMatch.overlap || (overlap === bestMatch.overlap && (distance ?? 9999) < (bestMatch.distance ?? 9999))) {
      bestMatch = { candidate, overlap, distance };
    }
  }

  if (bestMatch) {
    if (bestMatch.overlap >= 0.28 || (bestMatch.distance !== null && bestMatch.distance <= 3 && bestMatch.overlap >= 0.18)) {
      return {
        ...finding,
        classification: "matched",
        matchedLocalReference: bestMatch.candidate.reference,
        matchReason: `same-file overlap=${bestMatch.overlap.toFixed(2)} line_distance=${bestMatch.distance ?? "na"}`,
      };
    }

    if (bestMatch.overlap >= 0.12 || (bestMatch.distance !== null && bestMatch.distance <= 10)) {
      return {
        ...finding,
        classification: "near_match",
        matchedLocalReference: bestMatch.candidate.reference,
        matchReason: `same-file overlap=${bestMatch.overlap.toFixed(2)} line_distance=${bestMatch.distance ?? "na"}`,
      };
    }
  }

  return {
    ...finding,
    classification: "missed_by_local_review",
    matchedLocalReference: bestMatch?.candidate.reference ?? null,
    matchReason: bestMatch ? `insufficient overlap=${bestMatch.overlap.toFixed(2)} line_distance=${bestMatch.distance ?? "na"}` : "no same-file local-review match",
  };
}

async function loadLocalReviewArtifact(summaryPath: string | null): Promise<{
  findingsPath: string | null;
  artifact: LocalReviewArtifactLike | null;
  available: boolean;
}> {
  if (!summaryPath || path.extname(summaryPath) !== ".md") {
    return { findingsPath: null, artifact: null, available: false };
  }

  const findingsPath = `${summaryPath.slice(0, -3)}.json`;
  try {
    const raw = await fs.readFile(findingsPath, "utf8");
    return {
      findingsPath,
      artifact: parseJson<LocalReviewArtifactLike>(raw, findingsPath),
      available: true,
    };
  } catch {
    return { findingsPath, artifact: null, available: false };
  }
}

export async function writeExternalReviewMissArtifact(args: {
  artifactDir: string;
  issueNumber: number;
  prNumber: number;
  branch: string;
  headSha: string;
  reviewThreads: ReviewThread[];
  reviewBotLogins: string[];
  localReviewSummaryPath: string | null;
}): Promise<ExternalReviewMissContext | null> {
  const normalizedFindings = args.reviewThreads
    .map((thread) => normalizeExternalReviewFinding(thread, args.reviewBotLogins))
    .filter((finding): finding is NormalizedExternalReviewFinding => finding !== null);

  if (normalizedFindings.length === 0) {
    return null;
  }

  const { findingsPath: localReviewFindingsPath, artifact: localArtifact, available } = await loadLocalReviewArtifact(args.localReviewSummaryPath);
  if (!available || !localArtifact) {
    return null;
  }

  const findings = normalizedFindings.map((finding) => classifyExternalReviewFinding(finding, localArtifact));
  const artifact: ExternalReviewMissArtifact = {
    issueNumber: args.issueNumber,
    prNumber: args.prNumber,
    branch: args.branch,
    headSha: args.headSha,
    generatedAt: nowIso(),
    localReviewSummaryPath: args.localReviewSummaryPath,
    localReviewFindingsPath,
    findings,
    counts: {
      matched: findings.filter((finding) => finding.classification === "matched").length,
      nearMatch: findings.filter((finding) => finding.classification === "near_match").length,
      missedByLocalReview: findings.filter((finding) => finding.classification === "missed_by_local_review").length,
    },
  };

  await ensureDir(args.artifactDir);
  const artifactPath = path.join(args.artifactDir, `external-review-misses-head-${args.headSha.slice(0, 12)}.json`);
  await fs.writeFile(artifactPath, `${JSON.stringify(artifact, null, 2)}\n`, "utf8");

  return {
    artifactPath,
    missedFindings: findings.filter((finding) => finding.classification === "missed_by_local_review"),
    matchedCount: artifact.counts.matched,
    nearMatchCount: artifact.counts.nearMatch,
    missedCount: artifact.counts.missedByLocalReview,
  };
}
