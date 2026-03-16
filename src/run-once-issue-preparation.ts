import { GitHubClient } from "./github";
import { issueJournalPath, syncIssueJournal as syncIssueJournalImpl } from "./journal";
import { syncMemoryArtifacts as syncMemoryArtifactsImpl } from "./memory";
import { RecoveryEvent } from "./run-once-cycle-prelude";
import {
  applyFailureSignature,
  buildCodexFailureContext,
} from "./supervisor/supervisor-failure-helpers";
import { StateStore } from "./state-store";
import {
  CliOptions,
  GitHubIssue,
  GitHubPullRequest,
  IssueRunRecord,
  PullRequestCheck,
  ReviewThread,
  SupervisorConfig,
  SupervisorStateFile,
  WorkspaceStatus,
} from "./types";
import { nowIso } from "./utils";
import {
  ensureWorkspace as ensureWorkspaceImpl,
  getWorkspaceStatus as getWorkspaceStatusImpl,
  pushBranch as pushBranchImpl,
} from "./workspace";

export type IssueJournalSync = (record: IssueRunRecord) => Promise<void>;
export type MemoryArtifacts = Awaited<ReturnType<typeof syncMemoryArtifactsImpl>>;

export interface PreparedWorkspaceContext {
  record: IssueRunRecord;
  issue: GitHubIssue;
  previousCodexSummary: string | null;
  previousError: string | null;
  workspacePath: string;
  journalPath: string;
  syncJournal: IssueJournalSync;
  memoryArtifacts: MemoryArtifacts;
  workspaceStatus: WorkspaceStatus;
}

export interface HydratedPullRequestContext {
  record: IssueRunRecord;
  pr: GitHubPullRequest | null;
  checks: PullRequestCheck[];
  reviewThreads: ReviewThread[];
  workspaceStatus: WorkspaceStatus;
}

export interface PreparedIssueExecutionContext extends PreparedWorkspaceContext, HydratedPullRequestContext {}

export interface RestartRunOnce {
  kind: "restart";
  recoveryEvents?: RecoveryEvent[];
}

type PreparationGitHub = Pick<
  GitHubClient,
  "resolvePullRequestForBranch" | "getChecks" | "getUnresolvedReviewThreads" | "createPullRequest"
>;
type PreparationStateStore = Pick<StateStore, "save" | "touch">;

interface SyncIssueJournalArgs {
  issue: GitHubIssue;
  record: IssueRunRecord;
  journalPath: string;
  maxChars: number;
}

interface SyncMemoryArtifactsArgs {
  config: SupervisorConfig;
  issueNumber: number;
  workspacePath: string;
  journalPath: string;
}

interface PrepareIssueExecutionContextArgs {
  github: PreparationGitHub;
  config: SupervisorConfig;
  stateStore: PreparationStateStore;
  state: SupervisorStateFile;
  record: IssueRunRecord;
  issue: GitHubIssue;
  options: Pick<CliOptions, "dryRun">;
  ensureWorkspace?: (config: SupervisorConfig, issueNumber: number, branch: string) => Promise<string>;
  syncIssueJournal?: (args: SyncIssueJournalArgs) => Promise<void>;
  syncMemoryArtifacts?: (args: SyncMemoryArtifactsArgs) => Promise<MemoryArtifacts>;
  getWorkspaceStatus?: (workspacePath: string, branch: string, defaultBranch: string) => Promise<WorkspaceStatus>;
  pushBranch?: (workspacePath: string, branch: string, remoteBranchExists: boolean) => Promise<void>;
  now?: () => string;
}

export function isRestartRunOnce(
  result: unknown,
): result is RestartRunOnce {
  return (
    typeof result === "object" &&
    result !== null &&
    "kind" in result &&
    (result as { kind?: string }).kind === "restart"
  );
}

function isOpenPullRequest(pr: GitHubPullRequest | null): pr is GitHubPullRequest {
  return pr !== null && pr.state === "OPEN" && !pr.mergedAt;
}

