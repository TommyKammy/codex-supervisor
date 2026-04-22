import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import {
  isIgnoredSupervisorArtifactPath,
  parseGitStatusPorcelainV1Paths,
  parseGitWorktreePaths,
} from "./git-workspace-helpers";

test("parseGitStatusPorcelainV1Paths keeps renamed and copied path pairs together", () => {
  const statusOutput = [
    "R  old-name.ts",
    "new-name.ts",
    "C  src/original.ts",
    "src/copied.ts",
    " M touched.ts",
    "",
  ].join("\0");

  assert.deepEqual(parseGitStatusPorcelainV1Paths(statusOutput), [
    ["old-name.ts", "new-name.ts"],
    ["src/original.ts", "src/copied.ts"],
    ["touched.ts"],
  ]);
});

test("isIgnoredSupervisorArtifactPath matches supervisor-owned artifacts and preserves user files", () => {
  assert.equal(
    isIgnoredSupervisorArtifactPath(".codex-supervisor/replay/decision-cycle-snapshot.json", ".codex-supervisor/issues/1359/issue-journal.md"),
    true,
  );
  assert.equal(
    isIgnoredSupervisorArtifactPath(".codex-supervisor/pre-merge/assessment-snapshot.json", ".codex-supervisor/issues/1359/issue-journal.md"),
    true,
  );
  assert.equal(
    isIgnoredSupervisorArtifactPath(".codex-supervisor/execution-metrics/run-summary.json", ".codex-supervisor/issues/1359/issue-journal.md"),
    true,
  );
  assert.equal(
    isIgnoredSupervisorArtifactPath(".codex-supervisor/issues/1359/issue-journal.md", ".codex-supervisor/issues/1359/issue-journal.md"),
    true,
  );
  assert.equal(isIgnoredSupervisorArtifactPath(".codex-supervisor/issue-journal.md"), true);
  assert.equal(isIgnoredSupervisorArtifactPath(".codex-supervisor/issues/2468/issue-journal.md"), true);
  assert.equal(isIgnoredSupervisorArtifactPath("src/user-change.ts", ".codex-supervisor/issues/1359/issue-journal.md"), false);
});

test("isIgnoredSupervisorArtifactPath matches configured templated issue journal paths", () => {
  assert.equal(
    isIgnoredSupervisorArtifactPath(
      ".codex-supervisor/custom/issue-2468.md",
      ".codex-supervisor/custom/issue-{issueNumber}.md",
    ),
    true,
  );
  assert.equal(
    isIgnoredSupervisorArtifactPath(
      ".codex-supervisor/custom/issue-not-a-number.md",
      ".codex-supervisor/custom/issue-{issueNumber}.md",
    ),
    false,
  );
  assert.equal(
    isIgnoredSupervisorArtifactPath(
      ".codex-supervisor/2468/issue-2468.md",
      ".codex-supervisor/{issueNumber}/issue-{issueNumber}.md",
    ),
    true,
  );
  assert.equal(
    isIgnoredSupervisorArtifactPath(
      ".codex-supervisor/2468/issue-not-a-number.md",
      ".codex-supervisor/{issueNumber}/issue-{issueNumber}.md",
    ),
    false,
  );
});

test("parseGitWorktreePaths returns only normalized worktree entries", () => {
  const worktreeEntries = parseGitWorktreePaths([
    "worktree .",
    "HEAD abcdef1234567890",
    "branch refs/heads/main",
    "worktree ./nested/../linked",
    "",
  ].join("\n"));

  assert.equal(worktreeEntries.has(path.resolve(".")), true);
  assert.equal(worktreeEntries.has(path.resolve("linked")), true);
  assert.equal(worktreeEntries.has("HEAD abcdef1234567890"), false);
});
