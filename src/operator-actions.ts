import type { LocalCiContractSummary } from "./core/types";

export type OperatorActionToken =
  | "continue"
  | "restart_loop"
  | "fix_config"
  | "adopt_local_ci"
  | "dismiss_local_ci"
  | "manual_review"
  | "resolve_stale_review_bot"
  | "provider_outage_suspected"
  | "safe_to_ignore";

export interface OperatorAction {
  action: OperatorActionToken;
  source: string;
  priority: number;
  summary: string;
}

export interface OperatorCockpitViewModel {
  action: OperatorAction;
  currentTaskContract: string | null;
  trustPosture: string | null;
  gateState: string | null;
  blockingReason: string | null;
  evidence: string[];
  fallbackCommand: string | null;
}

export type RestartRecommendationCategory =
  | "safe_restart"
  | "restart_required_for_convergence"
  | "restart_not_enough"
  | "manual_review_before_restart";

export interface RestartRecommendation {
  category: RestartRecommendationCategory;
  source: string;
  priority: number;
  summary: string;
}

const restartRecommendationPriority: Record<RestartRecommendationCategory, number> = {
  restart_required_for_convergence: 90,
  manual_review_before_restart: 80,
  safe_restart: 70,
  restart_not_enough: 40,
};

function chooseHighestPriority(actions: OperatorAction[], fallback: OperatorAction): OperatorAction {
  return [...actions].sort((left, right) => right.priority - left.priority)[0] ?? fallback;
}

function chooseHighestPriorityRecommendation(recommendations: RestartRecommendation[]): RestartRecommendation | null {
  return [...recommendations].sort((left, right) => right.priority - left.priority)[0] ?? null;
}

function getSafeRestartSource(line: string): string | null {
  if (/^loop_runtime_diagnostic\b/.test(line) && /\bstatus=duplicate\b/.test(line)) {
    return "loop_runtime_diagnostic";
  }
  if (/^doctor_loop_runtime_diagnostic\b/.test(line) && /\bstatus=duplicate\b/.test(line)) {
    return "doctor_loop_runtime_diagnostic";
  }
  if (/^loop_runtime_recovery\b/.test(line)) {
    return "loop_runtime_recovery";
  }
  if (/^doctor_loop_runtime_recovery\b/.test(line)) {
    return "doctor_loop_runtime_recovery";
  }
  return null;
}

const statusFallbackOperatorAction: OperatorAction = {
  action: "continue",
  source: "status",
  priority: 0,
  summary: "No blocking operator action was detected; continue normal supervisor operation.",
};

const doctorFallbackOperatorAction: OperatorAction = {
  action: "continue",
  source: "doctor",
  priority: 0,
  summary: "No blocking doctor action was detected; continue normal supervisor operation.",
};

const validOperatorActions: Record<OperatorActionToken, true> = {
  continue: true,
  restart_loop: true,
  fix_config: true,
  adopt_local_ci: true,
  dismiss_local_ci: true,
  manual_review: true,
  resolve_stale_review_bot: true,
  provider_outage_suspected: true,
  safe_to_ignore: true,
};

function readTokenValue(line: string, key: string): string | null {
  const match = new RegExp(`(?:^|\\s)${key}=([^\\s]+)`, "u").exec(line);
  return match?.[1] ?? null;
}

function readSummaryValue(line: string): string | null {
  const match = /(?:^|\s)summary=(.*)$/u.exec(line);
  return match?.[1]?.trim() || null;
}

export function parseOperatorActionLine(line: string): OperatorAction | null {
  if (!/^(operator_action|doctor_operator_action)\b/u.test(line)) {
    return null;
  }

  const action = readTokenValue(line, "action") as OperatorActionToken | null;
  const source = readTokenValue(line, "source");
  const priorityValue = readTokenValue(line, "priority");
  const summary = readSummaryValue(line);
  const priority = priorityValue === null ? Number.NaN : Number.parseInt(priorityValue, 10);

  if (
    action === null ||
    validOperatorActions[action] !== true ||
    source === null ||
    !Number.isFinite(priority) ||
    summary === null
  ) {
    return null;
  }

  return { action, source, priority, summary };
}

