import {
  CodexExecutionTarget,
  IssueRunRecord,
  CodexModelCapabilitySource,
  CodexModelRouteSource,
  CodexModelStrategy,
  CodexTargetModelRoute,
  ReasoningEffort,
  ReasoningEffortFallbackReason,
  RunState,
  SupervisorConfig,
} from "../core/types";
import {
  codexConnectorStableSameFileChurnSignature,
  isCodexConnectorStableSameFileChurn,
} from "../codex-connector-review-churn";

const NON_DELEGATING_REASONING_ORDER: ReasoningEffort[] = ["none", "low", "medium", "high", "xhigh", "max"];
const REASONING_ORDER: ReasoningEffort[] = [...NON_DELEGATING_REASONING_ORDER, "ultra"];
const CODEX_MODEL_CATALOG_ALIASES: Readonly<Record<string, string>> = {
  "gpt-5.6": "gpt-5.6-sol",
};

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
  reasoningEffort: ReasoningEffort | null;
  requestedReasoningEffort?: ReasoningEffort;
  reasoningEffortFallbackReason?: ReasoningEffortFallbackReason;
}

export interface CodexExecutionPolicyContext {
  inheritedModel?: string | null;
  reasoningLevelsByModel?: ReadonlyMap<string, ReadonlySet<ReasoningEffort>>;
  modelCapabilitySource?: CodexModelCapabilitySource;
  modelCapabilityFallbackReason?: string | null;
}

export interface CodexModelRoutingDecision {
  target: CodexExecutionTarget;
  strategy: CodexModelStrategy;
  requestedModel: string | null;
  effectiveModel: string | null;
  modelOverride: string | null;
  source: CodexModelRouteSource;
  fallbackSource: CodexModelRouteSource | null;
}

export interface CodexExecutionDecision {
  policy: CodexExecutionPolicy;
  modelRouting: CodexModelRoutingDecision;
  modelCapabilitySource: CodexModelCapabilitySource;
  modelCapabilityFallbackReason: string | null;
}

type CodexExecutionPolicyConfig = Pick<
  SupervisorConfig,
  | "codexModelStrategy"
  | "codexModel"
  | "codexModelRoutingByTarget"
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
  if (effort === "ultra") return effort;
  const index = NON_DELEGATING_REASONING_ORDER.indexOf(effort);
  const nextIndex = Math.min(NON_DELEGATING_REASONING_ORDER.length - 1, Math.max(0, index) + steps);
  return NON_DELEGATING_REASONING_ORDER[nextIndex] ?? effort;
}

function reasoningEffortAtLeast(effort: ReasoningEffort, minimum: ReasoningEffort): ReasoningEffort {
  const index = Math.max(REASONING_ORDER.indexOf(effort), REASONING_ORDER.indexOf(minimum));
  return REASONING_ORDER[index] ?? effort;
}

function supportsMaxReasoningEffort(
  model: string | null,
): boolean {
  const normalized = model?.trim().toLowerCase();
  return normalized === "gpt-5.6-sol" || normalized?.startsWith("gpt-5.6-sol-") === true;
}

function resolveCatalogReasoningLevels(
  model: string,
  reasoningLevelsByModel: ReadonlyMap<string, ReadonlySet<ReasoningEffort>>,
): ReadonlySet<ReasoningEffort> | undefined {
  const exact = reasoningLevelsByModel.get(model);
  if (exact) return exact;

  const namespaceSeparator = model.indexOf("/");
  const lookupModel = namespaceSeparator > 0 && namespaceSeparator === model.lastIndexOf("/")
    ? model.slice(namespaceSeparator + 1)
    : model;
  const namespacedExact = reasoningLevelsByModel.get(lookupModel);
  if (namespacedExact) return namespacedExact;

  const aliasedModel = CODEX_MODEL_CATALOG_ALIASES[lookupModel];
  const aliasedExact = aliasedModel ? reasoningLevelsByModel.get(aliasedModel) : undefined;
  if (aliasedExact) return aliasedExact;

  let longestPrefix: string | null = null;
  for (const catalogModel of reasoningLevelsByModel.keys()) {
    if (
      lookupModel.startsWith(`${catalogModel}-`)
      && (longestPrefix === null || catalogModel.length > longestPrefix.length)
    ) {
      longestPrefix = catalogModel;
    }
  }
  return longestPrefix === null ? undefined : reasoningLevelsByModel.get(longestPrefix);
}

