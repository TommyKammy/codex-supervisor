import { type LocalReviewRoleSelection } from "./review-role-detector";

export type LocalReviewSeverity = "none" | "low" | "medium" | "high";

export type ActionableSeverity = Exclude<LocalReviewSeverity, "none">;
export type VerificationVerdict = "confirmed" | "dismissed" | "unclear";

export interface ParsedRoleFooter {
  summary: string;
  recommendation: "ready" | "changes_requested" | "unknown";
  findings: LocalReviewFinding[];
}

export interface ParsedVerifierFooter {
  summary: string;
  recommendation: "ready" | "changes_requested" | "unknown";
  findings: LocalReviewVerificationFinding[];
}

export interface LocalReviewFinding {
  role: string;
  title: string;
  body: string;
  file: string | null;
  start: number | null;
  end: number | null;
  severity: ActionableSeverity;
  confidence: number;
  category: string | null;
  evidence: string | null;
}

export interface LocalReviewVerificationFinding {
  findingKey: string;
  verdict: VerificationVerdict;
  rationale: string;
}

export interface LocalReviewRootCauseSummary {
  summary: string;
  severity: ActionableSeverity;
  category: string | null;
  file: string | null;
  start: number | null;
  end: number | null;
  roles: string[];
  findingsCount: number;
  findingKeys: string[];
}

export interface LocalReviewRoleResult {
  role: string;
  summary: string;
  recommendation: "ready" | "changes_requested" | "unknown";
  findings: LocalReviewFinding[];
  rawOutput: string;
  exitCode: number;
  degraded: boolean;
}

export interface LocalReviewVerifierReport {
  role: "verifier";
  summary: string;
  recommendation: "ready" | "changes_requested" | "unknown";
  findings: LocalReviewVerificationFinding[];
  rawOutput: string;
  exitCode: number;
  degraded: boolean;
}

export interface LocalReviewArtifact {
  issueNumber: number;
  prNumber: number;
  branch: string;
  headSha: string;
  ranAt: string;
  confidenceThreshold: number;
  roles: string[];
  autoDetectedRoles: LocalReviewRoleSelection[];
  summary: string;
  recommendation: "ready" | "changes_requested" | "unknown";
  degraded: boolean;
  findingsCount: number;
  rootCauseCount: number;
  maxSeverity: LocalReviewSeverity;
  actionableFindings: LocalReviewFinding[];
  rootCauseSummaries: LocalReviewRootCauseSummary[];
  verification: {
    required: boolean;
    summary: string;
    recommendation: "ready" | "changes_requested" | "unknown";
    degraded: boolean;
    findingsCount: number;
    verifiedFindingsCount: number;
    verifiedMaxSeverity: LocalReviewSeverity;
    findings: LocalReviewVerificationFinding[];
  };
  verifiedFindings: LocalReviewFinding[];
  roleReports: Array<{
    role: string;
    exitCode: number;
    degraded: boolean;
    summary: string;
    recommendation: "ready" | "changes_requested" | "unknown";
    findings: LocalReviewFinding[];
  }>;
  verifierReport: {
    role: "verifier";
    exitCode: number;
    degraded: boolean;
    summary: string;
    recommendation: "ready" | "changes_requested" | "unknown";
    findings: LocalReviewVerificationFinding[];
  } | null;
}

export interface FinalizedLocalReview {
  summary: string;
  recommendation: "ready" | "changes_requested" | "unknown";
  degraded: boolean;
  findingsCount: number;
  rootCauseCount: number;
  maxSeverity: LocalReviewSeverity;
  verifiedFindingsCount: number;
  verifiedMaxSeverity: LocalReviewSeverity;
  actionableFindings: LocalReviewFinding[];
  rootCauseSummaries: LocalReviewRootCauseSummary[];
  verifiedFindings: LocalReviewFinding[];
  artifact: LocalReviewArtifact;
}

export interface LocalReviewResult {
  ranAt: string;
  summaryPath: string;
  findingsPath: string;
  summary: string;
  findingsCount: number;
  rootCauseCount: number;
  maxSeverity: LocalReviewSeverity;
  verifiedFindingsCount: number;
  verifiedMaxSeverity: LocalReviewSeverity;
  recommendation: "ready" | "changes_requested" | "unknown";
  degraded: boolean;
  rawOutput: string;
}

