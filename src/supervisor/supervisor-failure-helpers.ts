import { GitHubClient } from "../github";
import { StateStore } from "../core/state-store";
import {
  FailureContext,
  GitHubIssue,
  GitHubPullRequest,
  IssueRunRecord,
  SupervisorConfig,
  SupervisorStateFile,
  WorkspaceStatus,
} from "../core/types";
import { nowIso, truncate } from "../core/utils";

type AuthFailureGitHub = Pick<GitHubClient, "authStatus">;
type FailureHelperStateStore = Pick<StateStore, "save" | "touch">;

export function classifyFailure(message: string | null | undefined): "timeout" | "command_error" {
  return message?.includes("Command timed out after") ? "timeout" : "command_error";
}

export function normalizeBlockerSignature(message: string | null | undefined): string | null {
  if (!message) {
    return null;
  }

  return message
    .toLowerCase()
    .replace(/\d{4}-\d{2}-\d{2}t\d{2}:\d{2}:\d{2}(?:\.\d+)?z/g, "<ts>")
    .replace(/#\d+/g, "#<n>")
    .replace(/\b[0-9a-f]{7,40}\b/g, "<sha>")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 1000);
}

export function buildCodexFailureContext(
  category: FailureContext["category"],
  summary: string,
  details: string[],
): FailureContext {
  return {
    category,
    summary,
    signature: normalizeBlockerSignature(`${summary}\n${details.join("\n")}`),
    command: null,
    details,
    url: null,
    updated_at: nowIso(),
  };
}

export function applyFailureSignature(
  record: IssueRunRecord,
  failureContext: FailureContext | null,
): Pick<IssueRunRecord, "last_failure_signature" | "repeated_failure_signature_count"> {
  const signature = failureContext?.signature ?? null;
  if (!signature) {
    return {
      last_failure_signature: null,
      repeated_failure_signature_count: 0,
    };
  }

  return {
    last_failure_signature: signature,
    repeated_failure_signature_count:
      record.last_failure_signature === signature ? record.repeated_failure_signature_count + 1 : 1,
  };
}

export function shouldAutoRetryTimeout(record: IssueRunRecord, config: SupervisorConfig): boolean {
  return (
    record.state === "failed" &&
    record.last_failure_kind === "timeout" &&
    record.timeout_retry_count < config.timeoutRetryLimit
  );
}

export function buildAuthFailureContext(message: string): FailureContext {
  return {
    category: "manual",
    summary: "GitHub CLI authentication is unavailable.",
    signature: "gh-auth-unavailable",
    command: "gh auth status --hostname github.com",
    details: [message],
    url: null,
    updated_at: nowIso(),
  };
}

export async function handleAuthFailure(
  github: AuthFailureGitHub,
  stateStore: FailureHelperStateStore,
  state: SupervisorStateFile,
): Promise<string | null> {
  const auth = await github.authStatus();
  if (auth.ok) {
    return null;
  }

  if (state.activeIssueNumber !== null) {
    const activeRecord = state.issues[String(state.activeIssueNumber)];
    if (activeRecord) {
      const failureContext = buildAuthFailureContext(auth.message ?? "GitHub CLI authentication is unavailable.");
      state.issues[String(activeRecord.issue_number)] = stateStore.touch(activeRecord, {
        state: "blocked",
        last_error: truncate(auth.message ?? failureContext.summary, 1000),
        last_failure_kind: "command_error",
        last_failure_context: failureContext,
        ...applyFailureSignature(activeRecord, failureContext),
        blocked_reason: "unknown",
      });
      await stateStore.save(state);
      return `Paused issue #${activeRecord.issue_number}: GitHub auth unavailable.`;
    }
  }

  return `Skipped supervisor cycle: GitHub auth unavailable (${auth.message ?? "gh auth status failed"}).`;
}

export async function recoverUnexpectedCodexTurnFailure(args: {
  stateStore: FailureHelperStateStore;
  state: SupervisorStateFile;
  record: IssueRunRecord;
  issue: GitHubIssue;
  journalSync: (record: IssueRunRecord) => Promise<void>;
  error: unknown;
  workspaceStatus: Pick<WorkspaceStatus, "hasUncommittedChanges" | "headSha"> | null;
  pr: Pick<GitHubPullRequest, "number" | "headRefOid"> | null;
}): Promise<IssueRunRecord> {
  const { stateStore, state, record, issue, journalSync, error, workspaceStatus, pr } = args;
  const message = error instanceof Error ? error.stack ?? error.message : String(error);
  const failureKind = classifyFailure(message);
  const failureContext = buildCodexFailureContext(
    "codex",
    `Supervisor failed while recovering a Codex turn for issue #${record.issue_number}.`,
    [
      `previous_state=${record.state}`,
      `workspace_dirty=${
        workspaceStatus === null ? "unknown" : workspaceStatus.hasUncommittedChanges ? "yes" : "no"
      }`,
      `workspace_head=${workspaceStatus?.headSha ?? record.last_head_sha ?? "unknown"}`,
      `pr_number=${pr?.number ?? "none"}`,
      `pr_head=${pr?.headRefOid ?? "none"}`,
      `codex_session_id=${record.codex_session_id ?? "none"}`,
      truncate(message, 2000) ?? "Unknown failure",
    ],
  );

  const updated = stateStore.touch(record, {
    state: "failed",
    last_error: truncate(message),
    last_failure_kind: failureKind,
    last_failure_context: failureContext,
    ...applyFailureSignature(record, failureContext),
    blocked_reason: null,
    timeout_retry_count:
      failureKind === "timeout" ? record.timeout_retry_count + 1 : record.timeout_retry_count,
  });
  state.issues[String(record.issue_number)] = updated;
  if (state.activeIssueNumber === record.issue_number) {
    state.activeIssueNumber = null;
  }
  await stateStore.save(state);

  try {
    await journalSync(updated);
  } catch (journalError) {
    const journalMessage = journalError instanceof Error ? journalError.message : String(journalError);
    console.warn(
      `Failed to sync issue journal after unexpected Codex turn failure for issue #${issue.number}: ${journalMessage}`,
    );
  }

  return updated;
}
