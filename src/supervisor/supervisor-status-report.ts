import type { TrustDiagnosticsSummary } from "../core/types";
import { sanitizeStatusValue } from "./supervisor-status-rendering";
import { truncate } from "../core/utils";

export interface SupervisorStatusWarningDto {
  kind: "readiness" | "status";
  message: string;
}

export interface SupervisorStatusDto {
  gsdSummary: string | null;
  trustDiagnostics?: TrustDiagnosticsSummary | null;
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
  const lines = [
    ...dto.detailedStatusLines,
    `trust_mode=${trustDiagnostics.trustMode}`,
    `execution_safety_mode=${trustDiagnostics.executionSafetyMode}`,
    ...(trustDiagnostics.warning === null
      ? []
      : [`execution_safety_warning=${truncate(sanitizeStatusValue(trustDiagnostics.warning), 200)}`]),
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
