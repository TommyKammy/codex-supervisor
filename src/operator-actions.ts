import type { LocalCiContractSummary } from "./core/types";

export type OperatorActionToken =
  | "continue"
  | "restart_loop"
  | "fix_config"
  | "adopt_local_ci"
  | "dismiss_local_ci"
  | "manual_review"
  | "provider_outage_suspected"
  | "safe_to_ignore";

export interface OperatorAction {
  action: OperatorActionToken;
  source: string;
  priority: number;
  summary: string;
}

function chooseHighestPriority(actions: OperatorAction[]): OperatorAction {
  return [...actions].sort((left, right) => right.priority - left.priority)[0] ?? {
    action: "continue",
    source: "status",
    priority: 0,
    summary: "No blocking operator action was detected; continue normal supervisor operation.",
  };
}

export function selectStatusOperatorAction(args: {
  detailedStatusLines: string[];
}): OperatorAction {
  const actions: OperatorAction[] = [];

  for (const line of args.detailedStatusLines) {
    if (/^loop_runtime_blocker\b/.test(line)) {
      actions.push({
        action: "restart_loop",
        source: "loop_runtime_blocker",
        priority: 90,
        summary: "Tracked work is active but the supervisor loop is off; restart the loop to resume background execution.",
      });
      continue;
    }

    if (/^tracked_pr_host_local_ci\b/.test(line) && /\bremediation_target=workspace_environment\b/.test(line)) {
      actions.push({
        action: "fix_config",
        source: "tracked_pr_host_local_ci",
        priority: 80,
        summary:
          "Host-local CI could not run because the workspace environment is missing prerequisites; fix configuration or workspace preparation before continuing.",
      });
      continue;
    }

    if (/^tracked_pr_host_local_ci_gap\b/.test(line)) {
      actions.push({
        action: "fix_config",
        source: "tracked_pr_host_local_ci_gap",
        priority: 75,
        summary:
          "Host-local CI visibility is incomplete; fix workspace preparation configuration before trusting the local CI posture.",
      });
      continue;
    }

    if (/^review_bot_diagnostics\b/.test(line) && /\bstatus=provider_outage_suspected\b/.test(line)) {
      actions.push({
        action: "provider_outage_suspected",
        source: "review_bot_diagnostics",
        priority: 70,
        summary:
          "The configured review provider has not reported on the current head after checks turned green; wait, verify provider delivery, or escalate to manual review.",
      });
      continue;
    }

    if (
      /^blocked_partial_work\b/.test(line) ||
      /^tracked_pr_mismatch\b/.test(line) && /\blocal_blocked_reason=manual_review\b/.test(line) ||
      /^pre_merge_evaluation\b/.test(line) && /\bmanual_review=[1-9]\d*\b/.test(line)
    ) {
      actions.push({
        action: "manual_review",
        source: line.split(/\s/u, 1)[0] ?? "status",
        priority: 65,
        summary: "A tracked issue requires manual review before the supervisor should continue that path.",
      });
    }
  }

  return chooseHighestPriority(actions);
}

export function selectDoctorOperatorAction(args: {
  overallStatus: "pass" | "warn" | "fail";
  checks: Array<{ name: string; status: "pass" | "warn" | "fail" }>;
  localCiContract: LocalCiContractSummary;
}): OperatorAction {
  const actions: OperatorAction[] = [];

  if (args.checks.some((check) => check.status === "fail")) {
    actions.push({
      action: "fix_config",
      source: "doctor_check",
      priority: 80,
      summary: "Doctor found a failing host prerequisite; fix the reported check before continuing supervisor operation.",
    });
  }

  if (args.localCiContract.source === "repo_script_candidate") {
    actions.push({
      action: "adopt_local_ci",
      source: "doctor_local_ci",
      priority: 55,
      summary:
        "Repo-owned local CI candidate exists; adopt it in config or explicitly dismiss it before relying on local verification posture.",
    });
  }

  if (args.localCiContract.source === "dismissed_repo_script_candidate") {
    actions.push({
      action: "safe_to_ignore",
      source: "doctor_local_ci",
      priority: 10,
      summary: "Repo-owned local CI candidate was intentionally dismissed; no local CI adoption action is required.",
    });
  }

  if (args.overallStatus === "warn") {
    actions.push({
      action: "manual_review",
      source: "doctor_warning",
      priority: 45,
      summary: "Doctor found a warning that should be reviewed before relying on steady-state automation.",
    });
  }

  return chooseHighestPriority(actions);
}

export function renderOperatorActionLine(prefix: "operator_action" | "doctor_operator_action", action: OperatorAction): string {
  return [
    prefix,
    `action=${action.action}`,
    `source=${action.source}`,
    `priority=${action.priority}`,
    `summary=${action.summary}`,
  ].join(" ");
}
