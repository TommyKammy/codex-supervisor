import type { LocalCiContractSummary } from "./core/types";

export interface OperatorActionVocabularyEntry {
  readonly action: string;
  readonly surfaces: ReadonlyArray<"status" | "doctor" | "webui">;
  readonly meaning: string;
  readonly routingCategory: "operator_action";
  readonly mutationAuthority: "none";
}

export interface ExternalOrchestrationHandoffVocabularyEntry {
  readonly handoff: string;
  readonly meaning: string;
  readonly routingCategory: "external_orchestration_handoff";
  readonly mutationAuthority: "none";
}

export const operatorActionVocabulary = [
  {
    action: "continue",
    surfaces: ["status", "doctor", "webui"],
    meaning: "No blocking operator action was detected; continue normal supervisor operation.",
    routingCategory: "operator_action",
    mutationAuthority: "none",
  },
  {
    action: "restart_loop",
    surfaces: ["status", "webui"],
    meaning:
      "Tracked work is active but the supervisor loop is off; restart the supported loop host so the runtime reports running and tracked work can advance.",
    routingCategory: "operator_action",
    mutationAuthority: "none",
  },
  {
    action: "fix_config",
    surfaces: ["status", "doctor", "webui"],
    meaning:
      "Repair host prerequisites, setup fields, workspace-preparation configuration, or incomplete local CI visibility before continuing.",
    routingCategory: "operator_action",
    mutationAuthority: "none",
  },
  {
    action: "adopt_local_ci",
    surfaces: ["doctor", "webui"],
    meaning: "A repo-owned local CI candidate exists; configure it before relying on local verification posture.",
    routingCategory: "operator_action",
    mutationAuthority: "none",
  },
  {
    action: "dismiss_local_ci",
    surfaces: ["webui"],
    meaning: "Explicitly dismiss a repo-owned local CI recommendation when local CI should remain unset.",
    routingCategory: "operator_action",
    mutationAuthority: "none",
  },
  {
    action: "manual_review",
    surfaces: ["status", "doctor", "webui"],
    meaning: "A tracked path or diagnostic warning requires human judgment before automation should continue.",
    routingCategory: "operator_action",
    mutationAuthority: "none",
  },
  {
    action: "resolve_stale_review_bot",
    surfaces: ["status", "webui"],
    meaning:
      "Code or CI is green but stale configured-bot review thread metadata still blocks the tracked PR; inspect and resolve the exact thread or leave a manual note.",
    routingCategory: "operator_action",
    mutationAuthority: "none",
  },
  {
    action: "provider_outage_suspected",
    surfaces: ["status", "webui"],
    meaning:
      "Required checks are green but the configured review provider has not reported on the current head; wait, verify provider delivery, or escalate to manual review.",
    routingCategory: "operator_action",
    mutationAuthority: "none",
  },
  {
    action: "safe_to_ignore",
    surfaces: ["doctor", "webui"],
    meaning: "A dismissed or already-completed advisory signal does not require operator action.",
    routingCategory: "operator_action",
    mutationAuthority: "none",
  },
] as const satisfies readonly OperatorActionVocabularyEntry[];

export type OperatorActionToken = typeof operatorActionVocabulary[number]["action"];

export const externalOrchestrationHandoffVocabulary = [
  {
    handoff: "evaluate",
    meaning: "Read roadmap, GitHub, local status, and note state without changing supervisor runtime state.",
    routingCategory: "external_orchestration_handoff",
    mutationAuthority: "none",
  },
  {
    handoff: "route",
    meaning: "Route actionable changes to an operator or the next runnable issue without selecting execution authority.",
    routingCategory: "external_orchestration_handoff",
    mutationAuthority: "none",
  },
  {
    handoff: "draft",
    meaning: "Draft confirm-required follow-up issues without making them the default execution path.",
    routingCategory: "external_orchestration_handoff",
    mutationAuthority: "none",
  },
  {
    handoff: "record",
    meaning: "Record durable external history after real issue, PR, verification, or phase state changes.",
    routingCategory: "external_orchestration_handoff",
    mutationAuthority: "none",
  },
  {
    handoff: "notify",
    meaning: "Notify the operator about actionable state changes without modifying supervisor state.",
    routingCategory: "external_orchestration_handoff",
    mutationAuthority: "none",
  },
  {
    handoff: "prepare_evidence",
    meaning: "Prepare operator-facing evidence without treating that evidence as executor authority.",
    routingCategory: "external_orchestration_handoff",
    mutationAuthority: "none",
  },
] as const satisfies readonly ExternalOrchestrationHandoffVocabularyEntry[];

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

