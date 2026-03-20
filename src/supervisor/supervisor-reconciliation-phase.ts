import fs from "node:fs/promises";
import path from "node:path";
import { ensureDir } from "../core/utils";
import type { SupervisorConfig } from "../core/types";

interface ReconciliationPhaseSnapshot {
  phase: string;
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
  await fs.writeFile(snapshotPath, `${JSON.stringify({ phase } satisfies ReconciliationPhaseSnapshot)}\n`, "utf8");
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
  try {
    const raw = await fs.readFile(reconciliationPhasePath(config), "utf8");
    const parsed = JSON.parse(raw) as Partial<ReconciliationPhaseSnapshot>;
    return typeof parsed.phase === "string" && parsed.phase.length > 0 ? parsed.phase : null;
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
