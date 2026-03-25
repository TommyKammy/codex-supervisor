import fs from "node:fs/promises";
import path from "node:path";
import { nowIso } from "../core/utils";
import type { SupervisorConfig } from "../core/types";
import type { ActionableSeverity, LocalReviewRootCauseSummary } from "../local-review/types";
import type { PostMergeAuditArtifact } from "./post-merge-audit-artifact";
import { postMergeAuditArtifactDir } from "./post-merge-audit-artifact";

export const POST_MERGE_AUDIT_PATTERN_SUMMARY_SCHEMA_VERSION = 3;
export const POST_MERGE_AUDIT_PATTERN_SUMMARY_TOP_LEVEL_KEYS = [
  "schemaVersion",
  "generatedAt",
  "artifactDir",
  "advisoryOnly",
  "autoApplyGuardrails",
  "autoCreateFollowUpIssues",
  "artifactsAnalyzed",
  "artifactsSkipped",
  "reviewPatterns",
  "failurePatterns",
  "recoveryPatterns",
  "promotionCandidates",
] as const;
const POST_MERGE_AUDIT_REVIEW_PATTERN_KEYS = [
  "key",
  "summary",
  "category",
  "severity",
  "artifactCount",
  "evidenceCount",
  "supportingIssueNumbers",
  "supportingFindingKeys",
] as const;
const POST_MERGE_AUDIT_FAILURE_PATTERN_KEYS = [
  "key",
  "category",
  "failureKind",
  "blockedReason",
  "summary",
  "artifactCount",
  "repeatedCount",
  "supportingIssueNumbers",
  "lastSeenAt",
] as const;
const POST_MERGE_AUDIT_RECOVERY_PATTERN_KEYS = [
  "key",
  "reason",
  "artifactCount",
  "occurrenceCount",
  "supportingIssueNumbers",
  "latestRecoveredAt",
] as const;
const POST_MERGE_AUDIT_PROMOTION_CANDIDATE_KEYS = [
  "key",
  "category",
  "title",
  "summary",
  "rationale",
  "sourcePatternKeys",
  "supportingIssueNumbers",
  "supportingFindingKeys",
  "advisoryOnly",
  "autoApply",
  "autoCreateFollowUpIssue",
] as const;

export interface PostMergeAuditReviewPatternDto {
  key: string;
  summary: string;
  category: string | null;
  severity: ActionableSeverity;
  artifactCount: number;
  evidenceCount: number;
  supportingIssueNumbers: number[];
  supportingFindingKeys: string[];
}

export interface PostMergeAuditFailurePatternDto {
  key: string;
  category: string | null;
  failureKind: string | null;
  blockedReason: string | null;
  summary: string | null;
  artifactCount: number;
  repeatedCount: number;
  supportingIssueNumbers: number[];
  lastSeenAt: string | null;
}

export interface PostMergeAuditRecoveryPatternDto {
  key: string;
  reason: string;
  artifactCount: number;
  occurrenceCount: number;
  supportingIssueNumbers: number[];
  latestRecoveredAt: string | null;
}

export type PostMergeAuditPromotionCategoryDto = "shared_memory" | "guardrail" | "checklist" | "documentation";

export interface PostMergeAuditPromotionCandidateDto {
  key: string;
  category: PostMergeAuditPromotionCategoryDto;
  title: string;
  summary: string;
  rationale: string;
  sourcePatternKeys: string[];
  supportingIssueNumbers: number[];
  supportingFindingKeys: string[];
  advisoryOnly: true;
  autoApply: false;
  autoCreateFollowUpIssue: false;
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
  promotionCandidates: PostMergeAuditPromotionCandidateDto[];
}

function failSummaryValidation(message: string): never {
  throw new Error(`Invalid post-merge audit pattern summary: ${message}`);
}

function formatSummaryKeyList(keys: readonly string[]): string {
  if (keys.length <= 1) {
    return keys.join("");
  }

  return `${keys.slice(0, -1).join(", ")}, and ${keys.at(-1)}`;
}

function expectSummaryObject(value: unknown, field: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    failSummaryValidation(`${field} must be an object.`);
  }

  return value as Record<string, unknown>;
}

