import fs from "node:fs/promises";
import path from "node:path";
import { parseJson } from "../core/utils";
import { loadSupervisorCycleDecisionSnapshot } from "./supervisor-cycle-replay";

const REPLAY_CORPUS_MANIFEST = "manifest.json";
const CASE_METADATA = "case.json";
const CASE_INPUT_SNAPSHOT = path.join("input", "snapshot.json");
const CASE_EXPECTED_REPLAY_RESULT = path.join("expected", "replay-result.json");

interface ReplayCorpusManifestEntry {
  id: string;
  path: string;
}

interface ReplayCorpusManifest {
  schemaVersion: 1;
  cases: ReplayCorpusManifestEntry[];
}

export interface ReplayCorpusCaseMetadata {
  schemaVersion: 1;
  id: string;
  issueNumber: number;
  title: string;
  capturedAt: string;
}

export interface ReplayCorpusExpectedReplayResult {
  nextState: string;
  shouldRunCodex: boolean;
  blockedReason: string | null;
  failureSignature: string | null;
}

export interface ReplayCorpusCaseBundle {
  id: string;
  bundlePath: string;
  metadata: ReplayCorpusCaseMetadata;
  input: {
    snapshot: Awaited<ReturnType<typeof loadSupervisorCycleDecisionSnapshot>>;
  };
  expected: ReplayCorpusExpectedReplayResult;
}

export interface ReplayCorpus {
  rootPath: string;
  manifestPath: string;
  cases: ReplayCorpusCaseBundle[];
}

function validationError(message: string): Error {
  return new Error(`Invalid replay corpus: ${message}`);
}

async function readRequiredJson<T>(filePath: string): Promise<T> {
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

function expectObject(value: unknown, context: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw validationError(`${context} must be an object`);
  }

  return value as Record<string, unknown>;
}

function expectString(value: unknown, context: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw validationError(`${context} must be a non-empty string`);
  }

  return value;
}

function expectInteger(value: unknown, context: string): number {
  if (!Number.isInteger(value)) {
    throw validationError(`${context} must be an integer`);
  }

  return value as number;
}

function expectBoolean(value: unknown, context: string): boolean {
  if (typeof value !== "boolean") {
    throw validationError(`${context} must be a boolean`);
  }

  return value;
}

function expectNullableString(value: unknown, context: string): string | null {
  if (value === null) {
    return null;
  }

  return expectString(value, context);
}

function ensureSchemaVersion(value: unknown, context: string): 1 {
  if (value !== 1) {
    throw validationError(`${context} schemaVersion must be 1`);
  }

  return 1;
}

function validateManifest(raw: unknown, manifestPath: string): ReplayCorpusManifest {
  const manifest = expectObject(raw, `Replay corpus manifest ${manifestPath}`);
  ensureSchemaVersion(manifest.schemaVersion, `Replay corpus manifest ${manifestPath}`);
  if (!Array.isArray(manifest.cases)) {
    throw validationError(`Replay corpus manifest ${manifestPath} cases must be an array`);
  }

  const seenIds = new Set<string>();
  const seenPaths = new Set<string>();
  const cases = manifest.cases.map((entry, index) => {
    const value = expectObject(entry, `Replay corpus manifest case[${index}]`);
    const id = expectString(value.id, `Replay corpus manifest case[${index}] id`);
    const entryPath = expectString(value.path, `Replay corpus manifest case[${index}] path`);
    const canonicalPath = path.posix.join("cases", id);
    if (entryPath !== canonicalPath) {
      throw validationError(
        `Replay corpus manifest case "${id}" must use canonical path "${canonicalPath}", received "${entryPath}"`,
      );
    }
    if (seenIds.has(id)) {
      throw validationError(`Replay corpus manifest contains duplicate case id "${id}"`);
    }
    if (seenPaths.has(entryPath)) {
      throw validationError(`Replay corpus manifest contains duplicate case path "${entryPath}"`);
    }
    seenIds.add(id);
    seenPaths.add(entryPath);
    return { id, path: entryPath };
  });

  return {
    schemaVersion: 1,
    cases,
  };
}

function validateCaseMetadata(raw: unknown, metadataPath: string): ReplayCorpusCaseMetadata {
  const metadata = expectObject(raw, `Replay corpus case metadata ${metadataPath}`);
  return {
    schemaVersion: ensureSchemaVersion(metadata.schemaVersion, `Replay corpus case metadata ${metadataPath}`),
    id: expectString(metadata.id, `Replay corpus case metadata ${metadataPath} id`),
    issueNumber: expectInteger(metadata.issueNumber, `Replay corpus case metadata ${metadataPath} issueNumber`),
    title: expectString(metadata.title, `Replay corpus case metadata ${metadataPath} title`),
    capturedAt: expectString(metadata.capturedAt, `Replay corpus case metadata ${metadataPath} capturedAt`),
  };
}

function validateExpectedReplayResult(raw: unknown, expectedPath: string): ReplayCorpusExpectedReplayResult {
  const expected = expectObject(raw, `Replay corpus expected replay result ${expectedPath}`);
  return {
    nextState: expectString(expected.nextState, `Replay corpus expected replay result ${expectedPath} nextState`),
    shouldRunCodex: expectBoolean(
      expected.shouldRunCodex,
      `Replay corpus expected replay result ${expectedPath} shouldRunCodex`,
    ),
    blockedReason: expectNullableString(
      expected.blockedReason,
      `Replay corpus expected replay result ${expectedPath} blockedReason`,
    ),
    failureSignature: expectNullableString(
      expected.failureSignature,
      `Replay corpus expected replay result ${expectedPath} failureSignature`,
    ),
  };
}

async function loadReplayCorpusCase(rootPath: string, entry: ReplayCorpusManifestEntry): Promise<ReplayCorpusCaseBundle> {
  const bundlePath = path.join(rootPath, entry.path);
  const metadataPath = path.join(bundlePath, CASE_METADATA);
  const inputSnapshotPath = path.join(bundlePath, CASE_INPUT_SNAPSHOT);
  const expectedReplayResultPath = path.join(bundlePath, CASE_EXPECTED_REPLAY_RESULT);

  const metadata = validateCaseMetadata(await readRequiredJson(metadataPath), metadataPath);
  const snapshot = await loadSupervisorCycleDecisionSnapshot(inputSnapshotPath);
  const expected = validateExpectedReplayResult(
    await readRequiredJson(expectedReplayResultPath),
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

export async function loadReplayCorpus(rootPath: string): Promise<ReplayCorpus> {
  const manifestPath = path.join(rootPath, REPLAY_CORPUS_MANIFEST);
  const manifest = validateManifest(await readRequiredJson(manifestPath), manifestPath);
  const cases: ReplayCorpusCaseBundle[] = [];
  for (const entry of manifest.cases) {
    cases.push(await loadReplayCorpusCase(rootPath, entry));
  }

  return {
    rootPath,
    manifestPath,
    cases,
  };
}