function selectRenderedOperatorAction(lines: string[]): OperatorAction | null {
  const actions = lines
    .map(parseOperatorActionLine)
    .filter((action): action is OperatorAction => action !== null);
  return actions.length === 0 ? null : chooseHighestPriority(actions, statusFallbackOperatorAction);
}

export function selectRestartRecommendation(args: {
  detailedStatusLines: string[];
}): RestartRecommendation | null {
  const recommendations: RestartRecommendation[] = [];

  for (const line of args.detailedStatusLines) {
    if (/^loop_runtime_blocker\b/.test(line)) {
      recommendations.push({
        category: "restart_required_for_convergence",
        source: "loop_runtime_blocker",
        priority: restartRecommendationPriority.restart_required_for_convergence,
        summary: "Restarting the supported supervisor loop is required before active tracked work can converge.",
      });
      continue;
    }

    const safeRestartSource = getSafeRestartSource(line);
    if (safeRestartSource !== null) {
      recommendations.push({
        category: "safe_restart",
        source: safeRestartSource,
        priority: restartRecommendationPriority.safe_restart,
        summary: "Restart can be safe after following the runtime ownership and duplicate-process guidance.",
      });
      continue;
    }

    const noActiveClassification = /^no_active_tracked_record\b/.test(line)
      ? /\bclassification=([^\s]+)/.exec(line)?.[1] ?? null
      : null;
    if (!noActiveClassification) {
      continue;
    }

    if (
      noActiveClassification === "safe_to_ignore" ||
      noActiveClassification === "stale_already_handled"
    ) {
      continue;
    }

    if (
      noActiveClassification === "active_tracked_work_blocker" ||
      noActiveClassification === "stale_but_recoverable"
    ) {
      recommendations.push({
        category: "restart_required_for_convergence",
        source: "no_active_tracked_record",
        priority: 60,
        summary: "Restarting the supported supervisor loop is required before active tracked work can converge.",
      });
      continue;
    }

    if (
      noActiveClassification === "manual_review_required" ||
      noActiveClassification === "provider_outage_suspected"
    ) {
      recommendations.push({
        category: "manual_review_before_restart",
        source: "no_active_tracked_record",
        priority: restartRecommendationPriority.manual_review_before_restart,
        summary: "Manual review is required before a restart should be treated as a recovery action.",
      });
      continue;
    }

    recommendations.push({
      category: "restart_not_enough",
      source: "no_active_tracked_record",
      priority: restartRecommendationPriority.restart_not_enough,
      summary: "Restart alone is not expected to resolve the current supervisor state.",
    });
  }

  return chooseHighestPriorityRecommendation(recommendations);
}

export function renderRestartRecommendationLine(
  prefix: "restart_recommendation" | "doctor_restart_recommendation",
  recommendation: RestartRecommendation | null,
): string | null {
  if (recommendation === null) {
    return null;
  }

  return [
    prefix,
    `category=${recommendation.category}`,
    `source=${recommendation.source}`,
    `summary=${recommendation.summary}`,
  ].join(" ");
}

export function appendRestartRecommendationLine(
  detailedStatusLines: string[],
  prefix: "restart_recommendation" | "doctor_restart_recommendation" = "restart_recommendation",
): string[] {
  if (detailedStatusLines.some((line) => line.startsWith(`${prefix} `))) {
    return detailedStatusLines;
  }

  const recommendationLine = renderRestartRecommendationLine(
    prefix,
    selectRestartRecommendation({ detailedStatusLines }),
  );
  return recommendationLine === null ? detailedStatusLines : [...detailedStatusLines, recommendationLine];
}

