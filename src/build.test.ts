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

function runDistCli(repoRoot: string, args: string[]): { status: number | null; stdout: string; stderr: string } {
  const result = spawnSync(process.execPath, ["dist/index.js", ...args], {
    cwd: repoRoot,
    encoding: "utf8",
    env: {
      ...process.env,
      NODE_NO_WARNINGS: "1",
    },
  });

  return {
    status: result.status,
    stdout: result.stdout,
    stderr: result.stderr,
  };
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

test("npm run build writes dist freshness metadata that keeps the compiled entrypoint runnable", { concurrency: false }, () => {
  const repoRoot = path.join(__dirname, "..");

  runBuild(repoRoot);

  const manifestResult = spawnSync(
    process.execPath,
    ["-p", "JSON.stringify(require('./dist/build-manifest.json'))"],
    {
      cwd: repoRoot,
      encoding: "utf8",
    },
  );
  assert.equal(
    manifestResult.status,
    0,
    `build manifest read failed\nstdout:\n${manifestResult.stdout}\nstderr:\n${manifestResult.stderr}`,
  );
  assert.match(manifestResult.stdout, /"schemaVersion":1/u);
  assert.match(manifestResult.stdout, /"sourceDigest":"[a-f0-9]{64}"/u);

  const result = runDistCli(repoRoot, ["replay-corpus"]);
  assert.equal(
    result.status,
    0,
    `node dist/index.js replay-corpus failed\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`,
  );
  assert.match(result.stdout, /^Replay corpus summary: total=\d+ passed=\d+ failed=0$/m);
});

test("compiled entrypoint fails closed when dist freshness metadata is stale", { concurrency: false }, async (t) => {
  const repoRoot = path.join(__dirname, "..");
  const manifestPath = path.join(repoRoot, "dist", "build-manifest.json");

  runBuild(repoRoot);
  const originalManifest = await fs.readFile(manifestPath, "utf8");

  t.after(async () => {
    await fs.writeFile(manifestPath, originalManifest, "utf8");
  });

  const staleManifest = JSON.stringify({
    schemaVersion: 1,
    builtAt: "2026-04-07T00:00:00.000Z",
    sourceDigest: "0".repeat(64),
  }, null, 2) + "\n";
  await fs.writeFile(manifestPath, staleManifest, "utf8");

  const result = runDistCli(repoRoot, ["replay-corpus"]);
  assert.equal(result.status, 1, `expected stale compiled runtime to fail closed\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`);
  assert.match(result.stderr, /Stale compiled runtime detected:/u);
  assert.match(result.stderr, /Run `npm run build`/u);
});