export const validOperatorActions = Object.fromEntries(
  operatorActionVocabulary.map((entry) => [entry.action, true]),
) as Record<OperatorActionToken, true>;

export function parseOperatorActionPriority(priorityValue: string | null): number {
  return priorityValue !== null && /^-?\d+$/u.test(priorityValue)
    ? Number.parseInt(priorityValue, 10)
    : Number.NaN;
}

function readTokenValue(line: string, key: string): string | null {
  const match = new RegExp(`(?:^|\\s)${key}=([^\\s]+)`, "u").exec(line);
  return match?.[1] ?? null;
}

function readSummaryValue(line: string): string | null {
  const match = /(?:^|\s)summary=(.*)$/u.exec(line);
  return match?.[1]?.trim() || null;
}

function readIssueNumberToken(line: string, key: string): number | null {
  const value = readTokenValue(line, key);
  if (value === null) {
    return null;
  }

  const match = /^#?(\d+)$/u.exec(value);
  return match === null ? null : Number.parseInt(match[1], 10);
}

function clusteredCodexChurnManualReviewSummary(line: string): string | null {
  if (!/^codex_connector_review_churn_progress\b/u.test(line)) {
    return null;
  }

  const classification = readTokenValue(line, "classification");
  if (classification !== "unchanged" && classification !== "worse") {
    return null;
  }

  const currentEffectiveMustFix = readTokenValue(line, "current_effective_must_fix");
  const dominantFile = readTokenValue(line, "dominant_file");
  const previousDominantFile = readTokenValue(line, "previous_dominant_file");
  const clusterCategorySignature = readTokenValue(line, "cluster_category_signature");
  const previousClusterCategorySignature = readTokenValue(line, "previous_cluster_category_signature");
  if (
    currentEffectiveMustFix === null ||
    dominantFile === null ||
    previousDominantFile === null ||
    clusterCategorySignature === null ||
    previousClusterCategorySignature === null
  ) {
    return null;
  }

  if (
    dominantFile !== previousDominantFile ||
    clusterCategorySignature !== previousClusterCategorySignature
  ) {
    return null;
  }

  return `Clustered Codex Connector churn made no progress; inspect dominant file ${dominantFile} with current effective must-fix count ${currentEffectiveMustFix} before restarting the loop.`;
}

function hasStoppedClusteredCodexChurnManualReviewGate(
  lines: string[],
  requestEligibleRecoveryIssues: ReadonlySet<number>,
): boolean {
  return lines.some((line) => {
    const isLoopRuntimeBlocker = /^loop_runtime_blocker\b/u.test(line);
    const isNoActiveManualReview =
      /^no_active_tracked_record\b/u.test(line) && /\bclassification=manual_review_required\b/u.test(line);
    if (!isLoopRuntimeBlocker && !isNoActiveManualReview) {
      return false;
    }

    const gateIssueNumber = isLoopRuntimeBlocker
      ? readIssueNumberToken(line, "first_issue")
      : readIssueNumberToken(line, "issue");

    if (gateIssueNumber === null) {
      return requestEligibleRecoveryIssues.size === 0;
    }

    return !requestEligibleRecoveryIssues.has(gateIssueNumber);
  });
}

function hasUnblockedActiveIssueState(lines: string[]): boolean {
  const state = lines
    .map((line) => /^state=([^\s]+)$/u.exec(line)?.[1] ?? null)
    .find((value): value is string => value !== null);
  if (state === undefined || state === "blocked" || state === "done" || state === "failed") {
    return false;
  }

  return lines.some((line) => /^blocked_reason=none$/u.test(line));
}

