import { type LocalReviewRoleSelection } from "./review-role-detector";
import { type SupervisorConfig } from "./types";
import { truncate } from "./utils";
import {
  type FinalizedLocalReview,
  type LocalReviewArtifact,
  type LocalReviewFinding,
  type LocalReviewResult,
  type LocalReviewRootCauseSummary,
  type LocalReviewRoleResult,
  type LocalReviewSeverity,
  type LocalReviewVerifierReport,
} from "./local-review-types";

function severityWeight(severity: LocalReviewFinding["severity"]): number {
  switch (severity) {
    case "high":
      return 3;
    case "medium":
      return 2;
    default:
      return 1;
  }
}

export function dedupeFindings(findings: LocalReviewFinding[]): LocalReviewFinding[] {
  const deduped = new Map<string, LocalReviewFinding>();
  for (const finding of findings) {
    const key = [
      finding.file ?? "",
      finding.start ?? "",
      finding.end ?? "",
      finding.title.toLowerCase(),
      finding.body.toLowerCase(),
    ].join("|");
    const existing = deduped.get(key);
    if (!existing) {
      deduped.set(key, finding);
      continue;
    }

    if (
      severityWeight(finding.severity) > severityWeight(existing.severity) ||
      (severityWeight(finding.severity) === severityWeight(existing.severity) && finding.confidence > existing.confidence)
    ) {
      deduped.set(key, finding);
    }
  }

  return [...deduped.values()].sort((left, right) => {
    const severityDelta = severityWeight(right.severity) - severityWeight(left.severity);
    if (severityDelta !== 0) {
      return severityDelta;
    }

    return right.confidence - left.confidence;
  });
}

export function findingKey(finding: LocalReviewFinding): string {
  return [
    finding.file ?? "",
    finding.start ?? "",
    finding.end ?? "",
    finding.title.toLowerCase(),
    finding.body.toLowerCase(),
  ].join("|");
}

const FINDING_STOPWORDS = new Set(["this", "that", "with", "from", "when", "only", "still", "have", "does", "into"]);

function tokenizeFindingText(value: string): Set<string> {
  const tokens = value
    .toLowerCase()
    .split(/[^a-z0-9]+/i)
    .map((token) => token.trim())
    .filter((token) => token.length >= 4)
    .filter((token) => !FINDING_STOPWORDS.has(token));
  return new Set(tokens);
}

function overlapCount(left: Set<string>, right: Set<string>): number {
  let count = 0;
  for (const token of left) {
    if (right.has(token)) {
      count += 1;
    }
  }

  return count;
}

function lineDistance(left: LocalReviewFinding, right: LocalReviewFinding): number | null {
  if (left.start == null || right.start == null) {
    return null;
  }

  const leftEnd = left.end ?? left.start;
  const rightEnd = right.end ?? right.start;
  if (leftEnd >= right.start && rightEnd >= left.start) {
    return 0;
  }

  return Math.min(Math.abs(leftEnd - right.start), Math.abs(rightEnd - left.start));
}

function findingsOverlap(left: LocalReviewFinding, right: LocalReviewFinding): boolean {
  if (left.file == null || right.file == null || left.file !== right.file) {
    return false;
  }

  const distance = lineDistance(left, right);
  if (distance == null || distance > 6) {
    return false;
  }

  if (left.category && right.category && left.category !== right.category) {
    return false;
  }

  const leftTokens = tokenizeFindingText(`${left.title} ${left.body} ${left.evidence ?? ""}`);
  const rightTokens = tokenizeFindingText(`${right.title} ${right.body} ${right.evidence ?? ""}`);
  return overlapCount(leftTokens, rightTokens) >= 3;
}

function summarizeRootCause(findings: LocalReviewFinding[]): LocalReviewRootCauseSummary {
  const sorted = [...findings].sort((left, right) => {
    const severityDelta = severityWeight(right.severity) - severityWeight(left.severity);
    if (severityDelta !== 0) {
      return severityDelta;
    }

    return right.confidence - left.confidence;
  });
  const primary = sorted[0]!;
  const sameFile = sorted.every((finding) => finding.file === primary.file);
  const starts = sorted.map((finding) => finding.start).filter((value): value is number => value != null);
  const ends = sorted.map((finding) => finding.end ?? finding.start).filter((value): value is number => value != null);

  return {
    summary: primary.body,
    severity: sorted.some((finding) => finding.severity === "high")
      ? "high"
      : sorted.some((finding) => finding.severity === "medium")
        ? "medium"
        : "low",
    category: primary.category,
    file: sameFile ? primary.file : null,
    start: sameFile && starts.length > 0 ? Math.min(...starts) : null,
    end: sameFile && ends.length > 0 ? Math.max(...ends) : null,
    roles: [...new Set(sorted.map((finding) => finding.role))],
    findingsCount: sorted.length,
    findingKeys: sorted.map((finding) => findingKey(finding)),
  };
}

