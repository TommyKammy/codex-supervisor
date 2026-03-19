import { GitHubClient } from "../github";
import {
  findHighRiskBlockingAmbiguity,
  lintExecutionReadyIssueBody,
  validateIssueMetadataSyntax,
} from "../issue-metadata";
import { formatExecutionReadyMissingFields } from "./supervisor-execution-policy";
import type { ClarificationBlock, ExecutionReadyLintResult } from "../issue-metadata";

export type IssueLintGitHub = Pick<GitHubClient, "getIssue">;

export async function buildIssueLintSummary(
  github: IssueLintGitHub,
  issueNumber: number,
): Promise<string[]> {
  const issue = await github.getIssue(issueNumber);
  const readiness = lintExecutionReadyIssueBody(issue);
  const metadataErrors = validateIssueMetadataSyntax(issue);
  const clarificationBlock = findHighRiskBlockingAmbiguity(issue);

  return [
    `issue=#${issue.number}`,
    `title=${issue.title}`,
    `execution_ready=${readiness.isExecutionReady ? "yes" : "no"}`,
    `missing_required=${
      readiness.missingRequired.length > 0
        ? formatExecutionReadyMissingFields(readiness.missingRequired)
        : "none"
    }`,
    `missing_recommended=${
      readiness.missingRecommended.length > 0
        ? formatExecutionReadyMissingFields(readiness.missingRecommended)
        : "none"
    }`,
    `metadata_errors=${metadataErrors.length > 0 ? metadataErrors.join("; ") : "none"}`,
    `high_risk_blocking_ambiguity=${clarificationBlock?.reason ?? "none"}`,
    ...buildIssueLintRepairGuidance(readiness, metadataErrors, clarificationBlock).map(
      (line, index) => `repair_guidance_${index + 1}=${line}`,
    ),
  ];
}

function buildIssueLintRepairGuidance(
  readiness: ExecutionReadyLintResult,
  metadataErrors: string[],
  clarificationBlock: ClarificationBlock | null,
): string[] {
  const guidance: string[] = [];

  for (const missingField of readiness.missingRequired) {
    switch (missingField) {
      case "summary":
        guidance.push("Add a `## Summary` section describing the intended outcome in one short paragraph.");
        break;
      case "scope":
        guidance.push("Add a `## Scope` section with bullet points describing the in-scope work.");
        break;
      case "acceptance criteria":
        guidance.push("Add a `## Acceptance criteria` section listing the observable completion checks.");
        break;
      case "verification":
        guidance.push("Add a `## Verification` section with the exact command, test file, or manual check to run.");
        break;
      default:
        break;
    }
  }

  if (metadataErrors.length > 0) {
    guidance.push(
      "Replace invalid scheduling metadata with valid `Part of: #<number>`, `Depends on: none|#<number>`, `Execution order: N of M`, and `Parallelizable: Yes|No` lines.",
    );
  }

  if (clarificationBlock) {
    for (const ambiguityClass of clarificationBlock.ambiguityClasses) {
      switch (ambiguityClass) {
        case "unresolved_choice":
          if (clarificationBlock.riskyChangeClasses.includes("auth")) {
            guidance.push(
              "Rewrite the issue to pick one auth path, remove the unresolved choice, and state the approved outcome explicitly.",
            );
          } else {
            guidance.push(
              "Rewrite the issue to pick one implementation path, remove the unresolved choice, and state the approved outcome explicitly.",
            );
          }
          break;
        case "open_question":
          guidance.push("Replace the open question with a concrete decision or move it out of the execution issue before retrying.");
          break;
        case "operator_confirmation":
          guidance.push("Record the required operator confirmation in the issue, then rewrite the task as an already-approved change.");
          break;
        default:
          break;
      }
    }
  }

  for (const missingField of readiness.missingRecommended) {
    switch (missingField) {
      case "depends on":
        guidance.push("Add `Depends on: none` if nothing blocks this issue, or list blocking issues as `Depends on: #123, #456`.");
        break;
      case "execution order":
        guidance.push("Add `Execution order: 1 of 1` if this issue stands alone, or `Execution order: N of M` for a sequenced series.");
        break;
      case "scope boundary":
        guidance.push("Add one `## Scope` bullet that says what stays unchanged, excluded, or out of scope.");
        break;
      case "verification target":
        guidance.push("Update `## Verification` so at least one step names the exact command, test file, or manual target.");
        break;
      default:
        break;
    }
  }

  return guidance;
}