function clampReasoningEffortForModel(
  model: string | null,
  effort: ReasoningEffort,
  target: CodexExecutionTarget,
  reasoningLevelsByModel?: ReadonlyMap<string, ReadonlySet<ReasoningEffort>>,
  capabilitySource?: CodexModelCapabilitySource,
  capabilityFallbackReason?: string | null,
): Pick<CodexExecutionPolicy, "reasoningEffort" | "reasoningEffortFallbackReason"> & {
  modelCapabilitySource: CodexModelCapabilitySource;
  modelCapabilityFallbackReason: string | null;
} {
  const normalized = model?.trim().toLowerCase();
  const supported = normalized && reasoningLevelsByModel
    ? resolveCatalogReasoningLevels(normalized, reasoningLevelsByModel)
    : undefined;
  const capabilityResolution: {
    modelCapabilitySource: CodexModelCapabilitySource;
    modelCapabilityFallbackReason: string | null;
  } = capabilitySource === "fallback"
    ? {
        modelCapabilitySource: "fallback",
        modelCapabilityFallbackReason: capabilityFallbackReason ?? "catalog_probe_unavailable",
      }
    : !normalized
      ? {
          modelCapabilitySource: "fallback",
          modelCapabilityFallbackReason: "effective_model_unresolved",
        }
      : supported !== undefined
        ? {
            modelCapabilitySource: "live_catalog",
            modelCapabilityFallbackReason: null,
          }
        : reasoningLevelsByModel
          ? {
              modelCapabilitySource: "fallback",
              modelCapabilityFallbackReason: "model_not_in_catalog",
            }
          : {
              modelCapabilitySource: "fallback",
              modelCapabilityFallbackReason: capabilityFallbackReason ?? "capability_catalog_unavailable",
            };
  const withCapability = (
    resolution: Pick<CodexExecutionPolicy, "reasoningEffort" | "reasoningEffortFallbackReason">,
  ): Pick<CodexExecutionPolicy, "reasoningEffort" | "reasoningEffortFallbackReason"> & typeof capabilityResolution => ({
    ...resolution,
    ...capabilityResolution,
  });

  if (effort === "ultra") {
    if (target === "supervisor" && supported?.has("ultra")) {
      return withCapability({ reasoningEffort: "ultra" });
    }

    let fallbackEffort: ReasoningEffort | null = null;
    if (supported) {
      for (let index = NON_DELEGATING_REASONING_ORDER.length - 1; index >= 0; index -= 1) {
        const candidate = NON_DELEGATING_REASONING_ORDER[index];
        if (candidate && supported.has(candidate)) {
          fallbackEffort = candidate;
          break;
        }
      }
    } else {
      fallbackEffort = clampReasoningEffortForModel(model, "max", target).reasoningEffort;
    }

    return withCapability({
      reasoningEffort: fallbackEffort,
      reasoningEffortFallbackReason: target === "supervisor"
        ? "unsupported_reasoning_effort"
        : "nested_delegation_blocked",
    });
  }

  if (supported) {
    if (supported.size === 0) {
      return withCapability({
        reasoningEffort: null,
        reasoningEffortFallbackReason: "unsupported_reasoning_effort",
      });
    }
    if (supported.has(effort)) return withCapability({ reasoningEffort: effort });

    const requestedIndex = NON_DELEGATING_REASONING_ORDER.indexOf(effort);
    for (let index = requestedIndex - 1; index >= 0; index -= 1) {
      const candidate = NON_DELEGATING_REASONING_ORDER[index];
      if (candidate && supported.has(candidate)) {
        return withCapability({
          reasoningEffort: candidate,
          reasoningEffortFallbackReason: "unsupported_reasoning_effort",
        });
      }
    }
    for (let index = requestedIndex + 1; index < NON_DELEGATING_REASONING_ORDER.length; index += 1) {
      const candidate = NON_DELEGATING_REASONING_ORDER[index];
      if (candidate && supported.has(candidate)) {
        return withCapability({
          reasoningEffort: candidate,
          reasoningEffortFallbackReason: "unsupported_reasoning_effort",
        });
      }
    }
    return withCapability({
      reasoningEffort: null,
      reasoningEffortFallbackReason: "unsupported_reasoning_effort",
    });
  }

  let clamped = effort;
  if (effort === "max") {
    if (supportsMaxReasoningEffort(model)) {
      clamped = "max";
    } else {
      clamped = model?.toLowerCase().includes("gpt-5-pro") ? "high" : "xhigh";
    }
  } else if (model) {
    const normalized = model.toLowerCase();
    if (normalized.includes("gpt-5-pro")) {
      clamped = effort === "xhigh" ? "high" : effort;
    } else if (
      normalized.includes("gpt-5.3-codex") ||
      normalized.includes("gpt-5.2-codex") ||
      normalized.includes("gpt-5.1-codex") ||
      normalized.includes("codex")
    ) {
      clamped = effort === "none" ? "low" : effort;
    }
  }

  return withCapability({
    reasoningEffort: clamped,
    ...(clamped === effort ? {} : { reasoningEffortFallbackReason: "unsupported_reasoning_effort" as const }),
  });
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

function inheritedHostRoute(
  target: CodexExecutionTarget,
  inheritedModel: string | null,
): CodexModelRoutingDecision {
  return {
    target,
    strategy: "inherit",
    requestedModel: null,
    effectiveModel: inheritedModel,
    modelOverride: null,
    source: inheritedModel ? "inherited_host_default" : "inherited_host_default_unresolved",
    fallbackSource: null,
  };
}

function resolveRouteConfig(
  target: CodexExecutionTarget,
  route: CodexTargetModelRoute,
  inheritedRoute: CodexModelRoutingDecision,
  source: CodexModelRouteSource,
  inheritSource: CodexModelRouteSource = source,
): CodexModelRoutingDecision {
  if (route.strategy === "inherit") {
    return {
      target,
      strategy: "inherit",
      requestedModel: null,
      effectiveModel: inheritedRoute.effectiveModel,
      modelOverride: inheritedRoute.modelOverride,
      source: inheritSource,
      fallbackSource: inheritedRoute.source,
    };
  }

  return {
    target,
    strategy: route.strategy,
    requestedModel: route.model,
    effectiveModel: route.model,
    modelOverride: route.model,
    source,
    fallbackSource: null,
  };
}

function resolveSupervisorBaseRoute(
  config: Pick<
    SupervisorConfig,
    | "codexModelStrategy"
    | "codexModel"
    | "codexModelRoutingByTarget"
  >,
  inheritedModel: string | null,
): CodexModelRoutingDecision {
  const hostRoute = inheritedHostRoute("supervisor", inheritedModel);
  const configuredRoute = config.codexModelRoutingByTarget?.supervisor;
  if (configuredRoute) {
    return resolveRouteConfig(
      "supervisor",
      configuredRoute,
      hostRoute,
      "per_target_override",
    );
  }

  if (config.codexModelStrategy === "inherit") {
    return hostRoute;
  }

  const model = config.codexModel ?? null;
  return {
    target: "supervisor",
    strategy: config.codexModelStrategy,
    requestedModel: model,
    effectiveModel: model,
    modelOverride: model,
    source: "supervisor_config",
    fallbackSource: null,
  };
}

export function resolveCodexModelRouting(
  config: Pick<
    SupervisorConfig,
    | "codexModelStrategy"
    | "codexModel"
    | "codexModelRoutingByTarget"
    | "boundedRepairModelStrategy"
    | "boundedRepairModel"
    | "localReviewModelStrategy"
    | "localReviewModel"
  >,
  state: RunState,
  target: CodexExecutionTarget,
  inheritedModel: string | null = null,
): CodexModelRoutingDecision {
  const supervisorRoute = resolveSupervisorBaseRoute(config, inheritedModel);

  if (usesBoundedRepairRouting(state, target)) {
    if (config.boundedRepairModelStrategy) {
      const route: CodexTargetModelRoute = config.boundedRepairModelStrategy === "inherit"
        ? { strategy: "inherit" }
        : {
            strategy: config.boundedRepairModelStrategy,
            model: config.boundedRepairModel ?? "",
          };
      return resolveRouteConfig(
        target,
        route,
        supervisorRoute,
        "bounded_repair_override",
        "default_route",
      );
    }
    return resolveRouteConfig(
      target,
      { strategy: "inherit" },
      supervisorRoute,
      "default_route",
    );
  }

  if (target === "supervisor") {
    return supervisorRoute;
  }

  const configuredRoute = config.codexModelRoutingByTarget?.[target];
  if (configuredRoute) {
    return resolveRouteConfig(
      target,
      configuredRoute,
      supervisorRoute,
      "per_target_override",
    );
  }

  if (target === "local_review_generic" && config.localReviewModelStrategy) {
    const legacyRoute: CodexTargetModelRoute = config.localReviewModelStrategy === "inherit"
      ? { strategy: "inherit" }
      : {
          strategy: config.localReviewModelStrategy,
          model: config.localReviewModel ?? "",
        };
    return resolveRouteConfig(
      target,
      legacyRoute,
      supervisorRoute,
      "local_review_override",
      "default_route",
    );
  }

  return resolveRouteConfig(
    target,
    { strategy: "inherit" },
    supervisorRoute,
    "default_route",
  );
}

export function resolveCodexExecutionDecision(
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
): CodexExecutionDecision {
  const modelRouting = resolveCodexModelRouting(
    config,
    state,
    target,
    context.inheritedModel ?? null,
  );
  const requestedEffort = resolveRequestedReasoningEffort(config, state, record);
  const reasoningResolution = clampReasoningEffortForModel(
    modelRouting.effectiveModel,
    requestedEffort,
    target,
    context.reasoningLevelsByModel,
    context.modelCapabilitySource,
    context.modelCapabilityFallbackReason,
  );
  return {
    policy: {
      model: modelRouting.modelOverride,
      reasoningEffort: reasoningResolution.reasoningEffort,
      ...(reasoningResolution.reasoningEffort === requestedEffort ? {} : { requestedReasoningEffort: requestedEffort }),
      ...(reasoningResolution.reasoningEffortFallbackReason
        ? { reasoningEffortFallbackReason: reasoningResolution.reasoningEffortFallbackReason }
        : {}),
    },
    modelRouting,
    modelCapabilitySource: reasoningResolution.modelCapabilitySource,
    modelCapabilityFallbackReason: reasoningResolution.modelCapabilityFallbackReason,
  };
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
  return resolveCodexExecutionDecision(config, state, record, target, context).policy;
}

export function buildCodexConfigOverrideArgs(policy: CodexExecutionPolicy): string[] {
  const args: string[] = [];
  if (policy.model) {
    args.push("-m", policy.model);
  }

  if (policy.reasoningEffort !== null) {
    args.push("-c", `model_reasoning_effort="${policy.reasoningEffort}"`);
  }
  return args;
}

export function buildCodexExecutionSafetyArgs(
  config: Pick<SupervisorConfig, "executionSafetyMode">,
): string[] {
  return config.executionSafetyMode === "operator_gated"
    ? []
    : ["--dangerously-bypass-approvals-and-sandbox"];
}
