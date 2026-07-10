import { CodexExecutionTarget, IssueRunRecord, ReasoningEffort, RunState, SupervisorConfig } from "../core/types";
import {
  codexConnectorStableSameFileChurnSignature,
  isCodexConnectorStableSameFileChurn,
} from "../codex-connector-review-churn";

const REASONING_ORDER: ReasoningEffort[] = ["none", "low", "medium", "high", "xhigh", "max"];

const DEFAULT_REASONING_BY_STATE: Record<RunState, ReasoningEffort> = {
  queued: "low",
  planning: "low",
  reproducing: "medium",
  implementing: "high",
  local_review_fix: "medium",
  stabilizing: "medium",
  draft_pr: "low",
  local_review: "low",
  pr_open: "low",
  repairing_ci: "medium",
  resolving_conflict: "high",
  waiting_ci: "low",
  addressing_review: "medium",
  ready_to_merge: "low",
  merging: "low",
  done: "low",
  blocked: "low",
  failed: "low",
};

export interface CodexExecutionPolicy {
  model: string | null;
  reasoningEffort: ReasoningEffort;
  requestedReasoningEffort?: ReasoningEffort;
}

export interface CodexExecutionPolicyContext {
  inheritedModel?: string | null;
}

type CodexExecutionPolicyConfig = Pick<
  SupervisorConfig,
  | "codexModelStrategy"
  | "codexModel"
  | "boundedRepairModelStrategy"
  | "boundedRepairModel"
  | "localReviewModelStrategy"
  | "localReviewModel"
  | "codexReasoningEffortByState"
  | "codexReasoningEscalateOnRepeatedFailure"
>;

function activeStableSameFileChurnDossierSignature(
  record?: Pick<
    IssueRunRecord,
    "last_tracked_pr_progress_snapshot" | "codex_connector_stable_churn_dossier_consumed_signature"
  > | null,
): string | null {
  if (!record?.last_tracked_pr_progress_snapshot) {
    return null;
  }

  try {
    const parsed = JSON.parse(record.last_tracked_pr_progress_snapshot) as {
      codexConnectorStableSameFileChurn?: unknown;
    };
    const stable = parsed.codexConnectorStableSameFileChurn;
    if (!isCodexConnectorStableSameFileChurn(stable)) {
      return null;
    }

    const signature = codexConnectorStableSameFileChurnSignature(stable);
    return signature === record.codex_connector_stable_churn_dossier_consumed_signature ? null : signature;
  } catch {
    return null;
  }
}

function bumpReasoningEffort(effort: ReasoningEffort, steps = 1): ReasoningEffort {
  const index = REASONING_ORDER.indexOf(effort);
  const nextIndex = Math.min(REASONING_ORDER.length - 1, Math.max(0, index) + steps);
  return REASONING_ORDER[nextIndex] ?? effort;
}

function reasoningEffortAtLeast(effort: ReasoningEffort, minimum: ReasoningEffort): ReasoningEffort {
  const index = Math.max(REASONING_ORDER.indexOf(effort), REASONING_ORDER.indexOf(minimum));
  return REASONING_ORDER[index] ?? effort;
}

function supportsMaxReasoningEffort(model: string | null): boolean {
  const normalized = model?.trim().toLowerCase();
  return normalized === "gpt-5.6-sol" || normalized?.startsWith("gpt-5.6-sol-") === true;
}

function clampReasoningEffortForModel(model: string | null, effort: ReasoningEffort): ReasoningEffort {
  if (effort === "max") {
    if (supportsMaxReasoningEffort(model)) {
      return "max";
    }

    return model?.toLowerCase().includes("gpt-5-pro") ? "high" : "xhigh";
  }

  if (!model) {
    return effort;
  }

  const normalized = model.toLowerCase();
  if (normalized.includes("gpt-5-pro")) {
    return effort === "xhigh" ? "high" : effort;
  }

  if (
    normalized.includes("gpt-5.3-codex") ||
    normalized.includes("gpt-5.2-codex") ||
    normalized.includes("gpt-5.1-codex") ||
    normalized.includes("codex")
  ) {
    return effort === "none" ? "low" : effort;
  }

  return effort;
}

