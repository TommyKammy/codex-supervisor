import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  type CodexModelRoutingDecision,
  resolveCodexExecutionDecision,
} from "./codex-policy";
import { CodexModelCapabilities, resolveCodexModelCapabilities } from "./codex-model-capabilities";
import { resolveTrackedIssueHostPaths } from "../core/journal";
import {
  CodexExecutionTarget,
  CodexModelCapabilitySource,
  CodexModelRouteSource,
  CodexModelStrategy,
  IssueRunRecord,
  ReasoningEffort,
  ReasoningEffortFallbackReason,
  RunState,
  SupervisorConfig,
} from "../core/types";

export interface HostCodexDefaultModelResolution {
  model: string | null;
  source: string | null;
}

interface CodexModelRouteResolution {
  strategy: CodexModelStrategy;
  configuredModel: string | null;
  effectiveModel: string | null;
  source: CodexModelRouteSource;
  fallbackSource: CodexModelRouteSource | null;
}

interface CodexTargetRouteResolution extends CodexModelRouteResolution {
  requestedReasoningEffort: ReasoningEffort | null;
  reasoningEffort: ReasoningEffort | null;
  reasoningEffortFallbackReason: ReasoningEffortFallbackReason | null;
  capabilitySource: CodexModelCapabilitySource;
  capabilityFallbackReason: string | null;
}

export interface CodexModelPolicySnapshot {
  capabilities: Pick<CodexModelCapabilities, "source" | "fallbackReason">;
  hostDefault: HostCodexDefaultModelResolution;
  defaultRoute: CodexModelRouteResolution;
  boundedRepairRoute: CodexModelRouteResolution;
  localReviewRoute: CodexModelRouteResolution;
  targetRoutes: Record<CodexExecutionTarget, CodexTargetRouteResolution>;
  activeRoute: CodexTargetRouteResolution & {
    state: RunState;
    target: CodexExecutionTarget;
  };
}

function resolveCodexConfigDir(): string {
  if (process.env.CODEX_HOME && process.env.CODEX_HOME.trim() !== "") {
    return path.resolve(process.env.CODEX_HOME);
  }

  return path.join(os.homedir(), ".codex");
}

function countTrailingBackslashes(value: string, endExclusive: number): number {
  let count = 0;
  for (let index = endExclusive - 1; index >= 0 && value[index] === "\\"; index -= 1) {
    count += 1;
  }
  return count;
}

function decodeTomlBasicString(value: string): string | null {
  let decoded = "";
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    if (character !== "\\") {
      decoded += character;
      continue;
    }

    const escape = value[index + 1];
    if (escape === undefined) {
      return null;
    }
    index += 1;
    switch (escape) {
      case "b":
        decoded += "\b";
        break;
      case "t":
        decoded += "\t";
        break;
      case "n":
        decoded += "\n";
        break;
      case "f":
        decoded += "\f";
        break;
      case "r":
        decoded += "\r";
        break;
      case `"`:
        decoded += `"`;
        break;
      case "\\":
        decoded += "\\";
        break;
      case "u":
      case "U": {
        const length = escape === "u" ? 4 : 8;
        const hex = value.slice(index + 1, index + 1 + length);
        if (hex.length !== length || !/^[0-9a-fA-F]+$/u.test(hex)) {
          return null;
        }
        const codePoint = Number.parseInt(hex, 16);
        if (codePoint > 0x10ffff || (codePoint >= 0xd800 && codePoint <= 0xdfff)) {
          return null;
        }
        decoded += String.fromCodePoint(codePoint);
        index += length;
        break;
      }
      default:
        return null;
    }
  }
  return decoded;
}

function parseTomlQuotedString(value: string): string | null {
  const trimmed = value.trim();
  const quote = trimmed[0];
  if (quote !== `"` && quote !== "'") {
    return null;
  }

  for (let index = 1; index < trimmed.length; index += 1) {
    if (trimmed[index] !== quote) {
      continue;
    }
    if (quote === `"` && countTrailingBackslashes(trimmed, index) % 2 === 1) {
      continue;
    }

    const trailing = trimmed.slice(index + 1).trim();
    if (trailing !== "" && !trailing.startsWith("#")) {
      return null;
    }
    const parsed = trimmed.slice(1, index);
    return quote === `"` ? decodeTomlBasicString(parsed) : parsed;
  }

  return null;
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

    const separatorIndex = line.indexOf("=");
    if (separatorIndex === -1) {
      continue;
    }

    if (line.slice(0, separatorIndex).trim() !== key) {
      continue;
    }

    const parsed = parseTomlQuotedString(line.slice(separatorIndex + 1));
    if (parsed !== null) {
      return parsed;
    }
  }

  return null;
}

