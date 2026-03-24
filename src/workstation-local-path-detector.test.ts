import assert from "node:assert/strict";
import { execFileSync, spawnSync, type SpawnSyncReturns } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const SAMPLE_FORBIDDEN_PATH = ["", "home", "alice", "dev", "private-repo"].join("/");

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", ["-C", cwd, ...args], {
    encoding: "utf8",
  });
}

async function createTrackedRepo(): Promise<string> {
  const repoPath = await fs.mkdtemp(path.join(os.tmpdir(), "workstation-local-path-check-"));
  git(repoPath, "init", "-b", "main");
  git(repoPath, "config", "user.name", "Codex Supervisor");
  git(repoPath, "config", "user.email", "codex@example.test");
  await fs.writeFile(path.join(repoPath, "README.md"), "# fixture\n", "utf8");
  git(repoPath, "add", "README.md");
  git(repoPath, "commit", "-m", "seed");
  return repoPath;
}

function runDetector(repoPath: string, ...args: string[]): SpawnSyncReturns<string> {
  const npxCommand = process.platform === "win32" ? "npx.cmd" : "npx";
  return spawnSync(
    npxCommand,
    ["tsx", path.join(process.cwd(), "scripts", "check-workstation-local-paths.ts"), ...args],
    {
      cwd: process.cwd(),
      encoding: "utf8",
      env: {
        ...process.env,
        FORCE_COLOR: "0",
      },
    },
  );
}

test("workstation-local path detector flags tracked durable artifacts and allows explicit exclusions", async (t) => {
  const repoPath = await createTrackedRepo();
  t.after(async () => {
    await fs.rm(repoPath, { recursive: true, force: true });
  });

  const cleanResult = runDetector(repoPath, "--workspace", repoPath);
  assert.equal(
    cleanResult.status,
    0,
    `expected clean repository to pass\nstdout:\n${cleanResult.stdout}\nstderr:\n${cleanResult.stderr}`,
  );

  await fs.mkdir(path.join(repoPath, "docs"), { recursive: true });
  await fs.writeFile(path.join(repoPath, "docs", "guide.md"), `Workspace note: ${SAMPLE_FORBIDDEN_PATH}\n`, {
    encoding: "utf8",
    flag: "w",
  });
  git(repoPath, "add", "docs/guide.md");

  const failingResult = runDetector(repoPath, "--workspace", repoPath);
  assert.notEqual(failingResult.status, 0, "expected forbidden tracked path to fail");
  assert.match(failingResult.stderr, /Forbidden workstation-local absolute path references found:/);
  assert.match(failingResult.stderr, /docs\/guide\.md:1/);
  assert.match(failingResult.stderr, new RegExp(SAMPLE_FORBIDDEN_PATH.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));

  const allowedResult = runDetector(repoPath, "--workspace", repoPath, "--exclude-path", "docs/guide.md");
  assert.equal(
    allowedResult.status,
    0,
    `expected explicit exclusion to pass\nstdout:\n${allowedResult.stdout}\nstderr:\n${allowedResult.stderr}`,
  );
});
