import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { ensureDir, nowIso, readJsonIfExists, writeJsonAtomic } from "./core/utils";

export interface InterruptedTurnJournalFingerprint {
  exists: boolean;
  sha256: string | null;
}

export interface InterruptedTurnMarker {
  issueNumber: number;
  state: string;
  startedAt: string;
  journalFingerprint: InterruptedTurnJournalFingerprint | null;
}

export function interruptedTurnMarkerPath(workspacePath: string): string {
  return path.join(workspacePath, ".codex-supervisor", "turn-in-progress.json");
}

export async function captureIssueJournalFingerprint(journalPath: string): Promise<InterruptedTurnJournalFingerprint> {
  try {
    const journalContent = await fs.readFile(journalPath, "utf8");
    return {
      exists: true,
      sha256: createHash("sha256").update(journalContent).digest("hex"),
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return {
        exists: false,
        sha256: null,
      };
    }
    throw error;
  }
}

export function sameIssueJournalFingerprint(
  left: InterruptedTurnJournalFingerprint | null,
  right: InterruptedTurnJournalFingerprint | null,
): boolean {
  if (!left || !right) {
    return left === right;
  }

  return left.exists === right.exists && left.sha256 === right.sha256;
}

export async function writeInterruptedTurnMarker(args: {
  workspacePath: string;
  issueNumber: number;
  state: string;
  journalFingerprint: InterruptedTurnJournalFingerprint;
}): Promise<InterruptedTurnMarker> {
  const marker: InterruptedTurnMarker = {
    issueNumber: args.issueNumber,
    state: args.state,
    startedAt: nowIso(),
    journalFingerprint: args.journalFingerprint,
  };
  const markerPath = interruptedTurnMarkerPath(args.workspacePath);
  await ensureDir(path.dirname(markerPath));
  await writeJsonAtomic(markerPath, marker);
  return marker;
}

export async function readInterruptedTurnMarker(workspacePath: string): Promise<InterruptedTurnMarker | null> {
  const marker = await readJsonIfExists<Partial<InterruptedTurnMarker>>(interruptedTurnMarkerPath(workspacePath));
  if (!marker) {
    return null;
  }

  if (
    typeof marker.issueNumber !== "number" ||
    !Number.isFinite(marker.issueNumber) ||
    typeof marker.state !== "string" ||
    marker.state.trim() === "" ||
    typeof marker.startedAt !== "string" ||
    marker.startedAt.trim() === ""
  ) {
    return null;
  }

  const rawJournalFingerprint = marker.journalFingerprint;
  const journalFingerprint =
    rawJournalFingerprint &&
    typeof rawJournalFingerprint === "object" &&
    typeof rawJournalFingerprint.exists === "boolean" &&
    (typeof rawJournalFingerprint.sha256 === "string" || rawJournalFingerprint.sha256 === null)
      ? {
          exists: rawJournalFingerprint.exists,
          sha256: rawJournalFingerprint.sha256,
        }
      : null;

  return {
    issueNumber: marker.issueNumber,
    state: marker.state,
    startedAt: marker.startedAt,
    journalFingerprint,
  };
}

export async function clearInterruptedTurnMarker(workspacePath: string): Promise<void> {
  await fs.rm(interruptedTurnMarkerPath(workspacePath), { force: true });
}
