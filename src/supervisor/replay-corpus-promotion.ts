import fs from "node:fs/promises";
import path from "node:path";
import { DEFAULT_ISSUE_JOURNAL_RELATIVE_PATH, resolveIssueJournalRelativePath } from "../core/journal";
import type { SupervisorConfig } from "../core/types";
import { loadSupervisorCycleDecisionSnapshot, replaySupervisorCycleDecisionSnapshot } from "./supervisor-cycle-replay";
import {
  CASE_EXPECTED_REPLAY_RESULT,
  CASE_INPUT_SNAPSHOT,
  CASE_METADATA,
  REPLAY_CORPUS_MANIFEST,
} from "./replay-corpus-model";
import type {
  ReplayCorpusCaseBundle,
  ReplayCorpusCaseMetadata,
  ReplayCorpusInputSnapshot,
  ReplayCorpusManifest,
} from "./replay-corpus-model";
import { loadReplayCorpusManifestOrDefault } from "./replay-corpus-loading";
import { normalizeReplayResult } from "./replay-corpus-outcome";
import { loadReplayCorpus } from "./replay-corpus-runner";
import { expectCaseId, validateReplayCorpusInputSnapshot, validationError } from "./replay-corpus-validation";

export interface PromoteCapturedReplaySnapshotArgs {
  corpusRoot: string;
  snapshotPath: string;
  caseId: string;
  config: SupervisorConfig;
}

async function writeJson(filePath: string, value: unknown): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

export function normalizePromotedInputSnapshot(snapshot: ReplayCorpusInputSnapshot): ReplayCorpusInputSnapshot {
  return {
    ...snapshot,
    local: {
      ...snapshot.local,
      record: {
        ...snapshot.local.record,
        workspace: ".",
        journal_path:
          snapshot.local.record.journal_path === null
            ? null
            : resolveIssueJournalRelativePath(
                DEFAULT_ISSUE_JOURNAL_RELATIVE_PATH,
                snapshot.local.record.issue_number,
              ),
        local_review_summary_path: null,
      },
      workspaceStatus: {
        ...snapshot.local.workspaceStatus,
        hasUncommittedChanges: false,
      },
    },
  };
}

export function buildPromotedCaseMetadata(snapshot: ReplayCorpusInputSnapshot, caseId: string): ReplayCorpusCaseMetadata {
  return {
    schemaVersion: 1,
    id: caseId,
    issueNumber: snapshot.issue.number,
    title: snapshot.issue.title,
    capturedAt: snapshot.capturedAt,
  };
}

export async function promoteCapturedReplaySnapshot(args: PromoteCapturedReplaySnapshotArgs): Promise<ReplayCorpusCaseBundle> {
  const manifest = await loadReplayCorpusManifestOrDefault(args.corpusRoot);
  if (manifest.cases.length > 0) {
    await loadReplayCorpus(args.corpusRoot);
  }
  const caseId = expectCaseId(args.caseId, "Replay corpus promotion caseId");
  if (manifest.cases.some((entry) => entry.id === caseId)) {
    throw validationError(`Replay corpus manifest already contains case "${caseId}"`);
  }

  const normalizedSnapshot = normalizePromotedInputSnapshot(
    validateReplayCorpusInputSnapshot(await loadSupervisorCycleDecisionSnapshot(args.snapshotPath), caseId),
  );
  const metadata = buildPromotedCaseMetadata(normalizedSnapshot, caseId);
  const expected = normalizeReplayResult(replaySupervisorCycleDecisionSnapshot(normalizedSnapshot, args.config));
  const nextManifest: ReplayCorpusManifest = {
    schemaVersion: 1,
    cases: [...manifest.cases, { id: caseId, path: `cases/${caseId}` }],
  };
  const bundlePath = path.join(args.corpusRoot, "cases", caseId);

  await writeJson(path.join(bundlePath, CASE_METADATA), metadata);
  await writeJson(path.join(bundlePath, CASE_INPUT_SNAPSHOT), normalizedSnapshot);
  await writeJson(path.join(bundlePath, CASE_EXPECTED_REPLAY_RESULT), expected);
  await writeJson(path.join(args.corpusRoot, REPLAY_CORPUS_MANIFEST), nextManifest);

  const corpus = await loadReplayCorpus(args.corpusRoot);
  const promotedCase = corpus.cases.find((entry) => entry.id === caseId);
  if (!promotedCase) {
    throw validationError(`Replay corpus promotion did not produce case "${caseId}"`);
  }

  return promotedCase;
}
