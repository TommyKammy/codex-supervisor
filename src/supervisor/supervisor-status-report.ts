import type { CadenceDiagnosticsSummary, TrustDiagnosticsSummary } from "../core/types";
import { sanitizeStatusValue } from "./supervisor-status-rendering";
import { truncate } from "../core/utils";
import type { BlockedReason, RunState } from "../core/types";
import type { SupervisorSelectionSummaryDto } from "./supervisor-selection-readiness-summary";

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
}

export interface SupervisorStatusDto {
  gsdSummary: string | null;
  trustDiagnostics?: TrustDiagnosticsSummary | null;
  cadenceDiagnostics?: CadenceDiagnosticsSummary | null;
  candidateDiscoverySummary?: string | null;
  activeIssue: SupervisorActiveIssueDto | null;
  selectionSummary: SupervisorSelectionSummaryDto | null;
  detailedStatusLines: string[];
  reconciliationPhase: string | null;
  reconciliationWarning: string | null;
  readinessLines: string[];
  whyLines: string[];
  warning: SupervisorStatusWarningDto | null;
}

export function renderSupervisorStatusDto(dto: SupervisorStatusDto): string {
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
    ...(dto.reconciliationPhase === null ? [] : [`reconciliation_phase=${dto.reconciliationPhase}`]),
    ...(dto.reconciliationWarning === null ? [] : [dto.reconciliationWarning]),
    ...dto.readinessLines,
    ...dto.whyLines,
    ...(dto.warning === null
      ? []
      : [`${dto.warning.kind}_warning=${truncate(sanitizeStatusValue(dto.warning.message), 200)}`]),
  ];

  return [dto.gsdSummary, lines.join("\n")].filter(Boolean).join("\n");
}
