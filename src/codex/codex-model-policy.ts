import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { resolveCodexExecutionPolicy } from "./codex-policy";
import { CodexExecutionTarget, CodexModelStrategy, IssueRunRecord, RunState, SupervisorConfig } from "../core/types";

export interface HostCodexDefaultModelResolution {
  model: string | null;
  source: string | null;
}

interface CodexModelRouteResolution {
  strategy: CodexModelStrategy;
  configuredModel: string | null;
  effectiveModel: string | null;
  source:
    | "supervisor_config"
    | "bounded_repair_override"
    | "local_review_override"
    | "inherited_host_default"
    | "inherited_host_default_unresolved"
    | "default_route";
}

export interface CodexModelPolicySnapshot {
  hostDefault: HostCodexDefaultModelResolution;
  defaultRoute: CodexModelRouteResolution;
  boundedRepairRoute: CodexModelRouteResolution;
  localReviewRoute: CodexModelRouteResolution;
  activeRoute: CodexModelRouteResolution & {
    state: RunState;
    target: CodexExecutionTarget;
    reasoningEffort: string;
  };
}

function resolveCodexConfigDir(): string {
  if (process.env.CODEX_HOME && process.env.CODEX_HOME.trim() !== "") {
    return path.resolve(process.env.CODEX_HOME);
  }

  return path.join(os.homedir(), ".codex");
}

function parseTopLevelTomlString(contents: string, key: string): string | null {
  let inTopLevel = true;
  for (const rawLine of contents.split(/\r?\n/u)) {
    const line = rawLine.trim();
    if (line.length === 0 || line.startsWith("#")) {
      continue;
    }
    if (line.startsWith("[")) {
      inTopLevel = false;
      continue;
    }
    if (!inTopLevel) {
      continue;
    }
    const match = line.match(new RegExp(`^${key}\\s*=\\s*(['"])(.*?)\\1\\s*$`, "u"));
    if (match) {
      return match[2] ?? null;
    }
  }

  return null;
}

export async function resolveHostCodexDefaultModel(): Promise<HostCodexDefaultModelResolution> {
  const configPath = path.join(resolveCodexConfigDir(), "config.toml");
  let raw: string;
  try {
    raw = await fs.readFile(configPath, "utf8");
  } catch {
    return {
      model: null,
      source: null,
    };
  }

  return {
    model: parseTopLevelTomlString(raw, "model"),
    source: configPath,
  };
}

function defaultRouteSource(
  config: Pick<SupervisorConfig, "codexModelStrategy">,
  hostDefault: HostCodexDefaultModelResolution,
): CodexModelRouteResolution["source"] {
  if (config.codexModelStrategy === "inherit") {
    return hostDefault.model ? "inherited_host_default" : "inherited_host_default_unresolved";
  }

  return "supervisor_config";
}

function resolveRoute(args: {
  strategy: CodexModelStrategy;
  configuredModel: string | null;
  fallbackSource: CodexModelRouteResolution["source"];
  explicitOverrideSource: "bounded_repair_override" | "local_review_override";
  hostDefault: HostCodexDefaultModelResolution;
}): CodexModelRouteResolution {
  if (args.strategy === "inherit") {
    return {
      strategy: "inherit",
      configuredModel: null,
      effectiveModel: args.hostDefault.model,
      source: args.fallbackSource,
    };
  }

  return {
    strategy: args.strategy,
    configuredModel: args.configuredModel,
    effectiveModel: args.configuredModel,
    source: args.explicitOverrideSource,
  };
}

function summarizeRoute(route: CodexModelRouteResolution): string {
  if (route.source === "default_route") {
    return `default_route(${route.effectiveModel ?? "unresolved"})`;
  }

  const routeLabel = route.strategy === "inherit"
    ? `inherit->${route.effectiveModel ?? "unresolved"}`
    : `${route.strategy}:${route.effectiveModel ?? route.configuredModel ?? "unresolved"}`;
  return `${routeLabel}@${route.source}`;
}

export async function buildCodexModelPolicySnapshot(args: {
  config: Pick<
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
  activeState: RunState;
  activeRecord?: Pick<
    IssueRunRecord,
    "repeated_failure_signature_count" | "blocked_verification_retry_count" | "timeout_retry_count"
  > | null;
}): Promise<CodexModelPolicySnapshot> {
  const hostDefault = await resolveHostCodexDefaultModel();
  const defaultPolicy = resolveCodexExecutionPolicy(args.config, args.activeState, args.activeRecord, "supervisor");
  const defaultRoute: CodexModelRouteResolution = {
    strategy: args.config.codexModelStrategy,
    configuredModel: args.config.codexModel ?? null,
    effectiveModel: defaultPolicy.model ?? hostDefault.model,
    source: defaultRouteSource(args.config, hostDefault),
  };
  const boundedRepairRoute = resolveRoute({
    strategy: args.config.boundedRepairModelStrategy ?? "inherit",
    configuredModel: args.config.boundedRepairModel ?? null,
    fallbackSource: "default_route",
    explicitOverrideSource: "bounded_repair_override",
    hostDefault: {
      model: defaultRoute.effectiveModel,
      source: hostDefault.source,
    },
  });
  const localReviewRoute = resolveRoute({
    strategy: args.config.localReviewModelStrategy ?? "inherit",
    configuredModel: args.config.localReviewModel ?? null,
    fallbackSource: "default_route",
    explicitOverrideSource: "local_review_override",
    hostDefault: {
      model: defaultRoute.effectiveModel,
      source: hostDefault.source,
    },
  });
  const activeTarget: CodexExecutionTarget =
    args.activeState === "repairing_ci" || args.activeState === "addressing_review"
      ? "supervisor"
      : "supervisor";
  const activePolicy = resolveCodexExecutionPolicy(args.config, args.activeState, args.activeRecord, activeTarget);
  const activeRoute =
    args.activeState === "repairing_ci" || args.activeState === "addressing_review"
      ? {
        ...boundedRepairRoute,
        state: args.activeState,
        target: activeTarget,
        reasoningEffort: activePolicy.reasoningEffort,
      }
      : {
        ...defaultRoute,
        state: args.activeState,
        target: activeTarget,
        reasoningEffort: activePolicy.reasoningEffort,
      };

  return {
    hostDefault,
    defaultRoute,
    boundedRepairRoute,
    localReviewRoute,
    activeRoute,
  };
}

export function renderDoctorCodexModelPolicyLines(snapshot: CodexModelPolicySnapshot): string[] {
  return [
    `doctor_codex_model_policy default=${summarizeRoute(snapshot.defaultRoute)}`,
    `doctor_codex_route_overrides repair=${summarizeRoute(snapshot.boundedRepairRoute)} local_review=${summarizeRoute(snapshot.localReviewRoute)}`,
    `doctor_codex_host_default model=${snapshot.hostDefault.model ?? "unresolved"} source=${snapshot.hostDefault.source ?? "unresolved"}`,
  ];
}

export function renderStatusCodexModelPolicyLines(snapshot: CodexModelPolicySnapshot): string[] {
  return [
    `codex_execution_policy active=${snapshot.activeRoute.target}:${summarizeRoute(snapshot.activeRoute)} reasoning=${snapshot.activeRoute.reasoningEffort}`,
    `codex_route_overrides repair=${summarizeRoute(snapshot.boundedRepairRoute)} local_review=${summarizeRoute(snapshot.localReviewRoute)}`,
  ];
}
