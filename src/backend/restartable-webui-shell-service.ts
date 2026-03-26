import type { CliOptions } from "../core/types";
import type { DoctorDiagnostics } from "../doctor";
import type { ManagedRestartCapability, ManagedRestartCommandResultDto, ManagedRestartController } from "../managed-restart";
import type { SetupConfigPreview, SetupConfigPreviewSelectableReviewProviderProfile } from "../setup-config-preview";
import type { SetupConfigChanges, SetupConfigUpdateResult } from "../setup-config-write";
import type { SetupReadinessReport } from "../setup-readiness";
import type {
  SupervisorExecutionMetricsRollupResultDto,
  SupervisorMutationResultDto,
  SupervisorOrphanPruneResultDto,
  SupervisorRecoveryAction,
} from "../supervisor/supervisor-mutation-report";
import type { PostMergeAuditPatternSummaryDto } from "../supervisor/post-merge-audit-summary";
import type { SupervisorIssueLintDto } from "../supervisor/supervisor-selection-issue-lint";
import type { SupervisorExplainDto } from "../supervisor/supervisor-selection-status";
import type { SupervisorEventSink, SupervisorStatusDto } from "../supervisor";
import type { JsonCorruptStateResetResult } from "../core/types";
import type { SupervisorConfig } from "../core/types";
import type { SupervisorService, SupervisorEventUnsubscribe } from "../supervisor";

const RESTARTING_STATUS_MESSAGE = "The supervisor worker is restarting. The WebUI shell is still available and will reconnect automatically.";

class WebUiWorkerUnavailableError extends Error {
  constructor() {
    super(RESTARTING_STATUS_MESSAGE);
  }
}

interface RestartableWebUiShellCache {
  status: Map<boolean, SupervisorStatusDto>;
  doctor: DoctorDiagnostics | null;
  setupReadiness: SetupReadinessReport | null;
  setupConfigPreview: Map<SetupConfigPreviewSelectableReviewProviderProfile | null, SetupConfigPreview>;
}

type RestartableWebUiShellScalarCacheKey = "doctor" | "setupReadiness";
type CachedWorkerRead<K extends RestartableWebUiShellScalarCacheKey> = Exclude<RestartableWebUiShellCache[K], null>;

export interface RestartableWebUiShellService extends SupervisorService {
  readonly workerPhase: "open" | "restarting";
  restartWorker: () => Promise<void>;
}

export interface CreateRestartableWebUiShellServiceOptions {
  service: SupervisorService;
  recreateService: () => SupervisorService | Promise<SupervisorService>;
  capability: ManagedRestartCapability;
  writeStdout?: (line: string) => void;
}

