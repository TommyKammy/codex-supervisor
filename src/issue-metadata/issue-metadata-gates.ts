import type { GitHubIssue } from "../core/types";
import {
  parseExecutionOrder,
} from "./issue-metadata-parser";
import {
  detectRiskyChangeClasses,
  parseRiskyChangeApprovalList,
  type RiskyChangeClass,
} from "./issue-metadata-risky-policy";

export type { RiskyChangeClass } from "./issue-metadata-risky-policy";

export interface ExecutionReadyLintResult {
  isExecutionReady: boolean;
  missingRequired: string[];
  missingRecommended: string[];
  riskyChangeClasses: RiskyChangeClass[];
  approvedRiskyChangeClasses: RiskyChangeClass[];
}

export interface ClarificationBlock {
  ambiguityClasses: HighRiskAmbiguityClass[];
  riskyChangeClasses: RiskyChangeClass[];
  reason: string;
}

const HIGH_RISK_AMBIGUITY_CLASSES = ["open_question", "unresolved_choice", "operator_confirmation"] as const;

export type HighRiskAmbiguityClass = (typeof HIGH_RISK_AMBIGUITY_CLASSES)[number];

const HIGH_RISK_AMBIGUITY_SIGNALS: Record<HighRiskAmbiguityClass, RegExp[]> = {
  open_question: [/\b(?:tbd|to be decided|open question|pending decision)\b/i, /\?{2,}/],
  unresolved_choice: [
    /\b(?:decide|determine)\s+(?:whether|which|between)\b/i,
    /\b(?:choose|pick|select)\s+between\b/i,
    /\bwhether to\b/i,
    /\bwhich (?:approach|option|one|path|flow|strategy)\b/i,
  ],
  operator_confirmation: [
    /\b(?:clarify with|confirm with|wait(?:ing)? for|needs? confirmation from|ask [^.:\n]+ before)\b/i,
  ],
};

