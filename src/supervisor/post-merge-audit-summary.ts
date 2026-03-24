import fs from "node:fs/promises";
import path from "node:path";
import { nowIso } from "../core/utils";
import type { SupervisorConfig } from "../core/types";
import type { ActionableSeverity, LocalReviewRootCauseSummary } from "../local-review/types";
import type { PostMergeAuditArtifact } from "./post-merge-audit-artifact";
import { postMergeAuditArtifactDir } from "./post-merge-audit-artifact";

export const POST_MERGE_AUDIT_PATTERN_SUMMARY_SCHEMA_VERSION = 1;

export interface PostMergeAuditReviewPatternDto {
  key: string;
  summary: string;
  category: string | null;
  severity: ActionableSeverity;
  artifactCount: number;
  evidenceCount: number;
  exampleIssueNumbers: number[];
  exampleFindingKeys: string[];
}

export interface PostMergeAuditFailurePatternDto {
  key: string;
  category: string | null;
  failureKind: string | null;
  blockedReason: string | null;
  summary: string | null;
  artifactCount: number;
  repeatedCount: number;
  exampleIssueNumbers: number[];
  lastSeenAt: string | null;
}

export interface PostMergeAuditRecoveryPatternDto {
  key: string;
  reason: string;
  artifactCount: number;
  occurrenceCount: number;
  exampleIssueNumbers: number[];
  latestRecoveredAt: string | null;
}

export interface PostMergeAuditPatternSummaryDto {
  schemaVersion: typeof POST_MERGE_AUDIT_PATTERN_SUMMARY_SCHEMA_VERSION;
  generatedAt: string;
  artifactDir: string;
  advisoryOnly: true;
  autoApplyGuardrails: false;
  autoCreateFollowUpIssues: false;
  artifactsAnalyzed: number;
  artifactsSkipped: number;
  reviewPatterns: PostMergeAuditReviewPatternDto[];
  failurePatterns: PostMergeAuditFailurePatternDto[];
  recoveryPatterns: PostMergeAuditRecoveryPatternDto[];
}

function normalizeText(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

function slugify(value: string): string {
  return normalizeText(value).replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

function compareNumbersAscending(left: number, right: number): number {
  return left - right;
}

function compareStringsAscending(left: string, right: string): number {
  return left.localeCompare(right, "en");
}

function compareNullableDescending(left: string | null, right: string | null): number {
  if (left === right) {
    return 0;
  }
  if (left === null) {
    return 1;
  }
  if (right === null) {
    return -1;
  }

  return right.localeCompare(left, "en");
}

function isActionableSeverity(value: unknown): value is ActionableSeverity {
  return value === "low" || value === "medium" || value === "high";
}

function isLocalReviewRootCauseSummary(value: unknown): value is LocalReviewRootCauseSummary {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }

  const candidate = value as Partial<LocalReviewRootCauseSummary>;
  return typeof candidate.summary === "string" && isActionableSeverity(candidate.severity);
}

function isPostMergeAuditArtifact(value: unknown): value is PostMergeAuditArtifact {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }

  const candidate = value as Partial<PostMergeAuditArtifact>;
  return (
    candidate.schemaVersion === 1 &&
    typeof candidate.issueNumber === "number" &&
    typeof candidate.capturedAt === "string" &&
    !!candidate.issue &&
    typeof candidate.issue.number === "number" &&
    !!candidate.failureTaxonomy
  );
}

async function readPersistedPostMergeAuditArtifacts(artifactDir: string): Promise<{
  artifacts: PostMergeAuditArtifact[];
  skippedCount: number;
}> {
  try {
    const directoryEntries = await fs.readdir(artifactDir, { withFileTypes: true });
    const jsonFiles = directoryEntries
      .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
      .map((entry) => entry.name)
      .sort(compareStringsAscending);
    const artifacts: PostMergeAuditArtifact[] = [];
    let skippedCount = 0;

    for (const fileName of jsonFiles) {
      try {
        const raw = JSON.parse(await fs.readFile(path.join(artifactDir, fileName), "utf8")) as unknown;
        if (!isPostMergeAuditArtifact(raw)) {
          skippedCount += 1;
          continue;
        }
        artifacts.push(raw);
      } catch {
        skippedCount += 1;
      }
    }

    return { artifacts, skippedCount };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return { artifacts: [], skippedCount: 0 };
    }
    throw error;
  }
}

