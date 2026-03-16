import type { GitHubIssue } from "../core/types";

const RISKY_CHANGE_CLASSES = [
  "auth",
  "billing",
  "permissions",
  "ci",
  "migrations",
  "secrets",
] as const;

export type RiskyChangeClass = (typeof RISKY_CHANGE_CLASSES)[number];

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

function parseList(input: string): string[] {
  return input
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
}

function normalizeRiskyChangeClass(input: string): RiskyChangeClass | null {
  const normalized = input.trim().toLowerCase();
  if ((RISKY_CHANGE_CLASSES as readonly string[]).includes(normalized)) {
    return normalized as RiskyChangeClass;
  }

  return null;
}

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

function parseTouchesList(body: string): string[] {
  const touchesMatch = body.match(/^\s*Touches:\s*(.+)\s*$/im);
  return touchesMatch ? parseList(touchesMatch[1]) : [];
}

export function parseRiskyChangeApprovalList(body: string): RiskyChangeClass[] {
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

export function detectRiskyChangeClasses(
  issue: Pick<GitHubIssue, "title" | "body">,
): RiskyChangeClass[] {
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
