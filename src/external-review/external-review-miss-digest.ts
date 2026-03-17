import path from "node:path";
import {
  type ExternalReviewArtifactFinding,
  type ExternalReviewMissArtifact,
} from "./external-review-miss-artifact-types";
import { type ExternalReviewPreventionTarget } from "./external-review-prevention-targets";

const PREVENTION_TARGET_ORDER: ExternalReviewPreventionTarget[] = [
  "durable_guardrail",
  "regression_test",
  "review_prompt",
  "issue_template",
];

function preventionTargetHeading(target: ExternalReviewPreventionTarget): string {
  switch (target) {
    case "durable_guardrail":
      return "Durable guardrail";
    case "regression_test":
      return "Regression test";
    case "review_prompt":
      return "Review prompt";
    case "issue_template":
      return "Issue template";
  }
}

function preventionTargetAction(target: ExternalReviewPreventionTarget, finding: ExternalReviewArtifactFinding): string {
  const location =
    typeof finding.file === "string" && finding.file.trim() !== ""
      ? typeof finding.line === "number" && Number.isInteger(finding.line) && finding.line > 0
        ? `\`${finding.file}:${finding.line}\``
        : `\`${finding.file}\``
      : null;

  switch (target) {
    case "durable_guardrail":
      return location
        ? `Add a durable guardrail covering ${location} so future reviews flag this pattern early.`
        : "Add a durable guardrail for this recurring risk so future reviews flag this pattern early.";
    case "regression_test":
      return location
        ? `Add or extend a regression test for ${location} that proves this miss cannot recur.`
        : "Add or extend a regression test that proves this miss cannot recur.";
    case "review_prompt":
      return "Update the local review prompt or rubric so it explicitly checks for this risk before code changes land.";
    case "issue_template":
      return "Update the issue template or execution checklist so this expectation is explicit before implementation starts.";
  }
}

function renderLocation(finding: ExternalReviewArtifactFinding): string {
  if (typeof finding.file === "string" && finding.file.trim() !== "") {
    if (typeof finding.line === "number" && Number.isInteger(finding.line) && finding.line > 0) {
      return `\`${finding.file}:${finding.line}\``;
    }

    return `\`${finding.file}\``;
  }

  return "unanchored";
}

function renderHeadStatus(artifactHeadSha: string, activeHeadSha: string): string {
  return artifactHeadSha === activeHeadSha
    ? "current-head (digest matches the active PR head)"
    : "stale-head (digest does not match the active PR head)";
}

export function externalReviewMissFollowUpDigestPath(artifactPath: string): string {
  return path.format({
    dir: path.dirname(artifactPath),
    name: path.parse(artifactPath).name,
    ext: ".md",
  });
}

export function buildExternalReviewMissFollowUpDigest(args: {
  artifactPath: string;
  artifact: ExternalReviewMissArtifact;
  activeHeadSha: string;
  localReviewSummaryPath: string | null;
  localReviewHeadSha?: string | null;
}): string {
  const missedFindings = args.artifact.findings.filter(
    (finding): finding is ExternalReviewArtifactFinding & { preventionTarget: ExternalReviewPreventionTarget } =>
      finding.classification === "missed_by_local_review" && finding.preventionTarget !== null,
  );
  const grouped = new Map<ExternalReviewPreventionTarget, ExternalReviewArtifactFinding[]>();

  for (const finding of missedFindings) {
    const existing = grouped.get(finding.preventionTarget) ?? [];
    existing.push(finding);
    grouped.set(finding.preventionTarget, existing);
  }

  const lines = [
    "# External Review Miss Follow-up Digest",
    "",
    `- Miss artifact: ${args.artifactPath}`,
    `- Local review summary: ${args.localReviewSummaryPath ?? "none"}`,
    `- Generated at: ${args.artifact.generatedAt}`,
    `- Miss analysis head SHA: ${args.artifact.headSha}`,
    `- Active PR head SHA: ${args.activeHeadSha}`,
    `- Local review artifact head SHA: ${args.localReviewHeadSha ?? "unknown"}`,
    `- Head status: ${renderHeadStatus(args.artifact.headSha, args.activeHeadSha)}`,
    `- Missed findings: ${missedFindings.length}`,
  ];

  if (missedFindings.length === 0) {
    lines.push("", "No missed external-review findings were identified in this analysis.");
    return `${lines.join("\n")}\n`;
  }

  for (const target of PREVENTION_TARGET_ORDER) {
    const findings = grouped.get(target);
    if (!findings || findings.length === 0) {
      continue;
    }

    lines.push("", `## ${preventionTargetHeading(target)} (${findings.length} finding${findings.length === 1 ? "" : "s"})`, "");
    findings.forEach((finding, index) => {
      lines.push(`### ${index + 1}. ${finding.summary}`);
      lines.push(`- Prevention target: ${target}`);
      lines.push(`- Location: ${renderLocation(finding)}`);
      lines.push(`- Reviewer: ${finding.reviewerLogin}`);
      lines.push(`- Source: ${finding.sourceKind}`);
      lines.push(`- Recommended next action: ${preventionTargetAction(target, finding)}`);
      lines.push(`- URL: ${finding.url ?? "n/a"}`);
      lines.push("");
    });
    lines.pop();
  }

  return `${lines.join("\n")}\n`;
}
