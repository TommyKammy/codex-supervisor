import type { LocalReviewReviewerThresholdConfig, LocalReviewReviewerType } from "../local-review/types";

export type { LocalReviewReviewerThresholdConfig, LocalReviewReviewerType } from "../local-review/types";

export type RunState =
  | "queued"
  | "planning"
  | "reproducing"
  | "implementing"
  | "local_review_fix"
  | "stabilizing"
  | "draft_pr"
  | "local_review"
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

export type CodexModelStrategy = "inherit" | "fixed" | "alias";

export type ReasoningEffort = "none" | "low" | "medium" | "high" | "xhigh";
export type LocalReviewPolicy = "advisory" | "block_ready" | "block_merge";
export type LocalReviewHighSeverityAction = "retry" | "blocked";
export type CopilotReviewState = "not_requested" | "requested" | "arrived";
export type CopilotReviewTimeoutAction = "continue" | "block";
export type ConfiguredReviewProviderKind = "copilot" | "codex" | "coderabbit" | "custom";
export type ConfiguredReviewSignalSource = "copilot_lifecycle" | "review_threads";

export interface ConfiguredReviewProvider {
  kind: ConfiguredReviewProviderKind;
  reviewerLogins: string[];
  signalSource: ConfiguredReviewSignalSource;
}

export interface SupervisorConfig {
  repoPath: string;
  repoSlug: string;
  defaultBranch: string;
  workspaceRoot: string;
  stateBackend: "json" | "sqlite";
  stateFile: string;
  stateBootstrapFile?: string;
  codexBinary: string;
  codexModelStrategy: CodexModelStrategy;
  codexModel?: string;
  codexReasoningEffortByState: Partial<Record<RunState, ReasoningEffort>>;
  codexReasoningEscalateOnRepeatedFailure: boolean;
  sharedMemoryFiles: string[];
  gsdEnabled: boolean;
  gsdAutoInstall: boolean;
  gsdInstallScope: "global" | "local";
  gsdCodexConfigDir?: string;
  gsdPlanningFiles: string[];
  localReviewEnabled: boolean;
  localReviewAutoDetect: boolean;
  localReviewRoles: string[];
  localReviewArtifactDir: string;
  localReviewConfidenceThreshold: number;
  localReviewReviewerThresholds: Record<LocalReviewReviewerType, LocalReviewReviewerThresholdConfig>;
  localReviewPolicy: LocalReviewPolicy;
  localReviewHighSeverityAction: LocalReviewHighSeverityAction;
  reviewBotLogins: string[];
  configuredReviewProviders?: ConfiguredReviewProvider[];
  humanReviewBlocksMerge: boolean;
  issueJournalRelativePath: string;
  issueJournalMaxChars: number;
  issueLabel?: string;
  issueSearch?: string;
  skipTitlePrefixes: string[];
  branchPrefix: string;
  pollIntervalSeconds: number;
  copilotReviewWaitMinutes: number;
  copilotReviewTimeoutAction: CopilotReviewTimeoutAction;
  configuredBotRateLimitWaitMinutes?: number;
  configuredBotInitialGraceWaitSeconds?: number;
  configuredBotSettledWaitSeconds?: number;
  codexExecTimeoutMinutes: number;
  maxCodexAttemptsPerIssue: number;
  maxImplementationAttemptsPerIssue: number;
  maxRepairAttemptsPerIssue: number;
  timeoutRetryLimit: number;
  blockedVerificationRetryLimit: number;
  sameBlockerRepeatLimit: number;
  sameFailureSignatureRepeatLimit: number;
  maxDoneWorkspaces: number;
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
  | "clarification"
  | "permissions"
  | "secrets"
  | "verification"
  | "review_bot_timeout"
  | "copilot_timeout"
  | "manual_review"
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
  copilot_review_requested_observed_at: string | null;
  copilot_review_requested_head_sha: string | null;
  copilot_review_timed_out_at: string | null;
  copilot_review_timeout_action: CopilotReviewTimeoutAction | null;
  copilot_review_timeout_reason: string | null;
  codex_session_id: string | null;
  local_review_head_sha: string | null;
  local_review_blocker_summary: string | null;
  local_review_summary_path: string | null;
  local_review_run_at: string | null;
  local_review_max_severity: "none" | "low" | "medium" | "high" | null;
  local_review_findings_count: number;
  local_review_root_cause_count: number;
  local_review_verified_max_severity: "none" | "low" | "medium" | "high" | null;
  local_review_verified_findings_count: number;
  local_review_recommendation: "ready" | "changes_requested" | "unknown" | null;
  local_review_degraded: boolean;
  last_local_review_signature: string | null;
  repeated_local_review_signature_count: number;
  external_review_head_sha: string | null;
  external_review_misses_path: string | null;
  external_review_matched_findings_count: number;
  external_review_near_match_findings_count: number;
  external_review_missed_findings_count: number;
  attempt_count: number;
  implementation_attempt_count: number;
  repair_attempt_count: number;
  timeout_retry_count: number;
  blocked_verification_retry_count: number;
  repeated_blocker_count: number;
  repeated_failure_signature_count: number;
  last_head_sha: string | null;
  last_codex_summary: string | null;
  last_recovery_reason: string | null;
  last_recovery_at: string | null;
  last_error: string | null;
  last_failure_kind: FailureKind;
  last_failure_context: FailureContext | null;
  last_blocker_signature: string | null;
  last_failure_signature: string | null;
  blocked_reason: BlockedReason;
  processed_review_thread_ids: string[];
  processed_review_thread_fingerprints: string[];
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
  copilotReviewState?: CopilotReviewState | null;
  copilotReviewRequestedAt?: string | null;
  copilotReviewArrivedAt?: string | null;
  configuredBotCurrentHeadObservedAt?: string | null;
  currentHeadCiGreenAt?: string | null;
  configuredBotRateLimitedAt?: string | null;
  configuredBotDraftSkipAt?: string | null;
  configuredBotTopLevelReviewStrength?: "nitpick_only" | "blocking" | null;
  configuredBotTopLevelReviewSubmittedAt?: string | null;
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
    typeName: string | null;
  } | null;
}

export interface ExternalReviewActor {
  login: string | null;
  typeName: string | null;
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

export interface PullRequestReview {
  id: string;
  body: string | null;
  submittedAt: string | null;
  url: string | null;
  state: string | null;
  author: ExternalReviewActor | null;
}

export interface IssueComment {
  id: string;
  body: string;
  createdAt: string;
  url: string | null;
  author: ExternalReviewActor | null;
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
  command: "run-once" | "loop" | "status" | "explain" | "doctor" | "replay" | "replay-corpus";
  configPath?: string;
  dryRun: boolean;
  why: boolean;
  issueNumber?: number;
  snapshotPath?: string;
  corpusPath?: string;
}
