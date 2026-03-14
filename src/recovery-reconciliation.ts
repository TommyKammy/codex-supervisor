import fs from "node:fs";
import path from "node:path";
import { findHighRiskBlockingAmbiguity, findParentIssuesReadyToClose, lintExecutionReadyIssueBody } from "./issue-metadata";
import { inspectFileLock } from "./lock";
import { RecoveryEvent } from "./run-once-cycle-prelude";
import { StateStore } from "./state-store";
import { GitHubIssue, IssueRunRecord, PullRequestCheck, ReviewThread, RunState, SupervisorConfig, SupervisorStateFile } from "./types";
import { hoursSince, nowIso } from "./utils";
import { branchNameForIssue, cleanupWorkspace, isSafeCleanupTarget } from "./workspace";

const OWNER_GUARDED_ACTIVE_STATES = new Set<RunState>([
  "planning",
  "reproducing",
  "implementing",
  "local_review_fix",
  "stabilizing",
  "repairing_ci",
  "resolving_conflict",
  "addressing_review",
]);

type StateStoreLike = Pick<StateStore, "touch" | "save">;

type RecoveryGitHubLike = Pick<
  import("./github").GitHubClient,
  | "closeIssue"
  | "closePullRequest"
  | "getChecks"
  | "getIssue"
  | "getMergedPullRequestsClosingIssue"
  | "getPullRequestIfExists"
  | "getUnresolvedReviewThreads"
>;

function sanitizeRecoveryReason(reason: string): string {
  return reason.replace(/\r?\n/g, "\\n");
}

function doneResetPatch(
  patch: Partial<IssueRunRecord> = {},
): Partial<IssueRunRecord> {
  return {
    state: "done",
    last_error: null,
    blocked_reason: null,
    local_review_blocker_summary: null,
    local_review_recommendation: null,
    local_review_degraded: false,
    external_review_head_sha: null,
    external_review_misses_path: null,
    external_review_matched_findings_count: 0,
    external_review_near_match_findings_count: 0,
    external_review_missed_findings_count: 0,
    last_failure_kind: null,
    last_failure_context: null,
    last_blocker_signature: null,
    last_failure_signature: null,
    timeout_retry_count: 0,
    blocked_verification_retry_count: 0,
    repeated_blocker_count: 0,
    repeated_failure_signature_count: 0,
    ...patch,
  };
}

function needsRecordUpdate(record: IssueRunRecord, patch: Partial<IssueRunRecord>): boolean {
  for (const [key, value] of Object.entries(patch)) {
    const recordValue = record[key as keyof IssueRunRecord];
    if (JSON.stringify(recordValue) !== JSON.stringify(value)) {
      return true;
    }
  }

  return false;
}

async function cleanupRecordWorkspace(config: SupervisorConfig, record: IssueRunRecord): Promise<void> {
  if (!isSafeCleanupTarget(config, record.workspace, record.branch)) {
    console.warn(
      `Skipped unsafe cleanup target workspace=${record.workspace} branch=${record.branch} for issue #${record.issue_number}.`,
    );
    return;
  }

  await cleanupWorkspace(config.repoPath, record.workspace, record.branch);
}

function parseIssueNumberFromWorkspaceName(workspaceName: string): number | null {
  const match = /^issue-([1-9]\d*)$/.exec(workspaceName);
  if (!match) {
    return null;
  }

  return Number.parseInt(match[1], 10);
}

