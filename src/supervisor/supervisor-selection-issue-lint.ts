import { GitHubClient } from "../github";
import { GitHubIssue } from "../core/types";
import {
  findHighRiskBlockingAmbiguity,
  hasAvailableIssueLabels,
  LABEL_GATED_POLICY_MISSING_LABELS_MESSAGE,
  LABEL_GATED_POLICY_MISSING_LABELS_REPAIR_GUIDANCE,
  lintExecutionReadyIssueBody,
  validateIssueMetadataSyntax,
} from "../issue-metadata";
import { formatExecutionReadyMissingFields } from "./supervisor-execution-policy";
import type { ClarificationBlock, ExecutionReadyLintResult } from "../issue-metadata";

export type IssueLintGitHub = Pick<GitHubClient, "getIssue">;

export interface SupervisorIssueLintDto {
  issueNumber: number;
  title: string;
  executionReady: boolean;
  missingRequired: string[];
  missingRecommended: string[];
  metadataErrors: string[];
  highRiskBlockingAmbiguity: string | null;
  repairGuidance: string[];
}

export interface RenderIssueLintOptions {
  suggest?: boolean;
}

export async function buildIssueLintDto(
  github: IssueLintGitHub,
  issueNumber: number,
): Promise<SupervisorIssueLintDto> {
  const issue = await github.getIssue(issueNumber);
  return createIssueLintDto(issue);
}

export function createIssueLintDto(issue: GitHubIssue): SupervisorIssueLintDto {
  if (!hasAvailableIssueLabels(issue)) {
    return {
      issueNumber: issue.number,
      title: issue.title,
      executionReady: false,
      missingRequired: [],
      missingRecommended: [],
      metadataErrors: [LABEL_GATED_POLICY_MISSING_LABELS_MESSAGE],
      highRiskBlockingAmbiguity: null,
      repairGuidance: [LABEL_GATED_POLICY_MISSING_LABELS_REPAIR_GUIDANCE],
    };
  }

  const readiness = lintExecutionReadyIssueBody(issue);
  const metadataErrors = validateIssueMetadataSyntax(issue);
  const clarificationBlock = findHighRiskBlockingAmbiguity(issue);

  return {
    issueNumber: issue.number,
    title: issue.title,
    executionReady: readiness.isExecutionReady,
    missingRequired: [...readiness.missingRequired],
    missingRecommended: [...readiness.missingRecommended],
    metadataErrors,
    highRiskBlockingAmbiguity: clarificationBlock?.reason ?? null,
    repairGuidance: buildIssueLintRepairGuidance(readiness, metadataErrors, clarificationBlock),
  };
}

export function renderIssueLintDto(
  dto: SupervisorIssueLintDto,
  options: RenderIssueLintOptions = {},
): string {
  const lines = [
    `issue=#${dto.issueNumber}`,
    `title=${dto.title}`,
    `execution_ready=${dto.executionReady ? "yes" : "no"}`,
    `missing_required=${
      dto.missingRequired.length > 0 ? formatExecutionReadyMissingFields(dto.missingRequired) : "none"
    }`,
    `missing_recommended=${
      dto.missingRecommended.length > 0 ? formatExecutionReadyMissingFields(dto.missingRecommended) : "none"
    }`,
    `metadata_errors=${dto.metadataErrors.length > 0 ? dto.metadataErrors.join("; ") : "none"}`,
    `high_risk_blocking_ambiguity=${dto.highRiskBlockingAmbiguity ?? "none"}`,
    ...dto.repairGuidance.map((line, index) => `repair_guidance_${index + 1}=${line}`),
  ];

  if (options.suggest) {
    lines.push(...buildIssueLintSuggestionLines(dto));
  }

  return lines.join("\n");
}

function buildIssueLintSuggestionLines(dto: SupervisorIssueLintDto): string[] {
  if (dto.executionReady && dto.metadataErrors.length === 0 && dto.missingRequired.length === 0) {
    return [
      "suggestion_mode=suggest",
      "suggestion_status=not_needed",
      "suggestion_note=Issue already has execution-ready metadata.",
    ];
  }

  if (dto.missingRequired.includes("part of")) {
    return [
      "suggestion_mode=suggest",
      "suggestion_status=needs_explicit_sequence_input",
      "suggestion_note=Sequenced-child metadata is incomplete; provide the parent issue number and confirmed order before copying a child skeleton.",
      "suggested_repair_skeleton:",
      "Part of: #<parent-issue-number>",
      "Depends on: none",
      "Parallelizable: No",
      "",
      "## Execution order",
      "<N> of <M>",
    ];
  }

  return [
    "suggestion_mode=suggest",
    "suggestion_status=standalone_default",
    "suggestion_note=Conservative standalone skeleton; replace placeholders and do not add Part of unless this issue is a sequenced child.",
    "suggested_repair_skeleton:",
    ...buildStandaloneIssueBodyLines(),
  ];
}

export function buildStandaloneIssueBodyLines(): string[] {
  return [
    "## Summary",
    "<one short paragraph describing the intended outcome>",
    "",
    "## Scope",
    "- <in-scope behavior delta>",
    "",
    "## Acceptance criteria",
    "- <observable completion check>",
    "",
    "## Verification",
    "- <exact command, test file, or manual check>",
    "",
    "Depends on: none",
    "Parallelizable: No",
    "",
    "## Execution order",
    "1 of 1",
  ];
}

export function buildStandaloneIssueBody(): string {
  return buildStandaloneIssueBodyLines().join("\n");
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
      case "depends on":
        guidance.push("Add `Depends on: none` if nothing blocks this issue, or list blocking issues as `Depends on: #123, #456`.");
        break;
      case "parallelizable":
        guidance.push("Add `Parallelizable: No` unless this issue is explicitly safe to run alongside related work.");
        break;
      case "execution order":
        guidance.push(
          "Add a `## Execution order` section with `1 of 1` for standalone work, or `N of M` for a sequenced series.",
        );
        break;
      case "part of":
        guidance.push("Add `Part of: #<number>` when this sequenced codex issue belongs to a parent epic or tracking issue.");
        break;
      default:
        break;
    }
  }

  if (metadataErrors.length > 0) {
    guidance.push(
      "Replace invalid scheduling metadata with valid `Part of: #<number>`, `Depends on: none|#<number>`, `Parallelizable: Yes|No`, and a `## Execution order` section.",
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
        guidance.push(
          "Add a `## Execution order` section with `1 of 1` for standalone work, or `N of M` for a sequenced series.",
        );
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
