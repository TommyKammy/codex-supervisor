import { CommandExecutionError, runCommand } from "../core/command";
import { ReasoningEffort } from "../core/types";

export type CodexCapabilitySource = "live_catalog" | "fallback";

export interface CodexModelCapabilities {
  reasoningLevelsByModel: ReadonlyMap<string, ReadonlySet<ReasoningEffort>>;
  source: CodexCapabilitySource;
  fallbackReason: string | null;
}

const REASONING_LEVELS = new Set<ReasoningEffort>(["none", "low", "medium", "high", "xhigh", "max"]);
const FALLBACK = new Map<string, ReadonlySet<ReasoningEffort>>([
  ["gpt-5.6-sol", new Set<ReasoningEffort>(["low", "medium", "high", "xhigh", "max"])],
]);
const cache = new Map<string, Promise<CodexModelCapabilities>>();

function fallback(reason: string): CodexModelCapabilities {
  return { reasoningLevelsByModel: FALLBACK, source: "fallback", fallbackReason: reason };
}

function parseReasoningLevel(value: unknown): ReasoningEffort | null | undefined {
  const candidate = typeof value === "string"
    ? value
    : value && typeof value === "object" && "effort" in value
      ? (value as { effort?: unknown }).effort
      : null;
  if (typeof candidate !== "string") return null;
  return REASONING_LEVELS.has(candidate as ReasoningEffort) ? candidate as ReasoningEffort : undefined;
}

export function parseCodexModelCatalog(raw: string): ReadonlyMap<string, ReadonlySet<ReasoningEffort>> | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  const entries = Array.isArray(parsed)
    ? parsed
    : parsed && typeof parsed === "object" && Array.isArray((parsed as { models?: unknown }).models)
      ? (parsed as { models: unknown[] }).models
      : null;
  if (!entries) return null;

  const models = new Map<string, ReadonlySet<ReasoningEffort>>();
  for (const entry of entries) {
    if (!entry || typeof entry !== "object") return null;
    const { slug, supported_reasoning_levels: levels } = entry as {
      slug?: unknown;
      supported_reasoning_levels?: unknown;
    };
    if (typeof slug !== "string" || slug.trim() === "" || !Array.isArray(levels)) return null;
    const parsedLevels = levels.map(parseReasoningLevel);
    if (parsedLevels.some((level) => level === null)) return null;
    models.set(slug.trim().toLowerCase(), new Set(parsedLevels.filter((level) => level !== undefined) as ReasoningEffort[]));
  }
  return models.size > 0 ? models : null;
}

export async function probeCodexModelCapabilities(
  codexBinary: string,
  timeoutMs = 5_000,
): Promise<CodexModelCapabilities> {
  try {
    const result = await runCommand(codexBinary, ["debug", "models"], { timeoutMs });
    const models = parseCodexModelCatalog(result.stdout);
    return models
      ? { reasoningLevelsByModel: models, source: "live_catalog", fallbackReason: null }
      : fallback("malformed_catalog");
  } catch (error) {
    if (error instanceof CommandExecutionError) {
      return fallback(error.timedOut ? "catalog_probe_timeout" : `catalog_probe_exit_${error.exitCode}`);
    }
    return fallback("catalog_probe_unavailable");
  }
}

export function resolveCodexModelCapabilities(codexBinary: string): Promise<CodexModelCapabilities> {
  const existing = cache.get(codexBinary);
  if (existing) return existing;
  const pending = probeCodexModelCapabilities(codexBinary);
  cache.set(codexBinary, pending);
  return pending;
}

export function clearCodexModelCapabilitiesCacheForTests(): void {
  cache.clear();
}
