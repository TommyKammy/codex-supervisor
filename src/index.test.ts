import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { spawnSync, SpawnSyncReturns } from "node:child_process";
import { parseArgs } from "./index";

function runCli(args: string[]): SpawnSyncReturns<string> {
  return spawnSync(process.execPath, [path.join(process.cwd(), "node_modules", "tsx", "dist", "cli.mjs"), "src/index.ts", ...args], {
    cwd: process.cwd(),
    encoding: "utf8",
  });
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

test("explain rejects malformed issue numbers", () => {
  for (const token of ["12abc", "1.5", "1e2"]) {
    const result = runCli(["explain", token]);

    assert.equal(result.status, 1);
    assert.match(result.stderr, new RegExp(`Unknown argument: ${escapeRegExp(token)}`));
  }
});

test("parseArgs accepts doctor as a command", () => {
  assert.deepEqual(parseArgs(["doctor"]), {
    command: "doctor",
    configPath: undefined,
    dryRun: false,
    why: false,
    issueNumber: undefined,
  });
});
