import type { ActionableSeverity } from "../local-review/types";

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


export function isPostMergeAuditActionableSeverity(value: unknown): value is ActionableSeverity {
  return value === "low" || value === "medium" || value === "high";
}

const isActionableSeverity = isPostMergeAuditActionableSeverity;
