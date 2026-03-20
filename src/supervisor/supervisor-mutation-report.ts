import type { RunState } from "../core/types";

export type SupervisorRecoveryAction = "requeue";

export interface SupervisorMutationResultDto {
  action: SupervisorRecoveryAction;
  issueNumber: number;
  outcome: "mutated" | "rejected";
  summary: string;
  previousState: RunState | null;
  nextState: RunState | null;
  recoveryReason: string | null;
}

export function renderSupervisorMutationResultDto(dto: SupervisorMutationResultDto): string {
  return JSON.stringify(dto);
}