function buildReviewPatternKey(rootCause: LocalReviewRootCauseSummary): string {
  return [
    rootCause.category ?? "uncategorized",
    rootCause.severity,
    slugify(rootCause.summary),
  ].join(":");
}

function buildFailurePatternKey(artifact: PostMergeAuditArtifact): string | null {
  const latestFailure = artifact.failureTaxonomy.latestFailure;
  if (!latestFailure) {
    return null;
  }
  if (latestFailure.signature) {
    return latestFailure.signature;
  }

  return [
    latestFailure.category ?? "uncategorized",
    latestFailure.failureKind ?? "none",
    latestFailure.blockedReason ?? "none",
    latestFailure.summary ? slugify(latestFailure.summary) : "unspecified",
  ].join(":");
}

function normalizeRecoveryKey(reason: string): string {
  return reason.split(":")[0]!.trim();
}

export async function summarizePostMergeAuditPatterns(
  config: Pick<SupervisorConfig, "localReviewArtifactDir" | "repoSlug">,
): Promise<PostMergeAuditPatternSummaryDto> {
  const artifactDir = postMergeAuditArtifactDir(config);
  const { artifacts, skippedCount } = await readPersistedPostMergeAuditArtifacts(artifactDir);

  const reviewPatterns = new Map<string, {
    key: string;
    summary: string;
    category: string | null;
    severity: ActionableSeverity;
    artifactNumbers: Set<number>;
    evidenceCount: number;
    findingKeys: Set<string>;
  }>();
  const failurePatterns = new Map<string, {
    key: string;
    category: string | null;
    failureKind: string | null;
    blockedReason: string | null;
    summary: string | null;
    artifactNumbers: Set<number>;
    repeatedCount: number;
    lastSeenAt: string | null;
  }>();
  const recoveryPatterns = new Map<string, {
    key: string;
    reason: string;
    artifactNumbers: Set<number>;
    occurrenceCount: number;
    latestRecoveredAt: string | null;
  }>();

  for (const artifact of artifacts) {
    for (const rootCause of artifact.localReview?.artifact?.rootCauseSummaries ?? []) {
      if (!isLocalReviewRootCauseSummary(rootCause)) {
        continue;
      }
      const key = buildReviewPatternKey(rootCause);
      const existing = reviewPatterns.get(key);
      if (existing) {
        existing.artifactNumbers.add(artifact.issueNumber);
        existing.evidenceCount += rootCause.findingsCount;
        for (const findingKey of rootCause.findingKeys) {
          existing.findingKeys.add(findingKey);
        }
        continue;
      }
      reviewPatterns.set(key, {
        key,
        summary: rootCause.summary.trim(),
        category: rootCause.category,
        severity: rootCause.severity,
        artifactNumbers: new Set([artifact.issueNumber]),
        evidenceCount: rootCause.findingsCount,
        findingKeys: new Set(rootCause.findingKeys),
      });
    }

    const failureKey = buildFailurePatternKey(artifact);
    const latestFailure = artifact.failureTaxonomy.latestFailure;
    if (failureKey && latestFailure) {
      const existing = failurePatterns.get(failureKey);
      if (existing) {
        existing.artifactNumbers.add(artifact.issueNumber);
        existing.repeatedCount += latestFailure.repeatedCount;
        if ((existing.lastSeenAt ?? "") < (latestFailure.updatedAt ?? "")) {
          existing.lastSeenAt = latestFailure.updatedAt;
        }
      } else {
        failurePatterns.set(failureKey, {
          key: failureKey,
          category: latestFailure.category,
          failureKind: latestFailure.failureKind,
          blockedReason: latestFailure.blockedReason,
          summary: latestFailure.summary,
          artifactNumbers: new Set([artifact.issueNumber]),
          repeatedCount: latestFailure.repeatedCount,
          lastSeenAt: latestFailure.updatedAt,
        });
      }
    }

    const latestRecovery = artifact.failureTaxonomy.latestRecovery;
    if (latestRecovery?.reason) {
      const key = normalizeRecoveryKey(latestRecovery.reason);
      const existing = recoveryPatterns.get(key);
      if (existing) {
        existing.artifactNumbers.add(artifact.issueNumber);
        existing.occurrenceCount += latestRecovery.occurrenceCount ?? 1;
        if ((existing.latestRecoveredAt ?? "") < (latestRecovery.at ?? "")) {
          existing.latestRecoveredAt = latestRecovery.at;
        }
      } else {
        recoveryPatterns.set(key, {
          key,
          reason: latestRecovery.reason,
          artifactNumbers: new Set([artifact.issueNumber]),
          occurrenceCount: latestRecovery.occurrenceCount ?? 1,
          latestRecoveredAt: latestRecovery.at,
        });
      }
    }
  }

  return {
    schemaVersion: POST_MERGE_AUDIT_PATTERN_SUMMARY_SCHEMA_VERSION,
    generatedAt: nowIso(),
    artifactDir,
    advisoryOnly: true,
    autoApplyGuardrails: false,
    autoCreateFollowUpIssues: false,
    artifactsAnalyzed: artifacts.length,
    artifactsSkipped: skippedCount,
    reviewPatterns: [...reviewPatterns.values()]
      .map((pattern) => ({
        key: pattern.key,
        summary: pattern.summary,
        category: pattern.category,
        severity: pattern.severity,
        artifactCount: pattern.artifactNumbers.size,
        evidenceCount: pattern.evidenceCount,
        exampleIssueNumbers: [...pattern.artifactNumbers].sort(compareNumbersAscending),
        exampleFindingKeys: [...pattern.findingKeys].sort(compareStringsAscending).slice(0, 3),
      }))
      .sort((left, right) =>
        right.artifactCount - left.artifactCount ||
        right.evidenceCount - left.evidenceCount ||
        compareStringsAscending(left.key, right.key)),
    failurePatterns: [...failurePatterns.values()]
      .map((pattern) => ({
        key: pattern.key,
        category: pattern.category,
        failureKind: pattern.failureKind,
        blockedReason: pattern.blockedReason,
        summary: pattern.summary,
        artifactCount: pattern.artifactNumbers.size,
        repeatedCount: pattern.repeatedCount,
        exampleIssueNumbers: [...pattern.artifactNumbers].sort(compareNumbersAscending),
        lastSeenAt: pattern.lastSeenAt,
      }))
      .sort((left, right) =>
        right.artifactCount - left.artifactCount ||
        right.repeatedCount - left.repeatedCount ||
        compareNullableDescending(left.lastSeenAt, right.lastSeenAt) ||
        compareStringsAscending(left.key, right.key)),
    recoveryPatterns: [...recoveryPatterns.values()]
      .map((pattern) => ({
        key: pattern.key,
        reason: pattern.reason,
        artifactCount: pattern.artifactNumbers.size,
        occurrenceCount: pattern.occurrenceCount,
        exampleIssueNumbers: [...pattern.artifactNumbers].sort(compareNumbersAscending),
        latestRecoveredAt: pattern.latestRecoveredAt,
      }))
      .sort((left, right) =>
        right.artifactCount - left.artifactCount ||
        right.occurrenceCount - left.occurrenceCount ||
        compareNullableDescending(left.latestRecoveredAt, right.latestRecoveredAt) ||
        compareStringsAscending(left.key, right.key)),
  };
}

export function renderPostMergeAuditPatternSummaryDto(dto: PostMergeAuditPatternSummaryDto): string {
  return JSON.stringify(dto);
}
