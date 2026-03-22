import type { CliOptions, JsonCorruptStateResetResult, SupervisorConfig } from "../core/types";
import type { DoctorDiagnostics } from "../doctor";
import type { SetupReadinessReport } from "../setup-readiness";
import type {
  SupervisorMutationResultDto,
  SupervisorOrphanPruneResultDto,
  SupervisorRecoveryAction,
} from "./supervisor-mutation-report";
import type { SupervisorIssueLintDto } from "./supervisor-selection-issue-lint";
import type { SupervisorExplainDto } from "./supervisor-selection-status";
import type { SupervisorStatusDto } from "./supervisor-status-report";
import type { SupervisorEvent, SupervisorEventSink } from "./supervisor-events";
import { Supervisor } from "./supervisor";

export type SupervisorEventUnsubscribe = () => void;

export interface SupervisorService {
  config: SupervisorConfig;
  pollIntervalMs: () => Promise<number>;
  runOnce: (options: Pick<CliOptions, "dryRun">) => Promise<string>;
  queryStatus: (options: Pick<CliOptions, "why">) => Promise<SupervisorStatusDto>;
  runRecoveryAction: (action: SupervisorRecoveryAction, issueNumber: number) => Promise<SupervisorMutationResultDto>;
  pruneOrphanedWorkspaces: () => Promise<SupervisorOrphanPruneResultDto>;
  resetCorruptJsonState: () => Promise<JsonCorruptStateResetResult>;
  queryExplain: (issueNumber: number) => Promise<SupervisorExplainDto>;
  queryIssueLint: (issueNumber: number) => Promise<SupervisorIssueLintDto>;
  queryDoctor: () => Promise<DoctorDiagnostics>;
  querySetupReadiness?: () => Promise<SetupReadinessReport>;
  subscribeEvents?: (listener: SupervisorEventSink) => SupervisorEventUnsubscribe;
}

export interface CreateSupervisorServiceOptions {
  onEvent?: SupervisorEventSink;
}

class SupervisorEventSubscriberRegistry {
  private readonly listeners = new Set<SupervisorEventSink>();

  emit(event: SupervisorEvent): void {
    for (const listener of this.listeners) {
      void Promise.resolve()
        .then(() => listener(event))
        .catch((error: unknown) => {
          console.error(`Supervisor event subscriber failed for ${event.type}.`, error);
        });
    }
  }

  subscribe(listener: SupervisorEventSink): SupervisorEventUnsubscribe {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
}

class SupervisorApplicationService implements SupervisorService {
  readonly config: SupervisorConfig;

  constructor(
    private readonly supervisor: Supervisor,
    private readonly subscribeToEvents: (listener: SupervisorEventSink) => SupervisorEventUnsubscribe = () => () => {},
  ) {
    this.config = supervisor.config;
  }

  pollIntervalMs(): Promise<number> {
    return this.supervisor.pollIntervalMs();
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

  querySetupReadiness(): Promise<SetupReadinessReport> {
    return this.supervisor.setupReadinessReport();
  }

  subscribeEvents(listener: SupervisorEventSink): SupervisorEventUnsubscribe {
    return this.subscribeToEvents(listener);
  }
}

export function createSupervisorServiceFromSupervisor(
  supervisor: Supervisor,
  options: { subscribeEvents?: (listener: SupervisorEventSink) => SupervisorEventUnsubscribe } = {},
): SupervisorService {
  return new SupervisorApplicationService(supervisor, options.subscribeEvents);
}

export function createSupervisorService(
  configPath?: string,
  options: CreateSupervisorServiceOptions = {},
): SupervisorService {
  const subscriberRegistry = new SupervisorEventSubscriberRegistry();
  const emitEvent: SupervisorEventSink = (event) => {
    subscriberRegistry.emit(event);
    options.onEvent?.(event);
  };

  return createSupervisorServiceFromSupervisor(
    Supervisor.fromConfig(configPath, {
      ...options,
      onEvent: emitEvent,
    }),
    { subscribeEvents: (listener) => subscriberRegistry.subscribe(listener) },
  );
}
