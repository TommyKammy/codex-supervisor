import {
  ConfiguredReviewProvider,
  ConfiguredReviewProviderKind,
  SupervisorConfig,
} from "./types";

const COPILOT_REVIEWER_LOGIN = "copilot-pull-request-reviewer";
const CODEX_REVIEWER_LOGIN = "chatgpt-codex-connector";
const CODERABBIT_REVIEWER_LOGINS = ["coderabbitai", "coderabbitai[bot]"] as const;

export type ReviewProviderProfileId = "none" | "copilot" | "codex" | "coderabbit" | "custom";

export interface ReviewProviderProfileSummary {
  profile: ReviewProviderProfileId;
  provider: string;
  reviewers: string[];
  signalSource: string;
}

export interface ReviewProviderWaitPolicy {
  botLabel: string;
  shouldWaitForRequestedReviewSignal: boolean;
  shouldWaitForRequestPropagation: boolean;
  shouldTrackRequestedState: boolean;
  shouldApplyRequestedReviewTimeout: boolean;
  shouldApplyRateLimitCooldown: boolean;
  shouldApplyCurrentHeadQuietPeriod: boolean;
}

function trimReviewBotLogins(reviewBotLogins: string[]): string[] {
  return reviewBotLogins.map((login) => login.trim()).filter((login) => login.length > 0);
}

export function normalizeReviewBotLogins(reviewBotLogins: string[]): string[] {
  const normalized = trimReviewBotLogins(reviewBotLogins).map((login) => login.toLowerCase());
  return Array.from(new Set(normalized));
}

function providerKindForLogin(login: string): ConfiguredReviewProviderKind {
  if (login === COPILOT_REVIEWER_LOGIN) {
    return "copilot";
  }
  if (login === CODEX_REVIEWER_LOGIN) {
    return "codex";
  }
  if (CODERABBIT_REVIEWER_LOGINS.includes(login as (typeof CODERABBIT_REVIEWER_LOGINS)[number])) {
    return "coderabbit";
  }
  return "custom";
}

export function mapConfiguredReviewProviders(reviewBotLogins: string[]): ConfiguredReviewProvider[] {
  const providers = new Map<ConfiguredReviewProviderKind, ConfiguredReviewProvider>();
  const orderedKinds: ConfiguredReviewProviderKind[] = [];

  for (const login of normalizeReviewBotLogins(reviewBotLogins)) {
    const kind = providerKindForLogin(login);
    const existing = providers.get(kind);
    if (existing) {
      existing.reviewerLogins.push(login);
      continue;
    }

    orderedKinds.push(kind);
    providers.set(kind, {
      kind,
      reviewerLogins: [login],
      signalSource: kind === "copilot" ? "copilot_lifecycle" : "review_threads",
    });
  }

  return orderedKinds.map((kind) => providers.get(kind)).filter((provider): provider is ConfiguredReviewProvider => Boolean(provider));
}

export function configuredReviewProviders(config: Pick<SupervisorConfig, "reviewBotLogins" | "configuredReviewProviders">): ConfiguredReviewProvider[] {
  return config.configuredReviewProviders ?? mapConfiguredReviewProviders(config.reviewBotLogins);
}

export function configuredReviewBotLogins(config: Pick<SupervisorConfig, "reviewBotLogins" | "configuredReviewProviders">): string[] {
  return configuredReviewProviders(config).flatMap((provider) => provider.reviewerLogins);
}

export function configuredReviewProviderKinds(config: Pick<SupervisorConfig, "reviewBotLogins" | "configuredReviewProviders">): ConfiguredReviewProviderKind[] {
  return configuredReviewProviders(config).map((provider) => provider.kind);
}

export function repoExpectsConfiguredBotReview(config: Pick<SupervisorConfig, "reviewBotLogins" | "configuredReviewProviders">): boolean {
  return configuredReviewProviders(config).length > 0;
}

export function repoExpectsLifecycleBotReview(config: Pick<SupervisorConfig, "reviewBotLogins" | "configuredReviewProviders">): boolean {
  return configuredReviewProviders(config).some((provider) => provider.signalSource === "copilot_lifecycle");
}

export function repoUsesCopilotOnlyReviewBot(config: Pick<SupervisorConfig, "reviewBotLogins" | "configuredReviewProviders">): boolean {
  const providers = configuredReviewProviders(config);
  return providers.length === 1 && providers[0]?.kind === "copilot" && providers[0].reviewerLogins.length === 1;
}

export function reviewProviderWaitPolicyFromConfig(
  config: Pick<SupervisorConfig, "reviewBotLogins" | "configuredReviewProviders">,
): ReviewProviderWaitPolicy {
  const reviewers = configuredReviewBotLogins(config);
  const usesLifecycleSignals = repoExpectsLifecycleBotReview(config);
  const providerKinds = configuredReviewProviderKinds(config);
  return {
    botLabel: repoUsesCopilotOnlyReviewBot(config)
      ? "Copilot"
      : reviewers.length === 1
        ? `configured review bot (${reviewers[0]})`
        : reviewers.length > 1
          ? `configured review bots (${reviewers.join(", ")})`
          : "configured review bot",
    shouldWaitForRequestedReviewSignal: reviewers.length > 0,
    shouldWaitForRequestPropagation: usesLifecycleSignals,
    shouldTrackRequestedState: usesLifecycleSignals,
    shouldApplyRequestedReviewTimeout: usesLifecycleSignals,
    shouldApplyRateLimitCooldown: reviewers.length > 0,
    shouldApplyCurrentHeadQuietPeriod: providerKinds.includes("coderabbit"),
  };
}

export function reviewProviderProfileFromConfig(
  config: Pick<SupervisorConfig, "reviewBotLogins" | "configuredReviewProviders">,
): ReviewProviderProfileSummary {
  const providers = configuredReviewProviders(config);
  const reviewers = configuredReviewBotLogins(config);

  if (providers.length === 0) {
    return {
      profile: "none",
      provider: "none",
      reviewers,
      signalSource: "none",
    };
  }

  const signalSources = new Set(providers.map((provider) => provider.signalSource));
  const combinedSignalSource = [
    signalSources.has("copilot_lifecycle") ? "copilot_lifecycle" : null,
    signalSources.has("review_threads") ? "review_threads" : null,
  ]
    .filter((signalSource): signalSource is string => signalSource !== null)
    .join("+");
  if (providers.length === 1) {
    const [provider] = providers;
    if (provider.kind === "copilot" && provider.reviewerLogins.length === 1) {
      return {
        profile: "copilot",
        provider: COPILOT_REVIEWER_LOGIN,
        reviewers,
        signalSource: provider.signalSource,
      };
    }

    if (provider.kind === "codex" && provider.reviewerLogins.length === 1) {
      return {
        profile: "codex",
        provider: CODEX_REVIEWER_LOGIN,
        reviewers,
        signalSource: provider.signalSource,
      };
    }

    if (
      provider.kind === "coderabbit" &&
      provider.reviewerLogins.length === CODERABBIT_REVIEWER_LOGINS.length &&
      CODERABBIT_REVIEWER_LOGINS.every((login) => provider.reviewerLogins.includes(login))
    ) {
      return {
        profile: "coderabbit",
        provider: "coderabbitai",
        reviewers,
        signalSource: provider.signalSource,
      };
    }
  }

  return {
    profile: "custom",
    provider: reviewers.join(",") || "custom",
    reviewers,
    signalSource: combinedSignalSource,
  };
}
