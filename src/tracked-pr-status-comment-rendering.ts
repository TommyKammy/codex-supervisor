import { GitHubPullRequest, LatestLocalCiResult, LocalCiRemediationTarget, RunState } from "./core/types";

export type HostLocalTrackedPrBlockerGateType =
  | "workspace_preparation"
  | "local_ci"
  | "workstation_local_path_hygiene";

export const TRACKED_PR_STATUS_COMMENT_REASON_CODE_DRAFT_REVIEW_PROVIDER_SUPPRESSED =
  "draft_review_provider_suppressed";
export const TRACKED_PR_STATUS_COMMENT_REASON_CODE_HANDOFF_MISSING = "handoff_missing";
export const TRACKED_PR_STATUS_COMMENT_REASON_CODE_MANUAL_REVIEW = "manual_review";
export const TRACKED_PR_STATUS_COMMENT_REASON_CODE_STALE_REVIEW_BOT = "stale_review_bot";
export const TRACKED_PR_STATUS_COMMENT_REASON_CODE_REQUIRED_CHECK_MISMATCH = "required_check_mismatch";
export const TRACKED_PR_STATUS_COMMENT_REASON_CODE_CONVERSATION_RESOLUTION_BLOCKED =
  "conversation_resolution_blocked";
export const TRACKED_PR_STATUS_COMMENT_REASON_CODE_TRACKED_LIFECYCLE_MISMATCH = "tracked_lifecycle_mismatch";
export const TRACKED_PR_STATUS_COMMENT_REASON_CODE_CODEX_CONNECTOR_CHURN = "codex_connector_churn";
export const TRACKED_PR_STATUS_COMMENT_REASON_CODE_CLEARED = "cleared";

export function workspacePreparationFailureClass(
  signature: string | null | undefined,
): Exclude<LatestLocalCiResult["failure_class"], "unset_contract"> | null {
  if (!signature?.startsWith("workspace-preparation-gate-")) {
    return null;
  }

  const failureClass = signature.slice("workspace-preparation-gate-".length);
  switch (failureClass) {
    case "missing_command":
    case "workspace_toolchain_missing":
    case "worktree_helper_missing":
    case "non_zero_exit":
      return failureClass;
    default:
      return null;
  }
}

export function workspacePreparationRemediationTarget(
  failureClass: Exclude<LatestLocalCiResult["failure_class"], "unset_contract"> | null,
): LocalCiRemediationTarget {
  switch (failureClass) {
    case "missing_command":
    case "worktree_helper_missing":
      return "config_contract";
    case "workspace_toolchain_missing":
    case "non_zero_exit":
    default:
      return "workspace_environment";
  }
}

export function buildTrackedPrHostLocalBlockerComment(args: {
  pr: Pick<GitHubPullRequest, "headRefOid">;
  gateType: HostLocalTrackedPrBlockerGateType;
  blockerSignature: string;
  failureClass: string | null;
  remediationTarget: string | null;
  summary: string;
  details?: string[] | null;
  localHeadSha?: string | null;
  remoteHeadSha?: string | null;
}): string {
  if (args.gateType === "workstation_local_path_hygiene") {
    return buildTrackedPrReadyPromotionPathHygieneComment(args);
  }

  return [
    `Tracked PR head \`${args.pr.headRefOid}\` is still draft because ready-for-review promotion is blocked locally.`,
    "",
    ...(args.localHeadSha === undefined || args.localHeadSha === null ? [] : [`- local head SHA: \`${args.localHeadSha}\``]),
    ...(args.remoteHeadSha === undefined || args.remoteHeadSha === null ? [] : [`- remote PR head SHA: \`${args.remoteHeadSha}\``]),
    `- reason code: \`${trackedPrReadyPromotionBlockedReasonCode(args.gateType)}\``,
    `- gate type: \`${args.gateType}\``,
    `- blocker signature: \`${args.blockerSignature}\``,
    `- failure class: \`${args.failureClass ?? "unknown"}\``,
    `- remediation target: \`${args.remediationTarget ?? "unknown"}\``,
    `- summary: ${args.summary}`,
    ...appendEvidenceLines(args.details),
    "- automatic retry: no",
    "- next action: fix the tracked workspace blocker, then rerun the supervisor to retry ready-for-review promotion.",
    "",
    "GitHub checks may still be green because this blocker is host-local to the supervisor workspace.",
  ].join("\n");
}