function expectExactKeys(
  value: Record<string, unknown>,
  keys: readonly string[],
  field: string,
): void {
  const actualKeys = Object.keys(value);
  if (actualKeys.length !== keys.length || keys.some((key) => !actualKeys.includes(key))) {
    failSummaryValidation(`${field} must contain ${formatSummaryKeyList(keys)}.`);
  }
}

function expectSummaryString(value: unknown, field: string): string {
  if (typeof value !== "string") {
    failSummaryValidation(`${field} must be a string.`);
  }

  return value;
}

function expectNullableSummaryString(value: unknown, field: string): string | null {
  if (value === null) {
    return null;
  }

  return expectSummaryString(value, field);
}

function expectSummaryBoolean(value: unknown, field: string): boolean {
  if (typeof value !== "boolean") {
    failSummaryValidation(`${field} must be a boolean.`);
  }

  return value;
}

function expectSummaryInteger(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    failSummaryValidation(`${field} must be a non-negative integer.`);
  }

  return value;
}

function expectStringArray(value: unknown, field: string): string[] {
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string")) {
    failSummaryValidation(`${field} must be an array of strings.`);
  }

  return [...value];
}

function expectIntegerArray(value: unknown, field: string): number[] {
  if (!Array.isArray(value) || value.some((entry) => !Number.isInteger(entry) || entry < 0)) {
    failSummaryValidation(`${field} must be an array of non-negative integers.`);
  }

  return [...value];
}

function expectReviewPattern(value: unknown, index: number): PostMergeAuditReviewPatternDto {
  const pattern = expectSummaryObject(value, `reviewPatterns[${index}]`);
  expectExactKeys(pattern, POST_MERGE_AUDIT_REVIEW_PATTERN_KEYS, `reviewPatterns[${index}]`);
  const severity = expectSummaryString(pattern.severity, `reviewPatterns[${index}].severity`);
  if (!isActionableSeverity(severity)) {
    failSummaryValidation(`reviewPatterns[${index}].severity must be one of: low, medium, high.`);
  }

  return {
    key: expectSummaryString(pattern.key, `reviewPatterns[${index}].key`),
    summary: expectSummaryString(pattern.summary, `reviewPatterns[${index}].summary`),
    category: expectNullableSummaryString(pattern.category, `reviewPatterns[${index}].category`),
    severity,
    artifactCount: expectSummaryInteger(pattern.artifactCount, `reviewPatterns[${index}].artifactCount`),
    evidenceCount: expectSummaryInteger(pattern.evidenceCount, `reviewPatterns[${index}].evidenceCount`),
    supportingIssueNumbers: expectIntegerArray(
      pattern.supportingIssueNumbers,
      `reviewPatterns[${index}].supportingIssueNumbers`,
    ),
    supportingFindingKeys: expectStringArray(
      pattern.supportingFindingKeys,
      `reviewPatterns[${index}].supportingFindingKeys`,
    ),
  };
}

function expectFailurePattern(value: unknown, index: number): PostMergeAuditFailurePatternDto {
  const pattern = expectSummaryObject(value, `failurePatterns[${index}]`);
  expectExactKeys(pattern, POST_MERGE_AUDIT_FAILURE_PATTERN_KEYS, `failurePatterns[${index}]`);

  return {
    key: expectSummaryString(pattern.key, `failurePatterns[${index}].key`),
    category: expectNullableSummaryString(pattern.category, `failurePatterns[${index}].category`),
    failureKind: expectNullableSummaryString(pattern.failureKind, `failurePatterns[${index}].failureKind`),
    blockedReason: expectNullableSummaryString(pattern.blockedReason, `failurePatterns[${index}].blockedReason`),
    summary: expectNullableSummaryString(pattern.summary, `failurePatterns[${index}].summary`),
    artifactCount: expectSummaryInteger(pattern.artifactCount, `failurePatterns[${index}].artifactCount`),
    repeatedCount: expectSummaryInteger(pattern.repeatedCount, `failurePatterns[${index}].repeatedCount`),
    supportingIssueNumbers: expectIntegerArray(
      pattern.supportingIssueNumbers,
      `failurePatterns[${index}].supportingIssueNumbers`,
    ),
    lastSeenAt: expectNullableSummaryString(pattern.lastSeenAt, `failurePatterns[${index}].lastSeenAt`),
  };
}

