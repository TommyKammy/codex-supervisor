import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import {
  JsonCorruptStateResetResult,
  StateLoadFinding,
  SupervisorStateFile,
} from "./types";
import { nowIso, parseJson, writeJsonAtomic } from "./utils";
import {
  emptySupervisorState,
  isJsonQuarantineMarkerState,
  normalizeStateForLoad,
  normalizeStateForSave,
  readJsonStateQuarantine,
  withLoadFindings,
} from "./state-store-normalization";

function buildJsonQuarantinePath(filePath: string): string {
  return `${filePath}.corrupt.${nowIso().replace(/[:.]/g, "-")}`;
}

function buildJsonQuarantineMarkerTempPath(filePath: string, attemptId: string): string {
  return `${filePath}.quarantine.${attemptId}.tmp`;
}

function buildRejectedJsonResetResult(
  stateFile: string,
  summary: string,
  quarantine: {
    quarantined_file: string;
    quarantined_at: string;
  } | null = null,
): JsonCorruptStateResetResult {
  return {
    action: "reset-corrupt-json-state",
    outcome: "rejected",
    summary,
    stateFile,
    quarantinedFile: quarantine?.quarantined_file ?? null,
    quarantinedAt: quarantine?.quarantined_at ?? null,
  };
}

async function quarantineCorruptJsonState(
  filePath: string,
  error: Error,
): Promise<SupervisorStateFile> {
  const quarantineAttemptId = randomUUID();
  const quarantinedFile = buildJsonQuarantinePath(filePath);
  const markerTempPath = buildJsonQuarantineMarkerTempPath(filePath, quarantineAttemptId);
  const quarantinedAt = nowIso();
  const message = `${error.message}. Quarantined corrupt JSON state at ${quarantinedFile}; recovery marker written to ${filePath}.`;
  const markerState = withLoadFindings({
    ...emptySupervisorState(),
    json_state_quarantine: {
      kind: "parse_error",
      marker_file: filePath,
      quarantined_file: quarantinedFile,
      quarantined_at: quarantinedAt,
    },
  }, [
    {
      backend: "json",
      kind: "parse_error",
      scope: "state_file",
      location: filePath,
      issue_number: null,
      message,
    },
  ]);

  try {
    await fs.writeFile(markerTempPath, `${JSON.stringify(markerState, null, 2)}\n`, "utf8");
  } catch (writeError) {
    await fs.rm(markerTempPath, { force: true }).catch(() => undefined);
    throw writeError;
  }

  try {
    await fs.rename(filePath, quarantinedFile);
  } catch (quarantineError) {
    await fs.rm(markerTempPath, { force: true }).catch(() => undefined);
    throw quarantineError;
  }

  try {
    await fs.rename(markerTempPath, filePath);
  } catch (installError) {
    await fs.rm(markerTempPath, { force: true }).catch(() => undefined);

    try {
      await fs.rename(quarantinedFile, filePath);
    } catch (restoreError) {
      const installMessage = installError instanceof Error ? installError.message : String(installError);
      throw new Error(
        `Failed to install JSON quarantine marker at ${filePath} after moving corrupt state to ${quarantinedFile}: ${installMessage}. Restore attempt also failed.`,
        { cause: restoreError instanceof Error ? restoreError : undefined },
      );
    }

    throw installError;
  }
  console.warn(message);

  return markerState;
}

export async function loadFromJson(filePath: string): Promise<SupervisorStateFile> {
  let raw: string;
  try {
    raw = await fs.readFile(filePath, "utf8");
  } catch (error) {
    const maybeErr = error as NodeJS.ErrnoException;
    if (maybeErr.code === "ENOENT") {
      return emptySupervisorState();
    }

    throw error;
  }

  try {
    return normalizeStateForLoad(parseJson<SupervisorStateFile>(raw, filePath));
  } catch (error) {
    if (!(error instanceof Error) || !(error.cause instanceof SyntaxError)) {
      throw error;
    }

    return quarantineCorruptJsonState(filePath, error);
  }
}

export async function saveToJson(filePath: string, state: SupervisorStateFile): Promise<void> {
  await writeJsonAtomic(filePath, normalizeStateForSave(state));
}

export async function resetCorruptJsonStateFromJson(filePath: string): Promise<JsonCorruptStateResetResult> {
  let raw: string;
  try {
    raw = await fs.readFile(filePath, "utf8");
  } catch (error) {
    const maybeErr = error as NodeJS.ErrnoException;
    if (maybeErr.code === "ENOENT") {
      return buildRejectedJsonResetResult(
        filePath,
        `Rejected reset-corrupt-json-state for ${filePath}: the current JSON state is not a corruption quarantine marker.`,
      );
    }

    throw error;
  }

  let state: unknown;
  try {
    state = parseJson<unknown>(raw, filePath);
  } catch {
    return buildRejectedJsonResetResult(
      filePath,
      `Rejected reset-corrupt-json-state for ${filePath}: the current JSON state is not a corruption quarantine marker.`,
    );
  }

  const quarantine = readJsonStateQuarantine(
    typeof state === "object" && state !== null && "json_state_quarantine" in state ? state.json_state_quarantine : null,
    filePath,
  );

  if (!isJsonQuarantineMarkerState(state, filePath)) {
    return buildRejectedJsonResetResult(
      filePath,
      `Rejected reset-corrupt-json-state for ${filePath}: the current JSON state is not a corruption quarantine marker.`,
      quarantine,
    );
  }

  const acceptedQuarantine = readJsonStateQuarantine(state.json_state_quarantine, filePath);
  if (!acceptedQuarantine) {
    return buildRejectedJsonResetResult(
      filePath,
      `Rejected reset-corrupt-json-state for ${filePath}: the current JSON state is not a corruption quarantine marker.`,
    );
  }

  await writeJsonAtomic(filePath, normalizeStateForSave(emptySupervisorState()));
  return {
    action: "reset-corrupt-json-state",
    outcome: "mutated",
    summary:
      `Reset corrupted JSON supervisor state at ${filePath} and preserved the quarantined payload at ${acceptedQuarantine.quarantined_file}.`,
    stateFile: filePath,
    quarantinedFile: acceptedQuarantine.quarantined_file,
    quarantinedAt: acceptedQuarantine.quarantined_at,
  };
}

export function withJsonLoadFindings(
  state: SupervisorStateFile,
  findings: StateLoadFinding[],
): SupervisorStateFile {
  return withLoadFindings(state, findings);
}
