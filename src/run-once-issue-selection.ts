import path from "node:path";
import { GitHubClient } from "./github";
import {
  findBlockingIssue,
  findHighRiskBlockingAmbiguity,
  lintExecutionReadyIssueBody,
} from "./issue-metadata";
import { issueJournalPath, syncIssueJournal } from "./core/journal";
import { acquireFileLock, LockHandle } from "./core/lock";
import {
  applyFailureSignature,
} from "./supervisor/supervisor-failure-helpers";
import {
  formatExecutionReadyMissingFields,
  isEligibleForSelection,
  shouldEnforceExecutionReady,
} from "./supervisor/supervisor-execution-policy";
import { StateStore } from "./core/state-store";
import {
  FailureContext,
  GitHubIssue,
  IssueRunRecord,
  SupervisorConfig,
  SupervisorStateFile,
} from "./core/types";
import { nowIso, truncate } from "./core/utils";
import { branchNameForIssue, ensureWorkspace, workspacePathForIssue } from "./core/workspace";
import {
  buildActiveIssueChangedEvent,
  buildLoopSkippedEvent,
  emitSupervisorEvent,
  type SupervisorEventSink,
} from "./supervisor/supervisor-events";

export interface ReadyIssueContext {
  kind: "ready";
  record: IssueRunRecord;
  issue: GitHubIssue;
  issueLock: LockHandle;
}

export interface RestartRunOnce {
  kind: "restart";
}

type IssueSelectionResult = ReadyIssueContext | RestartRunOnce | string;

type IssueSelectionGitHub = Pick<GitHubClient, "listCandidateIssues" | "getIssue">;
type IssueSelectionStateStore = Pick<StateStore, "save" | "touch">;

type IssueJournalContext = Pick<IssueRunRecord, "workspace" | "journal_path">;

interface SelectedIssueRecord {
  record: IssueRunRecord;
  persistReservation: boolean;
}

interface SyncIssueJournalArgs {
  issue: GitHubIssue;
  record: IssueRunRecord;
  journalPath: string;
  maxChars: number;
}

interface ResolveRunnableIssueContextArgs {
  github: IssueSelectionGitHub;
  config: SupervisorConfig;
  stateStore: IssueSelectionStateStore;
  state: SupervisorStateFile;
  currentRecord: IssueRunRecord | null;
  acquireIssueLock?: (record: IssueRunRecord) => Promise<LockHandle>;
  ensureRecordJournalContext?: (record: IssueRunRecord) => Promise<IssueJournalContext>;
  syncIssueJournal?: (args: SyncIssueJournalArgs) => Promise<void>;
  emitEvent?: SupervisorEventSink;
}

function createIssueRecord(config: SupervisorConfig, issueNumber: number): IssueRunRecord {
  const branch = branchNameForIssue(config, issueNumber);
  return {
    issue_number: issueNumber,
    state: "queued",
    branch,
    pr_number: null,
    workspace: workspacePathForIssue(config, issueNumber),
    journal_path: null,
    review_wait_started_at: null,
    review_wait_head_sha: null,
    copilot_review_requested_observed_at: null,
    copilot_review_requested_head_sha: null,
    copilot_review_timed_out_at: null,
    copilot_review_timeout_action: null,
    copilot_review_timeout_reason: null,
    codex_session_id: null,
    local_review_head_sha: null,
    local_review_blocker_summary: null,
    local_review_summary_path: null,
    local_review_run_at: null,
    local_review_max_severity: null,
    local_review_findings_count: 0,
    local_review_root_cause_count: 0,
    local_review_verified_max_severity: null,
    local_review_verified_findings_count: 0,
    local_review_recommendation: null,
    local_review_degraded: false,
    last_local_review_signature: null,
    repeated_local_review_signature_count: 0,
    external_review_head_sha: null,
    external_review_misses_path: null,
    external_review_matched_findings_count: 0,
    external_review_near_match_findings_count: 0,
    external_review_missed_findings_count: 0,
    attempt_count: 0,
    implementation_attempt_count: 0,
    repair_attempt_count: 0,
    timeout_retry_count: 0,
    blocked_verification_retry_count: 0,
    repeated_blocker_count: 0,
    repeated_failure_signature_count: 0,
    last_head_sha: null,
    last_codex_summary: null,
    last_recovery_reason: null,
    last_recovery_at: null,
    last_error: null,
    last_failure_kind: null,
    last_failure_context: null,
    last_blocker_signature: null,
    last_failure_signature: null,
    blocked_reason: null,
    processed_review_thread_ids: [],
    processed_review_thread_fingerprints: [],
    updated_at: nowIso(),
  };
}

