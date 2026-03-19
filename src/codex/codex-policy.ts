import { CodexExecutionTarget, IssueRunRecord, ReasoningEffort, RunState, SupervisorConfig } from "../core/types";

const REASONING_ORDER: ReasoningEffort[] = ["none", "low", "medium", "high", "xhigh"];

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
}

function bumpReasoningEffort(effort: ReasoningEffort, steps = 1): ReasoningEffort {
  const index = REASONING_ORDER.indexOf(effort);
  const nextIndex = Math.min(REASONING_ORDER.length - 1, Math.max(0, index) + steps);
  return REASONING_ORDER[nextIndex] ?? effort;
}

function clampReasoningEffortForModel(model: string | null, effort: ReasoningEffort): ReasoningEffort {
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
  config: SupervisorConfig,
  state: RunState,
  record?: Pick<IssueRunRecord, "repeated_failure_signature_count" | "blocked_verification_retry_count" | "timeout_retry_count"> | null,
): ReasoningEffort {
  const configured = config.codexReasoningEffortByState[state];
  let effort = configured ?? DEFAULT_REASONING_BY_STATE[state];

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

function resolveConfiguredModel(config: SupervisorConfig, target: CodexExecutionTarget): string | null {
  if (target === "local_review_generic" && config.localReviewModelStrategy) {
    if (config.localReviewModelStrategy === "inherit") {
      return null;
    }

    return config.localReviewModel ?? null;
  }

  if (config.codexModelStrategy === "inherit") {
    return null;
  }

  return config.codexModel ?? null;
}

export function resolveCodexExecutionPolicy(
  config: SupervisorConfig,
  state: RunState,
  record?: Pick<IssueRunRecord, "repeated_failure_signature_count" | "blocked_verification_retry_count" | "timeout_retry_count"> | null,
  target: CodexExecutionTarget = "supervisor",
): CodexExecutionPolicy {
  const model = resolveConfiguredModel(config, target);
  const requestedEffort = resolveRequestedReasoningEffort(config, state, record);
  const reasoningEffort = clampReasoningEffortForModel(model, requestedEffort);
  return {
    model,
    reasoningEffort,
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