async function cleanupOrphanedIssueWorkspaces(
  config: SupervisorConfig,
  state: SupervisorStateFile,
): Promise<RecoveryEvent[]> {
  const referencedWorkspaces = new Set(
    Object.values(state.issues).map((record) => path.resolve(record.workspace)),
  );
  const recoveryEvents: RecoveryEvent[] = [];
  let workspaceEntries: fs.Dirent[];
  try {
    workspaceEntries = fs.readdirSync(config.workspaceRoot, { withFileTypes: true });
  } catch (error) {
    const maybeErr = error as NodeJS.ErrnoException;
    if (maybeErr.code !== "ENOENT") {
      console.warn(
        `Skipped orphaned workspace cleanup: unable to read workspace root ${config.workspaceRoot} (${maybeErr.message}).`,
      );
    }
    return recoveryEvents;
  }

  for (const entry of workspaceEntries) {
    if (!entry.isDirectory()) {
      continue;
    }

    const issueNumber = parseIssueNumberFromWorkspaceName(entry.name);
    if (issueNumber === null) {
      continue;
    }

    const workspacePath = path.join(config.workspaceRoot, entry.name);
    if (referencedWorkspaces.has(path.resolve(workspacePath))) {
      continue;
    }

    if (!fs.existsSync(path.join(workspacePath, ".git"))) {
      continue;
    }

    let branch: string;
    try {
      branch = branchNameForIssue(config, issueNumber);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`Skipped orphaned workspace cleanup for ${workspacePath}: ${message}`);
      continue;
    }

    if (!isSafeCleanupTarget(config, workspacePath, branch)) {
      console.warn(`Skipped unsafe orphaned workspace cleanup target workspace=${workspacePath} branch=${branch}.`);
      continue;
    }

    await cleanupWorkspace(config.repoPath, workspacePath, branch);
    recoveryEvents.push(buildRecoveryEvent(issueNumber, `pruned orphaned worktree ${entry.name}`));
  }

  return recoveryEvents;
}

export function buildRecoveryEvent(issueNumber: number, reason: string): RecoveryEvent {
  return {
    issueNumber,
    reason,
    at: nowIso(),
  };
}

export function applyRecoveryEvent(
  patch: Partial<IssueRunRecord>,
  recoveryEvent: RecoveryEvent,
): Partial<IssueRunRecord> {
  return {
    ...patch,
    last_recovery_reason: recoveryEvent.reason,
    last_recovery_at: recoveryEvent.at,
  };
}

export function formatRecoveryLog(events: RecoveryEvent[]): string | null {
  if (events.length === 0) {
    return null;
  }

  return [...events]
    .sort((left, right) => left.issueNumber - right.issueNumber || left.reason.localeCompare(right.reason))
    .map((event) => `recovery issue=#${event.issueNumber} reason=${sanitizeRecoveryReason(event.reason)}`)
    .join("; ");
}

export function prependRecoveryLog(message: string, recoveryLog: string | null): string {
  return recoveryLog ? `${recoveryLog}; ${message}` : message;
}

export async function cleanupExpiredDoneWorkspaces(
  config: SupervisorConfig,
  state: SupervisorStateFile,
): Promise<RecoveryEvent[]> {
  if (config.cleanupDoneWorkspacesAfterHours < 0 && config.maxDoneWorkspaces < 0) {
    return [];
  }

  const recoveryEvents = await cleanupOrphanedIssueWorkspaces(config, state);

  const doneRecords = Object.values(state.issues)
    .filter((record) => record.state === "done")
    .sort((left, right) => left.updated_at.localeCompare(right.updated_at));

  const existingDoneRecords = doneRecords.filter((record) =>
    fs.existsSync(path.join(record.workspace, ".git")),
  );

  const cleanedWorkspacePaths = new Set<string>();

  if (config.maxDoneWorkspaces >= 0 && existingDoneRecords.length > config.maxDoneWorkspaces) {
    const overflowCount = existingDoneRecords.length - config.maxDoneWorkspaces;
    const overflowRecords = existingDoneRecords.slice(0, overflowCount);
    for (const record of overflowRecords) {
      await cleanupRecordWorkspace(config, record);
      cleanedWorkspacePaths.add(record.workspace);
    }
  }

  if (config.cleanupDoneWorkspacesAfterHours < 0) {
    return recoveryEvents;
  }

  for (const record of doneRecords) {
    if (cleanedWorkspacePaths.has(record.workspace)) {
      continue;
    }

    if (hoursSince(record.updated_at) < config.cleanupDoneWorkspacesAfterHours) {
      continue;
    }

    await cleanupRecordWorkspace(config, record);
  }

  return recoveryEvents;
}

