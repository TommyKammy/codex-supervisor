import {
  type LocalReviewFinding,
  type LocalReviewVerificationFinding,
  type PreMergeFinalEvaluation,
  type PreMergeResidualFinding,
} from "./types";

function findingIdentity(finding: LocalReviewFinding): string {
  return [
    finding.file ?? "",
    finding.start ?? "",
    finding.end ?? "",
    finding.title.toLowerCase(),
    finding.body.toLowerCase(),
  ].join("|");
}

function summarizeFinding(finding: LocalReviewFinding): string {
  return finding.body.trim().length > 0 ? finding.body : finding.title;
}

function classifyResidualFinding(args: {
  finding: LocalReviewFinding;
  verification?: LocalReviewVerificationFinding;
}): PreMergeResidualFinding | null {
  const { finding, verification } = args;

  if (finding.severity === "high") {
    if (verification?.verdict === "dismissed") {
      return null;
    }
    if (verification?.verdict === "confirmed") {
      return {
        findingKey: findingIdentity(finding),
        summary: summarizeFinding(finding),
        severity: finding.severity,
        category: finding.category,
        file: finding.file,
        start: finding.start,
        end: finding.end,
        source: "local_review",
        resolution: "must_fix",
        rationale: "Confirmed high-severity finding must be fixed before merge.",
      };
    }

    return {
      findingKey: findingIdentity(finding),
      summary: summarizeFinding(finding),
      severity: finding.severity,
      category: finding.category,
      file: finding.file,
      start: finding.start,
      end: finding.end,
      source: "local_review",
      resolution: "manual_review_required",
      rationale: "High-severity finding remains unresolved without verifier confirmation.",
    };
  }

  return {
    findingKey: findingIdentity(finding),
    summary: summarizeFinding(finding),
    severity: finding.severity,
    category: finding.category,
    file: finding.file,
    start: finding.start,
    end: finding.end,
    source: "local_review",
    resolution: "follow_up_candidate",
    rationale: "Residual non-high-severity finding is eligible for explicit follow-up instead of blocking merge by itself.",
  };
}

export function derivePreMergeFinalEvaluation(args: {
  actionableFindings: LocalReviewFinding[];
  verificationFindings: LocalReviewVerificationFinding[];
  degraded: boolean;
}): PreMergeFinalEvaluation {
  const verificationByKey = new Map(args.verificationFindings.map((finding) => [finding.findingKey, finding]));
  const residualFindings = args.actionableFindings
    .map((finding) =>
      classifyResidualFinding({
        finding,
        verification: verificationByKey.get(findingIdentity(finding)),
      }),
    )
    .filter((finding): finding is PreMergeResidualFinding => finding !== null);

  const mustFixCount = residualFindings.filter((finding) => finding.resolution === "must_fix").length;
  const manualReviewCount = residualFindings.filter((finding) => finding.resolution === "manual_review_required").length;
  const followUpCount = residualFindings.filter((finding) => finding.resolution === "follow_up_candidate").length;

  return {
    outcome:
      args.degraded || manualReviewCount > 0
        ? "manual_review_blocked"
        : mustFixCount > 0
          ? "fix_blocked"
          : followUpCount > 0
            ? "follow_up_eligible"
            : "mergeable",
    residualFindings,
    mustFixCount,
    manualReviewCount,
    followUpCount,
  };
}
