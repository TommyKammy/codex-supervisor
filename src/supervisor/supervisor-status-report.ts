import { sanitizeStatusValue } from "./supervisor-status-rendering";
import { truncate } from "../core/utils";

export interface SupervisorStatusWarningDto {
  kind: "readiness" | "status";
  message: string;
}

export interface SupervisorStatusDto {
  gsdSummary: string | null;
  detailedStatusLines: string[];
  reconciliationPhase: string | null;
  reconciliationWarning: string | null;
  readinessLines: string[];
  whyLines: string[];
  warning: SupervisorStatusWarningDto | null;
}

export function renderSupervisorStatusDto(dto: SupervisorStatusDto): string {
  const lines = [
    ...dto.detailedStatusLines,
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
