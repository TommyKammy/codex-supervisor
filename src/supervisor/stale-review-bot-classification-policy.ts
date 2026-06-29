export type StaleReviewBotClassificationOutcome =
  | "actionable_current_diff"
  | "metadata_only"
  | "metadata_only_missing_current_head_review"
  | "metadata_only_current_head_converged"
  | "verified_no_source_change_pending_thread_resolution"
  | "verified_current_head_repair_pending_thread_resolution"
  | "unresolved_work"
  | "unknown_needs_operator";

export type StaleReviewBotAutoRepairSuppressedReason =
  | "none"
  | "opt_in_disabled"
  | "too_many_clusters"
  | "missing_verification_probe"
  | "manual_or_unconfigured_review_threads"
  | "merge_conflict"
  | "failing_checks"
  | "pending_checks"
  | "repeat_stop_exhausted"
  | "not_verified_stale_residue";

export const STALE_REVIEW_BOT_MANUAL_NEXT_STEP =
  "inspect_exact_review_thread_then_resolve_or_leave_manual_note";
export const STALE_REVIEW_BOT_SUMMARY =
  "code_or_ci_green_but_review_thread_metadata_unresolved";
export const STALE_REVIEW_BOT_METADATA_ONLY_SUMMARY =
  "stale_configured_bot_thread_metadata_only";
export const STALE_REVIEW_BOT_METADATA_CURRENT_HEAD_SUMMARY =
  "stale_configured_bot_thread_metadata_only_pending_current_head_review_request";
export const VERIFIED_NO_SOURCE_CHANGE_MANUAL_NEXT_STEP =
  "resolve_verified_configured_bot_threads_then_rerun_supervisor";
export const VERIFIED_NO_SOURCE_CHANGE_SUMMARY =
  "verified_no_source_change_configured_bot_thread_resolution_pending";
export const VERIFIED_CURRENT_HEAD_REPAIR_MANUAL_NEXT_STEP =
  "resolve_verified_repaired_configured_bot_threads_then_rerun_supervisor";
export const VERIFIED_CURRENT_HEAD_REPAIR_SUMMARY =
  "verified_current_head_repair_configured_bot_thread_resolution_pending";

export interface StaleReviewBotClassificationPolicyDecision {
  classification: StaleReviewBotClassificationOutcome;
  summary: string;
  verificationEvidenceSummary?: string | null;
  missingProbeReason?: string | null;
}

export interface StaleReviewBotClassificationPolicyArgs {
  provider: "codex" | "configured_bot";
  configuredThreadCount: number;
  currentConfiguredThreadCount: number;
  manualThreadCount: number;
  sameHead: boolean;
  allChecksPassing: boolean;
  cleanMergeState: boolean;
  mergeConflictState: boolean;
  pendingBotThreadCount: number;
  followUpState: "inactive" | "eligible" | "exhausted";
  allCurrentConfiguredThreadsProcessed: boolean;
  convergenceOutcome:
    | "missing_current_head_review"
    | "must_fix_remaining"
    | "converged"
    | "nitpick_only"
    | "unknown"
    | null;
  hasUnprocessedMustFix: boolean;
  verificationEvidenceSummary: string | null;
  noMajorSignalEvidence: string | null;
  currentHeadCleanCommentResidueEvidence: string | null;
  deterministicProbeEvidence: string | null;
  hasMarkedNoSourceChangeRepair: boolean;
  verifiedNoSourceChangeRepair: boolean;
  hasExplicitCurrentHeadRepairVerification: boolean;
  hasCurrentHeadRepairCheckVerification: boolean;
  repairAttemptCount: number;
  allMustFixRepairResidueThreadsAreP2: boolean;
  requiresDeterministicRepairProbeEvidence: boolean;
  currentHeadSuccess: boolean;
}

export interface StaleReviewBotAutoRepairSuppressionPolicyArgs {
  hasConfigAndPr: boolean;
  repeatStopExhausted: boolean;
  manualOrUnconfiguredReviewThreads: boolean;
  mergeConflictState: boolean;
  failingChecks: boolean;
  pendingChecks: boolean;
  missingProbeReason: string | null;
  verifiedStaleResidue: boolean;
  actionableClusterCount: number;
  verifiedAutoResolveEnabled: boolean;
}

function unresolvedWork(): StaleReviewBotClassificationPolicyDecision {
  return {
    classification: "unresolved_work",
    summary: STALE_REVIEW_BOT_SUMMARY,
  };
}

function unknownNeedsOperator(
  extras: Pick<
    StaleReviewBotClassificationPolicyDecision,
    "verificationEvidenceSummary" | "missingProbeReason"
  > = {},
): StaleReviewBotClassificationPolicyDecision {
  return {
    classification: "unknown_needs_operator",
    summary: STALE_REVIEW_BOT_SUMMARY,
    ...extras,
  };
}