function compressRootCauses(findings: LocalReviewFinding[]): LocalReviewRootCauseSummary[] {
  const groups: LocalReviewFinding[][] = [];
  for (const finding of findings) {
    const overlappingGroupIndexes: number[] = [];
    for (let index = 0; index < groups.length; index += 1) {
      const candidate = groups[index];
      if (candidate?.some((existing) => findingsOverlap(existing, finding))) {
        overlappingGroupIndexes.push(index);
      }
    }

    if (overlappingGroupIndexes.length > 0) {
      const targetGroup = groups[overlappingGroupIndexes[0]!]!;
      targetGroup.push(finding);
      for (let index = overlappingGroupIndexes.length - 1; index >= 1; index -= 1) {
        const groupIndex = overlappingGroupIndexes[index]!;
        const groupToMerge = groups[groupIndex]!;
        targetGroup.push(...groupToMerge);
        groups.splice(groupIndex, 1);
      }
      continue;
    }

    groups.push([finding]);
  }

  return groups
    .map((group) => summarizeRootCause(group))
    .sort((left, right) => {
      const severityDelta = severityWeight(right.severity) - severityWeight(left.severity);
      if (severityDelta !== 0) {
        return severityDelta;
      }

      return right.findingsCount - left.findingsCount;
    });
}

function maxSeverity(findings: LocalReviewFinding[]): LocalReviewSeverity {
  if (findings.some((finding) => finding.severity === "high")) {
    return "high";
  }
  if (findings.some((finding) => finding.severity === "medium")) {
    return "medium";
  }
  if (findings.some((finding) => finding.severity === "low")) {
    return "low";
  }

  return "none";
}

export function finalizeLocalReview(args: {
  config: Pick<SupervisorConfig, "localReviewConfidenceThreshold">;
  issueNumber: number;
  prNumber: number;
  branch: string;
  headSha: string;
  detectedRoles?: LocalReviewRoleSelection[];
  roleResults: LocalReviewRoleResult[];
  verifierReport: LocalReviewVerifierReport | null;
  ranAt: string;
}): FinalizedLocalReview {
  const roles = args.roleResults.map((result) => result.role);
  const allFindings = args.roleResults.flatMap((result) => result.findings);
  const actionableFindings = dedupeFindings(
    allFindings.filter((finding) => finding.confidence >= args.config.localReviewConfidenceThreshold),
  );
  const rootCauseSummaries = compressRootCauses(actionableFindings);
  const degraded = args.roleResults.some((result) => result.degraded) || (args.verifierReport?.degraded ?? false);
  const summary = truncate(
    `Roles run: ${roles.join(", ")}. Actionable findings above confidence ${args.config.localReviewConfidenceThreshold.toFixed(2)}: ${actionableFindings.length}. Root causes: ${rootCauseSummaries.length}. Degraded roles: ${args.roleResults.filter((result) => result.degraded).length}.`,
    500,
  ) ?? "";
  const recommendation: LocalReviewResult["recommendation"] =
    degraded ? "unknown" : actionableFindings.length > 0 ? "changes_requested" : "ready";
  const actionableHighSeverityFindings = actionableFindings.filter((finding) => finding.severity === "high");
  const verificationByKey = new Map(args.verifierReport?.findings.map((finding) => [finding.findingKey, finding]) ?? []);
  const verifiedFindings = actionableHighSeverityFindings.filter(
    (finding) => verificationByKey.get(findingKey(finding))?.verdict === "confirmed",
  );
  const verifiedMaxSeverity = maxSeverity(verifiedFindings);
  const artifact: LocalReviewArtifact = {
    issueNumber: args.issueNumber,
    prNumber: args.prNumber,
    branch: args.branch,
    headSha: args.headSha,
    ranAt: args.ranAt,
    confidenceThreshold: args.config.localReviewConfidenceThreshold,
    roles,
    autoDetectedRoles: args.detectedRoles ?? [],
    summary,
    recommendation,
    degraded,
    findingsCount: actionableFindings.length,
    rootCauseCount: rootCauseSummaries.length,
    maxSeverity: maxSeverity(actionableFindings),
    actionableFindings,
    rootCauseSummaries,
    verification: {
      required: actionableHighSeverityFindings.length > 0,
      summary: args.verifierReport?.summary ?? (actionableHighSeverityFindings.length > 0 ? "Verification not run." : "No high-severity findings required verification."),
      recommendation: args.verifierReport?.recommendation ?? "unknown",
      degraded: args.verifierReport?.degraded ?? false,
      findingsCount: args.verifierReport?.findings.length ?? 0,
      verifiedFindingsCount: verifiedFindings.length,
      verifiedMaxSeverity,
      findings: args.verifierReport?.findings ?? [],
    },
    verifiedFindings,
    roleReports: args.roleResults.map((result) => ({
      role: result.role,
      exitCode: result.exitCode,
      degraded: result.degraded,
      summary: result.summary,
      recommendation: result.recommendation,
      findings: result.findings,
    })),
    verifierReport: args.verifierReport
      ? {
          role: args.verifierReport.role,
          exitCode: args.verifierReport.exitCode,
          degraded: args.verifierReport.degraded,
          summary: args.verifierReport.summary,
          recommendation: args.verifierReport.recommendation,
          findings: args.verifierReport.findings,
        }
      : null,
  };

  return {
    summary,
    recommendation,
    degraded,
    findingsCount: actionableFindings.length,
    rootCauseCount: rootCauseSummaries.length,
    maxSeverity: maxSeverity(actionableFindings),
    verifiedFindingsCount: verifiedFindings.length,
    verifiedMaxSeverity,
    actionableFindings,
    rootCauseSummaries,
    verifiedFindings,
    artifact,
  };
}