function expectRecoveryPattern(value: unknown, index: number): PostMergeAuditRecoveryPatternDto {
  const pattern = expectSummaryObject(value, `recoveryPatterns[${index}]`);
  expectExactKeys(pattern, POST_MERGE_AUDIT_RECOVERY_PATTERN_KEYS, `recoveryPatterns[${index}]`);

  return {
    key: expectSummaryString(pattern.key, `recoveryPatterns[${index}].key`),
    reason: expectSummaryString(pattern.reason, `recoveryPatterns[${index}].reason`),
    artifactCount: expectSummaryInteger(pattern.artifactCount, `recoveryPatterns[${index}].artifactCount`),
    occurrenceCount: expectSummaryInteger(pattern.occurrenceCount, `recoveryPatterns[${index}].occurrenceCount`),
    supportingIssueNumbers: expectIntegerArray(
      pattern.supportingIssueNumbers,
      `recoveryPatterns[${index}].supportingIssueNumbers`,
    ),
    latestRecoveredAt: expectNullableSummaryString(
      pattern.latestRecoveredAt,
      `recoveryPatterns[${index}].latestRecoveredAt`,
    ),
  };
}

function expectPromotionCategory(value: unknown, field: string): PostMergeAuditPromotionCategoryDto {
  if (value !== "shared_memory" && value !== "guardrail" && value !== "checklist" && value !== "documentation") {
    failSummaryValidation(`${field} must be one of: shared_memory, guardrail, checklist, documentation.`);
  }

  return value;
}

function expectPromotionCandidate(value: unknown, index: number): PostMergeAuditPromotionCandidateDto {
  const candidate = expectSummaryObject(value, `promotionCandidates[${index}]`);
  expectExactKeys(candidate, POST_MERGE_AUDIT_PROMOTION_CANDIDATE_KEYS, `promotionCandidates[${index}]`);

  if (candidate.advisoryOnly !== true) {
    failSummaryValidation(`promotionCandidates[${index}].advisoryOnly must be true.`);
  }
  if (candidate.autoApply !== false) {
    failSummaryValidation(`promotionCandidates[${index}].autoApply must be false.`);
  }
  if (candidate.autoCreateFollowUpIssue !== false) {
    failSummaryValidation(`promotionCandidates[${index}].autoCreateFollowUpIssue must be false.`);
  }

  return {
    key: expectSummaryString(candidate.key, `promotionCandidates[${index}].key`),
    category: expectPromotionCategory(candidate.category, `promotionCandidates[${index}].category`),
    title: expectSummaryString(candidate.title, `promotionCandidates[${index}].title`),
    summary: expectSummaryString(candidate.summary, `promotionCandidates[${index}].summary`),
    rationale: expectSummaryString(candidate.rationale, `promotionCandidates[${index}].rationale`),
    sourcePatternKeys: expectStringArray(
      candidate.sourcePatternKeys,
      `promotionCandidates[${index}].sourcePatternKeys`,
    ),
    supportingIssueNumbers: expectIntegerArray(
      candidate.supportingIssueNumbers,
      `promotionCandidates[${index}].supportingIssueNumbers`,
    ),
    supportingFindingKeys: expectStringArray(
      candidate.supportingFindingKeys,
      `promotionCandidates[${index}].supportingFindingKeys`,
    ),
    advisoryOnly: true,
    autoApply: false,
    autoCreateFollowUpIssue: false,
  };
}