function classifyCodexReviewBotPolicy(
  args: StaleReviewBotClassificationPolicyArgs,
): StaleReviewBotClassificationPolicyDecision {
  if (args.configuredThreadCount === 0) {
    return unresolvedWork();
  }

  if (
    args.manualThreadCount > 0 ||
    !args.sameHead ||
    !args.allChecksPassing ||
    args.mergeConflictState ||
    args.pendingBotThreadCount > 0 ||
    args.followUpState === "eligible" ||
    !args.allCurrentConfiguredThreadsProcessed
  ) {
    return unresolvedWork();
  }

  if (!args.convergenceOutcome || args.convergenceOutcome === "unknown") {
    return unknownNeedsOperator();
  }

  if (args.convergenceOutcome === "missing_current_head_review") {
    return {
      classification: "metadata_only_missing_current_head_review",
      summary: STALE_REVIEW_BOT_METADATA_CURRENT_HEAD_SUMMARY,
    };
  }

  if (args.convergenceOutcome === "must_fix_remaining") {
    if (args.hasUnprocessedMustFix) {
      return {
        classification: "actionable_current_diff",
        summary: STALE_REVIEW_BOT_SUMMARY,
      };
    }
    if (args.currentHeadCleanCommentResidueEvidence) {
      return {
        classification: "verified_no_source_change_pending_thread_resolution",
        summary: VERIFIED_NO_SOURCE_CHANGE_SUMMARY,
        verificationEvidenceSummary: args.currentHeadCleanCommentResidueEvidence,
      };
    }
    if (!args.verificationEvidenceSummary) {
      return unknownNeedsOperator({
        missingProbeReason: "current_head_verification_evidence_missing",
      });
    }
    const verifiedCurrentHeadRepair =
      args.hasExplicitCurrentHeadRepairVerification ||
      args.hasCurrentHeadRepairCheckVerification ||
      (!args.hasMarkedNoSourceChangeRepair && args.repairAttemptCount > 0);
    if (!args.noMajorSignalEvidence) {
      if (args.deterministicProbeEvidence && args.allMustFixRepairResidueThreadsAreP2) {
        return {
          classification: "verified_current_head_repair_pending_thread_resolution",
          summary: VERIFIED_CURRENT_HEAD_REPAIR_SUMMARY,
          verificationEvidenceSummary: `${args.verificationEvidenceSummary};${args.deterministicProbeEvidence}`,
        };
      }
      if (
        args.hasExplicitCurrentHeadRepairVerification &&
        args.allMustFixRepairResidueThreadsAreP2 &&
        !args.requiresDeterministicRepairProbeEvidence
      ) {
        return {
          classification: "verified_current_head_repair_pending_thread_resolution",
          summary: VERIFIED_CURRENT_HEAD_REPAIR_SUMMARY,
          verificationEvidenceSummary: args.verificationEvidenceSummary,
        };
      }
      return unknownNeedsOperator({
        verificationEvidenceSummary: args.verificationEvidenceSummary,
        missingProbeReason: "current_head_codex_no_major_signal_missing",
      });
    }

    if (!verifiedCurrentHeadRepair && !args.verifiedNoSourceChangeRepair) {
      return unknownNeedsOperator({
        verificationEvidenceSummary: args.verificationEvidenceSummary,
        missingProbeReason: args.hasMarkedNoSourceChangeRepair
          ? "current_head_no_source_thread_evidence_missing"
          : "current_head_repair_evidence_missing",
      });
    }
    if (!args.allMustFixRepairResidueThreadsAreP2) {
      return {
        ...unresolvedWork(),
        verificationEvidenceSummary: args.verificationEvidenceSummary,
      };
    }
    return {
      classification: verifiedCurrentHeadRepair
        ? "verified_current_head_repair_pending_thread_resolution"
        : "verified_no_source_change_pending_thread_resolution",
      summary: verifiedCurrentHeadRepair
        ? VERIFIED_CURRENT_HEAD_REPAIR_SUMMARY
        : VERIFIED_NO_SOURCE_CHANGE_SUMMARY,
      verificationEvidenceSummary: `${args.verificationEvidenceSummary};${args.noMajorSignalEvidence}`,
    };
  }

  if (args.convergenceOutcome === "converged" || args.convergenceOutcome === "nitpick_only") {
    return {
      classification: "metadata_only_current_head_converged",
      summary: STALE_REVIEW_BOT_METADATA_ONLY_SUMMARY,
    };
  }

  return unknownNeedsOperator();
}

function classifyConfiguredBotPolicy(
  args: StaleReviewBotClassificationPolicyArgs,
): StaleReviewBotClassificationPolicyDecision {
  if (
    args.configuredThreadCount === 0 ||
    args.manualThreadCount > 0 ||
    !args.sameHead ||
    !args.currentHeadSuccess ||
    !args.allChecksPassing ||
    !args.cleanMergeState ||
    args.pendingBotThreadCount > 0 ||
    args.followUpState === "eligible" ||
    !args.allCurrentConfiguredThreadsProcessed
  ) {
    return unresolvedWork();
  }

  return {
    classification: "metadata_only",
    summary: STALE_REVIEW_BOT_METADATA_ONLY_SUMMARY,
  };
}

export function classifyStaleReviewBotRemediationPolicy(
  args: StaleReviewBotClassificationPolicyArgs,
): StaleReviewBotClassificationPolicyDecision {
  return args.provider === "codex" ? classifyCodexReviewBotPolicy(args) : classifyConfiguredBotPolicy(args);
}

export function classifyStaleReviewBotAutoRepairSuppressionPolicy(
  args: StaleReviewBotAutoRepairSuppressionPolicyArgs,
): StaleReviewBotAutoRepairSuppressedReason {
  if (!args.hasConfigAndPr) {
    return "not_verified_stale_residue";
  }
  if (args.repeatStopExhausted) {
    return "repeat_stop_exhausted";
  }
  if (args.manualOrUnconfiguredReviewThreads) {
    return "manual_or_unconfigured_review_threads";
  }
  if (args.mergeConflictState) {
    return "merge_conflict";
  }
  if (args.failingChecks) {
    return "failing_checks";
  }
  if (args.pendingChecks) {
    return "pending_checks";
  }
  if (args.missingProbeReason) {
    return "missing_verification_probe";
  }
  if (!args.verifiedStaleResidue) {
    return args.actionableClusterCount > 1 ? "too_many_clusters" : "not_verified_stale_residue";
  }
  if (!args.verifiedAutoResolveEnabled) {
    return "opt_in_disabled";
  }

  return "none";
}
