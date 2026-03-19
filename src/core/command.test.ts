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

test("runCommand failure errors bound noisy stderr", async () => {
  const noisyPrefix = "prefix-line";
  const noisySuffix = "suffix-line";
  const noisyMiddle = "x".repeat(1_200);

  await assert.rejects(
    () =>
      runCommand(process.execPath, [
        "-e",
        "process.stderr.write(process.env.NOISY_STDERR ?? ''); process.exit(9);",
      ], {
        env: {
          ...process.env,
          NOISY_STDERR: `${noisyPrefix}\n${noisyMiddle}\n${noisySuffix}\n`,
        },
      }),
    (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.match(error.message, /Command failed:/);
      assert.match(error.message, /exitCode=9/);
      assert.match(error.message, new RegExp(noisyPrefix));
      assert.match(error.message, new RegExp(noisySuffix));
      assert.match(error.message, /\n\.\.\.\n/);
      assert.ok(error.message.length < 900, `expected bounded error message, got length ${error.message.length}`);
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

test("runCommand timeout errors bound noisy stderr while keeping timeout context", async () => {
  const noisyPrefix = "timeout-prefix";
  const noisySuffix = "timeout-suffix";
  const noisyMiddle = "y".repeat(1_200);
  const timeoutSignalScript =
    'process.on("SIGTERM",()=>{process.stderr.write(process.env.NOISY_STDERR??"");process.exit(0)});setInterval(()=>{},1000)';

  await assert.rejects(
    () =>
      runCommand(
        process.execPath,
        [
          "-e",
          timeoutSignalScript,
        ],
        {
          env: {
            ...process.env,
            NOISY_STDERR: `${noisyPrefix}\n${noisyMiddle}\n${noisySuffix}\n`,
          },
          timeoutMs: 50,
        },
      ),
    (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.match(error.message, /Command timed out:/);
      assert.match(error.message, new RegExp(noisyPrefix));
      assert.match(error.message, new RegExp(noisySuffix));
      assert.match(error.message, /Command timed out after 50ms:/);
      assert.match(error.message, /\n\.\.\.\n/);
      assert.ok(error.message.length < 950, `expected bounded timeout error message, got length ${error.message.length}`);
      return true;
    },
  );
});
