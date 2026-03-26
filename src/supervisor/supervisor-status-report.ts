import type { CadenceDiagnosticsSummary, LocalCiContractSummary, TrustDiagnosticsSummary } from "../core/types";
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
import { formatInventoryRefreshStatusLine } from "../inventory-refresh-state";

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

export function renderSupervisorStatusDto(dto: SupervisorStatusDto): string {
  const localCiContract = dto.localCiContract ?? {
    configured: false,
    command: null,
    source: "config" as const,
    summary: "No repo-owned local CI contract is configured.",
  };
  const trustDiagnostics = dto.trustDiagnostics ?? {
    trustMode: "trusted_repo_and_authors",
    executionSafetyMode: "unsandboxed_autonomous",
    warning: "Unsandboxed autonomous execution assumes trusted GitHub-authored inputs.",
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
  const lines = [
    ...dto.detailedStatusLines,
    `trust_mode=${trustDiagnostics.trustMode}`,
    `execution_safety_mode=${trustDiagnostics.executionSafetyMode}`,
    ...(trustDiagnostics.warning === null
      ? []
      : [`execution_safety_warning=${truncate(sanitizeStatusValue(trustDiagnostics.warning), 200)}`]),
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
    ...(dto.warning === null
      ? []
      : [`${dto.warning.kind}_warning=${truncate(sanitizeStatusValue(dto.warning.message), 200)}`]),
  ];

  return [dto.gsdSummary, lines.join("\n")].filter(Boolean).join("\n");
}

export function buildInventoryRefreshWarningMessage(state: SupervisorStateFile): string | null {
  const line = formatInventoryRefreshStatusLine(state.inventory_refresh_failure);
  if (line === null) {
    return null;
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
