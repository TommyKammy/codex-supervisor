import type { LocalReviewReviewerThresholdConfig, LocalReviewReviewerType } from "../local-review/types";
import type { RunState } from "./types";

export type CodexModelStrategy = "inherit" | "fixed" | "alias";
export type CodexExecutionTarget = "supervisor" | "local_review_generic" | "local_review_specialist" | "local_review_verifier";

export type ReasoningEffort = "none" | "low" | "medium" | "high" | "xhigh";
export type TrustMode = "trusted_repo_and_authors" | "untrusted_or_mixed";
export type ExecutionSafetyMode = "unsandboxed_autonomous" | "operator_gated";
export type LocalReviewPolicy = "advisory" | "block_ready" | "block_merge";
export type LocalReviewHighSeverityAction = "retry" | "blocked";
export type LocalReviewPosturePreset =
  | "off"
  | "advisory"
  | "block_merge"
  | "repair_high_severity"
  | "follow_up_issue_creation";
export type ReleaseReadinessGatePosture = "advisory" | "block_release_publication";
export type StaleConfiguredBotReviewPolicy = "diagnose_only" | "reply_only" | "reply_and_resolve";
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

export interface CandidateDiscoveryDiagnostics {
  fetchWindow: number;
  observedMatchingOpenIssues: number;
  truncated: boolean;
}

export interface LocalCiContractSummary {
  configured: boolean;
  command: string | null;
  recommendedCommand: string | null;
  source: "config" | "repo_script_candidate" | "dismissed_repo_script_candidate";
  summary: string;
  warning?: string | null;
  adoptionFlow?: LocalCiAdoptionFlow;
}

export interface LocalCiAdoptionDecision {
  kind: "adopt" | "dismiss";
  enabled: boolean;
  summary: string;
  writes: string[];
}

export interface LocalCiAdoptionFlow {
  state: "not_available" | "candidate_detected" | "configured" | "dismissed";
  candidateDetected: boolean;
  commandPreview: string | null;
  validationStatus: "not_available" | "not_run" | "configured" | "dismissed";
  workspacePreparationCommand: string | null;
  workspacePreparationRecommendedCommand: string | null;
  workspacePreparationGuidance: string;
  decisions: LocalCiAdoptionDecision[];
}

export interface WorkspacePreparationContractSummary {
  configured: boolean;
  command: string | null;
  recommendedCommand: string | null;
  source: "config";
  summary: string;
  warning?: string | null;
}

export interface LocalReviewPostureSummary {
  preset: LocalReviewPosturePreset;
  enabled: boolean;
  policy: LocalReviewPolicy;
  autoRepair: "off" | "high_severity_only";
  followUpIssueCreation: boolean;
  summary: string;
  guarantees: string[];
}

export interface ReleaseReadinessGateSummary {
  posture: ReleaseReadinessGatePosture;
  configured: boolean;
  canBlock: Array<"release_publication">;
  cannotBlock: Array<"pr_publication" | "merge_readiness" | "loop_operation" | "release_publication">;
  summary: string;
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
  | "workspace_environment"
  | "config_contract"
  | "tracked_publishable_content"
  | "repair_already_queued"
  | "manual_review";

export interface LatestLocalCiResult {
  outcome: LocalCiResultOutcome;
  summary: string;
  ran_at: string;
  head_sha: string | null;
  execution_mode: LocalCiExecutionMode | null;
  command?: string | null;
  stderr_summary?: string | null;
  failure_class: LocalCiFailureClass | null;
  remediation_target: LocalCiRemediationTarget | null;
  verifier_drift_hint?: string | null;
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
  localReviewPosture?: LocalReviewPosturePreset;
  localReviewAutoDetect: boolean;
  localReviewRoles: string[];
  localReviewArtifactDir: string;
  localReviewConfidenceThreshold: number;
  localReviewReviewerThresholds: Record<LocalReviewReviewerType, LocalReviewReviewerThresholdConfig>;
  localReviewPolicy: LocalReviewPolicy;
  trackedPrCurrentHeadLocalReviewRequired?: boolean;
  localReviewFollowUpRepairEnabled?: boolean;
  localReviewManualReviewRepairEnabled?: boolean;
  localReviewFollowUpIssueCreationEnabled?: boolean;
  localReviewHighSeverityAction: LocalReviewHighSeverityAction;
  releaseReadinessGate?: ReleaseReadinessGatePosture;
  publishablePathAllowlistMarkers?: string[];
  approvedTrackedTopLevelEntries?: string[];
  staleConfiguredBotReviewPolicy?: StaleConfiguredBotReviewPolicy;
  reviewBotLogins: string[];
  configuredReviewProviders?: ConfiguredReviewProvider[];
  humanReviewBlocksMerge: boolean;
  issueJournalRelativePath: string;
  issueJournalMaxChars: number;
  issueLabel?: string;
  issueSearch?: string;
  workspacePreparationCommand?: LocalCiCommandConfig;
  localCiCommand?: LocalCiCommandConfig;
  localCiCandidateDismissed?: boolean;
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