function resolveRequestedReasoningEffort(
  config: Pick<SupervisorConfig, "codexReasoningEffortByState" | "codexReasoningEscalateOnRepeatedFailure">,
  state: RunState,
  record?: Pick<
    IssueRunRecord,
    | "repeated_failure_signature_count"
    | "blocked_verification_retry_count"
    | "timeout_retry_count"
    | "last_tracked_pr_progress_snapshot"
    | "codex_connector_stable_churn_dossier_consumed_signature"
  > | null,
): ReasoningEffort {
  const configured = config.codexReasoningEffortByState[state];
  let effort = configured ?? DEFAULT_REASONING_BY_STATE[state];

  if (state === "addressing_review" && activeStableSameFileChurnDossierSignature(record)) {
    return reasoningEffortAtLeast(effort, "xhigh");
  }

  if (
    config.codexReasoningEscalateOnRepeatedFailure &&
    record &&
    (record.repeated_failure_signature_count > 0 ||
      record.blocked_verification_retry_count > 0 ||
      record.timeout_retry_count > 0)
  ) {
    effort = bumpReasoningEffort(effort, 1);
  }

  return effort;
}

function usesBoundedRepairRouting(state: RunState, target: CodexExecutionTarget): boolean {
  return target === "supervisor" && (state === "repairing_ci" || state === "addressing_review");
}

function resolveConfiguredModel(
  config: Pick<
    SupervisorConfig,
    | "codexModelStrategy"
    | "codexModel"
    | "boundedRepairModelStrategy"
    | "boundedRepairModel"
    | "localReviewModelStrategy"
    | "localReviewModel"
  >,
  state: RunState,
  target: CodexExecutionTarget,
): string | null {
  const defaultModel = config.codexModelStrategy === "inherit" ? null : (config.codexModel ?? null);

  if (target === "local_review_generic" && config.localReviewModelStrategy) {
    if (config.localReviewModelStrategy === "inherit") {
      return defaultModel;
    }

    return config.localReviewModel ?? null;
  }

  if (usesBoundedRepairRouting(state, target) && config.boundedRepairModelStrategy) {
    if (config.boundedRepairModelStrategy === "inherit") {
      return defaultModel;
    }

    return config.boundedRepairModel ?? null;
  }

  return defaultModel;
}

export function resolveCodexExecutionPolicy(
  config: CodexExecutionPolicyConfig,
  state: RunState,
  record?: Pick<
    IssueRunRecord,
    | "repeated_failure_signature_count"
    | "blocked_verification_retry_count"
    | "timeout_retry_count"
    | "last_tracked_pr_progress_snapshot"
    | "codex_connector_stable_churn_dossier_consumed_signature"
  > | null,
  target: CodexExecutionTarget = "supervisor",
  context: CodexExecutionPolicyContext = {},
): CodexExecutionPolicy {
  const model = resolveConfiguredModel(config, state, target);
  const requestedEffort = resolveRequestedReasoningEffort(config, state, record);
  const reasoningEffort = clampReasoningEffortForModel(model ?? context.inheritedModel ?? null, requestedEffort);
  return {
    model,
    reasoningEffort,
    ...(reasoningEffort === requestedEffort ? {} : { requestedReasoningEffort: requestedEffort }),
  };
}

export function buildCodexConfigOverrideArgs(policy: CodexExecutionPolicy): string[] {
  const args: string[] = [];
  if (policy.model) {
    args.push("-m", policy.model);
  }

  args.push("-c", `model_reasoning_effort="${policy.reasoningEffort}"`);
  return args;
}

export function buildCodexExecutionSafetyArgs(
  config: Pick<SupervisorConfig, "executionSafetyMode">,
): string[] {
  return config.executionSafetyMode === "operator_gated"
    ? []
    : ["--dangerously-bypass-approvals-and-sandbox"];
}