export function validatePostMergeAuditPatternSummary(raw: unknown): PostMergeAuditPatternSummaryDto {
  const summary = expectSummaryObject(raw, "summary");
  expectExactKeys(summary, POST_MERGE_AUDIT_PATTERN_SUMMARY_TOP_LEVEL_KEYS, "summary");
  if (summary.schemaVersion !== POST_MERGE_AUDIT_PATTERN_SUMMARY_SCHEMA_VERSION) {
    failSummaryValidation(`schemaVersion must be ${POST_MERGE_AUDIT_PATTERN_SUMMARY_SCHEMA_VERSION}.`);
  }
  if (summary.advisoryOnly !== true) {
    failSummaryValidation("advisoryOnly must be true.");
  }
  if (summary.autoApplyGuardrails !== false) {
    failSummaryValidation("autoApplyGuardrails must be false.");
  }
  if (summary.autoCreateFollowUpIssues !== false) {
    failSummaryValidation("autoCreateFollowUpIssues must be false.");
  }
  if (!Array.isArray(summary.reviewPatterns)) {
    failSummaryValidation("reviewPatterns must be an array.");
  }
  if (!Array.isArray(summary.failurePatterns)) {
    failSummaryValidation("failurePatterns must be an array.");
  }
  if (!Array.isArray(summary.recoveryPatterns)) {
    failSummaryValidation("recoveryPatterns must be an array.");
  }
  if (!Array.isArray(summary.promotionCandidates)) {
    failSummaryValidation("promotionCandidates must be an array.");
  }

  return {
    schemaVersion: POST_MERGE_AUDIT_PATTERN_SUMMARY_SCHEMA_VERSION,
    generatedAt: expectSummaryString(summary.generatedAt, "generatedAt"),
    artifactDir: expectSummaryString(summary.artifactDir, "artifactDir"),
    advisoryOnly: true,
    autoApplyGuardrails: false,
    autoCreateFollowUpIssues: false,
    artifactsAnalyzed: expectSummaryInteger(summary.artifactsAnalyzed, "artifactsAnalyzed"),
    artifactsSkipped: expectSummaryInteger(summary.artifactsSkipped, "artifactsSkipped"),
    reviewPatterns: summary.reviewPatterns.map((pattern, index) => expectReviewPattern(pattern, index)),
    failurePatterns: summary.failurePatterns.map((pattern, index) => expectFailurePattern(pattern, index)),
    recoveryPatterns: summary.recoveryPatterns.map((pattern, index) => expectRecoveryPattern(pattern, index)),
    promotionCandidates: summary.promotionCandidates.map((candidate, index) => expectPromotionCandidate(candidate, index)),
  };
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

function shouldPromoteReviewPattern(pattern: Pick<PostMergeAuditReviewPatternDto, "artifactCount">): boolean {
  return pattern.artifactCount >= 2;
}

function shouldPromoteFailurePattern(pattern: Pick<PostMergeAuditFailurePatternDto, "artifactCount">): boolean {
  return pattern.artifactCount >= 2;
}

function shouldPromoteRecoveryPattern(pattern: Pick<PostMergeAuditRecoveryPatternDto, "artifactCount">): boolean {
  return pattern.artifactCount >= 2;
}

function createReviewPromotionCandidates(
  pattern: PostMergeAuditReviewPatternDto,
): PostMergeAuditPromotionCandidateDto[] {
  if (!shouldPromoteReviewPattern(pattern)) {
    return [];
  }

  const summaryLabel = pattern.summary.replace(/\.$/u, "");
  return [
    {
      key: `guardrail:${slugify(pattern.key)}`,
      category: "guardrail",
      title: `Promote guardrail for ${summaryLabel}`,
      summary: `Recurring review pattern: ${pattern.summary}`,
      rationale: `This ${pattern.severity}-severity review pattern recurred across ${pattern.artifactCount} post-merge audits.`,
      sourcePatternKeys: [pattern.key],
      supportingIssueNumbers: [...pattern.supportingIssueNumbers],
      supportingFindingKeys: [...pattern.supportingFindingKeys],
      advisoryOnly: true,
      autoApply: false,
      autoCreateFollowUpIssue: false,
    },
    {
      key: `shared_memory:${slugify(pattern.key)}`,
      category: "shared_memory",
      title: `Promote shared memory for ${summaryLabel}`,
      summary: `Capture the recurring lesson behind: ${pattern.summary}`,
      rationale: `The same review lesson appeared in ${pattern.artifactCount} merged issues and should stay queryable for future sessions.`,
      sourcePatternKeys: [pattern.key],
      supportingIssueNumbers: [...pattern.supportingIssueNumbers],
      supportingFindingKeys: [...pattern.supportingFindingKeys],
      advisoryOnly: true,
      autoApply: false,
      autoCreateFollowUpIssue: false,
    },
  ];
}

function createFailurePromotionCandidates(
  pattern: PostMergeAuditFailurePatternDto,
): PostMergeAuditPromotionCandidateDto[] {
  if (!shouldPromoteFailurePattern(pattern)) {
    return [];
  }

  const summary = pattern.summary ?? "Recurring post-merge failure pattern.";
  const category: PostMergeAuditPromotionCategoryDto =
    pattern.blockedReason === "requirements" ? "documentation" : "checklist";

  return [
    {
      key: `${category}:${slugify(pattern.key)}`,
      category,
      title:
        category === "documentation"
          ? `Document recurring failure pattern ${pattern.key}`
          : `Add checklist coverage for recurring failure pattern ${pattern.key}`,
      summary,
      rationale: `The same failure pattern recurred across ${pattern.artifactCount} post-merge audits with ${pattern.repeatedCount} total repeats.`,
      sourcePatternKeys: [pattern.key],
      supportingIssueNumbers: [...pattern.supportingIssueNumbers],
      supportingFindingKeys: [],
      advisoryOnly: true,
      autoApply: false,
      autoCreateFollowUpIssue: false,
    },
  ];
}

function createRecoveryPromotionCandidates(
  pattern: PostMergeAuditRecoveryPatternDto,
): PostMergeAuditPromotionCandidateDto[] {
  if (!shouldPromoteRecoveryPattern(pattern)) {
    return [];
  }

  return [
    {
      key: `documentation:${pattern.key}`,
      category: "documentation",
      title: `Document recovery workflow for ${pattern.key}`,
      summary: pattern.reason,
      rationale: `Operators recovered this way in ${pattern.artifactCount} post-merge audits, so the workflow is a documentation candidate.`,
      sourcePatternKeys: [pattern.key],
      supportingIssueNumbers: [...pattern.supportingIssueNumbers],
      supportingFindingKeys: [],
      advisoryOnly: true,
      autoApply: false,
      autoCreateFollowUpIssue: false,
    },
  ];
}

function comparePromotionCategory(left: PostMergeAuditPromotionCategoryDto, right: PostMergeAuditPromotionCategoryDto): number {
  const order: PostMergeAuditPromotionCategoryDto[] = ["guardrail", "shared_memory", "checklist", "documentation"];
  return order.indexOf(left) - order.indexOf(right);
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

  const promotionCandidates = [
    ...summarizedReviewPatterns.flatMap((pattern) => createReviewPromotionCandidates(pattern)),
    ...summarizedFailurePatterns.flatMap((pattern) => createFailurePromotionCandidates(pattern)),
    ...summarizedRecoveryPatterns.flatMap((pattern) => createRecoveryPromotionCandidates(pattern)),
  ].sort((left, right) =>
    comparePromotionCategory(left.category, right.category) ||
    right.supportingIssueNumbers.length - left.supportingIssueNumbers.length ||
    compareStringsAscending(left.key, right.key));

  return validatePostMergeAuditPatternSummary({
    schemaVersion: POST_MERGE_AUDIT_PATTERN_SUMMARY_SCHEMA_VERSION,
    generatedAt: nowIso(),
    artifactDir,
    advisoryOnly: true,
    autoApplyGuardrails: false,
    autoCreateFollowUpIssues: false,
    artifactsAnalyzed: artifacts.length,
    artifactsSkipped: skippedCount,
    reviewPatterns: summarizedReviewPatterns,
    failurePatterns: summarizedFailurePatterns,
    recoveryPatterns: summarizedRecoveryPatterns,
    promotionCandidates,
  });
}

export function renderPostMergeAuditPatternSummaryDto(dto: PostMergeAuditPatternSummaryDto): string {
  return JSON.stringify(dto);
}
