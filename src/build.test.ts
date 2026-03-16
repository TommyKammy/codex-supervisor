import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

function npmCommand(): string {
  return process.platform === "win32" ? "npm.cmd" : "npm";
}

function runBuild(repoRoot: string): void {
  const result = spawnSync(npmCommand(), ["run", "build"], {
    cwd: repoRoot,
    encoding: "utf8",
  });

  assert.equal(
    result.status,
    0,
    `npm run build failed\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`,
  );
}

function resolveModule(modulePath: string, repoRoot: string): string {
  const result = spawnSync(process.execPath, ["-p", `require.resolve(${JSON.stringify(modulePath)})`], {
    cwd: repoRoot,
    encoding: "utf8",
  });

  assert.equal(
    result.status,
    0,
    `module resolution failed for ${modulePath}\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`,
  );

  return result.stdout.trim();
}

test("npm run build removes stale root-level dist artifacts that can shadow family directories", { concurrency: false }, async (t) => {
  const repoRoot = path.join(__dirname, "..");
  const distDir = path.join(repoRoot, "dist");
  const backupRoot = await fs.mkdtemp(path.join(os.tmpdir(), "codex-supervisor-dist-backup-"));
  const backupDistDir = path.join(backupRoot, "dist");

  try {
    await fs.rename(distDir, backupDistDir);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      throw error;
    }
  }

  t.after(async () => {
    await fs.rm(distDir, { recursive: true, force: true });
    try {
      await fs.rename(backupDistDir, distDir);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        throw error;
      }
    }
    await fs.rm(backupRoot, { recursive: true, force: true });
  });

  runBuild(repoRoot);
  await fs.writeFile(path.join(distDir, "codex.js"), "module.exports = { stale: true };\n", "utf8");

  assert.equal(resolveModule(path.join(distDir, "codex"), repoRoot), path.join(distDir, "codex.js"));

  runBuild(repoRoot);

  await assert.rejects(fs.access(path.join(distDir, "codex.js")));
  assert.equal(resolveModule(path.join(distDir, "codex"), repoRoot), path.join(distDir, "codex", "index.js"));
});
