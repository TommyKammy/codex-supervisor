import type { ExecutionSafetyMode, TrustMode } from "./core/types";
import type {
  SetupFieldState,
  SetupReadinessBlocker,
  SetupReadinessFieldKey,
  SetupReadinessNextAction,
  SetupReadinessReport,
} from "./setup-readiness";

type FirstRunSummaryStatus = "blocked" | "clear" | "optional" | "ready" | "unknown";

const VALID_TRUST_MODES = new Set<TrustMode>(["trusted_repo_and_authors", "untrusted_or_mixed"]);
const VALID_EXECUTION_SAFETY_MODES = new Set<ExecutionSafetyMode>(["unsandboxed_autonomous", "operator_gated"]);

function sanitizeFirstRunSummaryValue(value: string): string {
  return value.replace(/\r?\n/g, "\\n");
}

function setupFieldStatus(
  report: SetupReadinessReport,
  key: SetupReadinessFieldKey,
): SetupFieldState | "unknown" {
  return report.fields.find((field) => field.key === key)?.state ?? "unknown";
}

function setupFieldValue(
  report: SetupReadinessReport,
  key: SetupReadinessFieldKey,
): string {
  return report.fields.find((field) => field.key === key)?.value ?? "none";
}

function firstRunBlockerSummary(
  report: SetupReadinessReport,
  predicate: (blocker: SetupReadinessBlocker) => boolean,
): string {
  const blocker = report.blockers.find(predicate);
  return blocker ? sanitizeFirstRunSummaryValue(blocker.message) : "none";
}

function firstRunSectionStatus(hasBlocker: boolean, fallback: FirstRunSummaryStatus = "clear"): FirstRunSummaryStatus {
  return hasBlocker ? "blocked" : fallback;
}

function deriveFirstRunTrustSummary(report: SetupReadinessReport): string {
  const trustMode = setupFieldValue(report, "trustMode");
  const executionSafetyMode = setupFieldValue(report, "executionSafetyMode");
  if (
    report.trustPosture.configured !== true ||
    setupFieldStatus(report, "trustMode") !== "configured" ||
    setupFieldStatus(report, "executionSafetyMode") !== "configured" ||
    !VALID_TRUST_MODES.has(trustMode as TrustMode) ||
    !VALID_EXECUTION_SAFETY_MODES.has(executionSafetyMode as ExecutionSafetyMode)
  ) {
    return "unknown";
  }

  return trustMode === "trusted_repo_and_authors" && executionSafetyMode === "unsandboxed_autonomous"
    ? "Trusted inputs with unsandboxed autonomous execution. This is appropriate only for a trusted solo-lane repository and trusted GitHub authors."
    : "Trust posture avoids the default unsandboxed trusted-input assumption.";
}

function firstRunGitHubAuthStatus(report: SetupReadinessReport, githubAuthBlocked: boolean): FirstRunSummaryStatus {
  if (githubAuthBlocked) {
    return "blocked";
  }

  const githubAuthCheck = report.hostReadiness.checks.find((check) => check.name === "github_auth");
  return githubAuthCheck?.status === "pass" ? "clear" : "unknown";
}

function firstRunNextCommand(nextAction: SetupReadinessNextAction): string | null {
  if (nextAction.action === "fix_config") {
    return nextAction.source === "host_github_auth"
      ? "gh auth status --hostname github.com"
      : "node dist/index.js init --config <supervisor-config-path>";
  }

  if (nextAction.action === "continue") {
    return "node dist/index.js sample-issue --output <sample-issue-path>";
  }

  return null;
}

