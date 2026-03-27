import { FailureContext } from "./core/types";
import { nowIso } from "./core/utils";
import { findForbiddenWorkstationLocalPaths, type WorkstationLocalPathMatch } from "./workstation-local-paths";

export const WORKSTATION_LOCAL_PATH_HYGIENE_FAILURE_SIGNATURE = "workstation-local-path-hygiene-failed";

export interface WorkstationLocalPathGateResult {
  ok: boolean;
  failureContext: FailureContext | null;
}

function renderFinding(finding: WorkstationLocalPathMatch): string {
  return `${finding.filePath}:${finding.line} matched ${finding.prefix} via ${JSON.stringify(finding.match)}`;
}

export async function runWorkstationLocalPathGate(args: {
  workspacePath: string;
  gateLabel: string;
}): Promise<WorkstationLocalPathGateResult> {
  const findings = await findForbiddenWorkstationLocalPaths(args.workspacePath);
  if (findings.length === 0) {
    return { ok: true, failureContext: null };
  }

  return {
    ok: false,
    failureContext: {
      category: "blocked",
      summary: `Tracked durable artifacts failed workstation-local path hygiene ${args.gateLabel}.`,
      signature: WORKSTATION_LOCAL_PATH_HYGIENE_FAILURE_SIGNATURE,
      command: "npm run verify:paths",
      details: findings.map(renderFinding),
      url: null,
      updated_at: nowIso(),
    },
  };
}
