import fs from "node:fs/promises";
import path from "node:path";
import { type LocalReviewRoleSelection } from "../review-role-detector";
import { type SupervisorConfig } from "../core/types";
import {
  prependTrustedGeneratedDurableArtifactMarkdownMarker,
  withTrustedGeneratedDurableArtifactProvenance,
} from "../durable-artifact-provenance";
import { normalizeDurableTrackedArtifactContent } from "../core/journal";
import { createPostMergeAuditResult, renderPostMergeAuditContractSummary } from "./post-merge-audit";
import {
  type FinalizedLocalReview,
  type LocalReviewFinding,
  type LocalReviewResult,
  type LocalReviewRoleResult,
  type LocalReviewVerifierReport,
} from "./types";

function safeSlug(input: string): string {
  return input.replace(/[^a-zA-Z0-9._-]+/g, "-");
}

export function reviewDir(config: Pick<SupervisorConfig, "localReviewArtifactDir" | "repoSlug">, issueNumber: number): string {
  return path.join(config.localReviewArtifactDir, safeSlug(config.repoSlug), `issue-${issueNumber}`);
}

function summarizeRoles(roleResults: LocalReviewRoleResult[]): string {
  const summaries = roleResults
    .map((result) => `- ${result.role}: ${result.summary}`)
    .slice(0, 10);

  return summaries.length > 0
    ? summaries.join("\n")
    : "- local review completed without structured role summaries.";
}

function formatRoleSelectionReason(reason: LocalReviewRoleSelection["reasons"][number]): string {
  const suffix = reason.paths.length > 0 ? ` (${reason.paths.join(", ")})` : "";
  switch (reason.kind) {
    case "baseline":
      return `baseline${suffix}`;
    case "config_signal":
      return `${reason.signal}${suffix}`;
    case "repo_signal":
      return `${reason.signal}${suffix}`;
  }
}

function summarizeAutoDetectedRoles(detectedRoles: LocalReviewRoleSelection[]): string[] {
  const specialistSelections = detectedRoles.filter(
    (selection) => selection.role !== "reviewer" && selection.role !== "explorer",
  );
  if (specialistSelections.length === 0) {
    return ["- No specialist roles were auto-detected beyond the baseline reviewer/explorer pair."];
  }

  return specialistSelections
    .slice(0, 10)
    .map((selection) => `- ${selection.role}: ${selection.reasons.map(formatRoleSelectionReason).join("; ")}`);
}

function summarizeGuardrailProvenance(provenance: FinalizedLocalReview["artifact"]["guardrailProvenance"]): string[] {
  const lines: string[] = [];

  if (provenance.verifier.committedCount > 0 && provenance.verifier.committedPath) {
    lines.push(`- Verifier committed: ${provenance.verifier.committedCount} from ${provenance.verifier.committedPath}`);
  }
  if (provenance.externalReview.committedCount > 0 && provenance.externalReview.committedPath) {
    lines.push(
      `- External review committed: ${provenance.externalReview.committedCount} from ${provenance.externalReview.committedPath}`,
    );
  }
  for (const source of provenance.externalReview.runtimeSources) {
    lines.push(`- External review runtime: ${source.count} from ${source.path}`);
  }

  return lines.length > 0 ? lines : ["- No active durable guardrails matched this review."];
}

function summarizeModelRouting(finalized: FinalizedLocalReview): string[] {
  const lines = finalized.artifact.roleReports.map(
    (report) =>
      `- ${report.role}: target=${report.routing.target} model=${report.routing.model ?? "inherit"} reasoning=${report.routing.reasoningEffort}`,
  );

  if (finalized.artifact.verifierReport) {
    lines.push(
      `- verifier: target=${finalized.artifact.verifierReport.routing.target} model=${finalized.artifact.verifierReport.routing.model ?? "inherit"} reasoning=${finalized.artifact.verifierReport.routing.reasoningEffort}`,
    );
  }

  return lines;
}

export function renderLines(finding: Pick<LocalReviewFinding, "start" | "end">): string {
  if (finding.start == null) {
    return "?";
  }

  return finding.end && finding.end !== finding.start
    ? `${finding.start}-${finding.end}`
    : `${finding.start}`;
}

