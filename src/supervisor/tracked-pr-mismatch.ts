import type {
  BlockedReason,
  GitHubPullRequest,
  IssueRunRecord,
  LatestLocalCiResult,
  PullRequestCheck,
  ReviewThread,
  RunState,
  SupervisorConfig,
} from "../core/types";
import {
  buildMissingWorkspacePreparationContractWarning,
  displayLocalCiCommand,
} from "../core/config";
import { projectTrackedPrLifecycle } from "../tracked-pr-lifecycle-projection";
import { hasFreshTrackedPrReadyPromotionBlockerEvidence } from "../tracked-pr-ready-promotion-blocker";

export interface TrackedPrMismatch {
  issueNumber: number;
  prNumber: number;
  githubState: RunState;
  githubBlockedReason: BlockedReason | null;
  localState: RunState;
  localBlockedReason: BlockedReason | null;
  staleLocalBlocker: boolean;
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
    ].join(" "),
  ];

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
    ?? "Local verification failed before ready-for-review promotion.";

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

  if ((record.last_error ?? "").includes("workstation-local path hygiene before marking PR")) {
    return {
      gate: "workstation_local_path_hygiene",
      failedGate: "workstation-local path hygiene",
      summary,
      detailLines: [
        [
          "tracked_pr_ready_promotion_gate",
          `issue=#${record.issue_number}`,
          `pr=#${record.pr_number}`,
          "gate=workstation_local_path_hygiene",
          `summary=${summary.replace(/\r?\n/g, "\\n")}`,
        ].join(" "),
      ],
    };
  }

  if (workspacePreparationFailureClass(record.last_failure_signature)) {
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
          `summary=${summary.replace(/\r?\n/g, "\\n")}`,
        ].join(" "),
      ],
    };
  }

  return {
    gate: "verification",
    failedGate: "local verification gate",
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
    return {
      issueNumber: record.issue_number,
      prNumber: pr.number,
      githubState,
      githubBlockedReason,
      localState: record.state,
      localBlockedReason: record.blocked_reason,
      staleLocalBlocker,
      summaryLine: [
        "tracked_pr_ready_promotion_blocked",
        `issue=#${record.issue_number}`,
        `pr=#${pr.number}`,
        `github_state=${githubState}`,
        `local_state=${record.state}`,
        `local_blocked_reason=${record.blocked_reason ?? "none"}`,
        `stale_local_blocker=${staleLocalBlocker ? "yes" : "no"}`,
      ].join(" "),
      guidanceLine: blockerHasFreshCurrentHeadEvidence
        ? `recovery_guidance=PR #${pr.number} is still draft because ready-for-review promotion is blocked by local verification. ` +
          `The same blocker is still present, so rerunning the supervisor alone will not help. ` +
          `Failed gate: ${readyPromotionGate.failedGate}. Fix the gate in the tracked workspace first, then rerun it to promote the PR.`
        : `recovery_guidance=PR #${pr.number} is still draft, but the stored ready-for-review verification blocker is stale relative to the current head. ` +
          "Run a one-shot supervisor cycle to refresh tracked PR state before assuming the gate still fails.",
      detailLines: readyPromotionGate.detailLines,
    };
  }

  return {
    issueNumber: record.issue_number,
    prNumber: pr.number,
    githubState,
    githubBlockedReason,
    localState: record.state,
    localBlockedReason: record.blocked_reason,
    staleLocalBlocker,
    summaryLine: [
      "tracked_pr_mismatch",
      `issue=#${record.issue_number}`,
      `pr=#${pr.number}`,
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
