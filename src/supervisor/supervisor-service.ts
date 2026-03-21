import type { CliOptions, JsonCorruptStateResetResult, SupervisorConfig } from "../core/types";
import type { DoctorDiagnostics } from "../doctor";
import type {
  SupervisorMutationResultDto,
  SupervisorOrphanPruneResultDto,
  SupervisorRecoveryAction,
} from "./supervisor-mutation-report";
import type { SupervisorIssueLintDto } from "./supervisor-selection-issue-lint";
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
  pollIntervalMs: () => Promise<number>;
  acquireSupervisorLock: (command: "loop" | "run-once") => Promise<SupervisorLock>;
  runOnce: (options: Pick<CliOptions, "dryRun">) => Promise<string>;
  queryStatus: (options: Pick<CliOptions, "why">) => Promise<SupervisorStatusDto>;
  runRecoveryAction: (action: SupervisorRecoveryAction, issueNumber: number) => Promise<SupervisorMutationResultDto>;
  pruneOrphanedWorkspaces: () => Promise<SupervisorOrphanPruneResultDto>;
  resetCorruptJsonState: () => Promise<JsonCorruptStateResetResult>;
  queryExplain: (issueNumber: number) => Promise<SupervisorExplainDto>;
  queryIssueLint: (issueNumber: number) => Promise<SupervisorIssueLintDto>;
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

  pollIntervalMs(): Promise<number> {
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

  pruneOrphanedWorkspaces(): Promise<SupervisorOrphanPruneResultDto> {
    return this.supervisor.pruneOrphanedWorkspaces();
  }

  resetCorruptJsonState(): Promise<JsonCorruptStateResetResult> {
    return this.supervisor.resetCorruptJsonState();
  }

  queryExplain(issueNumber: number): Promise<SupervisorExplainDto> {
    return this.supervisor.explainReport(issueNumber);
  }

  queryIssueLint(issueNumber: number): Promise<SupervisorIssueLintDto> {
    return this.supervisor.issueLint(issueNumber);
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
