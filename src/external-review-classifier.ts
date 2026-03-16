import { type LocalReviewSeverity } from "./local-review/types";
import { type NormalizedExternalReviewFinding } from "./external-review-normalization";

export type ExternalReviewMatch = "matched" | "near_match" | "missed_by_local_review";

export interface LocalReviewArtifactLike {
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

export interface ExternalReviewMissFinding extends NormalizedExternalReviewFinding {
  classification: ExternalReviewMatch;
  matchedLocalReference: string | null;
  matchReason: string;
}

interface LocalComparisonCandidate {
  reference: string;
  file: string | null;
  start: number | null;
  end: number | null;
  text: string;
}

interface LocalMatchScore {
  candidate: LocalComparisonCandidate;
  overlap: number;
  distance: number | null;
  sameHunk: boolean;
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

function isSameHunk(finding: NormalizedExternalReviewFinding, candidate: LocalComparisonCandidate): boolean {
  if (finding.line == null || candidate.start == null) {
    return false;
  }

  const candidateEnd = candidate.end ?? candidate.start;
  return finding.line >= candidate.start && finding.line <= candidateEnd;
}

function formatMatchReason(prefix: string, score: LocalMatchScore): string {
  return `${prefix} overlap=${score.overlap.toFixed(2)} line_distance=${score.distance ?? "na"} same_hunk=${score.sameHunk ? "yes" : "no"}`;
}

function isBetterMatch(candidate: LocalMatchScore, bestMatch: LocalMatchScore | null): boolean {
  if (!bestMatch) {
    return true;
  }

  if (candidate.sameHunk && !bestMatch.sameHunk) {
    return true;
  }

  if (candidate.sameHunk !== bestMatch.sameHunk) {
    return false;
  }

  if (candidate.overlap > bestMatch.overlap) {
    return true;
  }

  if (candidate.overlap < bestMatch.overlap) {
    return false;
  }

  return (candidate.distance ?? 9999) < (bestMatch.distance ?? 9999);
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
  let bestMatch: LocalMatchScore | null = null;

  for (const candidate of candidates) {
    const sameFile =
      finding.file === null || candidate.file === null ? false : finding.file === candidate.file;
    if (!sameFile) {
      continue;
    }

    const overlap = overlapScore(`${finding.summary} ${finding.rationale}`, candidate.text);
    const distance = lineDistance(finding, candidate);
    const sameHunk = isSameHunk(finding, candidate);
    const score = { candidate, overlap, distance, sameHunk };
    if (isBetterMatch(score, bestMatch)) {
      bestMatch = score;
    }
  }

  if (bestMatch) {
    if (
      bestMatch.overlap >= 0.28 ||
      (bestMatch.distance !== null && bestMatch.distance <= 3 && bestMatch.overlap >= 0.18) ||
      (bestMatch.sameHunk && bestMatch.overlap >= 0.08)
    ) {
      return {
        ...finding,
        classification: "matched",
        matchedLocalReference: bestMatch.candidate.reference,
        matchReason: formatMatchReason(bestMatch.sameHunk ? "same-hunk" : "same-file", bestMatch),
      };
    }

    if (bestMatch.overlap >= 0.12 || (bestMatch.distance !== null && bestMatch.distance <= 10)) {
      return {
        ...finding,
        classification: "near_match",
        matchedLocalReference: bestMatch.candidate.reference,
        matchReason: formatMatchReason(bestMatch.sameHunk ? "same-hunk" : "same-file", bestMatch),
      };
    }
  }

  return {
    ...finding,
    classification: "missed_by_local_review",
    matchedLocalReference: bestMatch?.candidate.reference ?? null,
    matchReason: bestMatch ? formatMatchReason("insufficient", bestMatch) : "no same-file local-review match",
  };
}