export async function reconcileMergedIssueClosures(
  github: RecoveryGitHubLike,
  stateStore: StateStore,
  state: SupervisorStateFile,
  issues: GitHubIssue[],
): Promise<RecoveryEvent[]> {
  let changed = false;
  const recoveryEvents: RecoveryEvent[] = [];
  const issueStateByNumber = new Map(issues.map((issue) => [issue.number, issue.state ?? null]));

  for (const record of Object.values(state.issues)) {
    if (issueStateByNumber.get(record.issue_number) !== "CLOSED") {
      continue;
    }

    const satisfyingPullRequests = await github.getMergedPullRequestsClosingIssue(record.issue_number);
    const satisfyingPullRequest = satisfyingPullRequests[0] ?? null;

    if (!satisfyingPullRequest) {
      const patch = doneResetPatch();
      if (needsRecordUpdate(record, patch)) {
        const updated = stateStore.touch(record, patch);
        state.issues[String(record.issue_number)] = updated;
        if (state.activeIssueNumber === record.issue_number) {
          state.activeIssueNumber = null;
        }
        changed = true;
      }
      continue;
    }

    if (
      record.pr_number !== null &&
      record.pr_number !== satisfyingPullRequest.number
    ) {
      const trackedPullRequest = await github.getPullRequestIfExists(record.pr_number);
      if (trackedPullRequest && trackedPullRequest.state === "OPEN" && !trackedPullRequest.mergedAt) {
        await github.closePullRequest(
          trackedPullRequest.number,
          `Closing as superseded because issue #${record.issue_number} was satisfied by merged PR #${satisfyingPullRequest.number}.`,
        );
      }
    }

    const patch = doneResetPatch({
      pr_number: satisfyingPullRequest.number,
      last_head_sha: satisfyingPullRequest.headRefOid,
    });
    if (needsRecordUpdate(record, patch)) {
      const recoveryEvent = buildRecoveryEvent(
        record.issue_number,
        `merged_pr_convergence: merged PR #${satisfyingPullRequest.number} satisfied issue #${record.issue_number}; marked issue #${record.issue_number} done`,
      );
      const updated = stateStore.touch(record, applyRecoveryEvent(patch, recoveryEvent));
      state.issues[String(record.issue_number)] = updated;
      if (state.activeIssueNumber === record.issue_number) {
        state.activeIssueNumber = null;
      }
      changed = true;
      recoveryEvents.push(recoveryEvent);
    }
  }

  if (changed) {
    await stateStore.save(state);
  }

  return recoveryEvents;
}