function buildExecutionReadyFailureContext(
  issue: Pick<GitHubIssue, "number" | "url">,
  missingRequired: string[],
  missingRecommended: string[],
): FailureContext {
  const missingRequiredText = formatExecutionReadyMissingFields(missingRequired);
  return {
    category: "blocked",
    summary:
      `Issue #${issue.number} is not execution-ready because it is missing: ` +
      `${missingRequiredText}.`,
    signature: `requirements:${missingRequired.join("|")}`,
    command: null,
    details: [
      `missing_required=${missingRequiredText}`,
      `missing_recommended=${
        missingRecommended.length > 0 ? formatExecutionReadyMissingFields(missingRecommended) : "none"
      }`,
    ],
    url: issue.url,
    updated_at: nowIso(),
  };
}

function buildClarificationFailureContext(
  issue: Pick<GitHubIssue, "number" | "url">,
  reason: string,
  ambiguityClasses: string[],
  riskyChangeClasses: string[],
): FailureContext {
  return {
    category: "blocked",
    summary: `Issue #${issue.number} requires manual clarification because ${reason}.`,
    signature: `clarification:${ambiguityClasses.join("|")}:${riskyChangeClasses.join("|")}`,
    command: null,
    details: [
      `ambiguity_classes=${ambiguityClasses.join(", ")}`,
      `risky_change_classes=${riskyChangeClasses.join(", ")}`,
    ],
    url: issue.url,
    updated_at: nowIso(),
  };
}

async function defaultAcquireIssueLock(
  config: SupervisorConfig,
  record: IssueRunRecord,
): Promise<LockHandle> {
  return acquireFileLock(
    path.join(path.dirname(config.stateFile), "locks", "issues", `issue-${record.issue_number}.lock`),
    `issue-${record.issue_number}`,
  );
}

async function defaultEnsureRecordJournalContext(
  config: SupervisorConfig,
  record: IssueRunRecord,
): Promise<IssueJournalContext> {
  if (record.journal_path) {
    return {
      workspace: record.workspace,
      journal_path: record.journal_path,
    };
  }

  const workspace = await ensureWorkspace(config, record.issue_number, record.branch);
  return {
    workspace,
    journal_path: issueJournalPath(workspace, config.issueJournalRelativePath),
  };
}

async function selectIssueRecord(
  github: IssueSelectionGitHub,
  config: SupervisorConfig,
  stateStore: IssueSelectionStateStore,
  state: SupervisorStateFile,
  currentRecord: IssueRunRecord | null,
): Promise<SelectedIssueRecord | string> {
  let record = currentRecord;

  if (!record || !isEligibleForSelection(record, config)) {
    const issues = await github.listCandidateIssues();
    record = null;
    for (const issue of issues) {
      if (config.skipTitlePrefixes.some((prefix) => issue.title.startsWith(prefix))) {
        continue;
      }

      if (findBlockingIssue(issue, issues, state)) {
        continue;
      }

      const existing = state.issues[String(issue.number)];
      if (!isEligibleForSelection(existing, config)) {
        continue;
      }

      record = existing ?? createIssueRecord(config, issue.number);
      break;
    }

    if (!record) {
      state.activeIssueNumber = null;
      await stateStore.save(state);
      return "No matching open issue found.";
    }

    return {
      record,
      persistReservation: true,
    };
  }

  return {
    record,
    persistReservation: false,
  };
}