export async function writeLocalReviewArtifacts(args: {
  config: SupervisorConfig;
  workspacePath: string;
  issueNumber: number;
  branch: string;
  prUrl: string;
  headSha: string;
  roles: string[];
  ranAt: string;
  finalized: FinalizedLocalReview;
  roleResults: LocalReviewRoleResult[];
  verifierReport: LocalReviewVerifierReport | null;
}): Promise<Pick<LocalReviewResult, "summaryPath" | "findingsPath" | "rawOutput">> {
  const dirPath = reviewDir(args.config, args.issueNumber);
  const baseName = `head-${args.headSha.slice(0, 12)}`;
  const summaryPath = path.join(dirPath, `${baseName}.md`);
  const findingsPath = path.join(dirPath, `${baseName}.json`);
  const rawOutput = args.roleResults
    .map((result) => `## ${result.role}\n\n${result.rawOutput}`)
    .concat(args.verifierReport ? [`## verifier\n\n${args.verifierReport.rawOutput}`] : [])
    .join("\n\n");
  await fs.mkdir(dirPath, { recursive: true });

  const summaryDocument = prependTrustedGeneratedDurableArtifactMarkdownMarker(
    [
        `# Local Review for Issue #${args.issueNumber}`,
        "",
        `- PR: ${args.prUrl}`,
        `- Branch: ${args.branch}`,
        `- Head SHA: ${args.headSha}`,
        `- Ran at: ${args.ranAt}`,
        `- Roles: ${args.roles.join(", ")}`,
        `- Confidence threshold: ${args.config.localReviewConfidenceThreshold.toFixed(2)}`,
        `- Actionable findings: ${args.finalized.findingsCount}`,
        `- Root causes: ${args.finalized.rootCauseCount}`,
        `- Max severity: ${args.finalized.maxSeverity}`,
        `- Verified findings: ${args.finalized.verifiedFindingsCount}`,
        `- Verified max severity: ${args.finalized.verifiedMaxSeverity}`,
        `- Recommendation: ${args.finalized.recommendation}`,
        `- Degraded: ${args.finalized.degraded ? "yes" : "no"}`,
        `- Final evaluation outcome: ${args.finalized.finalEvaluation.outcome}`,
        "",
        "## Pre-merge final evaluation",
        `- Outcome: ${args.finalized.finalEvaluation.outcome}`,
        `- Must-fix residuals: ${args.finalized.finalEvaluation.mustFixCount}`,
        `- Manual-review residuals: ${args.finalized.finalEvaluation.manualReviewCount}`,
        `- Follow-up-eligible residuals: ${args.finalized.finalEvaluation.followUpCount}`,
        "",
        "## Post-merge audit contract",
        renderPostMergeAuditContractSummary(
          createPostMergeAuditResult({
            recurringPatterns: [],
            promotionCandidates: [],
          }),
        ),
        "",
        "## Auto-detected roles",
        ...summarizeAutoDetectedRoles(args.finalized.artifact.autoDetectedRoles),
        "",
        "## Role summaries",
        summarizeRoles(args.roleResults),
        "",
        "## Reviewer thresholds",
        ...args.finalized.artifact.roleReports.map((report) =>
          `- ${report.role}: type=${report.reviewerType} confidence>=${report.confidenceThreshold.toFixed(2)} severity>=${report.minimumSeverity} actionable=${report.actionableFindingsCount}`,
        ),
        "",
        "## Model routing",
        ...summarizeModelRouting(args.finalized),
        "",
        "## Durable guardrails",
        ...summarizeGuardrailProvenance(args.finalized.artifact.guardrailProvenance),
        "",
        "## Actionable findings",
        ...(args.finalized.actionableFindings.length > 0
          ? args.finalized.actionableFindings.map((finding, index) =>
              [
                `### ${index + 1}. ${finding.title}`,
                `- Role: ${finding.role}`,
                `- Severity: ${finding.severity}`,
                `- Confidence: ${finding.confidence.toFixed(2)}`,
                `- File: ${finding.file ?? "none"}`,
                `- Lines: ${renderLines(finding)}`,
                `- Category: ${finding.category ?? "none"}`,
                `- Body: ${finding.body}`,
                ...(finding.evidence ? [`- Evidence: ${finding.evidence}`] : []),
                "",
              ].join("\n"),
            )
          : ["- No actionable findings above the confidence threshold.", ""]),
        "## Root-cause summaries",
        ...(args.finalized.rootCauseSummaries.length > 0
          ? args.finalized.rootCauseSummaries.map((rootCause, index) =>
              [
                `### Root cause ${index + 1}`,
                `- Severity: ${rootCause.severity}`,
                `- Findings: ${rootCause.findingsCount}`,
                `- Roles: ${rootCause.roles.join(", ")}`,
                `- File: ${rootCause.file ?? "multiple"}`,
                `- Lines: ${rootCause.file ? renderLines(rootCause) : "multiple"}`,
                `- Category: ${rootCause.category ?? "none"}`,
                `- Summary: ${rootCause.summary}`,
                "",
              ].join("\n"),
            )
          : ["- No compressed root causes.", ""]),
        "## High-Severity Verification",
        `- Required: ${args.finalized.artifact.verification.required ? "yes" : "no"}`,
        `- Summary: ${args.finalized.artifact.verification.summary}`,
        `- Recommendation: ${args.finalized.artifact.verification.recommendation}`,
        `- Degraded: ${args.finalized.artifact.verification.degraded ? "yes" : "no"}`,
        `- Verified findings: ${args.finalized.verifiedFindingsCount}`,
        `- Verified max severity: ${args.finalized.verifiedMaxSeverity}`,
        ...(args.finalized.artifact.verification.findings.length > 0
          ? [
              "",
              ...args.finalized.artifact.verification.findings.map((finding, index) =>
                [
                  `### Verification ${index + 1}`,
                  `- Finding key: ${finding.findingKey}`,
                  `- Verdict: ${finding.verdict}`,
                  `- Rationale: ${finding.rationale}`,
                  "",
                ].join("\n"),
              ),
            ]
          : [""]),
        "## Raw role outputs",
        rawOutput,
        "",
      ].join("\n"),
  );
  await fs.writeFile(
    summaryPath,
    normalizeDurableTrackedArtifactContent(summaryDocument, args.workspacePath, [args.config.localReviewArtifactDir]),
    "utf8",
  );

  const findingsDocument = `${JSON.stringify(withTrustedGeneratedDurableArtifactProvenance(args.finalized.artifact), null, 2)}\n`;
  await fs.writeFile(
    findingsPath,
    normalizeDurableTrackedArtifactContent(findingsDocument, args.workspacePath, [args.config.localReviewArtifactDir]),
    "utf8",
  );

  return { summaryPath, findingsPath, rawOutput };
}