function summarizeWorkstationLocalPathFirstFix(details: string[] | null | undefined): string | null {
  if (!details || details.length === 0) {
    return null;
  }

  const countsByFile = new Map<string, number>();
  for (const detail of details) {
    if (
      detail.includes(".codex-supervisor/issues/") &&
      detail.includes("issue-journal.md")
    ) {
      continue;
    }

    const match = detail.match(/^-?\s*([^:\s][^:]*)\:\d+\s+matched\b/);
    if (!match) {
      continue;
    }
    const filePath = match[1]?.trim();
    if (!filePath) {
      continue;
    }
    countsByFile.set(filePath, (countsByFile.get(filePath) ?? 0) + 1);
  }

  if (countsByFile.size === 0) {
    return null;
  }

  const sortedFiles = [...countsByFile.entries()].sort((left, right) => {
    if (right[1] !== left[1]) {
      return right[1] - left[1];
    }
    return left[0].localeCompare(right[0]);
  });
  const visibleFiles = sortedFiles
    .slice(0, 3)
    .map(([filePath, count]) => `${filePath} (${count} match${count === 1 ? "" : "es"})`);
  const remainingCount = sortedFiles.length - visibleFiles.length;
  const tail = remainingCount > 0 ? `; +${remainingCount} more file${remainingCount === 1 ? "" : "s"}` : "";
  return `First fix: ${visibleFiles.join("; ")}${tail}.`;
}

