import fs from "node:fs/promises";
import path from "node:path";
import { ensureDir } from "../core/utils";
import type { SupervisorConfig } from "../core/types";

interface ReconciliationPhaseSnapshot {
  phase: string;
  startedAt: string;
  targetIssueNumber?: number | null;
  targetPrNumber?: number | null;
  waitStep?: string | null;
}

export interface CurrentReconciliationPhaseSnapshot {
  phase: string;
  startedAt: string | null;
  targetIssueNumber: number | null;
  targetPrNumber: number | null;
  waitStep: string | null;
}

export interface ReconciliationProgressUpdate {
  phase: string;
  targetIssueNumber?: number | null;
  targetPrNumber?: number | null;
  waitStep?: string | null;
}

export function reconciliationPhasePath(config: Pick<SupervisorConfig, "repoPath">): string {
  return path.join(config.repoPath, ".codex-supervisor", "current-reconciliation-phase.json");
}

export async function writeCurrentReconciliationPhase(
  config: Pick<SupervisorConfig, "repoPath">,
  progress: string | ReconciliationProgressUpdate,
): Promise<void> {
  const snapshotPath = reconciliationPhasePath(config);
  await ensureDir(path.dirname(snapshotPath));
  const startedAt = (await readCurrentReconciliationPhaseSnapshot(config))?.startedAt ?? new Date(Date.now()).toISOString();
  const nextProgress = typeof progress === "string" ? { phase: progress } : progress;
  await fs.writeFile(
    snapshotPath,
    `${JSON.stringify({
      phase: nextProgress.phase,
      startedAt,
      targetIssueNumber: nextProgress.targetIssueNumber ?? null,
      targetPrNumber: nextProgress.targetPrNumber ?? null,
      waitStep: nextProgress.waitStep ?? null,
    } satisfies ReconciliationPhaseSnapshot)}\n`,
    "utf8",
  );
}

export async function clearCurrentReconciliationPhase(
  config: Pick<SupervisorConfig, "repoPath">,
): Promise<void> {
  try {
    await fs.rm(reconciliationPhasePath(config));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      throw error;
    }
  }
}

export async function readCurrentReconciliationPhase(
  config: Pick<SupervisorConfig, "repoPath">,
): Promise<string | null> {
  const snapshot = await readCurrentReconciliationPhaseSnapshot(config);
  return snapshot?.phase ?? null;
}

export async function readCurrentReconciliationPhaseSnapshot(
  config: Pick<SupervisorConfig, "repoPath">,
): Promise<CurrentReconciliationPhaseSnapshot | null> {
  try {
    const raw = await fs.readFile(reconciliationPhasePath(config), "utf8");
    const parsed = JSON.parse(raw) as Partial<ReconciliationPhaseSnapshot>;
    if (typeof parsed.phase !== "string" || parsed.phase.length === 0) {
      return null;
    }
    return {
      phase: parsed.phase,
      startedAt: typeof parsed.startedAt === "string" && parsed.startedAt.length > 0 ? parsed.startedAt : null,
      targetIssueNumber: typeof parsed.targetIssueNumber === "number" ? parsed.targetIssueNumber : null,
      targetPrNumber: typeof parsed.targetPrNumber === "number" ? parsed.targetPrNumber : null,
      waitStep: typeof parsed.waitStep === "string" && parsed.waitStep.length > 0 ? parsed.waitStep : null,
    };
  } catch (error) {
    if (
      error instanceof SyntaxError ||
      (error as NodeJS.ErrnoException).code === "ENOENT"
    ) {
      return null;
    }
    throw error;
  }
}
