import fs from "node:fs/promises";
import path from "node:path";
import { ensureDir } from "../core/utils";
import type { SupervisorConfig } from "../core/types";

interface ReconciliationPhaseSnapshot {
  phase: string;
  startedAt: string;
}

export interface CurrentReconciliationPhaseSnapshot {
  phase: string;
  startedAt: string | null;
}

export function reconciliationPhasePath(config: Pick<SupervisorConfig, "repoPath">): string {
  return path.join(config.repoPath, ".codex-supervisor", "current-reconciliation-phase.json");
}

export async function writeCurrentReconciliationPhase(
  config: Pick<SupervisorConfig, "repoPath">,
  phase: string,
): Promise<void> {
  const snapshotPath = reconciliationPhasePath(config);
  await ensureDir(path.dirname(snapshotPath));
  const startedAt = (await readCurrentReconciliationPhaseSnapshot(config))?.startedAt ?? new Date(Date.now()).toISOString();
  await fs.writeFile(snapshotPath, `${JSON.stringify({ phase, startedAt } satisfies ReconciliationPhaseSnapshot)}\n`, "utf8");
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
