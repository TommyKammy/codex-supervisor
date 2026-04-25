import type {
  BlockedReason,
  GitHubPullRequest,
  IssueRunRecord,
  LatestLocalCiResult,
  LocalCiRemediationTarget,
  PullRequestCheck,
  ReviewThread,
  RunState,
  SupervisorConfig,
} from "../core/types";
import {
  buildMissingWorkspacePreparationContractWarning,
  displayLocalCiCommand,
} from "../core/config";
import {
  REMEDIATION_TARGET_CONFIG_CONTRACT,
  REMEDIATION_TARGET_MANUAL_REVIEW,
  REMEDIATION_TARGET_REPAIR_ALREADY_QUEUED,
  REMEDIATION_TARGET_TRACKED_PUBLISHABLE_CONTENT,
  REMEDIATION_TARGET_WORKSPACE_ENVIRONMENT,
  workspacePreparationRemediationTargetForFailureClass,
} from "../remediation-targets";
import { projectTrackedPrLifecycle } from "../tracked-pr-lifecycle-projection";
import { hasFreshTrackedPrReadyPromotionBlockerEvidence } from "../tracked-pr-ready-promotion-blocker";
import {
  classifyReadyPromotionRecoverability,
  classifyTrackedPrMismatchRecoverability,
  recoverabilityStatusToken,
  type StaleDiagnosticRecoverability,
} from "./stale-diagnostic-recoverability";

export interface TrackedPrMismatch {
  issueNumber: number;
  prNumber: number;
  githubState: RunState;
  githubBlockedReason: BlockedReason | null;
  localState: RunState;
  localBlockedReason: BlockedReason | null;
  staleLocalBlocker: boolean;
  recoverability: StaleDiagnosticRecoverability;
  summaryLine: string;
  guidanceLine: string;
  detailLines: string[];
}

export function shouldHydrateTrackedPrDiagnostics(
  record: IssueRunRecord,
): record is IssueRunRecord & { pr_number: number } {
  return record.pr_number !== null && record.state !== "done";
}

function isBlockedLikeState(state: RunState): boolean {
  return state === "blocked" || state === "failed";
}

function localCiHeadStatus(record: IssueRunRecord, pr: GitHubPullRequest, result: LatestLocalCiResult): "current" | "stale" | "unknown" {
  const currentHeadSha = pr.headRefOid ?? record.last_head_sha ?? null;
  if (result.head_sha === null || currentHeadSha === null) {
    return "unknown";
  }
  return result.head_sha === currentHeadSha ? "current" : "stale";
}

function summarizeGitHubChecks(checks: PullRequestCheck[], pr: GitHubPullRequest): "green" | "failing" | "pending" | "unknown" {
  if (checks.some((check) => check.bucket === "fail")) {
    return "failing";
  }
  if (checks.some((check) => check.bucket === "pending")) {
    return "pending";
  }
  if (checks.some((check) => check.bucket === "pass") || pr.currentHeadCiGreenAt) {
    return "green";
  }
  return "unknown";
}

function buildTrackedPrHostLocalCiDetailLines(
  config: SupervisorConfig,
  record: IssueRunRecord,
  pr: GitHubPullRequest,
  checks: PullRequestCheck[],
): string[] {
  const result = record.latest_local_ci_result ?? null;
  if (record.blocked_reason !== "verification" || result?.outcome !== "failed") {
    return [];
  }

  const detailLines = [
    [
      "tracked_pr_host_local_ci",
      `issue=#${record.issue_number}`,
      `pr=#${pr.number}`,
      `github_checks=${summarizeGitHubChecks(checks, pr)}`,
      `head_sha=${pr.headRefOid}`,
      `outcome=${result.outcome}`,
      `failure_class=${result.failure_class ?? "none"}`,
      `remediation_target=${result.remediation_target ?? "none"}`,
      `head=${localCiHeadStatus(record, pr, result)}`,
      `summary=${result.summary.replace(/\r?\n/g, "\\n")}`,
      ...(result.command ? [`command=${result.command}`] : []),
      ...(result.stderr_summary ? [`stderr_summary=${result.stderr_summary.replace(/\r?\n/g, "\\n")}`] : []),
    ].join(" "),
  ];

  if (result.verifier_drift_hint) {
    detailLines.push(
      [
        "tracked_pr_host_local_ci_hint",
        `issue=#${record.issue_number}`,
        `pr=#${pr.number}`,
        "kind=repo_owned_verifier_drift",
        `summary=${result.verifier_drift_hint.replace(/\r?\n/g, "\\n")}`,
      ].join(" "),
    );
  }

  if (result.failure_class === "workspace_toolchain_missing" && !config.workspacePreparationCommand) {
    const warning =
      buildMissingWorkspacePreparationContractWarning(config)
      ?? "workspacePreparationCommand is unset while host-local CI reported missing workspace toolchain prerequisites.";
    detailLines.push(
      [
        "tracked_pr_host_local_ci_gap",
        `issue=#${record.issue_number}`,
        `pr=#${pr.number}`,
        "workspace_preparation_command=unset",
        "gap=missing_workspace_prerequisite_visibility",
        `likely_cause=${warning.replace(/\r?\n/g, "\\n")}`,
      ].join(" "),
    );
  }

  return detailLines;
}

