import fs from "node:fs/promises";
import path from "node:path";
import { ensureDir, nowIso, readJsonIfExists, writeJsonAtomic } from "./core/utils";

export interface InterruptedTurnMarker {
  issueNumber: number;
  state: string;
  startedAt: string;
}

export function interruptedTurnMarkerPath(workspacePath: string): string {
  return path.join(workspacePath, ".codex-supervisor", "turn-in-progress.json");
}

export async function writeInterruptedTurnMarker(args: {
  workspacePath: string;
  issueNumber: number;
  state: string;
}): Promise<InterruptedTurnMarker> {
  const marker: InterruptedTurnMarker = {
    issueNumber: args.issueNumber,
    state: args.state,
    startedAt: nowIso(),
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

  return {
    issueNumber: marker.issueNumber,
    state: marker.state,
    startedAt: marker.startedAt,
  };
}

export async function clearInterruptedTurnMarker(workspacePath: string): Promise<void> {
  await fs.rm(interruptedTurnMarkerPath(workspacePath), { force: true });
}
