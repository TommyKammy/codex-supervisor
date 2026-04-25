import { GitHubIssue, SupervisorStateFile } from "./core/types";
import {
  buildLastSuccessfulInventorySnapshot,
  buildInventoryRefreshFailure,
  canContinueBoundedAfterInventoryRefreshFailure,
  canProceedWithDegradedContinuationAfterInventoryRefreshFailure,
  canUseSnapshotBackedSelectionAfterInventoryRefreshFailure,
  inventoryRefreshFailureEquals,
} from "./inventory-refresh-state";
import {
  buildRecoverySupervisorEvent,
  emitSupervisorEvent,
  type SupervisorEventSink,
} from "./supervisor/supervisor-events";
import type { ReconciliationProgressUpdate } from "./supervisor/supervisor-reconciliation-phase";
import {
  normalizeRecoveryEntrypointResult,
  type RecoveryEntrypointResult,
} from "./recovery-entrypoint-result";

export interface RecoveryEvent {
  issueNumber: number;
  reason: string;
  at: string;
}

export interface RunOnceCyclePreludeResult {
  state: SupervisorStateFile;
  recoveryEvents: RecoveryEvent[];
  recoveryResults: RecoveryEntrypointResult[];
}

export interface RunOnceCyclePreludeAuthFailure {
  kind: "auth_failure";
  message: string;
  recoveryEvents: RecoveryEvent[];
  recoveryResults: RecoveryEntrypointResult[];
}

type ReconciliationProgressPatch = Partial<Omit<ReconciliationProgressUpdate, "phase">>;

interface RunOnceCyclePreludeArgs {
  stateStore: Pick<{ load(): Promise<SupervisorStateFile>; save(state: SupervisorStateFile): Promise<void> }, "load" | "save">;
  carryoverRecoveryEvents: RecoveryEvent[];
  emitEvent?: SupervisorEventSink;
  setReconciliationPhase?: (phase: string | null) => Promise<void>;
  setReconciliationProgress?: (progress: ReconciliationProgressUpdate | null) => Promise<void>;
  shouldReconcileTrackedBlockedRecordDuringDegradedContinuation?: (
    record: SupervisorStateFile["issues"][string],
  ) => boolean;
  reconcileStaleActiveIssueReservation: (state: SupervisorStateFile) => Promise<RecoveryEvent[]>;
  reserveRunnableIssueSelection?: (state: SupervisorStateFile) => Promise<boolean>;
  handleAuthFailure: (state: SupervisorStateFile) => Promise<string | null>;
  listAllIssues: () => Promise<GitHubIssue[]>;
  getIssueForParentEpicClosureFallback?: (issueNumber: number) => Promise<GitHubIssue>;
  reconcileTrackedMergedButOpenIssues: (
    state: SupervisorStateFile,
    issues: GitHubIssue[],
    updateReconciliationProgress: (patch: ReconciliationProgressPatch) => Promise<void>,
    options?: { onlyIssueNumber?: number | null },
  ) => Promise<RecoveryEvent[]>;
  reconcileMergedIssueClosures: (
    state: SupervisorStateFile,
    issues: GitHubIssue[],
    updateReconciliationProgress: (patch: ReconciliationProgressPatch) => Promise<void>,
  ) => Promise<RecoveryEvent[]>;
  reconcileStaleFailedIssueStates: (
    state: SupervisorStateFile,
    issues: GitHubIssue[],
    updateReconciliationProgress: (patch: ReconciliationProgressPatch) => Promise<void>,
  ) => Promise<RecoveryEvent[]>;
  reconcileStaleDoneIssueStates?: (
    state: SupervisorStateFile,
    issues: GitHubIssue[],
  ) => Promise<RecoveryEvent[]>;
  reconcileRecoverableBlockedIssueStates: (
    state: SupervisorStateFile,
    issues: GitHubIssue[],
    options?: { onlyTrackedPrStates?: boolean },
  ) => Promise<RecoveryEvent[]>;
  reconcileParentEpicClosures: (
    state: SupervisorStateFile,
    issues: GitHubIssue[],
  ) => Promise<RecoveryEvent[]>;
  cleanupExpiredDoneWorkspaces: (state: SupervisorStateFile) => Promise<RecoveryEvent[]>;
}

function hasNonTrackedRecoverableBlockedStates(state: SupervisorStateFile): boolean {
  return Object.values(state.issues).some((record) => record.state === "blocked" && record.pr_number === null);
}

