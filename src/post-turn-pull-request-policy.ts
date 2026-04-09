import { LOCAL_REVIEW_DEGRADED_BLOCKER_SUMMARY, type LocalReviewResult } from "./local-review";
import { localReviewManualReviewNeedsRepair, nextLocalReviewSignatureTracking } from "./review-handling";
import { type GitHubPullRequest, type IssueRunRecord, type SupervisorConfig } from "./core/types";
import { nowIso, truncate } from "./core/utils";

type PostTurnLocalReviewDecisionRecordPatch = Pick<
  IssueRunRecord,
  | "state"
  | "local_review_head_sha"
  | "local_review_blocker_summary"
  | "local_review_summary_path"
  | "local_review_run_at"
  | "local_review_max_severity"
  | "local_review_findings_count"
  | "local_review_root_cause_count"
  | "local_review_verified_max_severity"
  | "local_review_verified_findings_count"
  | "local_review_recommendation"
  | "local_review_degraded"
  | "pre_merge_evaluation_outcome"
  | "pre_merge_must_fix_count"
  | "pre_merge_manual_review_count"
  | "pre_merge_follow_up_count"
  | "last_local_review_signature"
  | "repeated_local_review_signature_count"
  | "external_review_head_sha"
  | "external_review_misses_path"
  | "external_review_matched_findings_count"
  | "external_review_near_match_findings_count"
  | "external_review_missed_findings_count"
  | "blocked_reason"
  | "last_error"
>;

export interface PostTurnLocalReviewDecision {
  recordPatch: PostTurnLocalReviewDecisionRecordPatch;
  shouldCreateFollowUpIssues: boolean;
}

function buildLocalReviewLastError(args: {
  config: SupervisorConfig;
  localReview: LocalReviewResult;
  manualReviewNeedsRepair: boolean;
  manualReviewResidualBlocked: boolean;
}): string | null {
  const { config, localReview, manualReviewNeedsRepair, manualReviewResidualBlocked } = args;
  if (localReview.recommendation === "ready") {
    return null;
  }

  return truncate(
    localReview.degraded
      ? "Local review completed in a degraded state."
      : manualReviewNeedsRepair
        ? `Local review found ${localReview.finalEvaluation.manualReviewCount} unresolved manual-review residual${localReview.finalEvaluation.manualReviewCount === 1 ? "" : "s"} on the current PR head. Codex will continue with a same-PR repair pass before the PR can proceed.`
        : manualReviewResidualBlocked
          ? `Local review requires manual verification before the PR can proceed (${localReview.finalEvaluation.manualReviewCount} unresolved manual-review residual${localReview.finalEvaluation.manualReviewCount === 1 ? "" : "s"}).`
          : localReview.verifiedMaxSeverity === "high" && config.localReviewHighSeverityAction === "retry"
            ? `Local review found high-severity issues (${localReview.findingsCount} actionable findings across ${localReview.rootCauseCount} root cause(s)). Codex will continue with a repair pass before the PR can proceed.`
            : localReview.verifiedMaxSeverity === "high" && config.localReviewHighSeverityAction === "blocked"
              ? `Local review found high-severity issues (${localReview.findingsCount} actionable findings across ${localReview.rootCauseCount} root cause(s)). Manual attention is required before the PR can proceed.`
              : `Local review requested changes (${localReview.findingsCount} actionable findings across ${localReview.rootCauseCount} root cause(s)).`,
    500,
  );
}

