import { GitHubIssue, SupervisorStateFile } from "./core/types";
import {
  buildLastSuccessfulInventorySnapshot,
  buildInventoryRefreshFailure,
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
  ) => Promise<RecoveryEvent[]>;
  reconcileParentEpicClosures: (
    state: SupervisorStateFile,
    issues: GitHubIssue[],
  ) => Promise<void>;
  cleanupExpiredDoneWorkspaces: (state: SupervisorStateFile) => Promise<RecoveryEvent[]>;
}

async function loadTrackedIssuesForParentEpicClosureFallback(
  state: SupervisorStateFile,
  getIssue: (issueNumber: number) => Promise<GitHubIssue>,
): Promise<GitHubIssue[] | null> {
  const trackedIssueNumbers = Object.keys(state.issues)
    .map((value) => Number(value))
    .filter((value) => Number.isInteger(value))
    .sort((left, right) => left - right);

  if (trackedIssueNumbers.length === 0) {
    return [];
  }

  try {
    return await Promise.all(trackedIssueNumbers.map((issueNumber) => getIssue(issueNumber)));
  } catch {
    return null;
  }
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
      await persistInventoryRefreshState({
        nextFailure: buildInventoryRefreshFailure(error),
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

      if (args.getIssueForParentEpicClosureFallback) {
        const trackedIssues = await loadTrackedIssuesForParentEpicClosureFallback(
          state,
          args.getIssueForParentEpicClosureFallback,
        );
        if (trackedIssues !== null) {
          await setReconciliationPhase("parent_epic_closures");
          await args.reconcileParentEpicClosures(state, trackedIssues);
        }
      }

      return {
        state,
        recoveryEvents,
      };
    }

    if (state.activeIssueNumber === null && await args.reserveRunnableIssueSelection?.(state) === true) {
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
    const recoverableBlockedEvents = await args.reconcileRecoverableBlockedIssueStates(state, issues);
    recoveryEvents.push(...recoverableBlockedEvents);
    emitRecoveryEvents(recoverableBlockedEvents);

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
