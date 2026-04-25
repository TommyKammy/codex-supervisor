import type { LocalCiFailureClass, LocalCiRemediationTarget } from "./core/types";

export const REMEDIATION_TARGET_WORKSPACE_ENVIRONMENT = "workspace_environment";
export const REMEDIATION_TARGET_CONFIG_CONTRACT = "config_contract";
export const REMEDIATION_TARGET_TRACKED_PUBLISHABLE_CONTENT = "tracked_publishable_content";
export const REMEDIATION_TARGET_REPAIR_ALREADY_QUEUED = "repair_already_queued";
export const REMEDIATION_TARGET_MANUAL_REVIEW = "manual_review";

export function localCiRemediationTargetForFailureClass(
  failureClass: LocalCiFailureClass,
): LocalCiRemediationTarget {
  switch (failureClass) {
    case "workspace_toolchain_missing":
      return REMEDIATION_TARGET_WORKSPACE_ENVIRONMENT;
    case "missing_command":
    case "worktree_helper_missing":
    case "unset_contract":
      return REMEDIATION_TARGET_CONFIG_CONTRACT;
    case "non_zero_exit":
      return REMEDIATION_TARGET_TRACKED_PUBLISHABLE_CONTENT;
  }
}

export function workspacePreparationRemediationTargetForFailureClass(
  failureClass: Exclude<LocalCiFailureClass, "unset_contract"> | null,
): LocalCiRemediationTarget {
  switch (failureClass) {
    case "missing_command":
    case "worktree_helper_missing":
      return REMEDIATION_TARGET_CONFIG_CONTRACT;
    case "workspace_toolchain_missing":
    case "non_zero_exit":
    default:
      return REMEDIATION_TARGET_WORKSPACE_ENVIRONMENT;
  }
}
