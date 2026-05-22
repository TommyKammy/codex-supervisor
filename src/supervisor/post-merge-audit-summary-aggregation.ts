import fs from "node:fs/promises";
import path from "node:path";
import { TRUSTED_GENERATED_DURABLE_ARTIFACT_PROVENANCE_VALUE } from "../durable-artifact-provenance";
import type { ExternalReviewMissArtifact, ExternalReviewRegressionCandidate } from "../external-review/external-review-miss-artifact-types";
import type { ActionableSeverity, LocalReviewRootCauseSummary } from "../local-review/types";
import type { OperatorAuditBundleDto } from "../operator-audit-bundle";
import { hasMatchingPromotionIdentity } from "../persisted-artifact-promotion";
import type { PostMergeAuditArtifact } from "./post-merge-audit-artifact";
import {
  isPostMergeAuditActionableSeverity as isActionableSeverity,
  type PostMergeAuditFailurePatternDto,
  type PostMergeAuditFollowUpCandidateDto,
  type PostMergeAuditRecoveryPatternDto,
  type PostMergeAuditReleaseNotesSourceDto,
  type PostMergeAuditReviewPatternDto,
} from "./post-merge-audit-summary-schema";

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


function isPlainObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function isLocalReviewRootCauseSummary(value: unknown): value is LocalReviewRootCauseSummary {
  if (!isPlainObject(value)) {
    return false;
  }

  const candidate = value as Partial<LocalReviewRootCauseSummary>;
  return typeof candidate.summary === "string" && isActionableSeverity(candidate.severity);
}

function isPostMergeAuditArtifact(value: unknown): value is PostMergeAuditArtifact {
  if (!isPlainObject(value)) {
    return false;
  }

  const candidate = value as Partial<PostMergeAuditArtifact>;
  return (
    candidate.codexSupervisorProvenance === TRUSTED_GENERATED_DURABLE_ARTIFACT_PROVENANCE_VALUE &&
    candidate.schemaVersion === 1 &&
    typeof candidate.issueNumber === "number" &&
    typeof candidate.capturedAt === "string" &&
    !!candidate.issue &&
    typeof candidate.issue.number === "number" &&
    !!candidate.failureTaxonomy
  );
}

function isPromotablePostMergeAuditArtifact(artifact: PostMergeAuditArtifact): boolean {
  const localReviewArtifact = artifact.localReview?.artifact;
  if (!localReviewArtifact) {
    return true;
  }

  return hasMatchingPromotionIdentity(localReviewArtifact, {
    issueNumber: artifact.issue.number,
    prNumber: artifact.pullRequest.number,
    branch: artifact.pullRequest.headRefName,
    headSha: artifact.pullRequest.headRefOid,
  });
}

function isExternalReviewRegressionCandidate(value: unknown): value is ExternalReviewRegressionCandidate {
  if (!isPlainObject(value)) {
    return false;
  }

  const candidate = value as Partial<ExternalReviewRegressionCandidate>;
  return (
    typeof candidate.id === "string" &&
    typeof candidate.title === "string" &&
    typeof candidate.file === "string" &&
    typeof candidate.line === "number" &&
    Number.isInteger(candidate.line) &&
    candidate.line > 0 &&
    typeof candidate.summary === "string" &&
    typeof candidate.rationale === "string" &&
    typeof candidate.reviewerLogin === "string" &&
    typeof candidate.sourceId === "string" &&
    (candidate.sourceThreadId === null || typeof candidate.sourceThreadId === "string") &&
    (candidate.sourceUrl === null || typeof candidate.sourceUrl === "string")
  );
}

function isExternalReviewMissArtifact(value: unknown): value is ExternalReviewMissArtifact {
  if (!isPlainObject(value)) {
    return false;
  }

  const candidate = value as Partial<ExternalReviewMissArtifact>;
  return (
    typeof candidate.issueNumber === "number" &&
    typeof candidate.prNumber === "number" &&
    typeof candidate.branch === "string" &&
    typeof candidate.headSha === "string" &&
    Array.isArray(candidate.regressionTestCandidates) &&
    candidate.regressionTestCandidates.every((entry) => isExternalReviewRegressionCandidate(entry))
  );
}

