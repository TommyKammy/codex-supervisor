import { acquireFileLock } from "../core/lock";
import { StateStore } from "../core/state-store";
import type {
  JsonCorruptStateResetResult,
  JsonStateQuarantine,
  SupervisorConfig,
  SupervisorStateFile,
} from "../core/types";
import {
  pruneOrphanedWorkspacesForOperator,
  requeueIssueForOperator,
} from "../recovery-reconciliation";
import { syncRetainedExecutionMetricsDailyRollups } from "./execution-metrics-aggregation";
import type {
  SupervisorExecutionMetricsRollupResultDto,
  SupervisorMutationResultDto,
  SupervisorOrphanPruneResultDto,
  SupervisorRecoveryAction,
} from "./supervisor-mutation-report";

const CORRUPT_JSON_FAIL_CLOSED_PREFIX = "Blocked execution-changing command: corrupted JSON supervisor state detected";

export interface SupervisorMutationRuntime {
  runRecoveryAction(action: SupervisorRecoveryAction, issueNumber: number): Promise<SupervisorMutationResultDto>;
  pruneOrphanedWorkspaces(): Promise<SupervisorOrphanPruneResultDto>;
  rollupExecutionMetrics(): Promise<SupervisorExecutionMetricsRollupResultDto>;
  resetCorruptJsonState(): Promise<JsonCorruptStateResetResult>;
}

interface CreateSupervisorMutationRuntimeOptions {
  config: SupervisorConfig;
  stateStore: StateStore;
  lockPath: (kind: "issues" | "sessions" | "supervisor", key: string) => string;
}

export function readJsonParseErrorQuarantine(
  config: SupervisorConfig,
  state: SupervisorStateFile,
): JsonStateQuarantine | null {
  if (config.stateBackend !== "json") {
    return null;
  }

  const quarantine = state.json_state_quarantine;
  if (
    !quarantine ||
    quarantine.kind !== "parse_error" ||
    quarantine.marker_file !== config.stateFile ||
    typeof quarantine.quarantined_file !== "string" ||
    quarantine.quarantined_file.trim() === ""
  ) {
    return null;
  }

  const matchingFindings = (state.load_findings ?? []).filter((finding) =>
    finding.backend === "json" &&
    finding.kind === "parse_error" &&
    finding.scope === "state_file" &&
    finding.location === config.stateFile &&
    finding.issue_number === null
  );

  return matchingFindings.length > 0 ? quarantine : null;
}

export function buildCorruptJsonFailClosedMessage(
  config: SupervisorConfig,
  quarantine: JsonStateQuarantine,
): string {
  return [
    `${CORRUPT_JSON_FAIL_CLOSED_PREFIX} at ${config.stateFile}.`,
    `Quarantined payload: ${quarantine.quarantined_file}.`,
    "Run status, doctor, or reset-corrupt-json-state before retrying.",
  ].join(" ");
}

export function isCorruptJsonFailClosedMessage(message: string): boolean {
  return message.startsWith(CORRUPT_JSON_FAIL_CLOSED_PREFIX);
}

export function createSupervisorMutationRuntime(
  options: CreateSupervisorMutationRuntimeOptions,
): SupervisorMutationRuntime {
  const { config, stateStore, lockPath } = options;

  return {
    async runRecoveryAction(
      action: SupervisorRecoveryAction,
      issueNumber: number,
    ): Promise<SupervisorMutationResultDto> {
      if (action !== "requeue") {
        throw new Error(`Unsupported recovery action: ${String(action)}`);
      }

      const lock = await acquireFileLock(lockPath("supervisor", "run"), `supervisor-recovery-${action}`, {
        allowAmbiguousOwnerCleanup: true,
      });
      if (!lock.acquired) {
        throw new Error(`Cannot run recovery action while supervisor is active: ${lock.reason ?? "lock unavailable"}`);
      }

      try {
        const state = await stateStore.load();
        const quarantine = readJsonParseErrorQuarantine(config, state);
        if (quarantine) {
          return {
            action,
            issueNumber,
            outcome: "rejected",
            summary: buildCorruptJsonFailClosedMessage(config, quarantine),
            previousState: null,
            previousRecordSnapshot: null,
            nextState: null,
            recoveryReason: null,
          };
        }
        return requeueIssueForOperator(stateStore, state, issueNumber);
      } finally {
        await lock.release();
      }
    },

    async pruneOrphanedWorkspaces(): Promise<SupervisorOrphanPruneResultDto> {
      const lock = await acquireFileLock(
        lockPath("supervisor", "run"),
        "supervisor-recovery-prune-orphaned-workspaces",
        {
          allowAmbiguousOwnerCleanup: true,
        },
      );
      if (!lock.acquired) {
        throw new Error(`Cannot run recovery action while supervisor is active: ${lock.reason ?? "lock unavailable"}`);
      }

      try {
        const state = await stateStore.load();
        const quarantine = readJsonParseErrorQuarantine(config, state);
        if (quarantine) {
          return {
            action: "prune-orphaned-workspaces",
            outcome: "rejected",
            summary: buildCorruptJsonFailClosedMessage(config, quarantine),
            pruned: [],
            skipped: [],
          };
        }
        return pruneOrphanedWorkspacesForOperator(config, state);
      } finally {
        await lock.release();
      }
    },

    async rollupExecutionMetrics(): Promise<SupervisorExecutionMetricsRollupResultDto> {
      const lock = await acquireFileLock(
        lockPath("supervisor", "run"),
        "supervisor-recovery-rollup-execution-metrics",
        {
          allowAmbiguousOwnerCleanup: true,
        },
      );
      if (!lock.acquired) {
        throw new Error(`Cannot run recovery action while supervisor is active: ${lock.reason ?? "lock unavailable"}`);
      }

      try {
        const state = await stateStore.load();
        const quarantine = readJsonParseErrorQuarantine(config, state);
        if (quarantine) {
          return {
            action: "rollup-execution-metrics",
            outcome: "rejected",
            summary: buildCorruptJsonFailClosedMessage(config, quarantine),
            artifactPath: null,
            runSummaryCount: 0,
          };
        }
        const result = await syncRetainedExecutionMetricsDailyRollups({
          stateFilePath: config.stateFile,
        });
        return {
          action: "rollup-execution-metrics",
          outcome: "completed",
          summary:
            `Wrote daily execution metrics rollups from ${result.runSummaryCount} retained run summar` +
            `${result.runSummaryCount === 1 ? "y" : "ies"}.`,
          artifactPath: result.artifactPath,
          runSummaryCount: result.runSummaryCount,
        };
      } finally {
        await lock.release();
      }
    },

    async resetCorruptJsonState(): Promise<JsonCorruptStateResetResult> {
      const lock = await acquireFileLock(
        lockPath("supervisor", "run"),
        "supervisor-recovery-reset-corrupt-json-state",
        {
          allowAmbiguousOwnerCleanup: true,
        },
      );
      if (!lock.acquired) {
        throw new Error(`Cannot run recovery action while supervisor is active: ${lock.reason ?? "lock unavailable"}`);
      }

      try {
        return stateStore.resetCorruptJsonState();
      } finally {
        await lock.release();
      }
    },
  };
}