function selectFirstRunNextAction(report: SetupReadinessReport): SetupReadinessNextAction {
  const orderedSourcePrefixes = [
    "invalid_repo_path",
    "invalid_repo_slug",
    "invalid_workspace_root",
    "invalid_codex_binary",
    "invalid_",
    "missing_repo_path",
    "missing_repo_slug",
    "missing_workspace_root",
    "missing_codex_binary",
    "missing_",
    "host_github_auth",
    "host_codex_cli",
    "host_worktrees",
  ];
  const requiredActions = report.nextActions.filter((action) => action.required);
  for (const prefix of orderedSourcePrefixes) {
    const action = requiredActions.find((candidate) => candidate.source.startsWith(prefix));
    if (action) {
      return action;
    }
  }

  return requiredActions[0] ?? report.nextActions[0] ?? {
    action: "continue",
    source: "setup_readiness",
    priority: 0,
    required: false,
    summary: "No setup blockers or advisory setup decisions remain; continue normal supervisor operation.",
    fieldKeys: [],
  };
}

export function renderFirstRunDoctorSummary(report: SetupReadinessReport): string {
  const placeholderBlockers = report.blockers.filter((blocker) =>
    blocker.code.startsWith("invalid_") &&
    blocker.message.toLowerCase().includes("starter placeholder")
  );
  const localCiCommand = report.localCiContract?.recommendedCommand ?? report.localCiContract?.command ?? "none";
  const localCiStatus: FirstRunSummaryStatus =
    report.localCiContract?.configured === true
      ? "ready"
      : report.localCiContract?.source === "repo_script_candidate"
        ? "optional"
        : "clear";
  const trustBlocked = report.trustPosture.configured === false ||
    report.blockers.some((blocker) =>
      blocker.fieldKeys.includes("trustMode") || blocker.fieldKeys.includes("executionSafetyMode")
    );
  const githubAuthBlocked = report.blockers.some((blocker) => blocker.code === "host_github_auth");
  const nextAction = selectFirstRunNextAction(report);
  const nextCommand = firstRunNextCommand(nextAction);
  const lines = [
    `first_run_readiness ready=${report.ready} overall=${report.overallStatus}`,
    [
      "first_run_repo_identity",
      `repo_slug=${sanitizeFirstRunSummaryValue(setupFieldValue(report, "repoSlug"))}`,
      `default_branch=${setupFieldStatus(report, "defaultBranch")}`,
      `repo_path=${setupFieldStatus(report, "repoPath")}`,
      `workspace_root=${setupFieldStatus(report, "workspaceRoot")}`,
    ].join(" "),
    [
      "first_run_config_placeholders",
      `status=${firstRunSectionStatus(placeholderBlockers.length > 0)}`,
      `count=${placeholderBlockers.length}`,
      `summary=${placeholderBlockers.length === 0 ? "none" : sanitizeFirstRunSummaryValue(placeholderBlockers[0]!.message)}`,
    ].join(" "),
    [
      "first_run_local_ci",
      `status=${localCiStatus}`,
      `configured=${report.localCiContract?.configured === true}`,
      `command=${sanitizeFirstRunSummaryValue(localCiCommand)}`,
      `summary=${sanitizeFirstRunSummaryValue(report.localCiContract?.summary ?? "Local CI posture was not reported.")}`,
    ].join(" "),
    [
      "first_run_trust_posture",
      `status=${firstRunSectionStatus(trustBlocked)}`,
      `summary=${sanitizeFirstRunSummaryValue(deriveFirstRunTrustSummary(report))}`,
    ].join(" "),
    [
      "first_run_github_auth",
      `status=${firstRunGitHubAuthStatus(report, githubAuthBlocked)}`,
      `summary=${firstRunBlockerSummary(report, (blocker) => blocker.code === "host_github_auth")}`,
    ].join(" "),
    [
      "first_run_next_action",
      `action=${nextAction.action}`,
      `source=${nextAction.source}`,
      `required=${nextAction.required}`,
      `summary=${sanitizeFirstRunSummaryValue(nextAction.summary)}`,
    ].join(" "),
    ...(nextCommand === null ? [] : [`first_run_next_command command=${nextCommand}`]),
  ];

  return lines.join("\n");
}
