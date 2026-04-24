import type {
  CadenceDiagnosticsSummary,
  GitHubRateLimitBudget,
  GitHubRateLimitTelemetry,
  LocalCiContractSummary,
  TrustDiagnosticsSummary,
} from "../core/types";
import { sanitizeStatusValue } from "./supervisor-status-rendering";
import { truncate } from "../core/utils";
import type { BlockedReason, RunState, SupervisorStateFile } from "../core/types";
import type { SupervisorIssueActivityContextDto } from "./supervisor-operator-activity-context";
import type { SupervisorLoopRuntimeDto } from "./supervisor-loop-runtime-state";
import type {
  SupervisorBlockedIssueDto,
  SupervisorCandidateDiscoveryDto,
  SupervisorRunnableIssueDto,
  SupervisorSelectionSummaryDto,
} from "./supervisor-selection-readiness-summary";
import {
  type InventoryOperatorStatus,
  formatInventoryRefreshStatusLine,
  formatLastSuccessfulInventorySnapshotStatusLine,
} from "../inventory-refresh-state";
import { buildTrustAndConfigWarnings, buildWarning, renderStatusWarningLine } from "../warning-formatting";

export interface SupervisorStatusWarningDto {
  kind: "readiness" | "status";
  message: string;
}

export interface SupervisorActiveIssueDto {
  issueNumber: number;
  state: RunState;
  branch: string;
  prNumber: number | null;
  blockedReason: BlockedReason | null;
  activityContext: SupervisorIssueActivityContextDto | null;
}

export interface SupervisorTrackedIssueDto {
  issueNumber: number;
  state: RunState;
  branch: string;
  prNumber: number | null;
  blockedReason: BlockedReason | null;
}

export interface SupervisorReconciliationProgressDto {
  phase: string;
  startedAt: string | null;
  targetIssueNumber: number | null;
  targetPrNumber: number | null;
  waitStep: string | null;
}

export interface SupervisorStatusDto {
  gsdSummary: string | null;
  trustDiagnostics?: TrustDiagnosticsSummary | null;
  cadenceDiagnostics?: CadenceDiagnosticsSummary | null;
  githubRateLimit?: GitHubRateLimitTelemetry | null;
  inventoryStatus?: InventoryOperatorStatus;
  candidateDiscoverySummary?: string | null;
  candidateDiscovery: SupervisorCandidateDiscoveryDto | null;
  localCiContract?: LocalCiContractSummary;
  loopRuntime: SupervisorLoopRuntimeDto;
  activeIssue: SupervisorActiveIssueDto | null;
  selectionSummary: SupervisorSelectionSummaryDto | null;
  trackedIssues: SupervisorTrackedIssueDto[];
  runnableIssues: SupervisorRunnableIssueDto[];
  blockedIssues: SupervisorBlockedIssueDto[];
  detailedStatusLines: string[];
  reconciliationPhase: string | null;
  reconciliationProgress?: SupervisorReconciliationProgressDto | null;
  reconciliationWarning: string | null;
  readinessLines: string[];
  whyLines: string[];
  warning: SupervisorStatusWarningDto | null;
}

export function renderGitHubRateLimitLine(resource: "rest" | "graphql", budget: GitHubRateLimitBudget): string {
  return `github_rate_limit resource=${resource} status=${budget.state} remaining=${budget.remaining} limit=${budget.limit} reset_at=${budget.resetAt}`;
}

export function renderLoopRuntimeLine(loopRuntime: SupervisorLoopRuntimeDto): string {
  const markerPath = "markerPath" in loopRuntime ? loopRuntime.markerPath : "none";
  const configPath = "configPath" in loopRuntime ? loopRuntime.configPath : null;
  const stateFile = "stateFile" in loopRuntime ? loopRuntime.stateFile : "none";
  const ownershipConfidence = "ownershipConfidence" in loopRuntime ? loopRuntime.ownershipConfidence : "none";
  return [
    "loop_runtime",
    `state=${loopRuntime.state}`,
    `host_mode=${sanitizeStatusValue(loopRuntime.hostMode)}`,
    `marker_path=${sanitizeStatusValue(markerPath)}`,
    `config_path=${sanitizeStatusValue(configPath ?? "none")}`,
    `state_file=${sanitizeStatusValue(stateFile)}`,
    `pid=${loopRuntime.pid === null ? "none" : String(loopRuntime.pid)}`,
    `started_at=${sanitizeStatusValue(loopRuntime.startedAt ?? "none")}`,
    `ownership_confidence=${ownershipConfidence}`,
    `detail=${sanitizeStatusValue(loopRuntime.detail ?? "none")}`,
  ].join(" ");
}

function renderDuplicateLoopDiagnosticLine(loopRuntime: SupervisorLoopRuntimeDto): string | null {
  const diagnostic = loopRuntime.duplicateLoopDiagnostic;
  if (!diagnostic) {
    return null;
  }

  return [
    "loop_runtime_diagnostic",
    `kind=${diagnostic.kind}`,
    `status=${diagnostic.status}`,
    `matching_processes=${diagnostic.matchingProcessCount}`,
    `pids=${diagnostic.matchingPids.join(",")}`,
    `config_path=${sanitizeStatusValue(diagnostic.configPath)}`,
    `state_file=${sanitizeStatusValue(diagnostic.stateFile)}`,
    `recovery=${sanitizeStatusValue(diagnostic.recoveryGuidance ?? loopRuntime.recoveryGuidance ?? "none")}`,
  ].join(" ");
}

function renderLoopRuntimeRecoveryLine(loopRuntime: SupervisorLoopRuntimeDto): string | null {
  if (!loopRuntime.recoveryGuidance) {
    return null;
  }

  return `loop_runtime_recovery guidance=${sanitizeStatusValue(loopRuntime.recoveryGuidance)}`;
}

