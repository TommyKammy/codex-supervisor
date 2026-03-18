import fs from "node:fs/promises";
import path from "node:path";
import {
  CASE_EXPECTED_REPLAY_RESULT,
  CASE_INPUT_SNAPSHOT,
  CASE_METADATA,
  REPLAY_CORPUS_MANIFEST,
} from "./replay-corpus-model";
import type {
  ReplayCorpusCaseBundle,
  ReplayCorpusInputSnapshot,
  ReplayCorpusManifest,
  ReplayCorpusManifestEntry,
} from "./replay-corpus-model";
import { loadSupervisorCycleDecisionSnapshot } from "./supervisor-cycle-replay";
import {
  validateReplayCorpusCaseMetadata,
  validateReplayCorpusExpectedResult,
  validateReplayCorpusInputSnapshot,
  validateReplayCorpusManifest,
  validationError,
} from "./replay-corpus-validation";
import { parseJson } from "../core/utils";

async function readRequiredReplayCorpusJson<T>(filePath: string): Promise<T> {
  try {
    return parseJson<T>(await fs.readFile(filePath, "utf8"), filePath);
  } catch (error) {
    const maybeErr = error as NodeJS.ErrnoException;
    if (maybeErr.code === "ENOENT") {
      throw validationError(`Missing required replay corpus file: ${filePath}`);
    }

    throw error;
  }
}

async function loadReplayCorpusInputSnapshot(
  entryId: string,
  inputSnapshotPath: string,
): Promise<ReplayCorpusInputSnapshot> {
  let snapshot: ReplayCorpusInputSnapshot;
  try {
    snapshot = await loadSupervisorCycleDecisionSnapshot(inputSnapshotPath);
  } catch (error) {
    const maybeErr = error as NodeJS.ErrnoException;
    if (maybeErr.code === "ENOENT") {
      throw validationError(`Missing required replay corpus file: ${inputSnapshotPath}`);
    }

    throw error;
  }

  return validateReplayCorpusInputSnapshot(snapshot, entryId);
}

export async function loadReplayCorpusCaseBundle(
  rootPath: string,
  entry: ReplayCorpusManifestEntry,
): Promise<ReplayCorpusCaseBundle> {
  const bundlePath = path.join(rootPath, entry.path);
  const metadataPath = path.join(bundlePath, CASE_METADATA);
  const inputSnapshotPath = path.join(bundlePath, CASE_INPUT_SNAPSHOT);
  const expectedReplayResultPath = path.join(bundlePath, CASE_EXPECTED_REPLAY_RESULT);

  const metadata = validateReplayCorpusCaseMetadata(await readRequiredReplayCorpusJson(metadataPath), metadataPath);
  const snapshot = await loadReplayCorpusInputSnapshot(entry.id, inputSnapshotPath);
  const expected = validateReplayCorpusExpectedResult(
    await readRequiredReplayCorpusJson(expectedReplayResultPath),
    expectedReplayResultPath,
  );

  if (metadata.id !== entry.id) {
    throw validationError(
      `Replay corpus case "${entry.id}" metadata id must match manifest entry, received "${metadata.id}"`,
    );
  }
  if (metadata.issueNumber !== snapshot.issue.number) {
    throw validationError(
      `Replay corpus case "${entry.id}" issueNumber must match input snapshot issue.number (${snapshot.issue.number})`,
    );
  }
  if (metadata.title !== snapshot.issue.title) {
    throw validationError(`Replay corpus case "${entry.id}" title must match input snapshot issue.title`);
  }
  if (metadata.capturedAt !== snapshot.capturedAt) {
    throw validationError(`Replay corpus case "${entry.id}" capturedAt must match input snapshot capturedAt`);
  }

  return {
    id: entry.id,
    bundlePath,
    metadata,
    input: { snapshot },
    expected,
  };
}

export async function loadReplayCorpusManifest(rootPath: string): Promise<ReplayCorpusManifest> {
  const manifestPath = path.join(rootPath, REPLAY_CORPUS_MANIFEST);
  return validateReplayCorpusManifest(await readRequiredReplayCorpusJson(manifestPath), manifestPath);
}

export async function loadReplayCorpusManifestOrDefault(rootPath: string): Promise<ReplayCorpusManifest> {
  try {
    return await loadReplayCorpusManifest(rootPath);
  } catch (error) {
    if (error instanceof Error && error.message.includes("Missing required replay corpus file")) {
      return { schemaVersion: 1, cases: [] };
    }

    throw error;
  }
}
