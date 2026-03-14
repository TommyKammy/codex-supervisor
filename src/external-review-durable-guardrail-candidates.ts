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
];

const CANDIDATE_SPECS: CandidateSpec[] = [
  {
    category: "reviewer_rubric",
    titlePrefix: "Promote reviewer rubric guardrail for",
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
        reason: "file_scoped",
        passes: (finding) => typeof finding.file === "string" && finding.file.trim() !== "",
      },
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
        reason: "file_scoped",
        passes: (finding) => typeof finding.file === "string" && finding.file.trim() !== "",
      },
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
  const qualificationReasons: string[] = [];

  for (const rule of spec.rules) {
    if (!rule.passes(finding)) {
      continue;
    }

    qualificationReasons.push(rule.reason);
  }

  const hasFileScoped = typeof finding.file === "string" && finding.file.trim() !== "";
  const hasTopLevelReviewUnanchored = finding.sourceKind === "top_level_review" && !finding.file && finding.line == null;

  if (spec.category === "reviewer_rubric") {
    if (hasFileScoped) {
      qualificationReasons.splice(2, 0, "file_scoped");
    } else if (hasTopLevelReviewUnanchored) {
      qualificationReasons.splice(2, 0, "top_level_review_unanchored");
    }
  }

  return {
    qualified:
      spec.category === "reviewer_rubric"
        ? qualificationReasons.length === spec.rules.length + 1 &&
          (hasFileScoped || hasTopLevelReviewUnanchored)
        : qualificationReasons.length === spec.rules.length,
    qualificationReasons,
  };
}

function formatTitle(prefix: string, summary: string): string {
  return `${prefix} ${summary.replace(/[.!?]+$/, "")}`;
}

function normalizeCandidateText(text: string): string {
  return text.replace(/\s+/g, " ").trim().toLowerCase();
}

function createDurableGuardrailCandidateId(
  category: ExternalReviewDurableGuardrailCandidateCategory,
  finding: ExternalReviewMissFinding,
): string {
  if (finding.file) {
    return `${category}|${createExternalReviewRegressionCandidateId(finding)}`;
  }

  return `${category}|${finding.sourceKind}|${normalizeCandidateText(finding.rationale)}`;
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
    if (!qualified) {
      return [];
    }

    return [{
      id: createDurableGuardrailCandidateId(spec.category, args.finding),
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
        sourceKind: args.finding.sourceKind,
        sourceId: args.finding.sourceId,
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
