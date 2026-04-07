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
export type CodexExecutionTarget = "supervisor" | "local_review_generic" | "local_review_specialist" | "local_review_verifier";

export type ReasoningEffort = "none" | "low" | "medium" | "high" | "xhigh";
export type TrustMode = "trusted_repo_and_authors" | "untrusted_or_mixed";
export type ExecutionSafetyMode = "unsandboxed_autonomous" | "operator_gated";
export type LocalReviewPolicy = "advisory" | "block_ready" | "block_merge";
export type LocalReviewHighSeverityAction = "retry" | "blocked";
export type CopilotReviewState = "not_requested" | "requested" | "arrived";
export type PullRequestHydrationProvenance = "fresh" | "cached";
export type CopilotReviewTimeoutAction = "continue" | "block";
export type ConfiguredReviewProviderKind = "copilot" | "codex" | "coderabbit" | "custom";
export type ConfiguredReviewSignalSource = "copilot_lifecycle" | "review_threads";

export interface ConfiguredReviewProvider {
  kind: ConfiguredReviewProviderKind;
  reviewerLogins: string[];
  signalSource: ConfiguredReviewSignalSource;
}

export interface TrustDiagnosticsSummary {
  trustMode: TrustMode;
  executionSafetyMode: ExecutionSafetyMode;
  warning: string | null;
  configWarning?: string | null;
}

export interface CadenceDiagnosticsSummary {
  pollIntervalSeconds: number;
  mergeCriticalRecheckSeconds: number | null;
  mergeCriticalEffectiveSeconds: number;
  mergeCriticalRecheckEnabled: boolean;
}

export type GitHubRateLimitBudgetState = "healthy" | "low" | "exhausted";

export interface GitHubRateLimitBudget {
  resource: string;
  limit: number;
  remaining: number;
  resetAt: string;
  state: GitHubRateLimitBudgetState;
}

export interface GitHubRateLimitTelemetry {
  rest: GitHubRateLimitBudget;
  graphql: GitHubRateLimitBudget;
}

export interface CandidateDiscoveryDiagnostics {
  fetchWindow: number;
  observedMatchingOpenIssues: number;
  truncated: boolean;
}

export interface LocalCiContractSummary {
  configured: boolean;
  command: string | null;
  recommendedCommand: string | null;
  source: "config" | "repo_script_candidate";
  summary: string;
  warning?: string | null;
}

export interface WorkspacePreparationContractSummary {
  configured: boolean;
  command: string | null;
  recommendedCommand: string | null;
  source: "config";
  summary: string;
  warning?: string | null;
}

export interface StructuredLocalCiCommandConfig {
  mode: "structured";
  executable: string;
  args?: string[];
}

export interface ShellLocalCiCommandConfig {
  mode: "shell";
  command: string;
}

export type LocalCiCommandConfig =
  | string
  | StructuredLocalCiCommandConfig
  | ShellLocalCiCommandConfig;

export type LocalCiExecutionMode = "structured" | "shell" | "legacy_shell_string";

export type LocalCiResultOutcome = "passed" | "failed" | "not_configured";
export type LocalCiFailureClass =
  | "missing_command"
  | "workspace_toolchain_missing"
  | "worktree_helper_missing"
  | "non_zero_exit"
  | "unset_contract";
export type LocalCiRemediationTarget =
  | "issue_body"
  | "repo_owned_command"
  | "supervisor_config"
  | "workspace_environment";