export function derivePostTurnLocalReviewDecision(args: {
  config: SupervisorConfig;
  record: Pick<
    IssueRunRecord,
    | "last_local_review_signature"
    | "repeated_local_review_signature_count"
    | "local_review_head_sha"
    | "pre_merge_evaluation_outcome"
    | "pre_merge_manual_review_count"
    | "pre_merge_follow_up_count"
  >;
  pr: GitHubPullRequest;
  localReview: LocalReviewResult;
}): PostTurnLocalReviewDecision {
  const { config, record, pr, localReview } = args;
  const actionableSignature =
    localReview.recommendation !== "ready"
      ? `local-review:${localReview.maxSeverity ?? "unknown"}:${localReview.rootCauseCount}:${localReview.degraded ? "degraded" : "clean"}`
      : null;
  const signatureTracking = nextLocalReviewSignatureTracking(record, pr.headRefOid, actionableSignature);
  const manualReviewBlocked = localReview.finalEvaluation.outcome === "manual_review_blocked";
  const manualReviewResidualBlocked = manualReviewBlocked && localReview.finalEvaluation.manualReviewCount > 0;
  const manualReviewNeedsRepair = localReviewManualReviewNeedsRepair(
    config,
    {
      local_review_head_sha: pr.headRefOid,
      pre_merge_evaluation_outcome: localReview.finalEvaluation.outcome,
      pre_merge_manual_review_count: localReview.finalEvaluation.manualReviewCount,
      pre_merge_follow_up_count: localReview.finalEvaluation.followUpCount,
    },
    pr,
  );

  return {
    recordPatch: {
      state: manualReviewNeedsRepair ? "local_review_fix" : manualReviewResidualBlocked ? "blocked" : "draft_pr",
      local_review_head_sha: pr.headRefOid,
      local_review_blocker_summary: localReview.blockerSummary,
      local_review_summary_path: localReview.summaryPath,
      local_review_run_at: localReview.ranAt,
      local_review_max_severity: localReview.maxSeverity,
      local_review_findings_count: localReview.findingsCount,
      local_review_root_cause_count: localReview.rootCauseCount,
      local_review_verified_max_severity: localReview.verifiedMaxSeverity,
      local_review_verified_findings_count: localReview.verifiedFindingsCount,
      local_review_recommendation: localReview.recommendation,
      local_review_degraded: localReview.degraded,
      pre_merge_evaluation_outcome: localReview.finalEvaluation.outcome,
      pre_merge_must_fix_count: localReview.finalEvaluation.mustFixCount,
      pre_merge_manual_review_count: localReview.finalEvaluation.manualReviewCount,
      pre_merge_follow_up_count: localReview.finalEvaluation.followUpCount,
      ...signatureTracking,
      external_review_head_sha: null,
      external_review_misses_path: null,
      external_review_matched_findings_count: 0,
      external_review_near_match_findings_count: 0,
      external_review_missed_findings_count: 0,
      blocked_reason:
        manualReviewResidualBlocked && !manualReviewNeedsRepair
          ? "manual_review"
          : localReview.recommendation !== "ready" &&
              config.localReviewHighSeverityAction === "blocked" &&
              localReview.verifiedMaxSeverity === "high"
            ? "verification"
            : null,
      last_error: buildLocalReviewLastError({
        config,
        localReview,
        manualReviewNeedsRepair,
        manualReviewResidualBlocked,
      }),
    },
    shouldCreateFollowUpIssues:
      localReview.finalEvaluation.outcome === "follow_up_eligible" &&
      config.localReviewFollowUpIssueCreationEnabled === true,
  };
}

export function derivePostTurnLocalReviewFailurePatch(args: {
  pr: Pick<GitHubPullRequest, "headRefOid">;
  error: unknown;
}): PostTurnLocalReviewDecisionRecordPatch {
  const message = args.error instanceof Error ? args.error.message : String(args.error);
  return {
    state: "draft_pr",
    local_review_head_sha: args.pr.headRefOid,
    local_review_blocker_summary: LOCAL_REVIEW_DEGRADED_BLOCKER_SUMMARY,
    local_review_summary_path: null,
    local_review_run_at: nowIso(),
    local_review_max_severity: null,
    local_review_findings_count: 0,
    local_review_root_cause_count: 0,
    local_review_verified_max_severity: null,
    local_review_verified_findings_count: 0,
    local_review_recommendation: "unknown",
    local_review_degraded: true,
    pre_merge_evaluation_outcome: null,
    pre_merge_must_fix_count: 0,
    pre_merge_manual_review_count: 0,
    pre_merge_follow_up_count: 0,
    last_local_review_signature: null,
    repeated_local_review_signature_count: 0,
    external_review_head_sha: null,
    external_review_misses_path: null,
    external_review_matched_findings_count: 0,
    external_review_near_match_findings_count: 0,
    external_review_missed_findings_count: 0,
    blocked_reason: "verification",
    last_error: `Local review failed: ${truncate(message, 500) ?? "unknown error"}`,
  };
}