function sanitizePathHygieneEvidenceLine(line: string): string {
  return line
    .replace(/\/(?:home|Users)(?:\/[^\s"'`<>:;,\)\]\}]*)?/g, "/<redacted-user-home>")
    .replace(/C:\\Users\\[^\s"'`<>:;,\)\]\}]+/g, "C:\\<redacted-user-home>");
}

function appendEvidenceLines(details: string[] | null | undefined, limit = 3): string[] {
  return compactEvidenceLines(
    (details ?? [])
      .filter(
        (detail) =>
          !detail.includes(".codex-supervisor/issues/") ||
          !detail.includes("issue-journal.md"),
      )
      .map((detail) => sanitizePathHygieneEvidenceLine(detail)),
    limit,
  ).map((detail) => `- evidence: ${detail}`);
}

function buildTrackedPrReadyPromotionPathHygieneComment(args: {
  pr: Pick<GitHubPullRequest, "headRefOid">;
  blockerSignature: string;
  remediationTarget: string | null;
  summary: string;
  details?: string[] | null;
  localHeadSha?: string | null;
  remoteHeadSha?: string | null;
}): string {
  const firstFix = summarizeWorkstationLocalPathFirstFix(args.details);
  const conciseSummary = args.summary.replace(/\s+First fix:.*$/i, "").trim();
  const repairable = args.remediationTarget === "repair_already_queued";
  return [
    `Tracked PR head \`${args.pr.headRefOid}\` is still draft because ready-for-review promotion is blocked locally.`,
    "",
    ...(args.localHeadSha === undefined || args.localHeadSha === null ? [] : [`- local head SHA: \`${args.localHeadSha}\``]),
    ...(args.remoteHeadSha === undefined || args.remoteHeadSha === null ? [] : [`- remote PR head SHA: \`${args.remoteHeadSha}\``]),
    `- reason code: \`${trackedPrReadyPromotionBlockedReasonCode("workstation_local_path_hygiene")}\``,
    `- gate name: \`workstation_local_path_hygiene\``,
    `- blocker signature: \`${args.blockerSignature}\``,
    ...appendEvidenceLines(args.details),
    `- what failed: ${conciseSummary}`,
    ...(firstFix ? [`- ${firstFix}`] : []),
    `- remediation target: \`${args.remediationTarget ?? "manual_review"}\``,
    `- automatic retry: ${repairable ? "yes" : "no"}`,
    repairable
      ? "- next action: supervisor will retry a repair turn with these actionable publishable files, then re-run ready-for-review promotion."
      : "- rerunning the supervisor alone will not help yet; fix the tracked workspace artifacts first, then rerun promotion.",
    "",
    "GitHub checks may still be green because this blocker is host-local to the supervisor workspace.",
  ].join("\n");
}

function trackedPrReadyPromotionBlockedReasonCode(gateType: HostLocalTrackedPrBlockerGateType): string {
  return `ready_promotion_blocked_${gateType}`;
}

export function trackedPrHostLocalBlockerCommentSignature(args: {
  gateType: HostLocalTrackedPrBlockerGateType;
  blockerSignature: string;
  failureClass: string;
  remediationTarget: string;
}): string {
  return [
    args.blockerSignature,
    `gate=${args.gateType}`,
    `failure=${args.failureClass}`,
    `target=${args.remediationTarget}`,
  ].join("|");
}

export function buildTrackedPrDraftReviewSuppressedComment(args: {
  pr: Pick<GitHubPullRequest, "headRefOid" | "number">;
}): string {
  return [
    `Tracked PR head \`${args.pr.headRefOid}\` is still draft because provider review is intentionally suppressed.`,
    "",
    `- reason code: \`${TRACKED_PR_STATUS_COMMENT_REASON_CODE_DRAFT_REVIEW_PROVIDER_SUPPRESSED}\``,
    "- what is happening: configured provider review stays suppressed until this PR is ready for review.",
    "- automatic retry: yes",
    `- next action: keep the tracked workspace moving toward ready-for-review promotion for PR #${args.pr.number}; the supervisor will retry automatically on later cycles.`,
    "",
    "GitHub checks may still be pending because external review-provider work does not start while the PR remains draft.",
  ].join("\n");
}

export function compactEvidenceLines(details: string[] | null | undefined, limit = 3): string[] {
  if (!details || details.length === 0) {
    return [];
  }

  return details
    .map((detail) => detail.replace(/\s+/g, " ").trim())
    .filter((detail) => detail.length > 0)
    .slice(0, limit);
}

export function buildTrackedPrPersistentStatusComment(args: {
  pr: Pick<GitHubPullRequest, "headRefOid" | "number">;
  reasonCode: string;
  summary: string;
  evidence: string[];
  nextAction: string;
  automaticRetry: "yes" | "no";
}): string {
  return [
    `Tracked PR head \`${args.pr.headRefOid}\` remains stopped near merge.`,
    "",
    `- reason code: \`${args.reasonCode}\``,
    `- summary: ${args.summary}`,
    ...args.evidence.map((detail) => `- evidence: ${detail}`),
    `- automatic retry: ${args.automaticRetry}`,
    `- next action: ${args.nextAction}`,
  ].join("\n");
}

export function buildTrackedPrCodexConnectorChurnStatusComment(args: {
  issueNumber: number;
  pr: Pick<GitHubPullRequest, "headRefOid">;
  dominantFile: string;
  currentEffectiveMustFixCount: number | string;
  countTrend: string;
  clusterCategorySignature: string;
  dossierAttemptMarker?: string | null;
  representativeThreadUrls: string[];
}): string {
  return [
    `Tracked PR head \`${args.pr.headRefOid}\` stopped because clustered Codex Connector review churn did not converge.`,
    "",
    `- current PR head: \`${args.pr.headRefOid}\``,
    `- reason code: \`${TRACKED_PR_STATUS_COMMENT_REASON_CODE_CODEX_CONNECTOR_CHURN}\``,
    `- dominant file: \`${args.dominantFile}\``,
    `- effective must-fix count: \`${args.currentEffectiveMustFixCount}\``,
    `- count trend: \`${args.countTrend}\``,
    `- normalized category signature: \`${args.clusterCategorySignature}\``,
    ...(args.dossierAttemptMarker ? [`- dossier attempt marker: \`${args.dossierAttemptMarker}\``] : []),
    ...args.representativeThreadUrls.map((url) => `- representative thread: ${url}`),
    "- automatic retry: no",
    `- next action: manually inspect the dominant file and representative Codex Connector threads, then run \`release-codex-churn-latch ${args.issueNumber}\` before restarting automation for this stopped fingerprint.`,
  ].join("\n");
}

export function buildTrackedPrManualReviewStatusComment(args: {
  pr: Pick<GitHubPullRequest, "headRefOid">;
  summary: string;
  evidence: string[];
  localReviewOutcome: string | null;
  localReviewSummaryPath: string | null;
}): string {
  return [
    `Tracked PR head \`${args.pr.headRefOid}\` is blocked by terminal local review and now requires operator manual review.`,
    "",
    `- current head SHA: \`${args.pr.headRefOid}\``,
    `- reason code: \`${TRACKED_PR_STATUS_COMMENT_REASON_CODE_MANUAL_REVIEW}\``,
    `- local-review outcome: \`${args.localReviewOutcome ?? "unknown"}\``,
    `- blocker summary: ${args.summary}`,
    ...(args.localReviewSummaryPath ? [`- local-review summary path: \`${args.localReviewSummaryPath}\``] : []),
    ...args.evidence.map((detail) => `- evidence: ${detail}`),
    "- automatic retry: no",
    "- next action: complete the required operator/manual review, then rerun the supervisor so progress can resume.",
  ].join("\n");
}

export function isTrackedPrActiveStatusState(state: RunState): boolean {
  switch (state) {
    case "local_review":
    case "local_review_fix":
    case "stabilizing":
    case "pr_open":
    case "repairing_ci":
    case "resolving_conflict":
    case "waiting_ci":
    case "addressing_review":
    case "ready_to_merge":
      return true;
    default:
      return false;
  }
}

export function buildTrackedPrClearedStatusComment(args: {
  pr: Pick<GitHubPullRequest, "headRefOid" | "number">;
  state: RunState;
}): string {
  return [
    `Tracked PR head \`${args.pr.headRefOid}\` blocker cleared; progress has resumed.`,
    "",
    `- reason code: \`${TRACKED_PR_STATUS_COMMENT_REASON_CODE_CLEARED}\``,
    `- current supervisor state: \`${args.state}\``,
    "- automatic retry: yes",
    `- next action: continue the tracked PR workflow for PR #${args.pr.number} from the current active state.`,
  ].join("\n");
}
