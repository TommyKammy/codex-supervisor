import { nowIso, truncate } from "../core/utils";
import {
  FailureContext,
  GitHubIssue,
  IssueRunRecord,
  SupervisorConfig,
} from "../core/types";

export const TRUSTED_INPUT_LABEL = "trusted-input";
export const AUTONOMOUS_TRUST_GATE_SIGNATURE = "autonomous-trust-gate";

export interface AutonomousExecutionTrustDecision {
  allowed: boolean;
  satisfiedBy: "trusted_repo_and_authors" | "trusted_input_label" | "unsandboxed_autonomous" | null;
  summary: string | null;
  details: string[];
  readinessToken: string;
}

export function hasTrustedInputLabel(issue: Pick<GitHubIssue, "labels">): boolean {
  return (issue.labels ?? []).some((label) => label.name.trim().toLowerCase() === TRUSTED_INPUT_LABEL);
}

export function evaluateAutonomousExecutionTrust(
  config: Pick<SupervisorConfig, "trustMode" | "executionSafetyMode">,
  issue: Pick<GitHubIssue, "number" | "labels">,
): AutonomousExecutionTrustDecision {
  const trustMode = config.trustMode ?? "trusted_repo_and_authors";
  const executionSafetyMode = config.executionSafetyMode ?? "unsandboxed_autonomous";
  const trustedInput = hasTrustedInputLabel(issue);

  if (trustMode === "trusted_repo_and_authors") {
    return {
      allowed: true,
      satisfiedBy: "trusted_repo_and_authors",
      summary: null,
      details: [],
      readinessToken: "trusted_repo",
    };
  }

  if (trustedInput) {
    return {
      allowed: true,
      satisfiedBy: "trusted_input_label",
      summary: null,
      details: [],
      readinessToken: "trusted_input",
    };
  }

  if (executionSafetyMode === "unsandboxed_autonomous") {
    return {
      allowed: true,
      satisfiedBy: "unsandboxed_autonomous",
      summary: null,
      details: [],
      readinessToken: "unsafe_override",
    };
  }

  const summary =
    `Autonomous execution blocked for issue #${issue.number}: ` +
    "GitHub-authored issue or review input is untrusted in operator-gated safer mode.";

  return {
    allowed: false,
    satisfiedBy: null,
    summary,
    details: [
      `trust_mode=${trustMode}`,
      `execution_safety_mode=${executionSafetyMode}`,
      `trusted_input_label=${trustedInput ? "present" : "missing"}`,
      "Allow autonomous execution by adding the trusted-input label, switching trustMode to trusted_repo_and_authors, or using executionSafetyMode=unsandboxed_autonomous with explicit operator approval.",
    ],
    readinessToken: "trusted-input-required",
  };
}

export function buildAutonomousExecutionTrustFailureContext(
  config: Pick<SupervisorConfig, "trustMode" | "executionSafetyMode">,
  issue: Pick<GitHubIssue, "number" | "labels" | "url">,
): FailureContext {
  const decision = evaluateAutonomousExecutionTrust(config, issue);
  if (decision.allowed || !decision.summary) {
    throw new Error("Cannot build an autonomous execution trust failure context for an allowed issue.");
  }

  return {
    category: "blocked",
    summary: truncate(decision.summary, 1000) ?? decision.summary,
    signature: AUTONOMOUS_TRUST_GATE_SIGNATURE,
    command: null,
    details: decision.details,
    url: issue.url,
    updated_at: nowIso(),
  };
}

export function isAutonomousExecutionTrustBlockedRecord(
  record: Pick<IssueRunRecord, "blocked_reason" | "last_failure_signature"> | null | undefined,
): boolean {
  return record?.blocked_reason === "permissions" && record.last_failure_signature === AUTONOMOUS_TRUST_GATE_SIGNATURE;
}
