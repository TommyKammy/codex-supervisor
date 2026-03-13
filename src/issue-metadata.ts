import { GitHubIssue, SupervisorStateFile } from "./types";

export interface IssueMetadata {
  parentIssueNumber: number | null;
  executionOrderIndex: number | null;
  executionOrderTotal: number | null;
  dependsOn: number[];
  parallelGroup: string | null;
  touches: string[];
}

export interface BlockingIssue {
  issue: GitHubIssue;
  reason: string;
}

export interface ParentIssueClosureCandidate {
  parentIssue: GitHubIssue;
  childIssues: GitHubIssue[];
}

export interface ExecutionReadyLintResult {
  isExecutionReady: boolean;
  missingRequired: string[];
  missingRecommended: string[];
  riskyChangeClasses: string[];
  approvedRiskyChangeClasses: string[];
}

const RISKY_CHANGE_CLASSES = ["auth", "billing", "permissions", "ci", "migrations", "secrets"] as const;

type RiskyChangeClass = (typeof RISKY_CHANGE_CLASSES)[number];

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
    /\bworkflow(s)?\b/i,
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

function parseIssueNumberList(input: string): number[] {
  return Array.from(
    new Set(
      [...input.matchAll(/#(\d+)/g)]
        .map((match) => Number(match[1]))
        .filter((value) => Number.isInteger(value) && value > 0),
    ),
  );
}

function parseList(input: string): string[] {
  return input
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
}

function escapeRegExp(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function normalizeRiskyChangeClass(input: string): RiskyChangeClass | null {
  const normalized = input.trim().toLowerCase();
  if ((RISKY_CHANGE_CLASSES as readonly string[]).includes(normalized)) {
    return normalized as RiskyChangeClass;
  }

  return null;
}

function parseExecutionOrder(
  body: string,
): { executionOrderIndex: number; executionOrderTotal: number } | null {
  const headingMatch = body.match(
    /^\s*##\s*Execution order\s*$[\r\n]+^\s*(\d+)\s+of\s+(\d+)\s*$/im,
  );
  if (headingMatch) {
    return {
      executionOrderIndex: Number(headingMatch[1]),
      executionOrderTotal: Number(headingMatch[2]),
    };
  }

  const singleLineMatch = body.match(/^\s*Execution order:\s*(\d+)\s+of\s+(\d+)\s*$/im);
  if (!singleLineMatch) {
    return null;
  }

  return {
    executionOrderIndex: Number(singleLineMatch[1]),
    executionOrderTotal: Number(singleLineMatch[2]),
  };
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

function parseRiskyChangeApprovalList(body: string): RiskyChangeClass[] {
  const approved = new Set<RiskyChangeClass>();
  const metadataMatches = body.matchAll(
    /^\s*(?:Risky change approval|Risky changes approved|Risky change opt-in):\s*(.+)\s*$/gim,
  );
  for (const match of metadataMatches) {
    for (const value of parseList(match[1])) {
      const riskyClass = normalizeRiskyChangeClass(value);
      if (riskyClass) {
        approved.add(riskyClass);
      }
    }
  }

  const lowerBody = body.toLowerCase();
  for (const riskyClass of RISKY_CHANGE_CLASSES) {
    const sentencePatterns = [
      `explicitly approved for ${riskyClass} changes`,
      `explicitly authorize ${riskyClass} changes`,
      `explicitly opt in to ${riskyClass} changes`,
    ];
    if (sentencePatterns.some((pattern) => lowerBody.includes(pattern))) {
      approved.add(riskyClass);
    }
  }

  return [...approved].sort();
}

function detectRiskyChangeClasses(issue: Pick<GitHubIssue, "title" | "body">): RiskyChangeClass[] {
  const detectionInputs = [
    issue.title,
    findMarkdownSectionContent(issue.body, "Summary") ?? "",
    findMarkdownSectionContent(issue.body, "Scope") ?? "",
    parseIssueMetadata({ ...issue, number: 0, createdAt: "", updatedAt: "", url: "", state: "OPEN" }).touches.join(", "),
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

export function parseIssueMetadata(issue: GitHubIssue): IssueMetadata {
  const parentMatch = issue.body.match(/^\s*Part of:?\s+#(\d+)\s*$/im);
  const dependsOnMatch = issue.body.match(/^\s*Depends on:\s*(.+)\s*$/im);
  const parallelGroupMatch = issue.body.match(/^\s*Parallel group:\s*(.+)\s*$/im);
  const touchesMatch = issue.body.match(/^\s*Touches:\s*(.+)\s*$/im);
  const executionOrder = parseExecutionOrder(issue.body);

  return {
    parentIssueNumber: parentMatch ? Number(parentMatch[1]) : null,
    executionOrderIndex: executionOrder?.executionOrderIndex ?? null,
    executionOrderTotal: executionOrder?.executionOrderTotal ?? null,
    dependsOn: dependsOnMatch ? parseIssueNumberList(dependsOnMatch[1]) : [],
    parallelGroup: parallelGroupMatch ? parallelGroupMatch[1].trim() : null,
    touches: touchesMatch ? parseList(touchesMatch[1]) : [],
  };
}

export function lintExecutionReadyIssueBody(
  issue: Pick<GitHubIssue, "title" | "body">,
): ExecutionReadyLintResult {
  const riskyChangeClasses = detectRiskyChangeClasses(issue);
  const approvedRiskyChangeClasses = parseRiskyChangeApprovalList(issue.body);
  const requiredChecks: Array<{ key: string; present: boolean }> = [
    {
      key: "summary",
      present: findMarkdownSectionContent(issue.body, "Summary") !== null,
    },
    {
      key: "scope",
      present: findMarkdownSectionContent(issue.body, "Scope") !== null,
    },
    {
      key: "acceptance criteria",
      present: findMarkdownSectionContent(issue.body, "Acceptance criteria") !== null,
    },
    {
      key: "verification",
      present: findMarkdownSectionContent(issue.body, "Verification") !== null,
    },
    ...riskyChangeClasses.map((riskyClass) => ({
      key: `explicit opt-in for ${riskyClass}`,
      present: approvedRiskyChangeClasses.includes(riskyClass),
    })),
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

export function findBlockingIssue(
  issue: GitHubIssue,
  issues: GitHubIssue[],
  state: SupervisorStateFile,
): BlockingIssue | null {
  const issueByNumber = new Map(issues.map((candidate) => [candidate.number, candidate]));
  const metadata = parseIssueMetadata(issue);
  const executionOrderIndex = metadata.executionOrderIndex;

  for (const dependencyNumber of metadata.dependsOn) {
    const dependencyIssue = issueByNumber.get(dependencyNumber);
    if (!dependencyIssue) {
      continue;
    }

    if (dependencyIssue.state !== "CLOSED") {
      return {
        issue: dependencyIssue,
        reason: `depends on #${dependencyNumber}`,
      };
    }

    const dependencyRecord = state.issues[String(dependencyNumber)];
    if (!dependencyRecord || dependencyRecord.state !== "done") {
      return {
        issue: dependencyIssue,
        reason: `depends on #${dependencyNumber}`,
      };
    }
  }

  if (!metadata.parentIssueNumber || !executionOrderIndex || executionOrderIndex <= 1) {
    return null;
  }

  const predecessors = issues
    .filter((candidate) => candidate.number !== issue.number)
    .map((candidate) => ({
      issue: candidate,
      metadata: parseIssueMetadata(candidate),
    }))
    .filter(
      ({ metadata: candidateMetadata }) =>
        candidateMetadata.parentIssueNumber === metadata.parentIssueNumber &&
        candidateMetadata.executionOrderIndex !== null &&
        candidateMetadata.executionOrderIndex < executionOrderIndex,
    )
    .sort((left, right) => {
      const leftIndex = left.metadata.executionOrderIndex ?? Number.MAX_SAFE_INTEGER;
      const rightIndex = right.metadata.executionOrderIndex ?? Number.MAX_SAFE_INTEGER;
      return leftIndex - rightIndex;
    });

  for (const predecessor of predecessors) {
    if (predecessor.issue.state !== "CLOSED") {
      return {
        issue: predecessor.issue,
        reason: `execution order requires #${predecessor.issue.number} first`,
      };
    }

    const predecessorRecord = state.issues[String(predecessor.issue.number)];
    if (!predecessorRecord || predecessorRecord.state !== "done") {
      return {
        issue: predecessor.issue,
        reason: `execution order requires #${predecessor.issue.number} first`,
      };
    }
  }

  return null;
}

export function findParentIssuesReadyToClose(issues: GitHubIssue[]): ParentIssueClosureCandidate[] {
  const issueByNumber = new Map(issues.map((issue) => [issue.number, issue]));
  const childIssuesByParent = new Map<number, GitHubIssue[]>();

  for (const issue of issues) {
    const metadata = parseIssueMetadata(issue);
    if (!metadata.parentIssueNumber) {
      continue;
    }

    const siblings = childIssuesByParent.get(metadata.parentIssueNumber) ?? [];
    siblings.push(issue);
    childIssuesByParent.set(metadata.parentIssueNumber, siblings);
  }

  return Array.from(childIssuesByParent.entries())
    .map(([parentIssueNumber, childIssues]) => ({
      parentIssue: issueByNumber.get(parentIssueNumber) ?? null,
      childIssues,
    }))
    .filter(
      (
        candidate,
      ): candidate is ParentIssueClosureCandidate => candidate.parentIssue !== null,
    )
    .filter(
      ({ parentIssue, childIssues }) =>
        parentIssue.state === "OPEN" &&
        childIssues.length > 0 &&
        childIssues.every((childIssue) => childIssue.state === "CLOSED"),
    )
    .sort((left, right) => left.parentIssue.number - right.parentIssue.number);
}