function isEvidence(
  value: unknown,
  availableValueGuard: (evidenceValue: unknown) => boolean = (evidenceValue) => evidenceValue !== null,
): value is { status: "available" | "missing"; summary: string; value: unknown } {
  if (!isPlainObject(value)) {
    return false;
  }

  return (
    (value.status === "available" || value.status === "missing") &&
    typeof value.summary === "string" &&
    (value.status === "missing" ? value.value === null : availableValueGuard(value.value))
  );
}

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === "string";
}

function isOperatorAuditBundleIssue(value: unknown): boolean {
  return (
    isPlainObject(value) &&
    typeof value.number === "number" &&
    typeof value.title === "string" &&
    typeof value.url === "string" &&
    typeof value.state === "string" &&
    typeof value.createdAt === "string" &&
    typeof value.updatedAt === "string" &&
    typeof value.bodySnapshot === "string"
  );
}

function isOperatorAuditBundlePullRequest(value: unknown): boolean {
  return (
    isPlainObject(value) &&
    typeof value.number === "number" &&
    typeof value.title === "string" &&
    typeof value.url === "string" &&
    typeof value.state === "string" &&
    typeof value.isDraft === "boolean" &&
    typeof value.headRefName === "string" &&
    typeof value.headRefOid === "string" &&
    typeof value.createdAt === "string" &&
    isNullableString(value.mergedAt)
  );
}

function isOperatorAuditBundleLocalCi(value: unknown): boolean {
  return isPlainObject(value) && typeof value.summary === "string";
}

function isOperatorAuditBundlePathHygiene(value: unknown): boolean {
  return isPlainObject(value) && typeof value.summary === "string";
}

function isOperatorAuditBundleJournal(value: unknown): boolean {
  return isPlainObject(value) && (value.whatChanged === null || typeof value.whatChanged === "string");
}

