import fs from "node:fs/promises";
import path from "node:path";
import { GitHubIssue, IssueRunRecord } from "./types";
import { ensureDir, truncate } from "./utils";

const NOTES_MARKER = "## Codex Working Notes";
const NOTES_TEMPLATE = [
  NOTES_MARKER,
  "### Current Handoff",
  "- Hypothesis:",
  "- Primary failure or risk:",
  "- Last focused command:",
  "- Files changed:",
  "- Next 1-3 actions:",
  "",
  "### Scratchpad",
  "- Keep this section short. The supervisor may compact older notes automatically.",
  "",
].join("\n");

function buildSupervisorSnapshot(args: {
  issue: GitHubIssue;
  record: IssueRunRecord;
  journalPath: string;
}): string {
  const { issue, record, journalPath } = args;
  const failureContext = record.last_failure_context
    ? [
        `- Category: ${record.last_failure_context.category ?? "unknown"}`,
        `- Summary: ${record.last_failure_context.summary}`,
        record.last_failure_context.command
          ? `- Command or source: ${record.last_failure_context.command}`
          : null,
        record.last_failure_context.url ? `- Reference: ${record.last_failure_context.url}` : null,
        ...(record.last_failure_context.details.length > 0
          ? ["- Details:", ...record.last_failure_context.details.map((detail) => `  - ${detail}`)]
          : []),
      ]
        .filter(Boolean)
        .join("\n")
    : "- None recorded.";

  return [
    `# Issue #${issue.number}: ${issue.title}`,
    "",
    "## Supervisor Snapshot",
    `- Issue URL: ${issue.url}`,
    `- Branch: ${record.branch}`,
    `- Workspace: ${record.workspace}`,
    `- Journal: ${journalPath}`,
    `- Current phase: ${record.state}`,
    `- Attempt count: ${record.attempt_count}`,
    `- Last head SHA: ${record.last_head_sha ?? "unknown"}`,
    `- Blocked reason: ${record.blocked_reason ?? "none"}`,
    `- Last failure signature: ${record.last_failure_signature ?? "none"}`,
    `- Repeated failure signature count: ${record.repeated_failure_signature_count}`,
    `- Updated at: ${record.updated_at}`,
    "",
    "## Latest Codex Summary",
    record.last_codex_summary ? truncate(record.last_codex_summary, 4000) : "- None yet.",
    "",
    "## Active Failure Context",
    failureContext,
    "",
  ].join("\n");
}

function preserveCodexNotes(existing: string): string | null {
  const markerIndex = existing.indexOf(NOTES_MARKER);
  if (markerIndex < 0) {
    return null;
  }

  return existing.slice(markerIndex);
}

function compactCodexNotes(notes: string, maxChars: number): string {
  if (notes.length <= maxChars) {
    return notes;
  }

  const headerLines = [
    NOTES_MARKER,
    "### Current Handoff",
    "- Older scratchpad entries were compacted by codex-supervisor to keep resume context small.",
    "",
  ];
  const header = headerLines.join("\n");
  const tailBudget = Math.max(0, maxChars - header.length - 1);

  const lines = notes.split("\n");
  const preservedTail: string[] = [];
  let currentLength = 0;

  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = lines[index];
    const nextLength = currentLength + line.length + 1;
    if (preservedTail.length > 0 && nextLength > tailBudget) {
      break;
    }

    preservedTail.unshift(line);
    currentLength = nextLength;
  }

  const compacted = [
    ...headerLines,
    ...preservedTail.filter((line) => line.trim() !== NOTES_MARKER),
  ].join("\n");

  return compacted.length <= maxChars ? compacted : compacted.slice(0, maxChars);
}

export function hasMeaningfulJournalHandoff(content: string | null): boolean {
  if (!content) {
    return false;
  }

  const notes = preserveCodexNotes(content);
  if (!notes) {
    return false;
  }

  const normalized = notes.trim();
  return normalized !== NOTES_TEMPLATE.trim();
}

export function issueJournalPath(workspacePath: string, relativePath: string): string {
  return path.resolve(workspacePath, relativePath);
}

export async function readIssueJournal(journalPath: string): Promise<string | null> {
  try {
    return await fs.readFile(journalPath, "utf8");
  } catch (error) {
    const maybeErr = error as NodeJS.ErrnoException;
    if (maybeErr.code === "ENOENT") {
      return null;
    }

    throw error;
  }
}

export async function syncIssueJournal(args: {
  issue: GitHubIssue;
  record: IssueRunRecord;
  journalPath: string;
  maxChars?: number;
}): Promise<void> {
  const { issue, record, journalPath, maxChars = 6000 } = args;
  await ensureDir(path.dirname(journalPath));
  const existing = await readIssueJournal(journalPath);
  const notes = existing ? preserveCodexNotes(existing) : null;
  const snapshot = buildSupervisorSnapshot({ issue, record, journalPath });
  const nextContent = `${snapshot}\n${notes ? compactCodexNotes(notes, maxChars) : NOTES_TEMPLATE}`;
  await fs.writeFile(journalPath, nextContent, "utf8");
}