function parseRemediationTargetFromSignature(
  signature: string | null | undefined,
): LocalCiRemediationTarget | null {
  const target = signature?.match(/(?:^|\|)target=([^|]+)/)?.[1];
  switch (target) {
    case REMEDIATION_TARGET_WORKSPACE_ENVIRONMENT:
    case REMEDIATION_TARGET_CONFIG_CONTRACT:
    case REMEDIATION_TARGET_TRACKED_PUBLISHABLE_CONTENT:
    case REMEDIATION_TARGET_REPAIR_ALREADY_QUEUED:
    case REMEDIATION_TARGET_MANUAL_REVIEW:
      return target;
    default:
      return null;
  }
}

function deriveWorkstationLocalPathHygieneRemediationTarget(
  record: IssueRunRecord,
): LocalCiRemediationTarget {
  if (record.state === "repairing_ci") {
    return REMEDIATION_TARGET_REPAIR_ALREADY_QUEUED;
  }

  const persistedTarget = parseRemediationTargetFromSignature(
    record.last_host_local_pr_blocker_comment_signature,
  );
  if (persistedTarget) {
    return persistedTarget;
  }

  return REMEDIATION_TARGET_TRACKED_PUBLISHABLE_CONTENT;
}

function readyPromotionGateSummary(
  config: SupervisorConfig,
  record: IssueRunRecord,
  pr: GitHubPullRequest,
  checks: PullRequestCheck[],
): { gate: string; failedGate: string; summary: string; detailLines: string[] } {
  const summary =
    record.latest_local_ci_result?.summary
    ?? record.last_failure_context?.summary
    ?? record.last_error
    ?? "A repo-owned gate failed before ready-for-review promotion.";

  if (record.latest_local_ci_result?.outcome === "failed") {
    return {
      gate: "local_ci",
      failedGate: displayLocalCiCommand(config.localCiCommand) ?? "configured local CI command",
      summary,
      detailLines: [
        [
          "tracked_pr_ready_promotion_gate",
          `issue=#${record.issue_number}`,
          `pr=#${record.pr_number}`,
          "gate=local_ci",
          `summary=${summary.replace(/\r?\n/g, "\\n")}`,
        ].join(" "),
        ...buildTrackedPrHostLocalCiDetailLines(config, record, pr, checks),
      ],
    };
  }

  if (
    record.last_failure_signature === "workstation-local-path-hygiene-failed" ||
    (record.last_error ?? "").includes("workstation-local path hygiene before marking PR")
  ) {
    const remediationTarget = deriveWorkstationLocalPathHygieneRemediationTarget(record);
    const pathHygieneSummary = record.last_error ?? summary;
    return {
      gate: "workstation_local_path_hygiene",
      failedGate: "workstation-local path hygiene",
      summary: pathHygieneSummary,
      detailLines: [
        [
          "tracked_pr_ready_promotion_gate",
          `issue=#${record.issue_number}`,
          `pr=#${record.pr_number}`,
          "gate=workstation_local_path_hygiene",
          `remediation_target=${remediationTarget}`,
          `summary=${pathHygieneSummary.replace(/\r?\n/g, "\\n")}`,
        ].join(" "),
      ],
    };
  }

  const preparationFailureClass = workspacePreparationFailureClass(record.last_failure_signature);
  if (preparationFailureClass) {
    return {
      gate: "workspace_preparation",
      failedGate: displayLocalCiCommand(config.workspacePreparationCommand) ?? "workspacePreparationCommand",
      summary,
      detailLines: [
        [
          "tracked_pr_ready_promotion_gate",
          `issue=#${record.issue_number}`,
          `pr=#${record.pr_number}`,
          "gate=workspace_preparation",
          `failure_class=${preparationFailureClass}`,
          `remediation_target=${workspacePreparationRemediationTargetForFailureClass(preparationFailureClass)}`,
          `summary=${summary.replace(/\r?\n/g, "\\n")}`,
        ].join(" "),
      ],
    };
  }

  return {
    gate: "verification",
    failedGate: "ready-promotion gate",
    summary,
    detailLines: [
      [
        "tracked_pr_ready_promotion_gate",
        `issue=#${record.issue_number}`,
        `pr=#${record.pr_number}`,
        "gate=verification",
        `summary=${summary.replace(/\r?\n/g, "\\n")}`,
      ].join(" "),
    ],
  };
}

