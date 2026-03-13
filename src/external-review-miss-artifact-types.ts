import { type ExternalReviewMissFinding } from "./external-review-classifier";

export type ExternalReviewPromptFinding = Pick<
  ExternalReviewMissFinding,
  "reviewerLogin" | "file" | "line" | "summary" | "rationale" | "url"
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
  sourceThreadId: string;
  sourceUrl: string | null;
  qualificationReasons: string[];
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