function readIssuePrKey(line: string): string | null {
  const issueNumber = readIssueNumberToken(line, "issue");
  const prNumber = readIssueNumberToken(line, "pr");
  return issueNumber === null || prNumber === null ? null : `${issueNumber}:${prNumber}`;
}

function verifiedCurrentHeadRepairResidueMergeReadyDiagnosticKeys(lines: string[]): ReadonlySet<string> {
  const readyGitHubPrKeys = new Set<string>();
  const mergeReadyConvergenceKeys = new Set<string>();
  const unsuppressedDiagnosticsKeys = new Set<string>();

  for (const line of lines) {
    const issuePrKey = readIssuePrKey(line);
    if (issuePrKey === null) {
      continue;
    }

    if (
      /^tracked_pr_mismatch\b/u.test(line) &&
      /\bgithub_state=ready_to_merge\b/u.test(line) &&
      /\bgithub_blocked_reason=none\b/u.test(line)
    ) {
      readyGitHubPrKeys.add(issuePrKey);
      continue;
    }

    if (
      /^stale_review_bot_terminal_stop\b/u.test(line) &&
      /\bclassification=verified_current_head_repair_pending_thread_resolution\b/u.test(line) &&
      /\bauto_repair_suppressed_reason=none\b/u.test(line) &&
      /\bnext_action=merge_ready\b/u.test(line)
    ) {
      readyGitHubPrKeys.add(issuePrKey);
      continue;
    }

    if (
      /^codex_connector_convergence\b/u.test(line) &&
      /\bmerge_effect=ready\b/u.test(line) &&
      /\bnext_action=merge_ready\b/u.test(line) &&
      /\bstale_review_metadata_classification=verified_current_head_repair_pending_thread_resolution\b/u.test(line)
    ) {
      mergeReadyConvergenceKeys.add(issuePrKey);
      continue;
    }

    if (
      /^stale_review_bot_thread_diagnostics\b/u.test(line) &&
      (/\bverified_stale_residue_threads=[1-9]\d*\b/u.test(line) ||
        (/\bunresolved_current_threads=0\b/u.test(line) &&
          /\bactionable_must_fix_threads=0\b/u.test(line))) &&
      /\bmissing_verification_evidence_threads=0\b/u.test(line) &&
      /\bauto_repair_suppressed_reason=none\b/u.test(line)
    ) {
      unsuppressedDiagnosticsKeys.add(issuePrKey);
    }
  }

  return new Set(
    [...readyGitHubPrKeys].filter(
      (issuePrKey) => mergeReadyConvergenceKeys.has(issuePrKey) && unsuppressedDiagnosticsKeys.has(issuePrKey),
    ),
  );
}

function hasVerifiedCurrentHeadRepairResidueMergeReadyKeyForLine(
  line: string,
  keys: ReadonlySet<string>,
): boolean {
  const issuePrKey = readIssuePrKey(line);
  if (issuePrKey !== null) {
    return keys.has(issuePrKey);
  }

  const issueNumber = readIssueNumberToken(line, "issue");
  if (issueNumber !== null) {
    return [...keys].some((key) => key.startsWith(`${issueNumber}:`));
  }

  return keys.size === 1;
}

export function parseOperatorActionLine(line: string): OperatorAction | null {
  if (!/^(operator_action|doctor_operator_action)\b/u.test(line)) {
    return null;
  }

  const action = readTokenValue(line, "action") as OperatorActionToken | null;
  const source = readTokenValue(line, "source");
  const priorityValue = readTokenValue(line, "priority");
  const summary = readSummaryValue(line);
  const priority = parseOperatorActionPriority(priorityValue);

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
    .filter((line) => /^operator_action\b/u.test(line))
    .map(parseOperatorActionLine)
    .filter((action): action is OperatorAction => action !== null);
  return actions.length === 0 ? null : chooseHighestPriority(actions, statusFallbackOperatorAction);
}