function escapeRegExp(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function findMarkdownSectionContent(body: string, title: string): string | null {
  const lines = body.split(/\r?\n/);
  const headingPattern = new RegExp(`^\\s*##\\s*${escapeRegExp(title)}\\s*$`, "i");

  for (let index = 0; index < lines.length; index += 1) {
    if (!headingPattern.test(lines[index])) {
      continue;
    }

    const sectionLines: string[] = [];
    for (let cursor = index + 1; cursor < lines.length; cursor += 1) {
      if (/^\s*##\s*\S/.test(lines[cursor])) {
        break;
      }

      sectionLines.push(lines[cursor]);
    }

    const content = sectionLines.join("\n").trim();
    return content.length > 0 ? content : null;
  }

  return null;
}

function extractListItems(content: string): string[] {
  return content
    .split(/\r?\n/)
    .filter((line) => /^\s*(?:[-*]|\d+\.)\s+\S/.test(line))
    .map((line) => line.replace(/^\s*(?:[-*]|\d+\.)\s+/, "").trim());
}

function hasScopeBoundary(content: string): boolean {
  const listItems = extractListItems(content);
  if (listItems.length === 0) {
    return false;
  }

  const boundaryPattern =
    /\b(?:keep|leave|avoid|without|exclude|out of scope|do not|don't|unchanged|only|preserve|skip)\b/i;
  if (listItems.some((item) => boundaryPattern.test(item))) {
    return true;
  }

  return listItems.length === 1 && listItems[0].split(/\s+/).length >= 4;
}

function hasConcreteVerificationTarget(content: string): boolean {
  const listItems = extractListItems(content);
  if (listItems.length === 0) {
    return false;
  }

  const genericOnlyPatterns = [
    /^run tests$/i,
    /^manual verification$/i,
    /^verify manually$/i,
    /^smoke test$/i,
    /^confirm it works$/i,
  ];
  const genericOnly = listItems.every((item) => genericOnlyPatterns.some((pattern) => pattern.test(item)));
  if (genericOnly) {
    return false;
  }

  const concreteTargetPattern =
    /`[^`]+`|(?:^|\s)(?:npm|pnpm|yarn|bun|npx|node|pytest|cargo|go test|bundle exec|mix test|mvn|gradle|dotnet|phpunit|rspec|vitest|jest|playwright|cypress)\b|[A-Za-z0-9_./-]+\.(?:test|spec)\.[A-Za-z0-9]+|src\/[A-Za-z0-9_./-]+/i;
  if (listItems.some((item) => concreteTargetPattern.test(item))) {
    return true;
  }

  return listItems.some((item) => item.split(/\s+/).length >= 5);
}

function hasLabel(issue: Pick<GitHubIssue, "labels">, labelName: string): boolean {
  return (issue.labels ?? []).some((label) => label.name.trim().toLowerCase() === labelName);
}

function hasExplicitMetadataLine(body: string, fieldName: string): boolean {
  return new RegExp(`^\\s*${escapeRegExp(fieldName)}:\\s*\\S.*$`, "im").test(body);
}

export function lintExecutionReadyIssueBody(
  issue: Pick<GitHubIssue, "title" | "body" | "labels">,
): ExecutionReadyLintResult {
  const summaryContent = findMarkdownSectionContent(issue.body, "Summary");
  const scopeContent = findMarkdownSectionContent(issue.body, "Scope");
  const verificationContent = findMarkdownSectionContent(issue.body, "Verification");
  const executionOrder = parseExecutionOrder(issue.body);
  const isCodexLabeled = hasLabel(issue, "codex");
  const requiresPartOf = executionOrder !== null
    && !(executionOrder.executionOrderIndex === 1 && executionOrder.executionOrderTotal === 1);
  const riskyChangeClasses = detectRiskyChangeClasses(issue);
  const approvedRiskyChangeClasses = parseRiskyChangeApprovalList(issue.body);
  const requiredChecks: Array<{ key: string; present: boolean }> = [
    {
      key: "summary",
      present: summaryContent !== null,
    },
    {
      key: "scope",
      present: scopeContent !== null,
    },
    {
      key: "acceptance criteria",
      present: findMarkdownSectionContent(issue.body, "Acceptance criteria") !== null,
    },
    {
      key: "verification",
      present: verificationContent !== null,
    },
    ...(isCodexLabeled
      ? [
        {
          key: "depends on",
          present: hasExplicitMetadataLine(issue.body, "Depends on"),
        },
        {
          key: "parallelizable",
          present: hasExplicitMetadataLine(issue.body, "Parallelizable"),
        },
        {
          key: "execution order",
          present: executionOrder !== null,
        },
        ...(requiresPartOf
          ? [
            {
              key: "part of",
              present: /^\s*Part of:?\s+#\d+\s*$/im.test(issue.body),
            },
          ]
          : []),
      ]
      : []),
  ];
  const recommendedChecks: Array<{ key: string; present: boolean }> = [
    ...(!isCodexLabeled
      ? [
        {
          key: "depends on",
          present: /^\s*Depends on:\s*.+$/im.test(issue.body),
        },
        {
          key: "execution order",
          present: executionOrder !== null,
        },
      ]
      : []),
    {
      key: "scope boundary",
      present: scopeContent === null || hasScopeBoundary(scopeContent),
    },
    {
      key: "verification target",
      present: verificationContent === null || hasConcreteVerificationTarget(verificationContent),
    },
  ];

  const missingRequired = requiredChecks
    .filter((check) => !check.present)
    .map((check) => check.key);
  const missingRecommended = recommendedChecks
    .filter((check) => !check.present)
    .map((check) => check.key);

  return {
    isExecutionReady: missingRequired.length === 0,
    missingRequired,
    missingRecommended,
    riskyChangeClasses,
    approvedRiskyChangeClasses,
  };
}

export function findHighRiskBlockingAmbiguity(
  issue: Pick<GitHubIssue, "title" | "body">,
): ClarificationBlock | null {
  const riskyChangeClasses = detectRiskyChangeClasses(issue);
  if (riskyChangeClasses.length === 0) {
    return null;
  }

  const ambiguityInputs = [
    issue.title,
    findMarkdownSectionContent(issue.body, "Summary") ?? "",
    findMarkdownSectionContent(issue.body, "Scope") ?? "",
    findMarkdownSectionContent(issue.body, "Acceptance criteria") ?? "",
  ];
  const ambiguityClasses = HIGH_RISK_AMBIGUITY_CLASSES.filter((ambiguityClass) =>
    ambiguityInputs.some((input) =>
      HIGH_RISK_AMBIGUITY_SIGNALS[ambiguityClass].some((pattern) => pattern.test(input)),
    ),
  );

  if (ambiguityClasses.length === 0) {
    return null;
  }

  return {
    ambiguityClasses,
    riskyChangeClasses,
    reason: `high-risk blocking ambiguity (${ambiguityClasses.join(", ")}) for ${riskyChangeClasses.join(", ")} changes`,
  };
}
