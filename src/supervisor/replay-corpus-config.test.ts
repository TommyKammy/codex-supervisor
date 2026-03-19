import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createCheckedInReplayCorpusConfig } from "./replay-corpus-config";

test("createCheckedInReplayCorpusConfig derives replay-local paths and provider defaults", () => {
  const repoRoot = path.join(os.tmpdir(), "codex-supervisor-repo");
  const config = createCheckedInReplayCorpusConfig(repoRoot);

  assert.equal(config.repoPath, repoRoot);
  assert.equal(config.repoSlug, "TommyKammy/codex-supervisor");
  assert.equal(config.defaultBranch, "main");
  assert.equal(config.workspaceRoot, path.join(repoRoot, ".codex-supervisor", "replay", "workspaces"));
  assert.equal(config.stateFile, path.join(repoRoot, ".codex-supervisor", "replay", "state.json"));
  assert.equal(config.localReviewArtifactDir, path.join(repoRoot, ".codex-supervisor", "replay", "reviews"));
  assert.deepEqual(config.reviewBotLogins, [
    "copilot-pull-request-reviewer",
    "coderabbitai",
    "coderabbitai[bot]",
  ]);
  assert.equal(config.issueJournalRelativePath, ".codex-supervisor/issue-journal.md");
  assert.equal(config.branchPrefix, "codex/issue-");
  assert.equal(config.draftPrAfterAttempt, 1);
});