export function selectRestartRecommendation(args: {
  detailedStatusLines: string[];
  contextLines?: string[];
}): RestartRecommendation | null {
  const recommendations: RestartRecommendation[] = [];
  const contextLines = [...args.detailedStatusLines, ...(args.contextLines ?? [])];
  const requestEligibleRecoverySelectedIssues = selectedRequestEligibleRecoveryIssues(contextLines);
  const allowClusteredChurnManualReview = hasStoppedClusteredCodexChurnManualReviewGate(
    contextLines,
    requestEligibleRecoverySelectedIssues,
  );

  for (const line of args.detailedStatusLines) {
    const clusteredChurnManualReviewSummary = clusteredCodexChurnManualReviewSummary(line);
    if (clusteredChurnManualReviewSummary !== null && allowClusteredChurnManualReview) {
      recommendations.push({
        category: "manual_review_before_restart",
        source: "codex_connector_review_churn_progress",
        priority: 95,
        summary: clusteredChurnManualReviewSummary,
      });
      continue;
    }

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
      const issueNumber = readIssueNumberToken(line, "issue");
      if (
        issueNumber !== null &&
        requestEligibleRecoverySelectedIssues.has(issueNumber)
      ) {
        continue;
      }
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
  contextLines: string[] = [],
): string[] {
  if (detailedStatusLines.some((line) => line.startsWith(`${prefix} `))) {
    return detailedStatusLines;
  }

  const recommendationLine = renderRestartRecommendationLine(
    prefix,
    selectRestartRecommendation({ detailedStatusLines, contextLines }),
  );
  return recommendationLine === null ? detailedStatusLines : [...detailedStatusLines, recommendationLine];
}

export function selectStatusOperatorAction(args: {
  detailedStatusLines: string[];
  contextLines?: string[];
}): OperatorAction {
  const renderedAction = selectRenderedOperatorAction(args.detailedStatusLines);
  if (renderedAction !== null) {
    return renderedAction;
  }

  const actions: OperatorAction[] = [];
  const contextLines = [...args.detailedStatusLines, ...(args.contextLines ?? [])];
  const requestEligibleRecoverySelectedIssues = selectedRequestEligibleRecoveryIssues(contextLines);
  const allowClusteredChurnManualReview = hasStoppedClusteredCodexChurnManualReviewGate(
    contextLines,
    requestEligibleRecoverySelectedIssues,
  );
  const ignoreStaleManualReviewExecutionMetrics = hasUnblockedActiveIssueState(contextLines);
  const verifiedRepairResidueMergeReadyKeys = verifiedCurrentHeadRepairResidueMergeReadyDiagnosticKeys(contextLines);

  for (const line of args.detailedStatusLines) {
    const clusteredChurnManualReviewSummary = clusteredCodexChurnManualReviewSummary(line);
    if (clusteredChurnManualReviewSummary !== null && allowClusteredChurnManualReview) {
      actions.push({
        action: "manual_review",
        source: "codex_connector_review_churn_progress",
        priority: 95,
        summary: clusteredChurnManualReviewSummary,
      });
      continue;
    }

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

    if (
      /^codex_connector_review_fallback\b/.test(line) &&
      /\bstatus=request_eligible\b/.test(line) &&
      /\bnext_action=request_current_head_review\b/.test(line)
    ) {
      actions.push({
        action: "provider_outage_suspected",
        source: "codex_connector_review_fallback",
        priority: 70,
        summary:
          "A current-head Codex Connector review request is eligible; run the selected supervisor cycle to post or record it.",
      });
      continue;
    }

    if (
      /^codex_connector_review_fallback\b/.test(line) &&
      /\bstatus=timeout_elapsed\b/.test(line) &&
      /\btimeout_action=request_review_comment\b/.test(line) &&
      /\brequested_at=none\b/.test(line)
    ) {
      actions.push({
        action: "provider_outage_suspected",
        source: "codex_connector_review_fallback",
        priority: 70,
        summary:
          "The configured review provider has not reported on the current head after checks turned green; wait, verify provider delivery, or escalate to manual review.",
      });
      continue;
    }

    if (
      /^stale_review_bot_remediation\b/.test(line) &&
      /\bclassification=(?:actionable_current_diff|unknown_needs_operator)\b/.test(line)
    ) {
      actions.push({
        action: "manual_review",
        source: "stale_review_bot_remediation",
        priority: 73,
        summary:
          "A Codex Connector must-fix thread still lacks trusted current-head verification evidence; inspect the thread or run a focused verifier before resolving it.",
      });
      continue;
    }

    if (/^stale_review_bot_remediation\b/.test(line)) {
      if (
        verifiedRepairResidueMergeReadyKeys.has(readIssuePrKey(line) ?? "") &&
        /\bclassification=verified_current_head_repair_pending_thread_resolution\b/u.test(line)
      ) {
        continue;
      }
      actions.push({
        action: "resolve_stale_review_bot",
        source: "stale_review_bot_remediation",
        priority: 72,
        summary:
          "Code or CI is green but configured-bot review thread metadata is still unresolved; inspect the exact thread and resolve it or leave a manual note without changing merge policy.",
      });
      continue;
    }

    const isManualReviewExecutionMetrics =
      /^execution_metrics\b/.test(line) &&
      /\bterminal_state=blocked\b/.test(line) &&
      /\boutcome=blocked\b/.test(line) &&
      /\breason=manual_review\b/.test(line);
    if (
      /^blocked_partial_work\b/.test(line) ||
      /^tracked_pr_mismatch\b/.test(line) && /\blocal_blocked_reason=manual_review\b/.test(line) ||
      /^pre_merge_evaluation\b/.test(line) && /\bmanual_review=[1-9]\d*\b/.test(line) ||
      isManualReviewExecutionMetrics
    ) {
      if (isManualReviewExecutionMetrics && ignoreStaleManualReviewExecutionMetrics) {
        continue;
      }
      if (
        isManualReviewExecutionMetrics &&
        hasVerifiedCurrentHeadRepairResidueMergeReadyKeyForLine(line, verifiedRepairResidueMergeReadyKeys)
      ) {
        continue;
      }
      const issueNumber = readIssueNumberToken(line, "issue");
      if (
        issueNumber !== null &&
        requestEligibleRecoverySelectedIssues.has(issueNumber)
      ) {
        continue;
      }
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

function selectedRequestEligibleRecoveryIssues(lines: string[]): ReadonlySet<number> {
  const selectedIssues = new Set<number>();
  for (const line of lines) {
    const issueNumber = readIssueNumberToken(line, "selected_issue");
    if (issueNumber !== null) {
      selectedIssues.add(issueNumber);
    }
  }

  const hasRequestEligibleRecovery = lines.some((line) =>
    /^codex_connector_review_fallback\b/u.test(line) &&
    /\bstatus=request_eligible\b/u.test(line) &&
    /\bnext_action=request_current_head_review\b/u.test(line)
  );
  if (!hasRequestEligibleRecovery) {
    return new Set<number>();
  }
  if (selectedIssues.size > 0) {
    return selectedIssues;
  }

  const diagnosticIssueNumbers = new Set<number>();
  for (const line of lines) {
    if (
      /^no_active_tracked_record\b/u.test(line) ||
      /^tracked_pr_mismatch\b/u.test(line)
    ) {
      const issueNumber = readIssueNumberToken(line, "issue");
      if (issueNumber !== null) {
        diagnosticIssueNumbers.add(issueNumber);
      }
    }
    if (/^loop_runtime_blocker\b/u.test(line)) {
      const issueNumber = readIssueNumberToken(line, "first_issue");
      if (issueNumber !== null) {
        diagnosticIssueNumbers.add(issueNumber);
      }
    }
  }
  return diagnosticIssueNumbers;
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
  const action = selectStatusOperatorAction({
    detailedStatusLines: args.detailedStatusLines,
    contextLines: [...(args.readinessLines ?? []), ...(args.whyLines ?? [])],
  });
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