function workspacePreparationFailureClass(
  signature: string | null | undefined,
): "missing_command" | "workspace_toolchain_missing" | "worktree_helper_missing" | "non_zero_exit" | null {
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

export function buildTrackedPrMismatch(
  config: SupervisorConfig,
  record: IssueRunRecord,
  pr: GitHubPullRequest,
  checks: PullRequestCheck[],
  reviewThreads: ReviewThread[],
): TrackedPrMismatch | null {
  if (record.pr_number === null) {
    return null;
  }

  const projection = projectTrackedPrLifecycle({
    config,
    record,
    pr,
    checks,
    reviewThreads,
  });
  const githubState = projection.nextState;
  const githubBlockedReason = projection.nextBlockedReason;

  if (
    record.state === "repairing_ci" &&
    record.last_failure_signature === "workstation-local-path-hygiene-failed" &&
    githubState === "draft_pr" &&
    pr.isDraft
  ) {
    const readyPromotionGate = readyPromotionGateSummary(config, record, pr, checks);
    return {
      issueNumber: record.issue_number,
      prNumber: pr.number,
      githubState,
      githubBlockedReason,
      localState: record.state,
      localBlockedReason: record.blocked_reason,
      staleLocalBlocker: false,
      recoverability: "repair_queued",
      summaryLine: [
        "tracked_pr_ready_promotion_blocked",
        `issue=#${record.issue_number}`,
        `pr=#${pr.number}`,
        recoverabilityStatusToken("repair_queued"),
        `github_state=${githubState}`,
        `local_state=${record.state}`,
        `local_blocked_reason=${record.blocked_reason ?? "none"}`,
        "stale_local_blocker=no",
      ].join(" "),
      guidanceLine:
        `recovery_guidance=PR #${pr.number} is still draft because ready-for-review promotion found repairable workstation-local path hygiene findings. ` +
        "The supervisor has queued a repair turn for the actionable publishable tracked files before retrying promotion.",
      detailLines: readyPromotionGate.detailLines,
    };
  }

  const mismatch =
    isBlockedLikeState(record.state) &&
    (githubState !== record.state || (githubState === "blocked" && githubBlockedReason !== record.blocked_reason));

  if (!mismatch) {
    return null;
  }

  const staleLocalBlocker =
    record.blocked_reason !== null &&
    (githubState !== "blocked" || githubBlockedReason !== record.blocked_reason);

  if (record.state === "blocked" && record.blocked_reason === "verification" && githubState === "draft_pr" && pr.isDraft) {
    const readyPromotionGate = readyPromotionGateSummary(config, record, pr, checks);
    const blockerHasFreshCurrentHeadEvidence = hasFreshTrackedPrReadyPromotionBlockerEvidence(record, pr);
    const recoverability = classifyReadyPromotionRecoverability({
      staleLocalBlocker,
      blockerHasFreshCurrentHeadEvidence,
    });
    return {
      issueNumber: record.issue_number,
      prNumber: pr.number,
      githubState,
      githubBlockedReason,
      localState: record.state,
      localBlockedReason: record.blocked_reason,
      staleLocalBlocker,
      recoverability,
      summaryLine: [
        "tracked_pr_ready_promotion_blocked",
        `issue=#${record.issue_number}`,
        `pr=#${pr.number}`,
        recoverabilityStatusToken(recoverability),
        `github_state=${githubState}`,
        `local_state=${record.state}`,
        `local_blocked_reason=${record.blocked_reason ?? "none"}`,
        `stale_local_blocker=${staleLocalBlocker ? "yes" : "no"}`,
      ].join(" "),
      guidanceLine: blockerHasFreshCurrentHeadEvidence
        ? `recovery_guidance=PR #${pr.number} is still draft because ready-for-review promotion is blocked by a repo-owned gate. ` +
          `The same blocker is still present, so rerunning the supervisor alone will not help. ` +
          `Failed gate: ${readyPromotionGate.failedGate}. Fix the gate in the tracked workspace first, then rerun it to promote the PR.`
        : `recovery_guidance=PR #${pr.number} is still draft, but the stored ready-for-review verification blocker is stale relative to the current head. ` +
          "Run a one-shot supervisor cycle to refresh tracked PR state before assuming the gate still fails.",
      detailLines: readyPromotionGate.detailLines,
    };
  }

  const recoverability = classifyTrackedPrMismatchRecoverability({
    githubState,
    githubBlockedReason,
    localBlockedReason: record.blocked_reason,
    staleLocalBlocker,
  });

  return {
    issueNumber: record.issue_number,
    prNumber: pr.number,
    githubState,
    githubBlockedReason,
    localState: record.state,
    localBlockedReason: record.blocked_reason,
    staleLocalBlocker,
    recoverability,
    summaryLine: [
      "tracked_pr_mismatch",
      `issue=#${record.issue_number}`,
      `pr=#${pr.number}`,
      recoverabilityStatusToken(recoverability),
      `github_state=${githubState}`,
      `github_blocked_reason=${githubBlockedReason ?? "none"}`,
      `local_state=${record.state}`,
      `local_blocked_reason=${record.blocked_reason ?? "none"}`,
      `stale_local_blocker=${staleLocalBlocker ? "yes" : "no"}`,
    ].join(" "),
    guidanceLine:
      "recovery_guidance=Tracked PR facts are fresher than local state; run a one-shot supervisor cycle such as `node dist/index.js run-once --config ... --dry-run` to refresh tracked PR state. Explicit requeue is unavailable for tracked PR work.",
    detailLines: buildTrackedPrHostLocalCiDetailLines(config, record, pr, checks),
  };
}
