import crypto from "node:crypto";
import { type GitHubIssue, type IssueRunRecord } from "./core/types";
import {
  findHighRiskBlockingAmbiguity,
  lintExecutionReadyIssueBody,
  parseIssueMetadata,
} from "./issue-metadata";

function normalizeInlineText(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

function normalizeMultilineText(value: string): string {
  return value
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line) => {
      const trimmed = line.trim();
      if (trimmed.length === 0) {
        return "";
      }

      const normalizedBullet = trimmed.replace(/^(?:[-*]|\d+\.)\s+/, "- ");
      return normalizedBullet.replace(/\s+/g, " ");
    })
    .reduce<string[]>((lines, line) => {
      if (line.length === 0 && lines[lines.length - 1] === "") {
        return lines;
      }

      lines.push(line);
      return lines;
    }, [])
    .join("\n")
    .trim();
}

function extractMarkdownSection(body: string, title: string): string | null {
  const lines = body.replace(/\r\n/g, "\n").split("\n");
  const headingPattern = new RegExp(`^\\s*##\\s*${title}\\s*$`, "i");

  for (let index = 0; index < lines.length; index += 1) {
    if (!headingPattern.test(lines[index])) {
      continue;
    }

    const sectionLines: string[] = [];
    for (let cursor = index + 1; cursor < lines.length; cursor += 1) {
      if (/^\s*##\s+\S/.test(lines[cursor])) {
        break;
      }

      sectionLines.push(lines[cursor]);
    }

    const normalized = normalizeMultilineText(sectionLines.join("\n"));
    return normalized.length > 0 ? normalized : null;
  }

  return null;
}

function normalizedLabels(issue: Pick<GitHubIssue, "labels">): string[] | null {
  if (issue.labels === undefined) {
    return null;
  }

  return issue.labels
    .map((label) => normalizeInlineText(label.name).toLowerCase())
    .filter(Boolean)
    .sort();
}

export function buildIssueDefinitionFingerprint(
  issue: Pick<GitHubIssue, "title" | "body" | "labels">,
): string {
  const metadata = parseIssueMetadata({
    number: 0,
    title: issue.title,
    body: issue.body,
    labels: issue.labels ?? [],
    createdAt: "",
    updatedAt: "",
    url: "",
    state: "OPEN",
  });
  const readiness = lintExecutionReadyIssueBody({
    title: issue.title,
    body: issue.body,
    labels: issue.labels ?? [],
  });
  const clarificationBlock = findHighRiskBlockingAmbiguity(issue);
  const normalizedDefinition = {
    title: normalizeInlineText(issue.title),
    labels: normalizedLabels(issue),
    sections: {
      summary: extractMarkdownSection(issue.body, "Summary"),
      scope: extractMarkdownSection(issue.body, "Scope"),
      acceptanceCriteria: extractMarkdownSection(issue.body, "Acceptance criteria"),
      verification: extractMarkdownSection(issue.body, "Verification"),
    },
    metadata: {
      parentIssueNumber: metadata.parentIssueNumber,
      executionOrderIndex: metadata.executionOrderIndex,
      executionOrderTotal: metadata.executionOrderTotal,
      dependsOn: [...metadata.dependsOn].sort((left, right) => left - right),
      parallelGroup: metadata.parallelGroup ? normalizeInlineText(metadata.parallelGroup) : null,
      touches: [...metadata.touches].map(normalizeInlineText).sort(),
    },
    readiness: {
      missingRequired: [...readiness.missingRequired].sort(),
      missingRecommended: [...readiness.missingRecommended].sort(),
      riskyChangeClasses: [...readiness.riskyChangeClasses].sort(),
      approvedRiskyChangeClasses: [...readiness.approvedRiskyChangeClasses].sort(),
    },
    clarification: clarificationBlock
      ? {
          ambiguityClasses: [...clarificationBlock.ambiguityClasses].sort(),
          riskyChangeClasses: [...clarificationBlock.riskyChangeClasses].sort(),
          reason: normalizeInlineText(clarificationBlock.reason),
        }
      : null,
  };

  return crypto.createHash("sha256").update(JSON.stringify(normalizedDefinition)).digest("hex");
}

export function issueDefinitionFreshnessPatch(
  issue: Pick<GitHubIssue, "title" | "body" | "labels" | "updatedAt">,
): Pick<IssueRunRecord, "issue_definition_fingerprint" | "issue_definition_updated_at"> {
  return {
    issue_definition_fingerprint: buildIssueDefinitionFingerprint(issue),
    issue_definition_updated_at: issue.updatedAt,
  };
}
