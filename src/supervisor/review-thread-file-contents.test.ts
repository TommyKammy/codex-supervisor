import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { createReviewThread } from "../turn-execution-test-helpers";
import { loadReviewThreadFileContents } from "./review-thread-file-contents";

const execFileAsync = promisify(execFile);

async function git(cwd: string, ...args: string[]): Promise<string> {
  const result = await execFileAsync("git", ["-C", cwd, ...args], {
    encoding: "utf8",
    maxBuffer: 1_000_000,
  });
  return result.stdout.trim();
}

test("loadReviewThreadFileContents reads PR-head files even when the local branch name differs", async (t) => {
  const repoPath = await mkdtemp(path.join(tmpdir(), "review-thread-file-contents-"));
  t.after(async () => {
    await rm(repoPath, { recursive: true, force: true });
  });

  await execFileAsync("git", ["init", "--initial-branch", "main", repoPath], { encoding: "utf8" });
  await git(repoPath, "config", "user.name", "Test User");
  await git(repoPath, "config", "user.email", "test@example.test");
  await mkdir(path.join(repoPath, "src"), { recursive: true });
  await writeFile(path.join(repoPath, "src", "review.ts"), "export const repaired = true;\n", "utf8");
  await git(repoPath, "add", "src/review.ts");
  await git(repoPath, "commit", "-m", "Add review target");
  const headSha = await git(repoPath, "rev-parse", "HEAD");
  await git(repoPath, "checkout", "-b", "restored-alias-branch");

  const contents = await loadReviewThreadFileContents({
    defaultBranch: "main",
    expectedHeadSha: headSha,
    branch: "codex/issue-2401",
    workspacePath: repoPath,
    reviewThreads: [
      createReviewThread({
        id: "thread-1",
        path: "src/review.ts",
        line: 1,
      }),
    ],
  });

  assert.deepEqual(contents, {
    "src/review.ts": "export const repaired = true;\n",
  });
});