export function renderSupervisorStatusDto(dto: SupervisorStatusDto): string {
  const localCiContract = dto.localCiContract ?? {
    configured: false,
    command: null,
    recommendedCommand: null,
    source: "config" as const,
    summary: "No repo-owned local CI contract is configured.",
  };
  const trustDiagnostics = dto.trustDiagnostics ?? {
    trustMode: "trusted_repo_and_authors",
    executionSafetyMode: "unsandboxed_autonomous",
    warning: "Unsandboxed autonomous execution assumes trusted GitHub-authored inputs.",
    configWarning: null,
  };
  const cadenceDiagnostics = dto.cadenceDiagnostics ?? {
    pollIntervalSeconds: 120,
    mergeCriticalRecheckSeconds: null,
    mergeCriticalEffectiveSeconds: 120,
    mergeCriticalRecheckEnabled: false,
  };
  const mergeCriticalRecheckSeconds =
    cadenceDiagnostics.mergeCriticalRecheckSeconds === null
      ? "disabled"
      : String(cadenceDiagnostics.mergeCriticalRecheckSeconds);
  const githubRateLimitLines =
    dto.githubRateLimit === undefined || dto.githubRateLimit === null
      ? []
      : [
        renderGitHubRateLimitLine("rest", dto.githubRateLimit.rest),
        renderGitHubRateLimitLine("graphql", dto.githubRateLimit.graphql),
      ].filter((line) => !dto.detailedStatusLines.includes(line));
  const trustWarnings = buildTrustAndConfigWarnings(trustDiagnostics);
  const statusWarning = dto.warning === null ? null : buildWarning(dto.warning.kind, dto.warning.message);
  const duplicateLoopDiagnosticLine = renderDuplicateLoopDiagnosticLine(dto.loopRuntime);
  const loopRuntimeRecoveryLine = renderLoopRuntimeRecoveryLine(dto.loopRuntime);
  const lines = [
    ...dto.detailedStatusLines,
    ...githubRateLimitLines,
    renderLoopRuntimeLine(dto.loopRuntime),
    ...(duplicateLoopDiagnosticLine ? [duplicateLoopDiagnosticLine] : []),
    ...(loopRuntimeRecoveryLine ? [loopRuntimeRecoveryLine] : []),
    `trust_mode=${trustDiagnostics.trustMode}`,
    `execution_safety_mode=${trustDiagnostics.executionSafetyMode}`,
    ...trustWarnings.map((warning) => renderStatusWarningLine(warning, sanitizeStatusValue)),
    `merge_critical_recheck_seconds=${mergeCriticalRecheckSeconds} merge_critical_effective_seconds=${cadenceDiagnostics.mergeCriticalEffectiveSeconds} merge_critical_recheck_enabled=${cadenceDiagnostics.mergeCriticalRecheckEnabled}`,
    ...(dto.candidateDiscoverySummary ? [dto.candidateDiscoverySummary] : []),
    `local_ci configured=${localCiContract.configured} source=${localCiContract.source} command=${truncate(sanitizeStatusValue(localCiContract.command ?? "none"), 200)} summary=${truncate(sanitizeStatusValue(localCiContract.summary), 200)}`,
    ...(dto.reconciliationPhase === null ? [] : [`reconciliation_phase=${dto.reconciliationPhase}`]),
    ...(dto.reconciliationProgress === null || dto.reconciliationProgress === undefined
      ? []
      : [
        [
          "reconciliation_progress",
          `phase=${dto.reconciliationProgress.phase}`,
          `target_issue=${dto.reconciliationProgress.targetIssueNumber === null ? "none" : `#${dto.reconciliationProgress.targetIssueNumber}`}`,
          `target_pr=${dto.reconciliationProgress.targetPrNumber === null ? "none" : `#${dto.reconciliationProgress.targetPrNumber}`}`,
          `wait_step=${dto.reconciliationProgress.waitStep ?? "none"}`,
          `started_at=${dto.reconciliationProgress.startedAt ?? "none"}`,
        ].join(" "),
      ]),
    ...(dto.reconciliationWarning === null ? [] : [dto.reconciliationWarning]),
    ...dto.readinessLines,
    ...dto.whyLines,
    ...(statusWarning === null ? [] : [renderStatusWarningLine(statusWarning, sanitizeStatusValue)]),
  ];

  return [dto.gsdSummary, lines.join("\n")].filter(Boolean).join("\n");
}

export function buildInventoryRefreshWarningMessage(state: SupervisorStateFile): string | null {
  const line = formatInventoryRefreshStatusLine(state.inventory_refresh_failure);
  if (line === null) {
    return null;
  }

  const snapshotLine = formatLastSuccessfulInventorySnapshotStatusLine(state.last_successful_inventory_snapshot);
  if (snapshotLine) {
    if (state.inventory_refresh_failure?.selection_permitted === "snapshot_backed") {
      return `Full inventory refresh is degraded. Bounded snapshot-backed selection can continue temporarily. ${line} ${snapshotLine}`;
    }

    return `Full inventory refresh is degraded. Using the last-known-good snapshot for diagnostics only. ${line} ${snapshotLine}`;
  }

  return `Full inventory refresh is degraded. ${line}`;
}

export function buildTrackedIssueDtos(state: SupervisorStateFile): SupervisorTrackedIssueDto[] {
  return Object.values(state.issues)
    .sort((left, right) => left.issue_number - right.issue_number)
    .map((record) => ({
      issueNumber: record.issue_number,
      state: record.state,
      branch: record.branch,
      prNumber: record.pr_number,
      blockedReason: record.blocked_reason,
    }));
}