export async function reconcileTrackedMergedButOpenIssues(
  github: RecoveryGitHubLike,
  stateStore: StateStore,
  state: SupervisorStateFile,
  issues: GitHubIssue[],
): Promise<RecoveryEvent[]> {
  let changed = false;
  const recoveryEvents: RecoveryEvent[] = [];
  const issueByNumber = new Map(issues.map((issue) => [issue.number, issue]));

  for (const record of Object.values(state.issues)) {
    if (record.pr_number === null) {
      continue;
    }

    const trackedPullRequest = await github.getPullRequestIfExists(record.pr_number);
    if (!trackedPullRequest || (!trackedPullRequest.mergedAt && trackedPullRequest.state !== "MERGED")) {
      continue;
    }

    let issue = issueByNumber.get(record.issue_number);
    if (!issue && record.state === "merging") {
      issue = await github.getIssue(record.issue_number);
    }

    if (!issue) {
      continue;
    }

    const recoveryEvent = buildRecoveryEvent(
      record.issue_number,
      `merged_pr_convergence: tracked PR #${trackedPullRequest.number} merged; marked issue #${record.issue_number} done`,
    );

    if (issue.state !== "OPEN") {
      const patch = doneResetPatch({
        pr_number: trackedPullRequest.number,
        last_head_sha: trackedPullRequest.headRefOid,
      });
      const updated = stateStore.touch(record, applyRecoveryEvent(patch, recoveryEvent));
      state.issues[String(record.issue_number)] = updated;
      if (state.activeIssueNumber === record.issue_number) {
        state.activeIssueNumber = null;
      }
      changed = true;
      recoveryEvents.push(recoveryEvent);
      continue;
    }

    const mergedAtMs = Date.parse(trackedPullRequest.mergedAt ?? "");
    const issueUpdatedAtMs = Date.parse(issue.updatedAt);
    if (
      !Number.isFinite(mergedAtMs) ||
      !Number.isFinite(issueUpdatedAtMs) ||
      issueUpdatedAtMs > mergedAtMs
    ) {
      continue;
    }

    await github.closeIssue(
      record.issue_number,
      `Closed automatically because tracked PR #${trackedPullRequest.number} was merged.`,
    );

    const patch = doneResetPatch({
      pr_number: trackedPullRequest.number,
      last_head_sha: trackedPullRequest.headRefOid,
    });
    const updated = stateStore.touch(record, applyRecoveryEvent(patch, recoveryEvent));
    state.issues[String(record.issue_number)] = updated;
    if (state.activeIssueNumber === record.issue_number) {
      state.activeIssueNumber = null;
    }
    changed = true;
    recoveryEvents.push(recoveryEvent);
  }

  if (changed) {
    await stateStore.save(state);
  }

  return recoveryEvents;
}

export async function reconcileStaleFailedIssueStates(
  github: RecoveryGitHubLike,
  stateStore: StateStore,
  state: SupervisorStateFile,
  config: SupervisorConfig,
  issues: GitHubIssue[],
  deps: {
    inferStateFromPullRequest: (
      config: SupervisorConfig,
      record: IssueRunRecord,
      pr: GitHubIssue extends never ? never : NonNullable<Awaited<ReturnType<RecoveryGitHubLike["getPullRequestIfExists"]>>>,
      checks: PullRequestCheck[],
      reviewThreads: ReviewThread[],
    ) => IssueRunRecord["state"];
    isOpenPullRequest: (
      pr: NonNullable<Awaited<ReturnType<RecoveryGitHubLike["getPullRequestIfExists"]>>>,
    ) => boolean;
    syncReviewWaitWindow: (
      record: IssueRunRecord,
      pr: NonNullable<Awaited<ReturnType<RecoveryGitHubLike["getPullRequestIfExists"]>>>,
    ) => Partial<IssueRunRecord>;
    syncCopilotReviewRequestObservation: (
      config: SupervisorConfig,
      record: IssueRunRecord,
      pr: NonNullable<Awaited<ReturnType<RecoveryGitHubLike["getPullRequestIfExists"]>>>,
    ) => Partial<IssueRunRecord>;
    syncCopilotReviewTimeoutState: (
      config: SupervisorConfig,
      record: IssueRunRecord,
      pr: NonNullable<Awaited<ReturnType<RecoveryGitHubLike["getPullRequestIfExists"]>>>,
    ) => Partial<IssueRunRecord>;
  },
): Promise<void> {
  let changed = false;
  const issueStateByNumber = new Map(issues.map((issue) => [issue.number, issue.state ?? null]));

  for (const record of Object.values(state.issues)) {
    if (record.state !== "failed" || record.pr_number === null) {
      continue;
    }

    if (issueStateByNumber.get(record.issue_number) !== "OPEN") {
      continue;
    }

    const pr = await github.getPullRequestIfExists(record.pr_number);
    if (!pr || !deps.isOpenPullRequest(pr)) {
      continue;
    }

    const checks = await github.getChecks(pr.number);
    const reviewThreads = await github.getUnresolvedReviewThreads(pr.number);
    const nextState = deps.inferStateFromPullRequest(config, record, pr, checks, reviewThreads);

    if (nextState === "blocked" || nextState === "failed") {
      continue;
    }

    const patch: Partial<IssueRunRecord> = {
      state: nextState,
      last_error: null,
      last_failure_kind: null,
      last_failure_context: null,
      last_blocker_signature: null,
      last_failure_signature: null,
      blocked_reason: null,
      repeated_blocker_count: 0,
      repeated_failure_signature_count: 0,
      timeout_retry_count: 0,
      blocked_verification_retry_count: 0,
      pr_number: pr.number,
      last_head_sha: pr.headRefOid,
      ...deps.syncReviewWaitWindow(record, pr),
      ...deps.syncCopilotReviewRequestObservation(config, record, pr),
      ...deps.syncCopilotReviewTimeoutState(config, record, pr),
    };

    const updated = stateStore.touch(record, patch);
    state.issues[String(record.issue_number)] = updated;
    changed = true;
  }

  if (changed) {
    await stateStore.save(state);
  }
}

