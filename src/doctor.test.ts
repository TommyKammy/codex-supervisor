import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createConfig, createRecord } from "./turn-execution-test-helpers";
import { diagnoseSupervisorHost } from "./doctor";
import { type SupervisorStateFile } from "./core/types";

test("diagnoseSupervisorHost reports representative auth, state, and workspace failures without mutating state", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "codex-supervisor-doctor-"));
  t.after(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  const repoPath = path.join(root, "repo");
  const workspaceRoot = path.join(root, "workspaces");
  const stateFile = path.join(root, "state.json");
  await fs.mkdir(repoPath, { recursive: true });
  await fs.mkdir(workspaceRoot, { recursive: true });
  await fs.writeFile(stateFile, "{not-json}\n", "utf8");
  execFileSync("git", ["init", "-b", "main"], { cwd: repoPath });

  const config = createConfig({
    repoPath,
    workspaceRoot,
    stateFile,
    codexBinary: path.join(root, "missing-codex"),
  });
  const trackedState: SupervisorStateFile = {
    activeIssueNumber: 102,
    issues: {
      "102": createRecord({
        issue_number: 102,
        workspace: path.join(workspaceRoot, "issue-102"),
      }),
    },
  };

  const beforeState = await fs.readFile(stateFile, "utf8");
  const diagnostics = await diagnoseSupervisorHost({
    config,
    authStatus: async () => ({ ok: false, message: "token expired" }),
    loadState: async () => trackedState,
  });
  const afterState = await fs.readFile(stateFile, "utf8");

  assert.equal(afterState, beforeState);
  assert.equal(diagnostics.overallStatus, "fail");
  assert.deepEqual(
    diagnostics.checks.map((check) => ({ name: check.name, status: check.status })),
    [
      { name: "github_auth", status: "fail" },
      { name: "codex_cli", status: "fail" },
      { name: "state_file", status: "fail" },
      { name: "worktrees", status: "warn" },
    ],
  );
  assert.match(
    diagnostics.checks.find((check) => check.name === "state_file")?.summary ?? "",
    /failed to parse json/i,
  );
  assert.match(
    diagnostics.checks.find((check) => check.name === "worktrees")?.details[0] ?? "",
    /missing workspace/i,
  );
});
