import fs from "node:fs/promises";
import path from "node:path";
import { nowIso } from "../core/utils";
import type { SupervisorConfig } from "../core/types";
import { TRUSTED_GENERATED_DURABLE_ARTIFACT_PROVENANCE_VALUE } from "../durable-artifact-provenance";
import type { ExternalReviewMissArtifact, ExternalReviewRegressionCandidate } from "../external-review/external-review-miss-artifact-types";
import type { ActionableSeverity, LocalReviewRootCauseSummary } from "../local-review/types";
import type { OperatorAuditBundleDto } from "../operator-audit-bundle";
import { hasMatchingPromotionIdentity } from "../persisted-artifact-promotion";
import type { PostMergeAuditArtifact } from "./post-merge-audit-artifact";
import { postMergeAuditArtifactDir } from "./post-merge-audit-artifact";

export const POST_MERGE_AUDIT_PATTERN_SUMMARY_SCHEMA_VERSION = 6;
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
  "followUpCandidates",
  "promotionCandidates",
  "releaseNotesSources",
  "evaluatorWorkflow",
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
const POST_MERGE_AUDIT_FOLLOW_UP_CANDIDATE_KEYS = [
  "key",
  "category",
  "title",
  "summary",
  "rationale",
  "sourcePatternKeys",
  "supportingIssueNumbers",
  "supportingFindingKeys",
  "advisoryOnly",
  "autoCreateFollowUpIssue",
  "evidence",
] as const;
const POST_MERGE_AUDIT_FOLLOW_UP_CANDIDATE_EVIDENCE_KEYS = [
  "mergedIssueNumber",
  "mergedIssueTitle",
  "mergedPrNumber",
  "mergedPrTitle",
  "sourceArtifactPath",
  "sourceUrl",
  "sourceId",
  "sourceThreadId",
  "reviewerLogin",
  "file",
  "line",
] as const;
const POST_MERGE_AUDIT_RELEASE_NOTES_SOURCE_KEYS = [
  "issue",
  "pullRequest",
  "auditBundle",
  "verificationCommands",
  "findingSummaries",
  "followUpCandidateKeys",
] as const;
const POST_MERGE_AUDIT_RELEASE_NOTES_ISSUE_KEYS = ["number", "title", "url"] as const;
const POST_MERGE_AUDIT_RELEASE_NOTES_PULL_REQUEST_KEYS = [
  "number",
  "title",
  "url",
  "mergedAt",
  "headRefOid",
] as const;
const POST_MERGE_AUDIT_RELEASE_NOTES_AUDIT_BUNDLE_KEYS = [
  "status",
  "localCiSummary",
  "pathHygieneSummary",
  "journalSummary",
] as const;
const POST_MERGE_AUDIT_EVALUATOR_WORKFLOW_KEYS = [
  "advisoryOnly",
  "autoCreateFollowUpIssues",
  "followUpIssueCreationRequiresConfirmation",
  "reviewerSummary",
  "evaluatorSummary",
  "productSafetyFindings",
  "verificationNotes",
  "followUpIssueDrafts",
  "obsidianHistoryDraft",
] as const;
const POST_MERGE_AUDIT_EVALUATOR_PRODUCT_SAFETY_FINDING_KEYS = [
  "key",
  "severity",
  "summary",
  "evidenceIssueNumbers",
  "evidenceFindingKeys",
] as const;
const POST_MERGE_AUDIT_EVALUATOR_VERIFICATION_NOTE_KEYS = [
  "source",
  "summary",
  "evidenceIssueNumber",
] as const;
const POST_MERGE_AUDIT_EVALUATOR_FOLLOW_UP_DRAFT_KEYS = [
  "title",
  "body",
  "confirmRequired",
  "autoCreate",
  "sourceFollowUpCandidateKey",
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

export type PostMergeAuditFollowUpCategoryDto = "test_regression";

export interface PostMergeAuditFollowUpCandidateDto {
  key: string;
  category: PostMergeAuditFollowUpCategoryDto;
  title: string;
  summary: string;
  rationale: string;
  sourcePatternKeys: string[];
  supportingIssueNumbers: number[];
  supportingFindingKeys: string[];
  advisoryOnly: true;
  autoCreateFollowUpIssue: false;
  evidence: {
    mergedIssueNumber: number;
    mergedIssueTitle: string;
    mergedPrNumber: number;
    mergedPrTitle: string;
    sourceArtifactPath: string;
    sourceUrl: string | null;
    sourceId: string;
    sourceThreadId: string | null;
    reviewerLogin: string;
    file: string;
    line: number;
  };
}

export interface PostMergeAuditReleaseNotesSourceDto {
  issue: {
    number: number;
    title: string;
    url: string;
  };
  pullRequest: {
    number: number;
    title: string;
    url: string;
    mergedAt: string;
    headRefOid: string;
  };
  auditBundle: {
    status: "available" | "missing";
    localCiSummary: string | null;
    pathHygieneSummary: string | null;
    journalSummary: string | null;
  };
  verificationCommands: string[];
  findingSummaries: string[];
  followUpCandidateKeys: string[];
}

export type PostMergeAuditEvaluatorVerificationNoteSourceDto =
  | "local_ci"
  | "path_hygiene"
  | "verification_command";

export interface PostMergeAuditEvaluatorWorkflowDto {
  advisoryOnly: true;
  autoCreateFollowUpIssues: false;
  followUpIssueCreationRequiresConfirmation: true;
  reviewerSummary: string;
  evaluatorSummary: string;
  productSafetyFindings: {
    key: string;
    severity: ActionableSeverity;
    summary: string;
    evidenceIssueNumbers: number[];
    evidenceFindingKeys: string[];
  }[];
  verificationNotes: {
    source: PostMergeAuditEvaluatorVerificationNoteSourceDto;
    summary: string;
    evidenceIssueNumber: number;
  }[];
  followUpIssueDrafts: {
    title: string;
    body: string;
    confirmRequired: true;
    autoCreate: false;
    sourceFollowUpCandidateKey: string;
  }[];
  obsidianHistoryDraft: string;
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
  followUpCandidates: PostMergeAuditFollowUpCandidateDto[];
  promotionCandidates: PostMergeAuditPromotionCandidateDto[];
  releaseNotesSources: PostMergeAuditReleaseNotesSourceDto[];
  evaluatorWorkflow: PostMergeAuditEvaluatorWorkflowDto;
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

function expectFollowUpCategory(value: unknown, field: string): PostMergeAuditFollowUpCategoryDto {
  if (value !== "test_regression") {
    failSummaryValidation(`${field} must be one of: test_regression.`);
  }

  return value;
}

function expectFollowUpCandidate(
  value: unknown,
  index: number,
): PostMergeAuditFollowUpCandidateDto {
  const candidate = expectSummaryObject(value, `followUpCandidates[${index}]`);
  expectExactKeys(candidate, POST_MERGE_AUDIT_FOLLOW_UP_CANDIDATE_KEYS, `followUpCandidates[${index}]`);

  if (candidate.advisoryOnly !== true) {
    failSummaryValidation(`followUpCandidates[${index}].advisoryOnly must be true.`);
  }
  if (candidate.autoCreateFollowUpIssue !== false) {
    failSummaryValidation(`followUpCandidates[${index}].autoCreateFollowUpIssue must be false.`);
  }

  const evidence = expectSummaryObject(candidate.evidence, `followUpCandidates[${index}].evidence`);
  expectExactKeys(
    evidence,
    POST_MERGE_AUDIT_FOLLOW_UP_CANDIDATE_EVIDENCE_KEYS,
    `followUpCandidates[${index}].evidence`,
  );

  return {
    key: expectSummaryString(candidate.key, `followUpCandidates[${index}].key`),
    category: expectFollowUpCategory(candidate.category, `followUpCandidates[${index}].category`),
    title: expectSummaryString(candidate.title, `followUpCandidates[${index}].title`),
    summary: expectSummaryString(candidate.summary, `followUpCandidates[${index}].summary`),
    rationale: expectSummaryString(candidate.rationale, `followUpCandidates[${index}].rationale`),
    sourcePatternKeys: expectStringArray(
      candidate.sourcePatternKeys,
      `followUpCandidates[${index}].sourcePatternKeys`,
    ),
    supportingIssueNumbers: expectIntegerArray(
      candidate.supportingIssueNumbers,
      `followUpCandidates[${index}].supportingIssueNumbers`,
    ),
    supportingFindingKeys: expectStringArray(
      candidate.supportingFindingKeys,
      `followUpCandidates[${index}].supportingFindingKeys`,
    ),
    advisoryOnly: true,
    autoCreateFollowUpIssue: false,
    evidence: {
      mergedIssueNumber: expectSummaryInteger(
        evidence.mergedIssueNumber,
        `followUpCandidates[${index}].evidence.mergedIssueNumber`,
      ),
      mergedIssueTitle: expectSummaryString(
        evidence.mergedIssueTitle,
        `followUpCandidates[${index}].evidence.mergedIssueTitle`,
      ),
      mergedPrNumber: expectSummaryInteger(
        evidence.mergedPrNumber,
        `followUpCandidates[${index}].evidence.mergedPrNumber`,
      ),
      mergedPrTitle: expectSummaryString(
        evidence.mergedPrTitle,
        `followUpCandidates[${index}].evidence.mergedPrTitle`,
      ),
      sourceArtifactPath: expectSummaryString(
        evidence.sourceArtifactPath,
        `followUpCandidates[${index}].evidence.sourceArtifactPath`,
      ),
      sourceUrl: expectNullableSummaryString(
        evidence.sourceUrl,
        `followUpCandidates[${index}].evidence.sourceUrl`,
      ),
      sourceId: expectSummaryString(
        evidence.sourceId,
        `followUpCandidates[${index}].evidence.sourceId`,
      ),
      sourceThreadId: expectNullableSummaryString(
        evidence.sourceThreadId,
        `followUpCandidates[${index}].evidence.sourceThreadId`,
      ),
      reviewerLogin: expectSummaryString(
        evidence.reviewerLogin,
        `followUpCandidates[${index}].evidence.reviewerLogin`,
      ),
      file: expectSummaryString(
        evidence.file,
        `followUpCandidates[${index}].evidence.file`,
      ),
      line: expectSummaryInteger(
        evidence.line,
        `followUpCandidates[${index}].evidence.line`,
      ),
    },
  };
}

function expectReleaseNotesSource(
  value: unknown,
  index: number,
): PostMergeAuditReleaseNotesSourceDto {
  const source = expectSummaryObject(value, `releaseNotesSources[${index}]`);
  expectExactKeys(source, POST_MERGE_AUDIT_RELEASE_NOTES_SOURCE_KEYS, `releaseNotesSources[${index}]`);

  const issue = expectSummaryObject(source.issue, `releaseNotesSources[${index}].issue`);
  expectExactKeys(issue, POST_MERGE_AUDIT_RELEASE_NOTES_ISSUE_KEYS, `releaseNotesSources[${index}].issue`);
  const pullRequest = expectSummaryObject(source.pullRequest, `releaseNotesSources[${index}].pullRequest`);
  expectExactKeys(
    pullRequest,
    POST_MERGE_AUDIT_RELEASE_NOTES_PULL_REQUEST_KEYS,
    `releaseNotesSources[${index}].pullRequest`,
  );
  const auditBundle = expectSummaryObject(source.auditBundle, `releaseNotesSources[${index}].auditBundle`);
  expectExactKeys(
    auditBundle,
    POST_MERGE_AUDIT_RELEASE_NOTES_AUDIT_BUNDLE_KEYS,
    `releaseNotesSources[${index}].auditBundle`,
  );
  if (auditBundle.status !== "available" && auditBundle.status !== "missing") {
    failSummaryValidation(`releaseNotesSources[${index}].auditBundle.status must be available or missing.`);
  }

  return {
    issue: {
      number: expectSummaryInteger(issue.number, `releaseNotesSources[${index}].issue.number`),
      title: expectSummaryString(issue.title, `releaseNotesSources[${index}].issue.title`),
      url: expectSummaryString(issue.url, `releaseNotesSources[${index}].issue.url`),
    },
    pullRequest: {
      number: expectSummaryInteger(pullRequest.number, `releaseNotesSources[${index}].pullRequest.number`),
      title: expectSummaryString(pullRequest.title, `releaseNotesSources[${index}].pullRequest.title`),
      url: expectSummaryString(pullRequest.url, `releaseNotesSources[${index}].pullRequest.url`),
      mergedAt: expectSummaryString(pullRequest.mergedAt, `releaseNotesSources[${index}].pullRequest.mergedAt`),
      headRefOid: expectSummaryString(pullRequest.headRefOid, `releaseNotesSources[${index}].pullRequest.headRefOid`),
    },
    auditBundle: {
      status: auditBundle.status,
      localCiSummary: expectNullableSummaryString(
        auditBundle.localCiSummary,
        `releaseNotesSources[${index}].auditBundle.localCiSummary`,
      ),
      pathHygieneSummary: expectNullableSummaryString(
        auditBundle.pathHygieneSummary,
        `releaseNotesSources[${index}].auditBundle.pathHygieneSummary`,
      ),
      journalSummary: expectNullableSummaryString(
        auditBundle.journalSummary,
        `releaseNotesSources[${index}].auditBundle.journalSummary`,
      ),
    },
    verificationCommands: expectStringArray(
      source.verificationCommands,
      `releaseNotesSources[${index}].verificationCommands`,
    ),
    findingSummaries: expectStringArray(source.findingSummaries, `releaseNotesSources[${index}].findingSummaries`),
    followUpCandidateKeys: expectStringArray(
      source.followUpCandidateKeys,
      `releaseNotesSources[${index}].followUpCandidateKeys`,
    ),
  };
}

function expectEvaluatorVerificationNoteSource(
  value: unknown,
  field: string,
): PostMergeAuditEvaluatorVerificationNoteSourceDto {
  if (value !== "local_ci" && value !== "path_hygiene" && value !== "verification_command") {
    failSummaryValidation(`${field} must be one of: local_ci, path_hygiene, verification_command.`);
  }

  return value;
}

function expectEvaluatorProductSafetyFinding(
  value: unknown,
  index: number,
): PostMergeAuditEvaluatorWorkflowDto["productSafetyFindings"][number] {
  const finding = expectSummaryObject(value, `evaluatorWorkflow.productSafetyFindings[${index}]`);
  expectExactKeys(
    finding,
    POST_MERGE_AUDIT_EVALUATOR_PRODUCT_SAFETY_FINDING_KEYS,
    `evaluatorWorkflow.productSafetyFindings[${index}]`,
  );
  const severity = expectSummaryString(
    finding.severity,
    `evaluatorWorkflow.productSafetyFindings[${index}].severity`,
  );
  if (!isActionableSeverity(severity)) {
    failSummaryValidation(`evaluatorWorkflow.productSafetyFindings[${index}].severity must be one of: low, medium, high.`);
  }

  return {
    key: expectSummaryString(finding.key, `evaluatorWorkflow.productSafetyFindings[${index}].key`),
    severity,
    summary: expectSummaryString(finding.summary, `evaluatorWorkflow.productSafetyFindings[${index}].summary`),
    evidenceIssueNumbers: expectIntegerArray(
      finding.evidenceIssueNumbers,
      `evaluatorWorkflow.productSafetyFindings[${index}].evidenceIssueNumbers`,
    ),
    evidenceFindingKeys: expectStringArray(
      finding.evidenceFindingKeys,
      `evaluatorWorkflow.productSafetyFindings[${index}].evidenceFindingKeys`,
    ),
  };
}

function expectEvaluatorVerificationNote(
  value: unknown,
  index: number,
): PostMergeAuditEvaluatorWorkflowDto["verificationNotes"][number] {
  const note = expectSummaryObject(value, `evaluatorWorkflow.verificationNotes[${index}]`);
  expectExactKeys(note, POST_MERGE_AUDIT_EVALUATOR_VERIFICATION_NOTE_KEYS, `evaluatorWorkflow.verificationNotes[${index}]`);

  return {
    source: expectEvaluatorVerificationNoteSource(note.source, `evaluatorWorkflow.verificationNotes[${index}].source`),
    summary: expectSummaryString(note.summary, `evaluatorWorkflow.verificationNotes[${index}].summary`),
    evidenceIssueNumber: expectSummaryInteger(
      note.evidenceIssueNumber,
      `evaluatorWorkflow.verificationNotes[${index}].evidenceIssueNumber`,
    ),
  };
}

function expectEvaluatorFollowUpIssueDraft(
  value: unknown,
  index: number,
): PostMergeAuditEvaluatorWorkflowDto["followUpIssueDrafts"][number] {
  const draft = expectSummaryObject(value, `evaluatorWorkflow.followUpIssueDrafts[${index}]`);
  expectExactKeys(draft, POST_MERGE_AUDIT_EVALUATOR_FOLLOW_UP_DRAFT_KEYS, `evaluatorWorkflow.followUpIssueDrafts[${index}]`);
  if (draft.confirmRequired !== true) {
    failSummaryValidation(`evaluatorWorkflow.followUpIssueDrafts[${index}].confirmRequired must be true.`);
  }
  if (draft.autoCreate !== false) {
    failSummaryValidation(`evaluatorWorkflow.followUpIssueDrafts[${index}].autoCreate must be false.`);
  }

  return {
    title: expectSummaryString(draft.title, `evaluatorWorkflow.followUpIssueDrafts[${index}].title`),
    body: expectSummaryString(draft.body, `evaluatorWorkflow.followUpIssueDrafts[${index}].body`),
    confirmRequired: true,
    autoCreate: false,
    sourceFollowUpCandidateKey: expectSummaryString(
      draft.sourceFollowUpCandidateKey,
      `evaluatorWorkflow.followUpIssueDrafts[${index}].sourceFollowUpCandidateKey`,
    ),
  };
}

function expectEvaluatorWorkflow(value: unknown): PostMergeAuditEvaluatorWorkflowDto {
  const workflow = expectSummaryObject(value, "evaluatorWorkflow");
  expectExactKeys(workflow, POST_MERGE_AUDIT_EVALUATOR_WORKFLOW_KEYS, "evaluatorWorkflow");
  if (workflow.advisoryOnly !== true) {
    failSummaryValidation("evaluatorWorkflow.advisoryOnly must be true.");
  }
  if (workflow.autoCreateFollowUpIssues !== false) {
    failSummaryValidation("evaluatorWorkflow.autoCreateFollowUpIssues must be false.");
  }
  if (workflow.followUpIssueCreationRequiresConfirmation !== true) {
    failSummaryValidation("evaluatorWorkflow.followUpIssueCreationRequiresConfirmation must be true.");
  }
  if (!Array.isArray(workflow.productSafetyFindings)) {
    failSummaryValidation("evaluatorWorkflow.productSafetyFindings must be an array.");
  }
  if (!Array.isArray(workflow.verificationNotes)) {
    failSummaryValidation("evaluatorWorkflow.verificationNotes must be an array.");
  }
  if (!Array.isArray(workflow.followUpIssueDrafts)) {
    failSummaryValidation("evaluatorWorkflow.followUpIssueDrafts must be an array.");
  }

  return {
    advisoryOnly: true,
    autoCreateFollowUpIssues: false,
    followUpIssueCreationRequiresConfirmation: true,
    reviewerSummary: expectSummaryString(workflow.reviewerSummary, "evaluatorWorkflow.reviewerSummary"),
    evaluatorSummary: expectSummaryString(workflow.evaluatorSummary, "evaluatorWorkflow.evaluatorSummary"),
    productSafetyFindings: workflow.productSafetyFindings.map((finding, index) =>
      expectEvaluatorProductSafetyFinding(finding, index)),
    verificationNotes: workflow.verificationNotes.map((note, index) => expectEvaluatorVerificationNote(note, index)),
    followUpIssueDrafts: workflow.followUpIssueDrafts.map((draft, index) =>
      expectEvaluatorFollowUpIssueDraft(draft, index)),
    obsidianHistoryDraft: expectSummaryString(workflow.obsidianHistoryDraft, "evaluatorWorkflow.obsidianHistoryDraft"),
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
  if (!Array.isArray(summary.followUpCandidates)) {
    failSummaryValidation("followUpCandidates must be an array.");
  }
  if (!Array.isArray(summary.promotionCandidates)) {
    failSummaryValidation("promotionCandidates must be an array.");
  }
  if (!Array.isArray(summary.releaseNotesSources)) {
    failSummaryValidation("releaseNotesSources must be an array.");
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
    followUpCandidates: summary.followUpCandidates.map((candidate, index) => expectFollowUpCandidate(candidate, index)),
    promotionCandidates: summary.promotionCandidates.map((candidate, index) => expectPromotionCandidate(candidate, index)),
    releaseNotesSources: summary.releaseNotesSources.map((source, index) => expectReleaseNotesSource(source, index)),
    evaluatorWorkflow: expectEvaluatorWorkflow(summary.evaluatorWorkflow),
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

function formatIssueList(issueNumbers: number[]): string {
  if (issueNumbers.length === 0) {
    return "no merged issues";
  }
  return issueNumbers.map((issueNumber) => `#${issueNumber}`).join(", ");
}

function buildEvaluatorReviewerSummary(args: {
  artifactsAnalyzed: number;
  reviewPatterns: PostMergeAuditReviewPatternDto[];
  followUpCandidates: PostMergeAuditFollowUpCandidateDto[];
  releaseNotesSources: PostMergeAuditReleaseNotesSourceDto[];
}): string {
  const issueNumbers = args.releaseNotesSources.map((source) => source.issue.number).sort(compareNumbersAscending);
  const prNumbers = args.releaseNotesSources.map((source) => source.pullRequest.number).sort(compareNumbersAscending);
  const findingCount = args.reviewPatterns.length;
  const followUpCount = args.followUpCandidates.length;
  if (issueNumbers.length === 0 && prNumbers.length === 0) {
    return [
      `Reviewed ${args.artifactsAnalyzed} post-merge audit artifact(s).`,
      `Found ${findingCount} product/safety finding pattern(s) and ${followUpCount} confirm-required follow-up draft(s).`,
    ].join(" ");
  }
  const issueSummary = issueNumbers.length === 1 ? `issue #${issueNumbers[0]}` : `issues ${formatIssueList(issueNumbers)}`;
  const prSummary = prNumbers.length === 1
    ? `PR #${prNumbers[0]}`
    : `PRs ${prNumbers.map((prNumber) => `#${prNumber}`).join(", ")}`;

  return [
    `Reviewed ${args.artifactsAnalyzed} post-merge audit artifact(s) for ${issueSummary} and ${prSummary}.`,
    `Found ${findingCount} product/safety finding pattern(s) and ${followUpCount} confirm-required follow-up draft(s).`,
  ].join(" ");
}

function buildEvaluatorSummary(args: {
  releaseNotesSources: PostMergeAuditReleaseNotesSourceDto[];
  reviewPatterns: PostMergeAuditReviewPatternDto[];
  followUpCandidates: PostMergeAuditFollowUpCandidateDto[];
}): string {
  const evidenceLines = args.releaseNotesSources.flatMap((source) => [
    source.auditBundle.localCiSummary,
    source.auditBundle.pathHygieneSummary,
    source.auditBundle.journalSummary,
  ]).filter((line): line is string => !!line && line.trim().length > 0);
  const firstEvidence = evidenceLines[0] ?? "No local CI or journal summary evidence was available.";

  return [
    firstEvidence,
    `Evaluator output is grounded in ${args.releaseNotesSources.length} merged PR evidence source(s), ${args.reviewPatterns.length} product/safety finding pattern(s), and ${args.followUpCandidates.length} follow-up candidate(s).`,
    "Follow-up issue creation remains confirm-required and is not automatic.",
  ].join(" ");
}

function buildEvaluatorVerificationNotes(
  releaseNotesSources: PostMergeAuditReleaseNotesSourceDto[],
): PostMergeAuditEvaluatorWorkflowDto["verificationNotes"] {
  const notes: PostMergeAuditEvaluatorWorkflowDto["verificationNotes"] = [];
  for (const source of releaseNotesSources) {
    if (source.auditBundle.localCiSummary) {
      notes.push({
        source: "local_ci",
        summary: source.auditBundle.localCiSummary,
        evidenceIssueNumber: source.issue.number,
      });
    }
    if (source.auditBundle.pathHygieneSummary) {
      notes.push({
        source: "path_hygiene",
        summary: source.auditBundle.pathHygieneSummary,
        evidenceIssueNumber: source.issue.number,
      });
    }
    for (const command of source.verificationCommands) {
      notes.push({
        source: "verification_command",
        summary: command,
        evidenceIssueNumber: source.issue.number,
      });
    }
  }

  return notes;
}

function buildFollowUpIssueDraftBody(candidate: PostMergeAuditFollowUpCandidateDto): string {
  return [
    "## Summary",
    candidate.summary,
    "",
    "## Scope",
    `- Add focused regression coverage for \`${candidate.evidence.file}:${candidate.evidence.line}\`.`,
    `- Keep the fix grounded in merged issue #${candidate.evidence.mergedIssueNumber} / PR #${candidate.evidence.mergedPrNumber} evidence.`,
    "",
    "## Acceptance criteria",
    "- The missed regression is covered by a focused test.",
    "- The follow-up remains scoped to the cited evidence.",
    "",
    "## Verification",
    "- Run the focused regression test added for this follow-up.",
    "",
    "Depends on: none",
    "Parallelizable: No",
    "",
    "## Execution order",
    "1 of 1",
  ].join("\n");
}

function buildObsidianHistoryDraft(
  releaseNotesSources: PostMergeAuditReleaseNotesSourceDto[],
  followUpCandidates: PostMergeAuditFollowUpCandidateDto[],
): string {
  const lines = releaseNotesSources.map((source) => {
    const journalSummary = source.auditBundle.journalSummary ?? "Post-merge audit evidence evaluated.";
    const followUpCount = source.followUpCandidateKeys.length;
    const suffix = followUpCount > 0
      ? ` Follow-up drafts: ${followUpCount} confirm-required.`
      : " Follow-up drafts: none.";
    return `- Issue #${source.issue.number}, PR #${source.pullRequest.number}: ${journalSummary.replace(/\.$/u, "")}.${suffix}`;
  });

  if (followUpCandidates.length > 0) {
    lines.push(
      `- Confirm-required follow-up candidates: ${followUpCandidates.map((candidate) => candidate.title).join("; ")}.`,
    );
  }

  return lines.join("\n");
}

function buildEvaluatorWorkflow(args: {
  artifactsAnalyzed: number;
  reviewPatterns: PostMergeAuditReviewPatternDto[];
  followUpCandidates: PostMergeAuditFollowUpCandidateDto[];
  releaseNotesSources: PostMergeAuditReleaseNotesSourceDto[];
}): PostMergeAuditEvaluatorWorkflowDto {
  return {
    advisoryOnly: true,
    autoCreateFollowUpIssues: false,
    followUpIssueCreationRequiresConfirmation: true,
    reviewerSummary: buildEvaluatorReviewerSummary(args),
    evaluatorSummary: buildEvaluatorSummary(args),
    productSafetyFindings: args.reviewPatterns.map((pattern) => ({
      key: pattern.key,
      severity: pattern.severity,
      summary: pattern.summary,
      evidenceIssueNumbers: [...pattern.supportingIssueNumbers],
      evidenceFindingKeys: [...pattern.supportingFindingKeys],
    })),
    verificationNotes: buildEvaluatorVerificationNotes(args.releaseNotesSources),
    followUpIssueDrafts: args.followUpCandidates.map((candidate) => ({
      title: candidate.title,
      body: buildFollowUpIssueDraftBody(candidate),
      confirmRequired: true,
      autoCreate: false,
      sourceFollowUpCandidateKey: candidate.key,
    })),
    obsidianHistoryDraft: buildObsidianHistoryDraft(args.releaseNotesSources, args.followUpCandidates),
  };
}

export async function summarizePostMergeAuditPatterns(
  config: Pick<SupervisorConfig, "localReviewArtifactDir" | "repoSlug">,
): Promise<PostMergeAuditPatternSummaryDto> {
  const artifactDir = postMergeAuditArtifactDir(config);
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

  const promotionCandidates = [
    ...summarizedReviewPatterns.flatMap((pattern) => createReviewPromotionCandidates(pattern)),
    ...summarizedFailurePatterns.flatMap((pattern) => createFailurePromotionCandidates(pattern)),
    ...summarizedRecoveryPatterns.flatMap((pattern) => createRecoveryPromotionCandidates(pattern)),
  ].sort((left, right) =>
    comparePromotionCategory(left.category, right.category) ||
    right.supportingIssueNumbers.length - left.supportingIssueNumbers.length ||
    compareStringsAscending(left.key, right.key));
  const summarizedFollowUpCandidates = [...followUpCandidates.values()].sort((left, right) =>
    right.evidence.mergedIssueNumber - left.evidence.mergedIssueNumber ||
    right.evidence.mergedPrNumber - left.evidence.mergedPrNumber ||
    compareStringsAscending(left.key, right.key));
  const summarizedReleaseNotesSources = releaseNotesSources.sort((left, right) =>
    right.issue.number - left.issue.number ||
    right.pullRequest.number - left.pullRequest.number);

  return validatePostMergeAuditPatternSummary({
    schemaVersion: POST_MERGE_AUDIT_PATTERN_SUMMARY_SCHEMA_VERSION,
    generatedAt: nowIso(),
    artifactDir,
    advisoryOnly: true,
    autoApplyGuardrails: false,
    autoCreateFollowUpIssues: false,
    artifactsAnalyzed,
    artifactsSkipped,
    reviewPatterns: summarizedReviewPatterns,
    failurePatterns: summarizedFailurePatterns,
    recoveryPatterns: summarizedRecoveryPatterns,
    followUpCandidates: summarizedFollowUpCandidates,
    promotionCandidates,
    releaseNotesSources: summarizedReleaseNotesSources,
    evaluatorWorkflow: buildEvaluatorWorkflow({
      artifactsAnalyzed,
      reviewPatterns: summarizedReviewPatterns,
      followUpCandidates: summarizedFollowUpCandidates,
      releaseNotesSources: summarizedReleaseNotesSources,
    }),
  });
}

export function renderPostMergeAuditPatternSummaryDto(dto: PostMergeAuditPatternSummaryDto): string {
  return JSON.stringify(dto);
}
