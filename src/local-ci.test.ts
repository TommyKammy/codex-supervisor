import test from "node:test";
import assert from "node:assert/strict";
import { runLocalCiGate } from "./local-ci";

test("runLocalCiGate preserves stdout and stderr details from command failures", async () => {
  const failure = Object.assign(new Error("Command failed: sh -lc +1 args\nexitCode=1"), {
    stdout: "lint summary\n1 file checked",
    stderr: "tests failed\n1 assertion",
  });

  const result = await runLocalCiGate({
    config: { localCiCommand: "npm run ci:local" },
    workspacePath: "/tmp/workspaces/issue-102",
    gateLabel: "before marking PR #116 ready",
    runLocalCiCommand: async () => {
      throw failure;
    },
  });

  assert.equal(result.ok, false);
  assert.deepEqual(result.failureContext?.details, [
    "Command failed: sh -lc +1 args\nexitCode=1",
    "stdout:\nlint summary\n1 file checked",
    "stderr:\ntests failed\n1 assertion",
  ]);
});

test("runLocalCiGate preserves timeout summaries at the tail of bounded stderr details", async () => {
  const failure = Object.assign(
    new Error(`Command timed out: sh -lc +1 args\nexitCode=1\nprefix\n${"x".repeat(2_000)}\nCommand timed out after 5000ms: sh -lc +1 args`),
    {
      stderr: `prefix\n${"x".repeat(2_000)}\nCommand timed out after 5000ms: sh -lc +1 args\n`,
    },
  );

  const result = await runLocalCiGate({
    config: { localCiCommand: "npm run ci:local" },
    workspacePath: "/tmp/workspaces/issue-102",
    gateLabel: "before marking PR #116 ready",
    runLocalCiCommand: async () => {
      throw failure;
    },
  });

  assert.equal(result.ok, false);
  assert.match(result.failureContext?.details[0] ?? "", /Command timed out after 5000ms: sh -lc \+1 args/);
  assert.match(result.failureContext?.details[0] ?? "", /\n\.\.\.\n/);
  assert.match(result.failureContext?.details[1] ?? "", /Command timed out after 5000ms: sh -lc \+1 args/);
  assert.match(result.failureContext?.details[1] ?? "", /\n\.\.\.\n/);
});
