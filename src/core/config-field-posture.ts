import type { SupervisorConfig } from "./types";

export const CONFIG_FIELD_POSTURE_TIERS = [
  "required",
  "recommended",
  "advanced",
  "dangerous_explicit_opt_in",
] as const;

export type ConfigFieldPostureTier = (typeof CONFIG_FIELD_POSTURE_TIERS)[number];
export type ConfigFieldName = keyof SupervisorConfig;
export type ConfigFieldRequirementScope = "parser_required" | "first_run_setup";

export interface ConfigFieldPostureMetadata {
  field: ConfigFieldName;
  tier: ConfigFieldPostureTier;
  summary: string;
  requirementScope?: ConfigFieldRequirementScope;
}

function required(
  field: ConfigFieldName,
  summary: string,
  requirementScope: ConfigFieldRequirementScope = "parser_required",
): ConfigFieldPostureMetadata {
  return { field, tier: "required", summary, requirementScope };
}

function recommended(field: ConfigFieldName, summary: string): ConfigFieldPostureMetadata {
  return { field, tier: "recommended", summary };
}

function advanced(field: ConfigFieldName, summary: string): ConfigFieldPostureMetadata {
  return { field, tier: "advanced", summary };
}

function dangerousExplicitOptIn(field: ConfigFieldName, summary: string): ConfigFieldPostureMetadata {
  return { field, tier: "dangerous_explicit_opt_in", summary };
}

