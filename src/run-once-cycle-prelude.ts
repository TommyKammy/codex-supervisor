import { GitHubIssue, SupervisorStateFile } from "./types";

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
  recoveryEvents.push(...(await args.reconcileStaleActiveIssueReservation(state)));

  const authFailure = await args.handleAuthFailure(state);
  if (authFailure) {
    return {
      kind: "auth_failure",
      message: authFailure,
      recoveryEvents,
    };
  }

  const issues = await args.listAllIssues();
  recoveryEvents.push(...(await args.reconcileTrackedMergedButOpenIssues(state, issues)));
  recoveryEvents.push(...(await args.reconcileMergedIssueClosures(state, issues)));
  await args.reconcileStaleFailedIssueStates(state, issues);
  recoveryEvents.push(...(await args.reconcileRecoverableBlockedIssueStates(state, issues)));
  await args.reconcileParentEpicClosures(state, issues);
  recoveryEvents.push(...(await args.cleanupExpiredDoneWorkspaces(state)));

  return {
    state,
    recoveryEvents,
  };
}
