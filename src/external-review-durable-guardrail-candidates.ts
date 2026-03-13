import { createExternalReviewRegressionCandidateId } from "./external-review-normalization";
import { type ExternalReviewMissFinding } from "./external-review-classifier";
import {
  type ExternalReviewDurableGuardrailCandidate,
  type ExternalReviewDurableGuardrailCandidateCategory,
} from "./external-review-miss-artifact-types";

interface CandidateQualificationRule {
  reason: string;
  passes: (finding: ExternalReviewMissFinding) => boolean;
}

interface CandidateSpec {
  category: ExternalReviewDurableGuardrailCandidateCategory;
  titlePrefix: string;
  rules: CandidateQualificationRule[];
}

const COMMON_RULES: CandidateQualificationRule[] = [
  {
    reason: "missed_by_local_review",
    passes: (finding) => finding.classification === "missed_by_local_review",
  },
  {
    reason: "high_confidence",
    passes: (finding) => finding.confidence >= 0.75,
  },
  {
    reason: "file_scoped",
    passes: (finding) => typeof finding.file === "string" && finding.file.trim() !== "",
  },
];

const CANDIDATE_SPECS: CandidateSpec[] = [
  {
    category: "prompt_rubric",
    titlePrefix: "Promote prompt/rubric guardrail for",
    rules: [
      ...COMMON_RULES,
      {
        reason: "non_low_severity",
        passes: (finding) => finding.severity !== "low",
      },
    ],
  },
  {
    category: "verifier",
    titlePrefix: "Promote verifier guardrail for",
    rules: [
      ...COMMON_RULES,
      {
        reason: "high_severity",
        passes: (finding) => finding.severity === "high",
      },
      {
        reason: "line_scoped",
        passes: (finding) => typeof finding.line === "number" && Number.isInteger(finding.line) && finding.line > 0,
      },
    ],
  },
  {
    category: "regression_test",
    titlePrefix: "Promote regression-test guardrail for",
    rules: [
      ...COMMON_RULES,
      {
        reason: "non_low_severity",
        passes: (finding) => finding.severity !== "low",
      },
      {
        reason: "line_scoped",
        passes: (finding) => typeof finding.line === "number" && Number.isInteger(finding.line) && finding.line > 0,
      },
    ],
  },
];

function qualifies(
  finding: ExternalReviewMissFinding,
  spec: CandidateSpec,
): { qualified: boolean; qualificationReasons: string[] } {
  const qualificationReasons = spec.rules
    .filter((rule) => rule.passes(finding))
    .map((rule) => rule.reason);

  return {
    qualified: qualificationReasons.length === spec.rules.length,
    qualificationReasons,
  };
}

function formatTitle(prefix: string, summary: string): string {
  return `${prefix} ${summary.replace(/[.!?]+$/, "")}`;
}

export function toDurableGuardrailCandidates(args: {
  issueNumber: number;
  prNumber: number;
  branch: string;
  headSha: string;
  sourceArtifactPath: string;
  localReviewSummaryPath: string | null;
  localReviewFindingsPath: string | null;
  finding: ExternalReviewMissFinding;
}): ExternalReviewDurableGuardrailCandidate[] {
  return CANDIDATE_SPECS.flatMap((spec) => {
    const { qualified, qualificationReasons } = qualifies(args.finding, spec);
    if (!qualified || !args.finding.file) {
      return [];
    }

    return [{
      id: `${spec.category}|${createExternalReviewRegressionCandidateId(args.finding)}`,
      category: spec.category,
      title: formatTitle(spec.titlePrefix, args.finding.summary),
      reviewerLogin: args.finding.reviewerLogin,
      file: args.finding.file,
      line: args.finding.line,
      summary: args.finding.summary,
      rationale: args.finding.rationale,
      qualificationReasons,
      provenance: {
        issueNumber: args.issueNumber,
        prNumber: args.prNumber,
        branch: args.branch,
        headSha: args.headSha,
        sourceThreadId: args.finding.threadId,
        sourceUrl: args.finding.url ?? null,
        sourceArtifactPath: args.sourceArtifactPath,
        localReviewSummaryPath: args.localReviewSummaryPath,
        localReviewFindingsPath: args.localReviewFindingsPath,
        matchedLocalReference: args.finding.matchedLocalReference,
        matchReason: args.finding.matchReason,
      },
    }];
  });
}