export async function reconcileRecoverableBlockedIssueStates(
  stateStore: StateStoreLike,
  state: SupervisorStateFile,
  config: SupervisorConfig,
  issues: GitHubIssue[],
  deps: {
    shouldAutoRetryHandoffMissing: (record: IssueRunRecord, config: SupervisorConfig) => boolean;
  },
): Promise<RecoveryEvent[]> {
  let changed = false;
  const recoveryEvents: RecoveryEvent[] = [];
  const issuesByNumber = new Map(issues.map((issue) => [issue.number, issue]));

  for (const record of Object.values(state.issues)) {
    const issue = issuesByNumber.get(record.issue_number);
    if (!issue || issue.state !== "OPEN") {
      continue;
    }

    if (deps.shouldAutoRetryHandoffMissing(record, config)) {
      const recoveryEvent = buildRecoveryEvent(
        record.issue_number,
        `stale_state_cleanup: requeued issue #${record.issue_number} after recovering a missing handoff`,
      );
      const updated = stateStore.touch(record, {
        state: "queued",
        blocked_reason: null,
        last_error: null,
        last_failure_kind: null,
        last_blocker_signature: null,
        codex_session_id: null,
        review_wait_started_at: null,
        review_wait_head_sha: null,
        copilot_review_requested_observed_at: null,
        copilot_review_requested_head_sha: null,
        copilot_review_timed_out_at: null,
        copilot_review_timeout_action: null,
        copilot_review_timeout_reason: null,
        ...applyRecoveryEvent({}, recoveryEvent),
      });
      state.issues[String(record.issue_number)] = updated;
      changed = true;
      recoveryEvents.push(recoveryEvent);
      continue;
    }

    if (record.state === "blocked" && record.blocked_reason === "requirements") {
      const readiness = lintExecutionReadyIssueBody(issue);
      if (!readiness.isExecutionReady) {
        continue;
      }

      const recoveryEvent = buildRecoveryEvent(
        record.issue_number,
        `requirements_recovered: requeued issue #${record.issue_number} after execution-ready metadata was added`,
      );
      const updated = stateStore.touch(record, {
        state: "queued",
        blocked_reason: null,
        last_error: null,
        last_failure_kind: null,
        last_failure_context: null,
        last_blocker_signature: null,
        last_failure_signature: null,
        repeated_failure_signature_count: 0,
        ...applyRecoveryEvent({}, recoveryEvent),
      });
      state.issues[String(record.issue_number)] = updated;
      changed = true;
      recoveryEvents.push(recoveryEvent);
      continue;
    }

    if (record.state === "blocked" && record.blocked_reason === "clarification") {
      if (findHighRiskBlockingAmbiguity(issue)) {
        continue;
      }

      const recoveryEvent = buildRecoveryEvent(
        record.issue_number,
        `clarification_recovered: requeued issue #${record.issue_number} after blocking ambiguity was resolved`,
      );
      const updated = stateStore.touch(record, {
        state: "queued",
        blocked_reason: null,
        last_error: null,
        last_failure_kind: null,
        last_failure_context: null,
        last_blocker_signature: null,
        last_failure_signature: null,
        repeated_failure_signature_count: 0,
        ...applyRecoveryEvent({}, recoveryEvent),
      });
      state.issues[String(record.issue_number)] = updated;
      changed = true;
      recoveryEvents.push(recoveryEvent);
    }
  }

  if (changed) {
    await stateStore.save(state);
  }

  return recoveryEvents;
}

