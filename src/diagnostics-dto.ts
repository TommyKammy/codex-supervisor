export type SharedDiagnosticStatus = "pass" | "warn" | "fail";

export type SharedSupervisorDiagnosticCheckName =
  | "github_auth"
  | "codex_cli"
  | "state_file"
  | "worktrees";

export interface SharedDiagnosticCheckDto<Name extends string = string> {
  name: Name;
  status: SharedDiagnosticStatus;
  summary: string;
  details: string[];
}

export interface SharedDiagnosticHostSummaryDto<
  Name extends string = SharedSupervisorDiagnosticCheckName,
> {
  overallStatus: SharedDiagnosticStatus | "not_ready";
  checks: Array<SharedDiagnosticCheckDto<Name>>;
}
