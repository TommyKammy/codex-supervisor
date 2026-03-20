import { GitHubIssue, SupervisorStateFile } from "./core/types";

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

interface RunOnceCyclePreludeArgs {
  stateStore: Pick<{ load(): Promise<SupervisorStateFile> }, "load">;
  carryoverRecoveryEvents: RecoveryEvent[];
  setReconciliationPhase?: (phase: string | null) => Promise<void>;
  reconcileStaleActiveIssueReservation: (state: SupervisorStateFile) => Promise<RecoveryEvent[]>;
  handleAuthFailure: (state: SupervisorStateFile) => Promise<string | null>;
  listAllIssues: () => Promise<GitHubIssue[]>;
  reconcileTrackedMergedButOpenIssues: (
    state: SupervisorStateFile,
    issues: GitHubIssue[],
  ) => Promise<RecoveryEvent[]>;
  reconcileMergedIssueClosures: (
    state: SupervisorStateFile,
    issues: GitHubIssue[],
  ) => Promise<RecoveryEvent[]>;
  reconcileStaleFailedIssueStates: (
    state: SupervisorStateFile,
    issues: GitHubIssue[],
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

export async function runOnceCyclePrelude(
  args: RunOnceCyclePreludeArgs,
): Promise<RunOnceCyclePreludeResult | RunOnceCyclePreludeAuthFailure> {
  const state = await args.stateStore.load();
  const recoveryEvents: RecoveryEvent[] = [...args.carryoverRecoveryEvents];
  const setReconciliationPhase = args.setReconciliationPhase ?? (async () => {});

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
    recoveryEvents.push(...(await args.reconcileStaleActiveIssueReservation(state)));

    const issues = await args.listAllIssues();

    await setReconciliationPhase("tracked_merged_but_open_issues");
    recoveryEvents.push(...(await args.reconcileTrackedMergedButOpenIssues(state, issues)));

    await setReconciliationPhase("merged_issue_closures");
    recoveryEvents.push(...(await args.reconcileMergedIssueClosures(state, issues)));

    await setReconciliationPhase("stale_failed_issue_states");
    await args.reconcileStaleFailedIssueStates(state, issues);

    await setReconciliationPhase("recoverable_blocked_issue_states");
    recoveryEvents.push(...(await args.reconcileRecoverableBlockedIssueStates(state, issues)));

    await setReconciliationPhase("parent_epic_closures");
    await args.reconcileParentEpicClosures(state, issues);

    await setReconciliationPhase("cleanup_expired_done_workspaces");
    recoveryEvents.push(...(await args.cleanupExpiredDoneWorkspaces(state)));

    return {
      state,
      recoveryEvents,
    };
  } finally {
    await setReconciliationPhase(null);
  }
}