function isOperatorAuditBundle(value: unknown): value is OperatorAuditBundleDto {
  if (!isPlainObject(value)) {
    return false;
  }

  const candidate = value as Record<string, unknown>;
  return (
    candidate.schemaVersion === 1 &&
    candidate.advisoryOnly === true &&
    isOperatorAuditBundleIssue(candidate.issue) &&
    isEvidence(candidate.pullRequest, isOperatorAuditBundlePullRequest) &&
    isEvidence(candidate.stateRecord) &&
    isEvidence(candidate.journal, isOperatorAuditBundleJournal) &&
    isEvidence(candidate.localCi, isOperatorAuditBundleLocalCi) &&
    isEvidence(candidate.pathHygiene, isOperatorAuditBundlePathHygiene) &&
    isEvidence(candidate.staleConfiguredBotRemediation) &&
    isEvidence(candidate.recoveryEvents, Array.isArray) &&
    (candidate.timeline === null || isPlainObject(candidate.timeline)) &&
    isEvidence(
      candidate.verificationCommands,
      (evidenceValue) => Array.isArray(evidenceValue) && evidenceValue.every((command) => typeof command === "string"),
    )
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

async function readExternalReviewMissArtifactSafely(artifactPath: string | null): Promise<ExternalReviewMissArtifact | null> {
  if (!artifactPath) {
    return null;
  }

  try {
    const raw = JSON.parse(await fs.readFile(artifactPath, "utf8")) as unknown;
    return isExternalReviewMissArtifact(raw) ? raw : null;
  } catch {
    return null;
  }
}

function matchesExternalReviewMissArtifact(
  artifact: PostMergeAuditArtifact,
  missArtifact: ExternalReviewMissArtifact,
): boolean {
  return (
    artifact.pullRequest !== null &&
    missArtifact.issueNumber === artifact.issue.number &&
    missArtifact.prNumber === artifact.pullRequest.number &&
    missArtifact.branch === artifact.branch &&
    missArtifact.headSha === artifact.pullRequest.headRefOid
  );
}

function availableBundleValue<T>(evidence: { status: string; value: T | null } | undefined): T | null {
  return evidence?.status === "available" ? evidence.value : null;
}

function buildReleaseNotesSource(
  artifact: PostMergeAuditArtifact,
  followUpCandidateKeys: string[],
): PostMergeAuditReleaseNotesSourceDto {
  const bundle = isOperatorAuditBundle(artifact.operatorAuditBundle) ? artifact.operatorAuditBundle : null;
  const localCi = availableBundleValue(bundle?.localCi);
  const journal = availableBundleValue(bundle?.journal);
  const verificationCommands = availableBundleValue(bundle?.verificationCommands) ?? [];
  const findingSummaries = (artifact.localReview?.artifact?.rootCauseSummaries ?? [])
    .filter(isLocalReviewRootCauseSummary)
    .map((rootCause) => rootCause.summary.trim())
    .filter((summary) => summary.length > 0)
    .sort(compareStringsAscending);

  return {
    issue: {
      number: artifact.issue.number,
      title: bundle?.issue.title ?? artifact.issue.title,
      url: bundle?.issue.url ?? artifact.issue.url,
    },
    pullRequest: {
      number: artifact.pullRequest.number,
      title: bundle?.pullRequest?.status === "available" && bundle.pullRequest.value
        ? bundle.pullRequest.value.title
        : artifact.pullRequest.title,
      url: bundle?.pullRequest?.status === "available" && bundle.pullRequest.value
        ? bundle.pullRequest.value.url
        : artifact.pullRequest.url,
      mergedAt: artifact.pullRequest.mergedAt,
      headRefOid: artifact.pullRequest.headRefOid,
    },
    auditBundle: {
      status: bundle ? "available" : "missing",
      localCiSummary: localCi?.summary ?? bundle?.localCi?.summary ?? null,
      pathHygieneSummary: bundle?.pathHygiene?.summary ?? null,
      journalSummary: journal?.whatChanged ?? bundle?.journal?.summary ?? null,
    },
    verificationCommands: [...verificationCommands],
    findingSummaries,
    followUpCandidateKeys: [...followUpCandidateKeys].sort(compareStringsAscending),
  };
}


export interface PostMergeAuditPatternAggregationResult {
  artifactsAnalyzed: number;
  artifactsSkipped: number;
  reviewPatterns: PostMergeAuditReviewPatternDto[];
  failurePatterns: PostMergeAuditFailurePatternDto[];
  recoveryPatterns: PostMergeAuditRecoveryPatternDto[];
  followUpCandidates: PostMergeAuditFollowUpCandidateDto[];
  releaseNotesSources: PostMergeAuditReleaseNotesSourceDto[];
}

export async function aggregatePostMergeAuditArtifacts(artifactDir: string): Promise<PostMergeAuditPatternAggregationResult> {
  const { artifacts, skippedCount: unreadableSkippedCount } = await readPersistedPostMergeAuditArtifacts(artifactDir);
  let artifactsAnalyzed = 0;
  let artifactsSkipped = unreadableSkippedCount;

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
  const followUpCandidates = new Map<string, PostMergeAuditFollowUpCandidateDto>();
  const releaseNotesSources: PostMergeAuditReleaseNotesSourceDto[] = [];

  for (const artifact of artifacts) {
    if (!isPromotablePostMergeAuditArtifact(artifact)) {
      artifactsSkipped += 1;
      continue;
    }
    artifactsAnalyzed += 1;

    for (const rootCause of artifact.localReview?.artifact?.rootCauseSummaries ?? []) {
      if (!isLocalReviewRootCauseSummary(rootCause)) {
        continue;
      }
      const findingsCount = typeof rootCause.findingsCount === "number" ? rootCause.findingsCount : 0;
      const findingKeys = Array.isArray(rootCause.findingKeys) ? rootCause.findingKeys : [];
      const key = buildReviewPatternKey(rootCause);
      const existing = reviewPatterns.get(key);
      if (existing) {
        existing.artifactNumbers.add(artifact.issueNumber);
        existing.evidenceCount += findingsCount;
        for (const findingKey of findingKeys) {
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
        evidenceCount: findingsCount,
        findingKeys: new Set(findingKeys),
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

    const externalReviewMissArtifact = await readExternalReviewMissArtifactSafely(artifact.artifacts.externalReviewMissesPath);
    const pullRequest = artifact.pullRequest;
    const artifactFollowUpCandidateKeys: string[] = [];
    if (externalReviewMissArtifact && pullRequest && matchesExternalReviewMissArtifact(artifact, externalReviewMissArtifact)) {
      for (const candidate of externalReviewMissArtifact.regressionTestCandidates) {
        const key = `test_regression:${artifact.issue.number}:${pullRequest.number}:${candidate.id}`;
        artifactFollowUpCandidateKeys.push(key);
        followUpCandidates.set(key, {
          key,
          category: "test_regression",
          title: candidate.title,
          summary: candidate.summary,
          rationale: candidate.rationale,
          sourcePatternKeys: [candidate.id],
          supportingIssueNumbers: [artifact.issue.number],
          supportingFindingKeys: [],
          advisoryOnly: true,
          autoCreateFollowUpIssue: false,
          evidence: {
            mergedIssueNumber: artifact.issue.number,
            mergedIssueTitle: artifact.issue.title,
            mergedPrNumber: pullRequest.number,
            mergedPrTitle: pullRequest.title,
            sourceArtifactPath: artifact.artifacts.externalReviewMissesPath!,
            sourceUrl: candidate.sourceUrl,
            sourceId: candidate.sourceId,
            sourceThreadId: candidate.sourceThreadId,
            reviewerLogin: candidate.reviewerLogin,
            file: candidate.file,
            line: candidate.line,
          },
        });
      }
    }

    releaseNotesSources.push(buildReleaseNotesSource(artifact, artifactFollowUpCandidateKeys));
  }

  const summarizedReviewPatterns = [...reviewPatterns.values()]
    .map((pattern) => ({
      key: pattern.key,
      summary: pattern.summary,
      category: pattern.category,
      severity: pattern.severity,
      artifactCount: pattern.artifactNumbers.size,
      evidenceCount: pattern.evidenceCount,
      supportingIssueNumbers: [...pattern.artifactNumbers].sort(compareNumbersAscending),
      supportingFindingKeys: [...pattern.findingKeys].sort(compareStringsAscending),
    }))
    .sort((left, right) =>
      right.artifactCount - left.artifactCount ||
      right.evidenceCount - left.evidenceCount ||
      compareStringsAscending(left.key, right.key));

  const summarizedFailurePatterns = [...failurePatterns.values()]
    .map((pattern) => ({
      key: pattern.key,
      category: pattern.category,
      failureKind: pattern.failureKind,
      blockedReason: pattern.blockedReason,
      summary: pattern.summary,
      artifactCount: pattern.artifactNumbers.size,
      repeatedCount: pattern.repeatedCount,
      supportingIssueNumbers: [...pattern.artifactNumbers].sort(compareNumbersAscending),
      lastSeenAt: pattern.lastSeenAt,
    }))
    .sort((left, right) =>
      right.artifactCount - left.artifactCount ||
      right.repeatedCount - left.repeatedCount ||
      compareNullableDescending(left.lastSeenAt, right.lastSeenAt) ||
      compareStringsAscending(left.key, right.key));

  const summarizedRecoveryPatterns = [...recoveryPatterns.values()]
    .map((pattern) => ({
      key: pattern.key,
      reason: pattern.reason,
      artifactCount: pattern.artifactNumbers.size,
      occurrenceCount: pattern.occurrenceCount,
      supportingIssueNumbers: [...pattern.artifactNumbers].sort(compareNumbersAscending),
      latestRecoveredAt: pattern.latestRecoveredAt,
    }))
    .sort((left, right) =>
      right.artifactCount - left.artifactCount ||
      right.occurrenceCount - left.occurrenceCount ||
      compareNullableDescending(left.latestRecoveredAt, right.latestRecoveredAt) ||
      compareStringsAscending(left.key, right.key));

  const summarizedFollowUpCandidates = [...followUpCandidates.values()].sort((left, right) =>
    right.evidence.mergedIssueNumber - left.evidence.mergedIssueNumber ||
    right.evidence.mergedPrNumber - left.evidence.mergedPrNumber ||
    compareStringsAscending(left.key, right.key));
  const summarizedReleaseNotesSources = releaseNotesSources.sort((left, right) =>
    right.issue.number - left.issue.number ||
    right.pullRequest.number - left.pullRequest.number);

  return {
    artifactsAnalyzed,
    artifactsSkipped,
    reviewPatterns: summarizedReviewPatterns,
    failurePatterns: summarizedFailurePatterns,
    recoveryPatterns: summarizedRecoveryPatterns,
    followUpCandidates: summarizedFollowUpCandidates,
    releaseNotesSources: summarizedReleaseNotesSources,
  };
}