function buildRecoveryEvent(issueNumber: number, reason: string, now: () => string): RecoveryEvent {
  return {
    issueNumber,
    reason,
    at: now(),
  };
}

function applyRecoveryEvent(
  patch: Partial<IssueRunRecord>,
  recoveryEvent: RecoveryEvent,
): Partial<IssueRunRecord> {
  return {
    ...patch,
    last_recovery_reason: recoveryEvent.reason,
    last_recovery_at: recoveryEvent.at,
  };
}

async function prepareWorkspaceContext(
  args: PrepareIssueExecutionContextArgs,
): Promise<PreparedWorkspaceContext> {
  const ensureWorkspace = args.ensureWorkspace ?? ensureWorkspaceImpl;
  const syncIssueJournal = args.syncIssueJournal ?? syncIssueJournalImpl;
  const syncMemoryArtifacts = args.syncMemoryArtifacts ?? syncMemoryArtifactsImpl;
  const getWorkspaceStatus = args.getWorkspaceStatus ?? getWorkspaceStatusImpl;

  const previousCodexSummary = args.record.last_codex_summary;
  const previousError = args.record.last_error;
  const workspacePath = await ensureWorkspace(args.config, args.record.issue_number, args.record.branch);
  const journalPath = issueJournalPath(workspacePath, args.config.issueJournalRelativePath);
  const syncJournal: IssueJournalSync = async (currentRecord: IssueRunRecord): Promise<void> => {
    await syncIssueJournal({
      issue: args.issue,
      record: currentRecord,
      journalPath,
      maxChars: args.config.issueJournalMaxChars,
    });
  };

  const preparedRecord = args.stateStore.touch(args.record, {
    workspace: workspacePath,
    journal_path: journalPath,
    state: args.record.implementation_attempt_count === 0 ? "planning" : args.record.state,
    last_error: null,
    last_failure_kind: null,
    blocked_reason: null,
  });
  args.state.issues[String(preparedRecord.issue_number)] = preparedRecord;
  await args.stateStore.save(args.state);
  await syncJournal(preparedRecord);

  const memoryArtifacts = await syncMemoryArtifacts({
    config: args.config,
    issueNumber: preparedRecord.issue_number,
    workspacePath,
    journalPath,
  });

  const workspaceStatus = await getWorkspaceStatus(workspacePath, preparedRecord.branch, args.config.defaultBranch);
  const hydratedRecord = args.stateStore.touch(preparedRecord, { last_head_sha: workspaceStatus.headSha });
  args.state.issues[String(hydratedRecord.issue_number)] = hydratedRecord;
  await args.stateStore.save(args.state);

  return {
    record: hydratedRecord,
    issue: args.issue,
    previousCodexSummary,
    previousError,
    workspacePath,
    journalPath,
    syncJournal,
    memoryArtifacts,
    workspaceStatus,
  };
}

