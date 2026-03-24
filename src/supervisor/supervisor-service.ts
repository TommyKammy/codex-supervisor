import type { CliOptions, JsonCorruptStateResetResult, SupervisorConfig } from "../core/types";
import type { DoctorDiagnostics } from "../doctor";
import type { SetupConfigPreview, SetupConfigPreviewSelectableReviewProviderProfile } from "../setup-config-preview";
import type { SetupConfigChanges, SetupConfigUpdateResult } from "../setup-config-write";
import type { SetupReadinessReport } from "../setup-readiness";
import type {
  SupervisorExecutionMetricsRollupResultDto,
  SupervisorMutationResultDto,
  SupervisorOrphanPruneResultDto,
  SupervisorRecoveryAction,
} from "./supervisor-mutation-report";
import type { PostMergeAuditPatternSummaryDto } from "./post-merge-audit-summary";
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
  rollupExecutionMetrics?: () => Promise<SupervisorExecutionMetricsRollupResultDto>;
  queryPostMergeAuditSummary?: () => Promise<PostMergeAuditPatternSummaryDto>;
  resetCorruptJsonState: () => Promise<JsonCorruptStateResetResult>;
  queryExplain: (issueNumber: number) => Promise<SupervisorExplainDto>;
  queryIssueLint: (issueNumber: number) => Promise<SupervisorIssueLintDto>;
  queryDoctor: () => Promise<DoctorDiagnostics>;
  querySetupReadiness?: () => Promise<SetupReadinessReport>;
  querySetupConfigPreview?: (options: { reviewProviderProfile?: SetupConfigPreviewSelectableReviewProviderProfile }) => Promise<SetupConfigPreview>;
  updateSetupConfig?: (options: { changes: SetupConfigChanges }) => Promise<SetupConfigUpdateResult>;
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

  rollupExecutionMetrics(): Promise<SupervisorExecutionMetricsRollupResultDto> {
    return this.supervisor.rollupExecutionMetrics();
  }

  queryPostMergeAuditSummary(): Promise<PostMergeAuditPatternSummaryDto> {
    return this.supervisor.postMergeAuditSummaryReport();
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

  querySetupConfigPreview(options: {
    reviewProviderProfile?: SetupConfigPreviewSelectableReviewProviderProfile;
  }): Promise<SetupConfigPreview> {
    return this.supervisor.setupConfigPreview(options);
  }

  updateSetupConfig(options: { changes: SetupConfigChanges }): Promise<SetupConfigUpdateResult> {
    return this.supervisor.updateSetupConfig(options);
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
