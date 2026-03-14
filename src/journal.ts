import fs from "node:fs/promises";
import path from "node:path";
import { GitHubIssue, IssueRunRecord } from "./types";
import { ensureDir, truncate } from "./utils";

const NOTES_MARKER = "## Codex Working Notes";
const HANDOFF_FIELDS = [
  "Hypothesis",
  "What changed",
  "Current blocker",
  "Next exact step",
  "Verification gap",
  "Files touched",
  "Rollback concern",
  "Last focused command",
] as const;
type HandoffField = (typeof HANDOFF_FIELDS)[number];

const LEGACY_HANDOFF_FIELD_MAP: Record<string, HandoffField> = {
  Hypothesis: "Hypothesis",
  "What changed": "What changed",
  "Primary failure or risk": "Current blocker",
  "Current blocker": "Current blocker",
  "Next 1-3 actions": "Next exact step",
  "Next exact step": "Next exact step",
  "Verification gap": "Verification gap",
  "Files changed": "Files touched",
  "Files touched": "Files touched",
  "Rollback concern": "Rollback concern",
  "Last focused command": "Last focused command",
};

function buildNotesTemplate(): string {
  return [
    NOTES_MARKER,
    "### Current Handoff",
    ...HANDOFF_FIELDS.map((field) => `- ${field}:`),
    "",
    "### Scratchpad",
    "- Keep this section short. The supervisor may compact older notes automatically.",
    "",
  ].join("\n");
}

const NOTES_TEMPLATE = buildNotesTemplate();

function splitCurrentHandoff(notes: string): { handoffLines: string[]; remainderLines: string[] } {
  const lines = notes.split("\n");
  const handoffHeaderIndex = lines.findIndex((line) => line.trim() === "### Current Handoff");
  if (handoffHeaderIndex < 0) {
    return { handoffLines: [], remainderLines: lines };
  }

  let handoffEndIndex = lines.length;
  for (let index = handoffHeaderIndex + 1; index < lines.length; index += 1) {
    if (/^###\s+/.test(lines[index])) {
      handoffEndIndex = index;
      break;
    }
  }

  return {
    handoffLines: lines.slice(handoffHeaderIndex + 1, handoffEndIndex),
    remainderLines: lines.slice(handoffEndIndex),
  };
}

function normalizeCurrentHandoff(lines: string[]): string[] {
  const values = new Map<HandoffField, string>();
  const extras: string[] = [];
  let activeField: HandoffField | null = null;

  for (const line of lines) {
    const fieldMatch = line.match(/^- ([^:]+):(.*)$/);
    if (fieldMatch) {
      const rawLabel = fieldMatch[1].trim();
      const mappedField = LEGACY_HANDOFF_FIELD_MAP[rawLabel];
      const rawValue = fieldMatch[2].trim();

      activeField = mappedField ?? null;
      if (!mappedField) {
        extras.push(line);
        continue;
      }

      if (rawValue.length > 0) {
        values.set(mappedField, rawValue);
      } else if (!values.has(mappedField)) {
        values.set(mappedField, "");
      }
      continue;
    }

    if (activeField) {
      const trimmed = line.trim();
      if (trimmed.length === 0) {
        activeField = null;
        continue;
      }

      const continuation = trimmed.replace(/^[-*]\s+/, "").trim();
      if (continuation.length > 0) {
        const previous = values.get(activeField)?.trim() ?? "";
        if (activeField === "Next exact step" && previous.length > 0) {
          continue;
        }

        values.set(activeField, previous.length > 0 ? `${previous} ${continuation}` : continuation);
        continue;
      }
    }

    extras.push(line);
  }

  return [
    "### Current Handoff",
    ...HANDOFF_FIELDS.map((field) => `- ${field}: ${values.get(field) ?? ""}`.trimEnd()),
    ...extras.filter((line) => line.trim().length > 0),
  ];
}

function normalizeCodexNotes(notes: string): string {
  const { handoffLines, remainderLines } = splitCurrentHandoff(notes);
  if (handoffLines.length === 0) {
    const lines = notes.split("\n");
    const scratchpadIndex = lines.findIndex((line) => line.trim() === "### Scratchpad");
    const fallbackRemainder =
      scratchpadIndex >= 0
        ? lines.slice(scratchpadIndex)
        : ["### Scratchpad", "- Keep this section short. The supervisor may compact older notes automatically.", ""];
    return `${[NOTES_MARKER, "### Current Handoff", ...HANDOFF_FIELDS.map((field) => `- ${field}:`), "", ...fallbackRemainder]
      .join("\n")
      .replace(/\n{3,}/g, "\n\n")
      .trimEnd()}\n`;
  }

  const normalized = [NOTES_MARKER, ...normalizeCurrentHandoff(handoffLines)];
  const cleanedRemainder = remainderLines.length > 0 ? remainderLines : ["", "### Scratchpad", "- Keep this section short. The supervisor may compact older notes automatically.", ""];
  return `${[...normalized, ...cleanedRemainder].join("\n").replace(/\n{3,}/g, "\n\n").trimEnd()}\n`;
}

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
    `- Attempt count: ${record.attempt_count} (implementation=${record.implementation_attempt_count}, repair=${record.repair_attempt_count})`,
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

  const headerLines = normalizeCodexNotes(NOTES_TEMPLATE).trimEnd().split("\n");
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

  const normalized = normalizeCodexNotes(notes).trim();
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
  const nextContent = `${snapshot}\n${notes ? compactCodexNotes(normalizeCodexNotes(notes), maxChars) : NOTES_TEMPLATE}`;
  await fs.writeFile(journalPath, nextContent, "utf8");
}
