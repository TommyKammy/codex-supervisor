import { type LocalReviewRoleSelection } from "../review-role-detector";
import { type CodexExecutionTarget, type ReasoningEffort } from "../core/types";
import { type VerifierGuardrailRule } from "../verifier-guardrails";

export type LocalReviewSeverity = "none" | "low" | "medium" | "high";

export type ActionableSeverity = Exclude<LocalReviewSeverity, "none">;
export type VerificationVerdict = "confirmed" | "dismissed" | "unclear";
export type LocalReviewReviewerType = "generic" | "specialist";

export interface LocalReviewReviewerThresholdConfig {
  confidenceThreshold: number;
  minimumSeverity: ActionableSeverity;
}

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

export type PreMergeFinalEvaluationOutcome =
  | "mergeable"
  | "fix_blocked"
  | "manual_review_blocked"
  | "follow_up_eligible";

export type PreMergeResidualResolution =
  | "must_fix"
  | "manual_review_required"
  | "follow_up_candidate";

export interface PreMergeResidualFinding {
  findingKey: string;
  summary: string;
  severity: ActionableSeverity;
  category: string | null;
  file: string | null;
  start: number | null;
  end: number | null;
  source: "local_review";
  resolution: PreMergeResidualResolution;
  rationale: string;
}

export interface PreMergeFinalEvaluation {
  outcome: PreMergeFinalEvaluationOutcome;
  residualFindings: PreMergeResidualFinding[];
  mustFixCount: number;
  manualReviewCount: number;
  followUpCount: number;
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
  verifierGuardrails?: VerifierGuardrailRule[];
}

export interface LocalReviewGuardrailProvenance {
  verifier: {
    committedPath: string | null;
    committedCount: number;
  };
  externalReview: {
    committedPath: string | null;
    committedCount: number;
    runtimeSources: Array<{
      path: string;
      count: number;
    }>;
  };
}

export interface LocalReviewExecutionRouting {
  target: CodexExecutionTarget;
  model: string | null;
  reasoningEffort: ReasoningEffort;
}

export interface LocalReviewArtifact {
  issueNumber: number;
  prNumber: number;
  branch: string;
  headSha: string;
  ranAt: string;
  confidenceThreshold: number;
  reviewerThresholds: Record<LocalReviewReviewerType, LocalReviewReviewerThresholdConfig>;
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
  finalEvaluation: PreMergeFinalEvaluation;
  guardrailProvenance: LocalReviewGuardrailProvenance;
  roleReports: Array<{
    role: string;
    routing: LocalReviewExecutionRouting;
    reviewerType: LocalReviewReviewerType;
    confidenceThreshold: number;
    minimumSeverity: ActionableSeverity;
    actionableFindingsCount: number;
    exitCode: number;
    degraded: boolean;
    summary: string;
    recommendation: "ready" | "changes_requested" | "unknown";
    findings: LocalReviewFinding[];
  }>;
  verifierReport: {
    role: "verifier";
    routing: LocalReviewExecutionRouting;
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
  finalEvaluation: PreMergeFinalEvaluation;
  artifact: LocalReviewArtifact;
}

export interface LocalReviewResult {
  ranAt: string;
  summaryPath: string;
  findingsPath: string;
  summary: string;
  blockerSummary: string | null;
  findingsCount: number;
  rootCauseCount: number;
  maxSeverity: LocalReviewSeverity;
  verifiedFindingsCount: number;
  verifiedMaxSeverity: LocalReviewSeverity;
  recommendation: "ready" | "changes_requested" | "unknown";
  degraded: boolean;
  finalEvaluation: PreMergeFinalEvaluation;
  rawOutput: string;
}
