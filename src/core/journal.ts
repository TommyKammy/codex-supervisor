import fs from "node:fs/promises";
import path from "node:path";
import { GitHubIssue, IssueRunRecord } from "./types";
import { ensureDir, truncate, writeFileAtomic } from "./utils";

const NOTES_MARKER = "## Codex Working Notes";
const DURABLE_PATH_TOKEN_PATTERN =
  /(?:(?<=["'`])(?:\/[^"'`<>\n]+|[A-Za-z]:[\\/][^"'`<>\n]+)(?=["'`])|(?<![A-Za-z0-9+./\\:-])(?:\/[^\s"'`<>\[\]{}()]+(?:[\\/][^\s"'`<>\[\]{}()]+)*|[A-Za-z]:[\\/][^\s"'`<>\[\]{}()]+(?:[\\/][^\s"'`<>\[\]{}()]+)*))/g;
const LEADING_PATH_PUNCTUATION = "([{";
const TRAILING_PATH_PUNCTUATION = ")]},;:!?";
const REDACTED_LOCAL_PATH = "<redacted-local-path>";
const NON_PORTABLE_LOCAL_PATH_PREFIXES = [
  "/home/",
  "/Users/",
  "/tmp/",
  "/var/",
  "/private/tmp/",
  "/private/var/",
  "/run/",
  "/dev/",
  "/mnt/",
  "/Volumes/",
] as const;
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

function stripTokenPunctuation(token: string): { leading: string; core: string; trailing: string } {
  let leading = "";
  let trailing = "";
  let core = token;

  while (core.length > 0 && LEADING_PATH_PUNCTUATION.includes(core[0])) {
    leading += core[0];
    core = core.slice(1);
  }

  while (core.length > 0 && TRAILING_PATH_PUNCTUATION.includes(core[core.length - 1])) {
    trailing = `${core[core.length - 1]}${trailing}`;
    core = core.slice(0, -1);
  }

  if (core.endsWith(".") && /(?:^\/|^[A-Za-z]:[\\/])/.test(core)) {
    core = core.slice(0, -1);
    trailing = `.${trailing}`;
  }

  return { leading, core, trailing };
}

function normalizeWorkspaceAbsolutePath(candidate: string, workspacePath: string): string | null {
  const normalizedCandidate = candidate.replace(/\\/g, "/");
  const normalizedWorkspace = path.resolve(workspacePath).replace(/\\/g, "/");
  const compareCandidate = /^[A-Za-z]:\//.test(normalizedCandidate) ? normalizedCandidate.toLowerCase() : normalizedCandidate;
  const compareWorkspace = /^[A-Za-z]:\//.test(normalizedWorkspace) ? normalizedWorkspace.toLowerCase() : normalizedWorkspace;

  if (compareCandidate !== compareWorkspace && !compareCandidate.startsWith(`${compareWorkspace}/`)) {
    return null;
  }

  const relativePath = path.posix.relative(normalizedWorkspace, normalizedCandidate);
  if (relativePath.startsWith("../") || relativePath === "..") {
    return null;
  }

  return relativePath.length === 0 ? "." : relativePath;
}

function isNonPortableLocalAbsolutePath(candidate: string): boolean {
  const normalizedCandidate = candidate.replace(/\\/g, "/");
  return (
    NON_PORTABLE_LOCAL_PATH_PREFIXES.some((prefix) => normalizedCandidate.startsWith(prefix)) ||
    /^[A-Za-z]:\//.test(normalizedCandidate)
  );
}

function normalizeDurableJournalText(text: string | null | undefined, workspacePath: string): string {
  if (!text) {
    return text ?? "";
  }

  return text.replace(DURABLE_PATH_TOKEN_PATTERN, (token) => {
    const { leading, core, trailing } = stripTokenPunctuation(token);
    if (core.length === 0) {
      return token;
    }

    const workspaceRelativePath = normalizeWorkspaceAbsolutePath(core, workspacePath);
    if (workspaceRelativePath) {
      return `${leading}${workspaceRelativePath}${trailing}`;
    }

    if (isNonPortableLocalAbsolutePath(core)) {
      return `${leading}${REDACTED_LOCAL_PATH}${trailing}`;
    }

    return token;
  });
}

function truncateSummaryBody(summary: string, maxLength: number): string {
  if (summary.length === 0 || maxLength <= 0) {
    return "";
  }

  if (summary.length <= maxLength) {
    return summary;
  }

  if (maxLength <= 3) {
    return summary.slice(0, maxLength);
  }

  return truncate(summary, maxLength) ?? "";
}

function renderLatestCodexSummary(summary: string | null, failureSignature: string | null): string {
  if (!summary) {
    return "- None yet.";
  }

  const normalizedFailureSignature = failureSignature ?? "none";
  const failureSignatureLine = `Failure signature: ${normalizedFailureSignature}`;
  if (failureSignatureLine.length >= 4000) {
    return truncate(failureSignatureLine, 4000) ?? failureSignatureLine;
  }

  const body = summary
    .trimEnd()
    .split("\n")
    .filter((line) => !/^Failure signature:/i.test(line.trim()))
    .join("\n")
    .trimEnd();
  const bodyBudget = Math.max(0, 4000 - failureSignatureLine.length - (body.length > 0 ? 1 : 0));
  const truncatedBody = truncateSummaryBody(body, bodyBudget);

  return truncatedBody.length > 0 ? `${truncatedBody}\n${failureSignatureLine}` : failureSignatureLine;
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
  const sanitize = (value: string | null | undefined): string => normalizeDurableJournalText(value, record.workspace);
  const failureContext = record.last_failure_context
    ? [
        `- Category: ${record.last_failure_context.category ?? "unknown"}`,
        `- Summary: ${sanitize(record.last_failure_context.summary)}`,
        record.last_failure_context.command
          ? `- Command or source: ${sanitize(record.last_failure_context.command)}`
          : null,
        record.last_failure_context.url ? `- Reference: ${sanitize(record.last_failure_context.url)}` : null,
        ...(record.last_failure_context.details.length > 0
          ? ["- Details:", ...record.last_failure_context.details.map((detail) => `  - ${sanitize(detail)}`)]
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
    renderLatestCodexSummary(sanitize(record.last_codex_summary), record.last_failure_signature),
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
  const notes = existing ? normalizeDurableJournalText(preserveCodexNotes(existing), record.workspace) : null;
  const snapshot = buildSupervisorSnapshot({ issue, record, journalPath });
  const nextContent = `${snapshot}\n${notes ? compactCodexNotes(notes, maxChars) : NOTES_TEMPLATE}`;
  await writeFileAtomic(journalPath, nextContent);
}