export async function reconcileParentEpicClosures(
  github: RecoveryGitHubLike,
  stateStore: StateStore,
  state: SupervisorStateFile,
  issues: GitHubIssue[],
): Promise<void> {
  const parentIssuesReadyToClose = findParentIssuesReadyToClose(issues);
  if (parentIssuesReadyToClose.length === 0) {
    return;
  }

  let changed = false;

  for (const { parentIssue, childIssues } of parentIssuesReadyToClose) {
    const childIssueNumbers = childIssues
      .map((childIssue) => `#${childIssue.number}`)
      .sort((left, right) => Number(left.slice(1)) - Number(right.slice(1)));

    await github.closeIssue(
      parentIssue.number,
      `Closed automatically because all child issues are closed: ${childIssueNumbers.join(", ")}.`,
    );

    const existingRecord = state.issues[String(parentIssue.number)];
    if (existingRecord) {
      const patch = doneResetPatch();
      if (needsRecordUpdate(existingRecord, patch)) {
        const updated = stateStore.touch(existingRecord, patch);
        state.issues[String(parentIssue.number)] = updated;
        if (state.activeIssueNumber === parentIssue.number) {
          state.activeIssueNumber = null;
        }
        changed = true;
      }
    }
  }

  if (changed) {
    await stateStore.save(state);
  }
}

export async function reconcileStaleActiveIssueReservation(args: {
  stateStore: StateStoreLike;
  state: SupervisorStateFile;
  issueLockPath: (issueNumber: number) => string;
  sessionLockPath: (sessionId: string) => string;
}): Promise<RecoveryEvent[]> {
  const recoveryEvents: RecoveryEvent[] = [];
  if (args.state.activeIssueNumber === null) {
    return recoveryEvents;
  }

  const record = args.state.issues[String(args.state.activeIssueNumber)] ?? null;
  if (!record) {
    args.state.activeIssueNumber = null;
    await args.stateStore.save(args.state);
    return recoveryEvents;
  }

  if (!OWNER_GUARDED_ACTIVE_STATES.has(record.state)) {
    return recoveryEvents;
  }

  const issueLock = await inspectFileLock(args.issueLockPath(record.issue_number));
  if (issueLock.status === "live") {
    return recoveryEvents;
  }

  let missingLockReason = "issue lock was missing";
  if (record.codex_session_id) {
    const sessionLock = await inspectFileLock(args.sessionLockPath(record.codex_session_id));
    if (sessionLock.status === "live") {
      return recoveryEvents;
    }
    missingLockReason = "issue lock and session lock were missing";
  }

  const recoveryEvent = buildRecoveryEvent(
    record.issue_number,
    `stale_state_cleanup: cleared stale active reservation after ${missingLockReason}`,
  );
  args.state.issues[String(record.issue_number)] = args.stateStore.touch(record, {
    codex_session_id: null,
    ...applyRecoveryEvent({}, recoveryEvent),
  });
  args.state.activeIssueNumber = null;
  await args.stateStore.save(args.state);
  recoveryEvents.push(recoveryEvent);
  return recoveryEvents;
}

export type { StateStoreLike };