export async function resolveRunnableIssueContext(
  args: ResolveRunnableIssueContextArgs,
): Promise<IssueSelectionResult> {
  const {
    github,
    config,
    stateStore,
    state,
    currentRecord,
    acquireIssueLock = (record) => defaultAcquireIssueLock(config, record),
    ensureRecordJournalContext = (record) => defaultEnsureRecordJournalContext(config, record),
    syncIssueJournal: syncIssueJournalImpl = syncIssueJournal,
    emitEvent,
  } = args;
  const selectedRecord = await selectIssueRecord(github, config, stateStore, state, currentRecord);
  if (typeof selectedRecord === "string") {
    emitSupervisorEvent(emitEvent, buildLoopSkippedEvent({
      issueNumber: null,
      reason: "no_matching_open_issue",
      detail: selectedRecord,
    }));
    return selectedRecord;
  }

  let { record, persistReservation } = selectedRecord;
  const issueLock = await acquireIssueLock(record);
  if (!issueLock.acquired) {
    emitSupervisorEvent(emitEvent, buildLoopSkippedEvent({
      issueNumber: record.issue_number,
      reason: "issue_lock_unavailable",
      detail: issueLock.reason ?? "issue lock unavailable",
      at: record.updated_at,
    }));
    return `Skipped issue #${record.issue_number}: ${issueLock.reason}.`;
  }

  let shouldReleaseIssueLock = true;
  try {
    if (persistReservation) {
      const previousIssueNumber = state.activeIssueNumber;
      state.activeIssueNumber = record.issue_number;
      state.issues[String(record.issue_number)] = record;
      await stateStore.save(state);
      emitSupervisorEvent(emitEvent, buildActiveIssueChangedEvent({
        issueNumber: record.issue_number,
        previousIssueNumber,
        nextIssueNumber: record.issue_number,
        reason: "reserved_for_cycle",
        at: record.updated_at,
      }));
      persistReservation = false;
    }

    const issue = await github.getIssue(record.issue_number);
    if (issue.state === "CLOSED") {
      record = stateStore.touch(record, { state: "done" });
      state.issues[String(record.issue_number)] = record;
      state.activeIssueNumber = null;
      await stateStore.save(state);
      shouldReleaseIssueLock = false;
      await issueLock.release();
      return { kind: "restart" };
    }

    if (shouldEnforceExecutionReady(record)) {
      const readiness = lintExecutionReadyIssueBody(issue);
      if (!readiness.isExecutionReady) {
        const journalContext = await ensureRecordJournalContext(record);
        const failureContext = buildExecutionReadyFailureContext(
          issue,
          readiness.missingRequired,
          readiness.missingRecommended,
        );
        const blockedRecord = stateStore.touch(record, {
          ...journalContext,
          state: "blocked",
          last_error: truncate(
            `Missing required execution-ready metadata: ${formatExecutionReadyMissingFields(
              readiness.missingRequired,
            )}.`,
            1000,
          ),
          last_failure_kind: null,
          last_failure_context: failureContext,
          ...applyFailureSignature(record, failureContext),
          blocked_reason: "requirements",
        });
        state.issues[String(blockedRecord.issue_number)] = blockedRecord;
        state.activeIssueNumber = null;
        await stateStore.save(state);
        if (blockedRecord.journal_path) {
          await syncIssueJournalImpl({
            issue,
            record: blockedRecord,
            journalPath: blockedRecord.journal_path,
            maxChars: config.issueJournalMaxChars,
          });
        }
        shouldReleaseIssueLock = false;
        await issueLock.release();
        return { kind: "restart" };
      }
    }

    const clarificationBlock = findHighRiskBlockingAmbiguity(issue);
    if (clarificationBlock) {
      const journalContext = await ensureRecordJournalContext(record);
      const failureContext = buildClarificationFailureContext(
        issue,
        clarificationBlock.reason,
        clarificationBlock.ambiguityClasses,
        clarificationBlock.riskyChangeClasses,
      );
      const blockedRecord = stateStore.touch(record, {
        ...journalContext,
        state: "blocked",
        last_error: truncate(`Needs manual clarification: ${clarificationBlock.reason}.`, 1000),
        last_failure_kind: null,
        last_failure_context: failureContext,
        ...applyFailureSignature(record, failureContext),
        blocked_reason: "clarification",
      });
      state.issues[String(blockedRecord.issue_number)] = blockedRecord;
      state.activeIssueNumber = null;
      await stateStore.save(state);
      if (blockedRecord.journal_path) {
        await syncIssueJournalImpl({
          issue,
          record: blockedRecord,
          journalPath: blockedRecord.journal_path,
          maxChars: config.issueJournalMaxChars,
        });
      }
      shouldReleaseIssueLock = false;
      await issueLock.release();
      return { kind: "restart" };
    }

    const candidateIssues = await github.listCandidateIssues();
    const blockingIssue = findBlockingIssue(issue, candidateIssues, state);
    if (blockingIssue) {
      record = stateStore.touch(record, {
        state: "queued",
        last_error: `Waiting for ${blockingIssue.reason} before continuing issue #${record.issue_number}.`,
      });
      state.issues[String(record.issue_number)] = record;
      state.activeIssueNumber = null;
      await stateStore.save(state);
      shouldReleaseIssueLock = false;
      await issueLock.release();
      return { kind: "restart" };
    }

    shouldReleaseIssueLock = false;
    return {
      kind: "ready",
      record,
      issue,
      issueLock,
    };
  } catch (error) {
    if (shouldReleaseIssueLock) {
      await issueLock.release();
    }
    throw error;
  }
}

export {
  createIssueRecord,
  isEligibleForSelection,
  shouldEnforceExecutionReady,
};
