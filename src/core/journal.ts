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
const HANDOFF_NO_VALUE_PATTERN = /^(none|none\.|no blocker|no blocker\.|n\/a|na|unknown)$/i;

export interface IssueJournalHandoff {
  hypothesis: string | null;
  whatChanged: string | null;
  currentBlocker: string | null;
  nextExactStep: string | null;
  verificationGap: string | null;
  filesTouched: string | null;
  rollbackConcern: string | null;
  lastFocusedCommand: string | null;
}

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
  let preservingNextStepExtras = false;

  for (const line of lines) {
    const fieldMatch = line.match(/^- ([^:]+):(.*)$/);
    if (fieldMatch) {
      const rawLabel = fieldMatch[1].trim();
      const mappedField = LEGACY_HANDOFF_FIELD_MAP[rawLabel];
      const rawValue = fieldMatch[2].trim();

      activeField = mappedField ?? null;
      preservingNextStepExtras = false;
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
        preservingNextStepExtras = false;
        continue;
      }

      if (preservingNextStepExtras) {
        extras.push(line);
        continue;
      }

      const isBulletItem = /^[-*]\s+/.test(trimmed);
      const continuation = trimmed.replace(/^[-*]\s+/, "").trim();
      if (continuation.length > 0) {
        const previous = values.get(activeField)?.trim() ?? "";
        if (activeField === "Next exact step" && previous.length > 0 && isBulletItem) {
          extras.push(line);
          preservingNextStepExtras = true;
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

function parseCurrentHandoffValues(content: string | null): Map<HandoffField, string> {
  if (!content) {
    return new Map();
  }

  const notes = preserveCodexNotes(content);
  if (!notes) {
    return new Map();
  }

  const { handoffLines } = splitCurrentHandoff(notes);
  if (handoffLines.length === 0) {
    return new Map();
  }

  const values = new Map<HandoffField, string>();
  for (const line of normalizeCurrentHandoff(handoffLines)) {
    const match = line.match(/^- ([^:]+):(.*)$/);
    if (!match) {
      continue;
    }

    const field = HANDOFF_FIELDS.find((candidate) => candidate === match[1].trim());
    if (!field) {
      continue;
    }

    values.set(field, match[2].trim());
  }

  return values;
}

function normalizeHandoffSummaryValue(value: string | undefined): string | null {
  if (!value) {
    return null;
  }

  const collapsed = value.replace(/\s+/g, " ").trim();
  if (!collapsed || HANDOFF_NO_VALUE_PATTERN.test(collapsed)) {
    return null;
  }

  return collapsed;
}

function formatTrackedJournalPath(workspacePath: string, targetPath: string): string {
  const relativePath = path.relative(workspacePath, targetPath);
  if (relativePath.length === 0) {
    return ".";
  }

  return relativePath.split(path.sep).join("/");
}

function renderLatestCodexSummary(summary: string | null, failureSignature: string | null): string {
  if (!summary) {
    return "- None yet.";
  }

  const normalizedFailureSignature = failureSignature ?? "none";
  const lines = summary.trimEnd().split("\n");
  const failureSignatureLineIndex = lines.findIndex((line) => /^Failure signature:/i.test(line.trim()));

  if (failureSignatureLineIndex >= 0) {
    lines[failureSignatureLineIndex] = `Failure signature: ${normalizedFailureSignature}`;
    const updatedSummary = lines.join("\n");
    return truncate(updatedSummary, 4000) ?? updatedSummary;
  }

  const appendedSummary = `${summary.trimEnd()}\nFailure signature: ${normalizedFailureSignature}`;
  return truncate(appendedSummary, 4000) ?? appendedSummary;
}

export function summarizeIssueJournalHandoff(content: string | null): string | null {
  const values = parseCurrentHandoffValues(content);
  const blocker = normalizeHandoffSummaryValue(values.get("Current blocker"));
  const nextStep = normalizeHandoffSummaryValue(values.get("Next exact step"));
  const summaryParts: string[] = [];

  if (blocker) {
    summaryParts.push(`blocker: ${blocker}`);
  }
  if (nextStep) {
    summaryParts.push(`next: ${nextStep}`);
  }

  return summaryParts.length > 0 ? summaryParts.join(" | ") : null;
}

export function extractIssueJournalHandoff(content: string | null): IssueJournalHandoff {
  const values = parseCurrentHandoffValues(content);
  return {
    hypothesis: normalizeHandoffSummaryValue(values.get("Hypothesis")),
    whatChanged: normalizeHandoffSummaryValue(values.get("What changed")),
    currentBlocker: normalizeHandoffSummaryValue(values.get("Current blocker")),
    nextExactStep: normalizeHandoffSummaryValue(values.get("Next exact step")),
    verificationGap: normalizeHandoffSummaryValue(values.get("Verification gap")),
    filesTouched: normalizeHandoffSummaryValue(values.get("Files touched")),
    rollbackConcern: normalizeHandoffSummaryValue(values.get("Rollback concern")),
    lastFocusedCommand: normalizeHandoffSummaryValue(values.get("Last focused command")),
  };
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
    `- Workspace: ${formatTrackedJournalPath(record.workspace, record.workspace)}`,
    `- Journal: ${formatTrackedJournalPath(record.workspace, journalPath)}`,
    `- Current phase: ${record.state}`,
    `- Attempt count: ${record.attempt_count} (implementation=${record.implementation_attempt_count}, repair=${record.repair_attempt_count})`,
    `- Last head SHA: ${record.last_head_sha ?? "unknown"}`,
    `- Blocked reason: ${record.blocked_reason ?? "none"}`,
    `- Last failure signature: ${record.last_failure_signature ?? "none"}`,
    `- Repeated failure signature count: ${record.repeated_failure_signature_count}`,
    `- Updated at: ${record.updated_at}`,
    "",
    "## Latest Codex Summary",
    renderLatestCodexSummary(record.last_codex_summary, record.last_failure_signature),
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
  const normalizedNotes = normalizeCodexNotes(notes);

  if (normalizedNotes.length <= maxChars) {
    return normalizedNotes;
  }

  const normalizedLines = normalizedNotes.trimEnd().split("\n");
  const scratchpadIndex = normalizedLines.findIndex((line) => line.trim() === "### Scratchpad");
  const headerLines =
    scratchpadIndex >= 0 ? normalizedLines.slice(0, scratchpadIndex + 1) : normalizedLines;
  const tailSourceLines = scratchpadIndex >= 0 ? normalizedLines.slice(scratchpadIndex + 1) : [];

  const header = headerLines.join("\n");
  if (header.length >= maxChars) {
    return header.slice(0, maxChars);
  }

  const tailBudget = Math.max(0, maxChars - header.length - 1);
  const preservedTail: string[] = [];
  let currentLength = 0;

  for (let index = tailSourceLines.length - 1; index >= 0; index -= 1) {
    const line = tailSourceLines[index];
    const nextLength = currentLength + line.length + 1;
    if (preservedTail.length > 0 && nextLength > tailBudget) {
      break;
    }

    preservedTail.unshift(line);
    currentLength = nextLength;
  }

  const compacted = [...headerLines, ...preservedTail].join("\n");

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
  const nextContent = `${snapshot}\n${notes ? compactCodexNotes(notes, maxChars) : NOTES_TEMPLATE}`;
  await fs.writeFile(journalPath, nextContent, "utf8");
}
