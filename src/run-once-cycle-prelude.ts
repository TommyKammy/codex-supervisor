import { GitHubIssue, SupervisorStateFile } from "./core/types";
import {
  buildLastSuccessfulInventorySnapshot,
  buildInventoryRefreshFailure,
  canUseSnapshotBackedSelectionAfterInventoryRefreshFailure,
  inventoryRefreshFailureEquals,
} from "./inventory-refresh-state";
import {
  buildRecoverySupervisorEvent,
  emitSupervisorEvent,
  type SupervisorEventSink,
} from "./supervisor/supervisor-events";
import type { ReconciliationProgressUpdate } from "./supervisor/supervisor-reconciliation-phase";

export interface RecoveryEvent {
  issueNumber: number;
  reason: string;
  at: string;
}

export interface RunOnceCyclePreludeResult {
  state: SupervisorStateFile;
  recoveryEvents: RecoveryEvent[];
}

export interface RunOnceCyclePreludeAuthFailure {
  kind: "auth_failure";
  message: string;
  recoveryEvents: RecoveryEvent[];
}

type ReconciliationProgressPatch = Partial<Omit<ReconciliationProgressUpdate, "phase">>;

interface RunOnceCyclePreludeArgs {
  stateStore: Pick<{ load(): Promise<SupervisorStateFile>; save(state: SupervisorStateFile): Promise<void> }, "load" | "save">;
  carryoverRecoveryEvents: RecoveryEvent[];
  emitEvent?: SupervisorEventSink;
  setReconciliationPhase?: (phase: string | null) => Promise<void>;
  setReconciliationProgress?: (progress: ReconciliationProgressUpdate | null) => Promise<void>;
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
  ) => Promise<RecoveryEvent[]>;
  reconcileStaleFailedIssueStates: (
    state: SupervisorStateFile,
    issues: GitHubIssue[],
    updateReconciliationProgress: (patch: ReconciliationProgressPatch) => Promise<void>,
  ) => Promise<void>;
  reconcileRecoverableBlockedIssueStates: (
    state: SupervisorStateFile,
    issues: GitHubIssue[],
    options?: { onlyTrackedPrStates?: boolean },
  ) => Promise<RecoveryEvent[]>;
  reconcileParentEpicClosures: (
    state: SupervisorStateFile,
    issues: GitHubIssue[],
  ) => Promise<void>;
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
  const emitRecoveryEvents = (events: RecoveryEvent[]) => {
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
    };
  }

  try {
    await setReconciliationPhase("stale_active_issue_reservation");
    const staleReservationEvents = await args.reconcileStaleActiveIssueReservation(state);
    recoveryEvents.push(...staleReservationEvents);
    emitRecoveryEvents(staleReservationEvents);

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
      await persistInventoryRefreshState({
        nextFailure,
      });
      if (activeRecord !== null && activeRecord.pr_number !== null) {
        await setReconciliationPhase("tracked_merged_but_open_issues");
        const activeMergedEvents = await args.reconcileTrackedMergedButOpenIssues(
          state,
          [],
          updateReconciliationProgress,
          { onlyIssueNumber: activeRecord.issue_number },
        );
        recoveryEvents.push(...activeMergedEvents);
        emitRecoveryEvents(activeMergedEvents);
      }

      const hasNonActiveFailedTrackedPrRecords = Object.values(state.issues).some((record) =>
        record.state === "failed"
          && record.pr_number !== null
          && record.issue_number !== state.activeIssueNumber,
      );
      if (hasNonActiveFailedTrackedPrRecords) {
        await setReconciliationPhase("stale_failed_issue_states");
        await args.reconcileStaleFailedIssueStates(state, [], updateReconciliationProgress);
      }

      const hasBlockedTrackedPrRecords = Object.values(state.issues).some((record) =>
        record.state === "blocked" &&
        record.pr_number !== null &&
        (record.blocked_reason === null || record.blocked_reason === "manual_review" || record.blocked_reason === "verification"),
      );
      if (hasBlockedTrackedPrRecords) {
        await setReconciliationPhase("recoverable_blocked_issue_states");
        const recoverableBlockedEvents = await args.reconcileRecoverableBlockedIssueStates(state, []);
        recoveryEvents.push(...recoverableBlockedEvents);
        emitRecoveryEvents(recoverableBlockedEvents);
      }

      if (
        state.activeIssueNumber === null
        && canUseSnapshotBackedSelectionAfterInventoryRefreshFailure({
          failure: nextFailure,
          snapshot: state.last_successful_inventory_snapshot,
          previousFailure,
        })
        && await args.reserveRunnableIssueSelection?.(state) === true
      ) {
        return {
          state,
          recoveryEvents,
        };
      }

      return {
        state,
        recoveryEvents,
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
      recoveryEvents.push(...activeMergedEvents);
      emitRecoveryEvents(activeMergedEvents);

      const activeRecordAfterFastPath = state.issues[String(activeRecord.issue_number)] ?? null;
      if (activeRecordAfterFastPath?.state === "done") {
        return {
          state,
          recoveryEvents,
        };
      }

      await setReconciliationPhase("tracked_merged_but_open_issues");
    }

    const trackedMergedEvents = await args.reconcileTrackedMergedButOpenIssues(state, issues, updateReconciliationProgress);
    recoveryEvents.push(...trackedMergedEvents);
    emitRecoveryEvents(trackedMergedEvents);

    await setReconciliationPhase("merged_issue_closures");
    const mergedIssueClosureEvents = await args.reconcileMergedIssueClosures(state, issues);
    recoveryEvents.push(...mergedIssueClosureEvents);
    emitRecoveryEvents(mergedIssueClosureEvents);

    await setReconciliationPhase("stale_failed_issue_states");
    await args.reconcileStaleFailedIssueStates(state, issues, updateReconciliationProgress);

    await setReconciliationPhase("recoverable_blocked_issue_states");
    const recoverableBlockedEvents = await args.reconcileRecoverableBlockedIssueStates(state, issues, {
      onlyTrackedPrStates: true,
    });
    recoveryEvents.push(...recoverableBlockedEvents);
    emitRecoveryEvents(recoverableBlockedEvents);

    if (
      state.activeIssueNumber === null &&
      await args.reserveRunnableIssueSelection?.(state) === true
    ) {
      return {
        state,
        recoveryEvents,
      };
    }

    if (hasNonTrackedRecoverableBlockedStates(state)) {
      await setReconciliationPhase("recoverable_blocked_issue_states");
      const remainingRecoverableBlockedEvents = await args.reconcileRecoverableBlockedIssueStates(state, issues);
      recoveryEvents.push(...remainingRecoverableBlockedEvents);
      emitRecoveryEvents(remainingRecoverableBlockedEvents);
    }

    await setReconciliationPhase("parent_epic_closures");
    await args.reconcileParentEpicClosures(state, issues);

    await setReconciliationPhase("cleanup_expired_done_workspaces");
    const cleanupEvents = await args.cleanupExpiredDoneWorkspaces(state);
    recoveryEvents.push(...cleanupEvents);
    emitRecoveryEvents(cleanupEvents);

    return {
      state,
      recoveryEvents,
    };
  } finally {
    await setReconciliationProgress(null);
  }
}
