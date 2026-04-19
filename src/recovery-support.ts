import fs from "node:fs";
import path from "node:path";
import { runCommand } from "./core/command";
import {
  isIgnoredSupervisorArtifactPath,
  normalizeGitPath,
  parseGitStatusPorcelainV1Entries,
  parseGitStatusPorcelainV1Paths,
  parseGitWorktreePaths,
} from "./core/git-workspace-helpers";
import { resolveTrackedIssueHostPaths } from "./core/journal";
import { type IssueRunRecord, type SupervisorConfig } from "./core/types";
import { nowIso } from "./core/utils";

type FailedNoPrBranchRecoveryState =
  | "recoverable"
  | "dirty_workspace"
  | "already_satisfied_on_main"
  | "manual_review_required";

const FAILED_NO_PR_ALREADY_SATISFIED_SIGNATURE = "failed-no-pr-already-satisfied-on-main";
const FAILED_NO_PR_MANUAL_REVIEW_SIGNATURE = "failed-no-pr-manual-review-required";
const UNSAFE_NO_PR_REVALIDATION_SIGNATURE = "unsafe-no-pr-revalidation-failed";

export function shouldReconsiderNoPrDoneRecord(
  record: Pick<IssueRunRecord, "pr_number">,
): boolean {
  return record.pr_number === null;
}

export function buildUnsafeNoPrFailureContext(args: {
  issueNumber: number;
  localState: "done" | "stabilizing";
  githubIssueState: "OPEN" | "UNKNOWN";
  detail: string;
}): NonNullable<IssueRunRecord["last_failure_context"]> {
  const localStateSummary = args.localState === "done"
    ? `Issue #${args.issueNumber} is locally marked done without authoritative completion evidence`
    : `Issue #${args.issueNumber} is in stale stabilizing recovery without authoritative completion evidence`;
  const githubStateSummary = args.githubIssueState === "OPEN"
    ? "but GitHub still reports the issue as open."
    : "and GitHub revalidation could not confirm the current issue state.";

  return {
    category: "blocked",
    summary: `${localStateSummary}, ${githubStateSummary} ${args.detail}`,
    signature: args.githubIssueState === "OPEN"
      ? FAILED_NO_PR_ALREADY_SATISFIED_SIGNATURE
      : UNSAFE_NO_PR_REVALIDATION_SIGNATURE,
    command: null,
    details: [
      `state=${args.localState}`,
      "tracked_pr=none",
      `github_issue_state=${args.githubIssueState}`,
      "completion_evidence=missing",
      "operator_action=confirm whether the issue should be requeued or whether completion landed outside the tracked PR flow",
    ],
    url: null,
    updated_at: nowIso(),
  };
}

export function sanitizeRecoveryReason(reason: string): string {
  return reason.replace(/\r?\n/g, "\\n");
}

export function buildFailedNoPrBranchFailureContext(args: {
  record: Pick<IssueRunRecord, "issue_number">;
  branchRecoveryState: Exclude<FailedNoPrBranchRecoveryState, "recoverable">;
  headSha: string | null;
  defaultBranch: string;
  preservedTrackedFiles?: string[];
}): NonNullable<IssueRunRecord["last_failure_context"]> {
  const { record, branchRecoveryState, headSha, defaultBranch } = args;
  const preservedTrackedFiles = [...new Set(args.preservedTrackedFiles ?? [])].sort();
  const branchSummary = branchRecoveryState === "already_satisfied_on_main"
    ? `Issue #${record.issue_number} failed without a tracked PR, and the preserved branch no longer differs from origin/${defaultBranch}. Confirm whether the implementation already landed elsewhere before requeueing manually.`
    : `Issue #${record.issue_number} failed without a tracked PR, and the preserved workspace is not safe for automatic recovery. Manual review is required.`;
  const operatorAction = branchRecoveryState === "already_satisfied_on_main"
    ? "operator_action=confirm whether the implementation already landed elsewhere or requeue manually if more work is still required"
    : "operator_action=inspect the preserved workspace and resolve the unsafe or ambiguous branch state before requeueing manually";

  return {
    category: "blocked",
    summary: branchSummary,
    signature: branchRecoveryState === "already_satisfied_on_main"
      ? FAILED_NO_PR_ALREADY_SATISFIED_SIGNATURE
      : FAILED_NO_PR_MANUAL_REVIEW_SIGNATURE,
    command: null,
    details: [
      "state=failed",
      "tracked_pr=none",
      `branch_state=${branchRecoveryState}`,
      `default_branch=origin/${defaultBranch}`,
      `head_sha=${headSha ?? "unknown"}`,
      ...(preservedTrackedFiles.length > 0
        ? [
          "preserved_partial_work=yes",
          `tracked_file_count=${preservedTrackedFiles.length}`,
          `tracked_files=${preservedTrackedFiles.join("|")}`,
        ]
        : []),
      operatorAction,
    ],
    url: null,
    updated_at: nowIso(),
  };
}