export async function runOnceCyclePrelude(
  args: RunOnceCyclePreludeArgs,
): Promise<RunOnceCyclePreludeResult | RunOnceCyclePreludeAuthFailure> {
  const state = await args.stateStore.load();
  const recoveryEvents: RecoveryEvent[] = [...args.carryoverRecoveryEvents];
  const recoveryResults: RecoveryEntrypointResult[] = args.carryoverRecoveryEvents.map((event) =>
    normalizeRecoveryEntrypointResult([event])
  );
  let currentReconciliationProgress: ReconciliationProgressUpdate | null = null;
  const setReconciliationProgress = async (progress: ReconciliationProgressUpdate | null) => {
    currentReconciliationProgress = progress;
    if (args.setReconciliationProgress) {
      await args.setReconciliationProgress(progress);
      return;
    }
    await (args.setReconciliationPhase ?? (async () => {}))(progress?.phase ?? null);
  };
  const setReconciliationPhase = async (phase: string) => {
    await setReconciliationProgress({
      phase,
      targetIssueNumber: null,
      targetPrNumber: null,
      waitStep: null,
    });
  };
  const updateReconciliationProgress = async (patch: ReconciliationProgressPatch) => {
    if (currentReconciliationProgress === null) {
      return;
    }
    await setReconciliationProgress({
      ...currentReconciliationProgress,
      ...patch,
    });
  };
  const collectRecoveryEvents = (events: RecoveryEvent[]) => {
    recoveryEvents.push(...events);
    recoveryResults.push(normalizeRecoveryEntrypointResult(events));
    for (const event of events) {
      emitSupervisorEvent(args.emitEvent, buildRecoverySupervisorEvent(event));
    }
  };
  const persistInventoryRefreshState = async (refreshState: {
    nextFailure: SupervisorStateFile["inventory_refresh_failure"] | null;
    successfulIssues?: GitHubIssue[] | null;
  }) => {
    const { nextFailure, successfulIssues = null } = refreshState;
    const currentFailure = state.inventory_refresh_failure;
    const currentSnapshot = state.last_successful_inventory_snapshot;
    const nextSnapshot = successfulIssues ? buildLastSuccessfulInventorySnapshot(successfulIssues) : currentSnapshot;
    const snapshotUnchanged = successfulIssues === null || JSON.stringify(currentSnapshot) === JSON.stringify(nextSnapshot);

    if (inventoryRefreshFailureEquals(currentFailure, nextFailure) && snapshotUnchanged) {
      return;
    }

    if (nextFailure) {
      state.inventory_refresh_failure = nextFailure;
    } else {
      delete state.inventory_refresh_failure;
    }

    if (nextSnapshot) {
      state.last_successful_inventory_snapshot = nextSnapshot;
    }

    await args.stateStore.save(state);
  };

  const authFailure = await args.handleAuthFailure(state);
  if (authFailure) {
    return {
      kind: "auth_failure",
      message: authFailure,
      recoveryEvents,
      recoveryResults,
    };
  }

  try {
    await setReconciliationPhase("stale_active_issue_reservation");
    const staleReservationEvents = await args.reconcileStaleActiveIssueReservation(state);
    collectRecoveryEvents(staleReservationEvents);

    const activeRecord =
      state.activeIssueNumber === null ? null : state.issues[String(state.activeIssueNumber)] ?? null;
    let issues: GitHubIssue[] | null = null;
    try {
      issues = await args.listAllIssues();
      await persistInventoryRefreshState({
        nextFailure: null,
        successfulIssues: issues,
      });
    } catch (error) {
      const previousFailure = state.inventory_refresh_failure;
      const nextFailure = buildInventoryRefreshFailure(error);
      const snapshotBackedSelectionPermitted = canUseSnapshotBackedSelectionAfterInventoryRefreshFailure({
        failure: nextFailure,
        snapshot: state.last_successful_inventory_snapshot,
        previousFailure,
      });
      if (snapshotBackedSelectionPermitted) {
        nextFailure.bounded_continuation_allowed = true;
        nextFailure.selection_permitted = "snapshot_backed";
      }
      await persistInventoryRefreshState({
        nextFailure,
      });
      const allowBoundedContinuation = canContinueBoundedAfterInventoryRefreshFailure({
        failure: nextFailure,
        snapshot: state.last_successful_inventory_snapshot,
      });
      const allowDegradedContinuation = canProceedWithDegradedContinuationAfterInventoryRefreshFailure({
        failure: nextFailure,
        snapshot: state.last_successful_inventory_snapshot,
      });
      if (allowDegradedContinuation && activeRecord !== null && activeRecord.pr_number !== null) {
        await setReconciliationPhase("tracked_merged_but_open_issues");
        const activeMergedEvents = await args.reconcileTrackedMergedButOpenIssues(
          state,
          [],
          updateReconciliationProgress,
          { onlyIssueNumber: activeRecord.issue_number },
        );
        collectRecoveryEvents(activeMergedEvents);
      }

      const hasFailedRecords = Object.values(state.issues).some((record) => record.state === "failed");
      if (allowDegradedContinuation && hasFailedRecords) {
        await setReconciliationPhase("stale_failed_issue_states");
        const staleFailedEvents = await args.reconcileStaleFailedIssueStates(state, [], updateReconciliationProgress);
        collectRecoveryEvents(staleFailedEvents);
      }

      const hasBlockedTrackedPrRecords = Object.values(state.issues).some((record) =>
        record.state === "blocked" &&
        record.pr_number !== null &&
        (
          record.blocked_reason === null ||
          record.blocked_reason === "manual_review" ||
          record.blocked_reason === "verification" ||
          args.shouldReconcileTrackedBlockedRecordDuringDegradedContinuation?.(record) === true
        ),
      );
      if (allowDegradedContinuation && hasBlockedTrackedPrRecords) {
        await setReconciliationPhase("recoverable_blocked_issue_states");
        const recoverableBlockedEvents = await args.reconcileRecoverableBlockedIssueStates(state, [], {
          onlyTrackedPrStates: true,
        });
        collectRecoveryEvents(recoverableBlockedEvents);
      }

      if (
        state.activeIssueNumber === null
        && allowBoundedContinuation
        && await args.reserveRunnableIssueSelection?.(state) === true
      ) {
        return {
          state,
          recoveryEvents,
          recoveryResults,
        };
      }

      return {
        state,
        recoveryEvents,
        recoveryResults,
      };
    }

    await setReconciliationPhase("tracked_merged_but_open_issues");
    if (activeRecord !== null && activeRecord.pr_number !== null) {
      const activeMergedEvents = await args.reconcileTrackedMergedButOpenIssues(
        state,
        issues,
        updateReconciliationProgress,
        { onlyIssueNumber: activeRecord.issue_number },
      );
      collectRecoveryEvents(activeMergedEvents);

      const activeRecordAfterFastPath = state.issues[String(activeRecord.issue_number)] ?? null;
      if (activeRecordAfterFastPath?.state === "done") {
        return {
          state,
          recoveryEvents,
          recoveryResults,
        };
      }

      await setReconciliationPhase("tracked_merged_but_open_issues");
    }

    const trackedMergedEvents = await args.reconcileTrackedMergedButOpenIssues(state, issues, updateReconciliationProgress);
    collectRecoveryEvents(trackedMergedEvents);

    await setReconciliationPhase("merged_issue_closures");
    const mergedIssueClosureEvents = await args.reconcileMergedIssueClosures(state, issues, updateReconciliationProgress);
    collectRecoveryEvents(mergedIssueClosureEvents);

    await setReconciliationPhase("stale_failed_issue_states");
    const staleFailedEvents = await args.reconcileStaleFailedIssueStates(state, issues, updateReconciliationProgress);
    collectRecoveryEvents(staleFailedEvents);

    if (args.reconcileStaleDoneIssueStates) {
      await setReconciliationPhase("stale_done_issue_states");
      const staleDoneEvents = await args.reconcileStaleDoneIssueStates(state, issues);
      collectRecoveryEvents(staleDoneEvents);
    }

    await setReconciliationPhase("recoverable_blocked_issue_states");
    const recoverableBlockedEvents = await args.reconcileRecoverableBlockedIssueStates(state, issues, {
      onlyTrackedPrStates: true,
    });
    collectRecoveryEvents(recoverableBlockedEvents);

    if (hasNonTrackedRecoverableBlockedStates(state)) {
      await setReconciliationPhase("recoverable_blocked_issue_states");
      const remainingRecoverableBlockedEvents = await args.reconcileRecoverableBlockedIssueStates(state, issues);
      collectRecoveryEvents(remainingRecoverableBlockedEvents);
    }

    if (
      state.activeIssueNumber === null &&
      await args.reserveRunnableIssueSelection?.(state) === true
    ) {
      return {
        state,
        recoveryEvents,
        recoveryResults,
      };
    }

    await setReconciliationPhase("parent_epic_closures");
    const parentEpicClosureEvents = await args.reconcileParentEpicClosures(state, issues) ?? [];
    collectRecoveryEvents(parentEpicClosureEvents);

    await setReconciliationPhase("cleanup_expired_done_workspaces");
    const cleanupEvents = await args.cleanupExpiredDoneWorkspaces(state);
    collectRecoveryEvents(cleanupEvents);

    return {
      state,
      recoveryEvents,
      recoveryResults,
    };
  } finally {
    await setReconciliationProgress(null);
  }
}