export function createRestartableWebUiShellService(
  options: CreateRestartableWebUiShellServiceOptions,
): {
  service: RestartableWebUiShellService;
  managedRestart: ManagedRestartController;
} {
  let activeService = options.service;
  let activeUnsubscribe = subscribeToActiveService(activeService);
  let workerPhase: "open" | "restarting" = "open";
  let restartPromise: Promise<void> | null = null;
  const baseCapability = { ...options.capability };
  const managedRestartCapability: ManagedRestartCapability = { ...baseCapability };
  const eventListeners = new Set<SupervisorEventSink>();
  const cache: RestartableWebUiShellCache = {
    status: new Map(),
    doctor: null,
    setupReadiness: null,
    setupConfigPreview: new Map(),
  };

  function subscribeToActiveService(service: SupervisorService): SupervisorEventUnsubscribe {
    return service.subscribeEvents?.((event) => {
      for (const listener of eventListeners) {
        void Promise.resolve()
          .then(() => listener(event))
          .catch((error: unknown) => {
            console.error(`WebUI shell event subscriber failed for ${event.type}.`, error);
          });
      }
    }) ?? (() => {});
  }

  function markRestarting(): void {
    workerPhase = "restarting";
    managedRestartCapability.summary =
      `Managed restart is reconnecting the worker through the ${baseCapability.launcher ?? "configured"} launcher while this WebUI shell stays available.`;
  }

  function markOpen(): void {
    workerPhase = "open";
    managedRestartCapability.summary = baseCapability.summary;
  }

  async function restartWorker(): Promise<void> {
    if (restartPromise) {
      return restartPromise;
    }

    markRestarting();
    activeUnsubscribe();
    restartPromise = Promise.resolve()
      .then(() => options.recreateService())
      .then((nextService) => {
        activeService = nextService;
        activeUnsubscribe = subscribeToActiveService(activeService);
        markOpen();
      })
      .catch((error: unknown) => {
        activeUnsubscribe = subscribeToActiveService(activeService);
        markOpen();
        const message = error instanceof Error ? error.message : String(error);
        options.writeStdout?.(`${new Date().toISOString()} WebUI worker restart failed: ${message}`);
        throw error;
      })
      .finally(() => {
        restartPromise = null;
      });

    return restartPromise;
  }

  async function withWorkerReadCache<K extends RestartableWebUiShellScalarCacheKey>(
    cacheKey: K,
    load: (service: SupervisorService) => Promise<CachedWorkerRead<K>>,
  ): Promise<CachedWorkerRead<K>> {
    if (workerPhase === "restarting") {
      const cached = cache[cacheKey];
      if (cached !== null) {
        return cached as CachedWorkerRead<K>;
      }
      throw new WebUiWorkerUnavailableError();
    }

    const value = await load(activeService);
    cache[cacheKey] = value;
    return value;
  }

  async function withWorkerReadMapCache<K, V>(
    cachedValues: Map<K, V>,
    cacheKey: K,
    load: (service: SupervisorService) => Promise<V>,
  ): Promise<V> {
    if (workerPhase === "restarting") {
      const cached = cachedValues.get(cacheKey);
      if (cached !== undefined) {
        return cached;
      }
      throw new WebUiWorkerUnavailableError();
    }

    const value = await load(activeService);
    cachedValues.set(cacheKey, value);
    return value;
  }

  function rejectWhileRestarting(): never {
    throw new WebUiWorkerUnavailableError();
  }

  const service: RestartableWebUiShellService = {
    get config(): SupervisorConfig {
      return activeService.config;
    },
    get workerPhase(): "open" | "restarting" {
      return workerPhase;
    },
    pollIntervalMs: async () => activeService.pollIntervalMs(),
    runOnce: async (runOptions: Pick<CliOptions, "dryRun">) => {
      if (workerPhase === "restarting") {
        rejectWhileRestarting();
      }
      return activeService.runOnce(runOptions);
    },
    queryStatus: async (queryOptions: Pick<CliOptions, "why">) => {
      const status = await withWorkerReadMapCache(cache.status, queryOptions.why, (currentService) => currentService.queryStatus(queryOptions));
      if (workerPhase === "restarting") {
        return {
          ...status,
          warning: {
            kind: "status",
            message: RESTARTING_STATUS_MESSAGE,
          },
        };
      }
      return status;
    },
    runRecoveryAction: async (action: SupervisorRecoveryAction, issueNumber: number) => {
      if (workerPhase === "restarting") {
        rejectWhileRestarting();
      }
      return activeService.runRecoveryAction(action, issueNumber);
    },
    pruneOrphanedWorkspaces: async (): Promise<SupervisorOrphanPruneResultDto> => {
      if (workerPhase === "restarting") {
        rejectWhileRestarting();
      }
      return activeService.pruneOrphanedWorkspaces();
    },
    rollupExecutionMetrics: async (): Promise<SupervisorExecutionMetricsRollupResultDto> => {
      if (!activeService.rollupExecutionMetrics) {
        throw new Error("Missing supervisor execution metrics rollup support.");
      }
      if (workerPhase === "restarting") {
        rejectWhileRestarting();
      }
      return activeService.rollupExecutionMetrics();
    },
    queryPostMergeAuditSummary: async (): Promise<PostMergeAuditPatternSummaryDto> => {
      if (!activeService.queryPostMergeAuditSummary) {
        throw new Error("Missing post-merge audit summary support.");
      }
      if (workerPhase === "restarting") {
        rejectWhileRestarting();
      }
      return activeService.queryPostMergeAuditSummary();
    },
    resetCorruptJsonState: async (): Promise<JsonCorruptStateResetResult> => {
      if (workerPhase === "restarting") {
        rejectWhileRestarting();
      }
      return activeService.resetCorruptJsonState();
    },
    queryExplain: async (issueNumber: number): Promise<SupervisorExplainDto> => {
      if (workerPhase === "restarting") {
        rejectWhileRestarting();
      }
      return activeService.queryExplain(issueNumber);
    },
    queryIssueLint: async (issueNumber: number): Promise<SupervisorIssueLintDto> => {
      if (workerPhase === "restarting") {
        rejectWhileRestarting();
      }
      return activeService.queryIssueLint(issueNumber);
    },
    queryDoctor: async (): Promise<DoctorDiagnostics> => withWorkerReadCache("doctor", (currentService) => currentService.queryDoctor()),
    querySetupReadiness: activeService.querySetupReadiness
      ? async (): Promise<SetupReadinessReport> =>
        withWorkerReadCache("setupReadiness", (currentService) => {
          if (!currentService.querySetupReadiness) {
            throw new Error("Missing setup readiness support.");
          }
          return currentService.querySetupReadiness();
        })
      : undefined,
    querySetupConfigPreview: activeService.querySetupConfigPreview
      ? async (previewOptions: {
        reviewProviderProfile?: SetupConfigPreviewSelectableReviewProviderProfile;
      }): Promise<SetupConfigPreview> =>
        withWorkerReadMapCache(cache.setupConfigPreview, previewOptions.reviewProviderProfile ?? null, (currentService) => {
          if (!currentService.querySetupConfigPreview) {
            throw new Error("Missing setup config preview support.");
          }
          return currentService.querySetupConfigPreview(previewOptions);
        })
      : undefined,
    updateSetupConfig: activeService.updateSetupConfig
      ? async (updateOptions: { changes: SetupConfigChanges }): Promise<SetupConfigUpdateResult> => {
        if (workerPhase === "restarting") {
          rejectWhileRestarting();
        }
        if (!activeService.updateSetupConfig) {
          throw new Error("Missing setup config update support.");
        }
        return activeService.updateSetupConfig(updateOptions);
      }
      : undefined,
    subscribeEvents: (listener: SupervisorEventSink): SupervisorEventUnsubscribe => {
      eventListeners.add(listener);
      return () => {
        eventListeners.delete(listener);
      };
    },
    restartWorker,
  };

  const managedRestart: ManagedRestartController = {
    capability: managedRestartCapability,
    requestRestart: async (): Promise<ManagedRestartCommandResultDto> => {
      void restartWorker().catch(() => {});
      return {
        command: "managed-restart",
        accepted: true,
        summary:
          `Managed restart requested through the ${baseCapability.launcher ?? "configured"} launcher. The worker is reconnecting while this WebUI shell stays available.`,
      };
    },
  };

  return { service, managedRestart };
}