async function hydratePullRequestContext(
  args: PrepareIssueExecutionContextArgs & {
    record: IssueRunRecord;
    workspacePath: string;
    workspaceStatus: WorkspaceStatus;
    syncJournal: IssueJournalSync;
  },
): Promise<HydratedPullRequestContext | RestartRunOnce | string> {
  const pushBranch = args.pushBranch ?? pushBranchImpl;
  const getWorkspaceStatus = args.getWorkspaceStatus ?? getWorkspaceStatusImpl;
  const now = args.now ?? nowIso;

  let nextWorkspaceStatus = args.workspaceStatus;
  if (nextWorkspaceStatus.remoteBranchExists && nextWorkspaceStatus.remoteAhead > 0) {
    await pushBranch(args.workspacePath, args.record.branch, true);
    nextWorkspaceStatus = await getWorkspaceStatus(args.workspacePath, args.record.branch, args.config.defaultBranch);
  }

  const resolvedPr = await args.github.resolvePullRequestForBranch(args.record.branch, args.record.pr_number);
  let pr = isOpenPullRequest(resolvedPr) ? resolvedPr : null;
  let checks = pr ? await args.github.getChecks(pr.number) : [];
  let reviewThreads = pr ? await args.github.getUnresolvedReviewThreads(pr.number) : [];

  if (!pr) {
    if (!resolvedPr) {
      // No current or historical PR for this branch; continue with normal branch/PR flow.
    } else if (resolvedPr.mergedAt || resolvedPr.state === "MERGED") {
      const recoveryEvent = buildRecoveryEvent(
        args.record.issue_number,
        `merged_pr_convergence: tracked PR #${resolvedPr.number} merged; marked issue #${args.record.issue_number} done`,
        now,
      );
      const doneRecord = args.stateStore.touch(args.record, {
        pr_number: resolvedPr.number,
        state: "done",
        last_head_sha: resolvedPr.headRefOid,
        ...applyRecoveryEvent({}, recoveryEvent),
      });
      args.state.issues[String(doneRecord.issue_number)] = doneRecord;
      args.state.activeIssueNumber = null;
      await args.stateStore.save(args.state);
      return { kind: "restart", recoveryEvents: [recoveryEvent] };
    } else if (resolvedPr.state === "CLOSED") {
      const failureContext = buildCodexFailureContext(
        "manual",
        `PR #${resolvedPr.number} was closed without merge.`,
        ["Manual intervention is required before the supervisor can continue this issue."],
      );
      const blockedRecord = args.stateStore.touch(args.record, {
        pr_number: resolvedPr.number,
        state: "blocked",
        last_error:
          `PR #${resolvedPr.number} was closed without merge. ` +
          `Manual intervention is required before issue #${args.record.issue_number} can continue.`,
        last_failure_kind: null,
        last_failure_context: failureContext,
        ...applyFailureSignature(args.record, failureContext),
        blocked_reason: "manual_pr_closed",
      });
      args.state.issues[String(blockedRecord.issue_number)] = blockedRecord;
      args.state.activeIssueNumber = null;
      await args.stateStore.save(args.state);
      await args.syncJournal(blockedRecord);
      return `Issue #${blockedRecord.issue_number} blocked because PR #${resolvedPr.number} was closed without merge.`;
    }
  }

  if (
    !pr &&
    nextWorkspaceStatus.baseAhead > 0 &&
    !nextWorkspaceStatus.hasUncommittedChanges &&
    args.record.implementation_attempt_count >= args.config.draftPrAfterAttempt
  ) {
    await pushBranch(args.workspacePath, args.record.branch, nextWorkspaceStatus.remoteBranchExists);
    pr = await args.github.createPullRequest(args.issue, args.record, { draft: true });
    checks = await args.github.getChecks(pr.number);
    reviewThreads = await args.github.getUnresolvedReviewThreads(pr.number);
  }

  return {
    record: args.record,
    pr,
    checks,
    reviewThreads,
    workspaceStatus: nextWorkspaceStatus,
  };
}

export async function prepareIssueExecutionContext(
  args: PrepareIssueExecutionContextArgs,
): Promise<PreparedIssueExecutionContext | RestartRunOnce | string> {
  const preparedWorkspace = await prepareWorkspaceContext(args);
  const hydratedPullRequest = await hydratePullRequestContext({
    ...args,
    record: preparedWorkspace.record,
    workspacePath: preparedWorkspace.workspacePath,
    workspaceStatus: preparedWorkspace.workspaceStatus,
    syncJournal: preparedWorkspace.syncJournal,
  });
  if (typeof hydratedPullRequest === "string") {
    return hydratedPullRequest;
  }
  if (isRestartRunOnce(hydratedPullRequest)) {
    return hydratedPullRequest;
  }

  return {
    ...preparedWorkspace,
    ...hydratedPullRequest,
  };
}
