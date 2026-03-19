import test from "node:test";
import assert from "node:assert/strict";
import { runCommand } from "./command";

test("runCommand failure errors redact trailing raw arguments", async () => {
  const secretArg = "token=super-secret-value";

  await assert.rejects(
    () =>
      runCommand(process.execPath, [
        "-e",
        "process.stderr.write('boom\\n'); process.exit(7);",
        secretArg,
      ]),
    (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.match(
        error.message,
        new RegExp(
          `Command failed: ${process.execPath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")} -e .* \\+1 arg`,
        ),
      );
      assert.match(error.message, /exitCode=7/);
      assert.match(error.message, /boom/);
      assert.doesNotMatch(error.message, /super-secret-value/);
      return true;
    },
  );
});

test("runCommand timeout errors redact trailing raw arguments", async () => {
  const secretArg = "token=timeout-secret-value";

  await assert.rejects(
    () =>
      runCommand(process.execPath, [
        "-e",
        "setTimeout(() => process.exit(0), 1000);",
        secretArg,
      ], {
        timeoutMs: 10,
      }),
    (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.match(
        error.message,
        new RegExp(
          `Command timed out: ${process.execPath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")} -e .* \\+1 arg`,
        ),
      );
      assert.match(error.message, /exitCode=/);
      assert.match(error.message, /Command timed out after 10ms: .* -e .* \+1 arg/);
      assert.doesNotMatch(error.message, /timeout-secret-value/);
      return true;
    },
  );
});
