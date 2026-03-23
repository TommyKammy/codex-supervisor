import { loadConfig } from "../core/config";
import type { CliOptions } from "../core/types";
import { loadExecutionMetricsSummaryLines } from "../supervisor/execution-metrics-debugging";
import {
  formatSupervisorCycleReplay,
  loadSupervisorCycleDecisionSnapshot,
  replaySupervisorCycleDecisionSnapshot,
} from "../supervisor/supervisor-cycle-replay";

export async function handleReplayCommand(
  options: Pick<CliOptions, "configPath" | "snapshotPath">,
): Promise<string> {
  const config = loadConfig(options.configPath);
  const snapshot = await loadSupervisorCycleDecisionSnapshot(options.snapshotPath!);
  const replayResult = replaySupervisorCycleDecisionSnapshot(snapshot, config);
  const executionMetricsLines = await loadExecutionMetricsSummaryLines(snapshot.local.record.workspace);
  return formatSupervisorCycleReplay({
    snapshotPath: options.snapshotPath!,
    replayResult,
    snapshot,
    executionMetricsLines,
  });
}
