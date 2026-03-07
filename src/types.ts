export type RunState =
  | "queued"
  | "planning"
  | "reproducing"
  | "implementing"
  | "stabilizing"
  | "draft_pr"
  | "pr_open"
  | "repairing_ci"
  | "resolving_conflict"
  | "waiting_ci"
  | "addressing_review"
  | "ready_to_merge"
  | "merging"
  | "done"
  | "blocked"
  | "failed";

export interface SupervisorConfig {
  repoPath: string;
  repoSlug: string;
  defaultBranch: string;
  workspaceRoot: string;
  stateBackend: "json" | "sqlite";
  stateFile: string;
  stateBootstrapFile?: string;
  codexBinary: string;
  sharedMemoryFiles: string[];
  issueJournalRelativePath: string;
  issueJournalMaxChars: number;
  issueLabel?: string;
  issueSearch?: string;
  skipTitlePrefixes: string[];
  branchPrefix: string;
  pollIntervalSeconds: number;
  copilotReviewWaitMinutes: number;
  codexExecTimeoutMinutes: number;
  maxCodexAttemptsPerIssue: number;
  timeoutRetryLimit: number;
  blockedVerificationRetryLimit: number;
  sameBlockerRepeatLimit: number;
  sameFailureSignatureRepeatLimit: number;
  cleanupDoneWorkspacesAfterHours: number;
  mergeMethod: "merge" | "squash" | "rebase";
  draftPrAfterAttempt: number;
}

export type FailureKind = "timeout" | "command_error" | "codex_exit" | "codex_failed" | null;

export type FailureContextCategory =
  | "checks"
  | "review"
  | "conflict"
  | "codex"
  | "manual"
  | "blocked"
  | null;

export type BlockedReason =
  | "requirements"
  | "permissions"
  | "secrets"
  | "verification"
  | "manual_pr_closed"
  | "handoff_missing"
  | "unknown"
  | null;

export interface FailureContext {
  category: FailureContextCategory;
  summary: string;
  signature: string | null;
  command: string | null;
  details: string[];
  url: string | null;
  updated_at: string;
}

export interface IssueRunRecord {
  issue_number: number;
  state: RunState;
  branch: string;
  pr_number: number | null;
  workspace: string;
  journal_path: string | null;
  review_wait_started_at: string | null;
  review_wait_head_sha: string | null;
  codex_session_id: string | null;
  attempt_count: number;
  timeout_retry_count: number;
  blocked_verification_retry_count: number;
  repeated_blocker_count: number;
  repeated_failure_signature_count: number;
  last_head_sha: string | null;
  last_codex_summary: string | null;
  last_error: string | null;
  last_failure_kind: FailureKind;
  last_failure_context: FailureContext | null;
  last_blocker_signature: string | null;
  last_failure_signature: string | null;
  blocked_reason: BlockedReason;
  processed_review_thread_ids: string[];
  updated_at: string;
}

export interface SupervisorStateFile {
  activeIssueNumber: number | null;
  issues: Record<string, IssueRunRecord>;
}

export interface GitHubLabel {
  name: string;
}

export interface GitHubIssue {
  number: number;
  title: string;
  body: string;
  createdAt: string;
  updatedAt: string;
  url: string;
  labels?: GitHubLabel[];
  state?: string;
}

export interface GitHubPullRequest {
  number: number;
  title: string;
  url: string;
  state: string;
  createdAt: string;
  updatedAt?: string;
  isDraft: boolean;
  reviewDecision: string | null;
  mergeStateStatus: string | null;
  mergeable?: string | null;
  headRefName: string;
  headRefOid: string;
  mergedAt?: string | null;
}

export interface PullRequestCheck {
  name: string;
  state: string;
  bucket: "pass" | "fail" | "pending" | "skipping" | "cancel" | string;
  workflow?: string;
  link?: string;
}

export interface ReviewThreadComment {
  id: string;
  body: string;
  createdAt: string;
  url: string;
  author: {
    login: string | null;
  } | null;
}

export interface ReviewThread {
  id: string;
  isResolved: boolean;
  isOutdated: boolean;
  path: string | null;
  line: number | null;
  comments: {
    nodes: ReviewThreadComment[];
  };
}

export interface WorkspaceStatus {
  branch: string;
  headSha: string;
  hasUncommittedChanges: boolean;
  baseAhead: number;
  baseBehind: number;
  remoteBranchExists: boolean;
  remoteAhead: number;
  remoteBehind: number;
}

export interface CodexTurnResult {
  exitCode: number;
  sessionId: string | null;
  lastMessage: string;
  stderr: string;
  stdout: string;
}

export interface CliOptions {
  command: "run-once" | "loop" | "status";
  configPath?: string;
  dryRun: boolean;
}
