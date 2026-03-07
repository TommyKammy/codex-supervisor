import fs from "node:fs/promises";
import path from "node:path";
import { GitHubIssue, IssueRunRecord } from "./types";
import { ensureDir, truncate } from "./utils";

const NOTES_MARKER = "## Codex Working Notes";
const NOTES_TEMPLATE = [
  NOTES_MARKER,
  "- Update this section before ending each Codex turn.",
  "- Record the active hypothesis, the exact failing test/check, what changed, and the next 1-3 actions.",
  "- Keep the notes concise so future resume turns can pick up quickly.",
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
}): Promise<void> {
  const { issue, record, journalPath } = args;
  await ensureDir(path.dirname(journalPath));
  const existing = await readIssueJournal(journalPath);
  const notes = existing ? preserveCodexNotes(existing) : null;
  const snapshot = buildSupervisorSnapshot({ issue, record, journalPath });
  const nextContent = `${snapshot}\n${notes ?? NOTES_TEMPLATE}`;
  await fs.writeFile(journalPath, nextContent, "utf8");
}
