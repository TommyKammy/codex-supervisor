import { truncate } from "./core/utils";
import type { TrustDiagnosticsSummary } from "./core/types";

export interface FormattedWarning {
  kind: string;
  message: string;
}

export function buildWarning(kind: string, message: string | null): FormattedWarning | null {
  return message === null ? null : { kind, message };
}

export function buildTrustWarning(
  trustDiagnostics: Pick<TrustDiagnosticsSummary, "warning">,
): FormattedWarning | null {
  return buildWarning("execution_safety", trustDiagnostics.warning);
}

export function buildTrustAndConfigWarnings(
  trustDiagnostics: Pick<TrustDiagnosticsSummary, "warning" | "configWarning">,
): FormattedWarning[] {
  return [
    buildTrustWarning(trustDiagnostics),
    buildWarning("config", trustDiagnostics.configWarning ?? null),
  ].filter((warning): warning is FormattedWarning => warning !== null);
}

export function renderDoctorWarningLine(
  warning: FormattedWarning,
  sanitize: (value: string) => string,
): string {
  return `doctor_warning kind=${warning.kind} detail=${sanitize(warning.message)}`;
}

export function renderStatusWarningLine(
  warning: FormattedWarning,
  sanitize: (value: string) => string,
  maxLength = 200,
): string {
  return `${warning.kind}_warning=${truncate(sanitize(warning.message), maxLength)}`;
}