export interface LatestLocalCiResult {
  outcome: LocalCiResultOutcome;
  summary: string;
  ran_at: string;
  head_sha: string | null;
  execution_mode: LocalCiExecutionMode | null;
  failure_class: LocalCiFailureClass | null;
  remediation_target: LocalCiRemediationTarget | null;
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
  trustMode?: TrustMode;
  executionSafetyMode?: ExecutionSafetyMode;
  codexModelStrategy: CodexModelStrategy;
  codexModel?: string;
  boundedRepairModelStrategy?: CodexModelStrategy;
  boundedRepairModel?: string;
  localReviewModelStrategy?: CodexModelStrategy;
  localReviewModel?: string;
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
  trackedPrCurrentHeadLocalReviewRequired?: boolean;
  localReviewFollowUpRepairEnabled?: boolean;
  localReviewFollowUpIssueCreationEnabled?: boolean;
  localReviewHighSeverityAction: LocalReviewHighSeverityAction;
  reviewBotLogins: string[];
  configuredReviewProviders?: ConfiguredReviewProvider[];
  humanReviewBlocksMerge: boolean;
  issueJournalRelativePath: string;
  issueJournalMaxChars: number;
  issueLabel?: string;
  issueSearch?: string;
  workspacePreparationCommand?: LocalCiCommandConfig;
  localCiCommand?: LocalCiCommandConfig;
  candidateDiscoveryFetchWindow?: number;
  skipTitlePrefixes: string[];
  branchPrefix: string;
  pollIntervalSeconds: number;
  mergeCriticalRecheckSeconds?: number;
  copilotReviewWaitMinutes: number;
  copilotReviewTimeoutAction: CopilotReviewTimeoutAction;
  configuredBotRateLimitWaitMinutes?: number;
  configuredBotInitialGraceWaitSeconds?: number;
  configuredBotSettledWaitSeconds?: number;
  configuredBotRequireCurrentHeadSignal?: boolean;
  configuredBotCurrentHeadSignalTimeoutMinutes?: number;
  configuredBotCurrentHeadSignalTimeoutAction?: CopilotReviewTimeoutAction;
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
  cleanupOrphanedWorkspacesAfterHours?: number;
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

export interface StateLoadFinding {
  backend: "json" | "sqlite";
  kind: "parse_error";
  scope: "state_file" | "issue_row";
  location: string;
  issue_number: number | null;
  message: string;
}

export interface JsonStateQuarantine {
  kind: "parse_error";
  marker_file: string;
  quarantined_file: string;
  quarantined_at: string;
}

export interface JsonCorruptStateResetResult {
  action: "reset-corrupt-json-state";
  outcome: "mutated" | "rejected";
  summary: string;
  stateFile: string;
  quarantinedFile: string | null;
  quarantinedAt: string | null;
}

export interface InventoryRefreshFailure {
  source: string;
  message: string;
  recorded_at: string;
  classification?: "rate_limited";
  bounded_continuation_allowed?: boolean;
  selection_permitted?: "snapshot_backed";
  diagnostics?: InventoryRefreshDiagnosticEntry[];
}

export interface InventoryRefreshDiagnosticEntry {
  transport: "primary" | "fallback";
  source: string;
  message: string;
  page?: number | null;
  artifact_path?: string | null;
  raw_artifact_path?: string | null;
  preview_artifact_path?: string | null;
  command?: string[];
  parse_stage?: "primary_json_parse" | "fallback_json_parse";
  parse_error?: string;
  stdout_bytes?: number;
  stderr_bytes?: number;
  captured_at?: string;
  working_directory?: string;
}

export interface LastSuccessfulInventorySnapshot {
  source: string;
  recorded_at: string;
  issue_count: number;
  issues: GitHubIssue[];
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
  provider_success_observed_at?: string | null;
  provider_success_head_sha?: string | null;
  merge_readiness_last_evaluated_at?: string | null;
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
  pre_merge_evaluation_outcome?: "mergeable" | "fix_blocked" | "manual_review_blocked" | "follow_up_eligible" | null;
  pre_merge_must_fix_count?: number;
  pre_merge_manual_review_count?: number;
  pre_merge_follow_up_count?: number;
  last_local_review_signature: string | null;
  repeated_local_review_signature_count: number;
  latest_local_ci_result?: LatestLocalCiResult | null;
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
  stale_stabilizing_no_pr_recovery_count?: number;
  last_head_sha: string | null;
  review_follow_up_head_sha?: string | null;
  review_follow_up_remaining?: number;
  workspace_restore_source?: WorkspaceRestoreSource | null;
  workspace_restore_ref?: string | null;
  last_codex_summary: string | null;
  last_recovery_reason: string | null;
  last_recovery_at: string | null;
  last_error: string | null;
  last_failure_kind: FailureKind;
  last_failure_context: FailureContext | null;
  last_runtime_error?: string | null;
  last_runtime_failure_kind?: FailureKind;
  last_runtime_failure_context?: FailureContext | null;
  last_blocker_signature: string | null;
  last_failure_signature: string | null;
  last_tracked_pr_progress_snapshot?: string | null;
  last_tracked_pr_progress_summary?: string | null;
  last_tracked_pr_repeat_failure_decision?: "retry_on_progress" | "stop_no_progress" | null;
  last_host_local_pr_blocker_comment_signature?: string | null;
  last_host_local_pr_blocker_comment_head_sha?: string | null;
  blocked_reason: BlockedReason;
  processed_review_thread_ids: string[];
  processed_review_thread_fingerprints: string[];
  updated_at: string;
}

export interface SupervisorStateFile {
  activeIssueNumber: number | null;
  issues: Record<string, IssueRunRecord>;
  reconciliation_state?: {
    tracked_merged_but_open_last_processed_issue_number?: number | null;
  };
  inventory_refresh_failure?: InventoryRefreshFailure;
  last_successful_inventory_snapshot?: LastSuccessfulInventorySnapshot;
  load_findings?: StateLoadFinding[];
  json_state_quarantine?: JsonStateQuarantine;
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
  configuredBotCurrentHeadStatusState?: string | null;
  currentHeadCiGreenAt?: string | null;
  configuredBotRateLimitedAt?: string | null;
  configuredBotDraftSkipAt?: string | null;
  configuredBotTopLevelReviewStrength?: "nitpick_only" | "blocking" | null;
  configuredBotTopLevelReviewSubmittedAt?: string | null;
  hydrationProvenance?: PullRequestHydrationProvenance | null;
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
  restoreSource?: WorkspaceRestoreSource | null;
  restoreRef?: string | null;
}

export type WorkspaceRestoreSource =
  | "existing_workspace"
  | "local_branch"
  | "remote_branch"
  | "bootstrap_default_branch";

export interface WorkspaceRestoreMetadata {
  source: WorkspaceRestoreSource;
  ref: string;
}

export interface EnsuredWorkspace {
  workspacePath: string;
  restore: WorkspaceRestoreMetadata;
}

export interface CodexTurnResult {
  exitCode: number;
  sessionId: string | null;
  lastMessage: string;
  stderr: string;
  stdout: string;
}

export interface CliOptions {
  command:
    | "run-once"
    | "loop"
    | "status"
    | "requeue"
    | "rollup-execution-metrics"
    | "summarize-post-merge-audits"
    | "prune-orphaned-workspaces"
    | "reset-corrupt-json-state"
    | "explain"
    | "issue-lint"
    | "doctor"
    | "web"
    | "replay"
    | "replay-corpus"
    | "replay-corpus-promote";
  configPath?: string;
  dryRun: boolean;
  why: boolean;
  issueNumber?: number;
  snapshotPath?: string;
  caseId?: string;
  corpusPath?: string;
}
