import { type ExternalReviewMissFinding } from "./external-review-classifier";
import { type ExternalReviewSignalSourceKind } from "./external-review-normalization";

export type ExternalReviewPromptFinding = Pick<
  ExternalReviewMissFinding,
  "sourceKind" | "sourceId" | "sourceUrl" | "reviewerLogin" | "file" | "line" | "summary" | "rationale" | "url"
>;

export interface ExternalReviewMissPattern {
  fingerprint: string;
  reviewerLogin: string;
  file: string;
  line: number | null;
  summary: string;
  rationale: string;
  sourceArtifactPath: string;
  sourceHeadSha: string;
  lastSeenAt: string;
}

export interface ExternalReviewRegressionCandidate {
  id: string;
  title: string;
  file: string;
  line: number;
  summary: string;
  rationale: string;
  reviewerLogin: string;
  sourceKind: ExternalReviewSignalSourceKind;
  sourceId: string;
  sourceThreadId: string | null;
  sourceUrl: string | null;
  qualificationReasons: string[];
}

export type ExternalReviewDurableGuardrailCandidateCategory =
  | "reviewer_rubric"
  | "verifier"
  | "regression_test";

export interface ExternalReviewDurableGuardrailCandidate {
  id: string;
  category: ExternalReviewDurableGuardrailCandidateCategory;
  title: string;
  reviewerLogin: string;
  file: string;
  line: number | null;
  summary: string;
  rationale: string;
  qualificationReasons: string[];
  provenance: {
    issueNumber: number;
    prNumber: number;
    branch: string;
    headSha: string;
    sourceKind: ExternalReviewSignalSourceKind;
    sourceId: string;
    sourceThreadId: string | null;
    sourceUrl: string | null;
    sourceArtifactPath: string;
    localReviewSummaryPath: string | null;
    localReviewFindingsPath: string | null;
    matchedLocalReference: string | null;
    matchReason: string;
  };
}

export interface DurableExternalReviewGuardrails {
  version: 1;
  patterns: ExternalReviewMissPattern[];
}

export interface ExternalReviewMissArtifact {
  issueNumber: number;
  prNumber: number;
  branch: string;
  headSha: string;
  generatedAt: string;
  localReviewSummaryPath: string | null;
  localReviewFindingsPath: string | null;
  findings: ExternalReviewMissFinding[];
  reusableMissPatterns: ExternalReviewMissPattern[];
  durableGuardrailCandidates: ExternalReviewDurableGuardrailCandidate[];
  regressionTestCandidates: ExternalReviewRegressionCandidate[];
  counts: {
    matched: number;
    nearMatch: number;
    missedByLocalReview: number;
  };
}

export interface ExternalReviewMissContext {
  artifactPath: string;
  missedFindings: ExternalReviewPromptFinding[];
  regressionTestCandidates: ExternalReviewRegressionCandidate[];
  matchedCount: number;
  nearMatchCount: number;
  missedCount: number;
}
