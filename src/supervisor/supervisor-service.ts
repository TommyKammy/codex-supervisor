import type { CliOptions, SupervisorConfig } from "../core/types";
import type { DoctorDiagnostics } from "../doctor";
import type { SupervisorMutationResultDto, SupervisorRecoveryAction } from "./supervisor-mutation-report";
import type { SupervisorExplainDto } from "./supervisor-selection-status";
import type { SupervisorStatusDto } from "./supervisor-status-report";
import type { SupervisorEventSink } from "./supervisor-events";
import { Supervisor } from "./supervisor";

export interface SupervisorLock {
  acquired: boolean;
  reason?: string;
  release: () => Promise<void>;
}

export interface SupervisorService {
  config: SupervisorConfig;
  pollIntervalMs: () => number;
  acquireSupervisorLock: (command: "loop" | "run-once") => Promise<SupervisorLock>;
  runOnce: (options: Pick<CliOptions, "dryRun">) => Promise<string>;
  queryStatus: (options: Pick<CliOptions, "why">) => Promise<SupervisorStatusDto>;
  runRecoveryAction: (action: SupervisorRecoveryAction, issueNumber: number) => Promise<SupervisorMutationResultDto>;
  queryExplain: (issueNumber: number) => Promise<SupervisorExplainDto>;
  queryIssueLint: (issueNumber: number) => Promise<string[]>;
  queryDoctor: () => Promise<DoctorDiagnostics>;
}

export interface CreateSupervisorServiceOptions {
  onEvent?: SupervisorEventSink;
}

class SupervisorApplicationService implements SupervisorService {
  readonly config: SupervisorConfig;

  constructor(private readonly supervisor: Supervisor) {
    this.config = supervisor.config;
  }

  pollIntervalMs(): number {
    return this.supervisor.pollIntervalMs();
  }

  acquireSupervisorLock(command: "loop" | "run-once"): Promise<SupervisorLock> {
    return this.supervisor.acquireSupervisorLock(command);
  }

  runOnce(options: Pick<CliOptions, "dryRun">): Promise<string> {
    return this.supervisor.runOnce(options);
  }

  queryStatus(options: Pick<CliOptions, "why">): Promise<SupervisorStatusDto> {
    return this.supervisor.statusReport(options);
  }

  runRecoveryAction(action: SupervisorRecoveryAction, issueNumber: number): Promise<SupervisorMutationResultDto> {
    return this.supervisor.runRecoveryAction(action, issueNumber);
  }

  queryExplain(issueNumber: number): Promise<SupervisorExplainDto> {
    return this.supervisor.explainReport(issueNumber);
  }

  async queryIssueLint(issueNumber: number): Promise<string[]> {
    const summary = await this.supervisor.issueLint(issueNumber);
    return summary.split("\n");
  }

  queryDoctor(): Promise<DoctorDiagnostics> {
    return this.supervisor.doctorReport();
  }
}

export function createSupervisorService(
  configPath?: string,
  options: CreateSupervisorServiceOptions = {},
): SupervisorService {
  return new SupervisorApplicationService(Supervisor.fromConfig(configPath, options));
}