const CONFIG_FIELD_POSTURE_METADATA_ENTRIES = [
  required("repoPath", "Managed repository path."),
  required("repoSlug", "GitHub owner/repo slug."),
  required("defaultBranch", "Managed repository default branch."),
  required("workspaceRoot", "Per-issue worktree root."),
  required("stateFile", "Durable supervisor state file."),
  required("codexBinary", "Codex CLI executable."),
  required("branchPrefix", "Managed issue branch prefix."),
  required("trustMode", "Explicit first-run trust posture decision.", "first_run_setup"),
  required("executionSafetyMode", "Explicit first-run execution safety decision.", "first_run_setup"),
  required("reviewBotLogins", "Review provider identity source.", "first_run_setup"),

  recommended("codexModelStrategy", "Default Codex model routing posture."),
  recommended("workspacePreparationCommand", "Repo-owned workspace setup contract."),
  recommended("localCiCommand", "Repo-owned local CI contract."),
  recommended("localReviewPosture", "Named local review automation posture."),
  recommended("localReviewEnabled", "Local review gate enablement."),
  recommended("localReviewAutoDetect", "Local review role auto-detection posture."),
  recommended("localReviewPolicy", "Local review merge-gating posture."),
  recommended("trackedPrCurrentHeadLocalReviewRequired", "Current-head local review freshness posture."),

  advanced("stateBackend", "Durable state backend selection."),
  advanced("stateBootstrapFile", "Optional bootstrap state source."),
  advanced("codexModel", "Explicit default Codex model value."),
  advanced("boundedRepairModelStrategy", "Bounded repair model routing override."),
  advanced("boundedRepairModel", "Bounded repair model value."),
  advanced("localReviewModelStrategy", "Generic local-review model routing override."),
  advanced("localReviewModel", "Generic local-review model value."),
  advanced("codexReasoningEffortByState", "Per-state Codex reasoning effort policy."),
  advanced("codexReasoningEscalateOnRepeatedFailure", "Repeated-failure reasoning escalation policy."),
  advanced("sharedMemoryFiles", "Additional durable memory files."),
  advanced("gsdEnabled", "GSD workflow integration toggle."),
  advanced("gsdAutoInstall", "GSD auto-install toggle."),
  advanced("gsdInstallScope", "GSD install scope."),
  advanced("gsdCodexConfigDir", "GSD Codex config directory."),
  advanced("gsdPlanningFiles", "GSD planning file list."),
  advanced("localReviewRoles", "Explicit local review role list."),
  advanced("localReviewArtifactDir", "Local review artifact directory."),
  advanced("localReviewConfidenceThreshold", "Global local review confidence threshold."),
  advanced("localReviewReviewerThresholds", "Per-reviewer local review thresholds."),
  advanced("publishablePathAllowlistMarkers", "Publishable path hygiene allowlist markers."),
  advanced("humanReviewBlocksMerge", "Human review merge-blocking policy."),
  advanced("issueJournalRelativePath", "Per-issue journal path template."),
  advanced("issueJournalMaxChars", "Issue journal compaction threshold."),
  advanced("issueLabel", "Runnable issue label."),
  advanced("issueSearch", "Runnable issue search query."),
  advanced("localCiCandidateDismissed", "Acknowledged local CI candidate dismissal."),
  advanced("candidateDiscoveryFetchWindow", "Issue discovery fetch window."),
  advanced("skipTitlePrefixes", "Runnable issue title skip prefixes."),
  advanced("pollIntervalSeconds", "Supervisor loop poll cadence."),
  advanced("mergeCriticalRecheckSeconds", "Merge-critical recheck cadence."),
  advanced("copilotReviewWaitMinutes", "Copilot review wait timeout."),
  advanced("copilotReviewTimeoutAction", "Copilot review timeout action."),
  advanced("configuredBotRateLimitWaitMinutes", "Configured-bot rate-limit wait."),
  advanced("configuredBotInitialGraceWaitSeconds", "Configured-bot initial grace wait."),
  advanced("configuredBotSettledWaitSeconds", "Configured-bot settle wait."),
  advanced("configuredBotRequireCurrentHeadSignal", "Configured-bot current-head signal requirement."),
  advanced("configuredBotCurrentHeadSignalTimeoutMinutes", "Configured-bot current-head signal timeout."),
  advanced("configuredBotCurrentHeadSignalTimeoutAction", "Configured-bot current-head signal timeout action."),
  advanced("codexExecTimeoutMinutes", "Codex turn timeout."),
  advanced("maxCodexAttemptsPerIssue", "Legacy per-issue Codex attempt limit."),
  advanced("maxImplementationAttemptsPerIssue", "Implementation attempt limit."),
  advanced("maxRepairAttemptsPerIssue", "Repair attempt limit."),
  advanced("timeoutRetryLimit", "Timeout retry limit."),
  advanced("blockedVerificationRetryLimit", "Blocked verification retry limit."),
  advanced("sameBlockerRepeatLimit", "Repeated blocker limit."),
  advanced("sameFailureSignatureRepeatLimit", "Repeated failure signature limit."),
  advanced("maxDoneWorkspaces", "Done workspace retention count."),
  advanced("cleanupDoneWorkspacesAfterHours", "Done workspace retention age."),
  advanced("cleanupOrphanedWorkspacesAfterHours", "Orphaned workspace pruning age gate."),
  advanced("mergeMethod", "GitHub PR merge method."),
  advanced("draftPrAfterAttempt", "Draft PR creation attempt threshold."),

  dangerousExplicitOptIn("localReviewFollowUpRepairEnabled", "Same-PR local-review follow-up repair opt-in."),
  dangerousExplicitOptIn("localReviewManualReviewRepairEnabled", "Same-PR local-review manual-review repair opt-in."),
  dangerousExplicitOptIn("localReviewFollowUpIssueCreationEnabled", "Automated local-review follow-up issue creation opt-in."),
  dangerousExplicitOptIn("localReviewHighSeverityAction", "High-severity local-review autonomous action posture."),
  dangerousExplicitOptIn("staleConfiguredBotReviewPolicy", "Configured-bot stale-thread reply or resolve behavior."),
  dangerousExplicitOptIn("approvedTrackedTopLevelEntries", "Approved tracked top-level repository skeleton entries."),
] as const;

const CONFIG_FIELD_POSTURE_METADATA_BY_FIELD: Partial<
  Record<ConfigFieldName, Readonly<ConfigFieldPostureMetadata>>
> = {};

for (const entry of CONFIG_FIELD_POSTURE_METADATA_ENTRIES) {
  CONFIG_FIELD_POSTURE_METADATA_BY_FIELD[entry.field] = Object.freeze({ ...entry });
}

export const CONFIG_FIELD_POSTURE_METADATA: Readonly<
  Partial<Record<ConfigFieldName, Readonly<ConfigFieldPostureMetadata>>>
> = Object.freeze(CONFIG_FIELD_POSTURE_METADATA_BY_FIELD);

export function getConfigFieldPostureMetadata(field: string): Readonly<ConfigFieldPostureMetadata> | undefined {
  return CONFIG_FIELD_POSTURE_METADATA[field as ConfigFieldName];
}