export function selectStatusOperatorAction(args: {
  detailedStatusLines: string[];
}): OperatorAction {
  const renderedAction = selectRenderedOperatorAction(args.detailedStatusLines);
  if (renderedAction !== null) {
    return renderedAction;
  }

  const actions: OperatorAction[] = [];

  for (const line of args.detailedStatusLines) {
    if (/^loop_runtime_blocker\b/.test(line)) {
      actions.push({
        action: "restart_loop",
        source: "loop_runtime_blocker",
        priority: 90,
        summary:
          "Tracked work is active but the supervisor loop is off; restart the supported loop host so the runtime reports running and tracked work can advance.",
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

    if (/^stale_review_bot_remediation\b/.test(line)) {
      actions.push({
        action: "resolve_stale_review_bot",
        source: "stale_review_bot_remediation",
        priority: 72,
        summary:
          "Code or CI is green but configured-bot review thread metadata is still unresolved; inspect the exact thread and resolve it or leave a manual note without changing merge policy.",
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

  return chooseHighestPriority(actions, statusFallbackOperatorAction);
}

function fallbackCommandForOperatorAction(action: OperatorActionToken): string | null {
  if (action === "fix_config" || action === "adopt_local_ci" || action === "dismiss_local_ci") {
    return "node dist/index.js doctor --config <supervisor-config-path>";
  }
  if (action === "restart_loop") {
    return "node dist/index.js status --why --config <supervisor-config-path>";
  }
  if (
    action === "manual_review" ||
    action === "resolve_stale_review_bot" ||
    action === "provider_outage_suspected"
  ) {
    return "node dist/index.js status --why --config <supervisor-config-path>";
  }
  return null;
}

function firstMatchingLine(lines: string[], source: string): string | null {
  return lines.find((line) => line.startsWith(`${source} `) || line === source) ?? null;
}

function summarizeCurrentTaskContract(lines: string[]): string | null {
  for (const line of lines) {
    const selectedIssue = readTokenValue(line, "selected_issue");
    if (selectedIssue !== null && selectedIssue !== "none") {
      return `selected_issue=${selectedIssue}`;
    }
    const activeIssue = readTokenValue(line, "active_issue");
    if (activeIssue !== null && activeIssue !== "none") {
      return `active_issue=${activeIssue}`;
    }
    if (/^current_issue=/u.test(line) || /^current_issue\b/u.test(line)) {
      return line;
    }
  }
  return null;
}

function summarizeTrustPosture(lines: string[]): string | null {
  const trustMode = lines.map((line) => readTokenValue(line, "trust_mode")).find((value) => value !== null) ?? null;
  const executionSafetyMode =
    lines.map((line) => readTokenValue(line, "execution_safety_mode")).find((value) => value !== null) ?? null;
  if (trustMode === null && executionSafetyMode === null) {
    return null;
  }
  return [
    trustMode === null ? null : `trust_mode=${trustMode}`,
    executionSafetyMode === null ? null : `execution_safety_mode=${executionSafetyMode}`,
  ].filter(Boolean).join(" ");
}

function summarizeGateState(evidenceLine: string | null): string | null {
  if (evidenceLine === null) {
    return null;
  }
  const gate = readTokenValue(evidenceLine, "gate");
  const remediationTarget = readTokenValue(evidenceLine, "remediation_target");
  if (gate === null && remediationTarget === null) {
    return null;
  }
  return [
    gate === null ? null : `gate=${gate}`,
    remediationTarget === null ? null : `remediation_target=${remediationTarget}`,
  ].filter(Boolean).join(" ");
}

function summarizeBlockingReason(evidenceLine: string | null): string | null {
  if (evidenceLine === null) {
    return null;
  }
  return (
    readTokenValue(evidenceLine, "blocked_reason") ??
    readTokenValue(evidenceLine, "local_blocked_reason") ??
    readTokenValue(evidenceLine, "reason")
  );
}

export function buildStatusOperatorCockpitViewModel(args: {
  detailedStatusLines: string[];
  readinessLines?: string[];
  whyLines?: string[];
}): OperatorCockpitViewModel {
  const lines = [
    ...args.detailedStatusLines,
    ...(args.readinessLines ?? []),
    ...(args.whyLines ?? []),
  ];
  const taskContractLines = [
    ...(args.whyLines ?? []),
    ...args.detailedStatusLines,
    ...(args.readinessLines ?? []),
  ];
  const action = selectStatusOperatorAction({ detailedStatusLines: args.detailedStatusLines });
  const evidenceLine = firstMatchingLine(lines, action.source);
  const evidence = evidenceLine === null ? [] : [evidenceLine];

  return {
    action,
    currentTaskContract: summarizeCurrentTaskContract(taskContractLines),
    trustPosture: summarizeTrustPosture(lines),
    gateState: summarizeGateState(evidenceLine),
    blockingReason: summarizeBlockingReason(evidenceLine),
    evidence,
    fallbackCommand: fallbackCommandForOperatorAction(action.action),
  };
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

  return chooseHighestPriority(actions, doctorFallbackOperatorAction);
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