export async function classifyFailedNoPrBranchRecovery(args: {
  config: Pick<
    SupervisorConfig,
    "repoPath" | "defaultBranch" | "issueJournalRelativePath" | "codexExecTimeoutMinutes" | "workspaceRoot" | "branchPrefix"
  >;
  record: Pick<IssueRunRecord, "issue_number" | "workspace" | "journal_path" | "branch">;
  ensureOriginDefaultBranchFetched: () => Promise<void>;
  isSafeCleanupTarget: (
    config: Pick<SupervisorConfig, "workspaceRoot" | "branchPrefix">,
    workspacePath: string,
    branchName: string,
  ) => boolean;
}): Promise<{ state: FailedNoPrBranchRecoveryState; headSha: string | null; preservedTrackedFiles?: string[] }> {
  const { config, record } = args;
  const resolvedPaths = resolveTrackedIssueHostPaths(config, record);
  if (
    !args.isSafeCleanupTarget(config, resolvedPaths.workspace, record.branch) ||
    !fs.existsSync(path.join(resolvedPaths.workspace, ".git"))
  ) {
    return { state: "manual_review_required", headSha: null };
  }

  const journalRelativePath = path.relative(resolvedPaths.workspace, resolvedPaths.journal_path).replace(/\\/g, "/");
  const gitProbeTimeoutMs = config.codexExecTimeoutMinutes * 60_000;

  try {
    const worktreeListResult = await runCommand(
      "git",
      ["-C", config.repoPath, "worktree", "list", "--porcelain"],
      { timeoutMs: gitProbeTimeoutMs },
    );
    if (!parseGitWorktreePaths(worktreeListResult.stdout).has(normalizeGitPath(resolvedPaths.workspace))) {
      return { state: "manual_review_required", headSha: null };
    }

    const branchResult = await runCommand(
      "git",
      ["-C", resolvedPaths.workspace, "symbolic-ref", "--quiet", "--short", "HEAD"],
      {
        allowExitCodes: [0, 1],
        timeoutMs: gitProbeTimeoutMs,
      },
    );
    if (branchResult.exitCode !== 0 || branchResult.stdout.trim() !== record.branch) {
      return { state: "manual_review_required", headSha: null };
    }

    await args.ensureOriginDefaultBranchFetched();
    const [headResult, baseAheadResult, baseDiffResult, workspaceStatusResult] = await Promise.all([
      runCommand("git", ["-C", resolvedPaths.workspace, "rev-parse", "HEAD"], {
        timeoutMs: gitProbeTimeoutMs,
      }),
      runCommand(
        "git",
        ["-C", resolvedPaths.workspace, "rev-list", "--left-right", "--count", `origin/${config.defaultBranch}...HEAD`],
        { timeoutMs: gitProbeTimeoutMs },
      ),
      runCommand("git", ["-C", resolvedPaths.workspace, "diff", "--name-only", `origin/${config.defaultBranch}...HEAD`], {
        timeoutMs: gitProbeTimeoutMs,
      }),
      runCommand("git", ["-C", resolvedPaths.workspace, "status", "--porcelain=v1", "-z", "--untracked-files=all"], {
        timeoutMs: gitProbeTimeoutMs,
      }),
    ]);

    const [, baseAheadRaw = "0"] = baseAheadResult.stdout.trim().split(/\s+/);
    const baseAhead = Number(baseAheadRaw) || 0;
    const meaningfulBaseDiff = baseDiffResult.stdout
      .split("\n")
      .filter((line) => line.length > 0 && !isIgnoredSupervisorArtifactPath(line, journalRelativePath));
    const meaningfulWorkspaceChanges = parseGitStatusPorcelainV1Paths(workspaceStatusResult.stdout)
      .filter((paths) =>
        paths.some((relativePath) => !isIgnoredSupervisorArtifactPath(relativePath, journalRelativePath)));
    const meaningfulTrackedWorkspaceChanges = parseGitStatusPorcelainV1Entries(workspaceStatusResult.stdout)
      .filter((entry) => entry.statusCode !== "??")
      .map((entry) => entry.paths)
      .filter((paths) =>
        paths.some((relativePath) => !isIgnoredSupervisorArtifactPath(relativePath, journalRelativePath)));

    if (baseAhead > 0 && meaningfulBaseDiff.length > 0 && meaningfulWorkspaceChanges.length === 0) {
      return { state: "recoverable", headSha: headResult.stdout.trim() || null };
    }

    if (meaningfulBaseDiff.length === 0 && meaningfulWorkspaceChanges.length === 0) {
      return { state: "already_satisfied_on_main", headSha: headResult.stdout.trim() || null };
    }

    return {
      state: "dirty_workspace",
      headSha: headResult.stdout.trim() || null,
      preservedTrackedFiles: [
        ...new Set([
          ...meaningfulBaseDiff,
          ...meaningfulTrackedWorkspaceChanges.flatMap((paths) => paths),
        ]),
      ].sort(),
    };
  } catch {
    return { state: "manual_review_required", headSha: null };
  }
}

export function shouldAutoRecoverFailedNoPr(
  record: Pick<
    IssueRunRecord,
    "state" | "pr_number" | "last_failure_kind" | "stale_stabilizing_no_pr_recovery_count"
  >,
  config: Pick<SupervisorConfig, "sameFailureSignatureRepeatLimit">,
): boolean {
  const staleNoPrRepeatLimit = Math.max(config.sameFailureSignatureRepeatLimit, 1);

  return (
    record.state === "failed" &&
    record.pr_number === null &&
    record.last_failure_kind !== "codex_failed" &&
    (record.stale_stabilizing_no_pr_recovery_count ?? 0) < staleNoPrRepeatLimit
  );
}

export function doneResetPatch(
  patch: Partial<IssueRunRecord> = {},
): Partial<IssueRunRecord> {
  return {
    state: "done",
    last_error: null,
    blocked_reason: null,
    local_review_blocker_summary: null,
    local_review_recommendation: null,
    local_review_degraded: false,
    external_review_head_sha: null,
    external_review_misses_path: null,
    external_review_matched_findings_count: 0,
    external_review_near_match_findings_count: 0,
    external_review_missed_findings_count: 0,
    last_failure_kind: null,
    last_failure_context: null,
    last_blocker_signature: null,
    last_failure_signature: null,
    timeout_retry_count: 0,
    blocked_verification_retry_count: 0,
    repeated_blocker_count: 0,
    repeated_failure_signature_count: 0,
    stale_stabilizing_no_pr_recovery_count: 0,
    ...patch,
  };
}
