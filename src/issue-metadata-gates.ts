import type { GitHubIssue } from "./types";
import {
  parseExecutionOrder,
  parseRiskyChangeApprovalList,
  parseTouchesList,
} from "./issue-metadata-parser";

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

const RISKY_CHANGE_CLASSES = ["auth", "billing", "permissions", "ci", "migrations", "secrets"] as const;
const HIGH_RISK_AMBIGUITY_CLASSES = ["open_question", "unresolved_choice", "operator_confirmation"] as const;

export type RiskyChangeClass = (typeof RISKY_CHANGE_CLASSES)[number];
export type HighRiskAmbiguityClass = (typeof HIGH_RISK_AMBIGUITY_CLASSES)[number];

const RISKY_CHANGE_SIGNALS: Record<RiskyChangeClass, RegExp[]> = {
  auth: [
    /\bauth\b/i,
    /\bauthentication\b/i,
    /\boauth\b/i,
    /\blogin\b/i,
    /\bpasswords?\b/i,
    /\bsessions?\b/i,
    /\btokens?\b/i,
    /\bsso\b/i,
  ],
  billing: [
    /\bbilling\b/i,
    /\binvoices?\b/i,
    /\bsubscriptions?\b/i,
    /\bpayments?\b/i,
    /\bcharges?\b/i,
    /\bstripe\b/i,
  ],
  permissions: [
    /\bpermission(s)?\b/i,
    /\brbac\b/i,
    /\baccess control\b/i,
    /\bacl\b/i,
    /\brole(s)?\b/i,
  ],
  ci: [
    /\bci\b/i,
    /\bgithub actions\b/i,
    /\.github\/workflows\b/i,
    /\bci workflows?\b/i,
    /\bworkflow files?\b/i,
    /\bpipeline(s)?\b/i,
  ],
  migrations: [
    /\bmigration(s)?\b/i,
    /\bmigrate\b/i,
    /\bprisma migrate\b/i,
    /\bdatabase schema\b/i,
    /\bschema change(s)?\b/i,
    /\bddl\b/i,
  ],
  secrets: [
    /\bsecret(s)?\b/i,
    /\bcredential(s)?\b/i,
    /\bapi key(s)?\b/i,
    /\bprivate key(s)?\b/i,
    /\bsigning key(s)?\b/i,
  ],
};

const HIGH_RISK_AMBIGUITY_SIGNALS: Record<HighRiskAmbiguityClass, RegExp[]> = {
  open_question: [/\b(?:tbd|to be decided|open question|pending decision)\b/i, /\?{2,}/],
  unresolved_choice: [
    /\b(?:decide|determine|choose|select|pick)\b/i,
    /\b(?:whether to|which approach|which option)\b/i,
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

function detectRiskyChangeClasses(issue: Pick<GitHubIssue, "title" | "body">): RiskyChangeClass[] {
  const detectionInputs = [
    issue.title,
    findMarkdownSectionContent(issue.body, "Summary") ?? "",
    findMarkdownSectionContent(issue.body, "Scope") ?? "",
    parseTouchesList(issue.body).join(", "),
  ];
  const detected = new Set<RiskyChangeClass>();

  for (const riskyClass of RISKY_CHANGE_CLASSES) {
    const patterns = RISKY_CHANGE_SIGNALS[riskyClass];
    if (detectionInputs.some((input) => patterns.some((pattern) => pattern.test(input)))) {
      detected.add(riskyClass);
    }
  }

  return [...detected].sort();
}

export function lintExecutionReadyIssueBody(
  issue: Pick<GitHubIssue, "title" | "body">,
): ExecutionReadyLintResult {
  const summaryContent = findMarkdownSectionContent(issue.body, "Summary");
  const scopeContent = findMarkdownSectionContent(issue.body, "Scope");
  const verificationContent = findMarkdownSectionContent(issue.body, "Verification");
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
  ];
  const recommendedChecks: Array<{ key: string; present: boolean }> = [
    {
      key: "depends on",
      present: /^\s*Depends on:\s*.+$/im.test(issue.body),
    },
    {
      key: "execution order",
      present: parseExecutionOrder(issue.body) !== null,
    },
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
