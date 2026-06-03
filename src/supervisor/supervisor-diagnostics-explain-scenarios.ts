import fs from "node:fs/promises";
import path from "node:path";
import type { GitHubIssue } from "../core/types";
import {
  createTrackedPullRequestStatusScenario,
  createTrackedStatusIssue,
} from "./supervisor-diagnostics-status-scenarios";

export {
  createConfiguredBotReviewThread,
  writeSupervisorState,
} from "./supervisor-diagnostics-status-scenarios";

export type ExternalReviewDigestOptions = {
  artifactPath: string;
  headStatus: "current-head" | "stale-head";
  missedFindings: number;
  sections: string[];
};

export async function writeExternalReviewDigest(args: ExternalReviewDigestOptions): Promise<void> {
  const missAnalysisHeadSha = "deadbeefcafebabe";
  const activePrHeadSha =
    args.headStatus === "current-head" ? missAnalysisHeadSha : "feedfacecafef00d";

  await fs.mkdir(path.dirname(args.artifactPath), { recursive: true });
  await fs.writeFile(args.artifactPath, "{}\n", "utf8");
  await fs.writeFile(
    args.artifactPath.replace(/\.json$/u, ".md"),
    [
      "# External Review Miss Follow-up Digest",
      "",
      `- Miss artifact: ${args.artifactPath}`,
      "- Local review summary: none",
      "- Generated at: 2026-03-18T00:00:00.000Z",
      `- Miss analysis head SHA: ${missAnalysisHeadSha}`,
      `- Active PR head SHA: ${activePrHeadSha}`,
      "- Local review artifact head SHA: deadbeefcafebabe",
      `- Head status: ${args.headStatus} (${
        args.headStatus === "current-head"
          ? "digest matches the active PR head"
          : "digest does not match the active PR head"
      })`,
      `- Missed findings: ${args.missedFindings}`,
      "",
      ...args.sections,
      "",
    ].join("\n"),
    "utf8",
  );
}

export function codexConnectorDiagnosticLines(text: string): string[] {
  return text
    .split("\n")
    .filter((line) =>
      line.startsWith("codex_connector_policy_block ") ||
      line.startsWith("codex_connector_pending_head_churn ") ||
      line.startsWith("codex_connector_review_fallback ") ||
      line.startsWith("codex_connector_convergence ") ||
      line.startsWith("codex_connector_operator_diagnostic ")
    );
}

export type TrackedPullRequestExplainScenarioOptions = Parameters<
  typeof createTrackedPullRequestStatusScenario
>[1] & {
  title: string;
  summary: string;
  issueCreatedAt?: string;
  issueUpdatedAt?: string;
  labels?: GitHubIssue["labels"];
};

export function createTrackedPullRequestExplainScenario(
  fixture: Parameters<typeof createTrackedPullRequestStatusScenario>[0],
  args: TrackedPullRequestExplainScenarioOptions,
) {
  const scenario = createTrackedPullRequestStatusScenario(fixture, args);
  const issue = createTrackedStatusIssue({
    issueNumber: scenario.issueNumber,
    title: args.title,
    summary: args.summary,
    createdAt: args.issueCreatedAt,
    updatedAt: args.issueUpdatedAt,
    labels: args.labels,
  });

  return {
    ...scenario,
    issue,
  };
}