function isCodexProjectTrusted(contents: string, cwd: string): boolean {
  const resolvedCwd = path.resolve(cwd);
  let currentProject: string | null = null;
  for (const rawLine of contents.split(/\r?\n/u)) {
    const line = rawLine.trim();
    const projectHeader = /^\[projects\.(.+)\](?:\s+#.*)?$/u.exec(line);
    if (projectHeader) {
      const parsedProject = parseTomlQuotedString(projectHeader[1] ?? "");
      currentProject = parsedProject === null ? null : path.resolve(parsedProject);
      continue;
    }
    if (line.startsWith("[")) {
      currentProject = null;
      continue;
    }
    if (currentProject !== resolvedCwd) continue;

    const separatorIndex = line.indexOf("=");
    if (separatorIndex === -1 || line.slice(0, separatorIndex).trim() !== "trust_level") continue;
    return parseTomlQuotedString(line.slice(separatorIndex + 1)) === "trusted";
  }
  return false;
}

export async function resolveHostCodexDefaultModel(cwd?: string): Promise<HostCodexDefaultModelResolution> {
  const userConfigPath = path.join(resolveCodexConfigDir(), "config.toml");
  let userConfigContents: string | null = null;
  try {
    userConfigContents = await fs.readFile(userConfigPath, "utf8");
  } catch {
    // A missing user config also means there is no persisted project trust.
  }

  const configPaths = cwd && userConfigContents && isCodexProjectTrusted(userConfigContents, cwd)
    ? [path.join(path.resolve(cwd), ".codex", "config.toml"), userConfigPath]
    : [userConfigPath];
  for (const configPath of configPaths) {
    try {
      const contents = configPath === userConfigPath && userConfigContents !== null
        ? userConfigContents
        : await fs.readFile(configPath, "utf8");
      const model = parseTopLevelTomlString(contents, "model");
      if (model !== null) {
        return { model, source: configPath };
      }
    } catch {
      continue;
    }
  }

  return {
    model: null,
    source: null,
  };
}

function routeFromDecision(route: CodexModelRoutingDecision): CodexModelRouteResolution {
  return {
    strategy: route.strategy,
    configuredModel: route.requestedModel,
    effectiveModel: route.effectiveModel,
    source: route.source,
    fallbackSource: route.fallbackSource,
  };
}

function targetRouteFromDecision(
  decision: ReturnType<typeof resolveCodexExecutionDecision>,
): CodexTargetRouteResolution {
  return {
    ...routeFromDecision(decision.modelRouting),
    requestedReasoningEffort: decision.policy.requestedReasoningEffort ?? decision.policy.reasoningEffort,
    reasoningEffort: decision.policy.reasoningEffort,
    reasoningEffortFallbackReason: decision.policy.reasoningEffortFallbackReason ?? null,
    capabilitySource: decision.modelCapabilitySource,
    capabilityFallbackReason: decision.modelCapabilityFallbackReason,
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

function renderTargetRouteLine(
  prefix: "doctor_codex_target_route" | "codex_target_route",
  target: CodexExecutionTarget,
  route: CodexTargetRouteResolution,
): string {
  const requestedModel = route.strategy === "inherit"
    ? "inherit"
    : route.configuredModel ?? "unresolved";
  return `${prefix} target=${target} strategy=${route.strategy} requested_model=${requestedModel} effective_model=${route.effectiveModel ?? "unresolved"} route_source=${route.source} fallback_source=${route.fallbackSource ?? "none"} requested_reasoning=${route.requestedReasoningEffort ?? "default"} effective_reasoning=${route.reasoningEffort ?? "default"} reasoning_fallback_reason=${route.reasoningEffortFallbackReason ?? "none"} capability_source=${route.capabilitySource} fallback_reason=${route.capabilityFallbackReason ?? "none"}`;
}

export async function buildCodexModelPolicySnapshot(args: {
  config: Pick<
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
    | "codexBinary"
    | "workspaceRoot"
    | "issueJournalRelativePath"
  >;
  activeState: RunState;
  activeRecord?: Pick<
    IssueRunRecord,
    | "issue_number"
    | "workspace"
    | "journal_path"
    | "repeated_failure_signature_count"
    | "blocked_verification_retry_count"
    | "timeout_retry_count"
  > | null;
}): Promise<CodexModelPolicySnapshot> {
  const workspace = args.activeRecord
    ? resolveTrackedIssueHostPaths(args.config, args.activeRecord).workspace
    : undefined;
  const [hostDefault, capabilities] = await Promise.all([
    resolveHostCodexDefaultModel(workspace),
    resolveCodexModelCapabilities(args.config.codexBinary, workspace),
  ]);
  const policyContext = {
    inheritedModel: hostDefault.model,
    reasoningLevelsByModel: capabilities.reasoningLevelsByModel,
    modelCapabilitySource: capabilities.source,
    modelCapabilityFallbackReason: capabilities.fallbackReason,
  };
  const defaultDecision = resolveCodexExecutionDecision(
    args.config,
    "implementing",
    undefined,
    "supervisor",
    policyContext,
  );
  const boundedRepairDecision = resolveCodexExecutionDecision(
    args.config,
    "repairing_ci",
    undefined,
    "supervisor",
    policyContext,
  );
  const targetDecisions: Record<CodexExecutionTarget, ReturnType<typeof resolveCodexExecutionDecision>> = {
    supervisor: defaultDecision,
    local_review_generic: resolveCodexExecutionDecision(
      args.config,
      "local_review",
      undefined,
      "local_review_generic",
      policyContext,
    ),
    local_review_specialist: resolveCodexExecutionDecision(
      args.config,
      "local_review",
      undefined,
      "local_review_specialist",
      policyContext,
    ),
    local_review_verifier: resolveCodexExecutionDecision(
      args.config,
      "local_review",
      undefined,
      "local_review_verifier",
      policyContext,
    ),
  };
  const defaultRoute = routeFromDecision(defaultDecision.modelRouting);
  const boundedRepairRoute = routeFromDecision(boundedRepairDecision.modelRouting);
  const targetRoutes: Record<CodexExecutionTarget, CodexTargetRouteResolution> = {
    supervisor: targetRouteFromDecision(defaultDecision),
    local_review_generic: targetRouteFromDecision(targetDecisions.local_review_generic),
    local_review_specialist: targetRouteFromDecision(targetDecisions.local_review_specialist),
    local_review_verifier: targetRouteFromDecision(targetDecisions.local_review_verifier),
  };
  const localReviewRoute = targetRoutes.local_review_generic;
  const activeTarget: CodexExecutionTarget = args.activeState === "local_review"
    ? "local_review_generic"
    : "supervisor";
  const activeDecision = resolveCodexExecutionDecision(
    args.config,
    args.activeState,
    args.activeRecord,
    activeTarget,
    policyContext,
  );
  const activeRoute = {
    ...targetRouteFromDecision(activeDecision),
    state: args.activeState,
    target: activeTarget,
  };

  return {
    capabilities: { source: capabilities.source, fallbackReason: capabilities.fallbackReason },
    hostDefault,
    defaultRoute,
    boundedRepairRoute,
    localReviewRoute,
    targetRoutes,
    activeRoute,
  };
}

export function renderDoctorCodexModelPolicyLines(snapshot: CodexModelPolicySnapshot): string[] {
  const lines = [
    `doctor_codex_model_policy default=${summarizeRoute(snapshot.defaultRoute)}`,
    `doctor_codex_route_overrides repair=${summarizeRoute(snapshot.boundedRepairRoute)} local_review=${summarizeRoute(snapshot.localReviewRoute)}`,
    `doctor_codex_host_default model=${snapshot.hostDefault.model ?? "unresolved"} source=${snapshot.hostDefault.source ?? "unresolved"}`,
    `doctor_codex_reasoning active=${snapshot.activeRoute.target} requested=${snapshot.activeRoute.requestedReasoningEffort ?? "default"} effective=${snapshot.activeRoute.reasoningEffort ?? "default"} reasoning_fallback_reason=${snapshot.activeRoute.reasoningEffortFallbackReason ?? "none"} capability_source=${snapshot.activeRoute.capabilitySource} fallback_reason=${snapshot.activeRoute.capabilityFallbackReason ?? "none"}`,
  ];
  for (const target of ["supervisor", "local_review_generic", "local_review_specialist", "local_review_verifier"] as const) {
    lines.push(renderTargetRouteLine("doctor_codex_target_route", target, snapshot.targetRoutes[target]));
  }
  return lines;
}

export function renderStatusCodexModelPolicyLines(snapshot: CodexModelPolicySnapshot): string[] {
  const lines = [
    `codex_execution_policy active=${snapshot.activeRoute.target}:${summarizeRoute(snapshot.activeRoute)} reasoning=${snapshot.activeRoute.reasoningEffort ?? "default"} requested_reasoning=${snapshot.activeRoute.requestedReasoningEffort ?? "default"} effective_reasoning=${snapshot.activeRoute.reasoningEffort ?? "default"} reasoning_fallback_reason=${snapshot.activeRoute.reasoningEffortFallbackReason ?? "none"} capability_source=${snapshot.activeRoute.capabilitySource} fallback_reason=${snapshot.activeRoute.capabilityFallbackReason ?? "none"}`,
    `codex_route_overrides repair=${summarizeRoute(snapshot.boundedRepairRoute)} local_review=${summarizeRoute(snapshot.localReviewRoute)}`,
  ];
  for (const target of ["supervisor", "local_review_generic", "local_review_specialist", "local_review_verifier"] as const) {
    lines.push(renderTargetRouteLine("codex_target_route", target, snapshot.targetRoutes[target]));
  }
  return lines;
}
